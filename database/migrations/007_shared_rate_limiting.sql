-- =============================================================================
-- Satnam v2 — Shared Cross-Instance Rate Limiting (A-2 / founder W2-5 override)
-- Migration: 007_shared_rate_limiting.sql
-- Date: 2026-08-25
--
-- Provides the atomic counter behind netlify/functions/_lib/rate-limit.ts.
-- The increment_rate_limit RPC makes consume() ONE round trip with no
-- read-modify-write race between concurrent lambda instances.
--
-- SECURITY:
--   S1: counters hold ONLY (identifier=client IP string, endpoint label,
--       window timestamp, integer count) — no request content, no keys.
--   RLS: enabled, no policies — service_role (Netlify functions) only,
--        same posture as nip98_seen_events (005).
--
-- OUTAGE POSTURE: limiter store unavailability is FAIL-OPEN in application
-- code (defense-in-depth control; per-instance maps remain active). This is
-- a DELIBERATE contrast to the replay-dedupe split policy — see
-- _lib/rate-limit.ts docblock before changing either.
--
-- DEPLOYMENT: applied OUT-OF-BAND by the founder. Missing table/RPC =>
-- adapter reports 'error' => requests admitted under fail-open + alerting;
-- safe to deploy before or after the code, though enforcement begins only
-- once this migration is applied.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  identifier   TEXT        NOT NULL,
  endpoint     TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hit_count    INTEGER     NOT NULL DEFAULT 0
                               CHECK (hit_count >= 0),
  PRIMARY KEY (identifier, endpoint, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rlc_window_start ON rate_limit_counters(window_start);

ALTER TABLE rate_limit_counters ENABLE ROW LEVEL SECURITY;

-- Atomic consume: insert-or-increment, returning the new count in one
-- statement. p_limit is applied by the CALLER (adapter compares count <= limit)
-- so the function stays policy-free and reusable across endpoints.
CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_identifier  text,
  p_endpoint    text,
  p_window_start timestamptz,
  p_limit       integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_identifier IS NULL OR length(trim(p_identifier)) = 0 THEN
    RAISE EXCEPTION 'identifier required';
  END IF;
  INSERT INTO rate_limit_counters(identifier, endpoint, window_start, hit_count)
  VALUES (p_identifier, p_endpoint, p_window_start, 1)
  ON CONFLICT (identifier, endpoint, window_start)
  DO UPDATE SET hit_count = rate_limit_counters.hit_count + 1
  RETURNING hit_count INTO v_count;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION increment_rate_limit(text, text, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON TABLE rate_limit_counters FROM anon, authenticated;

COMMENT ON TABLE rate_limit_counters IS
  'Shared cross-instance rate-limit counters (A-2). Identifier is the '
  || 'client IP string; fixed windows; consumed via increment_rate_limit '
  || 'RPC. Fail-open in app layer on store outage (see _lib/rate-limit.ts).';

COMMIT;
