/**
 * @module sig4sats/bond-manager
 * @description BondManager — manages all 3 Sig4Sats bond types with OPFS Vault storage.
 *
 * All bond data is encrypted at rest in the OPFS Vault under the path:
 *   satnam/sig4sats/bonds.json
 *
 * The manager maintains a local cache and flushes to vault on every write
 * operation. No bond data ever touches unencrypted persistent storage.
 *
 * @see sig4sats/types.ts — bond type definitions
 * @see sig4sats/adaptor.ts — adaptor signature utilities
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes, randomBytes } from '@noble/hashes/utils';
import type { Vault } from '../vault/vault.js';
import type {
  Sig4SatsBond,
  EntitlementBond,
  RecoveryBond,
  AllowanceBond,
  GuardianBond,
  BondType,
  CreateEntitlementParams,
  CreateRecoveryParams,
  CreateAllowanceParams,
  SpendResult,
  AllowanceConstraints,
} from './types.js';
import { generateAdaptorPoint } from './adaptor.js';

// ============================================================================
// Storage helpers
// ============================================================================

const VAULT_PATH_PREFIX = 'sig4sats';
const BONDS_FILE = 'bonds.json';


function generateId(prefix: string): string {
  const rand = randomBytes(12);
  return `${prefix}-${bytesToHex(rand)}`;
}

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

// ============================================================================
// BondManager
// ============================================================================

/**
 * BondManager — full lifecycle manager for all 3 Sig4Sats bond types.
 *
 * All persistence goes through the OPFS Vault (AES-256-GCM encrypted).
 * No bond data ever touches localStorage, sessionStorage, or any unencrypted
 * persistent storage. The vault must be unlocked before write operations.
 *
 * @example
 * ```ts
 * const manager = new BondManager(vault);
 * const bond = await manager.createEntitlementBond({
 *   featureId: 'premium-agents',
 *   amount: 500,
 *   mintUrl: 'https://mint.minibits.cash/Bitcoin',
 * });
 * const valid = await manager.validateEntitlementToken('premium-agents', bond.blindedToken);
 * ```
 */
export class BondManager {
  /** In-memory bond cache — keyed by bond ID */
  private bonds: Map<string, Sig4SatsBond> = new Map();
  /** Whether the cache has been hydrated from vault storage */
  private loaded = false;

  /**
   * @param vault - OPFS Vault instance. Must be unlocked for all write
   *   operations. Read-only operations (validate, list) also require unlock
   *   because bonds are encrypted at rest.
   */
  constructor(private readonly vault: Vault) {}

  // -------------------------------------------------------------------------
  // Persistence (vault — AES-256-GCM encrypted OPFS)
  // -------------------------------------------------------------------------

  /**
   * Persist the bond cache to the OPFS Vault.
   *
   * Serializes the current in-memory bond map to JSON and writes it to
   * `satnam/sig4sats/bonds.json` in the vault. The vault write is atomic
   * at the file level — partial writes are not possible.
   *
   * @internal
   */
  private async persist(): Promise<void> {
    const payload = JSON.stringify(
      Array.from(this.bonds.entries()).map(([id, bond]) => ({ id, bond }))
    );
    await this.vault.storeSig4SatsBonds(payload);
  }

