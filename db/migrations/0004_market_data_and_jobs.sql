-- Market data used to generate chart cards, and an audit log of background jobs.

-- Raw daily candles from the market data provider. Internal only: never sent to clients
-- (chart cards carry rescaled prices with the stock name removed).
CREATE TABLE market_candles (
  symbol      text          NOT NULL, -- e.g. 'RELIANCE.NS'
  date        date          NOT NULL,
  open        numeric(14, 4) NOT NULL CHECK (open > 0),
  high        numeric(14, 4) NOT NULL,
  low         numeric(14, 4) NOT NULL CHECK (low > 0),
  close       numeric(14, 4) NOT NULL CHECK (close > 0),
  volume      bigint        NOT NULL CHECK (volume >= 0),
  provider    text          NOT NULL, -- e.g. 'yahoo'
  fetched_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, date),
  CHECK (high >= greatest(open, close, low) AND low <= least(open, close))
);

-- One row per run of a background job (e.g. generating daily challenges).
CREATE TABLE job_runs (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job          text        NOT NULL,
  status       text        NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  details      jsonb       NOT NULL DEFAULT '{}'
);
CREATE INDEX job_runs_job_started_idx ON job_runs (job, started_at DESC);
