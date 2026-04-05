/**
 * @module agent/wallet/spend-policy
 * @description Agent spend policy enforcement for Satnam v2.
 *
 * Implements the `AgentSpendPolicy` schema from spec §6.3 and extends the
 * stateless rail selection utilities from `helpers.ts` with full policy
 * enforcement: per-transaction limits, rolling 24h spend tracking,
 * human-in-the-loop approval thresholds, and auto-sweep logic.
 *
 * ## Design
 * - Stateless policy validation — no in-memory spend counters
 * - Rolling 24h spend is persisted in IndexedDB (`satnam-agent-spend-ledger`)
 * - Rail selection delegates to the existing `selectSpendRail()` in helpers.ts
 *   but adds policy constraints (allowed_mints, max_single_spend)
 * - Approval required above `requires_approval_above_msats` threshold
 * - Auto-sweep is evaluated but never executed automatically — it returns a
 *   recommendation that the agent runtime acts on
 *
 * ## Porting note
 * Ported from v1 `agent-wallet-helpers.ts`. The `AgentSpendPolicy` interface
 * is schema-compatible with the v1 field names, preserving BigInt msats math.
 *
 * @see phase2-spec-sections.md §6.3 — Agent Wallet
 */

import {
  selectSpendRail,
  normalizeRail,
  normalizePrivacyPreference,
} from './helpers.js';
import type { SpendRail, PrivacyPreference, RailSelectionInput } from './helpers.js';

// ---------------------------------------------------------------------------
// Policy interface (spec §6.3)
// ---------------------------------------------------------------------------

/**
 * Spend policy for an autonomous agent, set by the agent's Governor
 * (Guardian or Steward). All Lightning amounts are in millisatoshis (bigint).
 *
 * Policy fields map directly to the v1 `agent_profiles.spend_policy` JSON column.
 */
export interface AgentSpendPolicy {
  /**
   * Maximum amount for a single transaction.
   * Payments above this limit are rejected unconditionally.
   * @unit millisatoshis
   */
  max_single_spend_msats: bigint;

  /**
   * Rolling 24-hour spending limit across all rails.
   * The agent's spend ledger is checked before each payment.
   * @unit millisatoshis
   */
  daily_limit_msats: bigint;

  /**
   * Threshold above which a human approval signal is required before
   * the payment is executed. Approval signals are NIP-47 confirmation events
   * signed by the Governor.
   * @unit millisatoshis
   */
  requires_approval_above_msats: bigint;

  /**
   * Preferred spend rail for this agent:
   * - `'lightning'` — always use NWC/Lightning
   * - `'cashu'` — always use Cashu eCash
   * - `'auto'` — select based on amount and privacy preference
   */
  preferred_spend_rail: 'lightning' | 'cashu' | 'auto';

  /**
   * Cashu mint URLs this agent is permitted to use.
   * Payments using Cashu proofs from unlisted mints are rejected.
   */
  allowed_mints: string[];

  /**
   * When the agent's Lightning balance (via NWC get_balance) exceeds this
   * threshold, the auto-sweep recommendation is triggered.
   * @unit millisatoshis
   */
  sweep_threshold_msats: bigint;

  /**
   * Destination for auto-sweep: either an NWC connection ID (UUID) or a
   * Cashu mint URL. The runtime determines which based on `sweep_rail`.
   */
  sweep_destination: string;

  /**
   * Rail to use for auto-sweep:
   * - `'lightning'` — sweep to another NWC connection
   * - `'cashu'` — mint Cashu tokens from excess Lightning balance
   */
  sweep_rail: 'lightning' | 'cashu';
}

// ---------------------------------------------------------------------------
// Policy enforcement result types
// ---------------------------------------------------------------------------

/**
 * Result of a spend policy check.
 */
export type PolicyCheckResult =
  | { allowed: true; rail: SpendRail; requiresApproval: false }
  | { allowed: true; rail: SpendRail; requiresApproval: true; approvalReason: string }
  | { allowed: false; reason: string };

/**
 * Auto-sweep recommendation returned by evaluateSweep().
 */
export interface SweepRecommendation {
  /** Whether a sweep is recommended at this moment. */
  shouldSweep: boolean;

  /**
   * Amount to sweep in millisatoshis.
   * Only present when shouldSweep is true.
   */
  sweepAmountMsats?: bigint;

  /**
   * Destination identifier (NWC connection ID or mint URL).
   * Only present when shouldSweep is true.
   */
  destination?: string;

  /** Rail to use for the sweep. Only present when shouldSweep is true. */
  rail?: 'lightning' | 'cashu';
}

// ---------------------------------------------------------------------------
// Spend ledger (IndexedDB)
// ---------------------------------------------------------------------------

