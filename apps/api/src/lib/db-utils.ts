import pg from 'pg';

// Postgres DATE columns: return the plain 'YYYY-MM-DD' text instead of a JS Date. A JS Date would
// be midnight in the *server's* timezone, which shifts the day when the server isn't on IST.
// Game days are IST date strings everywhere in this codebase.
const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value) => value);

/** Something that can run queries: a pool, or a client checked out for a transaction. */
export type Db = pg.Pool | pg.PoolClient;

/** Returns true if the database answers a trivial query. */
export async function isDbUp(db: Db): Promise<boolean> {
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Runs `fn` in a transaction: COMMIT if it resolves, ROLLBACK if it throws. */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Serialises work on one key (e.g. one user) until the current transaction ends.
 * Two requests for the same key wait for each other; different keys run in parallel.
 */
export async function lockKey(client: pg.PoolClient, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
}
