/**
 * @module hooks/useNotifications
 * @description React hook for in-app notification management.
 *
 * Provides:
 * - notifications: list of in-app notifications
 * - unreadCount: total unread notification count
 * - markAllRead: mark all notifications as read
 * - markThreadRead: mark all notifications for a thread as read
 * - pushRegistration: current push device registration status
 */

import React, { useState, useCallback } from 'react';
import type { InAppNotification, PushRegistration } from '../lib/messaging/types.js';

// Re-export for consumers that import from this hook
export type { InAppNotification };

// ---------------------------------------------------------------------------
// Extended push registration with UI-relevant status fields
// ---------------------------------------------------------------------------

interface PushRegistrationStatus extends PushRegistration {
  /** True if the push service connection is active */
  isOnline: boolean;
  /** True if a valid registration is stored */
  isRegistered: boolean;
}

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

interface UseNotificationsReturn {
  notifications: InAppNotification[];
  unreadCount: number;
  markAllRead: () => void;
  markThreadRead: (threadId: string) => void;
  pushRegistration: PushRegistrationStatus | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNotifications(
  _localPubkeyHex = '',
): UseNotificationsReturn {
  void _localPubkeyHex;

  const [notifications, setNotifications] = useState<InAppNotification[]>([]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const markThreadRead = useCallback((threadId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.threadId === threadId ? { ...n, read: true } : n)),
    );
  }, []);

  // Push registration status — null until registered
  const pushRegistration: PushRegistrationStatus | null = null;

  return {
    notifications,
    unreadCount,
    markAllRead,
    markThreadRead,
    pushRegistration,
  };
}

export default useNotifications;

/**
 * NotificationsProvider — context wrapper for the notification subtree.
 * Currently a pass-through since useNotifications is self-contained.
 */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
