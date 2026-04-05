/**
 * @module sig4sats/types
 * @description All types for the Sig4Sats bond system — the three bond types that
 * tie Cashu payments to Nostr event signatures via adaptor signatures.
 *
 * Bond 1 — Entitlement: Pay Cashu → receive blinded capability token
 * Bond 2 — Recovery:    Guardians stake Cashu as skin-in-the-game for N-of-M recovery
 * Bond 3 — Allowance:   Guardians fund offspring allowances with blinded spending tokens
 */

// ============================================================================
// Core Union
// ============================================================================

/** The 3 Sig4Sats bond types */
export type BondType = 'entitlement' | 'recovery' | 'allowance';

// ============================================================================
// Bond 1: Cashu-Backed Entitlement Tokens
// ============================================================================

/**
 * Entitlement Bond — pay Cashu → receive blinded capability token for premium features.
 * The adaptor signature binds payment to the entitlement event. The blinded token
 * is stored encrypted in the OPFS Vault and presented for feature gate checks.
 *
 * Flow:
 *   1. Client creates adaptor sig offer for featureId
 *   2. Client pays Cashu to receive full signature
 *   3. Full signature reveals the blinded capability token
 *   4. Token stored in vault; presented at feature gates
 */
export interface EntitlementBond {
  type: 'entitlement';
  /** Unique identifier for the premium feature this token unlocks */
  featureId: string;
  /** Amount paid in sats */
  amount: number;
  /** Blinded token (stored encrypted in OPFS Vault) */
  blindedToken: string;
  /** Nostr entitlement event ID (the adaptor sig event) */
  entitlementEventId: string;
  /** Mint URL the Cashu payment was made through */
  mintUrl: string;
  /** Unix timestamp when this token expires */
  expiresAt: number;
  /** Current lifecycle state */
  status: 'active' | 'spent' | 'expired';
  /** Creation timestamp */
  createdAt: number;
}

// ============================================================================
// Bond 2: Guardian Recovery Bonds
// ============================================================================

/** A single guardian's bond contribution */
export interface GuardianBond {
  /** Guardian's Nostr pubkey (hex) */
  guardianPubkey: string;
  /** Amount staked in sats */
  bondAmount: number;
  /** Whether this guardian has signed the recovery */
  signed: boolean;
  /** Cashu proof ID for the staked bond */
  bondProofId: string;
  /** Timestamp when the guardian bonded */
  bondedAt: number;
}

/**
 * Recovery Bond — guardians stake Cashu as skin-in-the-game for recovery approvals.
 * N-of-M guardian signatures + bonds → recovery capability token.
 * Bonds are refunded to signing guardians after successful recovery;
 * non-signing guardians' bonds are slashed.
 *
 * Flow:
 *   1. Recovery request published as Nostr event
 *   2. Guardians bond Cashu + sign recovery event (addGuardianBond)
 *   3. When threshold met → executeRecovery issues capability token
 *   4. Signers refunded; non-signers slashed after deadline
 */
export interface RecoveryBond {
  type: 'recovery';
  /** Recovery request event ID (the Nostr event being recovered from) */
  recoveryEventId: string;
  /** Guardian pubkeys who have bonded and/or signed */
  guardianBonds: GuardianBond[];
  /** Required threshold (e.g. 2 of 3) */
  threshold: number;
  /** Total number of expected guardians */
  totalGuardians: number;
  /** Recovery capability token (issued once threshold is met) */
  recoveryToken?: string;
  /** Unix timestamp when the recovery request expires */
  expiresAt: number;
  /** Current lifecycle state */
  status: 'collecting' | 'threshold_met' | 'executed' | 'refunded' | 'expired';
  /** Creation timestamp */
  createdAt: number;
}

// ============================================================================
// Bond 3: Blinded Allowance Tokens
// ============================================================================

/**
 * Spending constraints applied to an allowance bond.
 * Enforced by the client and optionally attested in the bond token.
 */
export interface AllowanceConstraints {
  /** Maximum sats per single spend */
  maxSingleSpend: number;
  /** Maximum sats per day across all spends */
  dailyLimit: number;
  /** Payment rails the recipient is allowed to use */
  allowedRails: ('lightning' | 'cashu')[];
  /** Specific Cashu mint URLs allowed (empty = all guardian-approved mints) */
  allowedMints?: string[];
  /** Optional category tags for spend restrictions */
  allowedCategories?: string[];
}