const LEDGER_DB_NAME = 'satnam-agent-spend-ledger';
const LEDGER_STORE = 'spends';

interface SpendRecord {
  id: string;         // UUID
  agentPubkey: string;
  amountMsats: string; // serialized bigint
  timestamp: number;   // Unix seconds
  rail: SpendRail;
}

function openLedgerDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LEDGER_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(LEDGER_STORE, { keyPath: 'id' });
      store.createIndex('by_agent_ts', ['agentPubkey', 'timestamp']);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Record a completed spend in the rolling ledger.
 *
 * @param agentPubkey - Hex pubkey of the spending agent
 * @param amountMsats - Amount spent in millisatoshis
 * @param rail - Payment rail used
 */
export async function recordSpend(
  agentPubkey: string,
  amountMsats: bigint,
  rail: SpendRail,
): Promise<void> {
  const db = await openLedgerDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEDGER_STORE, 'readwrite');
    const record: SpendRecord = {
      id: crypto.randomUUID(),
      agentPubkey,
      amountMsats: amountMsats.toString(),
      timestamp: Math.floor(Date.now() / 1000),
      rail,
    };
    const req = tx.objectStore(LEDGER_STORE).put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Compute the rolling 24-hour spend total for an agent.
 *
 * @param agentPubkey - Hex pubkey of the agent
 * @returns Total amount spent in the past 24 hours, in millisatoshis
 */
