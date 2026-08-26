/**
 * @module messaging/notifications
 * @description Push notification management and in-app notification center.
 *
 * Push notifications follow the 0xchat model:
 * - kind:22456 — push device registration event (NIP-04 encrypted content)
 * - Heartbeat / offline signals via the same mechanism
 * - Web Push API integration for browser push subscriptions
 *
 * InAppNotificationCenter:
 * - Unread counts per thread
 * - Badge management
 * - Per-thread notification preferences
 *
 * No new production dependencies.
 * Uses existing CEPS for event publishing.
 */

import type {
  PushRegistration,
  InAppNotification,
  ThreadNotificationPreference,
  NotificationPreference,
  ThreadType,
} from './types.js';

import {
  publishEventWithCeps,
  signEventWithCeps,
  getDefaultRelays,
} from '../ceps/ceps-client.js';
import {
  bytesToHex,
  bytesToUtf8,
  hexToBytes,
  randomBytes,
  utf8ToBytes,
} from '@noble/hashes/utils';
import { getVault } from '../vault/vault.js';

// ============================================================================
// Constants
// ============================================================================

/** kind:22456 — 0xchat push notification registration */
const KIND_PUSH_REGISTRATION = 22456;

/** Storage keys */
const PUSH_REG_KEY = 'satnam:push:registration:v2';
const NOTIFICATIONS_KEY = 'satnam:notifications:v2';
const THREAD_PREFS_KEY = 'satnam:notifications:thread_prefs:v2';
const UNREAD_COUNTS_KEY = 'satnam:notifications:unread:v2';

/**
 * A-5 fix (2026-08-25): retention/TTL for in-app notifications.
 * messagePreview carries message-content fragments, so entries are pruned
 * after 7 days on load/add; the existing 200-entry cap still applies.
 */
const NOTIFICATION_TTL_S = 7 * 24 * 60 * 60;

// ============================================================================
// Storage helpers (A-5 fix: all four stores are now vault-encrypted hex)
// ============================================================================

/**
 * Read + decrypt a JSON store. Vault LOCKED or undecryptable (incl. legacy
 * plaintext from before this fix) → fallback. Never returns plaintext that
 * touched persistent storage.
 */
async function readEncrypted<T>(key: string, fallback: T): Promise<T> {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const vault = getVault();
    if (!vault.isUnlocked()) return fallback;
    const plain = await vault.decryptBytes(hexToBytes(raw));
    return JSON.parse(bytesToUtf8(plain)) as T;
  } catch {
    return fallback;
  }
}

/**
 * Encrypt + persist a JSON store as hex ciphertext under the vault master
 * key (fresh nonce per write). Returns false when the vault is LOCKED —
 * callers decide whether to hold data in memory instead. Plaintext is never
 * written to persistent storage.
 */
async function writeEncrypted<T>(key: string, value: T): Promise<boolean> {
  try {
    if (typeof localStorage === 'undefined') return false;
    const vault = getVault();
    if (!vault.isUnlocked()) return false;
    const encrypted = await vault.encryptBytes(utf8ToBytes(JSON.stringify(value)));
    localStorage.setItem(key, bytesToHex(encrypted));
    return true;
  } catch {
    return false;
  }
}

function pruneExpired(notifications: InAppNotification[]): InAppNotification[] {
  const cutoff = nowUnix() - NOTIFICATION_TTL_S;
  return notifications.filter((n) => n.receivedAt > cutoff);
}

// ============================================================================
// Locked-vault hold semantics (documented decision, A-5)
//
// While the vault is LOCKED, incoming notifications are HELD IN MEMORY ONLY
// (capped at 50; newest kept) and are NEVER persisted as plaintext. Any
// subsequent operation retries the flush once the vault is unlocked; if the
// user never unlocks again, held notifications are dropped on unload — the
// privacy-preserving loss direction. Unread counters are held alongside so
// badges stay consistent with the held notifications.
// ============================================================================

const HOLD_CAP = 50;

interface HeldWhileLocked {
  notifications: InAppNotification[];
  unread: Record<string, number>;
}

let held: HeldWhileLocked | null = null;

async function flushHeldIfUnlocked(): Promise<void> {
  if (!held) return;
  const vault = getVault();
  if (!vault.isUnlocked()) return;

  const stored = pruneExpired(await readEncrypted<InAppNotification[]>(NOTIFICATIONS_KEY, []));
  const counts = await readEncrypted<Record<string, number>>(UNREAD_COUNTS_KEY, {});
  const mergedCounts = { ...counts };
  for (const [tid, c] of Object.entries(held.unread)) {
    mergedCounts[tid] = (mergedCounts[tid] ?? 0) + c;
  }
  await writeEncrypted(NOTIFICATIONS_KEY, pruneExpired([...held.notifications, ...stored]).slice(0, 200));
  await writeEncrypted(UNREAD_COUNTS_KEY, mergedCounts);
  held = null;
}

