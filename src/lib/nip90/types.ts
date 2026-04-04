/**
 * @module nip90/types
 * @description TypeScript type definitions for NIP-90 Data Vending Machine (DVM) client.
 *
 * NIP-90 defines a decentralized marketplace for AI and compute jobs on the
 * Nostr network. Satnam v2 implements the full NIP-90 client stack for
 * integration with the OpenAgents Autopilot DVM marketplace.
 *
 * ## Event Kinds
 *
 * | Kind Range | Description |
 * |---|---|
 * | 5000-5999 | Job requests (consumers → providers) |
 * | 6000-6999 | Job results (providers → consumers) |
 * | 7000      | Job feedback (consumers → providers) |
 * | 31990     | Provider capability announcements |
 *
 * Common job kinds:
 * - 5100: Text generation / LLM inference
 * - 5200: Text translation
 * - 5300: Text summarization
 * - 5400: Image generation
 * - 5500: Code generation
 * - 5600: Web search / research
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/90.md
 * @see SPECIFICATION.md §8.1 — NIP-90 DVM Marketplace (Autopilot)
 */

// ---------------------------------------------------------------------------
// Input and Parameter Types
// ---------------------------------------------------------------------------

/**
 * Valid DVM input types per NIP-90.
 */
export type DvmInputType =
  | 'url'      // URL to fetch as input
  | 'event'   // Nostr event ID
  | 'job'     // Reference to another DVM job result event ID
  | 'text';   // Raw text content

/**
 * A single input item for a DVM job request.
 * Maps to the `['i', data, type, relay?]` tag in the Nostr event.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/90.md#input-tags
 */
export interface DvmInput {
  /**
   * The input data:
   * - For 'text': raw text string
   * - For 'url': the URL to fetch
   * - For 'event': hex-encoded Nostr event ID
   * - For 'job': hex-encoded job result event ID
   */
  data: string;

  /** Input type discriminant. */
  type: DvmInputType;

  /**
   * Optional relay hint for 'event' and 'job' type inputs.
   * Tells the provider where to fetch the referenced event.
   */
  relay?: string;

  /**
   * Optional marker for additional context (provider-specific).
   */
  marker?: string;
}

/**
 * A single parameter for a DVM job request.
 * Maps to the `['param', key, value]` tag in the Nostr event.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/90.md#param-tags
 */
export interface DvmParam {
  /** Parameter name (e.g. 'model', 'max_tokens', 'language'). */
  key: string;

  /** Parameter value (always a string in the protocol; parse to typed value if needed). */
  value: string;
}

// ---------------------------------------------------------------------------
// Job Request
// ---------------------------------------------------------------------------

/**
 * Input for constructJobRequest(). Describes a job to be submitted to the
 * DVM marketplace.
 *
 * @see SPECIFICATION.md §8.1 — Job Request (kind:5xxx)
 */
export interface DvmJobRequest {
  /**
   * The job kind. Must be in range 5000-5999.
   * Common values: 5100 (text gen), 5200 (translation), 5300 (summary),
   * 5600 (research/search).
   */
  kind: number;

  /** Input data items for the job. */
  input: DvmInput[];

  /** Job parameters (model, settings, etc.). */
  params: DvmParam[];

  /**
   * Maximum price the consumer is willing to pay, in millisatoshis.
   * Providers will only respond if their price is at or below this amount.
   */
  bid_msats?: bigint;

  /**
   * Preferred relay URLs for result delivery.
   * Providers should publish their results to at least one of these relays.
   */
  relays?: string[];

  /**
   * If set, the job request content and inputs are NIP-44 encrypted to this
   * pubkey (the provider's pubkey for private jobs). An `['encrypted']` tag
   * is added to the event.
   */
  encryptTo?: string;

  /**
   * Optional output format hint for the provider.
   * Common values: 'text/plain', 'application/json', 'text/markdown'
   */
  outputMimeType?: string;
}

// ---------------------------------------------------------------------------
// Job Result
// ---------------------------------------------------------------------------

/**
 * Parsed representation of a NIP-90 job result event (kind 6000-6999).
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/90.md#job-result
 */
export interface DvmJobResult {
  /**
   * The result event ID (hex).
   */
  id: string;

  /**
   * Hex-encoded pubkey of the DVM provider that produced this result.
   */
  providerPubkey: string;

