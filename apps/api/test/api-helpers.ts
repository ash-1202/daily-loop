import type pg from 'pg';
import type { SubmitResponse, TodayResponse } from '@daily-loop/shared';
import { buildApp } from '../src/app';
import { MemoryEmailSender } from '../src/email/sender';

/** Noon IST on Wednesday 14 Oct 2026. Tests move the clock from here. */
export const WEDNESDAY_NOON_IST = new Date('2026-10-14T06:30:00Z');

export type TestApp = ReturnType<typeof buildApp> & {
  /** Moves the fake clock. */
  setNow(date: Date): void;
  /** Emails the app "sent" (login codes). */
  emails: MemoryEmailSender;
};

export function createTestApp(pool: pg.Pool, start = WEDNESDAY_NOON_IST): TestApp {
  let now = start;
  const emails = new MemoryEmailSender();
  const app = buildApp({ pool, clock: () => now, email: emails }) as TestApp;
  app.setNow = (date) => {
    now = date;
  };
  app.emails = emails;
  return app;
}

/** Removes all users and challenges (and everything that hangs off them). Content stays. */
export async function resetGameData(pool: pg.Pool): Promise<void> {
  // TRUNCATE doesn't fire row triggers, so the append-only ledger can be cleared between tests.
  await pool.query(
    'TRUNCATE users, daily_challenges, otp_codes, job_runs, market_candles RESTART IDENTITY CASCADE',
  );
}

let deviceCounter = 0;

/** Starts a guest session and returns the cookie header to send with later requests. */
export async function signIn(app: TestApp, deviceToken?: string): Promise<string> {
  const token = deviceToken ?? `test-device-token-${++deviceCounter}-${'x'.repeat(24)}`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { deviceToken: token },
  });
  const cookie = res.cookies.find((c) => c.name === 'dl_session');
  if (!cookie) throw new Error(`No session cookie (status ${res.statusCode}): ${res.body}`);
  return `dl_session=${cookie.value}`;
}

export async function getToday(app: TestApp, cookie: string): Promise<TodayResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/today', headers: { cookie } });
  if (res.statusCode !== 200) throw new Error(`GET /api/today ${res.statusCode}: ${res.body}`);
  return res.json();
}

/** The correct answer and one wrong option, read straight from the database. */
export async function answersFor(pool: pg.Pool, taskId: string) {
  const { rows } = await pool.query<{ answer: string; options: string[] }>(
    'SELECT answer, options FROM tasks WHERE id = $1',
    [taskId],
  );
  const { answer, options } = rows[0]!;
  return { right: answer, wrong: options.find((o) => o !== answer)! };
}

let keyCounter = 0;

export function submit(
  app: TestApp,
  cookie: string,
  body: { challengeDate: string; taskId: string; answer: string; idempotencyKey?: string },
) {
  return app.inject({
    method: 'POST',
    url: '/api/submissions',
    headers: { cookie },
    payload: { idempotencyKey: `test-key-${++keyCounter}`, ...body },
  });
}

/** Answers every card of today's challenge; `correct` decides right or wrong per position. */
export async function playDay(
  app: TestApp,
  pool: pg.Pool,
  cookie: string,
  correct: (position: number) => boolean = () => true,
): Promise<SubmitResponse> {
  const today = await getToday(app, cookie);
  let last: SubmitResponse | undefined;
  for (const card of today.cards) {
    const { right, wrong } = await answersFor(pool, card.taskId);
    const res = await submit(app, cookie, {
      challengeDate: today.date,
      taskId: card.taskId,
      answer: correct(card.position) ? right : wrong,
    });
    if (res.statusCode !== 200) throw new Error(`submit ${res.statusCode}: ${res.body}`);
    last = res.json();
  }
  return last!;
}
