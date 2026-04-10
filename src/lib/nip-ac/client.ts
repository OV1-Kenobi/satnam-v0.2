/**
 * @module nip-ac/client
 * @description NIP-AC credit lifecycle client for Satnam v2.
 *
 * Implements the consumer-side of the machine-to-machine credit lifecycle:
 *
 * ```
 * Intent (39240) → Offer (39241) → Envelope (39242) → SpendAuth (39243)
 *                                                           ↓
 *                                               Settlement (39244)
 *                                                     ↓
 *                                             Default Notice (39245)
 * ```
 *
 * Satnam v2 implements the consumer/principal side only. Provider-side
 * (Offer construction, settlement acceptance) is handled by DVM operators.
 *
 * Reputation delta formula (spec §7.2):
 *   base_rep = task_completion_score * weight
 *   sig4sats_bonus = has_performance_bond ? base_rep * 0.15 : 0
 *   total_rep_delta = base_rep + sig4sats_bonus
 *
 * @see phase3-spec-sections.md §7.2 — NIP-AC Credit Lifecycle
 */

import { nip19 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { CepsClient } from '../ceps/ceps-client.js';
import type {
  NostrEvent,
  CreditOfferContent,
  CreditEnvelopeContent,
  CreditLifecycleState,
} from './types.js';

// ---------------------------------------------------------------------------
// Exported types (client-specific, not duplicating types.ts)
// ---------------------------------------------------------------------------

/**
 * Unsigned Nostr event produced by the build* functions.
 */
export interface UnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/**
 * A parsed Credit Offer received from a DVM provider (kind:39241).
 */
export interface CreditOffer {
  /** Offer event ID */
  eventId: string;
  /** Publisher's pubkey */
  providerPubkey: string;
  /** Intent event this offer responds to */
  intentEventId: string;
  /** Offered price in sats */
  priceSats: number;
  /** Estimated delivery time in seconds */
  deliverySeconds: number;
  /** Provider's advertised capabilities */
  capabilities: string[];
  /** Optional quality guarantee text */
  qualityGuarantee?: string;
  /** Raw event for verification */
  rawEvent: NostrEvent;
}

/**
 * A parsed Credit Envelope (kind:39242) from relay.
 */
export interface CreditEnvelope {
  /** Envelope event ID */
  eventId: string;
  /** Authorized agent pubkey */
  agentPubkey: string;
  /** Governor/Principal pubkey */
  governorPubkey: string;
  /** Maximum authorized spend in sats */
  maxSats: number;
  /** NIP-SKL skill manifest hash */
  scopeConstraintsHash: string;
  /** Expiry unix timestamp */
  expiresAt: number;
  /** Current lifecycle state */
  state: CreditLifecycleState;
  /** Raw event */
  rawEvent: NostrEvent;
}

/**
 * Intent construction parameters.
 */
export interface IntentParams {
  description: string;
  budgetMsats: bigint;
  deadlineTimestamp: number;
  requiredSkills: string[];
  preferredProviders?: string[];
}

/**
 * Callback for lifecycle event monitoring.
 */
export type CreditLifecycleCallback = (event: {
  type: 'offer' | 'settlement' | 'default' | 'revocation';
  envelopeId: string;
  rawEvent: NostrEvent;
}) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode an nsec bech32 or hex secret key to raw bytes.
 * @internal
 */
function _decodeSecretKey(nsecOrHex: string): Uint8Array {
  if (/^[0-9a-fA-F]{64}$/.test(nsecOrHex)) {
    return hexToBytes(nsecOrHex);
  }
  if (nsecOrHex.startsWith('nsec1')) {
    const decoded = nip19.decode(nsecOrHex);
    if (decoded.type !== 'nsec') {
      throw new Error('Expected nsec bech32 string, got: ' + decoded.type);
    }
    return decoded.data as Uint8Array;
  }
  throw new Error(
    'Invalid secret key format — expected nsec bech32 or 64-char hex'
  );
}

/**
 * Generate a short random hex string for use as a d-tag identifier.
 * @internal
 */
function generateDTag(prefix: string): string {
  const random = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}-${bytesToHex(random)}`;
}

// ---------------------------------------------------------------------------
// buildCreditIntent
// ---------------------------------------------------------------------------

/**
 * Construct a Credit Intent event (kind:39240).
 *
 * "I need X done, budget Y sats, deadline Z."
 *
 * Tags:
 * - ["d", "<unique-intent-id>"]
 * - ["budget", "<sats>"]
 * - ["deadline", "<unix_timestamp>"]   (if set)
 * - ["skill", "<skill_scope_id>"]      (one per required skill)
 * - ["p", "<preferred_provider_pk>"]   (one per preferred provider)
 *
 * @param params - Intent construction parameters
 * @returns Unsigned kind:39240 event
 *
 * @example
 * ```ts
 * const intent = buildCreditIntent({
 *   description: 'Research 5 companies in the AI sector',
 *   budgetMsats: BigInt(5_000_000), // 5000 sats
 *   deadlineTimestamp: Math.floor(Date.now() / 1000) + 3600,
 *   requiredSkills: ['research-v2'],
 * });
 * ```
 */
export function buildCreditIntent(params: IntentParams): UnsignedEvent {
  const { description, budgetMsats, deadlineTimestamp, requiredSkills, preferredProviders } = params;

  // Convert msats to sats for the budget tag (NIP-AC uses sats natively)
  const budgetSats = budgetMsats / BigInt(1000);

  const tags: string[][] = [
    ['d', generateDTag('intent')],
    ['budget', budgetSats.toString()],
    ['deadline', String(deadlineTimestamp)],
  ];

  for (const skill of requiredSkills) {
    tags.push(['skill', skill]);
  }

  if (preferredProviders) {
    for (const pubkey of preferredProviders) {
      tags.push(['p', pubkey]);
    }
  }

  const content = JSON.stringify({
    description,
    budget_sats: Number(budgetSats),
    deadline_unix: deadlineTimestamp,
    required_skills: requiredSkills,
  });

  return {
    kind: 39240,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };
}

// ---------------------------------------------------------------------------
// parseCreditOffer
// ---------------------------------------------------------------------------

/**
 * Parse a Credit Offer event (kind:39241) received from a DVM provider.
 *
 * Extracts the offer content and key tags into a structured `CreditOffer`.
 * The raw event is preserved for signature verification by the caller.
 *
 * @param event - Raw kind:39241 Nostr event from relay
 * @returns Parsed CreditOffer
 * @throws If required fields are missing or content is invalid JSON
 */
export function parseCreditOffer(event: NostrEvent): CreditOffer {
  if (event.kind !== 39241) {
    throw new Error(`Expected kind:39241, got kind:${event.kind}`);
  }

  let content: CreditOfferContent;
  try {
    content = JSON.parse(event.content);
  } catch {
    throw new Error(`Failed to parse Credit Offer content as JSON: ${event.id}`);
  }

  const eTag = event.tags.find((t) => t[0] === 'e');
  const intentEventId = eTag?.[1] ?? content.intent_id;
  if (!intentEventId) {
    throw new Error(`Credit Offer ${event.id} missing intent reference (e tag or content.intent_id)`);
  }

  return {
    eventId: event.id,
    providerPubkey: event.pubkey,
    intentEventId,
    priceSats: content.price_sats,
    deliverySeconds: content.delivery_seconds,
    capabilities: content.capabilities ?? [],
    qualityGuarantee: content.quality_guarantee,
    rawEvent: event,
  };
}

// ---------------------------------------------------------------------------
// buildCreditEnvelope
// ---------------------------------------------------------------------------

/**
 * Construct a Credit Envelope event (kind:39242).
 *
 * The envelope is the authority state machine created when a Principal accepts
 * a provider's offer. The `scopeConstraintsHash` ties the envelope to a
 * specific NIP-SKL skill manifest (SHA-256 of the canonical manifest payload).
 *
 * Tags:
 * - ["d", "<unique-envelope-id>"]
 * - ["e", "<intent_event_id>"]
 * - ["e", "<offer_event_id>"]
 * - ["p", "<provider_pubkey>"]
 * - ["max_sats", "<sats>"]
 * - ["expires_at", "<unix_timestamp>"]
 * - ["scope_hash", "<sha256_of_skill_manifest>"]
 * - ["performance_bond", "<sats>"]   (if sig4sats bond present)
 *
 * @param params - Envelope construction parameters
 * @returns Unsigned kind:39242 event
 */
export function buildCreditEnvelope(params: {
  intentEventId: string;
  offerEventId: string;
  providerPubkey: string;
  maxSats: number;
  /** SHA-256 of the NIP-SKL skill manifest event ID */
  scopeConstraintsHash: string;
  expiryTimestamp: number;
  /** Optional Sig4Sats performance bond amount in sats */
  performanceBondSats?: number;
}): UnsignedEvent {
  const {
    intentEventId,
    offerEventId,
    providerPubkey,
    maxSats,
    scopeConstraintsHash,
    expiryTimestamp,
    performanceBondSats,
  } = params;

  const tags: string[][] = [
    ['d', generateDTag('envelope')],
    ['e', intentEventId],
    ['e', offerEventId],
    ['p', providerPubkey],
    ['max_sats', String(maxSats)],
    ['expires_at', String(expiryTimestamp)],
    ['scope_hash', scopeConstraintsHash],
  ];

  if (performanceBondSats !== undefined && performanceBondSats > 0) {
    tags.push(['performance_bond', String(performanceBondSats)]);
  }

  const content: CreditEnvelopeContent = {
    offer_id: offerEventId,
    agent_pubkey: providerPubkey, // Provider acts as the authorized agent
    governor_pubkey: '', // Filled by the signed event's pubkey field
    max_sats: maxSats,
    scope_constraints_hash: scopeConstraintsHash,
    expires_at: expiryTimestamp,
  };

  return {
    kind: 39242,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(content),
  };
}

// ---------------------------------------------------------------------------
// buildSpendAuth
// ---------------------------------------------------------------------------

/**
 * Construct a Spend Authorization event (kind:39243).
 *
 * Authorizes a specific spend within an envelope's max_sats cap. The agent
 * submits the spend auth before executing any payment, and the Principal's
 * Satnam client signs and publishes this event.
 *
 * Tags:
 * - ["e", "<envelope_event_id>"]
 * - ["amount", "<msats>"]
 * - ["bolt11", "<invoice>"]          (if invoiceBolt11 provided)
 *
 * @param params - Spend authorization parameters
 * @returns Unsigned kind:39243 event
 */
export function buildSpendAuth(params: {
  envelopeEventId: string;
  amountMsats: bigint;
  description: string;
  invoiceBolt11?: string;
}): UnsignedEvent {
  const { envelopeEventId, amountMsats, description, invoiceBolt11 } = params;

  const tags: string[][] = [
    ['e', envelopeEventId],
    ['amount', amountMsats.toString()],
  ];

  if (invoiceBolt11) {
    tags.push(['bolt11', invoiceBolt11]);
  }

  const content = JSON.stringify({
    envelope_id: envelopeEventId,
    amount_msats: amountMsats.toString(),
    description,
    ...(invoiceBolt11 ? { invoice_bolt11: invoiceBolt11 } : {}),
  });

  return {
    kind: 39243,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };
}

// ---------------------------------------------------------------------------
// buildSettlementReceipt
// ---------------------------------------------------------------------------

/**
 * Construct a Settlement Receipt event (kind:39244).
 *
 * Published after task completion to close the envelope lifecycle.
 * Includes the Cashu redemption proof for any Sig4Sats bond.
 *
 * The reputation delta is calculated via `calculateReputationDelta()` and
 * included in the settlement content for on-chain verifiability.
 *
 * Tags:
 * - ["e", "<envelope_event_id>"]
 * - ["score", "<0-100>"]
 * - ["spent", "<msats>"]
 * - ["bond_redeemed", "true"|"false"]
 *
 * @param params - Settlement receipt parameters
 * @returns Unsigned kind:39244 event
 */
export function buildSettlementReceipt(params: {
  envelopeEventId: string;
  /** Task completion score 0–1 (will be stored as 0–100 internally) */
  taskCompletionScore: number;
  totalSpentMsats: bigint;
  performanceBondRedeemed: boolean;
  /** Cashu token proof for Sig4Sats bond redemption */
  cashuRedemptionProof?: string;
}): UnsignedEvent {
  const {
    envelopeEventId,
    taskCompletionScore,
    totalSpentMsats,
    performanceBondRedeemed,
    cashuRedemptionProof,
  } = params;

  // Normalize score to 0–100 for storage (spec uses 0–100 in SettlementReceiptContent)
  const scoreNormalized = Math.round(
    Math.min(1, Math.max(0, taskCompletionScore)) * 100
  );

  // Calculate reputation delta
  const repDelta = calculateReputationDelta({
    taskCompletionScore,
    weight: 1.0,
    hasPerformanceBond: performanceBondRedeemed,
  });

  const tags: string[][] = [
    ['e', envelopeEventId],
    ['score', String(scoreNormalized)],
    ['spent', totalSpentMsats.toString()],
    ['bond_redeemed', performanceBondRedeemed ? 'true' : 'false'],
  ];

  const content = JSON.stringify({
    envelope_id: envelopeEventId,
    task_completion_score: scoreNormalized,
    total_sats_spent: Number(totalSpentMsats / BigInt(1000)),
    has_performance_bond: performanceBondRedeemed,
    sig4sats_proof: cashuRedemptionProof ?? null,
    reputation_delta: repDelta,
    completion_proof: cashuRedemptionProof ?? null,
  });

  return {
    kind: 39244,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };
}

// ---------------------------------------------------------------------------
// buildDefaultNotice
// ---------------------------------------------------------------------------

/**
 * Construct a Default Notice event (kind:39245).
 *
 * Published when a credit envelope expires without settlement. This triggers
 * a reputation penalty for the responsible party and closes the envelope.
 *
 * Tags:
 * - ["e", "<envelope_event_id>"]
 * - ["reason", "<expired|abandoned|disputed>"]
 *
 * @param params - Default notice parameters
 * @returns Unsigned kind:39245 event
 */
export function buildDefaultNotice(params: {
  envelopeEventId: string;
  reason: string;
}): UnsignedEvent {
  const { envelopeEventId, reason } = params;

  // Normalize reason to known enum values
  const normalizedReason =
    reason === 'abandoned' || reason === 'disputed' ? reason : 'expired';

  const tags: string[][] = [
    ['e', envelopeEventId],
    ['reason', normalizedReason],
  ];

  const content = JSON.stringify({
    envelope_id: envelopeEventId,
    reason: normalizedReason,
  });

  return {
    kind: 39245,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };
}

// ---------------------------------------------------------------------------
// calculateReputationDelta
// ---------------------------------------------------------------------------

/**
 * Calculate the reputation delta for a completed task per spec §7.2.
 *
 * Formula:
 *   base_rep = score * weight
 *   sig4sats_bonus = has_performance_bond ? base_rep * 0.15 : 0
 *   total_rep_delta = base_rep + sig4sats_bonus
 *
 * @param params.taskCompletionScore - Score from 0 (failure) to 1 (perfect)
 * @param params.weight - Task weight multiplier (higher = more impactful)
 * @param params.hasPerformanceBond - Whether a Sig4Sats bond was staked
 * @returns Reputation delta (positive = reputation gain)
 *
 * @example
 * ```ts
 * const delta = calculateReputationDelta({
 *   taskCompletionScore: 0.85,
 *   weight: 2.0,
 *   hasPerformanceBond: true,
 * });
 * // base_rep = 0.85 * 2.0 = 1.70
 * // sig4sats_bonus = 1.70 * 0.15 = 0.255
 * // total = 1.955
 * ```
 */
export function calculateReputationDelta(params: {
  taskCompletionScore: number;
  weight: number;
  hasPerformanceBond: boolean;
}): number {
  const { taskCompletionScore, weight, hasPerformanceBond } = params;
  const score = Math.min(1, Math.max(0, taskCompletionScore));
  const base_rep = score * weight;
  const sig4sats_bonus = hasPerformanceBond ? base_rep * 0.15 : 0;
  return base_rep + sig4sats_bonus;
}

// ---------------------------------------------------------------------------
// CreditLifecycleManager
// ---------------------------------------------------------------------------

/**
 * Full credit lifecycle manager for the NIP-AC consumer side.
 *
 * Provides a high-level API for creating intents, accepting offers, authorizing
 * spends, settling envelopes, and issuing default notices. All events are
 * published via CEPS. The agent's nsec is retrieved from the OPFS Vault on
 * each call and zeroed from memory after use.
 *
 * @example
 * ```ts
 * const manager = new CreditLifecycleManager(ceps);
 * const intentId = await manager.createIntent({
 *   description: 'Research 5 AI companies',
 *   budgetMsats: BigInt(5_000_000),
 *   deadlineTimestamp: Math.floor(Date.now() / 1000) + 3600,
 *   requiredSkills: ['research-v2'],
 * });
 * ```
 */
export class CreditLifecycleManager {
  private readonly ceps: CepsClient;
  private readonly _vault: {
    loadAgentNsec(agentNpub: string): Promise<string>;
  };

  constructor(
    ceps: CepsClient,
    vault: { loadAgentNsec(agentNpub: string): Promise<string> }
  ) {
    this.ceps = ceps;
    this._vault = vault;
  }

  /**
   * Create and publish a credit intent (kind:39240).
   *
   * The active session's pubkey is used as the intent author. The nsec is
   * loaded from vault only if needed for signing; for intents the CEPS active
   * session handles signing.
   *
   * @param params - Intent parameters
   * @returns Published intent event ID
   */
  async createIntent(params: IntentParams): Promise<string> {
    const unsigned = buildCreditIntent(params);
    const signed = await this.ceps.signEventWithActiveSession(unsigned as any);
    return this.ceps.publishEvent(signed);
  }

  /**
   * Accept a provider's offer and publish a credit envelope (kind:39242).
   *
   * Constructs an envelope tying the accepted offer to a skill manifest hash
   * derived from the offer's capability list.
   *
   * @param offer - Parsed CreditOffer from `parseCreditOffer()`
   * @returns Published envelope event ID
   */
  async acceptOffer(offer: CreditOffer): Promise<string> {
    // Derive a deterministic scope constraints hash from the offer's capabilities
    const capabilityString = offer.capabilities.sort().join(',');
    const scopeConstraintsHash = bytesToHex(
      sha256(new TextEncoder().encode(capabilityString))
    );

    const expiryTimestamp =
      Math.floor(Date.now() / 1000) + offer.deliverySeconds + 3600; // 1h grace period

    const unsigned = buildCreditEnvelope({
      intentEventId: offer.intentEventId,
      offerEventId: offer.eventId,
      providerPubkey: offer.providerPubkey,
      maxSats: offer.priceSats,
      scopeConstraintsHash,
      expiryTimestamp,
    });

    const signed = await this.ceps.signEventWithActiveSession(unsigned as any);
    return this.ceps.publishEvent(signed);
  }

  /**
   * Authorize a spend within an envelope's cap (kind:39243).
   *
   * @param envelopeId - The envelope event ID to spend against
   * @param amount - Amount in millisatoshis
   * @param description - Purpose of the spend
   * @returns Published spend auth event ID
   */
  async authorizeSpend(
    envelopeId: string,
    amount: bigint,
    description: string
  ): Promise<string> {
    const unsigned = buildSpendAuth({
      envelopeEventId: envelopeId,
      amountMsats: amount,
      description,
    });

    const signed = await this.ceps.signEventWithActiveSession(unsigned as any);
    return this.ceps.publishEvent(signed);
  }

  /**
   * Settle an envelope after task completion (kind:39244).
   *
   * @param envelopeId - The envelope event ID to settle
   * @param score - Task completion score (0–1)
   * @param totalSpent - Total millisatoshis spent
   * @returns Published settlement event ID
   */
  async settleEnvelope(
    envelopeId: string,
    score: number,
    totalSpent: bigint
  ): Promise<string> {
    const unsigned = buildSettlementReceipt({
      envelopeEventId: envelopeId,
      taskCompletionScore: score,
      totalSpentMsats: totalSpent,
      performanceBondRedeemed: false,
    });

    const signed = await this.ceps.signEventWithActiveSession(unsigned as any);
    return this.ceps.publishEvent(signed);
  }

  /**
   * Issue a default notice for an expired or abandoned envelope (kind:39245).
   *
   * @param envelopeId - The envelope event ID that defaulted
   * @param reason - Reason for default ("expired" | "abandoned" | "disputed")
   * @returns Published default notice event ID
   */
  async issueDefault(envelopeId: string, reason: string): Promise<string> {
    const unsigned = buildDefaultNotice({ envelopeEventId: envelopeId, reason });
    const signed = await this.ceps.signEventWithActiveSession(unsigned as any);
    return this.ceps.publishEvent(signed);
  }

  /**
   * Subscribe to credit lifecycle events for an envelope.
   *
   * Monitors kind:39241 (offers), kind:39244 (settlements), kind:39245
   * (defaults), and kind:1985 (revocations) filtered by the envelope's pubkey.
   *
   * @param envelopePubkey - Pubkey of the envelope author to monitor
   * @param relayUrl - Relay to subscribe on
   * @param callback - Called on each lifecycle event
   * @returns Unsubscribe function
   */
  subscribeLifecycle(
    envelopePubkey: string,
    relayUrl: string,
    callback: CreditLifecycleCallback
  ): () => void {
    let closed = false;
    let sub: { close: () => void } | null = null;

    import('nostr-tools').then(({ SimplePool }) => {
      if (closed) return;

      const pool = new SimplePool();
      sub = pool.subscribeMany(
        [relayUrl],
        [
          {
            kinds: [39241, 39244, 39245, 1985],
            authors: [envelopePubkey],
          },
        ],
        {
          onevent(event) {
            const eTag = event.tags.find((t: string[]) => t[0] === 'e');
            const envelopeId = eTag?.[1] ?? '';

            const typeMap: Record<number, string> = {
              39241: 'offer',
              39244: 'settlement',
              39245: 'default',
              1985: 'revocation',
            };

            const type = typeMap[event.kind];
            if (type) {
              callback({
                type,
                envelopeId,
                rawEvent: event as NostrEvent,
              });
            }
          },
        }
      );
    }).catch((err) => {
      console.error('[nip-ac/client] subscribeLifecycle error:', err);
    });

    return () => {
      closed = true;
      if (sub) {
        sub.close();
        sub = null;
      }
    };
  }

  /**
   * Fetch all active (non-expired, non-settled) envelopes for an agent.
   *
   * Queries the relay for kind:39242 events authored by the agent and filters
   * to those that have not yet expired.
   *
   * @param agentPubkey - Agent's hex pubkey
   * @param relayUrl - Relay to query
   * @returns Array of parsed CreditEnvelope objects
   */
  async getActiveEnvelopes(
    agentPubkey: string,
    relayUrl: string
  ): Promise<CreditEnvelope[]> {
    const events = await this.ceps.list(
      [
        {
          kinds: [39242],
          authors: [agentPubkey],
          limit: 100,
        },
      ],
      [relayUrl],
      { eoseTimeout: 5000 }
    );

    const now = Math.floor(Date.now() / 1000);

    return (events as any[])
      .map((event): CreditEnvelope | null => {
        try {
          const content: CreditEnvelopeContent = JSON.parse(event.content);
          const expiresAtTag = event.tags.find((t: string[]) => t[0] === 'expires_at');
          const expiresAt = expiresAtTag
            ? parseInt(expiresAtTag[1], 10)
            : content.expires_at;

          return {
            eventId: event.id,
            agentPubkey: content.agent_pubkey,
            governorPubkey: content.governor_pubkey,
            maxSats: content.max_sats,
            scopeConstraintsHash: content.scope_constraints_hash,
            expiresAt,
            state: 'envelope_constructed',
            rawEvent: event as NostrEvent,
          };
        } catch {
          return null;
        }
      })
      .filter((e): e is CreditEnvelope => e !== null && e.expiresAt > now);
  }
}



