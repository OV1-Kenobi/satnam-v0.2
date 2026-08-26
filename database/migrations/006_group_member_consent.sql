-- =============================================================================
-- Satnam v2 — Group Member Consent States (W2-2 / round-1 finding M-1)
-- Migration: 006_group_member_consent.sql
-- Date: 2026-08-25
-- Context: Founder-directed security wave 2. group_create batch-provisions
--          members with NO consent signal: provisioned rows were
--          indistinguishable from members who actually joined, so anyone
--          with a valid NIP-98 identity could attach arbitrary pubkeys to a
--          group (association spam; privilege implication once group-scoped
--          features land). This migration introduces an explicit consent
--          lifecycle at the schema level.
--
-- MODEL:
--   'active'  — member consented (creator, or member who later called the
--               authenticated member_consent action).
--   'invited' — batch-provisioned by a group creator; NOT yet consenting.
--               Consumers MUST treat invited rows as non-members for any
--               privilege-bearing decision.
--
-- BACKFILL: existing rows default to 'active' (grandfathered) — pre-launch
-- alpha has no production groups to re-consent.
--
-- DEPLOYMENT: applied OUT-OF-BAND by the founder against the operational
-- Supabase project (standing session pattern). APPLY BEFORE deploying the
-- consent-writing code: the backfill below unconditionally activates any
-- invited rows, so a code-first deploy would let gap-window invited rows be
-- silently activated by this late backfill (wave-2 verdict C-1).
-- =============================================================================

BEGIN;

ALTER TABLE group_members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'invited';

ALTER TABLE group_members DROP CONSTRAINT IF EXISTS gm_status_check;
ALTER TABLE group_members ADD CONSTRAINT gm_status_check CHECK (status IN ('active', 'invited'));

-- Grandfather pre-existing rows as consenting members.
UPDATE group_members SET status = 'active' WHERE status = 'invited';

CREATE INDEX IF NOT EXISTS idx_group_members_status ON group_members(group_id, status);

COMMENT ON COLUMN group_members.status IS
  'Consent lifecycle (M-1): active = member consented (creator or via '
  || 'member_consent action); invited = batch-provisioned, not yet '
  || 'consenting. Privilege decisions must treat invited as non-member.';

COMMIT;
