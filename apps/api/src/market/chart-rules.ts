import type { Candle } from './provider';

// Pure rules that turn a window of past candles into a question with ONE clearly correct answer.
// The answer is always computed from the candles the user sees, never from what happened next:
// this teaches reading a chart, not predicting prices.

export const WINDOW_DAYS = 20;

export type ChartKind = 'trend' | 'last_candle';
export type Ohlc = [open: number, high: number, low: number, close: number];

/** Rescales prices so the first close is 100 (hides the real price level) and rounds to 2 decimals. */
export function rescale(candles: Candle[]): Ohlc[] {
  const base = candles[0]!.close;
  const r = (v: number) => Math.round((v / base) * 10_000) / 100;
  return candles.map((c) => [r(c.open), r(c.high), r(c.low), r(c.close)]);
}

const pct = (from: number, to: number) => ((to - from) / from) * 100;
const fmt = (n: number) => n.toFixed(1);

export const TREND_OPTIONS = { up: 'Up 📈', down: 'Down 📉', sideways: 'Sideways ➡️' } as const;
export type Trend = keyof typeof TREND_OPTIONS;

/**
 * Up: rose more than 5% from first to last close. Down: fell more than 5%. Sideways: moved less
 * than 2%. Between 2% and 5% is ambiguous, so it returns null and the window isn't used.
 */
export function classifyTrend(ohlc: Ohlc[]): Trend | null {
  const change = pct(ohlc[0]![3], ohlc.at(-1)![3]);
  if (change > 5) return 'up';
  if (change < -5) return 'down';
  if (Math.abs(change) < 2) return 'sideways';
  return null;
}

export const CANDLE_OPTIONS = {
  green: 'Green: it closed higher than it opened',
  red: 'Red: it closed lower than it opened',
  doji: 'Doji: it opened and closed at almost the same price',
} as const;
export type CandleKind = keyof typeof CANDLE_OPTIONS;

/**
 * Doji: body at most 10% of the day's range. Green/red: body at least 50% of the range.
 * Anything in between is ambiguous and returns null.
 */
export function classifyCandle([open, high, low, close]: Ohlc): CandleKind | null {
  const range = high - low;
  if (range <= 0) return null;
  const body = Math.abs(close - open);
  if (body <= 0.1 * range) return 'doji';
  if (body >= 0.5 * range) return close > open ? 'green' : 'red';
  return null;
}

export interface ChartQuestion {
  kind: ChartKind;
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
  ohlc: Ohlc[];
  /** First and last trading dates of the window (kept server-side for auditing). */
  from: string;
  to: string;
}

const NOTE = 'This is past data from a real stock, with its name hidden. It is not a tip.';

/** Builds a question from a window of WINDOW_DAYS candles, or null if the answer isn't clear-cut. */
export function buildChartQuestion(window: Candle[], kind: ChartKind): ChartQuestion | null {
  if (window.length !== WINDOW_DAYS) return null;
  const ohlc = rescale(window);
  const dates = { from: window[0]!.date, to: window.at(-1)!.date };

  if (kind === 'trend') {
    const trend = classifyTrend(ohlc);
    if (!trend) return null;
    const start = ohlc[0]![3];
    const end = ohlc.at(-1)![3];
    const change = pct(start, end);
    const why = {
      up: `It started at ${fmt(start)} and ended at ${fmt(end)}, up ${fmt(change)}%. A rise of more than 5% over the period is an uptrend.`,
      down: `It started at ${fmt(start)} and ended at ${fmt(end)}, down ${fmt(Math.abs(change))}%. A fall of more than 5% over the period is a downtrend.`,
      sideways: `It started at ${fmt(start)} and ended at ${fmt(end)}, a change of only ${fmt(change)}%. When the price moves up and down but ends near where it began, the trend is sideways.`,
    }[trend];
    return {
      kind,
      prompt: `This chart shows ${WINDOW_DAYS} days of a stock's price. Over these days, the price went…`,
      options: Object.values(TREND_OPTIONS),
      answer: TREND_OPTIONS[trend],
      explanation: `${why} ${NOTE}`,
      ohlc,
      ...dates,
    };
  }

  const last = ohlc.at(-1)!;
  const candle = classifyCandle(last);
  if (!candle) return null;
  const [open, , , close] = last;
  const why = {
    green: `It opened at ${fmt(open)} and closed higher, at ${fmt(close)}. Buyers pushed the price up that day, so the candle is green.`,
    red: `It opened at ${fmt(open)} and closed lower, at ${fmt(close)}. Sellers pushed the price down that day, so the candle is red.`,
    doji: `It opened at ${fmt(open)} and closed at ${fmt(close)}, almost the same price, even though it moved during the day. This is a doji: buyers and sellers were balanced.`,
  }[candle];
  return {
    kind,
    prompt: 'Look at the last candle (highlighted). What kind of candle is it?',
    options: Object.values(CANDLE_OPTIONS),
    answer: CANDLE_OPTIONS[candle],
    explanation: `${why} ${NOTE}`,
    ohlc,
    ...dates,
  };
}

/**
 * Finds a usable window in a stock's history for the given kind, trying windows in the order given
 * by `startIndexes` (the caller shuffles them so different days get different windows).
 */
export function findQuestion(
  candles: Candle[],
  kind: ChartKind,
  startIndexes: number[],
): ChartQuestion | null {
  for (const start of startIndexes) {
    const q = buildChartQuestion(candles.slice(start, start + WINDOW_DAYS), kind);
    if (q) return q;
  }
  return null;
}
