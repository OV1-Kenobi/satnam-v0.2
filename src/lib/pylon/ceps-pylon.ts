/**
 * @module pylon/ceps-pylon
 * @description Extended CEPS client with Pylon as the primary relay.
 *
 * ## Pylon-First Publishing Strategy
 *
 * - Pylon (`wss://pylon.openagents.com`) is the primary relay for all
 *   agent coordination events (kinds 39200–39245).
 * - NIP-42 AUTH is handled automatically via `PylonAuth` on connection.
 * - Fallback relays are used when Pylon is unreachable.
 * - If Pylon is unreachable at publish time, the event is:
 *   1. Queued for retry with exponential backoff (max 5 attempts, up to 32s)
 *   2. Immediately published to fallback relays
 *
 * ## Retry Queue
 *
 * The retry queue is an in-memory structure. If the page is reloaded the
 * queue is lost; background sync (Service Worker) handles persistence for
 * offline scenarios (spec §9.3).
 *
 * @see phase4-spec-sections-8-9.md §8.3
 */

import { SimplePool } from 'nostr-tools';
import type { Event as NostrEvent, Filter as NostrFilter } from 'nostr-tools';
import type { PylonAuth } from './auth.js';
import { PYLON_RELAY_URL } from './auth.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Kinds that MUST be routed through Pylon as primary relay. */
export const PYLON_PRIMARY_KINDS = new Set([
  39200, 39201, 39202, 39203, 39204, 39205,
  39210, 39211, 39212, 39213, 39214, 39215,
  39220, 39221, 39222, 39223, 39224, 39225,
  39230, 39231, 39232, 39233, 39234, 39235,
  39240, 39241, 39242, 39243, 39244, 39245,
  10003, // Presence kind
  31990, // NIP-90 provider capability
]);

/** Base delay for exponential backoff retry (ms). */
const RETRY_BASE_DELAY_MS = 1_000;

/** Maximum number of retry attempts per queued event. */
const RETRY_MAX_ATTEMPTS = 5;

/** EOSE timeout for list queries (ms). */
const _LIST_EOSE_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Internal retry queue entry. */
interface RetryEntry {
  /** The Nostr event to retry. */
  event: NostrEvent;
  /** Number of attempts so far. */
  attempts: number;
  /** Timestamp of the next scheduled attempt (ms since epoch). */
  nextAttemptAt: number;
  /** Timer reference for the scheduled retry. */
  timer: ReturnType<typeof setTimeout> | null;
}

// SubscriptionHandle reserved for future use

// ---------------------------------------------------------------------------
// PylonCepsClient
// ---------------------------------------------------------------------------

/**
 * Extended CEPS client wrapping SimplePool with Pylon-first publishing
 * and fallback relay strategy.
 *
 * All agent coordination events (kinds 39200–39245, 10003) are published
 * to Pylon first. General Nostr events are published to both Pylon and
 * fallback relays in parallel.
 *
 * @example
 * ```typescript
 * const auth = new PylonAuth(vault);
 * const client = new PylonCepsClient(auth, [
 *   'wss://nos.lol',
 *   'wss://relay.damus.io',
 * ]);
 *
 * // Publish an event — Pylon is tried first, fallbacks on error
 * await client.publish(signedEvent);
 *
 * // Subscribe to trajectory events from Pylon
 * const unsub = client.subscribe(
 *   { kinds: [39230, 39231], '#p': [agentPubkey] },
 *   (event) => console.log('trajectory event:', event)
 * );
 * ```
 */
export class PylonCepsClient {
  private readonly pool: SimplePool;
  private readonly retryQueue: Map<string, RetryEntry> = new Map();

