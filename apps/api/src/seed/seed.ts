import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import { z } from 'zod/mini';
import {
  badgesFileSchema,
  findDatasetProblems,
  scamsFileSchema,
  termsFileSchema,
  type BadgesFile,
  type ScamsFile,
  type TermsFile,
} from '@daily-loop/shared';
import { repoPath } from '../paths';

type DatasetFile = TermsFile | ScamsFile | BadgesFile;

/** Every dataset the seed loads, in load order. */
const DATASETS = [
  { id: 'terms', path: 'datasets/terms.json', schema: termsFileSchema },
  { id: 'scams', path: 'datasets/scams.json', schema: scamsFileSchema },
  { id: 'badges', path: 'datasets/badges.json', schema: badgesFileSchema },
] as const;

interface LoadedDataset {
  id: string;
  path: string;
  hash: string;
  file: DatasetFile;
}

/** A row for the tasks table. */
interface TaskRow {
  id: string;
  type: 'term' | 'scam';
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
  payload: Record<string, unknown>;
  difficulty: number;
}

/** Reads and validates one dataset file. Throws with every problem found, not just the first. */
export async function loadDataset(path: string, schema: z.ZodMiniType): Promise<LoadedDataset> {
  const raw = await readFile(repoPath(path), 'utf8');
  const hash = createHash('sha256').update(raw).digest('hex');

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${path}: not valid JSON (${(err as Error).message})`, { cause: err });
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`${path} does not match its schema:\n${z.prettifyError(parsed.error)}`);
  }
  const file = parsed.data as DatasetFile;

  const problems = findDatasetProblems(file);
  if (problems.length > 0) {
    throw new Error(`${path} has problems:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  return { id: file.dataset, path, hash, file };
}

/** Loads and validates every dataset. Nothing is written if any file is invalid. */
export async function loadAllDatasets(): Promise<LoadedDataset[]> {
  return Promise.all(DATASETS.map((d) => loadDataset(d.path, d.schema)));
}

function toTaskRows(file: TermsFile | ScamsFile): TaskRow[] {
  if (file.dataset === 'terms') {
    return file.items.map((item) => ({
      id: item.id,
      type: 'term',
      prompt: item.question,
      // Stored unshuffled; options are shuffled when a day's challenge is built.
      options: [item.answer, ...item.distractors],
      answer: item.answer,
      explanation: item.explanation,
      payload: { icon: item.icon },
      difficulty: item.difficulty,
    }));
  }
  return file.items.map((item) => ({
    id: item.id,
    type: 'scam',
    prompt: item.message,
    options: ['scam', 'safe'],
    answer: item.is_scam ? 'scam' : 'safe',
    explanation: item.explanation,
    payload: { red_flags: item.red_flags },
    difficulty: item.difficulty,
  }));
}

async function upsertTasks(client: pg.PoolClient, datasetId: string, rows: TaskRow[]) {
  let inserted = 0;
  for (const row of rows) {
    // (xmax = 0) is true when the row was inserted, false when an existing row was updated.
    const { rows: result } = await client.query<{ inserted: boolean }>(
      `INSERT INTO tasks (id, dataset_id, type, source, prompt, options, answer, explanation, payload, difficulty)
       VALUES ($1, $2, $3, 'dataset', $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET
         dataset_id = EXCLUDED.dataset_id, type = EXCLUDED.type, prompt = EXCLUDED.prompt,
         options = EXCLUDED.options, answer = EXCLUDED.answer, explanation = EXCLUDED.explanation,
         payload = EXCLUDED.payload, difficulty = EXCLUDED.difficulty,
         active = true, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [
        row.id,
        datasetId,
        row.type,
        row.prompt,
        JSON.stringify(row.options),
        row.answer,
        row.explanation,
        JSON.stringify(row.payload),
        row.difficulty,
      ],
    );
    if (result[0]?.inserted) inserted += 1;
  }

  // Items removed from the file are deactivated, never deleted: past submissions point to them.
  const { rowCount: deactivated } = await client.query(
    `UPDATE tasks SET active = false, updated_at = now()
     WHERE dataset_id = $1 AND active AND NOT (id = ANY($2::text[]))`,
    [datasetId, rows.map((r) => r.id)],
  );

  return { inserted, updated: rows.length - inserted, deactivated: deactivated ?? 0 };
}

async function upsertBadges(client: pg.PoolClient, file: BadgesFile) {
  for (const badge of file.items) {
    await client.query(
      `INSERT INTO badges (id, name, description, icon, rule, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description, icon = EXCLUDED.icon,
         rule = EXCLUDED.rule, sort_order = EXCLUDED.sort_order`,
      [
        badge.id,
        badge.name,
        badge.description,
        badge.icon,
        JSON.stringify(badge.rule),
        badge.sort_order,
      ],
    );
  }
}

/**
 * Validates every dataset file, then loads the changed ones into the database.
 * Safe to run any number of times: unchanged files (same sha256) are skipped, and each changed
 * file is applied in its own transaction. Returns one report line per dataset.
 */
export async function seed(pool: pg.Pool): Promise<string[]> {
  const datasets = await loadAllDatasets();
  const report: string[] = [];

  for (const { id, path, hash, file } of datasets) {
    const { rows } = await pool.query<{ content_hash: string }>(
      'SELECT content_hash FROM datasets WHERE id = $1',
      [id],
    );
    if (rows[0]?.content_hash === hash) {
      report.push(`${id}: unchanged (${file.items.length} items)`);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // The datasets row goes first: tasks reference it.
      await client.query(
        `INSERT INTO datasets (id, name, version, source, content_hash, item_count, loaded_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, version = EXCLUDED.version, source = EXCLUDED.source,
           content_hash = EXCLUDED.content_hash, item_count = EXCLUDED.item_count, loaded_at = now()`,
        [id, file.name, file.version, path, hash, file.items.length],
      );

      if (file.dataset === 'badges') {
        await upsertBadges(client, file);
        report.push(`${id}: loaded ${file.items.length} badges`);
      } else {
        const r = await upsertTasks(client, id, toTaskRows(file));
        report.push(
          `${id}: ${r.inserted} inserted, ${r.updated} updated, ${r.deactivated} deactivated`,
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Seeding ${id} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
  }

  return report;
}
