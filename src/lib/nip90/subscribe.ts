/**
 * @module nip90/subscribe
 * @description NIP-90 DVM subscription helpers.
 *
 * Provides relay subscription functions for:
 * - Monitoring job results for a submitted job request
 * - Discovering DVM providers for a target job kind
 *
 * Uses nostr-tools SimplePool for efficient multi-relay connection management.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/90.md
 * @see SPECIFICATION.md §8.1 — NIP-90 DVM Marketplace (Autopilot)
 */

import { SimplePool, type Filter } from 'nostr-tools';

import type { DvmJobResult, DvmProvider } from './types.js';
import { parseJobResult } from './construct.js';

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/**
 * Shape of a raw Nostr event from nostr-tools subscriptions.
 * @internal
 */
interface RawNostrEvent {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  sig: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a kind:31990 provider announcement event into a DvmProvider object.
 *
 * Provider events use the following tags:
 * - `['k', '<job_kind>']` — supported job kind
 * - `['nip90Params', ...]` — supported parameters for the kind
 * - `['relay', '<relay_url>']` — relay URLs
 * - `['nip05', '<nip05>']` — NIP-05 identifier
 * - `['encrypted']` — only accepts encrypted requests
 *
 * @param event - Raw kind:31990 event
 * @returns Parsed DvmProvider
 * @internal
 */
function parseProviderEvent(event: RawNostrEvent): DvmProvider {
  const supportedJobKinds: number[] = [];
  const relays: string[] = [];
  const skillScopeIds: string[] = [];
  let name: string | undefined;
  let about: string | undefined;
  let nip05: string | undefined;
  let encryptedOnly = false;

  for (const tag of event.tags) {
    const [tagName, ...tagValues] = tag;
    switch (tagName) {
      case 'k': {
        const kind = parseInt(tagValues[0] ?? '', 10);
        if (!isNaN(kind)) supportedJobKinds.push(kind);
        break;
      }
      case 'relay':
        if (tagValues[0]) relays.push(tagValues[0]);
        break;
      case 'name':
        name = tagValues[0];
        break;
      case 'about':
        about = tagValues[0];
        break;
      case 'nip05':
        nip05 = tagValues[0];
        break;
      case 'encrypted':
        encryptedOnly = true;
        break;
      case 'skill':
        if (tagValues[0]) skillScopeIds.push(tagValues[0]);
        break;
    }
  }

  // Try to parse about from content if not in tags
  if (!about && event.content) {
    try {
      const parsed = JSON.parse(event.content) as Record<string, unknown>;
      if (typeof parsed['about'] === 'string') about = parsed['about'];
      if (typeof parsed['name'] === 'string' && !name) name = parsed['name'];
      if (typeof parsed['nip05'] === 'string' && !nip05) nip05 = parsed['nip05'];
    } catch {
      // content is not JSON — use as-is
      if (!about) about = event.content;
    }
  }

  return {
    pubkey: event.pubkey,
    supportedJobKinds,
    name,
    about,
    nip05,
    encryptedOnly,
    relays,
    skillScopeIds,
    createdAt: event.created_at,
  };
}

// ---------------------------------------------------------------------------
// Job Result Subscription
// ---------------------------------------------------------------------------

/**
 * Subscribe to NIP-90 job results for a specific job request.
 *
 * Subscribes to all provided relay URLs for events matching:
 * - kind: requestKind + 1000 (i.e., 6xxx)
 * - #e tag matching the requestEventId
 *
 * Also subscribes to kind:7000 (feedback) events for the same job request,
 * allowing the callback to receive status updates (e.g., 'payment-required',
 * 'processing', 'error').
 *
 * The returned function unsubscribes from all relay subscriptions and closes
 * any relay connections established solely for this subscription.
 *
 * @param requestEventId - Hex event ID of the original job request
 * @param requestKind - The kind of the original job request (5000-5999)
 * @param relayUrls - Array of relay WebSocket URLs to subscribe on
 * @param callback - Called for each job result or feedback event received
 * @returns Unsubscribe function — call when done to clean up relay connections
 *
 * @example
 * ```ts
 * const unsubscribe = subscribeToJobResults(
 *   jobRequestId,
 *   5100,
 *   ['wss://pylon.openagents.com', 'wss://relay.damus.io'],
 *   (result) => {
 *     console.log('Got result:', result.content);
 *     if (result.payment) {
 *       console.log('Pay:', result.payment.amountMsats, 'msats');
 *     }
 *     unsubscribe(); // stop after first result
 *   },
 * );
 * ```
 *
 * @see SPECIFICATION.md §8.1 — Job Result (kind:6xxx)
 */
export function subscribeToJobResults(
  requestEventId: string,
  requestKind: number,
  relayUrls: string[],
  callback: (result: DvmJobResult) => void,
): () => void {
  const pool = new SimplePool();

  const resultKind = requestKind + 1000;

  // Subscribe to job results (6xxx) and feedback (7000) in a combined filter
  const combinedFilter: Filter = {
    kinds: [resultKind, 7000],
    '#e': [requestEventId],
  };

  const sub = pool.subscribeMany(
    relayUrls,
    combinedFilter,
    {
      onevent: (event: RawNostrEvent) => {
        if (event.kind >= 6000 && event.kind <= 6999) {
          // Parse job result
          try {
            const result = parseJobResult(event);
            callback(result);
          } catch {
            // Malformed result — skip silently
          }
        } else if (event.kind === 7000) {
          // Parse feedback event as a pseudo-result for status tracking
          const statusTag = event.tags.find((t) => t[0] === 'status');
          const eTag = event.tags.find((t) => t[0] === 'e');

          if (statusTag) {
            // Build a minimal DvmJobResult to convey feedback status
            const feedbackResult: DvmJobResult = {
              id: event.id,
              providerPubkey: event.pubkey,
              requestKind,
              requestEventId: eTag?.[1] ?? requestEventId,
              content: event.content,
              encrypted: false,
              createdAt: event.created_at,
              tags: event.tags,
            };
            callback(feedbackResult);
          }
        }
      },
      oneose: () => {
        // EOSE received — no action needed, remain subscribed for live updates
      },
    },
  );

  return () => {
    sub.close();
    pool.destroy();
  };
}

/**
 * Subscribe to NIP-90 job results with a Promise-based API.
 * Resolves with the first job result received.
 *
 * Automatically unsubscribes after receiving the first result or on timeout.
 *
 * @param requestEventId - Hex event ID of the original job request
 * @param requestKind - The kind of the original job request (5000-5999)
 * @param relayUrls - Array of relay WebSocket URLs
 * @param timeoutMs - Maximum time to wait for a result (default: 60 seconds)
 * @returns Promise resolving to the first job result
 * @throws {Error} if timeout expires before a result is received
 */
export function waitForJobResult(
  requestEventId: string,
  requestKind: number,
  relayUrls: string[],
  timeoutMs = 60_000,
): Promise<DvmJobResult> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;

