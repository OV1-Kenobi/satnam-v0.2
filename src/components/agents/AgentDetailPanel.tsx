/**
 * AgentDetailPanel — Full agent detail view
 * Phase 3: NIP-SA agent management
 *
 * Sections:
 * - Profile (all NIP-SA fields)
 * - Wallet (balance, spend policy)
 * - Skills (enabled skills with attestation status)
 * - Credits (active envelopes, spend authorizations)
 * - Activity (recent state updates, tasks)
 * - Delegation (governor, group membership, role)
 */

import { useState } from 'react';
import clsx from 'clsx';
import {
  ArrowLeft,
  User,
  Wallet,
  BookOpen,
  CreditCard,
  Activity,
  Users,
  Copy,
  CheckCheck,
} from 'lucide-react';
import type { AgentViewModel } from '../../hooks/useAgentProfile.js';
import { useCreditLifecycle } from '../../hooks/useCreditLifecycle.js';
import { useSkillManager } from '../../hooks/useSkillManager.js';
import SpendPolicyEditor from './SpendPolicyEditor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentDetailPanelProps {
  agent: AgentViewModel;
  onBack: () => void;
  onEdit?: (id: string) => void;
}

type DetailTab = 'profile' | 'wallet' | 'skills' | 'credits' | 'activity' | 'delegation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSats(sats: number): string {
  return sats.toLocaleString();
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

// ---------------------------------------------------------------------------
// Copy pubkey button
// ---------------------------------------------------------------------------

