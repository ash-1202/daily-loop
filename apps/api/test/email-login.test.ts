import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MeResponse, OtpVerifyResponse } from '@daily-loop/shared';
import { buildApp } from '../src/app';
import { hashCode, OTP_RULES } from '../src/services/email-login';
import {
  createTestApp,
  playDay,
  resetGameData,
  signIn,
  WEDNESDAY_NOON_IST,
  type TestApp,
} from './api-helpers';
import { createTestPool } from './test-db';

let pool: pg.Pool;
let app: TestApp;

beforeAll(() => {
  pool = createTestPool();
});
afterAll(async () => {
  await resetGameData(pool);
  await pool.end();
});
beforeEach(async () => {
  await resetGameData(pool);
  app = createTestApp(pool);
});

const later = (minutes: number) => new Date(WEDNESDAY_NOON_IST.getTime() + minutes * 60_000);

function requestCode(cookie: string, email: string, ip = '203.0.113.7') {
  return app.inject({
    method: 'POST',
    url: '/api/auth/otp/request',
    headers: { cookie },
    remoteAddress: ip,
    payload: { email },
  });
}

function verify(cookie: string, email: string, code: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/otp/verify',
    headers: { cookie },
    payload: { email, code },
  });
}

/** The code from the last email sent to `email`. */
function lastCode(email: string): string {
  const mail = [...app.emails.sent].reverse().find((m) => m.to === email);
  return mail!.subject.match(/^(\d{6}) /)![1]!;
}

const me = async (cookie: string): Promise<MeResponse> =>
  (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();

describe('requesting a code', () => {
  it('emails a 6-digit code, with the email normalised and a safety warning', async () => {
    const cookie = await signIn(app);
    const res = await requestCode(cookie, '  Asha@Example.COM ');
    expect(res.statusCode).toBe(202);
    expect(app.emails.sent).toHaveLength(1);
    const mail = app.emails.sent[0]!;
    expect(mail.to).toBe('asha@example.com');
    expect(mail.subject).toMatch(/^\d{6} is your Market Daily 5 code$/);
    expect(mail.text).toContain('We will never call or message you to ask for this code');
  });

  it('stores only a keyed hash of the code, never the code itself', async () => {
    const cookie = await signIn(app);
    await requestCode(cookie, 'asha@example.com');
    const code = lastCode('asha@example.com');
    const { rows } = await pool.query('SELECT code_hash FROM otp_codes');
    expect(rows[0].code_hash).not.toContain(code);
    expect(rows[0].code_hash).toBe(
      hashCode('development-only-otp-secret-not-for-production', 'asha@example.com', code),
    );
  });

  it('answers the same for new and existing emails (no account discovery)', async () => {
    const owner = await signIn(app);
    await requestCode(owner, 'owner@example.com');
    await verify(owner, 'owner@example.com', lastCode('owner@example.com'));

    const stranger = await signIn(app);
    const known = await requestCode(stranger, 'owner@example.com', '198.51.100.1');
    const unknown = await requestCode(stranger, 'nobody@example.com', '198.51.100.1');
    expect([known.statusCode, known.body]).toEqual([unknown.statusCode, unknown.body]);
  });

  it(`allows ${OTP_RULES.perEmail.max} codes per email per ${OTP_RULES.perEmail.windowMinutes} minutes`, async () => {
    const cookie = await signIn(app);
    for (let i = 0; i < OTP_RULES.perEmail.max; i++) {
      expect((await requestCode(cookie, 'asha@example.com')).statusCode).toBe(202);
    }
    const blocked = await requestCode(cookie, 'asha@example.com');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('too_many_requests');

    app.setNow(later(OTP_RULES.perEmail.windowMinutes + 1));
    expect((await requestCode(cookie, 'asha@example.com')).statusCode).toBe(202);
  });

  it(`allows ${OTP_RULES.perIp.max} codes per IP per hour, across different emails`, async () => {
    const cookie = await signIn(app);
    for (let i = 0; i < OTP_RULES.perIp.max; i++) {
      expect((await requestCode(cookie, `user${i}@example.com`, '192.0.2.50')).statusCode).toBe(
        202,
      );
    }
    expect((await requestCode(cookie, 'one-more@example.com', '192.0.2.50')).statusCode).toBe(429);
    expect((await requestCode(cookie, 'one-more@example.com', '192.0.2.51')).statusCode).toBe(202);
  });

  it('rejects an invalid email and requires a session', async () => {
    const cookie = await signIn(app);
    expect((await requestCode(cookie, 'not-an-email')).statusCode).toBe(400);
    expect((await requestCode('dl_session=nope', 'asha@example.com')).statusCode).toBe(401);
  });
});

describe('verifying a code', () => {
  it('saves the guest’s progress to the email', async () => {
    const cookie = await signIn(app);
    await playDay(app, pool, cookie);
    await requestCode(cookie, 'asha@example.com');

    const res = await verify(cookie, 'asha@example.com', lastCode('asha@example.com'));
    const body: OtpVerifyResponse = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.switchedAccount).toBe(false);
    expect(body.user.email).toBe('asha@example.com');

    const after = await me(cookie);
    expect(after.user.email).toBe('asha@example.com');
    expect(after.points).toBe(55); // progress kept
  });

  it('works only once', async () => {
    const cookie = await signIn(app);
    await requestCode(cookie, 'asha@example.com');
    const code = lastCode('asha@example.com');
    expect((await verify(cookie, 'asha@example.com', code)).statusCode).toBe(200);
    const again = await verify(cookie, 'asha@example.com', code);
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('code_expired');
  });

  it(`expires after ${OTP_RULES.ttlMinutes} minutes`, async () => {
    const cookie = await signIn(app);
    await requestCode(cookie, 'asha@example.com');
    app.setNow(later(OTP_RULES.ttlMinutes + 1));
    const res = await verify(cookie, 'asha@example.com', lastCode('asha@example.com'));
    expect(res.json().error.code).toBe('code_expired');
  });

  it(`locks the code after ${OTP_RULES.maxAttempts} wrong tries, even if the right code comes next`, async () => {
    const cookie = await signIn(app);
    await requestCode(cookie, 'asha@example.com');
    const code = lastCode('asha@example.com');
    const wrong = code === '000000' ? '111111' : '000000';

    const first = await verify(cookie, 'asha@example.com', wrong);
    expect(first.json().error).toEqual({
      code: 'wrong_code',
      message: 'Wrong code. 4 tries left.',
    });
    for (let i = 1; i < OTP_RULES.maxAttempts; i++) await verify(cookie, 'asha@example.com', wrong);

    const right = await verify(cookie, 'asha@example.com', code);
    expect(right.statusCode).toBe(429);
    expect(right.json().error.code).toBe('too_many_attempts');
  });

  it('only accepts the newest code', async () => {
    const cookie = await signIn(app);
    await requestCode(cookie, 'asha@example.com');
    const older = lastCode('asha@example.com');
    await requestCode(cookie, 'asha@example.com');
    const newer = lastCode('asha@example.com');
    if (older !== newer) {
      expect((await verify(cookie, 'asha@example.com', older)).statusCode).toBe(400);
    }
    expect((await verify(cookie, 'asha@example.com', newer)).statusCode).toBe(200);
  });

  it('on a new phone, signs in to the existing account (guest progress is not merged)', async () => {
    // Phone 1: plays, saves progress.
    const phone1 = await signIn(app, 'phone-one-device-token-0123456789abcdef');
    await playDay(app, pool, phone1);
    await requestCode(phone1, 'asha@example.com');
    await verify(phone1, 'asha@example.com', lastCode('asha@example.com'));
    const account = (await me(phone1)).user.id;

    // Phone 2: a new guest verifies the same email.
    const phone2 = await signIn(app, 'phone-two-device-token-0123456789abcdef');
    await requestCode(phone2, 'asha@example.com', '198.51.100.9');
    const res = await verify(phone2, 'asha@example.com', lastCode('asha@example.com'));
    expect(res.json()).toMatchObject({ switchedAccount: true, user: { id: account } });

    // The response sets a new cookie for the saved account; the old guest cookie stops working.
    const newCookie = `dl_session=${res.cookies.find((c) => c.name === 'dl_session')!.value}`;
    expect((await me(newCookie)).points).toBe(55);
    expect(
      (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: phone2 } })).statusCode,
    ).toBe(401);

    // Next time phone 2 opens the app, its device token restores the saved account.
    const reopened = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { deviceToken: 'phone-two-device-token-0123456789abcdef' },
    });
    expect(reopened.json().user.id).toBe(account);
  });
});

