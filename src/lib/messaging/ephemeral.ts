/**
 * @module messaging/ephemeral
 * @description Ephemeral / self-destruct messaging utilities.
 *
 * - setMessageTtl: add NIP-40 expiration tag (unix timestamp) to a Message
 * - setBurnAfterRead: mark message for deletion after the recipient reads it
 * - processExpiredMessages: garbage collect expired messages from local store
 * - TTL presets: 5m, 1h, 24h, 7d, or custom seconds
 * - Client-side auto-delete: expired messages are removed from UI / localStorage
 * - Burn-after-read: sender publishes kind:5 deletion after receiving read receipt
 *
 * NIP-40 expiration tag: ["expiration", "<unix-timestamp>"]
 * https://github.com/nostr-protocol/nips/blob/master/40.md
 *
 * No new production dependencies.
 */

import type { Message, EphemeralConfig } from './types.js';
import { TTL_PRESETS } from './types.js';

// ============================================================================
// Re-export presets for convenience
// ============================================================================
export { TTL_PRESETS } from './types.js';

// ============================================================================
// Types
// ============================================================================

/** Result of a garbage collection pass */
export interface GcResult {
  /** Total messages inspected */
  inspected: number;
  /** Messages removed because they exceeded their TTL */
  expiredRemoved: number;
  /** Messages removed because burn-after-read was triggered */
  burnedRemoved: number;
  /** unix timestamp of the GC run */
  ranAt: number;
}

/** Storage namespace used by EphemeralManager */
const EPHEMERAL_GC_KEY = 'satnam:ephemeral:last_gc';

// ============================================================================
// NIP-40 tag helpers
// ============================================================================

/**
 * Build a NIP-40 expiration tag from a unix timestamp.
 * Format: ["expiration", "<unix-timestamp>"]
 */
export function buildExpirationTag(expiresAt: number): [string, string] {
  return ['expiration', String(expiresAt)];
}

/**
 * Parse the NIP-40 expiration tag from a Nostr event's tags array.
 * Returns undefined if not present.
 */
export function parseExpirationTag(
  tags: Array<[string, string]>,
): number | undefined {
  const tag = tags.find((t) => t[0] === 'expiration');
  if (!tag || !tag[1]) return undefined;
  const ts = parseInt(tag[1], 10);
  return isNaN(ts) ? undefined : ts;
}

// ============================================================================
// Message mutation helpers (pure — return new objects)
// ============================================================================

/**
 * Apply a TTL to a Message by computing the expiration timestamp and adding
 * the NIP-40 expiration tag.
 *
 * @param message    - The Message to augment (not mutated)
 * @param ttlSeconds - Time-to-live in seconds (use TTL_PRESETS for standard values)
 * @returns New Message with expiresAt and expirationTag set
 */
export function setMessageTtl(message: Message, ttlSeconds: number): Message {
  if (ttlSeconds <= 0) {
    // Remove TTL
    return {
      ...message,
      expiresAt: undefined,
      expirationTag: undefined,
      ephemeral: message.ephemeral
        ? { ...message.ephemeral, ttl: 0 }
        : { ttl: 0, burnAfterRead: false },
    };
  }

  const expiresAt = message.createdAt + ttlSeconds;
  return {
    ...message,
    expiresAt,
    expirationTag: expiresAt,
    ephemeral: {
      ttl: ttlSeconds,
      burnAfterRead: message.ephemeral?.burnAfterRead ?? false,
    },
  };
}

/**
 * Mark a Message for burn-after-read.
 *
 * When the recipient reads the message, the sender should publish a NIP-09
 * kind:5 deletion event for the gift-wrap wrapper.
 *
 * @param message - The Message to augment (not mutated)
 * @returns New Message with burnAfterRead = true
 */
export function setBurnAfterRead(message: Message): Message {
  return {
    ...message,
    ephemeral: {
      ttl: message.ephemeral?.ttl ?? 0,
      burnAfterRead: true,
    },
  };
}

/**
 * Check whether a Message has expired based on the current time.
 *
 * @param message   - The Message to check
 * @param nowUnix   - Current unix timestamp (defaults to Date.now()/1000)
 * @returns true if the message has a TTL that has passed
 */
export function isExpired(message: Message, nowUnix?: number): boolean {
  if (!message.expiresAt) return false;
  const now = nowUnix ?? Math.floor(Date.now() / 1000);
  return message.expiresAt <= now;
}

/**
 * Get the seconds remaining before expiry. Returns 0 if already expired or
 * has no TTL.
 */
export function secondsUntilExpiry(message: Message): number {
  if (!message.expiresAt) return 0;
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, message.expiresAt - now);
}

/**
 * Format the countdown as a human-readable string (e.g. "4m 32s", "23h 12m").
 */
export function formatCountdown(message: Message): string {
  const secs = secondsUntilExpiry(message);
  if (secs <= 0) return 'Expired';

  if (secs < 60) return `${secs}s`;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  }
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return `${d}d ${h}h`;
}

// ============================================================================
// EphemeralConfig factory helpers
// ============================================================================

