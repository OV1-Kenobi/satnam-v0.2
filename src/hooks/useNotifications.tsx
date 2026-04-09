/**
 * @module hooks/useNotifications
 * @description React hook for Satnam v2 notification management.
 *
 * Provides:
 * - unreadCount: total unread notification count
 * - notifications: list of in-app notifications (newest first)
 * - markAllRead: mark all notifications as read + clear badge
 * - registerPush: register for Web Push API + kind:22456 with push server
 * - notificationPreferences: per-thread notification preference map
 * - setThreadPreference: update per-thread preference
 * - setBadgeCount: manually set browser app badge
 *
 * No new production dependencies.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';

import type {
  InAppNotification,
  NotificationPreference,
  PushRegistration,
} from '../lib/messaging/types.js';

import {
  NotificationManager,
  InAppNotificationCenter,
  inAppNotificationCenter,
} from '../lib/messaging/notifications.js';

import { getDefaultRelays } from '../lib/ceps/ceps-client.js';

// ============================================================================
// Types
// ============================================================================

export interface UseNotificationsOptions {
  /** hex pubkey of the local user */
  localPubkeyHex: string;
  /** Relay URLs override */
  relays?: string[];
  /** Auto-refresh interval in ms (default: 5000) */
  refreshInterval?: number;
  /** If true, refresh badge on every render cycle */
  autoBadge?: boolean;
}

export interface UseNotificationsReturn {
  /** Total unread count across all threads */
  unreadCount: number;
  /** All in-app notifications, newest first */
  notifications: InAppNotification[];
  /** Mark all notifications read and clear badge */
  markAllRead: () => void;
  /** Mark all notifications for a specific thread as read */
  markThreadRead: (threadId: string) => void;
  /** Register for push notifications via kind:22456 */
  registerPush: (
    pushServerPubkey: string,
    deviceToken: string,
    relays?: string[],
    notifyKinds?: number[],
  ) => Promise<PushRegistration>;
  /** Current notification preferences per thread */
  notificationPreferences: Record<string, NotificationPreference>;
  /** Update the notification preference for a thread */
  setThreadPreference: (threadId: string, pref: NotificationPreference) => void;
  /** Manually set the browser app badge count */
  setBadgeCount: (count: number) => void;
  /** Whether a push registration is active */
  isPushRegistered: boolean;
  /** Current push registration, or null */
  pushRegistration: PushRegistration | null;
  /** Unregister from push notifications */
  unregisterPush: () => Promise<void>;
  /** Send a heartbeat to the push server (call on app focus) */
  sendHeartbeat: () => Promise<void>;
  /** Signal offline to the push server (call on app blur/hide) */
  setOffline: () => Promise<void>;
  /** Unread counts per thread id */
  unreadByThread: Record<string, number>;
  /** Refresh notification state */
  refresh: () => void;
}

// ============================================================================
// useNotifications hook
// ============================================================================

