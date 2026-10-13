import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LeaderboardResponse, MeResponse, SubmitResponse } from '@daily-loop/shared';
import { createTestPool } from './test-db';
import {
  answersFor,
  createTestApp,
  getToday,
  playDay,
  resetGameData,
  signIn,
  submit,
  WEDNESDAY_NOON_IST,
  type TestApp,
} from './api-helpers';

let pool: pg.Pool;
let app: TestApp;

beforeAll(() => {
  pool = createTestPool();
});
afterAll(async () => {
  await resetGameData(pool); // leave the shared test database empty for other test files
  await pool.end();
});
beforeEach(async () => {
  await resetGameData(pool);
  app = createTestApp(pool);
});

const at = (iso: string) => new Date(iso);

describe('sessions', () => {
  it('reject game requests without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/today' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'not_signed_in', message: 'Start a session first.' },
    });
  });

  it('create a guest once per device and set an httpOnly cookie', async () => {
    const deviceToken = 'same-device-token-0123456789abcdefghij';
    const first = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { deviceToken },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().isNew).toBe(true);
    const cookie = first.cookies.find((c) => c.name === 'dl_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');

    const again = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { deviceToken },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ user: first.json().user, isNew: false });
  });

  it('keep progress when the device token is lost but the cookie is still valid', async () => {
    const cookie = await signIn(app, 'original-device-token-0123456789abcdef');
    const res = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { cookie },
      payload: { deviceToken: 'replacement-device-token-0123456789abc' },
    });
    expect(res.json().isNew).toBe(false);
    const { rows } = await pool.query(
      "SELECT count(DISTINCT user_id)::int AS n FROM identities WHERE type = 'device'",
    );
    expect(rows[0].n).toBe(1);
  });

  it('reject a malformed device token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { deviceToken: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_request');
  });

  it('ignore a forged or unknown cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: 'dl_session=forged' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/today', () => {
  it('returns 5 cards in the daily mix, without answers', async () => {
    const cookie = await signIn(app);
    const today = await getToday(app, cookie);

    expect(today.date).toBe('2026-10-14');
    expect(today.cards.map((c) => c.type)).toEqual(['term', 'scam', 'term', 'scam', 'term']); // no charts yet
    expect(today.progress).toEqual({ answered: 0, correct: 0, total: 5 });
    for (const card of today.cards) {
      expect(card.result).toBeNull();
      expect(JSON.stringify(card)).not.toMatch(/explanation|correctAnswer|red_?[fF]lags/);
    }
  });

  it('gives every user the same cards in the same order', async () => {
    const a = await getToday(app, await signIn(app));
    const b = await getToday(app, await signIn(app));
    expect(b.cards.map((c) => [c.taskId, c.options])).toEqual(
      a.cards.map((c) => [c.taskId, c.options]),
    );
  });

  it('builds the challenge only once, even for simultaneous first requests', async () => {
    const cookies = await Promise.all([signIn(app), signIn(app), signIn(app), signIn(app)]);
    const days = await Promise.all(cookies.map((c) => getToday(app, c)));
    const ids = days.map((d) => d.cards.map((c) => c.taskId).join());
    expect(new Set(ids).size).toBe(1);
  });

  it('rotates cards: no card repeats within a week', async () => {
    const cookie = await signIn(app);
    const seen: string[] = [];
    for (let day = 0; day < 7; day++) {
      app.setNow(new Date(WEDNESDAY_NOON_IST.getTime() + day * 86_400_000));
      seen.push(...(await getToday(app, cookie)).cards.map((c) => c.taskId));
    }
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('POST /api/submissions', () => {
  it('awards points, the daily bonus, the streak and the first badge for a full day', async () => {
    const cookie = await signIn(app);
    const last = await playDay(app, pool, cookie, (position) => position !== 3); // card 3 wrong

    expect(last.completed).toBe(true);
    expect(last.progress).toEqual({ answered: 5, correct: 4, total: 5 });
    expect(last.rewards).toEqual([
      { delta: 10, reason: 'correct_answer' },
      { delta: 5, reason: 'daily_bonus' },
    ]);
    expect(last.totalPoints).toBe(45);
    expect(last.streak).toMatchObject({ current: 1, completedToday: true });
    expect(last.newBadges.map((b) => b.id)).toEqual(['first_step']);
  });

  it('reveals the answer and explanation only after answering', async () => {
    const cookie = await signIn(app);
    const today = await getToday(app, cookie);
    const scam = today.cards.find((c) => c.type === 'scam')!;
    const { wrong, right } = await answersFor(pool, scam.taskId);

    const res = await submit(app, cookie, {
      challengeDate: today.date,
      taskId: scam.taskId,
      answer: wrong,
    });
    const body: SubmitResponse = res.json();
    expect(body.card.result).toMatchObject({
      answer: wrong,
      isCorrect: false,
      correctAnswer: right,
    });
    expect(body.card.result!.explanation.length).toBeGreaterThan(0);
    expect(body.rewards).toEqual([]);
    if (right === 'scam') expect(body.card.result!.redFlags.length).toBeGreaterThan(0);
  });

  it('treats a retry with the same idempotency key as a no-op', async () => {
    const cookie = await signIn(app);
    const today = await getToday(app, cookie);
    const card = today.cards[0]!;
    const { right } = await answersFor(pool, card.taskId);
    const body = {
      challengeDate: today.date,
      taskId: card.taskId,
      answer: right,
      idempotencyKey: 'retry-key-1',
    };

    const first: SubmitResponse = (await submit(app, cookie, body)).json();
    const retry: SubmitResponse = (await submit(app, cookie, body)).json();
    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.rewards).toEqual([]);
    expect(retry.totalPoints).toBe(10);
  });

  it('rejects a second answer to the same card', async () => {
    const cookie = await signIn(app);
    const today = await getToday(app, cookie);
    const card = today.cards[0]!;
    const { right, wrong } = await answersFor(pool, card.taskId);
    await submit(app, cookie, { challengeDate: today.date, taskId: card.taskId, answer: wrong });

    const second = await submit(app, cookie, {
      challengeDate: today.date,
      taskId: card.taskId,
      answer: right,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('already_answered');
  });

  it('rejects an idempotency key reused for a different card', async () => {
    const cookie = await signIn(app);
    const today = await getToday(app, cookie);
    const [a, b] = today.cards;
    await submit(app, cookie, {
      challengeDate: today.date,
      taskId: a!.taskId,
      answer: (await answersFor(pool, a!.taskId)).right,
      idempotencyKey: 'shared-key-1',
    });
    const res = await submit(app, cookie, {
      challengeDate: today.date,
      taskId: b!.taskId,
      answer: (await answersFor(pool, b!.taskId)).right,
      idempotencyKey: 'shared-key-1',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('idempotency_key_reused');
  });

  it('rejects answers that are not one of the options', async () => {
    const cookie = await signIn(app);
    const today = await getToday(app, cookie);
    const res = await submit(app, cookie, {
      challengeDate: today.date,
      taskId: today.cards[0]!.taskId,
      answer: 'Made up answer',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_answer');
  });

  it('rejects a card that is not in that day’s challenge', async () => {
    const cookie = await signIn(app);
    const today = await getToday(app, cookie);
    const notToday = (
      await pool.query<{ id: string }>(
        `SELECT id FROM tasks WHERE type = 'term' AND NOT (id = ANY($1)) LIMIT 1`,
        [today.cards.map((c) => c.taskId)],
      )
    ).rows[0]!.id;
    const { right } = await answersFor(pool, notToday);
    const res = await submit(app, cookie, {
      challengeDate: today.date,
      taskId: notToday,
      answer: right,
    });
    expect(res.statusCode).toBe(404);
  });

  it('closes yesterday’s challenge 15 minutes after midnight IST', async () => {
    const cookie = await signIn(app);
    const today = await getToday(app, cookie);
    const card = today.cards[0]!;
    const { right } = await answersFor(pool, card.taskId);

    app.setNow(at('2026-10-14T18:40:00Z')); // 00:10 IST on the 15th: still open
    const late = await submit(app, cookie, {
      challengeDate: today.date,
      taskId: card.taskId,
      answer: right,
    });
    expect(late.statusCode).toBe(200);

    app.setNow(at('2026-10-14T18:50:00Z')); // 00:20 IST: closed
    const tooLate = await submit(app, cookie, {
      challengeDate: today.date,
      taskId: today.cards[1]!.taskId,
      answer: (await answersFor(pool, today.cards[1]!.taskId)).right,
    });
    expect(tooLate.statusCode).toBe(400);
    expect(tooLate.json().error.code).toBe('challenge_closed');
  });

  it('rejects answers for a future day', async () => {
    const cookie = await signIn(app);
    const today = await getToday(app, cookie);
    const res = await submit(app, cookie, {
      challengeDate: '2026-10-15',
      taskId: today.cards[0]!.taskId,
      answer: 'x',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('challenge_closed');
  });
});

describe('concurrency', () => {
  it('answering all 5 cards at the same moment pays the daily bonus exactly once', async () => {
    const cookie = await signIn(app);
    const today = await getToday(app, cookie);
    const responses = await Promise.all(
      today.cards.map(async (card) =>
        submit(app, cookie, {
          challengeDate: today.date,
          taskId: card.taskId,
          answer: (await answersFor(pool, card.taskId)).right,
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);

    const { rows } = await pool.query<{ reason: string; n: number; total: number }>(
      'SELECT reason, count(*)::int AS n, sum(delta)::int AS total FROM points_ledger GROUP BY reason ORDER BY reason',
    );
    expect(rows).toEqual([
      { reason: 'correct_answer', n: 5, total: 50 },
      { reason: 'daily_bonus', n: 1, total: 5 },
    ]);
    const streak = await pool.query('SELECT current FROM streaks');
    expect(streak.rows).toEqual([{ current: 1 }]);
  });

  it('a double-tapped answer (same key, sent twice at once) is recorded once', async () => {
    const cookie = await signIn(app);
    const today = await getToday(app, cookie);
    const card = today.cards[0]!;
    const body = {
      challengeDate: today.date,
      taskId: card.taskId,
      answer: (await answersFor(pool, card.taskId)).right,
      idempotencyKey: 'double-tap-1',
    };

    const [a, b] = await Promise.all([submit(app, cookie, body), submit(app, cookie, body)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect([a.json().replayed, b.json().replayed].sort()).toEqual([false, true]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM submissions');
    expect(rows[0].n).toBe(1);
  });
});

describe('streaks across days', () => {
  it('grow day by day, survive one missed day with the freeze, and show 0 after that', async () => {
    const cookie = await signIn(app);
    const day = (d: number) => new Date(WEDNESDAY_NOON_IST.getTime() + d * 86_400_000);
    const me = async (): Promise<MeResponse> =>
      (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).json();

    await playDay(app, pool, cookie); // Wed
    app.setNow(day(1));
    expect((await playDay(app, pool, cookie)).streak.current).toBe(2); // Thu
    app.setNow(day(3)); // missed Fri, play Sat: the freeze saves it
    expect((await me()).streak).toMatchObject({ current: 2, atRisk: true });
    const sat = await playDay(app, pool, cookie);
    expect(sat.streak).toMatchObject({ current: 3, freezesLeft: 0 });

    app.setNow(day(5)); // Mon: missed Sun, but a new week brings a new freeze
    expect((await me()).streak).toMatchObject({ current: 3, atRisk: true, freezesLeft: 1 });

    app.setNow(day(6)); // Tue: missed Sun and Mon, the streak is gone
    expect((await me()).streak).toMatchObject({ current: 0, longest: 3 });
  });
});

describe('me and leaderboard', () => {
  it('set a display name, with validation', async () => {
    const cookie = await signIn(app);
    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: { cookie },
      payload: { displayName: '  Asha K  ' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.displayName).toBe('Asha K');

    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: { cookie },
      payload: { displayName: '<script>' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('ranks this week’s points, shows a fallback name, and starts fresh on Monday', async () => {
    const alice = await signIn(app);
    const bob = await signIn(app);
    await app.inject({
      method: 'PATCH',
      url: '/api/me',
      headers: { cookie: alice },
      payload: { displayName: 'Alice' },
    });
    await playDay(app, pool, alice); // 55 points
    await playDay(app, pool, bob, (p) => p <= 2); // 2 correct + bonus = 25 points

    const board: LeaderboardResponse = (
      await app.inject({ method: 'GET', url: '/api/leaderboard', headers: { cookie: bob } })
    ).json();
    expect(board.weekStart).toBe('2026-10-12');
    expect(board.entries.map((e) => [e.rank, e.points, e.isMe])).toEqual([
      [1, 55, false],
      [2, 25, true],
    ]);
    expect(board.entries[0]!.displayName).toBe('Alice');
    expect(board.entries[1]!.displayName).toMatch(/^Player [0-9A-F]{4}$/);
    expect(board.me).toEqual({ rank: 2, points: 25 });

    app.setNow(at('2026-10-18T18:30:00Z')); // Monday 00:00 IST
    const next: LeaderboardResponse = (
      await app.inject({ method: 'GET', url: '/api/leaderboard', headers: { cookie: bob } })
    ).json();
    expect(next.weekStart).toBe('2026-10-19');
    expect(next.entries).toEqual([]);
    expect(next.me).toEqual({ rank: null, points: 0 });
  });
});
