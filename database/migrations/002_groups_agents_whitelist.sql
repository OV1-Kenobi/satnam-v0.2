-- =============================================================================
-- Satnam v2 — Groups, Agents, Whitelist Migration
-- Migration: 002_groups_agents_whitelist.sql
-- Date: 2026-08-24
-- Plan: 01-implementation-plan.md Rev 2, Layer 1 (Wave 1 Item 1)
--
-- SECURITY INVARIANTS:
--   S1: No encrypted_nsec, nsec, secret_key, or private_key column anywhere.
--       Key material is NEVER stored server-side. nsec lives in OPFS Vault only.
--   S6: No cmacHex/piccDataHex in any server function.
--
-- Naming: group/group throughout; Guardian/Steward/Adult/Offspring roles preserved.
-- Zero family_* identifiers.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 0. Domain whitelist columns (founder-directed, closes C5 drift)
--    Config surface lists approved domains beyond satnam.pub
-- =============================================================================
ALTER TABLE nip05_identifiers ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'satnam.pub';
ALTER TABLE nip05_identifiers ADD CONSTRAINT nip05_domain_format CHECK (domain ~ '^[a-z0-9][a-z0-9\-.]{1,253}$');

ALTER TABLE lightning_addresses ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'satnam.pub';
ALTER TABLE lightning_addresses ADD CONSTRAINT la_domain_format CHECK (domain ~ '^[a-z0-9][a-z0-9\-.]{1,253}$');

CREATE INDEX IF NOT EXISTS idx_nip05_domain ON nip05_identifiers (domain);
CREATE INDEX IF NOT EXISTS idx_la_domain ON lightning_addresses (domain);

-- Existing groups may have mixed domains; ensure uniqueness is per (username,domain)
-- Keep existing UNIQUE(username) for satnam.pub backward compat, add domain-aware index for future
-- No breaking change to existing rows (all default to satnam.pub)

-- =============================================================================
-- 1. Groups
--    Charter-based group (company, family, human/Agent team, club, event host)
-- =============================================================================
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  charter TEXT NOT NULL,
  created_by_pubkey TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE groups ADD CONSTRAINT groups_creator_hex CHECK (created_by_pubkey ~ '^[0-9a-f]{64}$');
CREATE INDEX IF NOT EXISTS idx_groups_creator ON groups (created_by_pubkey);
CREATE INDEX IF NOT EXISTS idx_groups_active ON groups (is_active) WHERE is_active = true;
CREATE TRIGGER groups_updated_at BEFORE UPDATE ON groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 2. Group members (Guardian/Steward/Adult/Offspring — roles preserved)
-- =============================================================================
CREATE TABLE IF NOT EXISTS group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  member_pubkey TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('guardian','steward','adult','offspring')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_by_pubkey TEXT,
  UNIQUE (group_id, member_pubkey)
);

ALTER TABLE group_members ADD CONSTRAINT gm_pubkey_hex CHECK (member_pubkey ~ '^[0-9a-f]{64}$');
ALTER TABLE group_members ADD CONSTRAINT gm_inviter_hex CHECK (invited_by_pubkey IS NULL OR invited_by_pubkey ~ '^[0-9a-f]{64}$');
CREATE INDEX IF NOT EXISTS idx_gm_group ON group_members (group_id);
CREATE INDEX IF NOT EXISTS idx_gm_pubkey ON group_members (member_pubkey);

-- =============================================================================
-- 3. Group invitations
-- =============================================================================
CREATE TABLE IF NOT EXISTS group_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('guardian','steward','adult','offspring')),
  invited_by_pubkey TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by_pubkey TEXT,
  CHECK (expires_at > created_at),
  CHECK (accepted_by_pubkey IS NULL OR accepted_by_pubkey ~ '^[0-9a-f]{64}$')
);

ALTER TABLE group_invitations ADD CONSTRAINT gi_inviter_hex CHECK (invited_by_pubkey ~ '^[0-9a-f]{64}$');
CREATE INDEX IF NOT EXISTS idx_gi_group ON group_invitations (group_id);
CREATE INDEX IF NOT EXISTS idx_gi_code ON group_invitations (invite_code);
CREATE INDEX IF NOT EXISTS idx_gi_expires ON group_invitations (expires_at);