export async function getRolling24hSpend(agentPubkey: string): Promise<bigint> {
  const db = await openLedgerDb();
  const cutoff = Math.floor(Date.now() / 1000) - 86400; // 24h ago

  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEDGER_STORE, 'readonly');
    const req = tx.objectStore(LEDGER_STORE).getAll();
    req.onsuccess = () => {
      const records = (req.result as SpendRecord[]).filter(
        (r) => r.agentPubkey === agentPubkey && r.timestamp >= cutoff,
      );
      const total = records.reduce(
        (sum, r) => sum + BigInt(r.amountMsats),
        0n,
      );
      resolve(total);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Prune spend records older than 30 days (maintenance helper).
 * Should be called periodically, e.g. on agent startup.
 *
 * @param agentPubkey - Hex pubkey of the agent whose records to prune
 */
export async function pruneOldSpendRecords(agentPubkey: string): Promise<void> {
  const db = await openLedgerDb();
  const cutoff = Math.floor(Date.now() / 1000) - 30 * 86400; // 30 days ago

  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEDGER_STORE, 'readwrite');
    const store = tx.objectStore(LEDGER_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const toDelete = (req.result as SpendRecord[]).filter(
        (r) => r.agentPubkey === agentPubkey && r.timestamp < cutoff,
      );
      for (const record of toDelete) {
        store.delete(record.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Core policy enforcement
// ---------------------------------------------------------------------------

/**
 * Check whether a proposed spend is permitted under the agent's policy.
 *
 * This is the primary enforcement function. It checks:
 * 1. Amount does not exceed `max_single_spend_msats`
 * 2. Rolling 24h spend + this amount does not exceed `daily_limit_msats`
 * 3. If using Cashu, the mint URL is in `allowed_mints`
 * 4. Whether `requires_approval_above_msats` is exceeded → requiresApproval
 *
 * This function is PURE with respect to the ledger: it reads but does not
 * write. Call `recordSpend()` after a successful payment to update the ledger.
 *
 * @param agentPubkey - Hex pubkey of the spending agent (for ledger lookup)
 * @param amountMsats - Proposed spend amount in millisatoshis
 * @param policy - The agent's spend policy
 * @param options - Additional context for rail selection
 * @returns PolicyCheckResult — check `.allowed` before proceeding
 */
export async function checkSpendPolicy(
  agentPubkey: string,
  amountMsats: bigint,
  policy: AgentSpendPolicy,
  options: {
    privacyPreference?: PrivacyPreference;
    hasLightningTarget?: boolean;
    hasCashuCapability?: boolean;
    cashuBalanceSats?: number;
    mintUrl?: string; // if using Cashu, which mint
  } = {},
): Promise<PolicyCheckResult> {
  const {
    privacyPreference = 'balanced',
    hasLightningTarget = true,
    hasCashuCapability = false,
    cashuBalanceSats,
    mintUrl,
  } = options;

  // --- Check 1: Per-transaction limit ---
  if (amountMsats > policy.max_single_spend_msats) {
    return {
      allowed: false,
      reason: `Amount ${amountMsats} msats exceeds per-transaction limit ${policy.max_single_spend_msats} msats`,
    };
  }

  // --- Check 2: Rolling 24h limit ---
  const spent24h = await getRolling24hSpend(agentPubkey);
  if (spent24h + amountMsats > policy.daily_limit_msats) {
    return {
      allowed: false,
      reason: `Amount would exceed 24h rolling limit. Already spent: ${spent24h} msats, limit: ${policy.daily_limit_msats} msats`,
    };
  }

  // --- Check 3: Mint allowlist (if using Cashu) ---
  const railInput: RailSelectionInput = {
    requestedRail: 'auto',
    preferredRail: normalizeRail(policy.preferred_spend_rail),
    privacyPreference: normalizePrivacyPreference(privacyPreference),
    amountSats: Number(amountMsats / 1000n),
    hasLightningTarget,
    hasCashuCapability,
    cashuBalanceSats,
  };
  const selectedRail = selectSpendRail(railInput);

  if (selectedRail === 'cashu') {
    if (mintUrl && policy.allowed_mints.length > 0) {
      const normalizedMint = mintUrl.trim().replace(/\/+$/, '');
      const isAllowed = policy.allowed_mints.some(
        (m) => m.trim().replace(/\/+$/, '') === normalizedMint,
      );
      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Cashu mint ${mintUrl} is not in the agent's allowed_mints list`,
        };
      }
    }
  }

  // --- Check 4: Approval threshold ---
  if (amountMsats > policy.requires_approval_above_msats) {
    return {
      allowed: true,
      rail: selectedRail,
      requiresApproval: true,
      approvalReason: `Amount ${amountMsats} msats exceeds approval threshold ${policy.requires_approval_above_msats} msats`,
    };
  }

  return {
    allowed: true,
    rail: selectedRail,
    requiresApproval: false,
  };
}

// ---------------------------------------------------------------------------
// Rail selection (spec §6.3, ported from helpers.ts)
// ---------------------------------------------------------------------------

/**
 * Select the optimal payment rail for an agent spend, incorporating policy
 * constraints.
 *
 * This extends the stateless `selectSpendRail()` from helpers.ts by:
 * 1. Respecting `policy.preferred_spend_rail` as the primary signal
 * 2. Using privacy preference to break ties when rail is 'auto'
 * 3. Routing sub-1000 msats to Cashu (sub-sat routing uneconomical on LN)
 *
 * Per spec §6.3:
 * > Sub-1-sat routing uneconomical on LN
 *
 * @param amountMsats - Amount in millisatoshis
 * @param policy - Agent spend policy
 * @param privacyPreference - User/agent privacy preference
 * @returns The selected payment rail
 */
export function selectAgentSpendRail(
  amountMsats: bigint,
  policy: AgentSpendPolicy,
  privacyPreference: PrivacyPreference = 'balanced',
): 'lightning' | 'cashu' {
  // Spec §6.3 override: explicit non-auto preference always wins
  if (policy.preferred_spend_rail !== 'auto') {
    return policy.preferred_spend_rail;
  }

  // Spec §6.3: privacy_preference === 'high' → cashu
  if (privacyPreference === 'high') return 'cashu';

  // Spec §6.3: amount_msats < 1000 → cashu (sub-1-sat routing uneconomical on LN)
  if (amountMsats < 1000n) return 'cashu';

  return 'lightning';
}

// ---------------------------------------------------------------------------
// Auto-sweep evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether an auto-sweep should be triggered for an agent.
 *
 * This function is PURE (no side effects) — it returns a recommendation.
 * The agent runtime is responsible for executing the sweep via NWC/Cashu.
 *
 * A sweep is recommended when the agent's Lightning balance exceeds
 * `policy.sweep_threshold_msats`. The sweep amount is the excess above the
 * threshold, leaving the threshold amount in the Lightning wallet.
 *
 * @param currentBalanceMsats - Agent's current Lightning balance in millisatoshis
 * @param policy - Agent spend policy
 * @returns SweepRecommendation
 */
export function evaluateSweep(
  currentBalanceMsats: bigint,
  policy: AgentSpendPolicy,
): SweepRecommendation {
  if (currentBalanceMsats <= policy.sweep_threshold_msats) {
    return { shouldSweep: false };
  }

  const sweepAmountMsats = currentBalanceMsats - policy.sweep_threshold_msats;

  return {
    shouldSweep: true,
    sweepAmountMsats,
    destination: policy.sweep_destination,
    rail: policy.sweep_rail,
  };
}

// ---------------------------------------------------------------------------
// Default policy factory
// ---------------------------------------------------------------------------

/**
 * Create a conservative default spend policy suitable for an Offspring-role
 * agent. Guardian/Steward should customize limits before deploying the agent.
 *
 * Defaults:
 * - Max single spend: 10,000 sats (10M msats)
 * - Daily limit: 100,000 sats (100B msats)
 * - Approval threshold: 1,000 sats (1M msats)
 * - Preferred rail: auto
 * - Allowed mints: [] (all mints blocked until explicitly configured)
 * - Sweep threshold: 500,000 sats (500B msats)
 *
 * @param overrides - Partial policy overrides
 * @returns A complete AgentSpendPolicy
 */
export function createDefaultSpendPolicy(
  overrides: Partial<AgentSpendPolicy> = {},
): AgentSpendPolicy {
  return {
    max_single_spend_msats: 10_000_000n,       // 10,000 sats
    daily_limit_msats: 100_000_000_000n,        // 100,000 sats  (but this should likely be lower)
    requires_approval_above_msats: 1_000_000n,  // 1,000 sats
    preferred_spend_rail: 'auto',
    allowed_mints: [],
    sweep_threshold_msats: 500_000_000_000n,    // 500,000 sats
    sweep_destination: '',
    sweep_rail: 'cashu',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Policy serialization (for JSON persistence)
// ---------------------------------------------------------------------------

/**
 * Serialize an AgentSpendPolicy to a JSON-compatible plain object.
 * BigInt fields are converted to decimal strings for safe JSON storage.
 */
export function serializePolicy(policy: AgentSpendPolicy): Record<string, unknown> {
  return {
    max_single_spend_msats: policy.max_single_spend_msats.toString(),
    daily_limit_msats: policy.daily_limit_msats.toString(),
    requires_approval_above_msats: policy.requires_approval_above_msats.toString(),
    preferred_spend_rail: policy.preferred_spend_rail,
    allowed_mints: policy.allowed_mints,
    sweep_threshold_msats: policy.sweep_threshold_msats.toString(),
    sweep_destination: policy.sweep_destination,
    sweep_rail: policy.sweep_rail,
  };
}

/**
 * Deserialize an AgentSpendPolicy from a JSON-compatible plain object.
 * Decimal string fields are converted back to BigInt.
 *
 * @throws {Error} if required fields are missing or invalid
 */
export function deserializePolicy(raw: Record<string, unknown>): AgentSpendPolicy {
  const get = (key: string): string => {
    const val = raw[key];
    if (val === undefined || val === null) {
      throw new Error(`AgentSpendPolicy: missing required field "${key}"`);
    }
    return String(val);
  };

  return {
    max_single_spend_msats: BigInt(get('max_single_spend_msats')),
    daily_limit_msats: BigInt(get('daily_limit_msats')),
    requires_approval_above_msats: BigInt(get('requires_approval_above_msats')),
    preferred_spend_rail: (raw.preferred_spend_rail as AgentSpendPolicy['preferred_spend_rail']) ?? 'auto',
    allowed_mints: Array.isArray(raw.allowed_mints) ? (raw.allowed_mints as string[]) : [],
    sweep_threshold_msats: BigInt(get('sweep_threshold_msats')),
    sweep_destination: String(raw.sweep_destination ?? ''),
    sweep_rail: (raw.sweep_rail as AgentSpendPolicy['sweep_rail']) ?? 'cashu',
  };
}

// ---------------------------------------------------------------------------
// LLM cost tracking (spec §6.4, ported from v1)
// ---------------------------------------------------------------------------

/**
 * LLM model pricing for cost calculation.
 * Prices are in USD per million tokens.
 */
export interface LlmModelPricing {
  /** Cost per 1M input tokens in USD. */
  input_price_per_million: number;

  /** Cost per 1M output tokens in USD. */
  output_price_per_million: number;
}

/**
 * Calculate the cost of an LLM inference in millisatoshis.
 *
 * Ported from v1 `agent-llm-proxy.ts` — the BigInt msats math is preserved
 * exactly as specified in spec §6.4.
 *
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param pricing - Model pricing (USD per million tokens)
 * @param btcUsdRate - Current BTC/USD exchange rate (for cost accounting only)
 * @returns Cost in millisatoshis (rounded up)
 */
export function calculateSatsCostFromPricing(
  inputTokens: number,
  outputTokens: number,
  pricing: LlmModelPricing,
  btcUsdRate: number,
): bigint {
  const inputCostUsd = (inputTokens / 1_000_000) * pricing.input_price_per_million;
  const outputCostUsd = (outputTokens / 1_000_000) * pricing.output_price_per_million;
  const totalCostUsd = inputCostUsd + outputCostUsd;
  const totalCostBtc = totalCostUsd / btcUsdRate;
  const totalCostMsats = BigInt(Math.ceil(totalCostBtc * 100_000_000_000));
  return totalCostMsats;
}