/**
 * Create an EphemeralConfig for 5-minute TTL.
 */
export function ttl5m(burnAfterRead = false): EphemeralConfig {
  return { ttl: TTL_PRESETS.FIVE_MINUTES, burnAfterRead };
}

/**
 * Create an EphemeralConfig for 1-hour TTL.
 */
export function ttl1h(burnAfterRead = false): EphemeralConfig {
  return { ttl: TTL_PRESETS.ONE_HOUR, burnAfterRead };
}

/**
 * Create an EphemeralConfig for 24-hour TTL.
 */
export function ttl24h(burnAfterRead = false): EphemeralConfig {
  return { ttl: TTL_PRESETS.ONE_DAY, burnAfterRead };
}

/**
 * Create an EphemeralConfig for 7-day TTL.
 */
export function ttl7d(burnAfterRead = false): EphemeralConfig {
  return { ttl: TTL_PRESETS.SEVEN_DAYS, burnAfterRead };
}

/**
 * Create an EphemeralConfig for a custom TTL in seconds.
 */
export function ttlCustom(seconds: number, burnAfterRead = false): EphemeralConfig {
  if (seconds <= 0) throw new Error('TTL must be greater than 0');
  return { ttl: seconds, burnAfterRead };
}

// ============================================================================
// EphemeralManager
// ============================================================================

/**
 * Manages ephemeral message lifecycle:
 * - garbage collection of expired messages across all localStorage message stores
 * - TTL application to outbound messages
 * - burn-after-read tracking
 */
export class EphemeralManager {
  /**
   * Run a garbage collection pass over all message stores in localStorage.
   *
   * Removes messages whose NIP-40 expiration timestamp has passed.
   * Also removes messages marked `deleted`.
   *
   * @returns GcResult summary
   */
  processExpiredMessages(): GcResult {
    const now = Math.floor(Date.now() / 1000);
    const result: GcResult = {
      inspected: 0,
      expiredRemoved: 0,
      burnedRemoved: 0,
      ranAt: now,
    };

    if (typeof localStorage === 'undefined') return result;

    // Scan all localStorage keys for message stores
    const messageKeyPattern = /^satnam:(dm:msgs:|group:msgs:)/;
    const keysToProcess: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && messageKeyPattern.test(key)) {
        keysToProcess.push(key);
      }
    }

    for (const key of keysToProcess) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;

        const messages: Message[] = JSON.parse(raw);
        const before = messages.length;
        result.inspected += before;

        const kept = messages.filter((m) => {
          // Remove explicitly deleted
          if (m.deleted) {
            result.burnedRemoved++;
            return false;
          }
          // Remove expired (NIP-40)
          if (m.expiresAt && m.expiresAt <= now) {
            result.expiredRemoved++;
            return false;
          }
          return true;
        });

        if (kept.length < before) {
          localStorage.setItem(key, JSON.stringify(kept));
        }
      } catch {
        // Skip malformed entries
      }
    }

    // Record last GC run
    try {
      localStorage.setItem(EPHEMERAL_GC_KEY, String(now));
    } catch {}

    return result;
  }

  /**
   * Get the unix timestamp of the last GC run, or undefined if never run.
   */
  getLastGcTimestamp(): number | undefined {
    try {
      if (typeof localStorage === 'undefined') return undefined;
      const raw = localStorage.getItem(EPHEMERAL_GC_KEY);
      if (!raw) return undefined;
      const ts = parseInt(raw, 10);
      return isNaN(ts) ? undefined : ts;
    } catch {
      return undefined;
    }
  }

  /**
   * Filter a list of messages to exclude expired ones.
   * Convenience helper for UI rendering — does not mutate storage.
   */
  filterExpired(messages: Message[]): Message[] {
    const now = Math.floor(Date.now() / 1000);
    return messages.filter(
      (m) => !m.deleted && (!m.expiresAt || m.expiresAt > now),
    );
  }

  /**
   * Apply TTL to a message.
   * Delegates to the pure `setMessageTtl` helper.
   */
  applyTtl(message: Message, ttlSeconds: number): Message {
    return setMessageTtl(message, ttlSeconds);
  }

  /**
   * Mark message for burn-after-read.
   * Delegates to the pure `setBurnAfterRead` helper.
   */
  markBurnAfterRead(message: Message): Message {
    return setBurnAfterRead(message);
  }

  /**
   * Schedule an in-memory auto-delete callback for a message.
   * Calls `onExpire` once the TTL elapses (browser setTimeout).
   *
   * Returns a cleanup function to cancel the timer.
   */
  scheduleAutoDelete(
    message: Message,
    onExpire: (messageId: string) => void,
  ): () => void {
    if (!message.expiresAt) return () => {};

    const now = Math.floor(Date.now() / 1000);
    const remainingMs = Math.max(0, (message.expiresAt - now) * 1000);

    const handle = setTimeout(() => {
      onExpire(message.id);
    }, remainingMs);

    return () => clearTimeout(handle);
  }
}

// Singleton export for convenience
export const ephemeralManager = new EphemeralManager();
