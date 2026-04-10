/**
 * Satnam v2 — Groups Page
 * Phase 2: FROST DKG ceremony + NIP-26 delegation graph management.
 *
 * Provides full group management:
 * - Create new groups (FROST DKG)
 * - View existing group members
 * - Assign/revoke roles via NIP-26 delegation
 */

import { useState, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';

import GroupCreateFlow from '../components/groups/GroupCreateFlow.js';
import GroupMemberList, { type GroupMember } from '../components/groups/GroupMemberList.js';
import RoleAssignment from '../components/groups/RoleAssignment.js';
import { RoleType } from '../lib/nip26/types.js';
import type { DelegationEvent } from '../lib/nip26/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Group {
  pubkey: string;
  name: string;
  threshold: number;
  totalParticipants: number;
  members: GroupMember[];
  createdAt: number;
}

type View = 'list' | 'create' | 'group' | 'assign-role';

// ---------------------------------------------------------------------------
// Mock data (replaced by real data from vault/relay in production)
// ---------------------------------------------------------------------------

const MOCK_CURRENT_PUBKEY =
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

const MOCK_GROUPS: Group[] = [];

// ---------------------------------------------------------------------------
// Group card
// ---------------------------------------------------------------------------

function GroupCard({ group, onSelect }: { group: Group; onSelect: () => void }) {

  return (
    <button
      onClick={onSelect}
      className="card w-full text-left hover:border-[#F7931A]/40 transition-all duration-150 active:scale-[0.99] group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-[#F7931A]/10 border border-[#F7931A]/20 flex items-center justify-center text-sm">
              👥
            </div>
            <h3 className="font-display text-[#F7931A] tracking-wide truncate">{group.name}</h3>
          </div>
          <p className="font-mono text-xs text-[#555555] truncate">{group.pubkey.slice(0, 20)}…</p>
        </div>
        <div className="flex-shrink-0 text-[#555555] group-hover:text-[#a0a0a0] transition-colors">
          →
        </div>
      </div>

      <div className="flex gap-4 mt-4 pt-4 border-t border-[#2a2a2a]">
        <div className="text-center">
          <p className="font-bold text-[#f5f5f5]">{group.members.length}</p>
          <p className="text-xs text-[#555555]">Members</p>
        </div>
        <div className="text-center">
          <p className="font-bold text-[#F7931A]">{group.threshold}/{group.totalParticipants}</p>
          <p className="text-xs text-[#555555]">Threshold</p>
        </div>
        <div className="text-center">
          <p className="text-sm text-green-500">●</p>
          <p className="text-xs text-[#555555]">Active</p>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyGroups({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="text-center py-16 space-y-6">
      <div className="w-20 h-20 mx-auto rounded-2xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-4xl">
        🏛
      </div>
      <div>
        <h3 className="font-display text-xl text-[#f5f5f5] mb-2">No Groups Yet</h3>
        <p className="text-sm text-[#555555] max-w-xs mx-auto">
          Create a FROST threshold group to manage shared keys and trust relationships.
        </p>
      </div>
      <button
        onClick={onCreate}
        className="
          inline-flex items-center gap-2 px-6 py-3 rounded-xl
          bg-[#F7931A] text-black font-medium
          hover:bg-[#c46e00] active:scale-95
          transition-all duration-150
        "
      >
        + Create Group
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group detail view
// ---------------------------------------------------------------------------

function GroupDetail({
  group,
  currentUserPubkey,
  currentUserRole,
  onAssignRole,
  onBack,
}: {
  group: Group;
  currentUserPubkey: string;
  currentUserRole: RoleType;
  onAssignRole: (pubkey: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-2 rounded-lg border border-[#2a2a2a] text-[#555555] hover:text-[#a0a0a0] hover:border-[#3a3a3a] transition-colors"
          aria-label="Back to groups"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-lg text-[#F7931A] tracking-wide truncate">{group.name}</h2>
          <p className="text-xs text-[#555555] font-mono truncate">{group.pubkey.slice(0, 24)}…</p>
        </div>
      </div>

      {/* Group stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3 text-center">
          <p className="text-xl font-bold text-[#F7931A]">{group.threshold}</p>
          <p className="text-xs text-[#555555]">Threshold</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xl font-bold text-[#f5f5f5]">{group.members.length}</p>
          <p className="text-xs text-[#555555]">Members</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-sm text-green-500">ACTIVE</p>
          <p className="text-xs text-[#555555]">Status</p>
        </div>
      </div>

      {/* Member list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-[#a0a0a0] uppercase tracking-widest">
            Members
          </h3>
          {(currentUserRole === RoleType.Guardian || currentUserRole === RoleType.Steward) && (
            <button
              onClick={() => onAssignRole('')}
              className="text-xs text-[#F7931A] hover:underline"
            >
              + Add Member
            </button>
          )}
        </div>

        <GroupMemberList
          members={group.members}
          currentUserPubkey={currentUserPubkey}
          currentUserRole={currentUserRole}
          onAssignRole={onAssignRole}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function GroupsPage() {
  const [view, setView] = useState<View>('list');
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [assignRolePubkey, setAssignRolePubkey] = useState('');
  const [groups, setGroups] = useState<Group[]>(MOCK_GROUPS);

  // Determine current user's role in selected group
  const currentUserRole = useMemo(() => {
    if (!selectedGroup) return RoleType.Adult;
    const member = selectedGroup.members.find(m => m.pubkey === MOCK_CURRENT_PUBKEY);
    return member?.role ?? RoleType.Adult;
  }, [selectedGroup]);

  const handleGroupCreated = (pubkey: string) => {
    const newGroup: Group = {
      pubkey,
      name: 'New Group',
      threshold: 2,
      totalParticipants: 3,
      members: [{
        pubkey: MOCK_CURRENT_PUBKEY,
        role: RoleType.Guardian,
        delegationChainValid: true,
        isOnline: true,
      }],
      createdAt: Math.floor(Date.now() / 1000),
    };
    setGroups(prev => [newGroup, ...prev]);
    setSelectedGroup(newGroup);
    setView('group');
  };

  const handleRoleAssigned = (_delegation: DelegationEvent) => {
    setView('group');
  };

  return (
    <>
      <Helmet>
        <title>Satnam — Groups</title>
        <meta name="description" content="FROST threshold group key management." />
      </Helmet>

      <main className="min-h-screen bg-[#0a0a0a] pb-safe">
        <div className="max-w-lg mx-auto px-4 py-6">
          {/* ── List view ─────────────────────────────────────────────────── */}
          {view === 'list' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h1 className="font-display text-2xl text-[#F7931A] tracking-wider uppercase">
                  Groups
                </h1>
                {groups.length > 0 && (
                  <button
                    onClick={() => setView('create')}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] transition-colors"
                  >
                    + New
                  </button>
                )}
              </div>

              {groups.length === 0 ? (
                <EmptyGroups onCreate={() => setView('create')} />
              ) : (
                <div className="space-y-3">
                  {groups.map(group => (
                    <GroupCard
                      key={group.pubkey}
                      group={group}
                      onSelect={() => {
                        setSelectedGroup(group);
                        setView('group');
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Create view ──────────────────────────────────────────────── */}
          {view === 'create' && (
            <GroupCreateFlow
              onComplete={handleGroupCreated}
              onCancel={() => setView('list')}
            />
          )}

          {/* ── Group detail view ─────────────────────────────────────────── */}
          {view === 'group' && selectedGroup && (
            <GroupDetail
              group={selectedGroup}
              currentUserPubkey={MOCK_CURRENT_PUBKEY}
              currentUserRole={currentUserRole}
              onAssignRole={(pubkey) => {
                setAssignRolePubkey(pubkey);
                setView('assign-role');
              }}
              onBack={() => setView('list')}
            />
          )}

          {/* ── Role assignment view ──────────────────────────────────────── */}
          {view === 'assign-role' && selectedGroup && (
            <RoleAssignment
              delegateePubkey={assignRolePubkey || 'new'}
              assignerRole={currentUserRole}
              onAssigned={(delegation) => {
                handleRoleAssigned(delegation);
              }}
              onCancel={() => setView('group')}
            />
          )}
        </div>
      </main>
    </>
  );
}


