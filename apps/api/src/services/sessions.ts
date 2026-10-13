import type pg from 'pg';
import { lockKey, withTransaction, type Db } from '../lib/db-utils';
import { randomToken, sha256 } from '../lib/crypto';

export const SESSION_TTL_DAYS = 180;

/** Returns the user behind a session cookie token, if the session is valid. */
export async function userIdForSession(db: Db, token: string, now: Date): Promise<string | null> {
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM sessions
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > $2`,
    [sha256(token), now],
  );
  return rows[0]?.user_id ?? null;
}

export interface StartSessionResult {
  userId: string;
  isNew: boolean;
  /** A new cookie token, or null if the caller's existing session is still valid for this user. */
  sessionToken: string | null;
}

/**
 * Finds or creates the guest user for a device token and opens a session.
 *
 * - Known device token → that user.
 * - Unknown device token but a valid session cookie (e.g. the app's storage was cleared) → the
 *   new device token is linked to the signed-in user, so progress isn't lost.
 * - Neither → a new guest user.
 */
export async function startSession(
  pool: pg.Pool,
  deviceToken: string,
  currentUserId: string | null,
  now: Date,
): Promise<StartSessionResult> {
  const deviceHash = sha256(deviceToken);

  return withTransaction(pool, async (client) => {
    // Two parallel calls with the same new device token must not create two users.
    await lockKey(client, `device:${deviceHash}`);

    const { rows } = await client.query<{ user_id: string }>(
      `SELECT user_id FROM identities WHERE type = 'device' AND value = $1`,
      [deviceHash],
    );
    let userId = rows[0]?.user_id ?? null;
    let isNew = false;

    if (!userId && currentUserId) {
      userId = currentUserId;
      await client.query(
        `INSERT INTO identities (user_id, type, value, created_at) VALUES ($1, 'device', $2, $3)`,
        [userId, deviceHash, now],
      );
    } else if (!userId) {
      const created = await client.query<{ id: string }>(
        'INSERT INTO users (created_at) VALUES ($1) RETURNING id',
        [now],
      );
      userId = created.rows[0]!.id;
      isNew = true;
      await client.query(
        `INSERT INTO identities (user_id, type, value, created_at) VALUES ($1, 'device', $2, $3)`,
        [userId, deviceHash, now],
      );
    }

    if (currentUserId === userId) return { userId, isNew, sessionToken: null };

    const sessionToken = randomToken();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000);
    await client.query(
      'INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4)',
      [userId, sha256(sessionToken), expiresAt, now],
    );
    return { userId, isNew, sessionToken };
  });
}
