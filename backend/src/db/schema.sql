-- ============================================================
-- STEP 1: Run this block FIRST (or skip if extensions already enabled via Supabase dashboard)
-- ============================================================
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================
-- STEP 2: Run everything below
-- ============================================================

-- Cities table
CREATE TABLE IF NOT EXISTS cities (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  country_code   TEXT NOT NULL,
  lat            FLOAT NOT NULL,
  lng            FLOAT NOT NULL,
  soft_capacity  INTEGER NOT NULL,
  boundary       JSONB,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              BYTEA UNIQUE NOT NULL,
  name               TEXT NOT NULL,
  birth_year         INTEGER NOT NULL,
  gender             TEXT CHECK (gender IN ('male', 'female', 'non-binary', 'other')),
  interested_in      TEXT[] NOT NULL,
  city_id            INTEGER REFERENCES cities(id),
  country_code       TEXT NOT NULL,
  is_active          BOOLEAN DEFAULT false,
  stripe_customer_id TEXT,
  email_verified     BOOLEAN DEFAULT false,
  verify_token       TEXT,
  likes_sent_today   INTEGER DEFAULT 0,
  likes_reset_at     TIMESTAMPTZ,
  likes_pending      INTEGER DEFAULT 0,
  lang               TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'es', 'pt')),
  created_at         TIMESTAMPTZ DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);

-- Pixels table
CREATE TABLE IF NOT EXISTS pixels (
  id            SERIAL PRIMARY KEY,
  user_id       UUID REFERENCES users(id),
  city_id       INTEGER REFERENCES cities(id),
  country_code  TEXT,
  type          TEXT CHECK (type IN ('person', 'event')) NOT NULL,
  lat           FLOAT NOT NULL,
  lng           FLOAT NOT NULL,
  color         TEXT NOT NULL,
  event_text    TEXT,
  event_date    DATE,
  is_dimmed     BOOLEAN DEFAULT false,
  is_active     BOOLEAN DEFAULT true,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Connections table
CREATE TABLE IF NOT EXISTS connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clicker_id       UUID REFERENCES users(id),
  clicked_id       UUID REFERENCES users(id),
  status           TEXT CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')) DEFAULT 'pending',
  clicker_accepted BOOLEAN DEFAULT false,
  clicked_accepted BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now(),
  expires_at       TIMESTAMPTZ DEFAULT now() + interval '24 hours',
  matched_at       TIMESTAMPTZ
);

-- Stripe payments table
CREATE TABLE IF NOT EXISTS stripe_payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id),
  stripe_session_id TEXT UNIQUE NOT NULL,
  pixel_id          INTEGER REFERENCES pixels(id),
  type              TEXT CHECK (type IN ('person_pixel', 'event_pixel')) NOT NULL,
  amount_cents      INTEGER NOT NULL,
  duration_days     INTEGER NOT NULL,
  currency          TEXT DEFAULT 'eur',
  status            TEXT CHECK (status IN ('pending', 'completed', 'failed')) DEFAULT 'pending',
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_pixels_city     ON pixels(city_id);
CREATE INDEX IF NOT EXISTS idx_pixels_user     ON pixels(user_id);
CREATE INDEX IF NOT EXISTS idx_pixels_active   ON pixels(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_pixels_expires  ON pixels(expires_at) WHERE is_active = true;
-- Defence-in-depth: a user can hold at most one active person pixel at a
-- time. The /place handler checks this in-transaction, but the index
-- closes any remaining race window.
CREATE UNIQUE INDEX IF NOT EXISTS pixels_user_one_active_person
  ON pixels(user_id) WHERE type = 'person' AND is_active = true;
CREATE INDEX IF NOT EXISTS idx_connections_clicker ON connections(clicker_id);
CREATE INDEX IF NOT EXISTS idx_connections_clicked ON connections(clicked_id);
CREATE INDEX IF NOT EXISTS idx_connections_status  ON connections(status);
CREATE INDEX IF NOT EXISTS idx_users_city          ON users(city_id);

-- Spatial index (requires PostGIS enabled via Supabase dashboard)
CREATE INDEX IF NOT EXISTS idx_pixels_geo ON pixels USING GIST((ST_MakePoint(lng, lat)::geography));

-- Country-based pixel index
CREATE INDEX IF NOT EXISTS idx_pixels_country ON pixels(country_code) WHERE is_active = true;

-- Hot lookup indexes
CREATE INDEX IF NOT EXISTS idx_users_verify_token  ON users(verify_token) WHERE verify_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stripe_payments_session ON stripe_payments(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_connections_pending_expires
  ON connections(expires_at) WHERE status = 'pending';

-- Stripe webhook idempotency: dedupe replays / retries by Stripe event id
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id    TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  received_at TIMESTAMPTZ DEFAULT now()
);

-- Event participation: who has RSVP'd to which event pixel. Idempotent
-- via the composite PK so a user can only count once per event.
CREATE TABLE IF NOT EXISTS event_participants (
  pixel_id   INTEGER NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
  user_id    UUID    NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pixel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_participants_pixel ON event_participants(pixel_id);
CREATE INDEX IF NOT EXISTS idx_event_participants_user  ON event_participants(user_id);

-- Migration: add country_code to pixels if missing (for existing DBs)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pixels' AND column_name = 'country_code') THEN
    ALTER TABLE pixels ADD COLUMN country_code TEXT;
  END IF;
END $$;

-- Backfill country_code from users table
UPDATE pixels SET country_code = u.country_code FROM users u WHERE pixels.user_id = u.id AND pixels.country_code IS NULL;

-- Migration: add event_date column to pixels if missing.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pixels' AND column_name = 'event_date') THEN
    ALTER TABLE pixels ADD COLUMN event_date DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pixels' AND column_name = 'event_description') THEN
    ALTER TABLE pixels ADD COLUMN event_description TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'lang') THEN
    ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'es', 'pt'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'login_token') THEN
    ALTER TABLE users ADD COLUMN login_token TEXT;
    ALTER TABLE users ADD COLUMN login_token_expires_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'email_lookup_hash') THEN
    -- Deterministic HMAC of the lowercased+trimmed email. Lets us look up
    -- by email without scanning the encrypted column. Nullable until the
    -- backfill script (backend/scripts/backfill-email-hash.ts) finishes;
    -- a later migration should set NOT NULL once no NULLs remain.
    ALTER TABLE users ADD COLUMN email_lookup_hash BYTEA;
    CREATE UNIQUE INDEX users_email_lookup_hash_uq ON users(email_lookup_hash) WHERE email_lookup_hash IS NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_login_token ON users(login_token) WHERE login_token IS NOT NULL;