-- =============================================================================
-- 4. Agent profiles (swarm deployment)
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  agent_pubkey TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_by_pubkey TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  CHECK (agent_pubkey ~ '^[0-9a-f]{64}$'),
  CHECK (created_by_pubkey ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_ap_group ON agent_profiles (group_id);
CREATE INDEX IF NOT EXISTS idx_ap_pubkey ON agent_profiles (agent_pubkey);
CREATE INDEX IF NOT EXISTS idx_ap_active ON agent_profiles (is_active) WHERE is_active = true;

-- =============================================================================
-- 5. Agent spend policies (swarm guardrails)
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_spend_policies (
  agent_profile_id UUID PRIMARY KEY REFERENCES agent_profiles(id) ON DELETE CASCADE,
  max_single_spend_msats BIGINT NOT NULL CHECK (max_single_spend_msats > 0),
  daily_limit_msats BIGINT NOT NULL CHECK (daily_limit_msats > 0),
  weekly_limit_msats BIGINT NOT NULL CHECK (weekly_limit_msats > 0),
  approval_threshold_msats BIGINT NOT NULL CHECK (approval_threshold_msats > 0),
  allowed_kinds TEXT[] NOT NULL DEFAULT '{}',
  allowed_rails TEXT[] NOT NULL DEFAULT '{}',
  allowed_mints TEXT[] NOT NULL DEFAULT '{}',
  delegation_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER asp_updated_at BEFORE UPDATE ON agent_spend_policies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 6. Agent delegation constraints
-- =============================================================================
CREATE TABLE IF NOT EXISTS agent_delegation_constraints (
  agent_profile_id UUID PRIMARY KEY REFERENCES agent_profiles(id) ON DELETE CASCADE,
  can_invite_members BOOLEAN NOT NULL DEFAULT false,
  can_create_agents BOOLEAN NOT NULL DEFAULT false,
  can_modify_spend_policy BOOLEAN NOT NULL DEFAULT false,
  can_rotate_keys BOOLEAN NOT NULL DEFAULT false,
  max_delegation_depth INTEGER NOT NULL DEFAULT 1 CHECK (max_delegation_depth >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER adc_updated_at BEFORE UPDATE ON agent_delegation_constraints FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 7. Issuer registry (fixes C5 drift — Cashu mints, LNbits, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS issuer_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer_pubkey TEXT NOT NULL UNIQUE CHECK (issuer_pubkey ~ '^[0-9a-f]{64}$'),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cashu_mint','lnbits','other')),
  base_url TEXT NOT NULL CHECK (base_url ~ '^https://'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  added_by_pubkey TEXT NOT NULL CHECK (added_by_pubkey ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ir_active ON issuer_registry (is_active) WHERE is_active = true;
CREATE TRIGGER ir_updated_at BEFORE UPDATE ON issuer_registry FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 8. Rate limits column alignment (verify C5 fix — no schema change needed if exists)
--    Existing 001 has identifier, endpoint, window_start, request_count — already aligned.
--    Add updated_at for consistency if missing.
-- =============================================================================
-- No DDL needed — rate_limits already correct per 001. This comment documents C5 alignment check.

-- =============================================================================
-- Row Level Security (service_role write, appropriate read)
-- =============================================================================
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY groups_public_read ON groups FOR SELECT USING (true);
CREATE POLICY groups_service_write ON groups FOR ALL USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');

ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY gm_public_read ON group_members FOR SELECT USING (true);
CREATE POLICY gm_service_write ON group_members FOR ALL USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');

ALTER TABLE group_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY gi_service_only ON group_invitations FOR ALL USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');

ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY ap_public_read ON agent_profiles FOR SELECT USING (true);
CREATE POLICY ap_service_write ON agent_profiles FOR ALL USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');

ALTER TABLE agent_spend_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY asp_service_only ON agent_spend_policies FOR ALL USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');

ALTER TABLE agent_delegation_constraints ENABLE ROW LEVEL SECURITY;
CREATE POLICY adc_service_only ON agent_delegation_constraints FOR ALL USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');

ALTER TABLE issuer_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY ir_public_read ON issuer_registry FOR SELECT USING (true);
CREATE POLICY ir_service_write ON issuer_registry FOR ALL USING (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');

-- =============================================================================
-- Comments
-- =============================================================================
COMMENT ON TABLE groups IS 'Group charter + membership root. Zero family_* identifiers. Roles: Guardian/Steward/Adult/Offspring.';
COMMENT ON TABLE group_members IS 'Group membership with role RBAC.';
COMMENT ON TABLE group_invitations IS 'Invite codes for group onboarding, including human/Agent teams.';
COMMENT ON TABLE agent_profiles IS 'Agent swarm members bound to a group, NIP-26 delegate pubkeys.';
COMMENT ON TABLE agent_spend_policies IS 'Swarm guardrails: spend limits, allowed kinds/rails/mints, delegation expiry.';
COMMENT ON TABLE issuer_registry IS 'Trusted Cashu mints / LNbits issuers per C5 drift fix.';

COMMIT;
