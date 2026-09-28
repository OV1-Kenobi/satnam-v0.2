-- =============================================================================
-- DRAFT FOR REVIEW ONLY — DO NOT APPLY
-- Migration draft COPY: 008_nfc_issuer_and_counters.sql
-- (Numbered copy of 0xx_nfc_issuer_and_counters.sql; original 0xx file stays
-- untouched as the audit trail. CORRECTION 2026-09-28: founder confirmed the
-- recalled 001-014 set belonged to a different codebase; repo ls-tree shows
-- 001-007, so next = 008. Prior 015 numbering withdrawn.)
-- Plan: 28-plan-n424-mfa-lnbits-removal, Phase 0 WP-0A (Repository Steward)
-- Product authority: PRD-N424-MFA-Mobile-Signing.md §4.2 (Supabase shared truth)
--   PRD read via git show ad39d7a8ae0f1fc6e5d3299088d8ad70bbe115bf:planning/
--   2026/09-september/27-prd-n424-mfa/PRD-N424-MFA-Mobile-Signing.md (141 lines)
-- Satnam tree refs (read-only via git show): base 24c50d1 / HEAD ad39d7a
-- Conventions matched to 001-007: forward-only BEGIN/COMMIT, IF NOT EXISTS,
--   idx_ index style, named CHECK constraints, RLS, COMMENT ON.
-- Existing convention: NO down-migration section in 001-007 (forward-only).
--   Rollback is documented in wp0a-migration-review.md (migration-down +
--   table-drop in disposable copy only).
-- Static draft only; no database contacted; no suite claimed beyond file reads.
-- S1: No k0..k4 columns in Supabase. Key material lives in satnamd Vault only.
-- RLS NOTE (from 005-007 read 2026-09-28): 005/007 use service-only RLS with
--   NO policies (stricter than the public-read proposal below for issuer/cards
--   discovery mirrors). Content below is UNCHANGED from the 0xx original;
--   the public-read choice is flagged for founder + Security decision in
--   wp0a-migrations-actual-state.md. No content change forced by 008-014
--   because 008-014 were NOT-FOUND in the repo at any ref searched.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. nfc_issuer — registrar pubkey that owns the Vault IssuerKey (secret stays
--    in Vault at nfc/issuer.key; only the pubkey mirror lives here).
--    PRD 4.2 columns: id + pubkey (+ created_at housekeeping).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfc_issuer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pubkey text NOT NULL,          -- registrar pubkey that owns IssuerKey (Vault holds secret)
  created_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. nfc_cards — shared mirror row per provisioned tag. No key material.
--    PRD 4.2 columns: id + uid + version + state + owner_pubkey + group_id +
--    last_ctr, with UNIQUE(uid, version) and CHECK(state).
--    ID = PRF(IssuerKey, 0x2d003f7b || UID)[:16 hex] (derived server-side in
--    Vault; stored here as opaque identifier only).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfc_cards (
  id text PRIMARY KEY,           -- ID = PRF(IssuerKey, 0x2d003f7b || UID)[:16 hex]
  uid text NOT NULL,             -- 7B hex
  version int NOT NULL DEFAULT 0,
  state text NOT NULL CHECK (state IN ('configured', 'reset')),
  owner_pubkey text,             -- which member owns this tag (for FROSTR mapping)
  group_id text,                 -- optional family/DAO group
  last_ctr int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (uid, version)
);

CREATE INDEX IF NOT EXISTS idx_nfc_cards_owner
  ON nfc_cards (owner_pubkey);

CREATE INDEX IF NOT EXISTS idx_nfc_cards_group
  ON nfc_cards (group_id);

CREATE INDEX IF NOT EXISTS idx_nfc_cards_state
  ON nfc_cards (state);

-- ---------------------------------------------------------------------------
-- 3. nfc_backups — opaque client-side encrypted blob store. Server cannot
--    decrypt (AES-GCM with PIN-derived key; see PRD §6.4 / §7).
--    PRD 4.2 columns: id + enc_blob (+ created_at housekeeping).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nfc_backups (
  id text PRIMARY KEY REFERENCES nfc_cards (id) ON DELETE CASCADE,
  enc_blob text NOT NULL,        -- AES-GCM with PIN-derived key, stored for user download, NOT server-decryptable
  created_at timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security — draft proposal following 001/002 pattern
-- (service_role write; public read on issuer/cards discovery mirrors;
-- service-only on opaque backup blobs). Founder + Security to confirm.
-- ---------------------------------------------------------------------------
ALTER TABLE nfc_issuer ENABLE ROW LEVEL SECURITY;

CREATE POLICY nfc_issuer_public_read
  ON nfc_issuer
  FOR SELECT
  USING (true);

CREATE POLICY nfc_issuer_service_write
  ON nfc_issuer
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

ALTER TABLE nfc_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY nfc_cards_public_read
  ON nfc_cards
  FOR SELECT
  USING (true);

CREATE POLICY nfc_cards_service_write
  ON nfc_cards
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

ALTER TABLE nfc_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY nfc_backups_service_only
  ON nfc_backups
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

-- ---------------------------------------------------------------------------
-- Comments for documentation
-- ---------------------------------------------------------------------------
COMMENT ON TABLE nfc_issuer IS
  'NFC issuer registry mirror. Vault holds the IssuerKey secret; Supabase holds only the registrar pubkey. No key material (S1).';

COMMENT ON TABLE nfc_cards IS
  'NFC card mirror rows. No k0..k4 key material (S1). Counter enforced monotonic via atomic UPDATE ... WHERE last_ctr < ... RETURNING (backend).';

COMMENT ON TABLE nfc_backups IS
  'Opaque encrypted backup blobs (client-side AES-GCM). NOT server-decryptable.';

COMMIT;
