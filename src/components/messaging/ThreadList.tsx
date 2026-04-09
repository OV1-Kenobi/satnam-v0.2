/**
 * Satnam v2 — ThreadList
 * Spec: messaging-spec.md § 4 (ThreadList)
 *
 * Left panel listing all message threads (DM + group + self):
 *   - Search bar at top
 *   - Thread rows: avatar, name/npub, last message preview (truncated), unread badge, timestamp
 *   - Group icon overlay (people icon) at bottom-right of avatar for group threads
 *   - Flame icon for ephemeral threads
 *   - Sort by last activity (managed by useMessaging)
 */

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  Search,
  Users,
  Flame,
  MessageSquare,
  PenLine,
} from 'lucide-react';
import type { MessageThread } from '../../hooks/useMessaging.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ThreadListProps {
  threads: MessageThread[];
  selectedThreadId: string | null;
  onSelect: (threadId: string) => void;
  onNewDm?: () => void;
  className?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Derive initials from display name */
function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Deterministic hue from string */
function avatarHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

// ── Avatar ─────────────────────────────────────────────────────────────────────

function ThreadAvatar({
  thread,
}: {
  thread: MessageThread;
}) {
  const name = thread.name || 'Unknown';
  const hue = avatarHue(thread.id);
  const isGroup = thread.type === 'group';
  const isSelf = thread.type === 'self';

  return (
    <div className="relative flex-shrink-0">
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold text-white"
        style={{ background: isSelf ? '#f7931a' : `hsl(${hue},55%,38%)` }}
        aria-hidden="true"
      >
        {isSelf
          ? <PenLine size={18} />
          : thread.avatarUrl
            ? <img src={thread.avatarUrl} alt={name} className="w-full h-full rounded-full object-cover" />
            : initials(name)}
      </div>

      {/* Group overlay badge */}
      {isGroup && (
        <div
          className="absolute -bottom-0.5 -right-0.5 w-4.5 h-4.5 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center"
          aria-hidden="true"
        >
          <Users size={8} className="text-slate-400" />
        </div>
      )}

      {/* Ephemeral flame overlay */}
      {thread.hasEphemeral && !isGroup && (
        <div
          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-slate-950 border border-yellow-700/60 flex items-center justify-center"
          aria-hidden="true"
        >
          <Flame size={8} className="text-yellow-500" />
        </div>
      )}
    </div>
  );
}

// ── Thread Row ─────────────────────────────────────────────────────────────────

function ThreadRow({
  thread,
  isSelected,
  onSelect,
}: {
  thread: MessageThread;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const lastMsg = thread.lastMessage;
  const preview = lastMsg ? truncate(lastMsg.content) : 'No messages yet';
  const time = lastMsg ? formatTime(lastMsg.timestamp) : '';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-selected={isSelected}
      aria-label={`Thread with ${thread.name}${thread.unreadCount > 0 ? `, ${thread.unreadCount} unread` : ''}`}
      className={clsx(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 text-left',
        isSelected
          ? 'bg-[#f7931a]/10 border border-[#f7931a]/25'
          : 'hover:bg-slate-800/60 border border-transparent',
      )}
    >
      <ThreadAvatar thread={thread} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className={clsx(
            'text-sm font-medium truncate',
            isSelected ? 'text-[#f7931a]' : 'text-slate-200',
          )}>
            {thread.name}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {thread.hasEphemeral && (
              <Flame size={10} className="text-yellow-500" aria-label="Has ephemeral messages" />
            )}
            {time && (
              <span className="text-[10px] text-slate-600">{time}</span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500 truncate">{preview}</p>
          {thread.unreadCount > 0 && (
            <span
              className="flex-shrink-0 min-w-5 h-5 px-1 rounded-full bg-[#f7931a] text-black text-[10px] font-bold flex items-center justify-center"
              aria-label={`${thread.unreadCount} unread messages`}
            >
              {thread.unreadCount > 99 ? '99+' : thread.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────────

function EmptyThreads({ onNewDm }: { onNewDm?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4 px-4">
      <div className="w-16 h-16 rounded-2xl bg-[#f7931a]/10 border border-[#f7931a]/20 flex items-center justify-center">
        <MessageSquare size={28} className="text-[#f7931a]" aria-hidden="true" />
      </div>
      <div className="text-center">
        <h3 className="heading-display text-base text-slate-200 mb-1">No Messages</h3>
        <p className="text-xs text-slate-500 max-w-48">
          Start a private conversation with any Nostr contact.
        </p>
      </div>
      {onNewDm && (
        <button
          type="button"
          onClick={onNewDm}
          className="px-4 py-2 rounded-lg bg-[#f7931a] text-black text-sm font-medium hover:bg-[#e8841a] transition-colors"
        >
          New Message
        </button>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ThreadList({
  threads,
  selectedThreadId,
  onSelect,
  onNewDm,
  className,
}: ThreadListProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return threads;
    const q = search.toLowerCase();
    return threads.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.lastMessage?.content.toLowerCase().includes(q)
    );
  }, [threads, search]);

  return (
    <div className={clsx('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-4 pb-3">
        <h2 className="heading-display text-base text-[#f7931a]">Messages</h2>
        {onNewDm && (
          <button
            type="button"
            onClick={onNewDm}
            aria-label="New message"
            className="w-8 h-8 rounded-lg bg-[#f7931a]/10 border border-[#f7931a]/20 flex items-center justify-center text-[#f7931a] hover:bg-[#f7931a]/20 transition-colors"
          >
            <PenLine size={14} />
          </button>
        )}
      </div>

      {/* Search bar */}
      <div className="px-3 pb-3">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-[#f7931a] transition-colors"
          />
        </div>
      </div>

      {/* Thread list */}
      <div
        className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-4"
        role="listbox"
        aria-label="Conversations"
      >
        {filtered.length === 0 && threads.length === 0 ? (
          <EmptyThreads onNewDm={onNewDm} />
        ) : filtered.length === 0 ? (
          <div className="text-center py-8">
            <Search size={20} className="mx-auto text-slate-600 mb-2" aria-hidden="true" />
            <p className="text-xs text-slate-600">No conversations match "{search}"</p>
          </div>
        ) : (
          filtered.map(thread => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              isSelected={thread.id === selectedThreadId}
              onSelect={() => onSelect(thread.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

