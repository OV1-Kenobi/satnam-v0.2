-- =============================================================================
-- DRAFT FOR REVIEW ONLY — DO NOT APPLY — DO NOT PROMOTE WITHOUT FOUNDER GATE
-- Migration draft: 010_bot_identity_and_delegation.sql
-- Plan: 28-plan-n424-mfa-lnbits-removal, WP MIG-010
-- Owner: Repository Steward (draft) — promotion to database/migrations is a
--        separate, founder-gated step on the satnam tree.
-- Date drafted: 2026-09-29
--
-- REQUIREMENT AUTHORITY:
--   planning/2026/09-september/28-plan-n424-mfa-lnbits-removal/
--     bot-mother-hermes-interop-spec.md  (requirement set; founder refinement
--     2026-09-29) — Bot-Mother = Nostr mirror of Telegram BotFather; four
--     tables named: nostr_identity_bindings, delegated_authority, role_grants,
--     approval_policies.
--   Founder directive in the drafting task, 2026-09-29: spec to OUR existing
--     relays and naming schemas; Developer role plus narrow delegation scoping.
--   Founder clarification 2026-09-29 (AMENDS the line above, which is
--     SUPERSEDED): "The Bot identities being 'birthed' by Bot-Mother are
--     effectively 'Adults' able to act on their own and to create 'Offspring'
--     if/when needed, with them all 'Stewarded' by a Human." There is no
--     'developer' role; the bot role is OUR existing 'adult'.
--
-- CONVENTION SOURCES READ (read-only via pinned `git show`, no checkout):
--   C:\Users\ov1kn\Documents\satnam-v0.2
--     ae314df:database/migrations/001_v2_schema.sql
--     ae314df:database/migrations/002_groups_agents_whitelist.sql
--     ae314df:database/migrations/005_nip98_seen_events.sql
--     ae314df:database/migrations/006_group_member_consent.sql
--     ae314df:database/migrations/007_shared_rate_limiting.sql
--     a3110d4:database/migrations/008_nfc_issuer_and_counters.sql
--     a3110d4:database/migrations/009_frost_mfa_bindings.sql
--   NOTE (discrepancy, flagged in wp-mig-review.md): ae314df contains ONLY
--     001-007. 008/009 exist only at a3110d4 (branch split/clean-42-2026-09-28),
--     which is the working-tree HEAD. ae314df is an ancestor of a3110d4
--     (verified with merge-base --is-ancestor). Consequently numbering next = 010.
--
-- CONVENTIONS MATCHED (001-009):
--   forward-only BEGIN/COMMIT; CREATE TABLE IF NOT EXISTS; snake_case plural
--   table names; uuid PK DEFAULT gen_random_uuid(); idx_<abbrev>_<col> index
--   names; named CHECK constraints (ALTER TABLE ... ADD CONSTRAINT <abbrev>_...);
--   hex-pubkey CHECKs ~ '^[0-9a-f]{64}$'; RLS policies named
--   <abbrev>_service_write / <abbrev>_service_only using
--   current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role';
--   COMMENT ON for tables and key columns; update_updated_at_column() trigger
--   from 001 for tables carrying updated_at; NO down-migration section.
--
-- ADDITIVE HELPER (flagged in wp-mig-review.md): text_array_all_match(text[],text)
--   exists because PostgreSQL forbids subqueries inside CHECK constraints, and
--   the array-element guards on relay_hints and approver_pubkeys need one.
--   It is a pure IMMUTABLE predicate with no data access.
--
-- SECURITY INVARIANTS:
--   S1: No nsec / secret_key / private_key / encrypted_nsec column anywhere in
--       this migration. No key material is stored server-side. custody_mode
--       records HOW signing is delegated; it never carries the key itself.
--   S6: No cmacHex / piccDataHex in any server-side path. Neither column, nor
--       any NFC-related field, appears in this migration.
--
-- TENANT KEY: group_id (FK groups(id) ON DELETE CASCADE) is OUR canonical
--   tenant key. The Hermes-side vocabulary organization_id / tenant_scope is
--   GUIDANCE ONLY and is NOT canonical here — see wp-mig-review.md for the
--   mapping decision. No organization / tenant / tenant_scope table is created.
--
-- ROLES: the grant vocabulary in this migration is OUR existing vocabulary
--   ('guardian','steward','adult','offspring') — the same one group_members
--   uses. The earlier 'developer' role named in the first drafting directive is
--   SUPERSEDED by the founder clarification of 2026-09-29.
--
--   FOUNDING SEMANTICS (founder, 2026-09-29; broadened by founder clarification
--   2026-09-29b — NOT ALL stewards/adults/offspring are agents):
--     The same four roles describe BOTH human groups and agent families; the two
--     sides MIRROR each other. A family, a business crew, or a bot family all use
--     guardian/steward/adult/offspring. The Family Foundry founds the human
--     family/business identity and reputation; Bot-Mother births the agent side.
--     'steward'   — the custodian of a group or a bot family. Usually a HUMAN; a
--                   human group's steward is a person, and a bot family is
--                   stewarded by a Human.
--     'adult'     — an identity that can act on its own and can found/birth
--                   dependents. May be a HUMAN adult or a Bot-Mother-birthed
--                   agent. A birthed bot IS an adult.
--     'offspring' — a dependent identity created by an adult. May be a HUMAN
--                   child or an agent created by an adult agent.
--     'guardian'  — retains its existing highest-custody meaning from 002.
--   This table binds NOSTR IDs, which may belong to either side, so the role
--   column carries the mirrored vocabulary for both. No group_members role value
--   and no existing CHECK is altered.
--
-- RELAYS: our lane policy, for COMMENT documentation only (no host is
--   hard-coded as a constraint):
--     human lane : wss://relay.satnam.pub
--     agent lane : wss://relay.shock.network
--     public fallbacks for OTP-style DMs ONLY: wss://relay.damus.io,
--       wss://relay.nostr.band
--   relay.livingry.services / livingry.services is NOT ours and MUST NOT
--   appear in this schema, in any default, or in any comment. The Hermes
--   nprofile artifact is NOT used and NOT referenced; no nprofile value is
--   seeded by this migration (see "NO SEED DATA" below).
--
-- NO SEED DATA: this migration contains zero INSERT statements. Per the
--   interop spec, the binding row and its nprofile fall out of the
--   founder-gated key ceremony, not from a migration. Seed data here would be
--   inventing an identity.
--
-- Static DDL draft only. No database was contacted. No test suite is claimed
--   beyond file reads. Nothing in this file has been executed.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 0. Helper predicate — every element of a text[] matches a pattern.
--    Needed because CHECK constraints cannot contain subqueries. Pure
--    IMMUTABLE predicate: reads no table, holds no data.
--    NULL array or empty array => true (the guard is only meaningful when
--    the array is populated).
-- =============================================================================
CREATE OR REPLACE FUNCTION text_array_all_match(
  p_values  text[],
  p_pattern text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_values IS NULL
      OR NOT EXISTS (
           SELECT 1
           FROM unnest(p_values) AS v
           WHERE v IS NULL OR v !~ p_pattern
         );
$$;

COMMENT ON FUNCTION text_array_all_match(text[], text) IS
  'Pure IMMUTABLE predicate: true when every element of p_values matches the '
  || 'POSIX pattern p_pattern. Used by CHECK constraints on text[] columns '
  || '(relay_hints, approver_pubkeys) because CHECK cannot contain a subquery.';

-- =============================================================================
-- 1. nostr_identity_bindings
--    One row per bot/agent Nostr identity registered to a group. The Nostr-side
--    analogue of BotFather's registration: pubkey, custody mode, kill-switch
--    status, published profile pointer, relay hints, and the identity's ROLE in
--    the group's lineage.
--    "Who the bot can speak as."
--
--    LINEAGE (founder clarification 2026-09-29): a Bot-Mother-birthed binding is
--    an 'adult'; a binding an adult creates is 'offspring' and points back at its
--    creator through parent_binding_id. birth_depth is 0 for a binding birthed
--    directly by Bot-Mother, 1 for one created by an adult, and so on, so the
--    whole family tree is queryable without a separate lineage table.
-- =============================================================================
CREATE TABLE IF NOT EXISTS nostr_identity_bindings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pubkey            text NOT NULL,
  custody_mode      text NOT NULL CHECK (custody_mode IN ('remote_signer','local_signer','nip07')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  group_id          uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN ('guardian','steward','adult','offspring')),
  parent_binding_id uuid REFERENCES nostr_identity_bindings(id) ON DELETE SET NULL,
  birth_depth       int NOT NULL DEFAULT 0 CHECK (birth_depth >= 0),
  nprofile          text,
  relay_hints       text[],
  profile_published boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pubkey, group_id)
);

