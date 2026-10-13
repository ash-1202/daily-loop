import { istDate } from '@daily-loop/shared';
import { z } from 'zod';
import type { Candle, MarketDataProvider } from './provider';

/**
 * Yahoo Finance's public chart endpoint. It has no official API or SLA and its terms limit
 * commercial use: fine for this learning app (prices are rescaled and stock names hidden), but a
 * production product should use a licensed feed behind the same MarketDataProvider interface.
 */
const BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

const num = z.number().nullable();
const responseSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          timestamp: z.array(z.number()),
          indicators: z.object({
            quote: z
              .array(
                z.object({
                  open: z.array(num),
                  high: z.array(num),
                  low: z.array(num),
                  close: z.array(num),
                  volume: z.array(num),
                }),
              )
              .min(1),
          }),
        }),
      )
      .min(1),
  }),
});

/** True if the numbers can form a real candle (Yahoo occasionally returns odd rows). */
function isConsistent(c: Omit<Candle, 'date'>): boolean {
  return (
    c.open > 0 &&
    c.low > 0 &&
    c.close > 0 &&
    c.high >= Math.max(c.open, c.close, c.low) &&
    c.low <= Math.min(c.open, c.close) &&
    c.volume >= 0
  );
}

/** Converts Yahoo's column arrays into candles, dropping incomplete, inconsistent or unfinished days. */
export function parseYahooChart(json: unknown, now: Date): Candle[] {
  const result = responseSchema.parse(json).chart.result[0]!;
  const q = result.indicators.quote[0]!;
  const today = istDate(now);

  const candles: Candle[] = [];
  result.timestamp.forEach((ts, i) => {
    const [open, high, low, close, volume] = [
      q.open[i],
      q.high[i],
      q.low[i],
      q.close[i],
      q.volume[i],
    ];
    if (open == null || high == null || low == null || close == null || volume == null) return;
    const date = istDate(new Date(ts * 1000));
    // Today's candle may still be changing during market hours: only use finished days.
    if (date >= today) return;
    const candle = { date, open, high, low, close, volume: Math.round(volume) };
    if (isConsistent(candle)) candles.push(candle);
  });
  return candles;
}

export class YahooProvider implements MarketDataProvider {
  readonly name = 'yahoo';

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async dailyCandles(symbol: string, months: number, now: Date): Promise<Candle[]> {
    const url = `${BASE_URL}/${encodeURIComponent(symbol)}?range=${months}mo&interval=1d`;
    const res = await this.fetchFn(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (daily-loop learning app)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
    return parseYahooChart(await res.json(), now);
  }
}
