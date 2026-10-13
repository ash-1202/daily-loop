import pg from 'pg';
import { config } from '../src/config';
import { migrate } from '../src/migrate';
import { seed } from '../src/seed/seed';
import { testDatabaseUrl } from './test-db';

/** Creates the test database if needed, wipes it, then migrates and seeds it. Runs once per `vitest run`. */
export default async function setup() {
  const testUrl = new URL(testDatabaseUrl());
  const testDbName = testUrl.pathname.slice(1);

  const admin = new pg.Client({ connectionString: config.DATABASE_URL });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `Tests need Postgres. Start it with "npm run db:up". (${(err as Error).message})`,
      { cause: err },
    );
  }
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      testDbName,
    ]);
    if (!rowCount) await admin.query(`CREATE DATABASE "${testDbName}"`);
  } finally {
    await admin.end();
  }

  const pool = new pg.Pool({ connectionString: testUrl.toString() });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
    await seed(pool);
  } finally {
    await pool.end();
  }
}