-- Pubkey must be a 64-char lowercase hex Nostr public key.
ALTER TABLE nostr_identity_bindings
  ADD CONSTRAINT nib_pubkey_hex
  CHECK (pubkey ~ '^[0-9a-f]{64}$');

-- Relay hints, when present, must be wss:// endpoints (aligned with the
-- '^https://' URL guard used in 002 issuer_registry.base_url).
ALTER TABLE nostr_identity_bindings
  ADD CONSTRAINT nib_relay_hints_wss
  CHECK (text_array_all_match(relay_hints, '^wss://'));

-- S1 defensive guard: this row is a public-identity registry. A pasted nsec
-- would be a key-material leak in a column that is never allowed to hold one.
ALTER TABLE nostr_identity_bindings
  ADD CONSTRAINT nib_nprofile_not_key_material
  CHECK (nprofile IS NULL OR nprofile !~* 'nsec1');

CREATE INDEX IF NOT EXISTS idx_nib_pubkey ON nostr_identity_bindings (pubkey);
CREATE INDEX IF NOT EXISTS idx_nib_group ON nostr_identity_bindings (group_id);
CREATE INDEX IF NOT EXISTS idx_nib_status ON nostr_identity_bindings (status);
CREATE INDEX IF NOT EXISTS idx_nib_parent ON nostr_identity_bindings (parent_binding_id);
CREATE INDEX IF NOT EXISTS idx_nib_role ON nostr_identity_bindings (group_id, role);
CREATE INDEX IF NOT EXISTS idx_nib_active ON nostr_identity_bindings (group_id)
  WHERE status = 'active';