  /**
   * Hydrate the bond cache from the OPFS Vault.
   *
   * Reads `satnam/sig4sats/bonds.json` from the vault and populates the
   * in-memory bond map. Called lazily on first access; subsequent calls are
   * no-ops if `this.loaded` is already true.
   *
   * @internal
   */
  private async hydrate(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await this.vault.getSig4SatsBonds();
      if (!raw) return;
      const entries = JSON.parse(raw) as Array<{ id: string; bond: Sig4SatsBond }>;
      for (const { id, bond } of entries) {
        this.bonds.set(id, bond);
      }
    } catch {
      // VaultError.IdentityNotFound → no bonds yet, start fresh
      // Any other error: corrupt data — start fresh rather than crashing
      this.bonds.clear();
    }
  }

  // -------------------------------------------------------------------------
  // Bond 1: Entitlement Tokens
  // -------------------------------------------------------------------------

  /**
   * Create an entitlement bond.
   *
   * Simulates the flow:
   *   1. Generate adaptor point for the entitlement payment
   *   2. Create a blinded token (in production: Cashu-minted blind sig)
   *   3. Store bond in vault
   *
   * @param params - Entitlement bond parameters
   * @returns The created EntitlementBond
   */
  async createEntitlementBond(params: CreateEntitlementParams): Promise<EntitlementBond> {
    await this.hydrate();

    const { featureId, amount, mintUrl, ttlSeconds = 30 * 24 * 3600 } = params;
    const now = nowSecs();

    // Generate adaptor point (in production: provided by the service)
    const { adaptorPoint } = generateAdaptorPoint();

    // Create a deterministic blinded token from featureId + timestamp + random
    const tokenMaterial = new Uint8Array([
      ...utf8ToBytes(featureId),
      ...utf8ToBytes(String(now)),
      ...randomBytes(16),
    ]);
    const blindedToken = bytesToHex(sha256(tokenMaterial));

    // In production: pay Cashu to mint, receive entitlement event ID from service
    const entitlementEventId = generateId('ent-event');

    const bond: EntitlementBond = {
      type: 'entitlement',
      featureId,
      amount,
      blindedToken,
      entitlementEventId,
      mintUrl,
      expiresAt: now + ttlSeconds,
      status: 'active',
      createdAt: now,
    };

    const bondId = generateId('ent');
    this.bonds.set(bondId, bond);
    await this.persist();

    return bond;
  }

  /**
   * Validate an entitlement token for a given feature.
   *
   * @param featureId - The feature to check access for
   * @param token - The blinded token to validate
   * @returns true if the token is active, not expired, and matches the feature
   */
  async validateEntitlementToken(featureId: string, token: string): Promise<boolean> {
    await this.hydrate();

    const now = nowSecs();
    for (const bond of this.bonds.values()) {
      if (
        bond.type === 'entitlement' &&
        bond.featureId === featureId &&
        bond.blindedToken === token &&
        bond.status === 'active' &&
        bond.expiresAt > now
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Spend an entitlement token — marks it as consumed.
   *
   * @param featureId - Feature ID to spend the token for
   * @returns true if a token was found and spent, false if none available
   */
  async spendEntitlementToken(featureId: string): Promise<boolean> {
    await this.hydrate();

    const now = nowSecs();
    for (const [id, bond] of this.bonds.entries()) {
      if (
        bond.type === 'entitlement' &&
        bond.featureId === featureId &&
        bond.status === 'active' &&
        bond.expiresAt > now
      ) {
        const updated: EntitlementBond = { ...bond, status: 'spent' };
        this.bonds.set(id, updated);
        await this.persist();
        return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Bond 2: Recovery Bonds
  // -------------------------------------------------------------------------

  /**
   * Initiate a guardian recovery bond collection.
   *
   * Creates a recovery bond in 'collecting' status. Guardians then call
   * addGuardianBond() to contribute their stakes.
   *
   * @param params - Recovery bond parameters
   * @returns The created RecoveryBond
   */
  async createRecoveryBond(params: CreateRecoveryParams): Promise<RecoveryBond> {
    await this.hydrate();

    const { recoveryEventId, guardians, threshold, ttlSeconds = 7 * 24 * 3600 } = params;
    const now = nowSecs();

    if (threshold > guardians.length) {
      throw new Error(
        `Threshold ${threshold} exceeds guardian count ${guardians.length}`
      );
    }

    const guardianBonds: GuardianBond[] = guardians.map((g) => ({
      guardianPubkey: g.pubkey,
      bondAmount: g.expectedBondAmount,
      signed: false,
      bondProofId: '',
      bondedAt: 0,
    }));

    const bond: RecoveryBond = {
      type: 'recovery',
      recoveryEventId,
      guardianBonds,
      threshold,
      totalGuardians: guardians.length,
      expiresAt: now + ttlSeconds,
      status: 'collecting',
      createdAt: now,
    };

    const bondId = generateId('rec');
    this.bonds.set(bondId, bond);
    await this.persist();

    return bond;
  }

  /**
   * Record a guardian's bond contribution and signature.
   *
   * @param recoveryEventId - The recovery event ID to add the bond to
   * @param guardianPubkey - The guardian's pubkey
   * @param bondProof - The Cashu proof ID for the staked bond
   * @returns Updated RecoveryBond, or null if not found
   */
  async addGuardianBond(
    recoveryEventId: string,
    guardianPubkey: string,
    bondProof: string
  ): Promise<RecoveryBond | null> {
    await this.hydrate();

    for (const [id, bond] of this.bonds.entries()) {
      if (bond.type !== 'recovery' || bond.recoveryEventId !== recoveryEventId) continue;
      if (bond.status !== 'collecting') return null;

      const guardianIndex = bond.guardianBonds.findIndex(
        (g) => g.guardianPubkey === guardianPubkey
      );
      if (guardianIndex === -1) {
        throw new Error(`Guardian ${guardianPubkey} not in recovery bond`);
      }

      const updatedGuardians = [...bond.guardianBonds];
      updatedGuardians[guardianIndex] = {
        ...updatedGuardians[guardianIndex],
        signed: true,
        bondProofId: bondProof,
        bondedAt: nowSecs(),
      };

      const signedCount = updatedGuardians.filter((g) => g.signed).length;
      const newStatus = signedCount >= bond.threshold ? 'threshold_met' : 'collecting';

      const updated: RecoveryBond = {
        ...bond,
        guardianBonds: updatedGuardians,
        status: newStatus,
      };

      this.bonds.set(id, updated);
      await this.persist();
      return updated;
    }

    return null;
  }

  /**
   * Execute a recovery — issues the recovery capability token once threshold is met.
   *
   * @param recoveryEventId - The recovery event ID to execute
   * @returns The recovery token string, or null if threshold not met / not found
   */
  async executeRecovery(recoveryEventId: string): Promise<string | null> {
    await this.hydrate();

    for (const [id, bond] of this.bonds.entries()) {
      if (bond.type !== 'recovery' || bond.recoveryEventId !== recoveryEventId) continue;

      const signedCount = bond.guardianBonds.filter((g) => g.signed).length;
      if (signedCount < bond.threshold) {
        throw new Error(
          `Cannot execute: ${signedCount}/${bond.threshold} signatures collected`
        );
      }

      // Generate recovery capability token
      const tokenMaterial = new Uint8Array([
        ...utf8ToBytes(recoveryEventId),
        ...utf8ToBytes(String(nowSecs())),
        ...randomBytes(16),
      ]);
      const recoveryToken = bytesToHex(sha256(tokenMaterial));

      const updated: RecoveryBond = {
        ...bond,
        recoveryToken,
        status: 'executed',
      };

      this.bonds.set(id, updated);
      await this.persist();
      return recoveryToken;
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Bond 3: Allowance Tokens
  // -------------------------------------------------------------------------

  /**
   * Create an allowance bond and issue blinded spending tokens.
   *
   * @param params - Allowance bond parameters
   * @returns The created AllowanceBond
   */
  async createAllowanceBond(params: CreateAllowanceParams): Promise<AllowanceBond> {
    await this.hydrate();

    const {
      recipientPubkey,
      totalAmount,
      tokenDenomination,
      cadence,
      constraints,
      mintUrl,
    } = params;

    if (tokenDenomination <= 0) {
      throw new Error('Token denomination must be positive');
    }
    if (totalAmount < tokenDenomination) {
      throw new Error('Total amount must be at least one token denomination');
    }

    const tokenCount = Math.floor(totalAmount / tokenDenomination);
    const now = nowSecs();

    // Compute next refresh timestamp
    const refreshOffsets: Record<string, number> = {
      daily: 86400,
      weekly: 7 * 86400,
      monthly: 30 * 86400,
    };
    const nextRefreshAt = now + refreshOffsets[cadence];

    const bond: AllowanceBond = {
      type: 'allowance',
      guardianPubkey: '', // Set by caller context (guardian's own pubkey)
      recipientPubkey,
      totalAmount,
      tokenDenomination,
      tokenCount,
      tokensSpent: 0,
      cadence,
      nextRefreshAt,
      constraints,
      mintUrl,
      status: 'active',
      createdAt: now,
    };

    const bondId = generateId('alw');
    this.bonds.set(bondId, bond);
    await this.persist();

    return bond;
  }

  /**
   * Spend an allowance token for a recipient.
   *
   * Validates the spend against constraints before consuming.
   *
   * @param recipientPubkey - Recipient's pubkey
   * @param amount - Amount to spend in sats
   * @param rail - Payment rail being used
   * @returns SpendResult with remaining tokens and success status
   */
  async spendAllowanceToken(
    recipientPubkey: string,
    amount: number,
    rail: 'lightning' | 'cashu' = 'lightning'
  ): Promise<SpendResult> {
    await this.hydrate();

    for (const [id, bond] of this.bonds.entries()) {
      if (
        bond.type !== 'allowance' ||
        bond.recipientPubkey !== recipientPubkey ||
        bond.status !== 'active'
      ) continue;

      const tokensAvailable = bond.tokenCount - bond.tokensSpent;

      // Validate constraints
      if (amount > bond.constraints.maxSingleSpend) {
        return {
          success: false,
          tokensRemaining: tokensAvailable,
          amountSpent: 0,
          error: `Amount ${amount} exceeds single spend limit ${bond.constraints.maxSingleSpend}`,
        };
      }

      if (!bond.constraints.allowedRails.includes(rail)) {
        return {
          success: false,
          tokensRemaining: tokensAvailable,
          amountSpent: 0,
          error: `Rail '${rail}' is not allowed for this allowance`,
        };
      }

      // Calculate tokens needed (round up)
      const tokensNeeded = Math.ceil(amount / bond.tokenDenomination);
      if (tokensNeeded > tokensAvailable) {
        return {
          success: false,
          tokensRemaining: tokensAvailable,
          amountSpent: 0,
          error: `Insufficient tokens: need ${tokensNeeded}, have ${tokensAvailable}`,
        };
      }

      const newTokensSpent = bond.tokensSpent + tokensNeeded;
      const newStatus =
        newTokensSpent >= bond.tokenCount ? 'depleted' : 'active';

      const updated: AllowanceBond = {
        ...bond,
        tokensSpent: newTokensSpent,
        status: newStatus,
        lastSpentAt: nowSecs(),
      };

      this.bonds.set(id, updated);
      await this.persist();

      return {
        success: true,
        tokensRemaining: bond.tokenCount - newTokensSpent,
        amountSpent: tokensNeeded * bond.tokenDenomination,
      };
    }

    return {
      success: false,
      tokensRemaining: 0,
      amountSpent: 0,
      error: `No active allowance found for ${recipientPubkey}`,
    };
  }

  /**
   * Get the remaining token balance for a recipient.
   *
   * @param recipientPubkey - Recipient's pubkey
   * @returns Object with token count, sats value, and bond status
   */
  async getAllowanceBalance(recipientPubkey: string): Promise<{
    tokensRemaining: number;
    satsRemaining: number;
    status: AllowanceBond['status'] | 'not_found';
  }> {
    await this.hydrate();

    for (const bond of this.bonds.values()) {
      if (bond.type === 'allowance' && bond.recipientPubkey === recipientPubkey) {
        const tokensRemaining = bond.tokenCount - bond.tokensSpent;
        return {
          tokensRemaining,
          satsRemaining: tokensRemaining * bond.tokenDenomination,
          status: bond.status,
        };
      }
    }

    return { tokensRemaining: 0, satsRemaining: 0, status: 'not_found' };
  }

  // -------------------------------------------------------------------------
  // Listing & Querying
  // -------------------------------------------------------------------------

  /**
   * List all bonds, optionally filtered by type.
   *
   * @param type - Optional bond type filter
   * @returns Array of bonds with their IDs
   */
  async listBonds(type?: BondType): Promise<Array<{ id: string; bond: Sig4SatsBond }>> {
    await this.hydrate();

    const result: Array<{ id: string; bond: Sig4SatsBond }> = [];
    for (const [id, bond] of this.bonds.entries()) {
      if (!type || bond.type === type) {
        result.push({ id, bond });
      }
    }

    // Sort by creation time (newest first)
    return result.sort((a, b) => {
      const aTime = (a.bond as EntitlementBond).createdAt ?? 0;
      const bTime = (b.bond as EntitlementBond).createdAt ?? 0;
      return bTime - aTime;
    });
  }

  /**
   * Get a single bond by ID.
   *
   * @param bondId - Bond ID to look up
   * @returns The bond, or undefined if not found
   */
  async getBond(bondId: string): Promise<Sig4SatsBond | undefined> {
    await this.hydrate();
    return this.bonds.get(bondId);
  }

  /**
   * Expire bonds that have passed their expiry timestamp.
   * Should be called periodically (e.g., on app focus).
   *
   * @returns Number of bonds expired
   */
  async expireStaleBonds(): Promise<number> {
    await this.hydrate();

    const now = nowSecs();
    let count = 0;

    for (const [id, bond] of this.bonds.entries()) {
      if (bond.type === 'entitlement' && bond.expiresAt <= now && bond.status === 'active') {
        this.bonds.set(id, { ...bond, status: 'expired' });
        count++;
      } else if (bond.type === 'recovery' && bond.expiresAt <= now && bond.status === 'collecting') {
        this.bonds.set(id, { ...bond, status: 'expired' });
        count++;
      }
    }

    if (count > 0) await this.persist();
    return count;
  }

  /**
   * Clear all bonds (for testing / reset).
   */
  async clearAll(): Promise<void> {
    this.bonds.clear();
    this.loaded = false;
    try {
      await this.vault.storeSig4SatsBonds('[]');
    } catch {
      // ignore — vault may not be unlocked during test teardown
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _bondManagerInstance: BondManager | null = null;

/**
 * Get the module-level BondManager singleton.
 *
 * @param vault - OPFS Vault instance. Required on first call to initialize
 *   the singleton. Subsequent calls return the existing instance.
 */
export function getBondManager(vault: Vault): BondManager {
  if (!_bondManagerInstance) {
    _bondManagerInstance = new BondManager(vault);
  }
  return _bondManagerInstance;
}

