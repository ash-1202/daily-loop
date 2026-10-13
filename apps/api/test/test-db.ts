import pg from 'pg';
import { expect } from 'vitest';
import { config } from '../src/config';

/** The test database lives next to the dev database, with a `_test` suffix. Dev data is never touched. */
export function testDatabaseUrl(): string {
  const url = new URL(config.DATABASE_URL);
  url.pathname = `${url.pathname.replace(/^\//, '')}_test`;
  return url.toString();
}

export function createTestPool(): pg.Pool {
  const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 4 });
  pool.on('error', () => {});
  return pool;
}

/** Runs `fn` inside a transaction that is always rolled back, so each test leaves no trace. */
export async function withRollback(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

/**
 * Expects a query to fail with a given Postgres error code (e.g. '23505' unique violation).
 * Uses a savepoint so the surrounding transaction stays usable after the error.
 */
export async function expectPgError(
  client: pg.PoolClient,
  sql: string,
  params: unknown[],
  code: string,
): Promise<void> {
  await client.query('SAVEPOINT expect_error');
  await expect(client.query(sql, params)).rejects.toMatchObject({ code });
  await client.query('ROLLBACK TO SAVEPOINT expect_error');
}