CREATE TRIGGER nib_updated_at
  BEFORE UPDATE ON nostr_identity_bindings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 2. delegated_authority
--    The scoped capability grant. The Nostr-side analogue of BotFather's
--    /setcommands: instead of a broad command allowlist, one row grants a
--    delegatee the ability to sign a bounded set of event kinds, inside an
--    expiry and a tenant, with the delegation token as the presented proof.
--    "What the bot can do."
--
--    delegation_token is the PUBLIC NIP-26 delegation string (conditions plus
--    a signature over public keys). It is NOT key material: no nsec, no
--    secret_key, no private_key. Validation of the token is APPLICATION code,
--    not DDL — see wp-mig-review.md.
-- =============================================================================
CREATE TABLE IF NOT EXISTS delegated_authority (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegator_pubkey  text NOT NULL,
  delegatee_pubkey  text NOT NULL,
  delegation_token  text,
  allowed_kinds     int[] NOT NULL DEFAULT '{1,4,42}',
  created_before    timestamptz,
  relay_url         text,
  group_id          uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at        timestamptz
);

ALTER TABLE delegated_authority
  ADD CONSTRAINT da_delegator_hex
  CHECK (delegator_pubkey ~ '^[0-9a-f]{64}$');

ALTER TABLE delegated_authority
  ADD CONSTRAINT da_delegatee_hex
  CHECK (delegatee_pubkey ~ '^[0-9a-f]{64}$');

-- A delegation cannot already be expired when it is created
-- (same shape as group_invitations.expires_at > created_at in 002).
ALTER TABLE delegated_authority
  ADD CONSTRAINT da_expiry_after_creation
  CHECK (expires_at > created_at);

-- Relay target, when present, must be a wss:// endpoint.
ALTER TABLE delegated_authority
  ADD CONSTRAINT da_relay_url_wss
  CHECK (relay_url IS NULL OR relay_url ~ '^wss://');

