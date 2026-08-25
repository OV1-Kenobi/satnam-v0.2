-- =============================================================================
-- Satnam v2 — Separate NIP-05/LN Directories for Groups and Agents
-- Migration: 003_separate_group_agent_nip05.sql
-- Date: 2026-08-25
-- Founder decisions: 1=Yes (separate tables, not columns)
--                 Assessment divergence approved: Group/Agent NIP-05 kept
--                 distinct from human directory for early testing.
-- GREENFIELD: New Supabase project will apply 001+002+003 fresh.
--             002 as shipped created mixed human table with domain+entity
--             stub; 003 splits into three sovereign directories.
--
-- SECURITY INVARIANTS:
--   S1: No encrypted_nsec / secret_shares / federation_nsec_encrypted ever.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Human directory stays as 002 left it: nip05_identifiers + lightning_addresses
--    (domain column already added). No change.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 2. Group directory — separate tables, separate indexes, separate RLS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_nip05_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'satnam.pub' CHECK (domain ~ '^[a-z0-9][a-z0-9\-.]{1,253}$'),
  pubkey TEXT NOT NULL CHECK (pubkey ~ '^[0-9a-f]{64}$'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(username, domain)
);
CREATE INDEX IF NOT EXISTS idx_group_nip05_group ON group_nip05_identifiers(group_id);
CREATE INDEX IF NOT EXISTS idx_group_nip05_domain ON group_nip05_identifiers(domain);
CREATE INDEX IF NOT EXISTS idx_group_nip05_pubkey ON group_nip05_identifiers(pubkey);

CREATE TABLE IF NOT EXISTS group_lightning_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE REFERENCES group_nip05_identifiers(username) ON UPDATE CASCADE ON DELETE CASCADE,
  lnurl_callback TEXT NOT NULL CHECK (lnurl_callback ~ '^https://'),
  domain TEXT NOT NULL DEFAULT 'satnam.pub' CHECK (domain ~ '^[a-z0-9][a-z0-9\-.]{1,253}$'),
  min_sendable_msats BIGINT NOT NULL DEFAULT 1000,
  max_sendable_msats BIGINT NOT NULL DEFAULT 100000000000,
  metadata_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_group_ln_group ON group_lightning_addresses(group_id);

-- ---------------------------------------------------------------------------
-- 3. Agent directory — separate tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_nip05_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_profile_id UUID NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'satnam.pub' CHECK (domain ~ '^[a-z0-9][a-z0-9\-.]{1,253}$'),
  pubkey TEXT NOT NULL CHECK (pubkey ~ '^[0-9a-f]{64}$'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(username, domain)
);
CREATE INDEX IF NOT EXISTS idx_agent_nip05_agent ON agent_nip05_identifiers(agent_profile_id);
CREATE INDEX IF NOT EXISTS idx_agent_nip05_domain ON agent_nip05_identifiers(domain);

CREATE TABLE IF NOT EXISTS agent_lightning_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_profile_id UUID NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE REFERENCES agent_nip05_identifiers(username) ON UPDATE CASCADE ON DELETE CASCADE,
  lnurl_callback TEXT NOT NULL CHECK (lnurl_callback ~ '^https://'),
  domain TEXT NOT NULL DEFAULT 'satnam.pub' CHECK (domain ~ '^[a-z0-9][a-z0-9\-.]{1,253}$'),
  min_sendable_msats BIGINT NOT NULL DEFAULT 1000,
  max_sendable_msats BIGINT NOT NULL DEFAULT 100000000000,
  metadata_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_ln_agent ON agent_lightning_addresses(agent_profile_id);

-- ---------------------------------------------------------------------------
-- 4. RLS: public read on nips, service_role write
-- ---------------------------------------------------------------------------
ALTER TABLE group_nip05_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_nip05_public_read ON group_nip05_identifiers FOR SELECT USING (true);
CREATE POLICY group_nip05_service_write ON group_nip05_identifiers FOR ALL USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');

ALTER TABLE group_lightning_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY group_ln_public_read ON group_lightning_addresses FOR SELECT USING (true);
CREATE POLICY group_ln_service_write ON group_lightning_addresses FOR ALL USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');

ALTER TABLE agent_nip05_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_nip05_public_read ON agent_nip05_identifiers FOR SELECT USING (true);
CREATE POLICY agent_nip05_service_write ON agent_nip05_identifiers FOR ALL USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');

ALTER TABLE agent_lightning_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_ln_public_read ON agent_lightning_addresses FOR SELECT USING (true);
CREATE POLICY agent_ln_service_write ON agent_lightning_addresses FOR ALL USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');

COMMENT ON TABLE group_nip05_identifiers IS 'Separate directory: Group NIP-05 username→pubkey. Distinct from human nip05_identifiers per founder decision 2026-08-25.';
COMMENT ON TABLE agent_nip05_identifiers IS 'Separate directory: Agent NIP-05 username→pubkey. Distinct for indexing agents separately.';

COMMIT;
