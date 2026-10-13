import { describe, expect, it } from 'vitest';
import {
  buildChartQuestion,
  CANDLE_OPTIONS,
  classifyCandle,
  classifyTrend,
  rescale,
  TREND_OPTIONS,
  WINDOW_DAYS,
  type Ohlc,
} from '../src/market/chart-rules';
import { kindForDate } from '../src/market/generator';
import { parseYahooChart, YahooProvider } from '../src/market/yahoo';
import { syntheticCandles } from './market-fixtures';

const closes = (values: number[]): Ohlc[] => values.map((c) => [c, c + 1, c - 1, c]);

describe('chart rules', () => {
  it('rescale makes the first close 100 and keeps proportions', () => {
    const ohlc = rescale(syntheticCandles(3, '2026-01-01', 2500));
    expect(ohlc[0]![3]).toBe(100);
    expect(ohlc[1]![3]).toBeCloseTo(100.8, 1); // +0.8% day
  });

  it('classifies trends, and refuses the ambiguous 2–5% band', () => {
    expect(classifyTrend(closes([100, 104, 106]))).toBe('up'); // +6%
    expect(classifyTrend(closes([100, 97, 94]))).toBe('down'); // -6%
    expect(classifyTrend(closes([100, 103, 101.5]))).toBe('sideways'); // +1.5%
    expect(classifyTrend(closes([100, 102, 103]))).toBeNull(); // +3%: not clear-cut
    expect(classifyTrend(closes([100, 98, 96.5]))).toBeNull(); // -3.5%
  });

  it('classifies the last candle, and refuses in-between candles', () => {
    expect(classifyCandle([100, 103, 97, 100.2])).toBe('doji'); // body 0.2 of range 6
    expect(classifyCandle([100, 104, 99, 103.5])).toBe('green'); // body 3.5 of 5
    expect(classifyCandle([103, 103.5, 99, 99.5])).toBe('red'); // body 3.5 of 4.5
    expect(classifyCandle([100, 104, 96, 101.5])).toBeNull(); // body 1.5 of 8: neither
    expect(classifyCandle([100, 100, 100, 100])).toBeNull(); // no range
  });

  it('builds a trend question whose answer matches the data and explanation', () => {
    const rising = syntheticCandles(WINDOW_DAYS); // first 20 days rise ~0.8%/day
    const q = buildChartQuestion(rising, 'trend')!;
    expect(q.answer).toBe(TREND_OPTIONS.up);
    expect(q.options).toContain(q.answer);
    expect(q.ohlc).toHaveLength(WINDOW_DAYS);
    expect(q.explanation).toMatch(/^It started at 100\.0 and ended at \d+\.\d, up \d+\.\d%/);
    expect(q.explanation).toContain('It is not a tip.');
    expect([q.from, q.to]).toEqual([rising[0]!.date, rising.at(-1)!.date]);
  });

  it('builds a last-candle question only when the last candle is clear-cut', () => {
    const all = syntheticCandles(40);
    // Day index 6 is a doji in the fixture: a window ending there asks about a doji.
    const endingOnDoji = all.slice(27 - WINDOW_DAYS + 1, 28); // index 27 = 6 + 3*7
    expect(buildChartQuestion(endingOnDoji, 'last_candle')!.answer).toBe(CANDLE_OPTIONS.doji);
    expect(buildChartQuestion(all.slice(0, 19), 'last_candle')).toBeNull(); // wrong length
  });

  it('alternates question kinds day by day', () => {
    expect(kindForDate('2026-10-14')).not.toBe(kindForDate('2026-10-15'));
    expect(kindForDate('2026-10-14')).toBe(kindForDate('2026-10-16'));
  });
});

describe('Yahoo Finance parsing', () => {
  const ts = (date: string) => Date.parse(`${date}T09:15:00+05:30`) / 1000; // market open, IST
  const response = (
    rows: Array<[string, number | null, number | null, number | null, number | null]>,
  ) => ({
    chart: {
      result: [
        {
          timestamp: rows.map((r) => ts(r[0])),
          indicators: {
            quote: [
              {
                open: rows.map((r) => r[1]),
                high: rows.map((r) => r[2]),
                low: rows.map((r) => r[3]),
                close: rows.map((r) => r[4]),
                volume: rows.map(() => 1000),
              },
            ],
          },
        },
      ],
    },
  });
  const now = new Date('2026-10-14T06:30:00Z'); // 12:00 IST, market open

  it('keeps finished, consistent days and dates them in IST', () => {
    const candles = parseYahooChart(
      response([
        ['2026-10-12', 100, 105, 99, 104],
        ['2026-10-13', 104, 106, 103, 105],
      ]),
      now,
    );
    expect(candles.map((c) => c.date)).toEqual(['2026-10-12', '2026-10-13']);
    expect(candles[1]).toMatchObject({ open: 104, high: 106, low: 103, close: 105, volume: 1000 });
  });

  it("drops today's unfinished candle, null rows and impossible candles", () => {
    const candles = parseYahooChart(
      response([
        ['2026-10-09', 100, 101, 99, null], // missing close
        ['2026-10-12', 100, 99, 98, 100.5], // high below close: impossible
        ['2026-10-13', 104, 106, 103, 105],
        ['2026-10-14', 105, 107, 104, 106], // today: still trading
      ]),
      now,
    );
    expect(candles.map((c) => c.date)).toEqual(['2026-10-13']);
  });

  it('rejects a response that is not a chart', () => {
    expect(() => parseYahooChart({ chart: { result: null, error: 'Not Found' } }, now)).toThrow();
  });

  it('requests the right URL (symbols like M&M are encoded) and reports HTTP errors', async () => {
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    await expect(new YahooProvider(fakeFetch).dailyCandles('M&M.NS', 6, now)).rejects.toThrow(
      'Yahoo M&M.NS: HTTP 404',
    );
    expect(urls[0]).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/M%26M.NS?range=6mo&interval=1d',
    );
  });
});