-- Narrow-delegation guard: an empty kind set would grant nothing and is
-- almost certainly a wiring mistake; record it rather than accept it silently.
ALTER TABLE delegated_authority
  ADD CONSTRAINT da_allowed_kinds_not_empty
  CHECK (cardinality(allowed_kinds) >= 1);

-- S1 defensive guard: the token column must never hold a secret key.
ALTER TABLE delegated_authority
  ADD CONSTRAINT da_token_not_key_material
  CHECK (delegation_token IS NULL OR delegation_token !~* 'nsec1');

-- Revocation must not predate creation.
ALTER TABLE delegated_authority
  ADD CONSTRAINT da_revoked_after_creation
  CHECK (revoked_at IS NULL OR revoked_at >= created_at);

CREATE INDEX IF NOT EXISTS idx_da_delegator ON delegated_authority (delegator_pubkey);
CREATE INDEX IF NOT EXISTS idx_da_delegatee ON delegated_authority (delegatee_pubkey);
CREATE INDEX IF NOT EXISTS idx_da_group ON delegated_authority (group_id);
CREATE INDEX IF NOT EXISTS idx_da_status ON delegated_authority (status);
CREATE INDEX IF NOT EXISTS idx_da_expires ON delegated_authority (expires_at);
CREATE INDEX IF NOT EXISTS idx_da_active ON delegated_authority (group_id, delegatee_pubkey)
  WHERE status = 'active';

-- =============================================================================
-- 3. role_grants
--    Grants a role to a subject pubkey within a group, with its own expiry and
--    revocation. A birthed bot's grant is 'adult' — it acts on its own and may
--    birth 'offspring' — under a narrow delegation, never an administrator-
--    equivalent grant.
--
--    role_grants is deliberately NARROWER than group_members.role:
--    group_members keeps ('guardian','steward','adult','offspring'). This table
--    carries ('guardian','steward','adult','offspring'). No group_members row is written
--    or altered by this migration, and no existing role CHECK is widened.
-- =============================================================================
CREATE TABLE IF NOT EXISTS role_grants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  subject_pubkey    text NOT NULL,
  role              text NOT NULL CHECK (role IN ('guardian','steward','adult','offspring')),
  granted_by_pubkey text NOT NULL,
  expires_at        timestamptz,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, subject_pubkey, role)
);

ALTER TABLE role_grants
  ADD CONSTRAINT rg_subject_hex
  CHECK (subject_pubkey ~ '^[0-9a-f]{64}$');

ALTER TABLE role_grants
  ADD CONSTRAINT rg_grantor_hex
  CHECK (granted_by_pubkey ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS idx_rg_group ON role_grants (group_id);
CREATE INDEX IF NOT EXISTS idx_rg_subject ON role_grants (subject_pubkey);
CREATE INDEX IF NOT EXISTS idx_rg_role ON role_grants (role);
CREATE INDEX IF NOT EXISTS idx_rg_status ON role_grants (status);
CREATE INDEX IF NOT EXISTS idx_rg_expires ON role_grants (expires_at);
CREATE INDEX IF NOT EXISTS idx_rg_active ON role_grants (group_id, subject_pubkey)
  WHERE status = 'active';

-- =============================================================================
-- 4. approval_policies
--    Human-approval rules per (group, action kind). This is the table the
--    interop spec routes approvals through INSTEAD of giving the bot
--    membership/role-management reach — which is why the bot's grant is
--    'adult' (the birthed bot) plus a narrow delegation, not 'administrator';
--    the approving Human is the group's 'steward' (or 'guardian' at the top).
--    "How the bot's actions get approved."
-- =============================================================================
CREATE TABLE IF NOT EXISTS approval_policies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  action_kind       text NOT NULL,
  required_role     text NOT NULL CHECK (required_role IN ('guardian','steward','adult','offspring')),
  threshold         int NOT NULL DEFAULT 1 CHECK (threshold >= 1),
  approver_pubkeys  text[] NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, action_kind)
);

-- action_kind is a label from the application's own action vocabulary; the
-- schema does not enumerate it (the vocabulary is not fixed by this draft).
ALTER TABLE approval_policies
  ADD CONSTRAINT apol_action_kind_not_blank
  CHECK (length(btrim(action_kind)) > 0);

