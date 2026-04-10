/**
 * Satnam v2 — Agents Page
 * Phase 4: NIP-SA Agent management + Monitoring + Probe tabs
 *
 * Tab navigation: Agents | Skills | Credits | Monitoring | Probe
 *
 * - Agent list (grid of AgentCards)
 * - "Create Agent" button → AgentCreateFlow
 * - Agent detail view (when agent selected)
 * - Monitoring panel (DelegationHealthPanel + PerformanceReportPanel + SessionManagerPanel)
 * - Probe tab (ProbeSessionPanel + ToolCallApproval + SessionDiffRenderer + ExecutionResultPanel)
 * - Skills management
 * - Credits/envelope overview
 */

import { useState, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import clsx from 'clsx';
import {
  Bot,
  BookOpen,
  CreditCard,
  Plus,
  Search,
  Activity,
  Terminal,
} from 'lucide-react';

import { useAgentProfile } from '../hooks/useAgentProfile.js';
import { useSkillManager } from '../hooks/useSkillManager.js';
import { useCreditLifecycle } from '../hooks/useCreditLifecycle.js';

import AgentCard from '../components/agents/AgentCard.js';
import AgentCreateFlow from '../components/agents/AgentCreateFlow.js';
import AgentDetailPanel from '../components/agents/AgentDetailPanel.js';
import AgentMonitoringPanel from '../components/agents/AgentMonitoringPanel.js';
import SkillCard from '../components/skills/SkillCard.js';
import SkillRegistrationForm from '../components/skills/SkillRegistrationForm.js';
import SkillAttestationPanel from '../components/skills/SkillAttestationPanel.js';
import CreditEnvelopePanel from '../components/marketplace/CreditEnvelopePanel.js';

// Phase 4 — Dashboard components
import DelegationHealthPanel from '../components/dashboards/DelegationHealthPanel.js';
import PerformanceReportPanel from '../components/dashboards/PerformanceReportPanel.js';
import SessionManagerPanel from '../components/dashboards/SessionManagerPanel.js';

// Phase 4 — Probe components
import ProbeSessionPanel from '../components/probe/ProbeSessionPanel.js';
import ToolCallApproval from '../components/probe/ToolCallApproval.js';
import SessionDiffRenderer from '../components/probe/SessionDiffRenderer.js';
import ExecutionResultPanel from '../components/probe/ExecutionResultPanel.js';

import type { AgentViewModel } from '../hooks/useAgentProfile.js';
import type { Skill } from '../hooks/useSkillManager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MainTab = 'agents' | 'skills' | 'credits' | 'monitoring' | 'probe';
type AgentView = 'list' | 'create' | 'detail';
type SkillView = 'list' | 'register' | 'attest';

// ---------------------------------------------------------------------------
// Tab navigation — extended for Phase 4
// ---------------------------------------------------------------------------

function TabBar({
  active,
  onChange,
  counts,
}: {
  active: MainTab;
  onChange: (t: MainTab) => void;
  counts: { agents: number; skills: number; credits: number };
}) {
  const tabs: Array<{
    id: MainTab;
    label: string;
    Icon: typeof Bot;
    count?: number;
    highlight?: boolean;
  }> = [
    { id: 'agents',     label: 'Agents',     Icon: Bot,        count: counts.agents  },
    { id: 'skills',     label: 'Skills',     Icon: BookOpen,   count: counts.skills  },
    { id: 'credits',    label: 'Credits',    Icon: CreditCard, count: counts.credits },
    { id: 'monitoring', label: 'Monitoring', Icon: Activity,   highlight: true        },
    { id: 'probe',      label: 'Probe',      Icon: Terminal,   highlight: true        },
  ];

  return (
    <div
      className="flex gap-1 p-1 rounded-xl bg-slate-900 border border-[#2a2a2a] overflow-x-auto"
      role="tablist"
      aria-label="Agents page sections"
    >
      {tabs.map(tab => {
        const isActive = active === tab.id;
        const { Icon } = tab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            onClick={() => onChange(tab.id)}
            className={clsx(
              'flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 whitespace-nowrap min-w-fit',
              isActive
                ? 'bg-[#f7931a] text-black'
                : tab.highlight
                  ? 'text-[#f7931a]/70 hover:text-[#f7931a] hover:bg-[#f7931a]/10'
                  : 'text-[#555555] hover:text-[#a0a0a0] hover:bg-slate-800',
            )}
          >
            <Icon size={14} aria-hidden="true" />
            <span className="hidden sm:inline">{tab.label}</span>
            {tab.count != null && tab.count > 0 && (
              <span className={clsx(
                'text-[10px] px-1.5 py-0.5 rounded-full',
                isActive ? 'bg-black/20' : 'bg-slate-800',
              )}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state for agents
// ---------------------------------------------------------------------------

function EmptyAgents({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="text-center py-16 space-y-6">
      <div className="w-20 h-20 mx-auto rounded-2xl bg-[#f7931a]/10 border border-[#f7931a]/20 flex items-center justify-center">
        <Bot size={36} className="text-[#f7931a]" aria-hidden="true" />
      </div>
      <div>
        <h3 className="heading-display text-xl text-[#f5f5f5] mb-2">No Agents Yet</h3>
        <p className="text-sm text-[#555555] max-w-xs mx-auto">
          Create an agent to automate tasks, manage DVM jobs, and operate autonomously on Nostr.
        </p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#f7931a] text-black font-medium hover:bg-[#e8841a] active:scale-95 transition-all duration-150"
      >
        <Plus size={18} aria-hidden="true" />
        Create First Agent
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agents tab content
// ---------------------------------------------------------------------------

function AgentsTab() {
  const { agents, updateAgent, deactivateAgent, isLoading } = useAgentProfile();
  const [view, setView] = useState<AgentView>('list');
  const [selectedAgent, setSelectedAgent] = useState<AgentViewModel | null>(null);
  const [search, setSearch] = useState('');

  const filtered = search
    ? agents.filter(a =>
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.capabilities.some(c => c.includes(search.toLowerCase()))
      )
    : agents;

  const handlePause = useCallback(async (id: string) => {
    const agent = agents.find(a => a.id === id);
    if (!agent) return;
    const newStatus = agent.status === 'paused' ? 'idle' : 'paused';
    await updateAgent(id, { status: newStatus });
  }, [agents, updateAgent]);

  const handleDeactivate = useCallback(async (id: string) => {
    if (!confirm('Deactivate this agent? This will stop all active tasks.')) return;
    await deactivateAgent(id);
  }, [deactivateAgent]);

  const handleAgentCreated = (_agentId: string) => {
    setView('list');
    // In production: select the newly created agent
  };

  if (view === 'create') {
    return (
      <AgentCreateFlow
        onComplete={handleAgentCreated}
        onCancel={() => setView('list')}
      />
    );
  }

  if (view === 'detail' && selectedAgent) {
    return (
      <div className="space-y-5">
        <AgentDetailPanel
          agent={selectedAgent}
          onBack={() => setView('list')}
          onEdit={() => setView('create')}
        />
        <AgentMonitoringPanel
          agent={selectedAgent}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="heading-display text-xl text-[#f7931a]">Agents</h2>
        {agents.length > 0 && (
          <button
            type="button"
            onClick={() => setView('create')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f7931a] hover:bg-[#e8841a] text-black font-medium text-sm transition-colors"
          >
            <Plus size={15} aria-hidden="true" />
            New Agent
          </button>
        )}
      </div>

      {/* Search + filter */}
      {agents.length > 0 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555555]" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agents…"
            aria-label="Search agents"
            className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-sm focus:outline-none focus:border-[#f7931a] transition-colors"
          />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-48 skeleton rounded-xl" aria-hidden="true" />)}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && agents.length === 0 && (
        <EmptyAgents onCreate={() => setView('create')} />
      )}

      {/* Agent grid */}
      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onSelect={() => {
                setSelectedAgent(agent);
                setView('detail');
              }}
              onPause={handlePause}
              onEdit={() => setView('create')}
              onDeactivate={handleDeactivate}
            />
          ))}
        </div>
      )}

      {/* No search results */}
      {!isLoading && agents.length > 0 && filtered.length === 0 && (
        <div className="text-center py-8">
          <Search size={24} className="mx-auto text-[#555555] mb-2" aria-hidden="true" />
          <p className="text-sm text-[#555555]">No agents match "{search}"</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skills tab content
// ---------------------------------------------------------------------------

function SkillsTab() {
  const { skills, isLoading } = useSkillManager();
  const [view, setView] = useState<SkillView>('list');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [search, setSearch] = useState('');

  const filtered = search
    ? skills.filter(s =>
        s.manifest.name.toLowerCase().includes(search.toLowerCase()) ||
        s.manifest.skillScopeId.toLowerCase().includes(search.toLowerCase()) ||
        (s.manifest.capabilities ?? []).some((c: string) => c.includes(search.toLowerCase()))
      )
    : skills;

  if (view === 'register') {
    return (
      <SkillRegistrationForm
        onComplete={() => setView('list')}
        onCancel={() => setView('list')}
      />
    );
  }

  if (view === 'attest' && selectedSkill) {
    return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => setView('list')}
          className="flex items-center gap-2 text-sm text-[#555555] hover:text-[#a0a0a0] transition-colors"
        >
          ← Back to skills
        </button>
        <SkillCard skill={selectedSkill} />
        <SkillAttestationPanel
          skill={selectedSkill}
          canAttest
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="heading-display text-xl text-[#f7931a]">Skills</h2>
        <button
          type="button"
          onClick={() => setView('register')}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#f7931a] hover:bg-[#e8841a] text-black font-medium text-sm transition-colors"
        >
          <Plus size={15} aria-hidden="true" />
          Register Skill
        </button>
      </div>

      {/* Search */}
      {skills.length > 0 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555555]" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search skills…"
            aria-label="Search skills"
            className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-sm focus:outline-none focus:border-[#f7931a] transition-colors"
          />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-36 skeleton rounded-xl" aria-hidden="true" />)}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && skills.length === 0 && (
        <div className="text-center py-12 space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-600/10 border border-blue-600/20 flex items-center justify-center">
            <BookOpen size={28} className="text-blue-400" aria-hidden="true" />
          </div>
          <div>
            <h3 className="heading-display text-lg text-[#f5f5f5] mb-1">No Skills Registered</h3>
            <p className="text-sm text-[#555555]">Register skills to assign to agents and get attested by Guardians.</p>
          </div>
          <button
            type="button"
            onClick={() => setView('register')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#f7931a] text-black font-medium hover:bg-[#e8841a] transition-colors"
          >
            <Plus size={16} aria-hidden="true" />
            Register First Skill
          </button>
        </div>
      )}

      {/* Skill grid */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map(skill => (
            <SkillCard
              key={skill.manifest.manifestEventId}
              skill={skill.manifest}
              onAttest={id => {
                const s = skills.find(sk => sk.manifest.manifestEventId === id);
                if (s) { setSelectedSkill(s.manifest); setView('attest'); }
              }}
              onViewDetails={id => {
                const s = skills.find(sk => sk.manifest.manifestEventId === id);
                if (s) { setSelectedSkill(s.manifest); setView('attest'); }
              }}
              showAttestButton
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Credits tab content
// ---------------------------------------------------------------------------

function CreditsTab() {
  const { envelopes, isLoading } = useCreditLifecycle(null, null, null);

  // Summary stats
  const totalCommitted = envelopes.reduce((s, e) => s + e.maxSats, 0);
  const totalSpent = envelopes.reduce((s, _e) => s, 0);
  const activeCount = envelopes.filter(e => !['Settlement', 'Default'].includes(e.state)).length;

  return (
    <div className="space-y-5">
      <h2 className="heading-display text-xl text-[#f7931a]">Credit Envelopes</h2>

      {/* Summary */}
      {!isLoading && envelopes.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-3 text-center">
            <p className="font-bold text-lg text-[#f7931a]">{activeCount}</p>
            <p className="text-xs text-[#555555]">Active</p>
          </div>
          <div className="card p-3 text-center">
            <p className="font-mono font-bold text-lg text-[#f5f5f5]">{totalCommitted.toLocaleString()}</p>
            <p className="text-xs text-[#555555]">Committed sats</p>
          </div>
          <div className="card p-3 text-center">
            <p className="font-mono font-bold text-lg text-[#f5f5f5]">{totalSpent.toLocaleString()}</p>
            <p className="text-xs text-[#555555]">Spent sats</p>
          </div>
        </div>
      )}

      <CreditEnvelopePanel />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monitoring tab — Phase 4
// ---------------------------------------------------------------------------

function MonitoringTab() {
  const { agents } = useAgentProfile();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(
    agents[0]?.id,
  );

  return (
    <div className="space-y-6">
      {/* Agent selector (if multiple agents) */}
      {agents.length > 1 && (
        <div>
          <label
            htmlFor="monitoring-agent-select"
            className="block text-xs font-medium text-slate-500 mb-1.5"
          >
            Viewing agent
          </label>
          <select
            id="monitoring-agent-select"
            value={selectedAgentId}
            onChange={e => setSelectedAgentId(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-slate-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#f7931a] transition-colors"
            aria-label="Select agent to monitor"
          >
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Delegation health */}
      <section aria-label="Delegation health">
        <DelegationHealthPanel />
      </section>

      {/* Performance report */}
      <section aria-label="Performance report">
        <PerformanceReportPanel agentId={selectedAgentId} />
      </section>

      {/* Session manager */}
      <section aria-label="Session manager">
        <SessionManagerPanel agentId={selectedAgentId} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Probe tab — Phase 4
// ---------------------------------------------------------------------------

function ProbeTab() {
  // Sample diff for demonstration when no session is active
  const sampleDiff = null;
  const sampleResult = null;

  return (
    <div className="space-y-6">
      {/* Active probe sessions + trajectory */}
      <section aria-label="Probe sessions">
        <ProbeSessionPanel />
      </section>

      {/* Tool call approval queue */}
      <section aria-label="Tool call approvals">
        <ToolCallApproval showAutoApprove />
      </section>

      {/* Diff renderer — shown when a session has produced diffs */}
      {sampleDiff !== null && (
        <section aria-label="Session diff">
          <SessionDiffRenderer files={[]} title="Latest Changes" />
        </section>
      )}

      {/* Execution result — shown when a session completes */}
      {sampleResult !== null && (
        <section aria-label="Execution result">
          <ExecutionResultPanel
            result={{
              exit_code: 0,
              stdout: '',
              stderr: '',
            }}
          />
        </section>
      )}

      {/* Info: no active session */}
      {sampleDiff === null && sampleResult === null && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-3">
          <p className="text-xs text-slate-500">
            Diffs and execution results will appear here once a Probe session completes a tool call.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AgentsPage() {
  const { agents } = useAgentProfile();
  const { skills } = useSkillManager();
  const { envelopes } = useCreditLifecycle(null, null, null);
  const [activeTab, setActiveTab] = useState<MainTab>('agents');

  const counts = {
    agents: agents.length,
    skills: skills.length,
    credits: envelopes.filter(e => !['Settlement', 'Default'].includes(e.state)).length,
  };

  return (
    <>
      <Helmet>
        <title>Satnam — Agents</title>
        <meta name="description" content="NIP-SA autonomous agent management. Create, monitor, and control agents." />
      </Helmet>

      <main className="min-h-screen bg-[#0a0a0a] pb-safe">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
          {/* Page header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#f7931a]/10 border border-[#f7931a]/20 flex items-center justify-center">
              <Bot size={20} className="text-[#f7931a]" aria-hidden="true" />
            </div>
            <div>
              <h1 className="heading-display text-2xl text-[#f7931a]">Agents</h1>
              <p className="text-xs text-[#555555]">NIP-SA autonomous agent management</p>
            </div>
          </div>

          {/* Tab navigation */}
          <TabBar active={activeTab} onChange={setActiveTab} counts={counts} />

          {/* Tab content */}
          <div
            id={`tabpanel-${activeTab}`}
            role="tabpanel"
            aria-label={activeTab}
            tabIndex={0}
          >
            {activeTab === 'agents'     && <AgentsTab />}
            {activeTab === 'skills'     && <SkillsTab />}
            {activeTab === 'credits'    && <CreditsTab />}
            {activeTab === 'monitoring' && <MonitoringTab />}
            {activeTab === 'probe'      && <ProbeTab />}
          </div>
        </div>
      </main>
    </>
  );
}


