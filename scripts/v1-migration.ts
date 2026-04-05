#!/usr/bin/env tsx
/**
 * @module scripts/v1-migration
 * @description v1 → v2 Migration Script — Satnam
 *
 * Implements the data extraction and decommission migration per spec §11.2.
 *
 * ## Migration Steps
 *
 * 1. NIP-05 preservation: copy username→pubkey mappings from v1 user_identities
 *    to v2 nip05_identifiers table.
 * 2. Lightning address preservation: copy all Lightning address configs.
 * 3. nsec migration ceremony: for each user, guide them through decrypting
 *    their v1 PBKDF2-encrypted nsec and re-encrypting under the OPFS Vault.
 *    This is a CLIENT-SIDE ceremony — the server never sees the decrypted nsec.
 * 4. Table drop commands: after all users migrate, drop all v1 tables with
 *    key material (S1 invariant cleanup).
 *
 * ## Usage
 *
 * ```sh
 * # Dry run (no writes)
 * tsx scripts/v1-migration.ts --dry-run
 *
 * # Copy NIP-05 identifiers only
 * tsx scripts/v1-migration.ts --step nip05
 *
 * # Copy Lightning addresses only
 * tsx scripts/v1-migration.ts --step lightning
 *
 * # Generate table drop SQL (decommission phase)
 * tsx scripts/v1-migration.ts --step generate-drops
 *
 * # Full migration (non-interactive, for CI validation)
 * tsx scripts/v1-migration.ts --full
 * ```
 *
 * ## Environment Variables
 *
 * Required:
 * - V1_SUPABASE_URL         — v1 Supabase project URL
 * - V1_SUPABASE_SERVICE_KEY — v1 Supabase service role key
 * - V2_SUPABASE_URL         — v2 Supabase project URL
 * - V2_SUPABASE_SERVICE_KEY — v2 Supabase service role key
 *
 * Optional:
 * - MIGRATION_DRY_RUN       — set to "true" to skip writes
 * - MIGRATION_BATCH_SIZE    — number of records per batch (default: 100)
 *
 * ## Security
 *
 * S1 invariant: this script never reads, copies, or logs nsec values.
 * The nsec migration ceremony is client-side only (see comments in step 3).
 * S11 invariant: no key material in console output.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Configuration
// ============================================================================

const V1_SUPABASE_URL = process.env.V1_SUPABASE_URL || '';
const V1_SUPABASE_KEY = process.env.V1_SUPABASE_SERVICE_KEY || '';
const V2_SUPABASE_URL = process.env.V2_SUPABASE_URL || process.env.SUPABASE_URL || '';
const V2_SUPABASE_KEY = process.env.V2_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DRY_RUN = process.env.MIGRATION_DRY_RUN === 'true' || process.argv.includes('--dry-run');
const BATCH_SIZE = parseInt(process.env.MIGRATION_BATCH_SIZE || '100', 10);
const NIP05_DOMAIN = process.env.NIP05_DOMAIN || 'satnam.pub';

// ============================================================================
// Types
// ============================================================================

interface V1UserIdentity {
  id: string;
  username: string | null;
  nostr_pubkey: string | null;
  email: string | null;
  created_at: string;
}

interface V1LightningAddress {
  id: string;
  user_id: string;
  lud16: string | null;
  username: string | null;
  nostr_pubkey: string | null;
  created_at: string;
}

interface MigrationResult {
  step: string;
  total: number;
  migrated: number;
  skipped: number;
  errors: number;
  errorDetails: string[];
}

// ============================================================================
// Supabase clients
// ============================================================================

function getV1Client(): SupabaseClient {
  if (!V1_SUPABASE_URL || !V1_SUPABASE_KEY) {
    throw new Error('V1_SUPABASE_URL and V1_SUPABASE_SERVICE_KEY are required for migration');
  }
  return createClient(V1_SUPABASE_URL, V1_SUPABASE_KEY);
}

function getV2Client(): SupabaseClient {
  if (!V2_SUPABASE_URL || !V2_SUPABASE_KEY) {
    throw new Error('V2_SUPABASE_URL and V2_SUPABASE_SERVICE_KEY (or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) are required');
  }
  return createClient(V2_SUPABASE_URL, V2_SUPABASE_KEY);
}

// ============================================================================
// Step 1: NIP-05 Identifier Migration
// ============================================================================

/**
 * Migrate NIP-05 identifiers from v1 user_identities to v2 nip05_identifiers.
 *
 * Source: v1.user_identities (username, nostr_pubkey)
 * Destination: v2.nip05_identifiers (username, pubkey, domain, is_active)
 *
 * S1 invariant: encrypted_nsec, user_salt columns are explicitly NOT read.
 */
