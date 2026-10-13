import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TodayResponse } from '@daily-loop/shared';
import { generateChallenges } from '../src/market/generator';
import { createTestApp, resetGameData, signIn, WEDNESDAY_NOON_IST } from './api-helpers';
import { FakeProvider, seededRandom } from './market-fixtures';
import { createTestPool } from './test-db';

const UNIVERSE = ['AAA.NS', 'BBB.NS', 'CCC.NS', 'DDD.NS', 'EEE.NS', 'FFF.NS'];
const NOW = WEDNESDAY_NOON_IST; // 2026-10-14
const WEEK = [
  '2026-10-14',
  '2026-10-15',
  '2026-10-16',
  '2026-10-17',
  '2026-10-18',
  '2026-10-19',
  '2026-10-20',
];

let pool: pg.Pool;
beforeAll(() => {
  pool = createTestPool();
});
afterAll(async () => {
  await resetGameData(pool);
  await pool.query("DELETE FROM tasks WHERE type = 'chart'");
  await pool.end();
});
beforeEach(async () => {
  await resetGameData(pool);
  await pool.query("DELETE FROM tasks WHERE type = 'chart'");
});

const run = (provider = new FakeProvider()) =>
  generateChallenges({ pool, provider, universe: UNIVERSE, now: NOW, random: seededRandom() });

describe('daily generation job', () => {
  it('creates a chart card and a challenge for each of the next 7 days', async () => {
    const report = await run();
    expect(report.chartsCreated).toEqual(WEEK.map((d) => `chart_${d}`));
    expect(report.challengesCreated).toEqual(WEEK);
    expect(report.errors).toEqual([]);

    // Each day's fifth card is that day's own chart.
    const { rows } = await pool.query<{ challenge_date: string; task_id: string }>(
      'SELECT challenge_date, task_id FROM daily_challenge_tasks WHERE position = 5 ORDER BY challenge_date',
    );
    expect(rows).toEqual(WEEK.map((d) => ({ challenge_date: d, task_id: `chart_${d}` })));

    const job = await pool.query('SELECT job, status FROM job_runs WHERE id = $1', [
      report.jobRunId,
    ]);
    expect(job.rows[0]).toEqual({ job: 'generate-challenges', status: 'succeeded' });
  });

  it('stores the raw candles it fetched, once per symbol', async () => {
    const provider = new FakeProvider();
    await run(provider);
    expect(new Set(provider.calls).size).toBe(provider.calls.length); // no symbol fetched twice
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n, min(provider) AS p FROM market_candles',
    );
    expect(rows[0]).toEqual({ n: provider.calls.length * 120, p: 'fake' });
  });

  it('is idempotent: a second run creates nothing', async () => {
    await run();
    const again = await run();
    expect(again.chartsCreated).toEqual([]);
    expect(again.challengesCreated).toEqual([]);
  });

  it('still builds every challenge when market data is down (chart slot falls back to a term)', async () => {
    const report = await run(new FakeProvider(true));
    expect(report.chartsCreated).toEqual([]);
    expect(report.challengesCreated).toEqual(WEEK);
    expect(report.errors.some((e) => e.includes('network down'))).toBe(true);
    const { rows } = await pool.query<{ type: string }>(
      `SELECT t.type FROM daily_challenge_tasks d JOIN tasks t ON t.id = d.task_id WHERE d.position = 5`,
    );
    expect(rows.every((r) => r.type === 'term')).toBe(true);
  });

  it('serves chart cards with candles only: no answer, stock name or dates before answering', async () => {
    await run();
    const app = createTestApp(pool);
    const cookie = await signIn(app);
    const res = await app.inject({ method: 'GET', url: '/api/today', headers: { cookie } });
    const today: TodayResponse = res.json();
    const chart = today.cards[4]!;

    expect(chart.type).toBe('chart');
    expect(chart.chart!.candles).toHaveLength(20);
    expect(chart.chart!.candles[0]![3]).toBe(100);
    expect(chart.result).toBeNull();
    const raw = JSON.stringify(chart);
    expect(raw).not.toMatch(/\.NS|meta|symbol|2026-0[4-9]|explanation/);
    await app.close();
  });
});