describe('logging out', () => {
  it('ends the session and clears the cookie', async () => {
    const cookie = await signIn(app);
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((c) => c.name === 'dl_session')?.value).toBe('');
    expect(
      (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode,
    ).toBe(401);
  });
});

describe('when email isn’t configured', () => {
  it('reports the feature as off and refuses requests', async () => {
    const off = buildApp({ pool, clock: () => WEDNESDAY_NOON_IST, email: null }) as TestApp;
    const cookie = await signIn(off);
    const meRes: MeResponse = (
      await off.inject({ method: 'GET', url: '/api/me', headers: { cookie } })
    ).json();
    expect(meRes.features.emailLogin).toBe(false);

    const res = await off.inject({
      method: 'POST',
      url: '/api/auth/otp/request',
      headers: { cookie },
      payload: { email: 'asha@example.com' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('email_unavailable');
    await off.close();
  });
});

describe('Resend sender', () => {
  it('posts the email with the API key, and reports failures without leaking it', async () => {
    const { ResendEmailSender } = await import('../src/email/sender');
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"id":"x"}', { status: 200 });
    }) as unknown as typeof fetch;
    await new ResendEmailSender('re_test_key_123', 'App <a@mail.example.com>', ok).send({
      to: 'asha@example.com',
      subject: '123456 is your code',
      text: 'hi',
    });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      'Bearer re_test_key_123',
    );
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: 'App <a@mail.example.com>',
      to: ['asha@example.com'],
      subject: '123456 is your code',
      text: 'hi',
    });

    const failing = (async () =>
      new Response('{"message":"domain not verified"}', {
        status: 403,
      })) as unknown as typeof fetch;
    const err = await new ResendEmailSender('re_test_key_123', 'a@b.c', failing)
      .send({ to: 'x@example.com', subject: 's', text: 't' })
      .catch((e: Error) => e);
    expect(String(err)).toContain('Resend: HTTP 403');
    expect(String(err)).not.toContain('re_test_key_123');
  });
});
