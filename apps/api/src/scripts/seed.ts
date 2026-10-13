// npm run db:seed
import { pool } from '../db';
import { seed } from '../seed/seed';

try {
  const report = await seed(pool);
  for (const line of report) console.log(`  ${line}`);
  console.log('Seed complete.');
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
