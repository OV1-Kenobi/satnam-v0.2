-- =============================================================================
-- Satnam v2 — Initial Schema Migration
-- Migration: 001_v2_schema.sql
-- Date: 2026-04-04
-- Spec: SATNAM-V2-SPEC-001 § 11.1
--
-- SECURITY INVARIANTS:
--   S1: No encrypted_nsec, nsec, secret_key, or private_key column.
--       Key material is NEVER stored server-side. nsec lives in OPFS Vault only.
--
-- This schema serves exactly four purposes (Spec § 9.1):
--   1. NIP-05 name → npub mapping
--   2. Lightning address → LNURL routing
--   3. Per-IP and per-pubkey rate limiting for serverless functions
--   4. Short-lived username reservation during registration flow
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. NIP-05 name registry
--    Maps satnam.pub username to a Nostr hex pubkey.
--    Data classification: PUBLIC — served by nip05-resolver function.
--    No auth tokens, no key material.
-- =============================================================================
CREATE TABLE IF NOT EXISTS nip05_identifiers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username    TEXT        NOT NULL UNIQUE,
  pubkey      TEXT        NOT NULL,           -- hex-encoded Nostr pubkey (64 hex chars)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active   BOOLEAN     NOT NULL DEFAULT true
);

-- Constraint: pubkey must be a valid 64-character hex string
ALTER TABLE nip05_identifiers
  ADD CONSTRAINT nip05_pubkey_hex_format
  CHECK (pubkey ~ '^[0-9a-f]{64}$');

-- Constraint: username must be lowercase alphanumeric + hyphens, 2–64 chars
ALTER TABLE nip05_identifiers
  ADD CONSTRAINT nip05_username_format
  CHECK (username ~ '^[a-z0-9][a-z0-9\-]{1,63}$');

CREATE INDEX IF NOT EXISTS idx_nip05_pubkey
  ON nip05_identifiers (pubkey);

CREATE INDEX IF NOT EXISTS idx_nip05_username
  ON nip05_identifiers (username);

CREATE INDEX IF NOT EXISTS idx_nip05_active
  ON nip05_identifiers (is_active)
  WHERE is_active = true;

-- Auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER nip05_updated_at
  BEFORE UPDATE ON nip05_identifiers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 2. Lightning address routing
--    Maps username to LNURL-pay callback (NWC or self-hosted node).
--    Data classification: PUBLIC — served by lightning address resolution.
--    No payment credentials stored here — the lnurl_callback is the
--    public-facing callback URL, not a private NWC connection string.
-- =============================================================================
CREATE TABLE IF NOT EXISTS lightning_addresses (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username            TEXT        NOT NULL UNIQUE
                                  REFERENCES nip05_identifiers (username)
                                  ON UPDATE CASCADE
                                  ON DELETE CASCADE,
  lnurl_callback      TEXT        NOT NULL,   -- Public LNURL-pay callback URL
  min_sendable_msats  BIGINT      NOT NULL DEFAULT 1000,          -- 1 sat minimum
  max_sendable_msats  BIGINT      NOT NULL DEFAULT 100000000000,  -- 1,000,000 sats max
  metadata_json       TEXT        NOT NULL DEFAULT '[]',          -- LUD-06 metadata array
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Constraint: min ≤ max
ALTER TABLE lightning_addresses
  ADD CONSTRAINT la_sendable_range
  CHECK (min_sendable_msats > 0 AND max_sendable_msats >= min_sendable_msats);

-- Constraint: lnurl_callback must be an HTTPS URL
ALTER TABLE lightning_addresses
  ADD CONSTRAINT la_callback_https
  CHECK (lnurl_callback ~ '^https://');

CREATE INDEX IF NOT EXISTS idx_la_username
  ON lightning_addresses (username);

CREATE TRIGGER la_updated_at
  BEFORE UPDATE ON lightning_addresses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 3. Rate limiting
--    Per-identifier (IP address or pubkey) and per-endpoint sliding window.
--    Data classification: OPERATIONAL — not exposed publicly.
--    Window is typically 1 minute; request_count incremented on each request.
-- =============================================================================
CREATE TABLE IF NOT EXISTS rate_limits (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier     TEXT        NOT NULL,       -- IP address or hex pubkey
  endpoint       TEXT        NOT NULL,       -- Netlify function name, e.g. 'register-identity'
  window_start   TIMESTAMPTZ NOT NULL,       -- Start of the rate limit window
  request_count  INTEGER     NOT NULL DEFAULT 1,
  UNIQUE (identifier, endpoint, window_start)
);

-- Constraint: request_count must be positive
ALTER TABLE rate_limits
  ADD CONSTRAINT rl_count_positive
  CHECK (request_count > 0);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
  ON rate_limits (identifier, endpoint, window_start);

-- Index for cleanup of expired windows
CREATE INDEX IF NOT EXISTS idx_rate_limits_window
  ON rate_limits (window_start);

-- =============================================================================
-- 4. Username reservation
--    Short-lived lock during registration flow to prevent races.
--    Data classification: OPERATIONAL — expires after 15 minutes.
--    reserved_by_pubkey is the hex pubkey of the user claiming the username;
--    it is a public key (not a secret), used to prevent squatting.
-- =============================================================================
CREATE TABLE IF NOT EXISTS username_reservations (
  username            TEXT        PRIMARY KEY,
  reserved_by_pubkey  TEXT        NOT NULL,  -- hex-encoded Nostr pubkey of claimant
  reserved_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '15 minutes')
);