-- Approver list, when populated, must contain well-formed pubkeys only.
ALTER TABLE approval_policies
  ADD CONSTRAINT apol_approver_pubkeys_hex
  CHECK (text_array_all_match(approver_pubkeys, '^[0-9a-f]{64}$'));

-- Threshold must be achievable from a non-empty approver list. An empty list
-- means "any holder of required_role may approve" (documented on the column),
-- so no cardinality bound applies then.
-- Founder-ratified resolution (2026-09-29).
ALTER TABLE approval_policies
  ADD CONSTRAINT apol_threshold_within_approvers
  CHECK (cardinality(approver_pubkeys) = 0 OR threshold <= cardinality(approver_pubkeys));

CREATE INDEX IF NOT EXISTS idx_apol_group ON approval_policies (group_id);
CREATE INDEX IF NOT EXISTS idx_apol_action ON approval_policies (action_kind);
CREATE INDEX IF NOT EXISTS idx_apol_status ON approval_policies (status);
CREATE INDEX IF NOT EXISTS idx_apol_active ON approval_policies (group_id)
  WHERE status = 'active';

-- Partial unique index on the active row: at most one ACTIVE policy per
-- (group_id, action_kind).
-- Founder-ratified resolution (2026-09-29).
CREATE UNIQUE INDEX IF NOT EXISTS idx_apol_active_unique
  ON approval_policies (group_id, action_kind)
  WHERE status = 'active';

CREATE TRIGGER apol_updated_at
  BEFORE UPDATE ON approval_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- Row Level Security
--
-- Every table here gates signing authority or approval authority, so every
-- table is service_role-only: RLS enabled plus a single named policy carrying
-- the service_role claim check used across 001-009. There is NO public read
-- policy on any of the four tables.
--
-- Why service-only rather than the 002 registry pattern (public read +
-- service write): the interop spec's central rules are the status kill switch
-- and "no cross-tenant read or write", and relay_hints can name the tenant's
-- private relay. 005 and 007 already set the stricter service-only precedent.
-- Founder-ratified resolution (2026-09-29): service-role only for all four
-- tables — no public read. A restricted discovery view (pubkey, nprofile, and
-- profile_published for active+published rows only) remains a possible future
-- decision and is NOT opened by this migration.
-- =============================================================================

ALTER TABLE nostr_identity_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY nib_service_only
  ON nostr_identity_bindings
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

ALTER TABLE delegated_authority ENABLE ROW LEVEL SECURITY;

CREATE POLICY da_service_only
  ON delegated_authority
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

ALTER TABLE role_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY rg_service_only
  ON role_grants
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

ALTER TABLE approval_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY apol_service_only
  ON approval_policies
  FOR ALL
  USING (
    current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role'
  );

-- Belt-and-braces on top of RLS, following the REVOKE precedent in 007
-- (rate_limit_counters). service_role is intentionally NOT in this list.
REVOKE ALL ON TABLE nostr_identity_bindings FROM anon, authenticated;
REVOKE ALL ON TABLE delegated_authority FROM anon, authenticated;
REVOKE ALL ON TABLE role_grants FROM anon, authenticated;
REVOKE ALL ON TABLE approval_policies FROM anon, authenticated;

-- =============================================================================
-- Comments for documentation
-- =============================================================================
COMMENT ON TABLE nostr_identity_bindings IS
  'Bot/agent Nostr identity registration (BotFather-analogue, "who the bot can speak as"). '
  || 'Tenant key is group_id. status is the kill switch: the signer must refuse '
  || 'sign-event unless status = active. S1: no key material — custody_mode names the '
  || 'signing route (remote_signer | local_signer | nip07), never the key.';

COMMENT ON COLUMN nostr_identity_bindings.pubkey IS
  'Hex-encoded Nostr public key (64 lowercase hex chars). Never store nsec here (S1).';

COMMENT ON COLUMN nostr_identity_bindings.custody_mode IS
  'Signing route: remote_signer (e.g. NIP-46 bunker), local_signer, or nip07 (browser extension). Descriptive only — no key material is stored server-side.';

COMMENT ON COLUMN nostr_identity_bindings.nprofile IS
  'NIP-19 nprofile (pubkey plus relay hints) for discovery. Value is produced by the founder-gated key ceremony; this migration seeds no value and references no pre-existing nprofile artifact.';

