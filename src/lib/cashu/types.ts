/**
 * @module cashu/types
 * @description TypeScript type definitions for the Cashu eCash client.
 *
 * All Cashu amounts are denominated in satoshis (number). Proofs are bearer
 * instruments — the vault is the only protection against theft.
 *
 * @see https://github.com/cashubtc/nuts — Cashu NUT specifications
 */

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

/**
 * Metadata about a Cashu mint the user has configured.
 */
export interface MintInfo {
  /** The mint's base URL (e.g. https://mint.minibits.cash/Bitcoin). */
  url: string;

  /** Human-readable name reported by the mint (from /v1/info). */
  name?: string;

  /** NUT numbers supported by this mint (e.g. [0, 1, 2, 4, 5, 6, 7, 8, 9]). */
  nuts: number[];

  /** Total balance held at this mint in satoshis (sum of proof denominations). */
  balance: number;

  /**
   * Whether this mint is in the group's allowed mint list.
   * Governed by the group's `allowed_mints` spend policy field.
   */
  isAllowed: boolean;
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

/**
 * A Cashu eCash proof (bearer token). Represents a discrete denomination of
 * satoshis signed by the mint's key.
 *
 * Proofs are the bearer instruments of the Cashu protocol. Anyone who
 * possesses a valid proof can redeem it at the mint. They must NEVER be
 * stored in plaintext outside the OPFS Vault.
 *
 * @see https://github.com/cashubtc/nuts/blob/main/00.md
 */
export interface CashuProof {
  /** The keyset ID from the mint that signed this proof. */
  id: string;

  /** The denomination this proof represents, in satoshis. */
  amount: number;

  /** The blinded secret scalar (hex-encoded or stringified JSON for DLEQ proofs). */
  secret: string;

  /** The unblinded mint signature point (hex-encoded compressed secp256k1 point). */
  C: string;
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/**
 * Result of a melt (Lightning payment) operation.
 */
export interface MeltResult {
  /**
   * Whether the Lightning payment was successfully sent.
   * If false, the proofs were not spent and can be reused.
   */
  paid: boolean;

  /** Payment preimage (hex-encoded), present only if the payment succeeded. */
  preimage?: string;

  /**
   * Change proofs returned by the mint due to Lightning fee over-estimation.
   * These must be stored back in the vault.
   */
  change?: CashuProof[];
}

/**
 * The state of a proof as reported by the mint's check-state endpoint.
 */
export interface ProofStatus {
  /** The proof that was checked. */
  proof: CashuProof;

  /**
   * Current state:
   * - `'valid'` — proof is unspent and can be used
   * - `'spent'` — proof has already been redeemed
   * - `'pending'` — proof is in a pending melt operation
   */
  state: 'valid' | 'spent' | 'pending';
}

// ---------------------------------------------------------------------------
// Token serialization
// ---------------------------------------------------------------------------

/**
 * The decoded structure of a serialized Cashu token (cashuA... string).
 * Tokens are multi-mint bundles of proofs used for peer-to-peer transfers.
 *
 * @see https://github.com/cashubtc/nuts/blob/main/00.md#serialization-of-a-cashu-token
 */
export interface TokenPayload {
  /** Proof bundles, one per mint. A token may include proofs from multiple mints. */
  token: Array<{
    /** The mint URL that issued these proofs. */
    mint: string;
    /** The proofs included in this bundle. */
    proofs: CashuProof[];
  }>;

  /** Optional human-readable memo attached to the token. */
  memo?: string;

  /** Token denomination unit — always 'sat' in Satnam v2. */
  unit: 'sat';
}
