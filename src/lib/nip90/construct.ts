/**
 * @module nip90/construct
 * @description NIP-90 DVM job request and feedback construction.
 *
 * Functions to construct Nostr events for the NIP-90 DVM marketplace:
 * - Job requests (kind 5xxx)
 * - Job feedback (kind 7000)
 * - Job result parsing (kind 6xxx)
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/90.md
 * @see SPECIFICATION.md §8.1 — NIP-90 DVM Marketplace (Autopilot)
 */

import type {
  DvmJobRequest,
  DvmJobResult,
  DvmFeedback,
  DvmFeedbackStatus,
  PaymentInfo,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/**
 * An unsigned Nostr event ready for signing.
 * Compatible with nostr-tools' UnsignedEvent shape.
 */
export interface UnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  /** Not yet present until signed. */
  pubkey?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that a job kind is in the NIP-90 request range (5000-5999).
 * @internal
 */
function validateJobKind(kind: number): void {
  if (!Number.isInteger(kind) || kind < 5000 || kind > 5999) {
    throw new RangeError(
      `NIP-90 job request kind must be in range 5000-5999, got: ${kind}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Payment Parsing
// ---------------------------------------------------------------------------

/**
 * Parse the `amount` tag from a NIP-90 job result event.
 *
 * Tag format: `["amount", "<msats>", "<bolt11_or_cashu>?"]`
 *
 * @param amountTag - The raw `amount` tag array
 * @returns Parsed PaymentInfo, or null if tag is absent or malformed
 * @internal
 */
function parseAmountTag(amountTag: string[] | undefined): PaymentInfo | null {
  if (!amountTag || amountTag.length < 2) return null;

  const msatsStr = amountTag[1];
  if (!msatsStr) return null;

  let amountMsats: bigint;
  try {
    amountMsats = BigInt(msatsStr);
  } catch {
    return null;
  }

  const invoice = amountTag[2];
  return {
    amountMsats,
    invoice: invoice ?? undefined,
    isCashu: typeof invoice === 'string' && invoice.startsWith('cashu'),
  };
}

// ---------------------------------------------------------------------------
// Job Request Construction
// ---------------------------------------------------------------------------

/**
 * Construct an unsigned NIP-90 job request event (kind 5xxx).
 *
 * The returned UnsignedEvent must be signed before publishing. Use
 * nostr-tools' finalizeEvent() to sign with the consumer's nsec.
 *
 * @param request - Job request parameters
 * @returns Unsigned Nostr event ready for signing
 * @throws {RangeError} if request.kind is outside 5000-5999
 *
 * @example
 * ```ts
 * import { constructJobRequest } from '@lib/nip90';
 * import { finalizeEvent } from 'nostr-tools';
 *
 * const unsigned = constructJobRequest({
 *   kind: 5100,  // text generation
 *   input: [{ data: 'Summarize the Bitcoin whitepaper', type: 'text' }],
 *   params: [{ key: 'model', value: 'gpt-4o' }],
 *   bid_msats: 10000n,
 *   relays: ['wss://pylon.openagents.com'],
 * });
 *
 * const signed = finalizeEvent(unsigned, mySecretKey);
 * // publish signed to relay...
 * ```
 *
 * @see SPECIFICATION.md §8.1 — Job Request (kind:5xxx)
 */
export function constructJobRequest(request: DvmJobRequest): UnsignedEvent {
  validateJobKind(request.kind);

  const tags: string[][] = [];

  // Add input tags: ['i', data, type, relay?]
  for (const input of request.input) {
    const inputTag: string[] = ['i', input.data, input.type];
    if (input.relay) inputTag.push(input.relay);
    if (input.marker) inputTag.push(input.marker);
    tags.push(inputTag);
  }

  // Add param tags: ['param', key, value]
  for (const param of request.params) {
    tags.push(['param', param.key, param.value]);
  }

  // Add bid tag if provided
  if (request.bid_msats !== undefined) {
    tags.push(['bid', request.bid_msats.toString()]);
  }

  // Add relay tags
  if (request.relays && request.relays.length > 0) {
    for (const relay of request.relays) {
      tags.push(['relays', relay]);
    }
  }

  // Add output MIME type if provided
  if (request.outputMimeType) {
    tags.push(['output', request.outputMimeType]);
  }

  // Add encrypted tag if result encryption is requested
  if (request.encryptTo) {
    tags.push(['encrypted']);
    tags.push(['p', request.encryptTo]);
  }

  // Content: encrypted input array (NIP-44) or empty
  // For non-encrypted requests, content is empty string per NIP-90
  let content = '';
  if (request.encryptTo) {
    // In practice, the caller is responsible for performing NIP-44 encryption.
    // We serialize the inputs to JSON for the caller to encrypt.
    content = JSON.stringify(request.input);
  }

  return {
    kind: request.kind,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content,
  };
}

// ---------------------------------------------------------------------------
// Job Feedback Construction
// ---------------------------------------------------------------------------

/**
 * Construct an unsigned NIP-90 job feedback event (kind:7000).
 *
 * Job feedback is published by consumers after receiving and validating a
 * job result. It signals completion, payment, and satisfaction to the provider.
 *
 * @param requestEventId - Hex event ID of the original job request
 * @param resultEventId - Hex event ID of the job result (may be empty string
 *                        for pre-result status updates like 'payment-required')
 * @param providerPubkey - Hex pubkey of the provider
 * @param status - Feedback status code
 * @param amountMsats - Optional payment amount in millisatoshis (for 'success')
 * @returns Unsigned Nostr event ready for signing
 *
 * @example
 * ```ts
 * const feedback = constructJobFeedback(
 *   requestEventId,
 *   resultEventId,
 *   providerPubkey,
 *   'success',
 *   5000n,
 * );
 * const signed = finalizeEvent(feedback, mySecretKey);
 * ```
 *
 * @see SPECIFICATION.md §8.1 — Job Feedback (kind:7000)
 */
export function constructJobFeedback(
  requestEventId: string,
  resultEventId: string,
  providerPubkey: string,
  status: DvmFeedbackStatus,
  amountMsats?: bigint,
): UnsignedEvent {
  const tags: string[][] = [
    ['e', requestEventId],
    ['p', providerPubkey],
    ['status', status],
  ];

  // Add result event reference if provided
  if (resultEventId && resultEventId.length > 0) {
    tags.push(['e', resultEventId]);
  }

  // Add amount tag if payment amount is specified
  if (amountMsats !== undefined) {
    tags.push(['amount', amountMsats.toString(), 'msats']);
  }

  return {
    kind: 7000,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };
}

/**
 * Construct a job feedback event from a DvmFeedback object.
 * Convenience overload of constructJobFeedback() for structured input.
 *
 * @param feedback - Structured feedback data
 * @returns Unsigned Nostr event ready for signing
 */
export function constructJobFeedbackFromObject(feedback: DvmFeedback): UnsignedEvent {
  const tags: string[][] = [
    ['e', feedback.requestEventId],
    ['p', feedback.providerPubkey],
    ['status', feedback.status],
  ];

  if (feedback.resultEventId) {
    tags.push(['e', feedback.resultEventId]);
  }

  if (feedback.amountMsats !== undefined) {
    const amountTag: string[] = ['amount', feedback.amountMsats.toString(), 'msats'];
    if (feedback.invoice) amountTag.push(feedback.invoice);
    tags.push(amountTag);
  }

  return {
    kind: 7000,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: feedback.content ?? '',
  };
}

// ---------------------------------------------------------------------------
// Job Result Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a raw Nostr event (kind 6xxx) into a structured DvmJobResult.
 *
 * Extracts:
 * - `requestEventId` from the `e` tag
 * - `payment` from the `amount` tag
 * - `encrypted` status from the `encrypted` tag
 *
 * @param event - Raw Nostr event with kind 6000-6999
 * @returns Parsed DvmJobResult
 * @throws {RangeError} if event kind is outside 6000-6999
 * @throws {Error} if the event is missing required tags
 *
 * @example
 * ```ts
 * pool.subscribeMany(relays, [{ kinds: [6100], '#e': [requestId] }], {
 *   onevent(event) {
 *     const result = parseJobResult(event);
 *     console.log(result.content, result.payment?.amountMsats);
 *   },
 * });
 * ```
 */
export function parseJobResult(event: {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}): DvmJobResult {
  if (!Number.isInteger(event.kind) || event.kind < 6000 || event.kind > 6999) {
    throw new RangeError(
      `NIP-90 job result kind must be in range 6000-6999, got: ${event.kind}`,
    );
  }

  // Find the job request event ID from the first `e` tag
  const eTag = event.tags.find((t) => t[0] === 'e');
  if (!eTag || !eTag[1]) {
    throw new Error('NIP-90 job result missing required `e` tag (job request reference)');
  }
  const requestEventId = eTag[1];

  // Compute the request kind: result kind is request kind + 1000
  const requestKind = event.kind - 1000;

  // Check for encrypted tag
  const encrypted = event.tags.some((t) => t[0] === 'encrypted');

  // Parse amount tag
  const amountTag = event.tags.find((t) => t[0] === 'amount');
  const payment = parseAmountTag(amountTag);

  return {
    id: event.id,
    providerPubkey: event.pubkey,
    requestKind,
    requestEventId,
    content: event.content,
    encrypted,
    payment: payment ?? undefined,
    createdAt: event.created_at,
    tags: event.tags,
  };
}

/**
 * Compute the result kind for a given request kind.
 * NIP-90: result kind = request kind + 1000.
 *
 * @param requestKind - Job request kind (5000-5999)
 * @returns Corresponding result kind (6000-6999)
 * @throws {RangeError} if requestKind is outside 5000-5999
 */
export function getResultKind(requestKind: number): number {
  validateJobKind(requestKind);
  return requestKind + 1000;
}
