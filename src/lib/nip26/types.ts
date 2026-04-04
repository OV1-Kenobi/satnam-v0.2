/**
 * @module nip26/types
 * @description TypeScript type definitions for NIP-26 Delegation.
 *
 * NIP-26 Delegation replaces the database-backed role table in Satnam v2.
 * Every role assignment is a NIP-26 delegation event. Delegation events are
 * published to Pylon and cached locally in IndexedDB.
 *
 * The four-level role hierarchy per SPECIFICATION.md §4.1:
 * ```
 * Guardian (Trust Protector)
 *   └── Steward (Trustee)
 *         ├── Adult (Mature Beneficiary — human or agent)
 *         └── Offspring (Immature Beneficiary — human or agent)
 * ```
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/26.md
 * @see SPECIFICATION.md §4 — RBAC v2 — NIP-26 Delegation + FROST Threshold
 */

// ---------------------------------------------------------------------------
// Role Enum
// ---------------------------------------------------------------------------

/**
 * The four trust-estate roles in the Satnam v2 hierarchy.
 * @see SPECIFICATION.md §4.1 — Role Hierarchy
 */
export enum RoleType {
  /**
   * Guardian (Trust Protector). Highest authority.
   * - Can create groups, add/remove members, sign NIP-26 delegation events.
   * - Holds FROST share #1.
   * - Can initiate and participate in FROST key ceremonies.
   * - Can publish and revoke NIP-CA attestations.
   */
  Guardian = 'guardian',

  /**
   * Steward (Trustee). Operational authority.
   * - Can add/remove members at or below Adult level.
   * - Can sign NIP-26 delegation for Adult/Offspring only.
   * - Holds FROST share #2 (co-signer for group transactions).
   * - Can participate in FROST key ceremonies (but not initiate).
   */
  Steward = 'steward',

  /**
   * Adult (Mature Beneficiary). Autonomous member (human or agent).
   * - Spending authority within policy limits.
   * - Can create agents within span of control.
   * - Can submit and receive DVM jobs.
   * - Cannot sign NIP-26 delegation events.
   */
  Adult = 'adult',

  /**
   * Offspring (Immature Beneficiary). Restricted member (human or agent).
   * - Most operations require Guardian/Steward approval.
   * - Cannot create agents, issue delegations, or register skills.
   * - Spending requires explicit approval.
   */
  Offspring = 'offspring',
}

// ---------------------------------------------------------------------------
// Delegation Conditions
// ---------------------------------------------------------------------------

/**
 * Parsed representation of a NIP-26 delegation conditions string.
 *
 * Conditions string format:
 * `kind=27235&kind=1&created_at<1735689600&created_at>1704067200`
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/26.md#conditions
 */
export interface DelegationConditions {
  /**
   * List of Nostr event kinds the delegatee is authorized to sign on behalf
   * of the delegator. Empty means no kind restriction.
   */
  allowedKinds: number[];

  /**
   * Unix timestamp upper bound (exclusive): the delegation expires at this time.
   * Events with created_at >= notAfter are invalid.
   */
  notAfter?: number;

  /**
   * Unix timestamp lower bound (exclusive): the delegation is not valid before
   * this time. Events with created_at <= notBefore are invalid.
   */
  notBefore?: number;
}

// ---------------------------------------------------------------------------
// Delegation Event
// ---------------------------------------------------------------------------

/**
 * A NIP-26 delegation event — a Nostr event containing a delegation tag that
 * grants authority from a delegator to a delegatee.
 *
 * Delegation tag format within the event:
 * ```json
 * ["delegation", "<delegator_pubkey>", "<conditions_string>", "<delegation_signature>"]
 * ```
 *
 * The delegation signature covers:
 * `nostr:delegation:<delegatee_pubkey>:<conditions_string>`
 *
 * @see SPECIFICATION.md §4.2 — NIP-26 Delegation Events
 */