  /**
   * @param auth - Authenticated Pylon connection manager
   * @param fallbackRelays - Relay URLs to use when Pylon is unreachable
   */
  constructor(
    private readonly auth: PylonAuth,
    private readonly fallbackRelays: string[] = []
  ) {
    this.pool = new SimplePool();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Publish a Nostr event with the Pylon-first strategy.
   *
   * Behavior:
   * 1. If Pylon is authenticated → publish to Pylon (and fallbacks for
   *    non-coordination events)
   * 2. If Pylon is unreachable → publish to fallback relays immediately
   *    and queue the event for Pylon retry
   *
   * @param event - Signed Nostr event to publish
   * @throws Only if all relays (Pylon + fallbacks) are unreachable
   */
  async publish(event: NostrEvent): Promise<void> {
    const isPylonPrimary = PYLON_PRIMARY_KINDS.has(event.kind);

    // Attempt Pylon first
    const pylonReachable = await this._tryPublishToPylon(event);

    if (pylonReachable) {
      // Also publish to fallbacks if not a Pylon-exclusive event
      if (this.fallbackRelays.length > 0 && !isPylonPrimary) {
        await this._publishToRelays(event, this.fallbackRelays);
      }
    } else {
      // Pylon unreachable: publish to fallbacks immediately
      if (this.fallbackRelays.length > 0) {
        await this._publishToRelays(event, this.fallbackRelays);
      }
      // Queue for Pylon retry with exponential backoff
      this._enqueueRetry(event);
    }
  }

  /**
   * Subscribe to events matching `filter`, preferring Pylon, with fallback.
   *
   * The subscription automatically falls back to fallback relays if Pylon
   * is not authenticated. Returns an unsubscribe function.
   *
   * @param filter - NIP-01 subscription filter
   * @param callback - Called for each matching event received
   * @returns Unsubscribe function — call to clean up
   */
  subscribe(
    filter: NostrFilter,
    callback: (event: NostrEvent) => void
  ): () => void {
    const relays = [PYLON_RELAY_URL, ...this.fallbackRelays];

    const sub = this.pool.subscribeMany(relays, [filter as NostrFilter], {
      onevent(event: NostrEvent) {
        callback(event);
      },
      oneose() {
        // EOSE — subscription is live, nothing special needed
      },
    });

    return () => sub.close();
  }

  /**
   * List events matching filters from Pylon (with fallback relays).
   *
   * Waits for EOSE or timeout before resolving.
   *
   * @param filters - One or more NIP-01 filters
   * @param relayOverride - Optional relay list override
   * @returns Array of matching events
   */
  async list(
    filters: NostrFilter[],
    relayOverride?: string[]
  ): Promise<NostrEvent[]> {
    const relays = relayOverride ?? [PYLON_RELAY_URL, ...this.fallbackRelays];
    // querySync accepts relays as first arg, filters as second
    return this.pool.querySync(relays, filters[0] ?? {} as NostrFilter) as Promise<NostrEvent[]>;
  }

  /**
   * Get the Pylon authentication state.
   */
  isPylonAuthenticated(): boolean {
    return this.auth.isAuthenticated();
  }

  /**
   * Number of events currently queued for Pylon retry.
   */
  get retryQueueSize(): number {
    return this.retryQueue.size;
  }

  /**
   * Clear all pending retries and cancel their timers.
   * Call on logout/disconnect.
   */
  clearRetryQueue(): void {
    for (const entry of this.retryQueue.values()) {
      if (entry.timer !== null) {
        clearTimeout(entry.timer);
      }
    }
    this.retryQueue.clear();
  }

  /**
   * Close all relay connections and clear the retry queue.
   */
  destroy(): void {
    this.clearRetryQueue();
    this.pool.close([PYLON_RELAY_URL, ...this.fallbackRelays]);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Attempt to publish an event to Pylon.
   * Returns `true` if published successfully, `false` if unreachable.
   * @internal
   */
  private async _tryPublishToPylon(event: NostrEvent): Promise<boolean> {
    if (!this.auth.isAuthenticated()) {
      return false;
    }

    try {
      await Promise.race([
        this._publishToRelays(event, [PYLON_RELAY_URL]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Pylon publish timeout')), 5_000)
        ),
      ]);
      return true;
    } catch (err) {
      console.warn('[PylonCepsClient] Pylon unreachable, falling back:', err);
      return false;
    }
  }

  /**
   * Publish an event to a list of relays via SimplePool.
   * @internal
   */
  private async _publishToRelays(
    event: NostrEvent,
    relays: string[]
  ): Promise<void> {
    if (relays.length === 0) return;

    // pool.publish() takes relays as the first argument
    const promises = this.pool.publish(relays, event);
    const results = await Promise.allSettled(promises);

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason);

    if (errors.length === relays.length) {
      throw new Error(
        `[PylonCepsClient] All relays rejected event ${event.id}: ${errors.join(', ')}`
      );
    }
  }

  /**
   * Add an event to the retry queue with exponential backoff.
   * @internal
   */
  private _enqueueRetry(event: NostrEvent): void {
    // Deduplicate by event ID
    if (this.retryQueue.has(event.id)) return;

    const entry: RetryEntry = {
      event,
      attempts: 0,
      nextAttemptAt: Date.now() + RETRY_BASE_DELAY_MS,
      timer: null,
    };

    this.retryQueue.set(event.id, entry);
    this._scheduleRetry(entry);
  }

  /**
   * Schedule the next retry for a queue entry.
   * @internal
   */
  private _scheduleRetry(entry: RetryEntry): void {
    if (entry.attempts >= RETRY_MAX_ATTEMPTS) {
      console.warn(
        `[PylonCepsClient] Giving up on event ${entry.event.id} after ${entry.attempts} attempts`
      );
      this.retryQueue.delete(entry.event.id);
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 32s)
    const delay = Math.min(
      RETRY_BASE_DELAY_MS * Math.pow(2, entry.attempts),
      32_000
    );
    entry.nextAttemptAt = Date.now() + delay;

    entry.timer = setTimeout(async () => {
      entry.attempts++;
      entry.timer = null;

      try {
        await this._tryPublishToPylon(entry.event);
        // Success — remove from queue
        this.retryQueue.delete(entry.event.id);
      } catch {
        // Schedule next retry
        this._scheduleRetry(entry);
      }
    }, delay);
  }

  /**
   * Manually trigger a retry flush for all queued events.
   * Useful when connectivity is restored.
   */
  async flushRetryQueue(): Promise<void> {
    const entries = [...this.retryQueue.values()];

    await Promise.allSettled(
      entries.map(async (entry) => {
        // Cancel existing scheduled timer
        if (entry.timer !== null) {
          clearTimeout(entry.timer);
          entry.timer = null;
        }
        entry.attempts++;

        try {
          await this._tryPublishToPylon(entry.event);
          this.retryQueue.delete(entry.event.id);
        } catch {
          this._scheduleRetry(entry);
        }
      })
    );
  }
}