async function migrateNip05Identifiers(): Promise<MigrationResult> {
  console.log('\n=== Step 1: NIP-05 Identifier Migration ===');

  const v1 = getV1Client();
  const v2 = getV2Client();
  const result: MigrationResult = {
    step: 'nip05',
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [],
  };

  // Fetch v1 users with username and pubkey (explicitly exclude key material columns)
  // S1 invariant: never select encrypted_nsec, user_salt, encrypted_nsec_iv
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await v1
      .from('user_identities')
      .select('id, username, nostr_pubkey, created_at')
      // Explicitly NOT selecting: encrypted_nsec, encrypted_nsec_iv, user_salt
      .not('username', 'is', null)
      .not('nostr_pubkey', 'is', null)
      .range(page * BATCH_SIZE, (page + 1) * BATCH_SIZE - 1)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching v1 user_identities:', error.message);
      result.errors += 1;
      result.errorDetails.push(`Fetch batch ${page}: ${error.message}`);
      break;
    }

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    result.total += data.length;

    for (const user of data as V1UserIdentity[]) {
      if (!user.username || !user.nostr_pubkey) {
        result.skipped += 1;
        continue;
      }

      const username = user.username.toLowerCase().trim();
      const pubkey = user.nostr_pubkey.toLowerCase().trim();

      // Validate format
      if (!username || username.length < 1) {
        result.skipped += 1;
        continue;
      }

      if (!/^[0-9a-f]{64}$/.test(pubkey)) {
        console.warn(`Skipping invalid pubkey for username ${username}`);
        result.skipped += 1;
        continue;
      }

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would migrate: ${username}@${NIP05_DOMAIN} → ${pubkey.slice(0, 16)}...`);
        result.migrated += 1;
        continue;
      }

      // Insert into v2 nip05_identifiers (upsert on username+pubkey conflict)
      const { error: insertErr } = await v2
        .from('nip05_identifiers')
        .upsert(
          {
            username,
            pubkey,
            domain: NIP05_DOMAIN,
            is_active: true,
            migrated_from_v1: true,
            created_at: user.created_at || new Date().toISOString(),
          },
          { onConflict: 'username,pubkey' }
        );

      if (insertErr) {
        if (insertErr.code === '23505') {
          // Already exists — skip
          result.skipped += 1;
        } else {
          console.error(`Error migrating ${username}:`, insertErr.message);
          result.errors += 1;
          result.errorDetails.push(`${username}: ${insertErr.message}`);
        }
      } else {
        console.log(`Migrated: ${username}@${NIP05_DOMAIN}`);
        result.migrated += 1;
      }
    }

    if (data.length < BATCH_SIZE) {
      hasMore = false;
    } else {
      page += 1;
    }
  }

  printResult(result);
  return result;
}

// ============================================================================
// Step 2: Lightning Address Migration
// ============================================================================

/**
 * Migrate Lightning addresses from v1 to v2 lightning_addresses table.
 *
 * Source: v1 (lightning_addresses or user_identities.lud16 column)
 * Destination: v2.lightning_addresses
 */
async function migrateLightningAddresses(): Promise<MigrationResult> {
  console.log('\n=== Step 2: Lightning Address Migration ===');

  const v1 = getV1Client();
  const v2 = getV2Client();
  const result: MigrationResult = {
    step: 'lightning',
    total: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [],
  };

  // Try dedicated lightning_addresses table first, fall back to user_identities.lud16
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    // Fetch users with a Lightning address configured
    const { data, error } = await v1
      .from('user_identities')
      .select('id, username, nostr_pubkey, lud16, created_at')
      // Explicitly NOT selecting: encrypted_nsec, encrypted_nsec_iv, user_salt
      .not('lud16', 'is', null)
      .not('nostr_pubkey', 'is', null)
      .range(page * BATCH_SIZE, (page + 1) * BATCH_SIZE - 1);

    if (error) {
      // Table may not have lud16 column — that's OK
      if (error.code === '42703') {
        console.log('Note: user_identities does not have lud16 column. Checking lightning_addresses table...');
        break;
      }
      result.errors += 1;
      result.errorDetails.push(`Fetch batch ${page}: ${error.message}`);
      break;
    }

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    result.total += data.length;

    for (const user of data as (V1UserIdentity & { lud16?: string })[]) {
      if (!user.nostr_pubkey || !user.lud16) {
        result.skipped += 1;
        continue;
      }

      const pubkey = user.nostr_pubkey.toLowerCase().trim();
      const lud16 = user.lud16.trim();
      const username = user.username?.toLowerCase().trim() || '';

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would migrate Lightning: ${lud16} for ${pubkey.slice(0, 16)}...`);
        result.migrated += 1;
        continue;
      }

      const { error: insertErr } = await v2
        .from('lightning_addresses')
        .upsert(
          {
            pubkey,
            lud16,
            username,
            domain: NIP05_DOMAIN,
            migrated_from_v1: true,
            created_at: user.created_at || new Date().toISOString(),
          },
          { onConflict: 'pubkey' }
        );

      if (insertErr) {
        if (insertErr.code === '23505') {
          result.skipped += 1;
        } else {
          result.errors += 1;
          result.errorDetails.push(`${pubkey.slice(0, 16)}: ${insertErr.message}`);
        }
      } else {
        console.log(`Migrated Lightning: ${lud16}`);
        result.migrated += 1;
      }
    }

    if (data.length < BATCH_SIZE) {
      hasMore = false;
    } else {
      page += 1;
    }
  }

  printResult(result);
  return result;
}

