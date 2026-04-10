/**
 * Satnam v2 — GroupSettingsPanel
 * Spec: messaging-spec.md § 4 (GroupSettingsPanel)
 *
 * Group management panel:
 *   - Member list with roles (admin crown)
 *   - Add member (pubkey input)
 *   - Remove member (admin only)
 *   - Group name / avatar edit
 *   - Notification preference selector
 *   - Admin transfer
 *   - Leave group (red, destructive)
 */

import { useCallback, useState } from 'react';
import clsx from 'clsx';
import {
  X,
  Crown,
  Edit2,
  Bell,
  BellOff,
  BellRing,
  LogOut,
  UserMinus,
  UserPlus,
  Check,
} from 'lucide-react';
import type { GroupThread } from '../../hooks/useMessaging.js';
import { useMessaging } from '../../hooks/useMessaging.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface GroupSettingsPanelProps {
  thread: GroupThread;
  onClose: () => void;
  /** Current user pubkey to check admin status */
  currentUserPubkey?: string;
}

type NotifPref = GroupThread['notificationPreference'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function avatarHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

const NOTIF_OPTIONS: Array<{ value: NotifPref; label: string; Icon: typeof Bell }> = [
  { value: 'all', label: 'All messages', Icon: Bell },
  { value: 'mentions', label: 'Mentions only', Icon: BellRing },
  { value: 'none', label: 'Muted', Icon: BellOff },
];

// ── MemberRow ──────────────────────────────────────────────────────────────────

interface ParticipantInfo { pubkey: string; isAdmin: boolean; displayName?: string; }

function MemberRow({
  participant,
  isCurrentUser,
  canRemove,
  onRemove,
  onTransferAdmin,
  isAdmin,
}: {
  participant: ParticipantInfo;
  isCurrentUser: boolean;
  canRemove: boolean;
  onRemove: () => void;
  onTransferAdmin: () => void;
  isAdmin: boolean;
}) {
  const hue = avatarHue(participant.pubkey);
  const displayName = participant.displayName ?? `${participant.pubkey.slice(0, 8)}…`;

  return (
    <div className="flex items-center gap-3 py-2">
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
        style={{ background: `hsl(${hue},50%,38%)` }}
        aria-hidden="true"
      >
        {displayName.slice(0, 2).toUpperCase()}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-slate-200 truncate">{displayName}</span>
          {participant.isAdmin && (
            <Crown size={11} className="text-[#f7931a] flex-shrink-0" aria-label="Admin" />
          )}
          {isCurrentUser && (
            <span className="text-[9px] text-slate-600 font-medium">(you)</span>
          )}
        </div>

      </div>

      {/* Actions */}
      {!isCurrentUser && canRemove && (
        <div className="flex items-center gap-1">
          {isAdmin && !participant.isAdmin && (
            <button
              type="button"
              onClick={onTransferAdmin}
              title="Make admin"
              aria-label={`Transfer admin to ${displayName}`}
              className="p-1 rounded text-slate-600 hover:text-[#f7931a] transition-colors"
            >
              <Crown size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            title="Remove member"
            aria-label={`Remove ${displayName}`}
            className="p-1 rounded text-slate-600 hover:text-red-400 transition-colors"
          >
            <UserMinus size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function GroupSettingsPanel({
  thread,
  onClose,
  currentUserPubkey = 'self',
}: GroupSettingsPanelProps) {
  const { addMember, removeMember, leaveGroup, updateGroupConfig, setNotificationPreference } = useMessaging({ localPubkeyHex: currentUserPubkey });

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(thread.config.name);
  const [addPubkeyInput, setAddPubkeyInput] = useState('');
  const [isLeaving, setIsLeaving] = useState(false);

  const isAdmin = thread.config.admins.includes(currentUserPubkey);

  const handleSaveName = useCallback(async () => {
    if (nameInput.trim() && thread.groupId) {
      await updateGroupConfig(thread.groupId, { name: nameInput.trim() });
      setEditingName(false);
    }
  }, [nameInput, thread.groupId, updateGroupConfig]);

  const handleAddMember = useCallback(async () => {
    if (!addPubkeyInput.trim() || !thread.groupId) return;
    await addMember(thread.groupId, addPubkeyInput.trim());
    setAddPubkeyInput('');
  }, [addPubkeyInput, thread.groupId, addMember]);

  const handleRemoveMember = useCallback(async (pubkey: string) => {
    if (!thread.groupId) return;
    await removeMember(thread.groupId, pubkey);
  }, [thread.groupId, removeMember]);

  const handleLeave = useCallback(async () => {
    if (!thread.groupId) return;
    if (!confirm('Leave this group? You will stop receiving messages.')) return;
    setIsLeaving(true);
    await leaveGroup(thread.groupId);
    onClose();
  }, [thread.groupId, leaveGroup, onClose]);

  return (
    <div
      className="flex flex-col h-full bg-slate-950"
      role="dialog"
      aria-label="Group settings"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <h2 className="heading-display text-sm text-[#f7931a]">Group Settings</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Group name */}
        <section className="px-4 py-4 border-b border-slate-800/60">
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-3">Group Name</p>
          {editingName ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                autoFocus
                aria-label="Group name"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-[#f7931a] transition-colors"
              />
              <button
                type="button"
                onClick={handleSaveName}
                aria-label="Save name"
                className="p-2 rounded-lg bg-[#f7931a] text-black hover:bg-[#e8841a] transition-colors"
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                onClick={() => { setEditingName(false); setNameInput(thread.config.name); }}
                aria-label="Cancel"
                className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-200">{thread.config.name}</span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  aria-label="Edit group name"
                  className="p-1.5 rounded text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <Edit2 size={13} />
                </button>
              )}
            </div>
          )}
        </section>

        {/* Members */}
        <section className="px-4 py-4 border-b border-slate-800/60">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
              Members ({thread.config.members.length})
            </p>
          </div>

          <div className="space-y-0.5 divide-y divide-slate-800/40">
            {thread.config.members.map(pubkey => (
              <MemberRow
                key={pubkey}
                participant={{ pubkey, isAdmin: thread.config.admins.includes(pubkey) }}
                isCurrentUser={pubkey === currentUserPubkey}
                canRemove={isAdmin}
                isAdmin={isAdmin}
                onRemove={() => handleRemoveMember(pubkey)}
                onTransferAdmin={() => {
                  // In production: update group config to change admin
                  alert(`Transfer admin to ${p.displayName ?? p.pubkey}? (Not implemented in dev mode)`);
                }}
              />
            ))}
          </div>

          {/* Add member (admin only) */}
          {isAdmin && (
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={addPubkeyInput}
                onChange={e => setAddPubkeyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddMember()}
                placeholder="npub1… or hex pubkey"
                aria-label="Add member pubkey"
                className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-[#f7931a] transition-colors"
              />
              <button
                type="button"
                onClick={handleAddMember}
                disabled={!addPubkeyInput.trim()}
                aria-label="Add member"
                className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:bg-[#f7931a]/20 hover:text-[#f7931a] transition-colors disabled:opacity-40"
              >
                <UserPlus size={14} />
              </button>
            </div>
          )}
        </section>

        {/* Notification preference */}
        <section className="px-4 py-4 border-b border-slate-800/60">
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mb-3">Notifications</p>
          <div className="space-y-1" role="group" aria-label="Notification preference">
            {NOTIF_OPTIONS.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setNotificationPreference(thread.id, value)}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-100',
                  thread.notificationPreference === value
                    ? 'bg-[#f7931a]/10 text-[#f7931a] border border-[#f7931a]/20'
                    : 'text-slate-300 hover:bg-slate-800',
                )}
                aria-pressed={thread.notificationPreference === value}
              >
                <Icon size={14} aria-hidden="true" />
                {label}
                {thread.notificationPreference === value && (
                  <Check size={12} className="ml-auto text-[#f7931a]" />
                )}
              </button>
            ))}
          </div>
        </section>

        {/* Danger zone */}
        <section className="px-4 py-4">
          <p className="text-[10px] text-red-700 font-medium uppercase tracking-wider mb-3">Danger Zone</p>
          <button
            type="button"
            onClick={handleLeave}
            disabled={isLeaving}
            className={clsx(
              'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg',
              'border border-red-900/50 text-red-400 text-sm font-medium',
              'hover:bg-red-900/20 hover:border-red-800 transition-colors duration-150',
              'disabled:opacity-50 disabled:pointer-events-none',
            )}
          >
            <LogOut size={14} aria-hidden="true" />
            {isLeaving ? 'Leaving…' : 'Leave Group'}
          </button>
        </section>
      </div>
    </div>
  );
}


