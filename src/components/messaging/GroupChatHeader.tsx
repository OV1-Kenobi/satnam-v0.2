/**
 * Satnam v2 — GroupChatHeader
 * Spec: messaging-spec.md § 4 (GroupChatHeader)
 *
 * Header for group chat view:
 *   - Group name
 *   - Stacked member avatars (up to 4 shown)
 *   - Member count badge
 *   - Settings gear button (opens GroupSettingsPanel)
 *   - Protocol indicator badge (NIP-17 / MLS)
 */

import clsx from 'clsx';
import { Settings, ChevronLeft, Users } from 'lucide-react';
import type { MessageThread } from '../../hooks/useMessaging.js';
import ProtocolIndicator from './ProtocolIndicator.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface GroupChatHeaderProps {
  thread: MessageThread;
  onOpenSettings: () => void;
  /** Mobile back navigation */
  onBack?: () => void;
  className?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function avatarHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

function memberInitials(pubkey: string, displayName?: string): string {
  if (displayName) {
    return displayName.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
  }
  return pubkey.slice(5, 7).toUpperCase();
}

// ── Member Avatar Cluster ──────────────────────────────────────────────────────

function MemberAvatarCluster({
  participants,
  totalCount,
}: {
  participants: MessageThread['participants'];
  totalCount: number;
}) {
  const MAX_SHOWN = 4;
  const shown = participants.slice(0, MAX_SHOWN);
  const overflow = totalCount - MAX_SHOWN;

  return (
    <div className="flex items-center -space-x-2" aria-label={`${totalCount} members`}>
      {shown.map((p, i) => {
        const hue = avatarHue(p.pubkey);
        const label = memberInitials(p.pubkey, p.displayName);
        return (
          <div
            key={p.pubkey}
            className="w-6 h-6 rounded-full border-2 border-slate-950 flex items-center justify-center text-[9px] font-semibold text-white"
            style={{ background: `hsl(${hue},50%,38%)`, zIndex: MAX_SHOWN - i }}
            aria-hidden="true"
            title={p.displayName ?? p.pubkey}
          >
            {p.avatarUrl ? (
              <img src={p.avatarUrl} alt={label} className="w-full h-full rounded-full object-cover" />
            ) : label}
          </div>
        );
      })}
      {overflow > 0 && (
        <div
          className="w-6 h-6 rounded-full border-2 border-slate-950 bg-slate-700 flex items-center justify-center text-[9px] font-bold text-slate-300"
          aria-hidden="true"
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function GroupChatHeader({
  thread,
  onOpenSettings,
  onBack,
  className,
}: GroupChatHeaderProps) {
  const memberCount = thread.participants.length;

  return (
    <header
      className={clsx(
        'flex items-center gap-3 px-4 py-3',
        'bg-slate-950 border-b border-slate-800',
        className,
      )}
      aria-label={`Group chat: ${thread.name}`}
    >
      {/* Mobile back button */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="text-slate-400 hover:text-slate-200 transition-colors md:hidden"
        >
          <ChevronLeft size={20} />
        </button>
      )}

      {/* Group avatar */}
      <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0">
        {thread.avatarUrl
          ? <img src={thread.avatarUrl} alt={thread.name} className="w-full h-full rounded-full object-cover" />
          : <Users size={16} className="text-slate-400" aria-hidden="true" />}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-sm font-semibold text-slate-200 truncate">{thread.name}</h1>
          <ProtocolIndicator protocol={thread.protocol} />
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <MemberAvatarCluster
            participants={thread.participants}
            totalCount={memberCount}
          />
          <span className="text-[10px] text-slate-500">
            {memberCount} {memberCount === 1 ? 'member' : 'members'}
          </span>
        </div>
      </div>

      {/* Settings */}
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Group settings"
        className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 flex items-center justify-center transition-all duration-150 flex-shrink-0"
      >
        <Settings size={16} />
      </button>
    </header>
  );
}