COMMENT ON COLUMN nostr_identity_bindings.relay_hints IS
  'wss:// relay hints for this identity. Lane policy: human lane wss://relay.satnam.pub, agent lane wss://relay.shock.network; public fallbacks wss://relay.damus.io and wss://relay.nostr.band for OTP-style direct messages only. No relay is hard-coded in DDL.';

COMMENT ON COLUMN nostr_identity_bindings.role IS
  'Role of this bound identity within its group. The vocabulary MIRRORS across human groups and agent families: guardian | steward | adult | offspring. Stewards and offspring are NOT all agents — a bound identity may be a person or a bot. A Bot-Mother-birthed identity is normally adult (it acts on its own and may birth offspring); an identity created by an adult is offspring; the Human who stewards a bot family holds steward.';

COMMENT ON COLUMN nostr_identity_bindings.parent_binding_id IS
  'The binding that created this one, when an adult birthed offspring. NULL means this binding was birthed directly by Bot-Mother. Self-referencing lineage; ON DELETE SET NULL so removing a creator never cascades away the created identity.';

COMMENT ON COLUMN nostr_identity_bindings.birth_depth IS
  'Lineage depth: 0 = birthed directly by Bot-Mother, 1 = created by an adult, 2 = created by that adult''s offspring, and so on. Queryable family tree without a separate lineage table.';

COMMENT ON TABLE delegated_authority IS
  'Scoped signing-capability grants ("what the bot can do"). Narrow by construction: allowed_kinds plus created_before bound plus relay_url plus expires_at, per group. Revocation is status = revoked (plus revoked_at) or expiry. S1: delegation_token is a public NIP-26 delegation string, not key material.';

COMMENT ON COLUMN delegated_authority.allowed_kinds IS
  'Nostr event kinds this delegation may sign. Default {1,4,42}. Deliberately narrow; must not become a broad execute-style allowlist.';

COMMENT ON COLUMN delegated_authority.delegation_token IS
  'Public NIP-26 delegation string (conditions plus signature over public keys). NOT key material. Whether the token validates is an application-side check, out of scope for DDL.';

COMMENT ON COLUMN delegated_authority.created_before IS
  'Upper bound on event created_at that the delegation may cover (NIP-26 condition). Replay/backdating bound; enforced by application code.';

COMMENT ON COLUMN delegated_authority.relay_url IS
  'Tenant relay where this delegation applies. wss:// only. Resolved from our lane policy; no host is fixed in DDL.';

COMMENT ON TABLE role_grants IS
  'Role grants within a group with independent expiry and revocation. Grant vocabulary is OUR existing (guardian, steward, adult, offspring) — the same vocabulary group_members uses, which this migration does not alter. The roles MIRROR across human groups and agent families (founder clarification 2026-09-29b): not all stewards, adults, or offspring are agents; a family, a business crew, and a bot family all use the same four roles. The Family Foundry founds the human family/business identity and reputation; Bot-Mother births the agent side. A birthed bot is an adult; the Human who stewards it holds steward.';

COMMENT ON COLUMN role_grants.role IS
  'Grant role: guardian | steward | adult | offspring. A birthed bot is granted adult; an identity it creates is offspring; the Human who stewards the family holds steward. Explicit grant plus narrow delegation, never an administrator-equivalent role.';

COMMENT ON TABLE approval_policies IS
  'Human-approval policy per group and action kind: required role, threshold, and approver list. At most one policy per (group_id, action_kind). Routes approvals through policy instead of granting the bot membership or role-management reach.';

COMMENT ON COLUMN approval_policies.threshold IS
  'Minimum approving participants (>= 1). Default 1. When the approver list is non-empty it must not exceed the list cardinality (apol_threshold_within_approvers); an empty list means any holder of required_role may approve.';

COMMENT ON COLUMN approval_policies.approver_pubkeys IS
  'Optional explicit approver pubkey allowlist (64-hex each). Empty array means ANY HOLDER OF THE REQUIRED ROLE may approve (founder-ratified resolution 2026-09-29).';

COMMIT;
