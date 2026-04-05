/**
 * @component GroupMemberList
 * @description Display group members with their roles, delegation status, and actions.
 *
 * Shows each member's pubkey, role in the hierarchy, delegation chain validity,
 * and provides Guardian/Steward actions (assign role, revoke).
 */

import React, { useState } from 'react';
import type { DelegationEvent } from '../../lib/nip26/types.js';
import { RoleType } from '../../lib/nip26/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GroupMember {
  pubkey: string;
  displayName?: string;
  role: RoleType;
  delegationChainValid: boolean;
  delegationEvent?: DelegationEvent;
  isOnline?: boolean;
  lastSeen?: number;
}

interface GroupMemberListProps {
  members: GroupMember[];
  currentUserPubkey: string;
  currentUserRole: RoleType;
  onAssignRole?: (memberPubkey: string) => void;
  onRevoke?: (memberPubkey: string) => void;
  onViewChain?: (memberPubkey: string) => void;
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Role badge colours
// ---------------------------------------------------------------------------

const ROLE_COLORS: Record<RoleType, { text: string; bg: string; border: string }> = {
  [RoleType.Guardian]:  { text: 'text-[#F7931A]',   bg: 'bg-[#F7931A]/10',   border: 'border-[#F7931A]/30' },
  [RoleType.Steward]:   { text: 'text-[#FFD700]',   bg: 'bg-[#FFD700]/10',   border: 'border-[#FFD700]/30' },
  [RoleType.Adult]:     { text: 'text-[#3B82F6]',   bg: 'bg-[#3B82F6]/10',   border: 'border-[#3B82F6]/30' },
  [RoleType.Offspring]: { text: 'text-[#a0a0a0]',   bg: 'bg-[#a0a0a0]/10',   border: 'border-[#a0a0a0]/30' },
};

const ROLE_ICONS: Record<RoleType, string> = {
  [RoleType.Guardian]:  '🛡',
  [RoleType.Steward]:   '⚖',
  [RoleType.Adult]:     '👤',
  [RoleType.Offspring]: '🌱',
};

const ROLE_DESCRIPTIONS: Record<RoleType, string> = {
  [RoleType.Guardian]:  'Trust Protector',
  [RoleType.Steward]:   'Trustee',
  [RoleType.Adult]:     'Mature Beneficiary',
  [RoleType.Offspring]: 'Immature Beneficiary',
};

// ---------------------------------------------------------------------------
// Role Badge
// ---------------------------------------------------------------------------

function RoleBadge({ role }: { role: RoleType }) {
  const colors = ROLE_COLORS[role];
  return (
    <span
      className={`
        inline-flex items-center gap-1 px-2 py-0.5
        rounded-full text-xs font-medium border
        ${colors.text} ${colors.bg} ${colors.border}
      `}
      title={ROLE_DESCRIPTIONS[role]}
    >
      <span aria-hidden="true">{ROLE_ICONS[role]}</span>
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Member Row
// ---------------------------------------------------------------------------

function MemberRow({
  member,
  isSelf,
  canManage,
  onAssignRole,
  onRevoke,
  onViewChain,
}: {
  member: GroupMember;
  isSelf: boolean;
  canManage: boolean;
  onAssignRole?: () => void;
  onRevoke?: () => void;
  onViewChain?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shortPubkey = member.pubkey.slice(0, 8) + '…' + member.pubkey.slice(-6);
  const displayName = member.displayName ?? shortPubkey;

  return (
    <li className="card p-4">
      <div className="flex items-start gap-3">
        {/* Avatar / online indicator */}
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-lg">
            {ROLE_ICONS[member.role]}
          </div>
          {member.isOnline !== undefined && (
            <span
              className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#111111] ${
                member.isOnline ? 'bg-green-500' : 'bg-[#555555]'
              }`}
              aria-label={member.isOnline ? 'Online' : 'Offline'}
            />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[#f5f5f5] truncate">{displayName}</span>
            {isSelf && (
              <span className="text-xs text-[#555555] border border-[#2a2a2a] px-1.5 py-0.5 rounded">
                You
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <RoleBadge role={member.role} />

            {/* Delegation validity */}
            {member.role !== RoleType.Guardian && (
              <span
                className={`
                  inline-flex items-center gap-1 text-xs
                  ${member.delegationChainValid ? 'text-green-500' : 'text-red-400'}
                `}
                title={member.delegationChainValid ? 'Delegation chain valid' : 'Delegation chain invalid or expired'}
              >
                {member.delegationChainValid ? '✓' : '⚠'} Delegation
              </span>
            )}
          </div>

          {/* Pubkey */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1 font-mono text-xs text-[#555555] hover:text-[#a0a0a0] transition-colors text-left"
            aria-expanded={expanded}
            aria-label="Toggle pubkey display"
          >
            {expanded ? member.pubkey : shortPubkey}
          </button>
        </div>

        {/* Actions menu */}
        {canManage && !isSelf && (
          <div className="flex-shrink-0 flex gap-1">
            {onAssignRole && (
              <button
                onClick={onAssignRole}
                className="p-2 rounded-lg text-[#555555] hover:text-[#F7931A] hover:bg-[#F7931A]/10 transition-colors text-sm"
                aria-label={`Assign role to ${displayName}`}
                title="Assign role"
              >
                ✏️
              </button>
            )}
            {onViewChain && (
              <button
                onClick={onViewChain}
                className="p-2 rounded-lg text-[#555555] hover:text-[#3B82F6] hover:bg-[#3B82F6]/10 transition-colors text-sm"
                aria-label={`View delegation chain for ${displayName}`}
                title="View chain"
              >
                🔗
              </button>
            )}
            {onRevoke && member.role !== RoleType.Guardian && (
              <button
                onClick={onRevoke}
                className="p-2 rounded-lg text-[#555555] hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm"
                aria-label={`Revoke ${displayName}'s role`}
                title="Revoke"
              >
                🚫
              </button>
            )}
          </div>
        )}
      </div>

      {/* Last seen */}
      {member.lastSeen && (
        <p className="mt-2 text-xs text-[#555555] pl-13">
          Last seen {new Date(member.lastSeen * 1000).toLocaleDateString()}
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function MemberSkeleton() {
  return (
    <li className="card p-4">
      <div className="flex items-center gap-3">
        <div className="skeleton w-10 h-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-4 w-32 rounded" />
          <div className="skeleton h-3 w-20 rounded" />
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function GroupMemberList({
  members,
  currentUserPubkey,
  currentUserRole,
  onAssignRole,
  onRevoke,
  onViewChain,
  isLoading = false,
}: GroupMemberListProps) {
  const canManage =
    currentUserRole === RoleType.Guardian ||
    currentUserRole === RoleType.Steward;

  // Group members by role
  const byRole = {
    [RoleType.Guardian]: members.filter(m => m.role === RoleType.Guardian),
    [RoleType.Steward]:  members.filter(m => m.role === RoleType.Steward),
    [RoleType.Adult]:    members.filter(m => m.role === RoleType.Adult),
    [RoleType.Offspring]: members.filter(m => m.role === RoleType.Offspring),
  };

  const roleOrder: RoleType[] = [
    RoleType.Guardian,
    RoleType.Steward,
    RoleType.Adult,
    RoleType.Offspring,
  ];

  if (isLoading) {
    return (
      <ul className="space-y-3" aria-label="Loading members" role="list">
        {[1, 2, 3].map(i => <MemberSkeleton key={i} />)}
      </ul>
    );
  }

  if (members.length === 0) {
    return (
      <div className="card text-center py-12">
        <p className="text-[#555555] text-sm">No members in this group yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {roleOrder.map(role => {
        const roleMembers = byRole[role];
        if (roleMembers.length === 0) return null;
        const colors = ROLE_COLORS[role];

        return (
          <section key={role} aria-label={`${role} members`}>
            <h3 className={`text-xs font-semibold uppercase tracking-widest mb-3 ${colors.text}`}>
              {ROLE_ICONS[role]} {role} ({roleMembers.length})
            </h3>
            <ul className="space-y-2" role="list">
              {roleMembers.map(member => (
                <MemberRow
                  key={member.pubkey}
                  member={member}
                  isSelf={member.pubkey === currentUserPubkey}
                  canManage={canManage}
                  onAssignRole={onAssignRole ? () => onAssignRole(member.pubkey) : undefined}
                  onRevoke={onRevoke ? () => onRevoke(member.pubkey) : undefined}
                  onViewChain={onViewChain ? () => onViewChain(member.pubkey) : undefined}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
