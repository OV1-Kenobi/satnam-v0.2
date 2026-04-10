/**
 * Satnam v2 — Home Page (Dashboard)
 * Phase 5: Dashboard overview + SystemStatusPanel + Multi-rail balance summary
 *
 * Overview cards:
 * - Active agents count + status
 * - Multi-rail wallet balance summary (Lightning + Cashu + LNbits)  ← NEW
 * - Recent marketplace activity
 * - Group membership
 * - System status (Phase 4: full SystemStatusPanel)
 *
 * Quick action buttons:
 * - Create agent
 * - Submit job
 * - Send payment
 */

import { Helmet } from 'react-helmet-async';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  Bot,
  Store,
  Users,
  Plus,
  Zap,
  Send,
  Activity,
  Shield,
  ChevronRight,
  Coins,
  Server,
  ArrowLeftRight,
  TrendingUp,
} from 'lucide-react';

import { useCircleOfTrust } from '../hooks/useCircleOfTrust.js';
import NoteToSelfPanel from '../components/note-to-self/NoteToSelfPanel.js';

import { useAgentProfile } from '../hooks/useAgentProfile.js';
import { useMarketplace } from '../hooks/useMarketplace.js';
import { useCreditLifecycle } from '../hooks/useCreditLifecycle.js';
import { useNwc } from '../hooks/useNwc.js';
import { useFrost } from '../hooks/useFrost.js';

// Phase 4 — System status panel
import SystemStatusPanel from '../components/dashboards/SystemStatusPanel.js';

// Phase 5 — Rail health indicator (compact mode)
import RailHealthIndicator from '../components/payments/RailHealthIndicator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Overview stat card
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  sub = '',
  href,
  color = '#f7931a',
}: {
  icon: typeof Bot;
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  href?: string;
  color?: string;
}) {
  const content = (
    <div
      className={clsx(
        'card flex items-center gap-4 transition-all duration-150',
        href && 'cursor-pointer hover:border-[#f7931a]/40 active:scale-[0.99]',
      )}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${color}15`, borderColor: `${color}25`, border: '1px solid' }}
      >
        <Icon size={22} style={{ color }} aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-[#555555] uppercase tracking-widest">{label}</p>
        <p className="font-mono text-xl font-bold text-[#f5f5f5] mt-0.5">{value}</p>
        {sub && <p className="text-xs text-[#555555] mt-0.5">{sub}</p>}
      </div>
      {href && <ChevronRight size={16} className="text-[#555555] flex-shrink-0" aria-hidden="true" />}
    </div>
  );

  if (href) {
    return <Link to={href} aria-label={`Go to ${label}`}>{content}</Link>;
  }
  return content;
}

// ---------------------------------------------------------------------------
// Multi-rail balance summary card  ← NEW (Phase 5)
// ---------------------------------------------------------------------------

interface RailBalance {
  label: string;
  color: string;
  icon: typeof Zap;
  balanceSats: number;
  subLabel: string;
}

function MultiRailBalanceSummary({ totalNwcMsats }: { totalNwcMsats: bigint }) {
  const nwcSats = Math.floor(Number(totalNwcMsats) / 1000);

  // Mock Cashu + LNbits balances (Phase 5: replace with real hooks when available)
  const rails: RailBalance[] = [
    {
      label: 'Lightning',
      color: '#f7931a',
      icon: Zap,
      balanceSats: nwcSats,
      subLabel: 'NWC wallet',
    },
    {
      label: 'Cashu',
      color: '#a855f7',
      icon: Coins,
      balanceSats: 5030,
      subLabel: '2 mints',
    },
    {
      label: 'LNbits',
      color: '#22c55e',
      icon: Server,
      balanceSats: 12500,
      subLabel: 'LNbits wallet',
    },
  ];

  const totalSats = rails.reduce((s, r) => s + r.balanceSats, 0);

  return (
    <Link
      to="/wallet"
      className="block card hover:border-[#f7931a]/40 transition-all duration-150 active:scale-[0.99] no-underline"
      aria-label={`Financial summary: ${totalSats.toLocaleString()} sats total across all rails`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={15} className="text-[#f7931a]" aria-hidden="true" />
          <p className="text-xs text-[#555555] uppercase tracking-widest">Financial Health</p>
        </div>
        <ChevronRight size={14} className="text-[#555555]" aria-hidden="true" />
      </div>

      {/* Total */}
      <div className="mb-4">
        <p className="font-mono text-2xl font-bold text-[#f5f5f5]">
          {totalSats.toLocaleString()}
          <span className="text-sm text-[#555555] ml-2">sats</span>
        </p>
        <p className="text-xs text-[#555555] mt-0.5">
          across {rails.length} rails · ≈ {(totalSats / 100_000_000).toFixed(6)} BTC
        </p>
      </div>

      {/* Per-rail bars */}
      <div className="space-y-2.5" role="list" aria-label="Balance by rail">
        {rails.map((rail) => {
          const pct = totalSats > 0 ? (rail.balanceSats / totalSats) * 100 : 0;
          return (
            <div key={rail.label} role="listitem">
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-1.5">
                  <rail.icon size={11} style={{ color: rail.color }} aria-hidden="true" />
                  <span className="text-[#a0a0a0]">{rail.label}</span>
                  <span className="text-[#555555]">({rail.subLabel})</span>
                </div>
                <span className="font-mono font-medium" style={{ color: rail.color }}>
                  {rail.balanceSats.toLocaleString()}
                </span>
              </div>
              <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.max(2, pct)}%`,
                    backgroundColor: rail.color,
                    opacity: 0.7,
                  }}
                  aria-label={`${rail.label}: ${pct.toFixed(1)}%`}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Rail health pills */}
      <div className="mt-3 pt-3 border-t border-[#2a2a2a]">
        <RailHealthIndicator compact />
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Quick action button
// ---------------------------------------------------------------------------

