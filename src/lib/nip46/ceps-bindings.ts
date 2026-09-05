/**
 * @module nip46/ceps-bindings
 * @description REAL CEPS bindings for the NIP-46 presence seams (WP-2 Item 3,
 * Amendment 2.0).
 *
 * Binds the real CentralEventPublishingService client functions
 * (src/lib/ceps/ceps-client.ts) into the injected presence seams from
 * presence.ts:
 * - publisher seam (Nip46PresencePublisher) — kind:10003 republish;
 * - fetcher seam (Nip46PresenceWatch.fetchLatestPresence) — kind:10003 query;
 * - subscriber seam (Nip46PresenceWatch.subscribe) — kind:10003 subscription.
 *
 * SIGNING PATH (founder decision F-2a, fix-plan 08 Amendment 2.0): the
 * publisher receives the bunker-identity signing seam as an INJECTED
 * parameter. This matches the design note's bunker signing model (design §1
 * steps 10-11: vault signing key, zeroized after use; the signing seam is
 * injected from outside per the bunker module's documented pattern) and
 * avoids signEventWithCeps, whose F-11 consent gate
 * (central-event-publishing-service.ts :474-506) REJECTS kind:10003 unless
 * the kind is whitelisted. CEPS is used for publication and subscription
 * only. The F-2 option-b alternative (signEventWithCeps composition plus a
 * CONSENT_AUTO_APPROVED_KINDS change) is EXPLICITLY REJECTED by the founder
 * (Amendment 2.0) — it is dead and must not be implemented.
 *
 * TEST STRATEGY (founder decision F-3, Amendment 2.0 — real relay, no
 * mock-boundary tests): the CEPS functions are received as INJECTED
 * parameters defaulting to the real ceps-client exports, so the unit tests
 * exercise pure composition (binding construction, signing order,
 * filter/URL shapes, relays pass-through, handler mapping, unsubscribe
 * mapping) with zero module mocking and zero network. The substantive
 * round-trip coverage is REAL relay: tests/lib/nip46-ceps-bindings
 * .integration.test.ts runs only when the NIP46_TEST_RELAY config is present
 * and reachable, uses a synthetic ephemeral keypair, and cleans up by
 * republishing an empty presence list. No production path in this
 * change-group connects to any relay (WP-2 non-negotiable 8, F-3 override
 * limited to the integration test surface).
 */

import {
  publishEventWithCeps,
  listEventsWithCeps,
  subscribeWithCeps,
  getDefaultRelays,
} from '../ceps/ceps-client.js';
import {
  NIP46_PRESENCE_KIND,
  type Nip46PresenceEventTemplate,
  type Nip46PresenceObservation,
  type Nip46PresencePublisher,
} from './presence.js';

/**
 * Pure: build the kind:10003 presence filter for a bunker pubkey.
 * Relay-independent; unit-tested directly (filter/URL shapes).
 */
export function buildPresenceFilter(
  bunkerPubkey: string,
): { kinds: number[]; authors: string[] } {
  return { kinds: [NIP46_PRESENCE_KIND], authors: [bunkerPubkey] };
}

/**
 * Pure: map an onEvent callback to the subscribeMany handler shape
 * ({ onevent, oneose }). Relay-independent; exercised via the subscriber.
 */
export function mapPresenceSubscribeHandlers(
  onEvent: (event: Nip46PresenceObservation) => void,
): { onevent: (event: unknown) => void; oneose: () => void } {
  return {
    onevent: (event: unknown) => onEvent(event as Nip46PresenceObservation),
    oneose: () => {},
  };
}

/**
 * Bind the presence PUBLISHER seam (kind:10003 republish): sign the template
 * with the bunker identity (injected signing seam), then publish the signed
 * event via CEPS. The publish function is injectable (defaults to the real
 * publishEventWithCeps) so the logic tests run without a relay and without
 * module mocks (founder decision F-3). Returns the publish result.
 */
export function bindCepsPresencePublisher(params: {
  signer: (template: Nip46PresenceEventTemplate) => Promise<unknown>;
  relays?: string[];
  publish?: typeof publishEventWithCeps;
}): Nip46PresencePublisher {
  const publish = params.publish ?? publishEventWithCeps;
  return async (template) => {
    const signed = await params.signer(template);
    return publish(
      signed as Parameters<typeof publishEventWithCeps>[0],
      params.relays,
    );
  };
}

/**
 * Bind the presence FETCHER seam: query the bunker's latest kind:10003 via
 * CEPS list and return the newest event (or null when none exists). The list
 * function is injectable (defaults to the real listEventsWithCeps).
 */
export function bindCepsPresenceFetcher(params: {
  bunkerPubkey: string;
  relays?: string[];
  list?: typeof listEventsWithCeps;
}): () => Promise<Nip46PresenceObservation | null> {
  const list = params.list ?? listEventsWithCeps;
  return async () => {
    const events = await list(buildPresenceFilter(params.bunkerPubkey), params.relays);
    return events[0] ?? null;
  };
}

/**
 * Bind the presence SUBSCRIBER seam: subscribe to the bunker's kind:10003 via
 * CEPS and return an async unsubscribe (the CEPS client is lazy-loaded). The
 * returned Promise<() => void> satisfies the async-capable seam added to
 * Nip46PresenceWatch (fix-plan 08, Item 3a). The subscribe function is
 * injectable (defaults to the real subscribeWithCeps).
 */
export function bindCepsPresenceSubscriber(params: {
  bunkerPubkey: string;
  relays?: string[];
  subscribe?: typeof subscribeWithCeps;
}): (onEvent: (event: Nip46PresenceObservation) => void) => Promise<() => void> {
  const subscribe = params.subscribe ?? subscribeWithCeps;
  return async (onEvent) => {
    const sub = await subscribe(
      params.relays ?? getDefaultRelays(),
      buildPresenceFilter(params.bunkerPubkey),
      mapPresenceSubscribeHandlers(onEvent),
    );
    return () => sub.close();
  };
}