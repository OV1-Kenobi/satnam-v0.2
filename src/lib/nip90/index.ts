/**
 * @module nip90
 * @description NIP-90 DVM (Data Vending Machine) client barrel export.
 *
 * Provides the complete NIP-90 client stack for integration with the
 * OpenAgents Autopilot DVM marketplace. Principals and Agents in Satnam v2
 * are both consumers and providers of DVM jobs.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/90.md
 * @see SPECIFICATION.md §8.1 — NIP-90 DVM Marketplace (Autopilot)
 *
 * @example
 * ```ts
 * import {
 *   constructJobRequest,
 *   subscribeToJobResults,
 *   subscribeToProviders,
 * } from '@lib/nip90';
 * import { finalizeEvent } from 'nostr-tools';
 *
 * // Construct and sign a text-generation job request
 * const unsigned = constructJobRequest({
 *   kind: 5100,
 *   input: [{ data: 'Summarize the Bitcoin whitepaper', type: 'text' }],
 *   params: [{ key: 'model', value: 'gpt-4o' }],
 *   bid_msats: 10000n,
 *   relays: ['wss://pylon.openagents.com'],
 * });
 * const signed = finalizeEvent(unsigned, mySecretKey);
 *
 * // Subscribe to results
 * const unsub = subscribeToJobResults(
 *   signed.id,
 *   5100,
 *   ['wss://pylon.openagents.com'],
 *   (result) => {
 *     console.log(result.content);
 *     unsub();
 *   },
 * );
 * ```
 */

export type {
  DvmInput,
  DvmParam,
  DvmJobRequest,
  DvmJobResult,
  DvmFeedback,
  DvmFeedbackStatus,
  DvmProvider,
  PaymentInfo,
  DvmInputType,
} from './types.js';

export {
  constructJobRequest,
  constructJobFeedback,
  constructJobFeedbackFromObject,
  parseJobResult,
  getResultKind,
} from './construct.js';

export type { UnsignedEvent } from './construct.js';

export {
  subscribeToJobResults,
  subscribeToProviders,
  waitForJobResult,
  fetchProviders,
} from './subscribe.js';