function QuickAction({
  icon: Icon,
  label,
  description,
  onClick,
  primary = false,
}: {
  icon: typeof Plus;
  label: string;
  description?: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={clsx(
        'flex items-center gap-3 w-full px-4 py-3 rounded-xl border text-left transition-all duration-150 active:scale-[0.99]',
        primary
          ? 'bg-[#f7931a]/10 border-[#f7931a]/30 hover:bg-[#f7931a]/20'
          : 'bg-[#1a1a1a] border-[#2a2a2a] hover:border-[#3a3a3a]',
      )}
    >
      <div className={clsx(
        'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
        primary ? 'bg-[#f7931a]/20 text-[#f7931a]' : 'bg-slate-800 text-[#a0a0a0]',
      )}>
        <Icon size={18} aria-hidden="true" />
      </div>
      <div>
        <p className={clsx('font-medium text-sm', primary ? 'text-[#f7931a]' : 'text-[#f5f5f5]')}>{label}</p>
        {description && <p className="text-xs text-[#555555]">{description}</p>}
      </div>
      <ChevronRight size={14} className="text-[#555555] ml-auto" aria-hidden="true" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Recent activity item
// ---------------------------------------------------------------------------

function ActivityItem({
  icon: Icon,
  text,
  time,
  color = 'text-[#555555]',
}: {
  icon: typeof Activity;
  text: string;
  time: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={clsx('w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center flex-shrink-0', color)}>
        <Icon size={13} aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#a0a0a0] truncate">{text}</p>
      </div>
      <span className="text-xs text-[#555555] flex-shrink-0">{time}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Circle of Trust summary card
// ---------------------------------------------------------------------------

function CircleOfTrustSummaryCard() {
  const { stats } = useCircleOfTrust();

  return (
    <div>
      <h2 className="text-xs font-medium text-[#555555] uppercase tracking-widest mb-3">Circle of Trust</h2>
      <Link
        to="/circle"
        className="card flex items-center gap-4 hover:border-[#ffd700]/40 transition-all duration-150 active:scale-[0.99] no-underline"
        aria-label="Go to Circle of Trust"
      >
        <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#ffd70015', border: '1px solid #ffd70025' }}>
          <Shield size={22} style={{ color: '#ffd700' }} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <p className="font-mono text-xl font-bold text-[#f5f5f5]">{stats.totalContacts}</p>
            <span className="text-xs text-[#555555]">
              {stats.highTrustContacts > 0 && (
                <span className="text-[#ffd700]">{stats.highTrustContacts} high</span>
              )}
              {stats.mediumTrustContacts > 0 && (
                <span className="text-[#f7931a]"> {stats.mediumTrustContacts} medium</span>
              )}
              {stats.newContacts > 0 && (
                <span className="text-[#3b82f6]"> {stats.newContacts} new</span>
              )}
              {stats.totalContacts === 0 && <span>No contacts yet</span>}
            </span>
          </div>
          <p className="text-xs text-[#555555] mt-0.5">
            {stats.totalContacts === 0
              ? 'Complete a PoL ceremony to add trusted contacts'
              : `${stats.totalMeetings} PoL meetings · avg score ${Math.round(stats.avgTrustScore)}`
            }
          </p>
        </div>
        <ChevronRight size={16} className="text-[#555555] flex-shrink-0" aria-hidden="true" />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const navigate = useNavigate();

  // Hooks (data may be empty — hooks handle their own loading states)
  const { agents } = useAgentProfile();
  const { activeJobs, providers } = useMarketplace([]);
  const { envelopes } = useCreditLifecycle();
  const { balance } = useNwc();
  const { groups } = useFrost();

  // Derived stats
  const activeAgents = agents.filter((a) => a.status === 'working').length;
  const totalAgents = agents.length;
  const pendingJobs = activeJobs.filter((j) => !j.result).length;
  const activeEnvelopes = envelopes.filter((e) => !['Settlement', 'Default'].includes(e.state)).length;
  const nwcMsats = balance ?? 84_000_000n; // fallback for display

  // Recent combined activity (mock until real event stream)
  const recentActivity = [
    ...(agents.length > 0 ? [{ Icon: Bot, text: `Agent "${agents[0].name}" is ${agents[0].status}`, time: '2m ago', color: 'text-green-500' }] : []),
    ...(activeJobs.length > 0 ? [{ Icon: Store, text: `Job ${activeJobs[0].requestEventId.slice(0, 8)} — ${activeJobs[0].result ? 'completed' : 'pending'}`, time: '5m ago', color: 'text-blue-400' }] : []),
    ...(groups.length > 0 ? [{ Icon: Shield, text: `Group "${groups[0].metadata.name}" active`, time: '1h ago', color: 'text-[#ffd700]' }] : []),
  ];

  return (
    <>
      <Helmet>
        <title>Satnam — Dashboard</title>
        <meta name="description" content="Satnam v2 sovereign identity, agent, and marketplace dashboard." />
      </Helmet>

      <main className="min-h-screen bg-[#0a0a0a] pb-safe">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
          {/* Header */}
          <div>
            <h1 className="heading-display text-3xl text-[#f7931a] tracking-wider">Dashboard</h1>
            <p className="text-sm text-[#555555] mt-1">Your sovereign identity at a glance</p>
          </div>

          {/* ----------------------------------------------------------------
              Phase 5 — Multi-rail balance summary card
              Replaces the single Lightning balance card with a full
              multi-rail financial health overview including Cashu + LNbits.
          ---------------------------------------------------------------- */}
          <section aria-label="Multi-rail financial summary">
            <h2 className="text-xs font-medium text-[#555555] uppercase tracking-widest mb-3">Financial Health</h2>
            <MultiRailBalanceSummary totalNwcMsats={nwcMsats} />
          </section>

          {/* Overview stats */}
          <section aria-label="Overview statistics">
            <h2 className="text-xs font-medium text-[#555555] uppercase tracking-widest mb-3">Overview</h2>
            <div className="grid grid-cols-1 gap-3">
              {/* Agents */}
              <StatCard
                icon={Bot}
                label="Agents"
                value={totalAgents}
                sub={activeAgents > 0 ? `${activeAgents} active` : 'None active'}
                href="/agents"
                color="#f7931a"
              />

              {/* Marketplace */}
              <StatCard
                icon={Store}
                label="Marketplace"
                value={pendingJobs}
                sub={`${providers.length} providers · ${activeEnvelopes} open envelopes`}
                href="/marketplace"
                color="#3b82f6"
              />

              {/* Groups */}
              <StatCard
                icon={Users}
                label="Groups"
                value={groups.length}
                sub={groups.length === 0 ? 'No groups yet' : `${groups.length} FROST group${groups.length !== 1 ? 's' : ''}`}
                href="/groups"
                color="#22c55e"
              />
            </div>
          </section>

          {/* Circle of Trust summary card */}
          <section aria-label="Circle of Trust summary">
            <CircleOfTrustSummaryCard />
          </section>

          {/* Note to Self quick access */}
          <section aria-label="Note to self">
            <h2 className="text-xs font-medium text-[#555555] uppercase tracking-widest mb-3">Note to Self</h2>
            <div className="card">
              <NoteToSelfPanel compact />
            </div>
          </section>

          {/* Quick actions */}
          <section aria-label="Quick actions">
            <h2 className="text-xs font-medium text-[#555555] uppercase tracking-widest mb-3">Quick Actions</h2>
            <div className="space-y-2">
              <QuickAction
                icon={Plus}
                label="Create Agent"
                description="Deploy a new autonomous NIP-SA agent"
                onClick={() => navigate('/agents')}
                primary
              />
              <QuickAction
                icon={Zap}
                label="Submit Job"
                description="Send a task to a NIP-90 DVM provider"
                onClick={() => navigate('/marketplace')}
              />
              <QuickAction
                icon={Send}
                label="Send Payment"
                description="Pay via Lightning or Cashu"
                onClick={() => navigate('/wallet')}
              />
              <QuickAction
                icon={ArrowLeftRight}
                label="Swap Rails"
                description="Move sats between Lightning, Cashu, and LNbits"
                onClick={() => navigate('/wallet?tab=swaps')}
              />
              <QuickAction
                icon={Users}
                label="Manage Groups"
                description="FROST threshold groups and delegation"
                onClick={() => navigate('/groups')}
              />
            </div>
          </section>

          {/* Recent activity */}
          <section aria-label="Recent activity">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-medium text-[#555555] uppercase tracking-widest">Recent Activity</h2>
              <Link to="/agents" className="text-xs text-[#f7931a] hover:underline no-underline">
                View all
              </Link>
            </div>

            <div className="card space-y-3">
              {recentActivity.length > 0 ? (
                recentActivity.map((item, i) => (
                  <ActivityItem key={i} icon={item.Icon} text={item.text} time={item.time} color={item.color} />
                ))
              ) : (
                <div className="text-center py-4">
                  <Activity size={24} className="mx-auto text-[#555555] mb-2" aria-hidden="true" />
                  <p className="text-sm text-[#555555]">No recent activity</p>
                  <p className="text-xs text-[#555555] mt-0.5">Create an agent or submit a job to get started</p>
                </div>
              )}
            </div>
          </section>

          {/* ----------------------------------------------------------------
              Phase 4: SystemStatusPanel — replaces the static inline status
              section from Phase 3 with the full dynamic panel.
          ---------------------------------------------------------------- */}
          <section aria-label="System status">
            <h2 className="text-xs font-medium text-[#555555] uppercase tracking-widest mb-3">System Status</h2>
            <SystemStatusPanel compact />
          </section>
        </div>
      </main>
    </>
  );
}

