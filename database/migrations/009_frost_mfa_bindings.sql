-- =============================================================================
-- DRAFT FOR REVIEW ONLY — DO NOT APPLY
-- Migration draft COPY: 009_frost_mfa_bindings.sql
-- (Numbered copy of 0xx_frost_mfa_bindings.sql; original 0xx file stays
-- untouched as the audit trail. CORRECTION 2026-09-28: repo shows 001-007,
-- so this is 008's successor = 009. Prior 016 numbering withdrawn.)
-- Product authority: PRD-N424-MFA-Mobile-Signing.md §4.2 (FROSTR linkage)
-- Depends on: 008_nfc_issuer_and_counters.sql (nfc_cards must exist first)
-- Satnam tree refs (read-only via git show): base 24c50d1 / HEAD ad39d7a
-- Conventions matched to 001-007: forward-only BEGIN/COMMIT, IF NOT EXISTS,
--   idx_ index style, named CHECK constraints, RLS, COMMENT ON.
-- Existing convention: NO down-migration section in 001-007 (forward-only).
--   Rollback is documented in wp0a-migration-review.md (migration-down +
--   table-drop in disposable copy only).
-- Static draft only; no database contacted; no suite claimed beyond file reads.
-- S1: No key material in this table. Each share's nsec sub-key is wrapped with
--   that tag's xorWrappingKeys client-side; Supabase holds only the linkage.
-- RLS NOTE (from 005-007 read 2026-09-28): 005/007 use service-only RLS with
--   NO policies. Content below is UNCHANGED from the 0xx original (service-only
--   already matches the stricter posture). No content change forced by 008-014
--   because 008-014 were NOT-FOUND in the repo at any ref searched.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- frost_mfa_bindings — FROSTR share ↔ NFC card linkage (existing frost tables
-- extend; this table is the MFA binding layer per PRD §6.5).
-- PRD 4.2 columns: share_id + nfc_card_id + threshold + participants.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS frost_mfa_bindings (
  share_id text PRIMARY KEY,
  nfc_card_id text REFERENCES nfc_cards (id) ON DELETE SET NULL,
  threshold int NOT NULL,
  participants int NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE frost_mfa_bindings DROP CONSTRAINT IF EXISTS fmb_threshold_positive;
ALTER TABLE frost_mfa_bindings ADD CONSTRAINT fmb_threshold_positive CHECK (threshold >= 1);

ALTER TABLE frost_mfa_bindings DROP CONSTRAINT IF EXISTS fmb_participants_positive;
ALTER TABLE frost_mfa_bindings ADD CONSTRAINT fmb_participants_positive CHECK (participants >= 1);

ALTER TABLE frost_mfa_bindings DROP CONSTRAINT IF EXISTS fmb_threshold_lte_participants;
ALTER TABLE frost_mfa_bindings ADD CONSTRAINT fmb_threshold_lte_participants CHECK (threshold <= participants);

CREATE INDEX IF NOT EXISTS idx_fmb_nfc_card
  ON frost_mfa_bindings (nfc_card_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — draft proposal following 001/002 pattern
-- (service_role only; bindings gate signing authority). Founder + Security
-- to confirm. No public read proposed for this table.
-- ---------------------------------------------------------------------------
ALTER TABLE frost_mfa_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY fmb_service_only
  ON frost_mfa_bindings
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

-- ---------------------------------------------------------------------------
-- Comments for documentation
-- ---------------------------------------------------------------------------
COMMENT ON TABLE frost_mfa_bindings IS
  'FROSTR share to NFC card bindings. Each share requires its bound tag plus PIN. No key material (S1). k-of-n enforced by threshold <= participants.';

COMMENT ON COLUMN frost_mfa_bindings.share_id IS
  'FROSTR share identifier (references existing frost ceremony shares).';

COMMENT ON COLUMN frost_mfa_bindings.nfc_card_id IS
  'Bound NFC card id (references nfc_cards(id)). SET NULL on card delete; re-bind spare on revoke per PRD §6.5.';

COMMIT;
