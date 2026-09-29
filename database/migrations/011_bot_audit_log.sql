-- =============================================================================
-- DRAFT FOR REVIEW ONLY — DO NOT APPLY — DO NOT PROMOTE WITHOUT FOUNDER GATE
-- Migration draft: 011_bot_audit_log.sql
-- Plan: 28-plan-n424-mfa-lnbits-removal, WP MIG-010
-- Owner: Repository Steward (draft) — promotion to database/migrations is a
--        separate, founder-gated step on the satnam tree.
-- Date drafted: 2026-09-29
-- Depends on: 010_bot_identity_and_delegation.sql
--             (sign_event_audit.delegation_id -> delegated_authority(id))
--
-- REQUIREMENT AUTHORITY:
--   planning/2026/09-september/28-plan-n424-mfa-lnbits-removal/
--     bot-mother-hermes-interop-spec.md — "Hermes checks that delegation on
--     every sign-event call across actor, event kind, purpose, and tenant, and
--     logs the check to audit_log."  This table is the Satnam-side record of
--     that decision.
--
-- CONVENTION SOURCES READ (read-only via pinned `git show`, no checkout):
--   ae314df: 001, 002, 005, 006, 007   |   a3110d4: 008, 009
--   (ae314df contains only 001-007; see the discrepancy note in 010 and in
--    wp-mig-review.md. Numbering next = 011.)
--
-- CONVENTIONS MATCHED (001-009):
--   forward-only BEGIN/COMMIT; CREATE TABLE IF NOT EXISTS; snake_case plural
--   table names; idx_<abbrev>_<col> index names; named CHECK constraints;
--   RLS policy named <abbrev>_service_only using
--   current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role';
--   COMMENT ON; NO down-migration section.
--
-- DELIBERATE DEPARTURES FROM 001-009 CONVENTION (both flagged in
-- wp-mig-review.md; kept per founder-ratified resolution 2026-09-29):
--   1. PRIMARY KEY is bigserial, not uuid DEFAULT gen_random_uuid() as in
--      001/002. An audit log is append-ordered: the monotonic integer is the
--      insertion order and gives a narrow, cheap composite index. The founder's
--      column list for this table specifies bigserial.
--   2. delegation_id uses ON DELETE SET NULL, not ON DELETE CASCADE. The audit
--      row is the evidence that a delegation check happened; cascading the
--      delegation's deletion into the audit trail would erase that evidence.
--      group_id keeps ON DELETE CASCADE per convention.
--
-- SECURITY INVARIANTS:
--   S1: No nsec / secret_key / private_key / encrypted_nsec column here. No key
--       material. This table records DECISIONS about signing, never the means
--       of signing.
--   S6: No cmacHex / piccDataHex. Neither column nor any NFC field appears.
--   No NIP-44 / NIP-04 message payload, no ciphertext, and no DM content is
--       stored: only the decision metadata named in the column list below.
--
-- TENANT KEY: group_id is OUR canonical tenant key (FK groups(id) ON DELETE
--   CASCADE). tenant_scope exists only as a denormalized echo of the Hermes-side
--   vocabulary for parity in the log line; it is NOT authoritative and nothing
--   in this schema keys, joins, or authorizes on it. group_id is the only
--   tenant key that may be used for authorization.
--
-- RELAYS: no relay host is referenced by this table. relay.livingry.services /
--   livingry.services is NOT ours and MUST NOT appear here. The Hermes nprofile
--   artifact is NOT used and NOT referenced.
--
-- APPEND-ONLY INTENT: this table is written by the sign-event decision path and
--   is never updated or deleted by application code. The intent is NOT enforced
--   by DDL (no rule/trigger). Founder-ratified resolution (2026-09-29): the
--   enforcement question is referred to the Security Agent and remains
--   intentionally unimplemented here.
--
-- Static DDL draft only. No database was contacted. No test suite is claimed
--   beyond file reads. Nothing in this file has been executed.
-- =============================================================================

BEGIN;

