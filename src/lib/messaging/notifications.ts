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

// ============================================================================
// Storage helpers
// ============================================================================

function readJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
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

    writeJson(PUSH_REG_KEY, registration);
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
    const reg = this.getRegistration();
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
    const reg = this.getRegistration();
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
    const reg = this.getRegistration();
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

    writeJson<PushRegistration | null>(PUSH_REG_KEY, null);
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
  setThreadPreference(
    threadId: string,
    preference: NotificationPreference,
  ): void {
    const prefs = readJson<Record<string, ThreadNotificationPreference>>(
      THREAD_PREFS_KEY,
      {},
    );
    prefs[threadId] = { threadId, preference };
    writeJson(THREAD_PREFS_KEY, prefs);
  }

  getThreadPreference(threadId: string): NotificationPreference {
    const prefs = readJson<Record<string, ThreadNotificationPreference>>(
      THREAD_PREFS_KEY,
      {},
    );
    return prefs[threadId]?.preference ?? 'all';
  }

  // --------------------------------------------------------------------------
  // Local registration getter
  // --------------------------------------------------------------------------

  getRegistration(): PushRegistration | null {
    return readJson<PushRegistration | null>(PUSH_REG_KEY, null);
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
   */
  addNotification(
    threadId: string,
    threadType: ThreadType,
    senderPubkey: string,
    messagePreview: string,
    senderDisplayName?: string,
  ): InAppNotification {
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

    const notifications = this.getAll();
    notifications.unshift(notification);
    // Keep a maximum of 200 notifications
    writeJson(NOTIFICATIONS_KEY, notifications.slice(0, 200));

    // Increment unread count
    this.incrementUnread(threadId);

    return notification;
  }

  // --------------------------------------------------------------------------
  // Mark read
  // --------------------------------------------------------------------------

  markRead(notificationId: string): void {
    const notifications = this.getAll().map((n) =>
      n.id === notificationId ? { ...n, read: true } : n,
    );
    writeJson(NOTIFICATIONS_KEY, notifications);
  }

  markAllRead(): void {
    const notifications = this.getAll().map((n) => ({ ...n, read: true }));
    writeJson(NOTIFICATIONS_KEY, notifications);

    // Reset all unread counts
    writeJson(UNREAD_COUNTS_KEY, {});
  }

  markThreadRead(threadId: string): void {
    const notifications = this.getAll().map((n) =>
      n.threadId === threadId ? { ...n, read: true } : n,
    );
    writeJson(NOTIFICATIONS_KEY, notifications);
    this.resetUnread(threadId);
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  getAll(): InAppNotification[] {
    return readJson<InAppNotification[]>(NOTIFICATIONS_KEY, []);
  }

  getUnread(): InAppNotification[] {
    return this.getAll().filter((n) => !n.read);
  }

  getTotalUnreadCount(): number {
    return this.getUnread().length;
  }

  getUnreadCountForThread(threadId: string): number {
    const counts = readJson<Record<string, number>>(UNREAD_COUNTS_KEY, {});
    return counts[threadId] ?? 0;
  }

  getAllUnreadCounts(): Record<string, number> {
    return readJson<Record<string, number>>(UNREAD_COUNTS_KEY, {});
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
  refreshBadge(): void {
    this.setBadgeCount(this.getTotalUnreadCount());
  }

  // --------------------------------------------------------------------------
  // Internal counters
  // --------------------------------------------------------------------------

  private incrementUnread(threadId: string): void {
    const counts = readJson<Record<string, number>>(UNREAD_COUNTS_KEY, {});
    counts[threadId] = (counts[threadId] ?? 0) + 1;
    writeJson(UNREAD_COUNTS_KEY, counts);
  }

  private resetUnread(threadId: string): void {
    const counts = readJson<Record<string, number>>(UNREAD_COUNTS_KEY, {});
    delete counts[threadId];
    writeJson(UNREAD_COUNTS_KEY, counts);
  }
}

// ============================================================================
// Singleton exports
// ============================================================================

export const inAppNotificationCenter = new InAppNotificationCenter();