-- Constraint: pubkey must be a valid 64-character hex string
ALTER TABLE username_reservations
  ADD CONSTRAINT ur_pubkey_hex_format
  CHECK (reserved_by_pubkey ~ '^[0-9a-f]{64}$');

-- Constraint: expires_at must be after reserved_at
ALTER TABLE username_reservations
  ADD CONSTRAINT ur_expiry_after_reservation
  CHECK (expires_at > reserved_at);

-- Constraint: username format matches nip05_identifiers
ALTER TABLE username_reservations
  ADD CONSTRAINT ur_username_format
  CHECK (username ~ '^[a-z0-9][a-z0-9\-]{1,63}$');

CREATE INDEX IF NOT EXISTS idx_ur_pubkey
  ON username_reservations (reserved_by_pubkey);

CREATE INDEX IF NOT EXISTS idx_ur_expires
  ON username_reservations (expires_at);

-- =============================================================================
-- Row Level Security
--
-- All tables use RLS. The Netlify serverless functions authenticate via the
-- Supabase service_role key (stored as a Netlify env var). NIP-98 verification
-- happens inside the function BEFORE any Supabase query. There is no user-facing
-- JWT; the service_role claim is the trust boundary between Netlify and Supabase.
--
-- Public tables (nip05_identifiers, lightning_addresses):
--   - SELECT: allowed for all (anon key)
--   - INSERT/UPDATE/DELETE: service_role only
--
-- Operational tables (rate_limits, username_reservations):
--   - All operations: service_role only
-- =============================================================================

-- ── nip05_identifiers ────────────────────────────────────────────────────────
ALTER TABLE nip05_identifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY nip05_public_read
  ON nip05_identifiers
  FOR SELECT
  USING (true);

CREATE POLICY nip05_service_write
  ON nip05_identifiers
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

-- ── lightning_addresses ───────────────────────────────────────────────────────
ALTER TABLE lightning_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY la_public_read
  ON lightning_addresses
  FOR SELECT
  USING (true);

CREATE POLICY la_service_write
  ON lightning_addresses
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

-- ── rate_limits ───────────────────────────────────────────────────────────────
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY rl_service_only
  ON rate_limits
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

-- ── username_reservations ─────────────────────────────────────────────────────
ALTER TABLE username_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ur_service_only
  ON username_reservations
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

-- =============================================================================
-- Utility: Cleanup function for expired username reservations
-- Call this from a scheduled Netlify function or Supabase cron.
-- =============================================================================
CREATE OR REPLACE FUNCTION cleanup_expired_reservations()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM username_reservations WHERE expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- =============================================================================
-- Comments for documentation
-- =============================================================================
COMMENT ON TABLE nip05_identifiers IS
  'NIP-05 username → pubkey registry. Public data. No key material.';

COMMENT ON TABLE lightning_addresses IS
  'Lightning address routing table. Maps usernames to LNURL-pay callbacks.';

COMMENT ON TABLE rate_limits IS
  'Per-identifier, per-endpoint rate limiting for Netlify serverless functions.';

COMMENT ON TABLE username_reservations IS
  'Short-lived (15 min) username locks during the registration flow.';

COMMENT ON COLUMN nip05_identifiers.pubkey IS
  'Hex-encoded Nostr public key (64 lowercase hex chars). Never store nsec here.';

COMMIT;
