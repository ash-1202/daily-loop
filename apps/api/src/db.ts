import pg from 'pg';
import { config } from './config';

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
});

// An idle connection can be closed by the server (restart, or a hosted DB such as Neon
// dropping idle clients). Without this listener the 'error' event crashes the process.
// The pool discards the broken client and opens a new one on the next query.
pool.on('error', (err) => {
  console.warn(`Postgres idle client error (client discarded): ${err.message}`);
});

/** Returns true if the database answers a trivial query. */
export async function isDbUp(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