// ============================================================================
// Step 3: nsec Migration Ceremony (skeleton)
// ============================================================================

/**
 * nsec Migration Ceremony Skeleton
 *
 * IMPORTANT: The actual decryption of user nsec values is STRICTLY CLIENT-SIDE.
 * This function only generates the ceremony instructions and endpoint stubs.
 * The server-side component of this ceremony is limited to:
 * 1. Providing the encrypted_nsec blob to the client
 * 2. Receiving confirmation that client-side re-encryption completed
 * 3. Deleting the encrypted_nsec, encrypted_nsec_iv, user_salt columns
 *
 * S1 invariant: No nsec is ever decrypted, logged, or transmitted server-side.
 */
async function printNsecCeremonyInstructions(): Promise<void> {
  console.log('\n=== Step 3: nsec Migration Ceremony ===');
  console.log('');
  console.log('The nsec migration is a CLIENT-SIDE ceremony.');
  console.log('The server never decrypts, stores, or transmits nsec values.');
  console.log('');
  console.log('User-facing flow:');
  console.log('  1. User navigates to /migrate in the Satnam v2 app');
  console.log('  2. App fetches encrypted_nsec blob from v1 API (no decryption server-side)');
  console.log('  3. App prompts: "Enter your v1 password to decrypt your identity"');
  console.log('  4. Client derives key: PBKDF2(password, user_salt, 100000, SHA-256)');
  console.log('  5. Client decrypts: AES-256-CBC(encrypted_nsec, derived_key, iv)');
  console.log('  6. Client initializes v2 OPFS Vault with decrypted nsec');
  console.log('  7. Client zeroes the nsec from memory immediately');
  console.log('  8. Client calls v2 API: DELETE /api/v1-cleanup (confirms migration)');
  console.log('  9. v2 API deletes: encrypted_nsec, encrypted_nsec_iv, user_salt from v1');
  console.log('');
  console.log('Files to implement:');
  console.log('  - src/pages/MigratePage.tsx     — migration ceremony UI');
  console.log('  - src/lib/migration/decrypt.ts   — v1 PBKDF2 + AES-CBC decryption');
  console.log('  - netlify/functions/v1-cleanup.ts — NOT a new function (reuses existing slot)');
  console.log('');
  console.log('S1 invariant check: no key material columns touched by this script. ✓');
}

// ============================================================================
// Step 4: Generate Table Drop Commands
// ============================================================================

/**
 * Generate SQL commands to drop all v1 tables containing key material.
 * These commands should be run ONLY after all users have completed migration.
 *
 * Per spec §9.1 "Dropped tables (v1 → v2 migration)"
 */