/** CSPRNG ID generation (replaces Math.random). */
function generateId(): string {
  return bytesToHex(randomBytes(16));
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

// ============================================================================
// NotificationManager
// ============================================================================

export class NotificationManager {
  constructor(
    _localPubkeyHex: string,
    private readonly relays: string[] = getDefaultRelays(),
  ) {
    void _localPubkeyHex; // kept for API compatibility
  }

  // --------------------------------------------------------------------------
  // registerPushDevice
  // --------------------------------------------------------------------------

  /**
   * Register this device with a push notification server.
   *
   * Publishes a kind:22456 event following the 0xchat push notification spec.
   * The content is NIP-04 encrypted to the push server's pubkey containing:
   * - deviceToken: Web Push API subscription endpoint / token
   * - relays: relay URLs to monitor for incoming messages
   * - notifyKinds: event kinds that should trigger push delivery
   *
   * @param pushServerPubkey - hex pubkey of the push notification server
   * @param deviceToken      - Web Push API subscription endpoint URL or token
   * @param relays           - Relay URLs the push server should monitor
   * @param notifyKinds      - Event kinds to watch (default: [1059] — gift-wraps)
   * @param expiresAt        - Optional registration expiry (unix timestamp)
   * @returns The PushRegistration record
   */
  async registerPushDevice(
    pushServerPubkey: string,
    deviceToken: string,
    relays: string[],
    notifyKinds: number[] = [1059],
    expiresAt?: number,
  ): Promise<PushRegistration> {
    const registration: PushRegistration = {
      deviceToken,
      pushServerPubkey,
      relays,
      notifyKinds,
      active: true,
      expiresAt,
    };

    // Build the kind:22456 event payload
    // Content is JSON stringified and would normally be NIP-04 encrypted to
    // pushServerPubkey — CEPS handles signing; encryption is a TODO when
    // the push server integration is live.
    const payload = JSON.stringify({
      type: 'satnam:push:register',
      deviceToken,
      relays,
      notifyKinds,
      ...(expiresAt ? { expiresAt } : {}),
    });

    try {
      const event = {
        kind: KIND_PUSH_REGISTRATION,
        content: payload, // Phase 1: plaintext; Phase 2: NIP-04 encrypted to pushServerPubkey
        tags: [
          ['p', pushServerPubkey],
          ['relay', ...relays],
        ],
        created_at: nowUnix(),
      };
      const signed = await signEventWithCeps(event);
      await publishEventWithCeps(signed, this.relays);
    } catch (err) {
      console.warn('[NotificationManager] Failed to publish push registration:', err);
    }

    writeEncrypted(PUSH_REG_KEY, registration);
    return registration;
  }

  // --------------------------------------------------------------------------
  // sendHeartbeat
  // --------------------------------------------------------------------------

  /**
   * Send an online heartbeat signal to the push server.
   *
   * While the client is online the push server should NOT forward messages
   * (the client will receive them directly from relays). A heartbeat keeps
   * the "online" window alive.
   *
   * Publishes a kind:22456 event with type `satnam:push:heartbeat`.
   */
  async sendHeartbeat(): Promise<void> {
    const reg = await this.getRegistration();
    if (!reg?.active) return;

    try {
      const event = {
        kind: KIND_PUSH_REGISTRATION,
        content: JSON.stringify({ type: 'satnam:push:heartbeat', ts: nowUnix() }),
        tags: [['p', reg.pushServerPubkey]],
        created_at: nowUnix(),
      };
      const signed = await signEventWithCeps(event);
      await publishEventWithCeps(signed, this.relays);
    } catch (err) {
      console.warn('[NotificationManager] Failed to send heartbeat:', err);
    }
  }

  // --------------------------------------------------------------------------
  // setOffline
  // --------------------------------------------------------------------------

  /**
   * Signal to the push server that this device is going offline.
   *
   * After this signal the push server should start forwarding incoming
   * gift-wrap events as push notifications until the next heartbeat.
   */
  async setOffline(): Promise<void> {
    const reg = await this.getRegistration();
    if (!reg?.active) return;

    try {
      const event = {
        kind: KIND_PUSH_REGISTRATION,
        content: JSON.stringify({ type: 'satnam:push:offline', ts: nowUnix() }),
        tags: [['p', reg.pushServerPubkey]],
        created_at: nowUnix(),
      };
      const signed = await signEventWithCeps(event);
      await publishEventWithCeps(signed, this.relays);
    } catch (err) {
      console.warn('[NotificationManager] Failed to send offline signal:', err);
    }
  }

  // --------------------------------------------------------------------------
  // unregisterDevice
  // --------------------------------------------------------------------------

  /**
   * Unregister the push device (on logout).
   *
   * Publishes a kind:22456 event with type `satnam:push:unregister` and
   * removes the local registration record.
   */
  async unregisterDevice(): Promise<void> {
    const reg = await this.getRegistration();
    if (!reg) return;

    try {
      const event = {
        kind: KIND_PUSH_REGISTRATION,
        content: JSON.stringify({ type: 'satnam:push:unregister', ts: nowUnix() }),
        tags: [['p', reg.pushServerPubkey]],
        created_at: nowUnix(),
      };
      const signed = await signEventWithCeps(event);
      await publishEventWithCeps(signed, this.relays);
    } catch (err) {
      console.warn('[NotificationManager] Failed to unregister device:', err);
    }

    await writeEncrypted(PUSH_REG_KEY, null);
  }

  // --------------------------------------------------------------------------
  // Web Push API registration
  // --------------------------------------------------------------------------

  /**
   * Subscribe to Web Push API notifications using the browser's PushManager.
   *
   * @param vapidPublicKey - VAPID public key (base64url) from the push server
   * @returns PushSubscription or undefined if not supported
   */
  async subscribeBrowserPush(
    vapidPublicKey: string,
  ): Promise<PushSubscription | undefined> {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      console.warn('[NotificationManager] Web Push API not supported');
      return undefined;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this._urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
      });
      return subscription;
    } catch (err) {
      console.warn('[NotificationManager] Web Push subscription failed:', err);
      return undefined;
    }
  }

  // --------------------------------------------------------------------------
  // Notification preferences
  // --------------------------------------------------------------------------

  /**
   * Set notification preference for a thread.
   */
  async setThreadPreference(
    threadId: string,
    preference: NotificationPreference,
  ): Promise<void> {
    const prefs = await readEncrypted<Record<string, ThreadNotificationPreference>>(
      THREAD_PREFS_KEY,
      {},
    );
    prefs[threadId] = { threadId, preference };
    await writeEncrypted(THREAD_PREFS_KEY, prefs);
  }

  async getThreadPreference(threadId: string): Promise<NotificationPreference> {
    const prefs = await readEncrypted<Record<string, ThreadNotificationPreference>>(
      THREAD_PREFS_KEY,
      {},
    );
    return prefs[threadId]?.preference ?? 'all';
  }

  // --------------------------------------------------------------------------
  // Local registration getter
  // --------------------------------------------------------------------------

  async getRegistration(): Promise<PushRegistration | null> {
    return readEncrypted<PushRegistration | null>(PUSH_REG_KEY, null);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private _urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from(rawData, (c) => c.charCodeAt(0));
  }
}

