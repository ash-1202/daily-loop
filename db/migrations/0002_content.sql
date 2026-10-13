-- Content: where tasks come from (datasets), the tasks themselves, and each day's challenge.

-- One row per dataset file in datasets/. content_hash lets the seed skip unchanged files.
CREATE TABLE datasets (
  id            text        PRIMARY KEY, -- e.g. 'terms', 'scams'
  name          text        NOT NULL,
  version       integer     NOT NULL CHECK (version > 0),
  source        text        NOT NULL, -- file path, e.g. 'datasets/terms.json'
  content_hash  text        NOT NULL, -- sha256 of the file
  item_count    integer     NOT NULL CHECK (item_count >= 0),
  loaded_at     timestamptz NOT NULL DEFAULT now()
);

-- Every card a user can be shown. Hand-written cards come from datasets; chart cards are generated.
CREATE TABLE tasks (
  id           text        PRIMARY KEY, -- stable id, e.g. 'term_0001', 'scam_0001', 'chart_2026-10-14'
  dataset_id   text        REFERENCES datasets (id), -- null for generated tasks
  type         text        NOT NULL CHECK (type IN ('term', 'scam', 'chart')),
  source       text        NOT NULL CHECK (source IN ('dataset', 'generated')),
  prompt       text        NOT NULL,
  options      jsonb       NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) >= 2),
  answer       text        NOT NULL, -- never sent to the client before the user answers
  explanation  text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '{}', -- type-specific extras: icon, red_flags, ohlc, ...
  difficulty   smallint    NOT NULL DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 3),
  language     text        NOT NULL DEFAULT 'en',
  active       boolean     NOT NULL DEFAULT true, -- removed from a dataset = inactive, never deleted
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- The correct answer must be one of the options.
  CHECK (options ? answer),
  -- Dataset tasks name their dataset; generated tasks do not.
  CHECK ((source = 'dataset') = (dataset_id IS NOT NULL))
);
-- Picking cards for a day: active tasks of one type.
CREATE INDEX tasks_type_active_idx ON tasks (type) WHERE active;

-- One row per game day (IST). Pre-generated a few days ahead.
CREATE TABLE daily_challenges (
  date              date          PRIMARY KEY,
  bonus_multiplier  numeric(3, 2) NOT NULL DEFAULT 1.00 CHECK (bonus_multiplier BETWEEN 1 AND 5),
  generated_at      timestamptz   NOT NULL DEFAULT now()
);

-- The 5 cards of a day, in order. A join table (instead of a task_ids[] array) lets Postgres
-- enforce that every task exists and that a task appears at most once per day.
CREATE TABLE daily_challenge_tasks (
  challenge_date  date     NOT NULL REFERENCES daily_challenges (date) ON DELETE CASCADE,
  position        smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
  task_id         text     NOT NULL REFERENCES tasks (id),
  PRIMARY KEY (challenge_date, position),
  UNIQUE (challenge_date, task_id)
);
-- "Was this task shown recently?" when picking cards for a new day.
CREATE INDEX daily_challenge_tasks_task_idx ON daily_challenge_tasks (task_id, challenge_date);
