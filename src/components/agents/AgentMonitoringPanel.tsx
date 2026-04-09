/**
 * AgentMonitoringPanel — Real-time agent monitoring
 * Phase 3: NIP-SA agent monitoring
 *
 * Displays:
 * - Heartbeat indicator (green/yellow/red)
 * - Task completion rate
 * - Spend rate (sats/hour, sats/day)
 * - Error log
 * - Performance metrics bar chart (CSS only)
 */

import { useState, useEffect } from 'react';
import clsx from 'clsx';
import {
  Heart,
  CheckCircle2,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Clock,
} from 'lucide-react';
import type { AgentViewModel } from '../../hooks/useAgentProfile.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentMonitoringPanelProps {
  agent: AgentViewModel;
  onRefresh?: () => void;
}

interface MetricBar {
  label: string;
  value: number;
  max: number;
  color: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSats(sats: number): string {
  return sats.toLocaleString();
}

function getHeartbeatStatus(lastHeartbeat?: number): {
  label: string;
  color: string;
  dotColor: string;
  secondsAgo: number;
} {
  if (!lastHeartbeat) {
    return { label: 'No heartbeat', color: 'text-slate-500', dotColor: 'bg-slate-600', secondsAgo: Infinity };
  }
  const diff = Date.now() / 1000 - lastHeartbeat;
  if (diff < 60) return { label: 'Healthy', color: 'text-green-500', dotColor: 'bg-green-500', secondsAgo: diff };
  if (diff < 300) return { label: 'Delayed', color: 'text-yellow-500', dotColor: 'bg-yellow-500', secondsAgo: diff };
  return { label: 'Offline', color: 'text-red-500', dotColor: 'bg-red-500', secondsAgo: diff };
}

function formatElapsed(seconds: number): string {
  if (!isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

// ---------------------------------------------------------------------------
// Heartbeat indicator
// ---------------------------------------------------------------------------

function HeartbeatIndicator({ lastHeartbeat }: { lastHeartbeat?: number }) {
  const status = getHeartbeatStatus(lastHeartbeat);

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
      <div className="relative flex-shrink-0">
        <Heart
          size={24}
          className={clsx(status.color, status.secondsAgo < 60 && 'animate-pulse-slow')}
        />
        <span
          className={clsx(
            'absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#1a1a1a]',
            status.dotColor,
          )}
          aria-hidden="true"
        />
      </div>
      <div>
        <p className={clsx('font-medium text-sm', status.color)}>{status.label}</p>
        <p className="text-xs text-[#555555]">
          Last heartbeat: {formatElapsed(status.secondsAgo)}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------

function MetricCard({
  icon: Icon,
  label,
  value,
  unit,
  color = 'text-[#f7931a]',
}: {
  icon: typeof Heart;
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
}) {
  return (
    <div className="px-4 py-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} className="text-[#555555]" />
        <span className="text-[10px] text-[#555555] uppercase tracking-widest">{label}</span>
      </div>
      <p className={clsx('font-mono text-lg font-bold', color)}>
        {value}
        {unit && <span className="text-xs text-[#555555] ml-1">{unit}</span>}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSS bar chart
// ---------------------------------------------------------------------------

function BarChart({ bars, title }: { bars: MetricBar[]; title: string }) {
  return (
    <div>
      <p className="text-xs text-[#555555] uppercase tracking-widest mb-3">{title}</p>
      <div className="space-y-2" role="img" aria-label={`Bar chart: ${title}`}>
        {bars.map(bar => {
          const pct = bar.max > 0 ? Math.min(100, (bar.value / bar.max) * 100) : 0;
          return (
            <div key={bar.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[#a0a0a0]">{bar.label}</span>
                <span className="font-mono text-xs text-[#f5f5f5]">{bar.value.toLocaleString()}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className={clsx('h-full rounded-full transition-all duration-500', bar.color)}
                  style={{ width: `${pct}%` }}
                  aria-valuenow={bar.value}
                  aria-valuemax={bar.max}
                  role="progressbar"
                  aria-label={bar.label}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function AgentMonitoringPanel({ agent, onRefresh }: AgentMonitoringPanelProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Update clock every 10s for heartbeat freshness
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefresh?.();
    setTimeout(() => setRefreshing(false), 1000);
  };

  // Mock metrics (in production these come from relay events)
  const dailyLimitSats = Number(agent.spendPolicy.daily_limit_msats) / 1000;
  const spendRateHour = Math.round(agent.dailySpendSats / 24);

  const taskBars: MetricBar[] = [
    { label: 'Completed today', value: 12, max: 50, color: 'bg-green-600' },
    { label: 'In progress', value: 2, max: 10, color: 'bg-[#f7931a]' },
    { label: 'Failed', value: 1, max: 10, color: 'bg-red-600' },
  ];

  const spendBars: MetricBar[] = [
    { label: 'Daily spend', value: agent.dailySpendSats, max: dailyLimitSats, color: 'bg-[#f7931a]' },
    { label: 'Limit', value: dailyLimitSats, max: dailyLimitSats, color: 'bg-slate-600' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-[#555555] uppercase tracking-widest">Monitoring</h3>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh monitoring data"
          className="p-1.5 rounded-lg text-[#555555] hover:text-[#a0a0a0] hover:bg-slate-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={clsx(refreshing && 'animate-spin')} />
        </button>
      </div>

      {/* Heartbeat */}
      <HeartbeatIndicator lastHeartbeat={agent.lastHeartbeat} />

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard
          icon={CheckCircle2}
          label="Tasks today"
          value={12}
          color="text-green-500"
        />
        <MetricCard
          icon={TrendingUp}
          label="Spend/hour"
          value={formatSats(spendRateHour)}
          unit="sats"
          color="text-[#f7931a]"
        />
        <MetricCard
          icon={Clock}
          label="Uptime"
          value="98.5"
          unit="%"
          color="text-blue-400"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Errors"
          value={agent.errorLog?.length ?? 0}
          color={(agent.errorLog?.length ?? 0) > 0 ? 'text-red-500' : 'text-slate-500'}
        />
      </div>

      {/* Task bar chart */}
      <div className="card">
        <BarChart bars={taskBars} title="Task Performance" />
      </div>

      {/* Spend bar chart */}
      <div className="card">
        <BarChart bars={spendBars} title="Daily Spend vs Limit (sats)" />
      </div>

      {/* Error log */}
      {agent.errorLog && agent.errorLog.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-red-400" />
            <p className="text-xs font-medium text-red-400 uppercase tracking-widest">Error Log</p>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {agent.errorLog.map((err, i) => (
              <div
                key={i}
                className="px-3 py-2 rounded-lg bg-red-900/10 border border-red-900/30 text-xs text-red-400"
                role="alert"
              >
                {err}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

