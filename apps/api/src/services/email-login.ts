import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import type { EmailSender } from '../email/sender';
import { lockKey, withTransaction } from '../lib/db-utils';
import { HttpError } from '../lib/http-error';
import { createSession } from './sessions';

// Email login with one-time codes. Guests play without an account; verifying an email "saves"
// their progress so they can sign in again on any phone.

export const OTP_RULES = {
  ttlMinutes: 10,
  maxAttempts: 5,
  perEmail: { max: 3, windowMinutes: 15 },
  perIp: { max: 10, windowMinutes: 60 },
} as const;

const minutesBefore = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000);

/**
 * Codes are stored as an HMAC keyed with a server secret, never in plain text. A plain hash of a
 * 6-digit code could be reversed in milliseconds by trying all million codes; without the key it can't.
 */
export function hashCode(secret: string, email: string, code: string): string {
  return createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y); // constant time: no timing hints
}

export function codeEmail(to: string, code: string) {
  return {
    to,
    // The code is in the subject so it shows in the phone's notification.
    subject: `${code} is your Market Daily 5 code`,
    text: [
      `Your code is ${code}`,
      '',
      `Type it in the app to save your progress. It works for ${OTP_RULES.ttlMinutes} minutes.`,
      '',
      'We will never call or message you to ask for this code. Do not share it with anyone.',
      "If you didn't ask for it, you can ignore this email.",
    ].join('\n'),
  };
}

export interface RequestCodeInput {
  email: string; // already trimmed + lower-cased by the request schema
  ip: string;
  now: Date;
  secret: string;
}

/**
 * Sends a new code. Rate limited per email and per IP. The caller answers the same way whether or
 * not the email has an account, so the endpoint can't be used to find out who uses the app.
 */
export async function requestCode(pool: pg.Pool, sender: EmailSender, input: RequestCodeInput) {
  const { email, ip, now, secret } = input;

  const { rows } = await pool.query<{ by_email: number; by_ip: number }>(
    `SELECT
       count(*) FILTER (WHERE value = $1 AND created_at > $3)::int AS by_email,
       count(*) FILTER (WHERE requested_ip = $2 AND created_at > $4)::int AS by_ip
     FROM otp_codes
     WHERE identity_type = 'email' AND (value = $1 OR requested_ip = $2) AND created_at > $4`,
    [
      email,
      ip,
      minutesBefore(now, OTP_RULES.perEmail.windowMinutes),
      minutesBefore(now, OTP_RULES.perIp.windowMinutes),
    ],
  );
  const { by_email, by_ip } = rows[0]!;
  if (by_email >= OTP_RULES.perEmail.max || by_ip >= OTP_RULES.perIp.max) {
    throw new HttpError(
      429,
      'too_many_requests',
      'Too many codes asked for. Please wait a few minutes.',
    );
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await withTransaction(pool, async (client) => {
    await lockKey(client, `otp:${email}`);
    // Only the newest code is ever valid: retire any earlier unused ones for this address.
    // (Picking "the latest" by timestamp alone isn't safe: two codes can share a timestamp.)
    await client.query(
      `UPDATE otp_codes SET used_at = $2
       WHERE identity_type = 'email' AND value = $1 AND used_at IS NULL`,
      [email, now],
    );
    await client.query(
      `INSERT INTO otp_codes (identity_type, value, code_hash, expires_at, requested_ip, created_at)
       VALUES ('email', $1, $2, $3, $4, $5)`,
      [
        email,
        hashCode(secret, email, code),
        new Date(now.getTime() + OTP_RULES.ttlMinutes * 60_000),
        ip,
        now,
      ],
    );
  });

  try {
    await sender.send(codeEmail(email, code));
  } catch (err) {
    throw new HttpError(502, 'email_failed', 'We could not send the email. Please try again.', {
      cause: err,
    });
  }
}

export interface VerifyCodeInput {
  email: string;
  code: string;
  currentUserId: string;
  now: Date;
  secret: string;
}

export interface VerifyCodeResult {
  userId: string;
  /** The email already belonged to another account; the device is now signed in to that one. */
  switchedAccount: boolean;
  /** New cookie token when the signed-in user changed. */
  sessionToken: string | null;
}

type Check = { ok: true } | { ok: false; error: HttpError };

/**
 * Checks a code and links the email to the player.
 *
 * - No account has this email → it's linked to the current (guest) account.
 * - Another account has it (e.g. a new phone) → this device signs in to that account. Guest
 *   progress is not merged into it: merging points between accounts would be easy to abuse.
 */
export async function verifyCode(pool: pg.Pool, input: VerifyCodeInput): Promise<VerifyCodeResult> {
  const { email, code, currentUserId, now, secret } = input;

  // 1. Check the code. A wrong guess must be counted even though we then reject the request,
  //    so this runs in its own transaction and returns the outcome instead of throwing inside it.
  const check = await withTransaction(pool, async (client): Promise<Check> => {
    await lockKey(client, `otp:${email}`);
    const { rows } = await client.query<{
      id: string;
      code_hash: string;
      expires_at: Date;
      attempts: number;
    }>(
      `SELECT id, code_hash, expires_at, attempts FROM otp_codes
       WHERE identity_type = 'email' AND value = $1 AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [email],
    );
    const row = rows[0];
    if (!row || row.expires_at <= now) {
      return {
        ok: false,
        error: new HttpError(400, 'code_expired', 'This code has expired. Ask for a new one.'),
      };
    }
    if (row.attempts >= OTP_RULES.maxAttempts) {
      return {
        ok: false,
        error: new HttpError(429, 'too_many_attempts', 'Too many wrong tries. Ask for a new code.'),
      };
    }
    if (!sameHash(row.code_hash, hashCode(secret, email, code))) {
      await client.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      const left = OTP_RULES.maxAttempts - row.attempts - 1;
      return {
        ok: false,
        error: new HttpError(
          400,
          'wrong_code',
          left > 0 ? `Wrong code. ${left} tries left.` : 'Wrong code. Ask for a new one.',
        ),
      };
    }
    // Correct: this code, and any older unused ones for the address, can't be used again.
    await client.query(
      `UPDATE otp_codes SET used_at = $2 WHERE identity_type = 'email' AND value = $1 AND used_at IS NULL`,
      [email, now],
    );
    return { ok: true };
  });
  if (!check.ok) throw check.error;

  // 2. Link the email, or sign in to the account that already has it.
  return withTransaction(pool, async (client) => {
    await lockKey(client, `email:${email}`);
    const { rows } = await client.query<{ user_id: string }>(
      `SELECT user_id FROM identities WHERE type = 'email' AND value = $1`,
      [email],
    );
    const owner = rows[0]?.user_id;

    if (!owner) {
      await client.query(
        `INSERT INTO identities (user_id, type, value, verified_at, created_at) VALUES ($1, 'email', $2, $3, $3)`,
        [currentUserId, email, now],
      );
      return { userId: currentUserId, switchedAccount: false, sessionToken: null };
    }
    if (owner === currentUserId) {
      return { userId: currentUserId, switchedAccount: false, sessionToken: null };
    }

    // This device now belongs to the verified account: next time the app opens, its device token
    // restores that account. The guest's sessions end.
    await client.query(
      `UPDATE identities SET user_id = $1 WHERE type = 'device' AND user_id = $2`,
      [owner, currentUserId],
    );
    await client.query(
      'UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL',
      [currentUserId, now],
    );
    return {
      userId: owner,
      switchedAccount: true,
      sessionToken: await createSession(client, owner, now),
    };
  });
}