    const timer = setTimeout(() => {
      if (unsubscribe) unsubscribe();
      reject(new Error(`NIP-90 job result timeout after ${timeoutMs}ms for request ${requestEventId}`));
    }, timeoutMs);

    unsubscribe = subscribeToJobResults(
      requestEventId,
      requestKind,
      relayUrls,
      (result) => {
        // Only resolve on actual results (6xxx), not feedback (7000)
        if (result.tags.some((t) => t[0] === 'e' && t[1] === requestEventId) &&
            !result.tags.some((t) => t[0] === 'status')) {
          clearTimeout(timer);
          if (unsubscribe) unsubscribe();
          resolve(result);
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Provider Discovery Subscription
// ---------------------------------------------------------------------------

/**
 * Subscribe to NIP-90 DVM provider announcements for a target job kind.
 *
 * Subscribes to kind:31990 events with `#k` tag matching the target job kind.
 * This discovers all providers in the network that advertise support for the
 * requested job type.
 *
 * @param targetJobKind - The job kind to find providers for (5000-5999)
 * @param relayUrls - Array of relay WebSocket URLs to search
 * @param callback - Called for each provider discovered
 * @returns Unsubscribe function
 *
 * @example
 * ```ts
 * const providers: DvmProvider[] = [];
 * const unsubscribe = subscribeToProviders(
 *   5100,  // text generation
 *   ['wss://pylon.openagents.com', 'wss://relay.nostr.band'],
 *   (provider) => {
 *     providers.push(provider);
 *     console.log('Found provider:', provider.name, provider.supportedJobKinds);
 *   },
 * );
 *
 * // Wait for EOSE, then stop
 * setTimeout(unsubscribe, 5000);
 * ```
 *
 * @see SPECIFICATION.md §8.1 — Provider Discovery (kind:31990)
 */
export function subscribeToProviders(
  targetJobKind: number,
  relayUrls: string[],
  callback: (provider: DvmProvider) => void,
): () => void {
  const pool = new SimplePool();

  /** Deduplicate providers by pubkey — latest event wins. */
  const seenPubkeys = new Set<string>();

  const providerFilter: Filter = {
    kinds: [31990],
    '#k': [targetJobKind.toString()],
  };

  const sub = pool.subscribeMany(
    relayUrls,
    providerFilter,
    {
      onevent: (event: RawNostrEvent) => {
        if (event.kind !== 31990) return;

        // Only call callback once per pubkey per subscription (latest-first handled by relay)
        if (!seenPubkeys.has(event.pubkey)) {
          seenPubkeys.add(event.pubkey);
          try {
            const provider = parseProviderEvent(event);
            callback(provider);
          } catch {
            // Malformed provider event — skip
          }
        }
      },
      oneose: () => {
        // EOSE — historical scan complete. Remain subscribed for new providers.
      },
    },
  );

  return () => {
    sub.close();
    pool.destroy();
  };
}

/**
 * Fetch all available DVM providers for a target job kind with a Promise API.
 * Collects providers until EOSE, then resolves.
 *
 * @param targetJobKind - The job kind to find providers for (5000-5999)
 * @param relayUrls - Array of relay WebSocket URLs
 * @param timeoutMs - Maximum time to collect providers (default: 10 seconds)
 * @returns Promise resolving to an array of discovered providers
 */
export function fetchProviders(
  targetJobKind: number,
  relayUrls: string[],
  timeoutMs = 10_000,
): Promise<DvmProvider[]> {
  return new Promise((resolve) => {
    const providers: DvmProvider[] = [];
    let unsubscribe: (() => void) | null = null;

    const finish = () => {
      if (unsubscribe) unsubscribe();
      resolve(providers);
    };

    const timer = setTimeout(finish, timeoutMs);

    const pool = new SimplePool();
    const seenPubkeys = new Set<string>();

    const sub = pool.subscribeMany(
      relayUrls,
      { kinds: [31990], '#k': [targetJobKind.toString()] } as Filter,
      {
        onevent: (event: RawNostrEvent) => {
          if (!seenPubkeys.has(event.pubkey)) {
            seenPubkeys.add(event.pubkey);
            try {
              providers.push(parseProviderEvent(event));
            } catch {
              // skip malformed
            }
          }
        },
        oneose: () => {
          clearTimeout(timer);
          // Small delay to allow any in-flight events to arrive
          setTimeout(finish, 100);
        },
      },
    );

    unsubscribe = () => {
      sub.close();
      pool.destroy();
    };
  });
}
