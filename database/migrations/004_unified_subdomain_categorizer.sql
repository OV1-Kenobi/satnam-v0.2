-- =============================================================================
-- Satnam v2 — Unified Subdomain Categorizer (Single NIP-05 / LN Table)
-- Migration: 004_unified_subdomain_categorizer.sql
-- Date: 2026-08-25
-- Founder approvals: 004 approved, 'our' correct for families, LN auto-create for groups yes
-- Plan: Founder directive 2026-08-25 — my.* / our.* / agent.* categorization,
--       root_domain whitelist-only, imported LN addresses allowed.
--       Replaces the three-table directory model from 003 (greenfield, zero rows).
--
-- SECURITY INVARIANTS:
--   S1: No encrypted_nsec / secret_shares / federation_nsec_encrypted ever.
--       Keys live only in OPFS Vault (AES-256-GCM + XChaCha20).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preserve artifact already pushed: stash/preserve-003-separate-tables-2026-08-25
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Extend the human directory (nip05_identifiers) with the categorizer split
--    Existing rows from 002 have domain='satnam.pub' (human default).
--    We add the two new columns, backfill, then enforce constraints.
-- ---------------------------------------------------------------------------
ALTER TABLE nip05_identifiers ADD COLUMN IF NOT EXISTS subdomain_prefix TEXT;
ALTER TABLE nip05_identifiers ADD COLUMN IF NOT EXISTS root_domain TEXT;

-- Backfill greenfield rows: domain='satnam.pub' → subdomain_prefix='my', root_domain='satnam.pub'
-- (For any existing human rows created via old API)
UPDATE nip05_identifiers SET subdomain_prefix = 'my' WHERE subdomain_prefix IS NULL;
UPDATE nip05_identifiers SET root_domain = COALESCE(domain, 'satnam.pub') WHERE root_domain IS NULL;

-- Now enforce NOT NULL and whitelist checks
ALTER TABLE nip05_identifiers ALTER COLUMN subdomain_prefix SET NOT NULL;
ALTER TABLE nip05_identifiers ALTER COLUMN root_domain SET NOT NULL;
ALTER TABLE nip05_identifiers DROP CONSTRAINT IF EXISTS nip05_subdomain_check;
ALTER TABLE nip05_identifiers ADD CONSTRAINT nip05_subdomain_check CHECK (subdomain_prefix IN ('my','our','agent'));
ALTER TABLE nip05_identifiers DROP CONSTRAINT IF EXISTS nip05_root_domain_whitelist;
ALTER TABLE nip05_identifiers ADD CONSTRAINT nip05_root_domain_whitelist CHECK (root_domain IN ('satnam.pub','openagents.com','sovereignhybridcompute.com'));

-- Drop the old single-column domain constraint and column (replaced by the split)
ALTER TABLE nip05_identifiers DROP CONSTRAINT IF EXISTS nip05_domain_format;
ALTER TABLE nip05_identifiers DROP COLUMN IF EXISTS domain;

-- Replace the old unique index with the categorizer-aware one
DROP INDEX IF EXISTS idx_nip05_username_domain;
CREATE UNIQUE INDEX IF NOT EXISTS idx_nip05_unique_per_categorizer ON nip05_identifiers(username, subdomain_prefix, root_domain) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_nip05_categorizer ON nip05_identifiers(subdomain_prefix, root_domain);
CREATE INDEX IF NOT EXISTS idx_nip05_root ON nip05_identifiers(root_domain);

-- ---------------------------------------------------------------------------
-- 2. Same split for lightning_addresses (single table, now with is_imported flag)
-- ---------------------------------------------------------------------------
ALTER TABLE lightning_addresses ADD COLUMN IF NOT EXISTS subdomain_prefix TEXT;
ALTER TABLE lightning_addresses ADD COLUMN IF NOT EXISTS root_domain TEXT;
ALTER TABLE lightning_addresses ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false;

UPDATE lightning_addresses SET subdomain_prefix = 'my' WHERE subdomain_prefix IS NULL;
UPDATE lightning_addresses SET root_domain = COALESCE(domain, 'satnam.pub') WHERE root_domain IS NULL;

ALTER TABLE lightning_addresses ALTER COLUMN subdomain_prefix SET NOT NULL;
ALTER TABLE lightning_addresses ALTER COLUMN root_domain SET NOT NULL;
ALTER TABLE lightning_addresses DROP CONSTRAINT IF EXISTS la_subdomain_check;
ALTER TABLE lightning_addresses ADD CONSTRAINT la_subdomain_check CHECK (subdomain_prefix IN ('my','our','agent'));
ALTER TABLE lightning_addresses DROP CONSTRAINT IF EXISTS la_root_whitelist;
-- When is_imported=false (auto-created), root must be whitelisted.
-- When is_imported=true (user pasted external LN like getalby.com), any root is allowed.
ALTER TABLE lightning_addresses ADD CONSTRAINT la_root_whitelist CHECK (root_domain IN ('satnam.pub','openagents.com','sovereignhybridcompute.com') OR is_imported = true);

ALTER TABLE lightning_addresses DROP CONSTRAINT IF EXISTS la_domain_format;
ALTER TABLE lightning_addresses DROP COLUMN IF EXISTS domain;

DROP INDEX IF EXISTS idx_la_domain;
CREATE INDEX IF NOT EXISTS idx_la_categorizer ON lightning_addresses(subdomain_prefix, root_domain);
CREATE INDEX IF NOT EXISTS idx_la_imported ON lightning_addresses(is_imported) WHERE is_imported = true;

-- ---------------------------------------------------------------------------
-- 3. Drop the separate group/agent directories introduced in 003
--    (greenfield, zero rows — safe to drop)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS group_lightning_addresses CASCADE;
DROP TABLE IF EXISTS group_nip05_identifiers CASCADE;
DROP TABLE IF EXISTS agent_lightning_addresses CASCADE;
DROP TABLE IF EXISTS agent_nip05_identifiers CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Comments (single directory now)
-- ---------------------------------------------------------------------------
COMMENT ON TABLE nip05_identifiers IS 'Unified NIP-05 directory: username + subdomain_prefix (my/our/agent) + root_domain (whitelisted). my=human, our=family/group, agent=agent. Full NIP-05 = username@subdomain_prefix.root_domain. Example: myfamily@our.satnam.pub';
COMMENT ON TABLE lightning_addresses IS 'Unified Lightning directory: same categorizer. Auto-created rows have is_imported=false and host = subdomain_prefix.root_domain. Imported rows (user pasted) have is_imported=true.';

COMMIT;
