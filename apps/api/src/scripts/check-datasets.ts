// npm run datasets:check  —  validates every dataset file without touching the database.
import { loadAllDatasets } from '../seed/seed';

try {
  const datasets = await loadAllDatasets();
  for (const { path, file } of datasets) console.log(`  ok  ${path} (${file.items.length} items)`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