// ============================================================================
// InAppNotificationCenter
// ============================================================================

export class InAppNotificationCenter {
  // --------------------------------------------------------------------------
  // Add notification
  // --------------------------------------------------------------------------

  /**
   * Add an in-app notification. Called when a new message arrives.
   *
   * A-5 semantics: if the vault is LOCKED the notification is HELD in memory
   * (capped, never persisted as plaintext) and flushed to the encrypted
   * store on a later unlocked operation; entries older than
   * NOTIFICATION_TTL_S are pruned on every load/add.
   */
  async addNotification(
    threadId: string,
    threadType: ThreadType,
    senderPubkey: string,
    messagePreview: string,
    senderDisplayName?: string,
  ): Promise<InAppNotification> {
    const notification: InAppNotification = {
      id: generateId(),
      threadId,
      threadType,
      senderPubkey,
      senderDisplayName,
      messagePreview: messagePreview.slice(0, 120),
      receivedAt: nowUnix(),
      read: false,
    };

    await flushHeldIfUnlocked();

    const stored = pruneExpired(await this.getAll());
    const notifications = [notification, ...stored];
    // Keep a maximum of 200 notifications
    const persisted = await writeEncrypted(NOTIFICATIONS_KEY, notifications.slice(0, 200));
    if (!persisted) {
      // Vault locked — hold in memory only (capped), never persist plaintext.
      if (!held) held = { notifications: [], unread: {} };
      held.notifications.unshift(notification);
      held.notifications = held.notifications.slice(0, HOLD_CAP);
    }

    // Increment unread count
    await this.incrementUnread(threadId);

    return notification;
  }