-- =============================================================================
-- sign_event_audit — one row per delegation/authorization decision evaluated on
--   a sign-event request: actor, delegatee, event kind, purpose, tenant,
--   allow/deny, and the reason when denied.
-- =============================================================================
CREATE TABLE IF NOT EXISTS sign_event_audit (
  id               bigserial PRIMARY KEY,
  group_id         uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  actor_pubkey     text NOT NULL,
  delegatee_pubkey text,
  event_kind       int,
  purpose          text,
  tenant_scope     text,
  decision         text NOT NULL CHECK (decision IN ('allowed','denied')),
  denial_reason    text,
  delegation_id    uuid REFERENCES delegated_authority(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sign_event_audit
  ADD CONSTRAINT sea_actor_hex
  CHECK (actor_pubkey ~ '^[0-9a-f]{64}$');

ALTER TABLE sign_event_audit
  ADD CONSTRAINT sea_delegatee_hex
  CHECK (delegatee_pubkey IS NULL OR delegatee_pubkey ~ '^[0-9a-f]{64}$');

-- Event kind must be a non-negative Nostr kind when recorded.
ALTER TABLE sign_event_audit
  ADD CONSTRAINT sea_event_kind_non_negative
  CHECK (event_kind IS NULL OR event_kind >= 0);

-- A denial must say why. An allow carries no denial_reason.
ALTER TABLE sign_event_audit
  ADD CONSTRAINT sea_denial_reason_required
  CHECK (decision <> 'denied' OR (denial_reason IS NOT NULL AND length(btrim(denial_reason)) > 0));

ALTER TABLE sign_event_audit
  ADD CONSTRAINT sea_denial_reason_absent_when_allowed
  CHECK (decision <> 'allowed' OR denial_reason IS NULL);

-- S1 defensive guard: no column in this table may carry a secret key.
ALTER TABLE sign_event_audit
  ADD CONSTRAINT sea_purpose_not_key_material
  CHECK (purpose IS NULL OR purpose !~* 'nsec1');

ALTER TABLE sign_event_audit
  ADD CONSTRAINT sea_denial_reason_not_key_material
  CHECK (denial_reason IS NULL OR denial_reason !~* 'nsec1');

-- Primary access paths: per-group time-series, and per-actor time-series.
CREATE INDEX IF NOT EXISTS idx_sea_group_created
  ON sign_event_audit (group_id, created_at);

CREATE INDEX IF NOT EXISTS idx_sea_actor_created
  ON sign_event_audit (actor_pubkey, created_at);

-- Supporting scan paths named in the founder's column list.
CREATE INDEX IF NOT EXISTS idx_sea_delegation
  ON sign_event_audit (delegation_id);

CREATE INDEX IF NOT EXISTS idx_sea_decision
  ON sign_event_audit (decision);

CREATE INDEX IF NOT EXISTS idx_sea_event_kind
  ON sign_event_audit (event_kind);

-- =============================================================================
-- Row Level Security — service_role only.
-- The audit log is written exclusively by the sign-event decision path, which
-- is a server-side service_role path. No public read, no authenticated read.
-- =============================================================================
ALTER TABLE sign_event_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY sea_service_only
  ON sign_event_audit
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

-- Belt-and-braces on top of RLS, following the REVOKE precedent in 007.
-- service_role is intentionally NOT in this list.
REVOKE ALL ON TABLE sign_event_audit FROM anon, authenticated;

-- =============================================================================
-- Comments for documentation
-- =============================================================================
COMMENT ON TABLE sign_event_audit IS
  'Sign-event delegation/authorization decisions (allowed or denied) per group. '
  || 'Append-only by intent. group_id is the canonical tenant key; tenant_scope is '
  || 'a non-authoritative label only. S1: no key material — decisions are recorded, '
  || 'never the key or the signing means.';

COMMENT ON COLUMN sign_event_audit.actor_pubkey IS
  'Pubkey the request purported to act as. 64 lowercase hex. Public key only (S1).';

COMMENT ON COLUMN sign_event_audit.delegatee_pubkey IS
  'Pubkey the delegation designated as signer, when the request presented one.';

COMMENT ON COLUMN sign_event_audit.event_kind IS
  'Nostr event kind of the requested signature (e.g. 1, 4, 42).';

COMMENT ON COLUMN sign_event_audit.purpose IS
  'Caller-supplied purpose label for the signing request. Label only — never key material.';

COMMENT ON COLUMN sign_event_audit.tenant_scope IS
  'Non-authoritative echo of the Hermes-side tenant_scope vocabulary, kept for log parity. group_id is the canonical tenant key; nothing authorizes on this column.';

COMMENT ON COLUMN sign_event_audit.decision IS
  'The evaluated outcome: allowed | denied.';

COMMENT ON COLUMN sign_event_audit.denial_reason IS
  'Why the request was denied. Required when decision = denied; must be NULL when allowed.';

COMMENT ON COLUMN sign_event_audit.delegation_id IS
  'The delegated_authority row the decision was evaluated against. SET NULL on delegation delete so audit evidence survives.';

COMMENT ON INDEX idx_sea_group_created IS
  'Primary audit query path: all decisions for a group over time.';

COMMENT ON INDEX idx_sea_actor_created IS
  'Per-actor audit query path: everything a given pubkey attempted, over time.';

COMMIT;
