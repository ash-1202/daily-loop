import type pg from 'pg';
import { addDays, DAYS_AHEAD, daysBetween, istDate } from '@daily-loop/shared';
import { withTransaction } from '../lib/db-utils';
import { ensureChallenge } from '../services/challenges';
import { findQuestion, WINDOW_DAYS, type ChartKind, type ChartQuestion } from './chart-rules';
import type { Candle, MarketDataProvider } from './provider';

const JOB = 'generate-challenges';
const HISTORY_MONTHS = 6;
const MAX_SYMBOLS_PER_CARD = 5;

export interface GenerateOptions {
  pool: pg.Pool;
  provider: MarketDataProvider;
  universe: string[];
  now: Date;
  /** Injected so tests are repeatable. */
  random?: () => number;
}

export interface GenerateReport {
  jobRunId: number;
  chartsCreated: string[];
  challengesCreated: string[];
  errors: string[];
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Alternate question kinds by date, so consecutive days don't ask the same thing. */
export function kindForDate(date: string): ChartKind {
  return daysBetween('2026-01-01', date) % 2 === 0 ? 'trend' : 'last_candle';
}

async function storeCandles(
  pool: pg.Pool,
  provider: string,
  symbol: string,
  candles: Candle[],
  now: Date,
) {
  if (candles.length === 0) return;
  await pool.query(
    `INSERT INTO market_candles (symbol, date, open, high, low, close, volume, provider, fetched_at)
     SELECT $1, d, o, h, l, c, v, $8, $9
     FROM unnest($2::date[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::bigint[])
       AS t(d, o, h, l, c, v)
     ON CONFLICT (symbol, date) DO UPDATE SET
       open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low, close = EXCLUDED.close,
       volume = EXCLUDED.volume, provider = EXCLUDED.provider, fetched_at = EXCLUDED.fetched_at`,
    [
      symbol,
      candles.map((c) => c.date),
      candles.map((c) => c.open),
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      candles.map((c) => c.close),
      candles.map((c) => c.volume),
      provider,
      now,
    ],
  );
}

async function insertChartTask(
  pool: pg.Pool,
  id: string,
  q: ChartQuestion,
  meta: object,
  now: Date,
) {
  await pool.query(
    `INSERT INTO tasks (id, dataset_id, type, source, prompt, options, answer, explanation, payload,
                        difficulty, created_at, updated_at)
     VALUES ($1, NULL, 'chart', 'generated', $2, $3, $4, $5, $6, $7, $8, $8)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      q.prompt,
      JSON.stringify(q.options),
      q.answer,
      q.explanation,
      // `meta` (which stock, which dates) is for auditing only; toCard never sends it to clients.
      JSON.stringify({ kind: q.kind, ohlc: q.ohlc, meta }),
      q.kind === 'trend' ? 1 : 2,
      now,
    ],
  );
}

/**
 * The daily job. For each of the next DAYS_AHEAD days that has no challenge yet:
 *   1. create a chart card from real past prices (stock name hidden, prices rescaled),
 *   2. build the day's challenge (2 terms, 2 scams, 1 chart).
 * A market-data failure for one day is recorded and skipped; the challenge is still built (the chart
 * slot reuses an older chart, or falls back to a term). Safe to run any number of times.
 */
export async function generateChallenges(opts: GenerateOptions): Promise<GenerateReport> {
  const { pool, provider, universe, now } = opts;
  const random = opts.random ?? Math.random;
  const today = istDate(now);
  const dates = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));

  const run = await pool.query<{ id: number }>(
    `INSERT INTO job_runs (job, status, started_at) VALUES ($1, 'running', $2) RETURNING id`,
    [JOB, now],
  );
  const jobRunId = Number(run.rows[0]!.id);
  const report: GenerateReport = { jobRunId, chartsCreated: [], challengesCreated: [], errors: [] };

  try {
    const { rows: built } = await pool.query<{ date: string }>(
      'SELECT date FROM daily_challenges WHERE date = ANY($1::date[])',
      [dates],
    );
    const builtDates = new Set(built.map((r) => r.date));
    const { rows: charts } = await pool.query<{ id: string }>(
      'SELECT id FROM tasks WHERE id = ANY($1::text[])',
      [dates.map((d) => `chart_${d}`)],
    );
    const chartIds = new Set(charts.map((r) => r.id));
    const history = new Map<string, Candle[]>(); // one fetch per symbol per run

    // 1. Chart cards for days not built yet.
    for (const date of dates) {
      const id = `chart_${date}`;
      if (builtDates.has(date) || chartIds.has(id)) continue;
      const kind = kindForDate(date);
      let created = false;

      for (const symbol of shuffled(universe, random).slice(0, MAX_SYMBOLS_PER_CARD)) {
        try {
          let candles = history.get(symbol);
          if (!candles) {
            candles = await provider.dailyCandles(symbol, HISTORY_MONTHS, now);
            history.set(symbol, candles);
            await storeCandles(pool, provider.name, symbol, candles, now);
          }
          const starts = shuffled(
            Array.from({ length: Math.max(0, candles.length - WINDOW_DAYS + 1) }, (_, i) => i),
            random,
          );
          const q = findQuestion(candles, kind, starts);
          if (!q) continue;
          const meta = { symbol, provider: provider.name, from: q.from, to: q.to };
          await insertChartTask(pool, id, q, meta, now);
          report.chartsCreated.push(id);
          created = true;
          break;
        } catch (err) {
          report.errors.push(`${date} ${symbol}: ${(err as Error).message}`);
        }
      }
      if (!created) report.errors.push(`${date}: no chart card created`);
    }

    // 2. The challenges themselves.
    for (const date of dates) {
      if (builtDates.has(date)) continue;
      await withTransaction(pool, (client) => ensureChallenge(client, date));
      report.challengesCreated.push(date);
    }

    await pool.query(
      `UPDATE job_runs SET status = 'succeeded', finished_at = $2, details = $3 WHERE id = $1`,
      [jobRunId, new Date(), JSON.stringify(report)],
    );
    return report;
  } catch (err) {
    report.errors.push((err as Error).message);
    await pool.query(
      `UPDATE job_runs SET status = 'failed', finished_at = $2, details = $3 WHERE id = $1`,
      [jobRunId, new Date(), JSON.stringify(report)],
    );
    throw err;
  }
}
