// Ported from v1 netlify/functions_active/nip-ac-revocation-handler.js
// Extracted: NIP-AC credit lifecycle types based on v1 handler logic + spec §7.2
// Stripped: Supabase table schemas (credit_envelopes, nip_revocation_events),
//   supabaseAdmin calls, OTS proof generation fetch, rate limiting (server-side)
// v2: Clean TypeScript types for the NIP-AC credit lifecycle (kinds 39240–39245)

/**
 * NIP-AC: Agent Credit Type Definitions — v2
 *
 * Types for the machine-to-machine credit lifecycle.
 * Aligned with spec §7.2 and OpenAgents NIP-AC.
 *
 * Event flow (from spec §7.2):
 *   Intent (39240) → Offer (39241) → Envelope (39242) → SpendAuth (39243)
 *     → Settlement (39244) or Default Notice (39245)
 */

// ============================================================================
// Nostr minimal event (shared)
// ============================================================================

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// ============================================================================
// Credit Intent (kind:39240)
// ============================================================================

/**
 * Credit Intent — published by Principal or Agent to express a need.
 * e.g. "research 5 companies, budget 5000 sats, deadline 1 hour"
 */
export interface CreditIntentContent {
  description: string;
  /** Maximum budget in sats (Axiom 1 — no fiat) */
  budget_sats: number;
  /** Unix timestamp of deadline */
  deadline_unix?: number;
  /** Required skill scope IDs */
  required_skills?: string[];
  /** Preferred payment rail */
  preferred_rail?: "lightning" | "cashu" | "auto";
}

export interface CreditIntentTags {
  d: string;           // Unique intent identifier
  budget: string;      // Sats budget as string
  deadline?: string;   // Unix timestamp
  skill?: string[];    // Enabled skill scope IDs
  t?: string[];        // Topic tags
}

// ============================================================================
// Credit Offer (kind:39241)
// ============================================================================

/**
 * Credit Offer — published by DVM providers in response to an intent.
 * Displayed in the marketplace UI for Principal review.
 */
export interface CreditOfferContent {
  intent_id: string;      // Reference to the intent event
  provider_pubkey: string;
  price_sats: number;     // Offered price in sats
  delivery_seconds: number;
  capabilities: string[];
  quality_guarantee?: string;
}

export interface CreditOfferTags {
  e: string;             // Reference to intent event ID
  d: string;             // Offer identifier
  price: string;         // Sats price as string
  provider_pubkey: string;
}

// ============================================================================
// Credit Envelope (kind:39242)
// ============================================================================

/**
 * Revocation status of a credit envelope.
 */
export type EnvelopeRevocationStatus = "active" | "revoked" | "expired" | "settled";

/**
 * Credit Envelope — the authority state machine for a credit agreement.
 * Constructed by Satnam when a Principal accepts an offer.
 * The scope_constraints_hash ties the envelope to a specific skill manifest (NIP-SKL).
 */
export interface CreditEnvelopeContent {
  offer_id: string;         // Reference to the accepted offer event
  agent_pubkey: string;     // The agent authorized to spend
  governor_pubkey: string;  // The Principal/Guardian issuing the envelope
  /** Maximum authorized spend in sats */
  max_sats: number;
  /** NIP-SKL skill manifest event ID (version pin for runtime gate) */
  scope_constraints_hash: string;
  /** Expiry unix timestamp */
  expires_at: number;
  /** Cashu mint restrictions (empty = all allowed mints) */
  allowed_mints?: string[];
}

export interface CreditEnvelopeTags {
  d: string;              // Envelope identifier
  p: string;              // Agent pubkey
  e: string;              // Offer event ID
  max_sats: string;       // Max sats as string
  expires_at: string;     // Unix timestamp as string
  scope_hash: string;     // Skill manifest event ID
}

// ============================================================================
// Spend Authorization (kind:39243)
// ============================================================================

/**
 * Spend Authorization — published by Satnam when an agent requests spending.
 * Must be within the envelope's max_sats cap.
 */