export interface DelegationEvent {
  /** Hex-encoded pubkey of the entity receiving delegation authority. */
  delegateePubkey: string;

  /** Hex-encoded pubkey of the entity granting delegation authority. */
  delegatorPubkey: string;

  /**
   * NIP-26 conditions string restricting the scope of delegation.
   * Format: `kind=N&kind=M&created_at<timestamp`
   */
  conditions: string;

  /**
   * 64-byte Schnorr signature (hex) by the delegator over the delegation token:
   * `sha256("nostr:delegation:<delegateePubkey>:<conditions>")`
   */
  signature: string;

  /**
   * Satnam-specific role this delegation represents.
   * Stored as an application-level annotation; the NIP-26 protocol itself
   * does not encode roles — they are inferred from the conditions.
   */
  role?: RoleType;

  /**
   * ISO 8601 timestamp when this delegation event was created.
   */
  createdAt: string;

  /**
   * The full Nostr event ID of the event that published this delegation,
   * if it was stored as a kind:1 note on relays.
   */
  nostrEventId?: string;

  /** The group pubkey this delegation is scoped to, if applicable. */
  groupPubkey?: string;
}

// ---------------------------------------------------------------------------
// Delegation Chain
// ---------------------------------------------------------------------------

/**
 * A chain of delegation events from a delegatee back to a root Guardian.
 * Used to verify multi-hop authority for role-gated operations.
 *
 * Example chain: Offspring → Adult → Steward → Guardian
 * (each element[i].delegatorPubkey === element[i+1].delegateePubkey)
 */
export type DelegationChain = DelegationEvent[];

// ---------------------------------------------------------------------------
// Delegation Graph
// ---------------------------------------------------------------------------

/**
 * Local delegation graph maintained client-side.
 * Caches delegation events from Pylon and provides chain traversal.
 *
 * @see SPECIFICATION.md §4.2 — Delegation chain storage
 */
export interface DelegationGraph {
  /**
   * Returns the chain of delegation events from a pubkey back to a Guardian.
   * The first element is the most recent delegation; the last element is
   * the Guardian's root delegation (which delegates to itself or has no
   * delegation tag).
   *
   * @param pubkey - Hex-encoded pubkey to trace
   * @returns Array of delegation events ordered from delegatee to root
   */
  getChain(pubkey: string): DelegationEvent[];

  /**
   * Returns all active delegations issued by a pubkey.
   *
   * @param pubkey - Hex-encoded delegator pubkey
   * @returns Array of delegation events issued by this pubkey
   */
  getDelegationsFrom(pubkey: string): DelegationEvent[];

  /**
   * Returns all active delegations received by a pubkey.
   *
   * @param pubkey - Hex-encoded delegatee pubkey
   * @returns Array of delegation events where this pubkey is the delegatee
   */
  getDelegationsTo(pubkey: string): DelegationEvent[];

  /**
   * Verifies a delegation chain is valid at a given timestamp.
   * Each link in the chain must be cryptographically valid and the event
   * conditions must be satisfied at the provided timestamp.
   *
   * @param pubkey - Hex-encoded pubkey whose chain to verify
   * @param timestamp - Unix timestamp to verify validity at
   * @returns true if the full chain is valid at the given timestamp
   */
  verifyChainAt(pubkey: string, timestamp: number): boolean;

  /**
   * Refreshes the delegation graph from a relay connection.
   * Fetches delegation events for all known pubkeys in the graph.
   *
   * @param relay - Open WebSocket connection to a Nostr relay
   */
  syncFromRelay(relay: WebSocket): Promise<void>;

  /**
   * Add a delegation event to the graph.
   * @param event - Delegation event to add
   */
  addDelegation(event: DelegationEvent): void;

  /**
   * Get the inferred role for a pubkey based on its delegation chain.
   * Returns null if the pubkey has no delegation (i.e., is a root Guardian).
   *
   * @param pubkey - Hex-encoded pubkey to check
   */
  getRole(pubkey: string): RoleType | null;
}
