/** One trading day for one stock. `date` is the IST trading date 'YYYY-MM-DD'. */
export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Where daily prices come from. Everything else (rules, generator, storage) only knows this
 * interface, so Yahoo Finance can be replaced by a licensed feed without touching the rest.
 */
export interface MarketDataProvider {
  /** Short id stored with each candle, e.g. 'yahoo'. */
  readonly name: string;
  /**
   * Completed daily candles, oldest first, for roughly the last `months` months.
   * Must not include a candle for a trading day that hasn't finished.
   */
  dailyCandles(symbol: string, months: number, now: Date): Promise<Candle[]>;
}
