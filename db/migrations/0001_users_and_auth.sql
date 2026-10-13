-- Users and how they log in.
-- A person (users) is separate from the ways they can log in (identities), so phone login
-- can be added later as a new identity type without changing the schema.

CREATE TABLE users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text        CHECK (char_length(display_name) BETWEEN 1 AND 30),
  timezone      text        NOT NULL DEFAULT 'Asia/Kolkata', -- display and reminders only; game days use IST
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type         text        NOT NULL CHECK (type IN ('device', 'email', 'phone')),
  value        text        NOT NULL, -- device token hash, lower-cased email, or E.164 phone number
  verified_at  timestamptz,          -- null for device identities and unverified email/phone
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (type, value)
);
CREATE INDEX identities_user_id_idx ON identities (user_id);

-- One row per OTP sent. Only a hash of the code is stored.
CREATE TABLE otp_codes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_type  text        NOT NULL CHECK (identity_type IN ('email', 'phone')),
  value          text        NOT NULL,
  code_hash      text        NOT NULL,
  expires_at     timestamptz NOT NULL,
  attempts       smallint    NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Finds the latest code for an address and counts recent sends (rate limiting).
CREATE INDEX otp_codes_lookup_idx ON otp_codes (identity_type, value, created_at DESC);

-- Login sessions. The cookie holds a random token; only its hash is stored.
CREATE TABLE sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