  /**
   * The kind of the original job request (5xxx). The result kind is always
   * `requestKind + 1000`.
   */
  requestKind: number;

  /**
   * Hex event ID of the original job request this result responds to.
   */
  requestEventId: string;

  /**
   * The result content. May be NIP-44 encrypted if the job was encrypted.
   */
  content: string;

  /**
   * Whether the result content is NIP-44 encrypted.
   */
  encrypted: boolean;

  /**
   * Payment information from the result's `amount` tag.
   * Present when the provider requests payment.
   */
  payment?: PaymentInfo;

  /**
   * Unix timestamp when the result was published.
   */
  createdAt: number;

  /**
   * Raw event tags for provider-specific data.
   */
  tags: string[][];
}

// ---------------------------------------------------------------------------
// Job Feedback
// ---------------------------------------------------------------------------

/**
 * Valid feedback status codes per NIP-90.
 */
export type DvmFeedbackStatus =
  | 'payment-required'  // Provider is requesting payment before processing
  | 'processing'        // Job is being processed
  | 'error'             // Job failed
  | 'success'           // Job completed successfully
  | 'partial';          // Partial result available (streaming)

/**
 * A NIP-90 job feedback event (kind:7000).
 * Published by consumers after receiving results, or by providers during
 * processing to indicate status.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/90.md#job-feedback
 */
export interface DvmFeedback {
  /**
   * Hex event ID of the job request this feedback relates to.
   */
  requestEventId: string;

  /**
   * Hex event ID of the job result this feedback acknowledges.
   * Optional — may be omitted for pre-result status updates.
   */
  resultEventId?: string;

  /**
   * Hex-encoded pubkey of the DVM provider.
   */
  providerPubkey: string;

  /**
   * Feedback status code.
   */
  status: DvmFeedbackStatus;

  /**
   * Optional human-readable feedback message.
   */
  content?: string;

  /**
   * Optional payment amount in millisatoshis (for payment-required status).
   */
  amountMsats?: bigint;

  /**
   * Optional BOLT-11 Lightning invoice for payment.
   */
  invoice?: string;
}

// ---------------------------------------------------------------------------
// Payment Info
// ---------------------------------------------------------------------------

/**
 * Payment information extracted from a DVM job result's `amount` tag.
 *
 * The `amount` tag format per NIP-90:
 * `["amount", "<msats>", "<bolt11_or_cashu>"]`
 *
 * @see SPECIFICATION.md §8.1 — Payment flow
 */
export interface PaymentInfo {
  /**
   * Amount in millisatoshis requested by the provider.
   */
  amountMsats: bigint;

  /**
   * Payment credential: BOLT-11 Lightning invoice or Cashu token.
   * Absent for pre-quotes (amount-only tags without invoice).
   */
  invoice?: string;

  /**
   * Whether the invoice is a Cashu token (starts with 'cashu').
   */
  isCashu: boolean;
}

// ---------------------------------------------------------------------------
// Provider Discovery
// ---------------------------------------------------------------------------

/**
 * A NIP-90 DVM provider discovered via kind:31990 events.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/90.md#provider-discovery
 */
export interface DvmProvider {
  /**
   * Hex-encoded pubkey of the provider.
   */
  pubkey: string;

  /**
   * The NIP-90 job kind(s) this provider supports (5xxx range).
   */
  supportedJobKinds: number[];

  /**
   * Provider display name, if set in the event tags.
   */
  name?: string;

  /**
   * Provider description, from the event content.
   */
  about?: string;

  /**
   * NIP-05 identifier for the provider, if set.
   */
  nip05?: string;

  /**
   * Encrypted endpoint indicator — if true, this provider only accepts
   * encrypted job requests.
   */
  encryptedOnly: boolean;

  /**
   * Relay URLs where this provider listens for job requests.
   */
  relays: string[];

  /**
   * NIP-SKL skill scope IDs attesting this provider's capabilities.
   * Used for Guardian-attested skill verification.
   */
  skillScopeIds: string[];

  /**
   * Provider reputation score (0.0–1.0), computed from settlement receipts
   * and default notices.
   */
  reputationScore?: number;

  /**
   * Unix timestamp of the kind:31990 event.
   */
  createdAt: number;
}
