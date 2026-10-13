-- Gameplay: answers, points, streaks and badges.

-- One row per answered card.
CREATE TABLE submissions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  challenge_date   date        NOT NULL,
  task_id          text        NOT NULL,
  answer           text        NOT NULL,
  is_correct       boolean     NOT NULL,
  idempotency_key  text        NOT NULL UNIQUE, -- sent by the client; a retry with the same key is a no-op
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- The task must belong to that day's challenge.
  FOREIGN KEY (challenge_date, task_id) REFERENCES daily_challenge_tasks (challenge_date, task_id),
  -- One answer per card per day: no second tries for extra points.
  UNIQUE (user_id, challenge_date, task_id)
);
CREATE INDEX submissions_user_date_idx ON submissions (user_id, challenge_date);

-- The source of truth for points. A balance is SUM(delta). Rows are never changed or deleted.
CREATE TABLE points_ledger (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES users (id), -- no cascade: ledger rows are permanent
  delta       integer     NOT NULL CHECK (delta <> 0),
  reason      text        NOT NULL CHECK (reason IN ('correct_answer', 'daily_bonus', 'badge', 'adjustment')),
  ref_id      text        NOT NULL, -- what earned it, e.g. a submission id or '2026-10-14'
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- The same thing can never be rewarded twice, even if the code runs twice.
  UNIQUE (user_id, reason, ref_id)
);
CREATE INDEX points_ledger_user_created_idx ON points_ledger (user_id, created_at);

-- Enforce append-only in the database itself, not just in application code.
CREATE FUNCTION forbid_update_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER points_ledger_append_only
  BEFORE UPDATE OR DELETE ON points_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Current streak per user. Days are IST challenge dates.
CREATE TABLE streaks (
  user_id           uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  current           integer     NOT NULL DEFAULT 0 CHECK (current >= 0),
  longest           integer     NOT NULL DEFAULT 0 CHECK (longest >= current),
  last_active_date  date,
  freezes_left      smallint    NOT NULL DEFAULT 1 CHECK (freezes_left BETWEEN 0 AND 1),
  freeze_week       date, -- Monday (IST) of the week freezes_left applies to; refilled each new week
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Badge definitions are loaded from datasets/badges.json.
CREATE TABLE badges (
  id           text PRIMARY KEY, -- e.g. 'scam_spotter'
  name         text NOT NULL,
  description  text NOT NULL,
  icon         text NOT NULL,
  rule         jsonb NOT NULL, -- e.g. {"type": "correct_count", "task_type": "scam", "count": 10}
  sort_order   smallint NOT NULL DEFAULT 0
);

CREATE TABLE user_badges (
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  badge_id    text        NOT NULL REFERENCES badges (id),
  awarded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_id)
);
