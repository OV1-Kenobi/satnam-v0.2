-- =============================================================================
-- Satnam v2 — NIP-98 Replay Dedupe Store (H-2 fix)
-- Migration: 005_nip98_seen_events.sql
-- Date: 2026-08-25
-- Context: Founder-directed security repair wave, round 2 (WP4 / H-2 High).
--          verifyNip98 checks signature/URL/method/timestamp-window only, so a
--          captured Authorization header replays for ~60s (±60s window) across
--          all five authed Netlify functions. This table provides a shared,
--          multi-instance-safe seen-nonce store keyed on the auth EVENT ID.
--
-- SECURITY INVARIANTS:
--   S1: No key material here. Rows hold ONLY the auth event id — a 64-char
--       hex SHA-256-like digest that is already public-by-construction to the
--       server. It is a PSEUDONYMOUS identifier: it can be linked to a pubkey
--       only by the party that saw both.
--   RLS: enabled with NO policies — anon/authenticated roles are denied;
--        only the service_role key used by the Netlify functions can read/
--        write (service_role bypasses RLS).
--
-- RETENTION / TTL:
--   The verify window is ±60s. TTL is set by application code
--   (netlify/functions/_lib/nip98-replay.ts → NIP98_REPLAY_TTL_MS = 300_000,
--   i.e. 5 minutes ≥ 120s worst-case replay span plus realistic clock-skew
--   margin). Cleanup deletes rows older than the TTL opportunistically; a
--   scheduled job may also run:
--     DELETE FROM nip98_seen_events WHERE inserted_at < now() - interval '5 minutes';
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS nip98_seen_events (
  event_id    TEXT        PRIMARY KEY CHECK (event_id ~ '^[0-9a-f]{64}$'),
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TTL cleanup scans by insertion time.
CREATE INDEX IF NOT EXISTS idx_nip98_seen_events_inserted_at
  ON nip98_seen_events(inserted_at);

-- Lock down to service role: enable RLS and create no policies, so
-- anon/authenticated roles can neither read nor write this table.
ALTER TABLE nip98_seen_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE nip98_seen_events IS
  'NIP-98 replay dedupe (H-2): one row per consumed auth event id. '
  'Pseudonymous identifiers only; retention ~5 minutes via application TTL '
  'cleanup. Service-role access only (RLS enabled, no policies).';

COMMIT;