export function useNotifications({
  localPubkeyHex,
  relays,
  refreshInterval = 5_000,
  autoBadge = true,
}: UseNotificationsOptions): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadByThread, setUnreadByThread] = useState<Record<string, number>>({});
  const [isPushRegistered, setIsPushRegistered] = useState(false);
  const [pushRegistration, setPushRegistration] =
    useState<PushRegistration | null>(null);
  const [notificationPreferences, setNotificationPreferences] = useState<
    Record<string, NotificationPreference>
  >({});

  // Stable manager refs
  const notifManagerRef = useRef<NotificationManager | null>(null);
  const notifCenterRef = useRef<InAppNotificationCenter>(inAppNotificationCenter);

  if (!notifManagerRef.current) {
    notifManagerRef.current = new NotificationManager(
      localPubkeyHex,
      relays ?? getDefaultRelays(),
    );
  }

  // --------------------------------------------------------------------------
  // Load state from storage
  // --------------------------------------------------------------------------

  const loadState = useCallback(() => {
    const center = notifCenterRef.current;
    const allNotifs = center.getAll();
    const unread = center.getTotalUnreadCount();
    const byThread = center.getAllUnreadCounts();

    setNotifications(allNotifs);
    setUnreadCount(unread);
    setUnreadByThread(byThread);

    // Badge
    if (autoBadge) {
      center.setBadgeCount(unread);
    }

    // Push registration
    const reg = notifManagerRef.current?.getRegistration() ?? null;
    setIsPushRegistered(!!reg?.active);
    setPushRegistration(reg);
  }, [autoBadge]);

  // --------------------------------------------------------------------------
  // Initial load + refresh interval
  // --------------------------------------------------------------------------

  useEffect(() => {
    loadState();
  }, [localPubkeyHex]);

  useEffect(() => {
    if (!refreshInterval) return;
    const id = setInterval(loadState, refreshInterval);
    return () => clearInterval(id);
  }, [refreshInterval, loadState]);

  // --------------------------------------------------------------------------
  // markAllRead
  // --------------------------------------------------------------------------

  const markAllRead = useCallback(() => {
    notifCenterRef.current.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    setUnreadByThread({});
    if (autoBadge) {
      notifCenterRef.current.setBadgeCount(0);
    }
  }, [autoBadge]);

  // --------------------------------------------------------------------------
  // markThreadRead
  // --------------------------------------------------------------------------

  const markThreadRead = useCallback(
    (threadId: string) => {
      notifCenterRef.current.markThreadRead(threadId);
      setNotifications((prev) =>
        prev.map((n) =>
          n.threadId === threadId ? { ...n, read: true } : n,
        ),
      );
      setUnreadByThread((prev) => {
        const updated = { ...prev };
        delete updated[threadId];
        return updated;
      });
      setUnreadCount(notifCenterRef.current.getTotalUnreadCount());
      if (autoBadge) {
        notifCenterRef.current.refreshBadge();
      }
    },
    [autoBadge],
  );

  // --------------------------------------------------------------------------
  // registerPush
  // --------------------------------------------------------------------------

  const registerPush = useCallback(
    async (
      pushServerPubkey: string,
      deviceToken: string,
      customRelays?: string[],
      notifyKinds?: number[],
    ): Promise<PushRegistration> => {
      const manager = notifManagerRef.current!;
      const reg = await manager.registerPushDevice(
        pushServerPubkey,
        deviceToken,
        customRelays ?? relays ?? getDefaultRelays(),
        notifyKinds ?? [1059],
      );
      setIsPushRegistered(true);
      setPushRegistration(reg);
      return reg;
    },
    [relays],
  );

  // --------------------------------------------------------------------------
  // unregisterPush
  // --------------------------------------------------------------------------

  const unregisterPush = useCallback(async () => {
    const manager = notifManagerRef.current!;
    await manager.unregisterDevice();
    setIsPushRegistered(false);
    setPushRegistration(null);
  }, []);

  // --------------------------------------------------------------------------
  // sendHeartbeat
  // --------------------------------------------------------------------------

  const sendHeartbeat = useCallback(async () => {
    await notifManagerRef.current?.sendHeartbeat();
  }, []);

  // --------------------------------------------------------------------------
  // setOffline
  // --------------------------------------------------------------------------

  const setOffline = useCallback(async () => {
    await notifManagerRef.current?.setOffline();
  }, []);

  // --------------------------------------------------------------------------
  // Heartbeat / offline on visibility change
  // --------------------------------------------------------------------------

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void notifManagerRef.current?.setOffline();
      } else {
        void notifManagerRef.current?.sendHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // --------------------------------------------------------------------------
  // notificationPreferences
  // --------------------------------------------------------------------------

  const setThreadPreference = useCallback(
    (threadId: string, pref: NotificationPreference) => {
      notifManagerRef.current?.setThreadPreference(threadId, pref);
      setNotificationPreferences((prev) => ({ ...prev, [threadId]: pref }));
    },
    [],
  );

  // --------------------------------------------------------------------------
  // setBadgeCount
  // --------------------------------------------------------------------------

  const setBadgeCount = useCallback((count: number) => {
    notifCenterRef.current.setBadgeCount(count);
  }, []);

  // --------------------------------------------------------------------------
  // refresh
  // --------------------------------------------------------------------------

  const refresh = useCallback(() => {
    loadState();
  }, [loadState]);

  return {
    unreadCount,
    notifications,
    markAllRead,
    markThreadRead,
    registerPush,
    notificationPreferences,
    setThreadPreference,
    setBadgeCount,
    isPushRegistered,
    pushRegistration,
    unregisterPush,
    sendHeartbeat,
    setOffline,
    unreadByThread,
    refresh,
  };
}


// ============================================================================
// NotificationsProvider — layout wrapper exported for MessagesPage
// ============================================================================

/**
 * NotificationsProvider wraps the notifications-aware subtree.
 * Inner components call useNotifications() directly with their own instance.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
