/**
 * Satnam v2 — NotificationCenter
 * Spec: messaging-spec.md § 4 (NotificationCenter)
 *
 * Bell icon with badge count in nav; dropdown panel with:
 *   - Notification list grouped by thread (message previews)
 *   - Mark all read button
 *   - Per-thread notification settings (all / mentions / muted)
 *
 * Push device registration via kind:22456 (0xchat model).
 */

import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  Bell,
  X,
  CheckCheck,
  MessageSquare,
  Users,
  Settings,
  BellOff,
  BellRing,
  Check,
} from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications.js';
import type { InAppNotification } from '../../hooks/useNotifications.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface NotificationCenterProps {
  /** Show as nav item (with bell icon + badge) */
  showBell?: boolean;
  className?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function groupByThread(notifications: InAppNotification[]): Map<string, InAppNotification[]> {
  const map = new Map<string, InAppNotification[]>();
  for (const n of notifications) {
    const existing = map.get(n.threadId) ?? [];
    map.set(n.threadId, [...existing, n]);
  }
  return map;
}

// ── Thread Group ───────────────────────────────────────────────────────────────

function ThreadNotifGroup({
  threadId,
  threadName,
  isGroup,
  notifications,
  onMarkRead,
}: {
  threadId: string;
  threadName: string;
  isGroup: boolean;
  notifications: InAppNotification[];
  onMarkRead: (threadId: string) => void;
}) {
  const unread = notifications.filter(n => !n.isRead);
  const latest = notifications[0];

  return (
    <div className="px-3 py-2 hover:bg-slate-800/50 transition-colors cursor-pointer rounded-lg">
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center flex-shrink-0 mt-0.5">
          {isGroup
            ? <Users size={14} className="text-slate-400" aria-hidden="true" />
            : <MessageSquare size={14} className="text-slate-400" aria-hidden="true" />}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-200 truncate">{threadName}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {unread.length > 0 && (
                <span className="min-w-4 h-4 px-1 rounded-full bg-[#f7931a] text-black text-[9px] font-bold flex items-center justify-center">
                  {unread.length}
                </span>
              )}
              <span className="text-[10px] text-slate-600">{formatTime(latest.timestamp)}</span>
            </div>
          </div>

          {notifications.length > 1 && (
            <p className="text-[10px] text-slate-500 mb-0.5">
              {notifications.length} new messages from {latest.senderName}
            </p>
          )}

          <p className="text-xs text-slate-400 truncate">
            {isGroup && <span className="text-[#f7931a]">{latest.senderName}: </span>}
            {latest.preview}
          </p>
        </div>

        {/* Mark thread read */}
        {unread.length > 0 && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onMarkRead(threadId); }}
            aria-label={`Mark ${threadName} as read`}
            className="p-1 rounded text-slate-600 hover:text-slate-300 transition-colors flex-shrink-0 mt-0.5"
          >
            <Check size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NotificationCenter({
  showBell = true,
  className,
}: NotificationCenterProps) {
  const {
    notifications,
    unreadCount,
    markAllRead,
    markThreadRead,
    pushRegistration,
  } = useNotifications();

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const grouped = groupByThread(notifications);

  // Sort threads by most recent notification
  const sortedThreadIds = Array.from(grouped.entries())
    .sort(([, a], [, b]) => (b[0]?.timestamp ?? 0) - (a[0]?.timestamp ?? 0))
    .map(([id]) => id);

  return (
    <div ref={ref} className={clsx('relative', className)}>
      {/* Bell trigger */}
      {showBell && (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          className="relative p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all duration-150"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-[#f7931a] text-black text-[9px] font-bold flex items-center justify-center"
              aria-hidden="true"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      )}

      {/* Dropdown panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Notification center"
          className={clsx(
            'absolute right-0 top-full mt-2 z-50',
            'w-80 max-h-[480px] flex flex-col',
            'rounded-xl bg-slate-900 border border-slate-800 shadow-2xl',
          )}
        >
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <h3 className="heading-display text-sm text-[#f7931a]">Notifications</h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  aria-label="Mark all as read"
                  title="Mark all as read"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
                >
                  <CheckCheck size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close notifications"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-all"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <div className="flex-1 overflow-y-auto p-2">
            {notifications.length === 0 ? (
              <div className="text-center py-10 space-y-2">
                <Bell size={24} className="mx-auto text-slate-700" aria-hidden="true" />
                <p className="text-xs text-slate-600">No notifications</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {sortedThreadIds.map(threadId => {
                  const group = grouped.get(threadId)!;
                  const first = group[0];
                  return (
                    <ThreadNotifGroup
                      key={threadId}
                      threadId={threadId}
                      threadName={first.threadName}
                      isGroup={first.isGroup}
                      notifications={group}
                      onMarkRead={markThreadRead}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Push status footer */}
          <div className="px-4 py-2.5 border-t border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className={clsx(
                'w-1.5 h-1.5 rounded-full',
                pushRegistration.isOnline ? 'bg-green-500' : 'bg-slate-600',
              )} aria-hidden="true" />
              <span className="text-[10px] text-slate-600">
                {pushRegistration.isRegistered
                  ? 'Push enabled'
                  : 'Push not configured'}
              </span>
            </div>
            {unreadCount === 0 && (
              <span className="text-[10px] text-slate-700">All caught up</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
