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
import type { GroupThread } from '../../hooks/useMessaging.js';
import ProtocolIndicator from './ProtocolIndicator.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface GroupChatHeaderProps {
  thread: GroupThread;
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
  members,
  totalCount,
}: {
  members: string[];
  totalCount: number;
}) {
  const MAX_SHOWN = 4;
  const shown = members.slice(0, MAX_SHOWN);
  const overflow = totalCount - MAX_SHOWN;

  return (
    <div className="flex items-center -space-x-2" aria-label={`${totalCount} members`}>
      {shown.map((pubkey, i) => {
        const hue = avatarHue(pubkey);
        const label = memberInitials(pubkey);
        return (
          <div
            key={pubkey}
            className="w-6 h-6 rounded-full border-2 border-slate-950 flex items-center justify-center text-[9px] font-semibold text-white"
            style={{ background: `hsl(${hue},50%,38%)`, zIndex: MAX_SHOWN - i }}
            aria-hidden="true"
            title={pubkey}
          >
            {label}
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
  const members = thread.config.members;
  const memberCount = members.length;
  const groupName = thread.config.name;
  const avatarUrl = thread.config.avatar;

  return (
    <header
      className={clsx(
        'flex items-center gap-3 px-4 py-3',
        'bg-slate-950 border-b border-slate-800',
        className,
      )}
      aria-label={`Group chat: ${groupName}`}
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
        {avatarUrl
          ? <img src={avatarUrl} alt={groupName} className="w-full h-full rounded-full object-cover" />
          : <Users size={16} className="text-slate-400" aria-hidden="true" />}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-sm font-semibold text-slate-200 truncate">{groupName}</h1>
          <ProtocolIndicator protocol="nip17" />
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <MemberAvatarCluster
            members={members}
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