  // --------------------------------------------------------------------------
  // Mark read
  // --------------------------------------------------------------------------

  async markRead(notificationId: string): Promise<void> {
    await flushHeldIfUnlocked();
    const stored = await this.getAll();
    const merged = stored.map((n) =>
      n.id === notificationId ? { ...n, read: true } : n,
    );
    if (!(await writeEncrypted(NOTIFICATIONS_KEY, merged))) {
      if (held) {
        held.notifications = held.notifications.map((n) =>
          n.id === notificationId ? { ...n, read: true } : n,
        );
      }
    }
  }

  async markAllRead(): Promise<void> {
    await flushHeldIfUnlocked();
    const notifications = (await this.getAll()).map((n) => ({ ...n, read: true }));
    if (!(await writeEncrypted(NOTIFICATIONS_KEY, notifications)) && held) {
      held.notifications = held.notifications.map((n) => ({ ...n, read: true }));
    }

    // Reset all unread counts
    if (!(await writeEncrypted(UNREAD_COUNTS_KEY, {})) && held) {
      held.unread = {};
    }
  }

  async markThreadRead(threadId: string): Promise<void> {
    await flushHeldIfUnlocked();
    const stored = await this.getAll();
    const merged = stored.map((n) =>
      n.threadId === threadId ? { ...n, read: true } : n,
    );
    if (!(await writeEncrypted(NOTIFICATIONS_KEY, merged)) && held) {
      held.notifications = held.notifications.map((n) =>
        n.threadId === threadId ? { ...n, read: true } : n,
      );
    }
    await this.resetUnread(threadId);
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  /**
   * All notifications: decrypted store overlaid with any held-while-locked
   * entries. Expired entries (> NOTIFICATION_TTL_S) are pruned.
   */
  async getAll(): Promise<InAppNotification[]> {
    const stored = pruneExpired(
      await readEncrypted<InAppNotification[]>(NOTIFICATIONS_KEY, []),
    );
    const pending = held?.notifications ?? [];
    return [...pending, ...stored].slice(0, 200);
  }

  async getUnread(): Promise<InAppNotification[]> {
    return (await this.getAll()).filter((n) => !n.read);
  }

  async getTotalUnreadCount(): Promise<number> {
    return (await this.getUnread()).length;
  }

  async getUnreadCountForThread(threadId: string): Promise<number> {
    // Persisted store; held-while-locked deltas surface via getAll()-backed
    // queries and are folded into the store on flush.
    const counts = await readEncrypted<Record<string, number>>(UNREAD_COUNTS_KEY, {});
    return counts[threadId] ?? 0;
  }

  async getAllUnreadCounts(): Promise<Record<string, number>> {
    return readEncrypted<Record<string, number>>(UNREAD_COUNTS_KEY, {});
  }

  // --------------------------------------------------------------------------
  // Badge management
  // --------------------------------------------------------------------------

  /**
   * Update the browser app badge (if supported) with the total unread count.
   */
  setBadgeCount(count: number): void {
    if (typeof navigator !== 'undefined' && 'setAppBadge' in navigator) {
      if (count > 0) {
        (navigator as any).setAppBadge(count).catch(() => {});
      } else {
        (navigator as any).clearAppBadge().catch(() => {});
      }
    }
  }

  /**
   * Refresh the browser badge from current unread state.
   */
  async refreshBadge(): Promise<void> {
    this.setBadgeCount(await this.getTotalUnreadCount());
  }

  // --------------------------------------------------------------------------
  // Internal counters
  // --------------------------------------------------------------------------

  private async incrementUnread(threadId: string): Promise<void> {
    const counts = await readEncrypted<Record<string, number>>(UNREAD_COUNTS_KEY, {});
    counts[threadId] = (counts[threadId] ?? 0) + 1;
    if (!(await writeEncrypted(UNREAD_COUNTS_KEY, counts))) {
      if (!held) held = { notifications: [], unread: {} };
      held.unread[threadId] = (held.unread[threadId] ?? 0) + 1;
    }
  }

  private async resetUnread(threadId: string): Promise<void> {
    const counts = await readEncrypted<Record<string, number>>(UNREAD_COUNTS_KEY, {});
    delete counts[threadId];
    if (!(await writeEncrypted(UNREAD_COUNTS_KEY, counts)) && held) {
      delete held.unread[threadId];
    }
  }
}

// ============================================================================
// Singleton exports
// ============================================================================

export const inAppNotificationCenter = new InAppNotificationCenter();

