/**
 * @module pylon
 * @description Pylon relay NIP-42 AUTH integration and CEPS extension.
 *
 * ## Exports
 *
 * - `PylonAuth` — NIP-42 challenge/response handler for the Pylon relay
 * - `PylonCepsClient` — Pylon-first event publishing with fallback relays
 * - `PYLON_RELAY_URL` — Canonical Pylon relay URL constant
 * - `PYLON_PRIMARY_KINDS` — Set of Nostr event kinds routed through Pylon
 *
 * ## Quick Start
 *
 * ```typescript
 * import { PylonAuth, PylonCepsClient, PYLON_RELAY_URL } from '../lib/pylon';
 *
 * const auth = new PylonAuth(vault);
 * const client = new PylonCepsClient(auth, fallbackRelays);
 *
 * // Connect and authenticate
 * await auth.connect(PYLON_RELAY_URL, signerNsec);
 *
 * // Publish an event
 * await client.publish(signedEvent);
 *
 * // Subscribe to trajectory events
 * const unsub = client.subscribe(
 *   { kinds: [39230, 39231], '#p': [agentPubkey] },
 *   (event) => handleEvent(event)
 * );
 * ```
 */

export { PylonAuth, PYLON_RELAY_URL } from './auth.js';
export { PylonCepsClient, PYLON_PRIMARY_KINDS } from './ceps-pylon.js';
