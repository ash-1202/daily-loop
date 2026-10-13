// npm run db:migrate
import { pool } from '../db';
import { migrate } from '../migrate';

try {
  const { applied, skipped } = await migrate(pool);
  for (const name of applied) console.log(`  applied  ${name}`);
  console.log(
    applied.length
      ? `Done: ${applied.length} applied, ${skipped.length} already up to date.`
      : `Nothing to do: all ${skipped.length} migrations already applied.`,
  );
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
