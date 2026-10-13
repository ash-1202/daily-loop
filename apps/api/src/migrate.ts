import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type pg from 'pg';
import { repoPath } from './paths';

const MIGRATIONS_DIR = repoPath('db/migrations');
const FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
// Any fixed number: makes concurrent runs (e.g. two deploys starting at once) wait for each other.
const ADVISORY_LOCK_ID = 727_001;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies every db/migrations/NNNN_name.sql file that has not been applied yet, in name order.
 * Each file runs in its own transaction and is recorded in schema_migrations with a checksum.
 * Editing a file after it was applied is an error: add a new migration instead.
 */
export async function migrate(pool: pg.Pool): Promise<MigrationResult> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name        text        PRIMARY KEY,
        checksum    text        NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const appliedChecksums = new Map(rows.map((r) => [r.name, r.checksum]));

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => FILE_PATTERN.test(f)).sort();
    const result: MigrationResult = { applied: [], skipped: [] };

    for (const file of files) {
      const sql = await readFile(`${MIGRATIONS_DIR}/${file}`, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = appliedChecksums.get(file);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `Migration ${file} was changed after it was applied. Add a new migration instead.`,
          );
        }
        result.skipped.push(file);
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          file,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
      result.applied.push(file);
    }

    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]).catch(() => {});
    client.release();
  }
}
