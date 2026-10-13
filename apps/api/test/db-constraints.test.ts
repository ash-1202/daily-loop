import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/migrate';
import { seed } from '../src/seed/seed';
import { resetGameData } from './api-helpers';
import { createTestPool, expectPgError, withRollback } from './test-db';

// Postgres error codes used below.
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';
const RAISE_EXCEPTION = 'P0001';

let pool: pg.Pool;
beforeAll(async () => {
  pool = createTestPool();
  await resetGameData(pool); // start from no users or challenges, whatever ran before
});
afterAll(async () => {
  await pool.end();
});

async function createUser(client: pg.PoolClient): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'INSERT INTO users DEFAULT VALUES RETURNING id',
  );
  return rows[0]!.id;
}

/** A challenge day with 5 seeded cards: 2 terms, 2 scams and 1 more term (no chart cards yet). */
async function createChallenge(client: pg.PoolClient, date: string): Promise<string[]> {
  const taskIds = ['term_0001', 'term_0002', 'scam_0001', 'scam_0021', 'term_0003'];
  await client.query('INSERT INTO daily_challenges (date) VALUES ($1)', [date]);
  for (const [i, taskId] of taskIds.entries()) {
    await client.query(
      'INSERT INTO daily_challenge_tasks (challenge_date, position, task_id) VALUES ($1, $2, $3)',
      [date, i + 1, taskId],
    );
  }
  return taskIds;
}

const insertSubmission = `
  INSERT INTO submissions (user_id, challenge_date, task_id, answer, is_correct, idempotency_key)
  VALUES ($1, $2, $3, $4, $5, $6)`;

describe('migrations and seed', () => {
  it('are idempotent: running them again changes nothing', async () => {
    const { applied } = await migrate(pool);
    expect(applied).toEqual([]);
    const report = await seed(pool);
    expect(report.every((line) => line.includes('unchanged'))).toBe(true);
  });

  it('loaded the seeded content', async () => {
    const { rows } = await pool.query<{ type: string; n: number }>(
      'SELECT type, count(*)::int AS n FROM tasks WHERE active GROUP BY type ORDER BY type',
    );
    expect(rows).toEqual([
      { type: 'scam', n: 30 },
      { type: 'term', n: 30 },
    ]);
  });
});

describe('points ledger', () => {
  it('is append-only: rows cannot be updated or deleted', () =>
    withRollback(pool, async (client) => {
      const userId = await createUser(client);
      await client.query(
        `INSERT INTO points_ledger (user_id, delta, reason, ref_id) VALUES ($1, 10, 'correct_answer', 'sub-1')`,
        [userId],
      );
      await expectPgError(
        client,
        'UPDATE points_ledger SET delta = 1000 WHERE user_id = $1',
        [userId],
        RAISE_EXCEPTION,
      );
      await expectPgError(
        client,
        'DELETE FROM points_ledger WHERE user_id = $1',
        [userId],
        RAISE_EXCEPTION,
      );
    }));

  it('never rewards the same thing twice', () =>
    withRollback(pool, async (client) => {
      const userId = await createUser(client);
      const sql = `INSERT INTO points_ledger (user_id, delta, reason, ref_id) VALUES ($1, 10, 'correct_answer', 'sub-1')`;
      await client.query(sql, [userId]);
      await expectPgError(client, sql, [userId], UNIQUE_VIOLATION);
    }));

  it('rejects zero-point rows', () =>
    withRollback(pool, async (client) => {
      const userId = await createUser(client);
      await expectPgError(
        client,
        `INSERT INTO points_ledger (user_id, delta, reason, ref_id) VALUES ($1, 0, 'adjustment', 'x')`,
        [userId],
        CHECK_VIOLATION,
      );
    }));
});

describe('submissions', () => {
  it('allow one answer per card per day', () =>
    withRollback(pool, async (client) => {
      const userId = await createUser(client);
      const [taskId] = await createChallenge(client, '2026-10-14');
      await client.query(insertSubmission, [userId, '2026-10-14', taskId, 'a', true, 'key-1']);
      await expectPgError(
        client,
        insertSubmission,
        [userId, '2026-10-14', taskId, 'b', false, 'key-2'],
        UNIQUE_VIOLATION,
      );
    }));

  it('reject a retry with the same idempotency key', () =>
    withRollback(pool, async (client) => {
      const userId = await createUser(client);
      const [first, second] = await createChallenge(client, '2026-10-14');
      await client.query(insertSubmission, [userId, '2026-10-14', first, 'a', true, 'key-1']);
      await expectPgError(
        client,
        insertSubmission,
        [userId, '2026-10-14', second, 'a', true, 'key-1'],
        UNIQUE_VIOLATION,
      );
    }));

  it('only accept cards that belong to that day', () =>
    withRollback(pool, async (client) => {
      const userId = await createUser(client);
      await createChallenge(client, '2026-10-14');
      await expectPgError(
        client,
        insertSubmission,
        [userId, '2026-10-14', 'term_0030', 'a', true, 'key-1'],
        FOREIGN_KEY_VIOLATION,
      );
    }));
});

describe('tasks and challenges', () => {
  it('reject a task whose answer is not one of its options', () =>
    withRollback(pool, async (client) => {
      await expectPgError(
        client,
        `INSERT INTO tasks (id, type, source, prompt, options, answer, explanation)
         VALUES ('chart_test', 'chart', 'generated', 'Trend?', '["Up","Down"]', 'Sideways', 'x')`,
        [],
        CHECK_VIOLATION,
      );
    }));

  it('reject the same card twice in one day', () =>
    withRollback(pool, async (client) => {
      await createChallenge(client, '2026-10-14');
      await expectPgError(
        client,
        'INSERT INTO daily_challenge_tasks (challenge_date, position, task_id) VALUES ($1, 5, $2)',
        ['2026-10-14', 'term_0001'],
        UNIQUE_VIOLATION,
      );
    }));

  it('reject a sixth card', () =>
    withRollback(pool, async (client) => {
      await createChallenge(client, '2026-10-14');
      await expectPgError(
        client,
        'INSERT INTO daily_challenge_tasks (challenge_date, position, task_id) VALUES ($1, 6, $2)',
        ['2026-10-14', 'term_0010'],
        CHECK_VIOLATION,
      );
    }));
});