function CopyPubkey({ pubkey }: { pubkey: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(pubkey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2">
      <code className="pubkey text-xs flex-1 truncate">{pubkey.slice(0, 32)}…</code>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy pubkey"
        className="text-[#555555] hover:text-[#f7931a] transition-colors flex-shrink-0"
      >
        {copied ? <CheckCheck size={14} className="text-green-500" /> : <Copy size={14} />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------

const TABS: Array<{ id: DetailTab; label: string; Icon: typeof User }> = [
  { id: 'profile', label: 'Profile', Icon: User },
  { id: 'wallet', label: 'Wallet', Icon: Wallet },
  { id: 'skills', label: 'Skills', Icon: BookOpen },
  { id: 'credits', label: 'Credits', Icon: CreditCard },
  { id: 'activity', label: 'Activity', Icon: Activity },
  { id: 'delegation', label: 'Delegation', Icon: Users },
];

// ---------------------------------------------------------------------------
// Profile tab
// ---------------------------------------------------------------------------

function ProfileTab({ agent }: { agent: AgentViewModel }) {
  const statusColor: Record<AgentViewModel['status'], string> = {
    working: 'text-green-500',
    idle: 'text-slate-400',
    paused: 'text-yellow-500',
    error: 'text-red-500',
    terminated: 'text-slate-600',
  };

  return (
    <div className="space-y-4">
      {/* Avatar + Identity */}
      <div className="flex items-center gap-4">
        {agent.picture ? (
          <img
            src={agent.picture}
            alt={agent.name}
            className="w-16 h-16 rounded-full object-cover border border-[#2a2a2a]"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-[#f7931a]/20 border border-[#f7931a]/30 flex items-center justify-center">
            <User size={28} className="text-[#f7931a]" />
          </div>
        )}
        <div>
          <h2 className="heading-display text-lg text-[#f7931a]">{agent.name}</h2>
          {agent.about && <p className="text-sm text-[#a0a0a0] mt-0.5">{agent.about}</p>}
        </div>
      </div>

      {/* Fields */}
      <div className="space-y-3">
        <div className="flex justify-between py-2 border-b border-[#2a2a2a] text-sm">
          <span className="text-[#555555]">Status</span>
          <span className={clsx('font-medium capitalize', statusColor[agent.status])}>{agent.status}</span>
        </div>
        <div className="flex justify-between py-2 border-b border-[#2a2a2a] text-sm">
          <span className="text-[#555555]">Autonomy</span>
          <span className="font-medium text-[#f5f5f5] capitalize">{agent.autonomy}</span>
        </div>
        <div className="py-2 border-b border-[#2a2a2a] text-sm">
          <p className="text-[#555555] mb-1">Pubkey</p>
          <CopyPubkey pubkey={agent.pubkey} />
        </div>
        <div className="flex justify-between py-2 border-b border-[#2a2a2a] text-sm">
          <span className="text-[#555555]">Created</span>
          <span className="text-[#a0a0a0]">{formatTimestamp(agent.createdAt)}</span>
        </div>
        <div className="py-2 text-sm">
          <p className="text-[#555555] mb-2">Capabilities</p>
          <div className="flex flex-wrap gap-1">
            {agent.capabilities.map(cap => (
              <span key={cap} className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs">
                {cap}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wallet tab
// ---------------------------------------------------------------------------

function WalletTab({ agent }: { agent: AgentViewModel }) {
  return (
    <div className="space-y-5">
      {/* Balance summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#1a1a1a] rounded-xl p-4 border border-[#2a2a2a]">
          <p className="text-xs text-[#555555] uppercase tracking-widest mb-1">Balance</p>
          <p className="font-mono text-xl font-bold text-[#f7931a]">{formatSats(agent.balanceSats)}</p>
          <p className="text-xs text-[#555555]">sats</p>
        </div>
        <div className="bg-[#1a1a1a] rounded-xl p-4 border border-[#2a2a2a]">
          <p className="text-xs text-[#555555] uppercase tracking-widest mb-1">Today's Spend</p>
          <p className="font-mono text-xl font-bold text-[#f5f5f5]">{formatSats(agent.dailySpendSats)}</p>
          <p className="text-xs text-[#555555]">sats</p>
        </div>
      </div>

      {/* Spend policy */}
      <div>
        <p className="text-xs text-[#555555] uppercase tracking-widest mb-3">Spend Policy</p>
        <SpendPolicyEditor
          value={agent.spendPolicy}
          onChange={() => {}} // read-only view
          disabled
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skills tab
// ---------------------------------------------------------------------------

function SkillsTab({ agent }: { agent: AgentViewModel }) {
  const { skills } = useSkillManager();
  const agentSkills = skills.filter(s => agent.skills.includes(s.manifest.manifestEventId));

  const tierColors: Record<string, string> = {
    tier1: 'bg-slate-600',
    tier2: 'bg-blue-600',
    tier3: 'bg-[#f7931a]',
    tier4: 'bg-[#ffd700] text-slate-900',
  };

  if (agent.skills.length === 0) {
    return (
      <div className="text-center py-8">
        <BookOpen size={32} className="mx-auto text-[#555555] mb-3" />
        <p className="text-sm text-[#555555]">No skills assigned to this agent.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {agentSkills.length > 0 ? agentSkills.map(skill => {
        const topAttestation = skill.attestations
          /* revoked field not on GuardianAttestation — all attestations shown */
          .sort((a, b) => Number((b.tier ?? 'tier0').replace('tier', '')) - Number((a.tier ?? 'tier0').replace('tier', '')))[0];

        return (
          <div key={skill.manifest.manifestEventId} className="flex items-start gap-3 px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm text-[#f5f5f5] truncate">{skill.manifest.name}</p>
                {topAttestation?.tier && (
                  <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-bold text-white', tierColors[topAttestation.tier] ?? 'bg-slate-600')}>
                    {topAttestation.tier.toUpperCase()}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#555555]">v{skill.manifest.version} · {skill.attestations.length} attestations</p>
            </div>
          </div>
        );
      }) : (
        // Skills assigned by ID but not yet registered in local state
        agent.skills.map(skillId => (
          <div key={skillId} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
            <p className="font-mono text-xs text-[#555555] truncate">{skillId}</p>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Credits tab
// ---------------------------------------------------------------------------

function CreditsTab({ agent }: { agent: AgentViewModel }) {
  const { envelopes, isLoading } = useCreditLifecycle(null, null, null);
  const agentEnvelopes = envelopes.filter(e => e.agentPubkey === agent.pubkey);

  const stateColors: Record<string, string> = {
    Intent: 'bg-slate-600',
    Offer: 'bg-blue-600',
    Envelope: 'bg-[#f7931a]',
    SpendAuth: 'bg-yellow-600',
    Settlement: 'bg-green-600',
    Default: 'bg-red-600',
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map(i => <div key={i} className="h-16 skeleton rounded-lg" />)}
      </div>
    );
  }

  if (agentEnvelopes.length === 0) {
    return (
      <div className="text-center py-8">
        <CreditCard size={32} className="mx-auto text-[#555555] mb-3" />
        <p className="text-sm text-[#555555]">No active credit envelopes.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {agentEnvelopes.map(env => (
        <div key={env.eventId} className="px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
          <div className="flex items-center gap-2 mb-2">
            <span className={clsx('px-2 py-0.5 rounded-full text-xs font-bold text-white', stateColors[env.state] ?? 'bg-slate-600')}>
              {env.state}
            </span>
            <span className="font-mono text-xs text-[#555555] truncate">{env.eventId.slice(0, 16)}…</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#555555]">Budget</span>
            <span className="font-mono text-[#f5f5f5]">{formatSats(env.maxSats)} sats</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#555555]">Expires</span>
            <span className="font-mono text-[#f5f5f5]">{formatTimestamp(env.expiresAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity tab
// ---------------------------------------------------------------------------

function ActivityTab({ agent }: { agent: AgentViewModel }) {
  const mockActivity = [
    { ts: Date.now() / 1000 - 120, msg: 'Heartbeat received' },
    { ts: Date.now() / 1000 - 300, msg: 'Task completed: summarization job' },
    { ts: Date.now() / 1000 - 900, msg: 'Spend authorization issued (1,500 sats)' },
    { ts: Date.now() / 1000 - 1800, msg: 'Agent activated' },
  ];

  return (
    <div className="space-y-2">
      {mockActivity.map((item, i) => (
        <div key={i} className="flex gap-3 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
          <span className="text-xs text-[#555555] flex-shrink-0 mt-0.5">{formatTimestamp(item.ts)}</span>
          <span className="text-sm text-[#a0a0a0]">{item.msg}</span>
        </div>
      ))}
      {agent.errorLog && agent.errorLog.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-red-400 uppercase tracking-widest mb-2">Error Log</p>
          {agent.errorLog.map((err, i) => (
            <div key={i} className="px-3 py-2 rounded-lg bg-red-900/10 border border-red-900/30 text-xs text-red-400 mb-1">
              {err}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delegation tab
// ---------------------------------------------------------------------------

function DelegationTab({ agent }: { agent: AgentViewModel }) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex justify-between py-2 border-b border-[#2a2a2a] text-sm">
          <span className="text-[#555555]">Governor</span>
          {agent.governorPubkey ? (
            <code className="font-mono text-xs text-[#a0a0a0]">{agent.governorPubkey.slice(0, 16)}…</code>
          ) : (
            <span className="text-[#555555] text-xs">None set</span>
          )}
        </div>
        <div className="flex justify-between py-2 border-b border-[#2a2a2a] text-sm">
          <span className="text-[#555555]">Group</span>
          {agent.groupPubkey ? (
            <code className="font-mono text-xs text-[#a0a0a0]">{agent.groupPubkey.slice(0, 16)}…</code>
          ) : (
            <span className="text-[#555555] text-xs">None set</span>
          )}
        </div>
        <div className="flex justify-between py-2 text-sm">
          <span className="text-[#555555]">Coordination Relays</span>
          <span className="text-[#a0a0a0]">{agent.relays.length}</span>
        </div>
      </div>

      {agent.relays.length > 0 && (
        <div>
          <p className="text-xs text-[#555555] uppercase tracking-widest mb-2">Relays</p>
          <ul className="space-y-1">
            {agent.relays.map(relay => (
              <li key={relay} className="font-mono text-xs text-[#a0a0a0] px-3 py-1.5 rounded bg-[#1a1a1a] border border-[#2a2a2a] truncate">
                {relay}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function AgentDetailPanel({ agent, onBack, onEdit }: AgentDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('profile');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to agents list"
          className="p-2 rounded-lg border border-[#2a2a2a] text-[#555555] hover:text-[#a0a0a0] hover:border-[#3a3a3a] transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="heading-display text-xl text-[#f7931a] truncate">{agent.name}</h1>
          <p className="text-xs text-[#555555]">Agent Detail</p>
        </div>
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(agent.id)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide" role="tablist" aria-label="Agent detail sections">
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          const { Icon } = tab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`tab-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0',
                isActive
                  ? 'bg-[#f7931a] text-black'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200',
              )}
            >
              <Icon size={12} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div id={`tab-panel-${activeTab}`} role="tabpanel" aria-label={activeTab}>
        {activeTab === 'profile' && <ProfileTab agent={agent} />}
        {activeTab === 'wallet' && <WalletTab agent={agent} />}
        {activeTab === 'skills' && <SkillsTab agent={agent} />}
        {activeTab === 'credits' && <CreditsTab agent={agent} />}
        {activeTab === 'activity' && <ActivityTab agent={agent} />}
        {activeTab === 'delegation' && <DelegationTab agent={agent} />}
      </div>
    </div>
  );
}


