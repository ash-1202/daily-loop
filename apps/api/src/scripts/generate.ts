// npm run challenges:generate  —  builds chart cards and challenges for the next 7 days.
// In production: run by the server's cron every evening and by every deploy (see deploy/).
import { readFile } from 'node:fs/promises';
import { chartUniverseFileSchema } from '@daily-loop/shared';
import { pool } from '../db';
import { generateChallenges } from '../market/generator';
import { YahooProvider } from '../market/yahoo';
import { repoPath } from '../paths';

try {
  const universe = chartUniverseFileSchema.parse(
    JSON.parse(await readFile(repoPath('datasets/chart_universe.json'), 'utf8')),
  );
  const report = await generateChallenges({
    pool,
    provider: new YahooProvider(),
    universe: universe.items.map((i) => i.symbol),
    now: new Date(),
  });
  console.log(`job run #${report.jobRunId}`);
  console.log(`  chart cards created: ${report.chartsCreated.join(', ') || 'none needed'}`);
  console.log(`  challenges created:  ${report.challengesCreated.join(', ') || 'none needed'}`);
  for (const e of report.errors) console.log(`  warning: ${e}`);
} catch (err) {
  console.error(`Generation failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