export interface SpendAuthorizationContent {
  envelope_id: string;     // Reference to the credit envelope event
  agent_pubkey: string;
  /** Requested spend amount in sats */
  amount_sats: number;
  purpose: string;         // Description of what the spend is for
  recipient?: string;      // Lightning address or Cashu mint
  rail: "lightning" | "cashu";
}

export interface SpendAuthorizationTags {
  e: string;              // Envelope event ID
  p: string;              // Agent pubkey
  amount: string;         // Sats as string
}

// ============================================================================
// Settlement Receipt (kind:39244)
// ============================================================================

/**
 * Settlement Receipt — published after task completion.
 * Includes Cashu token redemption proof for Sig4Sats bonds.
 */
export interface SettlementReceiptContent {
  envelope_id: string;
  agent_pubkey: string;
  governor_pubkey: string;
  /** Total sats actually spent */
  total_sats_spent: number;
  /** Task completion score 0-100 */
  task_completion_score: number;
  /** Cashu proof for Sig4Sats bond redemption (optional) */
  sig4sats_proof?: string;
  /** Whether a performance bond was staked */
  has_performance_bond: boolean;
  /** Calculated reputation delta (from spec §7.2 formula) */
  reputation_delta: number;
  completion_proof?: string;
}

export interface SettlementReceiptTags {
  e: string;              // Envelope event ID
  p: string;              // Agent pubkey
  score: string;          // Completion score as string
}

// ============================================================================
// Default Notice (kind:39245)
// ============================================================================

/**
 * Default Notice — published if an envelope expires without settlement.
 * Triggers reputation penalty.
 */
export interface DefaultNoticeContent {
  envelope_id: string;
  agent_pubkey: string;
  reason: "expired" | "abandoned" | "disputed";
  expires_at: number;
  /** Reputation penalty (negative delta) */
  reputation_penalty: number;
}

export interface DefaultNoticeTags {
  e: string;              // Envelope event ID
  p: string;              // Agent pubkey
  reason: string;
}

// ============================================================================
// Revocation (kind:1985 with revocation label)
// ============================================================================

/**
 * Envelope revocation by Guardian or Steward.
 * Uses NIP-32 label events (kind:1985) with a revocation label.
 */
export interface EnvelopeRevocationRequest {
  /** The credit envelope event ID to revoke */
  envelope_id: string;
  /** Guardian's pubkey */
  guardian_pubkey: string;
  /** NIP-32 label event (kind:1985) with label containing "revoked" */
  revocation_event: NostrEvent;
  revocation_reason?: string;
}

export interface EnvelopeRevocationResult {
  success: boolean;
  envelope_id: string;
  revocation_event_id?: string;
  revocation_status: EnvelopeRevocationStatus;
  error?: string;
}

// ============================================================================
// Reputation calculation (from spec §7.2)
// ============================================================================

/**
 * Input for reputation delta calculation.
 * Formula from spec §7.2:
 *   base_rep = task_completion_score * weight
 *   sig4sats_bonus = has_performance_bond ? base_rep * 0.15 : 0
 *   total_rep_delta = base_rep + sig4sats_bonus
 */
export interface ReputationDeltaInput {
  task_completion_score: number; // 0-100
  weight: number;               // Task weight multiplier
  has_performance_bond: boolean;
}

// ============================================================================
// Client-side envelope lifecycle state machine
// ============================================================================

export type CreditLifecycleState =
  | "intent_published"       // kind:39240 published
  | "offer_received"         // kind:39241 received from provider
  | "envelope_constructed"   // kind:39242 constructed and published
  | "spend_authorized"       // kind:39243 published
  | "settled"               // kind:39244 published
  | "defaulted"             // kind:39245 published
  | "revoked";              // kind:1985 revocation published

export interface CreditLifecycleRecord {
  envelopeId: string;
  agentPubkey: string;
  state: CreditLifecycleState;
  maxSats: number;
  spentSats: number;
  createdAt: number;
  expiresAt: number;
  intentEventId?: string;
  offerEventId?: string;
  settlementEventId?: string;
  revocationEventId?: string;
}