/**
 * Allowance Bond — guardians fund offspring allowances via Cashu.
 * Converted to blinded spending tokens with role-based limits.
 *
 * Flow:
 *   1. Guardian funds allowance → createAllowanceBond
 *   2. Cashu tokens minted with specified denomination and count
 *   3. Recipient spends tokens → spendAllowanceToken
 *   4. Cadence refresh re-issues tokens on schedule
 */
export interface AllowanceBond {
  type: 'allowance';
  /** Funding guardian's Nostr pubkey (hex) */
  guardianPubkey: string;
  /** Recipient's Nostr pubkey (hex) — offspring or delegated adult */
  recipientPubkey: string;
  /** Total allowance amount in sats */
  totalAmount: number;
  /** Denomination per individual blinded token in sats */
  tokenDenomination: number;
  /** Total number of tokens issued */
  tokenCount: number;
  /** Number of tokens spent so far */
  tokensSpent: number;
  /** How often the allowance refreshes */
  cadence: 'daily' | 'weekly' | 'monthly';
  /** Next refresh Unix timestamp */
  nextRefreshAt: number;
  /** Spending constraints applied to recipient */
  constraints: AllowanceConstraints;
  /** Mint URL used to issue the tokens */
  mintUrl: string;
  /** Current lifecycle state */
  status: 'active' | 'depleted' | 'paused' | 'expired';
  /** Creation timestamp */
  createdAt: number;
  /** Last spend timestamp */
  lastSpentAt?: number;
}

// ============================================================================
// Adaptor Signature
// ============================================================================

/**
 * Adaptor signature structure for Sig4Sats bonds.
 * Uses Schnorr primitives from @noble/curves/secp256k1.
 *
 * The adaptor binds a Cashu payment to a Nostr event signature:
 * - partialSig: the signature with the payment secret factored out
 * - adaptorPoint: the point T = t·G (where t is the Cashu payment secret)
 * - Once payment is made and secret t is revealed, the full sig = partialSig + t
 */
export interface AdaptorSignature {
  /** The partial signature (before payment reveals full sig) — hex encoded */
  partialSig: string;
  /** The adaptor point T = t·G where t is the payment secret — hex encoded compressed point */
  adaptorPoint: string;
  /** The message being signed — hex encoded 32-byte hash */
  message: string;
  /** Signer's pubkey — hex encoded */
  signerPubkey: string;
}

/**
 * Result of extracting the secret from a completed signature.
 * The secret can be used to redeem the Cashu proof.
 */
export interface ExtractedSecret {
  /** The revealed secret scalar t — hex encoded */
  secret: string;
  /** Whether the extraction succeeded */
  valid: boolean;
}

// ============================================================================
// Generic Bond Union
// ============================================================================

/** Union type for storage and display of any Sig4Sats bond */
export type Sig4SatsBond = EntitlementBond | RecoveryBond | AllowanceBond;

// ============================================================================
// Bond Creation Parameters
// ============================================================================

/** Parameters for creating an entitlement bond */
export interface CreateEntitlementParams {
  featureId: string;
  amount: number;
  mintUrl: string;
  /** Duration in seconds (default: 30 days) */
  ttlSeconds?: number;
}

/** Parameters for creating a recovery bond */
export interface CreateRecoveryParams {
  recoveryEventId: string;
  guardians: Array<{ pubkey: string; expectedBondAmount: number }>;
  threshold: number;
  /** Duration in seconds (default: 7 days) */
  ttlSeconds?: number;
}

/** Parameters for creating an allowance bond */
export interface CreateAllowanceParams {
  recipientPubkey: string;
  totalAmount: number;
  tokenDenomination: number;
  cadence: 'daily' | 'weekly' | 'monthly';
  constraints: AllowanceConstraints;
  mintUrl: string;
}

// ============================================================================
// Spend Result
// ============================================================================

/** Result of spending an allowance token */
export interface SpendResult {
  success: boolean;
  tokensRemaining: number;
  amountSpent: number;
  error?: string;
}
