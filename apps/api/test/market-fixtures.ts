import { addDays } from '@daily-loop/shared';
import type { Candle, MarketDataProvider } from '../src/market/provider';

/**
 * Synthetic daily candles (no real market data in the repo): repeating 20-day phases of
 * rising, flat and falling prices, with a doji every 7th day and strong bodies otherwise.
 */
export function syntheticCandles(
  days = 120,
  startDate = '2026-04-01',
  startPrice = 1000,
): Candle[] {
  const candles: Candle[] = [];
  let close = startPrice;
  for (let i = 0; i < days; i++) {
    const phase = Math.floor(i / 20) % 3; // 0 up, 1 flat, 2 down
    const drift = phase === 0 ? 0.008 : phase === 2 ? -0.008 : i % 2 ? 0.001 : -0.001;
    const open = close;
    close = Math.round(open * (1 + drift) * 100) / 100;
    if (i % 7 === 6) close = open; // doji: opens and closes at the same price
    const high = Math.max(open, close) + (i % 7 === 6 ? 5 : 1);
    const low = Math.min(open, close) - (i % 7 === 6 ? 5 : 1);
    candles.push({ date: addDays(startDate, i), open, high, low, close, volume: 100_000 + i });
  }
  return candles;
}

/** A provider that returns synthetic data, or fails, without touching the network. */
export class FakeProvider implements MarketDataProvider {
  readonly name = 'fake';
  calls: string[] = [];
  constructor(private readonly fail = false) {}

  async dailyCandles(symbol: string): Promise<Candle[]> {
    this.calls.push(symbol);
    if (this.fail) throw new Error('network down (simulated)');
    return syntheticCandles();
  }
}

/** A deterministic stand-in for Math.random. */
export function seededRandom(seed = 42): () => number {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}