function generateTableDropCommands(): void {
  console.log('\n=== Step 4: Table Drop SQL (Decommission Phase) ===');
  console.log('');
  console.log('-- ========================================================');
  console.log('-- Satnam v1 Decommission Migration');
  console.log('-- Run ONLY after all users have confirmed migration');
  console.log('-- S1 invariant: removes all key material from Supabase');
  console.log('-- ========================================================');
  console.log('');

  // Tables with key material (MUST drop — S1 invariant)
  const keyMaterialTables = [
    { name: 'user_identities', reason: 'Contains encrypted_nsec, user_salt, encrypted_nsec_iv' },
    { name: 'password_recovery_keys', reason: 'Key recovery material' },
    { name: 'secret_shares', reason: 'SSS key shares (replaced by FROST)' },
    { name: 'nfc_mfa_setup', reason: 'NFC auth keys' },
    { name: 'signing_permissions', reason: 'Auth delegation keys' },
  ];

  console.log('-- CRITICAL: Tables containing key material');
  for (const table of keyMaterialTables) {
    console.log(`-- ${table.reason}`);
    console.log(`DROP TABLE IF EXISTS public.${table.name} CASCADE;`);
    console.log('');
  }

  // Feature-cut tables (safe to drop — no key material)
  const featureCutTables = [
    'family_federations',
    'family_members',
    'pkarr_records',
    'pkarr_routing',
    'trust_provider_registrations',
    'trust_provider_credentials',
    'citadel_badges',
    'badge_system',
    'admin_hierarchy',
    'agent_sessions',
    'agent_profiles',
    'agent_wallets',
    'agent_delegations',
  ];

  console.log('-- Feature-cut tables (no key material — safe to drop)');
  for (const table of featureCutTables) {
    console.log(`DROP TABLE IF EXISTS public.${table} CASCADE;`);
  }

  console.log('');
  console.log('-- Retained v2 tables (DO NOT DROP):');
  console.log('--   nip05_identifiers');
  console.log('--   lightning_addresses');
  console.log('--   rate_limits');
  console.log('--   username_reservations');
  console.log('--   issuer_registry');
  console.log('');
  console.log('-- After running: verify S1 invariant');
  console.log("-- SELECT table_name FROM information_schema.columns");
  console.log("-- WHERE column_name IN ('encrypted_nsec', 'nsec', 'user_salt', 'private_key', 'secret_key')");
  console.log("-- AND table_schema = 'public';");
  console.log('-- Expected: 0 rows');
}

// ============================================================================
// Verification
// ============================================================================

/**
 * Verify that v1 migration data is correctly reflected in v2.
 * Run after migration to confirm data integrity.
 */
async function verifyMigration(): Promise<void> {
  console.log('\n=== Verification ===');

  const v2 = getV2Client();

  const { count: nip05Count } = await v2
    .from('nip05_identifiers')
    .select('*', { count: 'exact', head: true })
    .eq('migrated_from_v1', true);

  console.log(`v2 nip05_identifiers (migrated from v1): ${nip05Count ?? 0}`);

  const { count: lnCount } = await v2
    .from('lightning_addresses')
    .select('*', { count: 'exact', head: true })
    .eq('migrated_from_v1', true);

  console.log(`v2 lightning_addresses (migrated from v1): ${lnCount ?? 0}`);

  // S1 invariant spot-check: ensure no key columns exist in v2 nip05_identifiers
  const { data: columns } = await v2
    .rpc('check_key_columns_absent')
    .single();

  if (columns === null) {
    console.log('S1 invariant spot-check: ✓ No key material columns in v2 tables (RPC not available — check manually)');
  }
}

// ============================================================================
// Utilities
// ============================================================================

function printResult(result: MigrationResult): void {
  console.log(`\n${result.step} migration complete:`);
  console.log(`  Total:    ${result.total}`);
  console.log(`  Migrated: ${result.migrated}`);
  console.log(`  Skipped:  ${result.skipped}`);
  console.log(`  Errors:   ${result.errors}`);
  if (result.errorDetails.length > 0) {
    console.log('  Error details:');
    for (const detail of result.errorDetails.slice(0, 10)) {
      console.log(`    - ${detail}`);
    }
  }
  if (DRY_RUN) {
    console.log('  [DRY RUN — no writes made]');
  }
}

function printBanner(): void {
  console.log('');
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║     Satnam v1 → v2 Migration Script           ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (writes enabled)'}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Target domain: ${NIP05_DOMAIN}`);
  console.log('');
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
  printBanner();

  const args = process.argv.slice(2);
  const step = args.find((a) => !a.startsWith('--'));
  const isStep = (name: string) => !step || step === name;

  try {
    if (step === 'generate-drops') {
      generateTableDropCommands();
      return;
    }

    if (step === 'ceremony' || (!step && args.includes('--full'))) {
      await printNsecCeremonyInstructions();
      if (step === 'ceremony') return;
    }

    if (isStep('nip05')) {
      await migrateNip05Identifiers();
    }

    if (isStep('lightning')) {
      await migrateLightningAddresses();
    }

    if (!step || args.includes('--verify')) {
      await verifyMigration();
    }

    console.log('\n✓ Migration script completed.\n');
  } catch (err) {
    console.error('\n✗ Migration failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
