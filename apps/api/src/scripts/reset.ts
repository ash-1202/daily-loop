// npm run db:reset  —  wipes the LOCAL database, then migrates and seeds it again.
import { config } from '../config';
import { pool } from '../db';
import { migrate } from '../migrate';
import { seed } from '../seed/seed';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const host = new URL(config.DATABASE_URL).hostname;

if (config.NODE_ENV === 'production' || !LOCAL_HOSTS.has(host)) {
  console.error(
    `Refusing to reset: db:reset only runs against a local database (host was "${host}").`,
  );
  process.exit(1);
}

try {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('Dropped and recreated schema "public".');
  const { applied } = await migrate(pool);
  console.log(`Applied ${applied.length} migrations.`);
  const report = await seed(pool);
  for (const line of report) console.log(`  ${line}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
