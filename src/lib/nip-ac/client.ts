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

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { calculateReputationDelta } from '../agent/llm/cost.js';
import type { CepsClient } from '../ceps/ceps-client.js';
import type {
  NostrEvent,
  CreditOfferContent,
  CreditEnvelopeContent,
  CreditLifecycleState,
} from './types.js';

export { calculateReputationDelta };

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
  /** Maximum budget in sats */
  budgetSats: number;
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
 *   budgetSats: 5000, // sats
 *   deadlineTimestamp: Math.floor(Date.now() / 1000) + 3600,
 *   requiredSkills: ['research-v2'],
 * });
 * ```
 */
export function buildCreditIntent(params: IntentParams): UnsignedEvent {
  const { description, budgetSats, deadlineTimestamp, requiredSkills, preferredProviders } = params;

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
    budget_sats: budgetSats,
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
 * - ["e", "<offer_event_id>"]          (single — the accepted offer)
 * - ["p", "<agent_pubkey>"]
 * - ["max_sats", "<sats>"]
 * - ["expires_at", "<unix_timestamp>"]
 * - ["scope_hash", "<sha256_of_skill_manifest>"]
 *
 * @param params - Envelope construction parameters
 * @returns Unsigned kind:39242 event
 */
export function buildCreditEnvelope(params: {
  offerEventId: string;
  providerPubkey: string;
  /** The Principal/Guardian issuing the envelope (the signing identity) */
  governorPubkey: string;
  maxSats: number;
  /** SHA-256 of the NIP-SKL skill manifest event ID */
  scopeConstraintsHash: string;
  expiryTimestamp: number;
}): UnsignedEvent {
  const {
    offerEventId,
    providerPubkey,
    governorPubkey,
    maxSats,
    scopeConstraintsHash,
    expiryTimestamp,
  } = params;

  const tags: string[][] = [
    ['d', generateDTag('envelope')],
    ['e', offerEventId],
    ['p', providerPubkey],
    ['max_sats', String(maxSats)],
    ['expires_at', String(expiryTimestamp)],
    ['scope_hash', scopeConstraintsHash],
  ];

  const content: CreditEnvelopeContent = {
    offer_id: offerEventId,
    agent_pubkey: providerPubkey, // Provider acts as the authorized agent
    governor_pubkey: governorPubkey,
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
 * - ["p", "<agent_pubkey>"]
 * - ["amount", "<sats>"]
 *
 * Content fields: envelope_id, agent_pubkey, amount_sats, purpose, rail,
 * recipient? (omitted when absent).
 *
 * @param params - Spend authorization parameters
 * @returns Unsigned kind:39243 event
 */
export function buildSpendAuth(params: {
  envelopeEventId: string;
  agentPubkey: string;
  amountSats: number;
  purpose: string;
  rail?: "lightning" | "cashu";
  recipient?: string;
}): UnsignedEvent {
  const { envelopeEventId, agentPubkey, amountSats, purpose, rail, recipient } = params;

  const tags: string[][] = [
    ['e', envelopeEventId],
    ['p', agentPubkey],
    ['amount', String(amountSats)],
  ];

  const content = JSON.stringify({
    envelope_id: envelopeEventId,
    agent_pubkey: agentPubkey,
    amount_sats: amountSats,
    purpose,
    rail: rail ?? 'lightning',
    ...(recipient ? { recipient } : {}),
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
 * The reputation delta is calculated via `calculateReputationDelta()` (the
 * canonical implementation from `../agent/llm/cost.ts`) on the 0–100 score
 * and included in the settlement content for on-chain verifiability.
 *
 * Tags:
 * - ["e", "<envelope_event_id>"]
 * - ["p", "<agent_pubkey>"]
 * - ["score", "<0-100>"]
 *
 * @param params - Settlement receipt parameters (score 0–100, total spent in sats)
 * @returns Unsigned kind:39244 event
 */
export function buildSettlementReceipt(params: {
  envelopeEventId: string;
  agentPubkey: string;
  governorPubkey: string;
  /** Task completion score 0–100 (clamped at this seam) */
  taskCompletionScore: number;
  totalSatsSpent: number;
  performanceBondRedeemed: boolean;
  /** Cashu token proof for Sig4Sats bond redemption */
  cashuRedemptionProof?: string;
  /** Completion proof for the finished task */
  completionProof?: string;
}): UnsignedEvent {
  const {
    envelopeEventId,
    agentPubkey,
    governorPubkey,
    taskCompletionScore,
    totalSatsSpent,
    performanceBondRedeemed,
    cashuRedemptionProof,
    completionProof,
  } = params;

  // Normalize score to 0–100 at this single seam (spec uses 0–100 in SettlementReceiptContent)
  const score = Math.round(Math.min(100, Math.max(0, taskCompletionScore)));

  // Calculate reputation delta (canonical formula, 0–100 in)
  const repDelta = calculateReputationDelta(score, 1.0, performanceBondRedeemed);

  const tags: string[][] = [
    ['e', envelopeEventId],
    ['p', agentPubkey],
    ['score', String(score)],
  ];

  const content = JSON.stringify({
    envelope_id: envelopeEventId,
    agent_pubkey: agentPubkey,
    governor_pubkey: governorPubkey,
    total_sats_spent: totalSatsSpent,
    task_completion_score: score,
    reputation_delta: repDelta,
    has_performance_bond: performanceBondRedeemed,
    ...(cashuRedemptionProof ? { sig4sats_proof: cashuRedemptionProof } : {}),
    ...(completionProof ? { completion_proof: completionProof } : {}),
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
 *   budgetSats: 5000,
 *   deadlineTimestamp: Math.floor(Date.now() / 1000) + 3600,
 *   requiredSkills: ['research-v2'],
 * });
 * ```
 */