-- Migration: switch from magic-link login to email+password.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'password_hash') THEN
    ALTER TABLE users ADD COLUMN password_hash TEXT;
  END IF;
END $$;

-- Migration: tighten lat/lng precision (FLOAT drifts on round-trips).
-- NUMERIC(9,6) gives ~11 cm accuracy, which is much smaller than our
-- 50 m proximity rule, and is stable across writes. Safe to re-run.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pixels' AND column_name = 'lat' AND data_type = 'double precision'
  ) THEN
    ALTER TABLE pixels ALTER COLUMN lat TYPE NUMERIC(9, 6) USING lat::numeric;
    ALTER TABLE pixels ALTER COLUMN lng TYPE NUMERIC(9, 6) USING lng::numeric;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cities' AND column_name = 'lat' AND data_type = 'double precision'
  ) THEN
    ALTER TABLE cities ALTER COLUMN lat TYPE NUMERIC(9, 6) USING lat::numeric;
    ALTER TABLE cities ALTER COLUMN lng TYPE NUMERIC(9, 6) USING lng::numeric;
  END IF;
END $$;

-- Migration: stripe_payments.stripe_session_id was NOT NULL but the new
-- /place flow inserts the row BEFORE creating the Stripe session, so we
-- need to allow NULL. Idempotent.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stripe_payments' AND column_name = 'stripe_session_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE stripe_payments ALTER COLUMN stripe_session_id DROP NOT NULL;
  END IF;
END $$;

-- Migration: enforce length limits on free-text columns (defence in depth
-- behind the Zod validation). Safe to re-run.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_name_len_chk') THEN
    ALTER TABLE users ADD CONSTRAINT users_name_len_chk CHECK (length(name) <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_country_code_len_chk') THEN
    ALTER TABLE users ADD CONSTRAINT users_country_code_len_chk CHECK (length(country_code) = 2);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pixels_event_text_len_chk') THEN
    ALTER TABLE pixels ADD CONSTRAINT pixels_event_text_len_chk CHECK (event_text IS NULL OR length(event_text) <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pixels_event_description_len_chk') THEN
    ALTER TABLE pixels ADD CONSTRAINT pixels_event_description_len_chk CHECK (event_description IS NULL OR length(event_description) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pixels_country_code_len_chk') THEN
    ALTER TABLE pixels ADD CONSTRAINT pixels_country_code_len_chk CHECK (country_code IS NULL OR length(country_code) = 2);
  END IF;
END $$;