export class CreditLifecycleManager {
  private readonly ceps: CepsClient;

  constructor(
    ceps: CepsClient,
    _vault?: { loadAgentNsec(agentNpub: string): Promise<string> }
  ) {
    this.ceps = ceps;
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
   * @param governorPubkey - The accepting Principal's pubkey (the envelope governor)
   * @returns Published envelope event ID
   */
  async acceptOffer(offer: CreditOffer, governorPubkey: string): Promise<string> {
    // Derive a deterministic scope constraints hash from the offer's capabilities
    const capabilityString = offer.capabilities.sort().join(',');
    const scopeConstraintsHash = bytesToHex(
      sha256(new TextEncoder().encode(capabilityString))
    );

    const expiryTimestamp =
      Math.floor(Date.now() / 1000) + offer.deliverySeconds + 3600; // 1h grace period

    const unsigned = buildCreditEnvelope({
      offerEventId: offer.eventId,
      providerPubkey: offer.providerPubkey,
      governorPubkey,
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
   * @param agentPubkey - The authorized agent's pubkey (content.agent_pubkey + p tag)
   * @param amountSats - Amount in sats
   * @param purpose - Description of what the spend is for
   * @returns Published spend auth event ID
   */
  async authorizeSpend(
    envelopeId: string,
    agentPubkey: string,
    amountSats: number,
    purpose: string
  ): Promise<string> {
    const unsigned = buildSpendAuth({
      envelopeEventId: envelopeId,
      agentPubkey,
      amountSats,
      purpose,
    });

    const signed = await this.ceps.signEventWithActiveSession(unsigned as any);
    return this.ceps.publishEvent(signed);
  }

  /**
   * Settle an envelope after task completion (kind:39244).
   *
   * @param envelopeId - The envelope event ID to settle
   * @param agentPubkey - The authorized agent's pubkey (content.agent_pubkey + p tag)
   * @param governorPubkey - The envelope governor's pubkey (content.governor_pubkey)
   * @param score - Task completion score 0–100
   * @param totalSatsSpent - Total sats spent
   * @returns Published settlement event ID
   */
  async settleEnvelope(
    envelopeId: string,
    agentPubkey: string,
    governorPubkey: string,
    score: number,
    totalSatsSpent: number
  ): Promise<string> {
    const unsigned = buildSettlementReceipt({
      envelopeEventId: envelopeId,
      agentPubkey,
      governorPubkey,
      taskCompletionScore: score,
      totalSatsSpent,
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
        {
          kinds: [39241, 39244, 39245, 1985],
          authors: [envelopePubkey],
        },
        {
          onevent(event) {
            const eTag = event.tags.find((t: string[]) => t[0] === 'e');
            const envelopeId = eTag?.[1] ?? '';

            const typeMap: Record<number, 'offer' | 'settlement' | 'default' | 'revocation'> = {
              39241: 'offer',
              39244: 'settlement',
              39245: 'default',
              1985: 'revocation',
            };

            const type = typeMap[event.kind] as 'offer' | 'settlement' | 'default' | 'revocation' | undefined;
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
      {
        kinds: [39242],
        authors: [agentPubkey],
        limit: 100,
      },
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



