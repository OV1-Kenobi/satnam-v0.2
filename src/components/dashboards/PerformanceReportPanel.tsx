/**
 * PerformanceReportPanel — Agent performance dashboard
 *
 * Features (CSS-only charts — no chart libraries):
 * - Task completion rate bar chart (flex + div heights)
 * - Success/failure/timeout pie chart (conic-gradient)
 * - Spend efficiency (sats per successful task)
 * - LLM cost breakdown by model
 * - Reputation delta
 *
 * All amounts in sats — no fiat (Axiom 1).
 */

import { useState } from 'react';
import clsx from 'clsx';
import {
  BarChart2,
  CheckCircle2,
  Clock,
  Zap,
  Cpu,
  Star,
  Brain,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

import { useAgentProfile } from '../../hooks/useAgentProfile.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyTaskRate {
  date: string;        // YYYY-MM-DD
  completed: number;
  failed: number;
  total: number;
}

export interface LLMModelCost {
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  sats_cost: number;
}

export interface PerformanceData {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  timedOutTasks: number;
  avgDurationSeconds: number;
  totalSatsSpent: number;
  satsPerSuccessfulTask: number;
  reputationDelta: number;
  dailyRates: DailyTaskRate[];
  llmCosts: LLMModelCost[];
}

// ---------------------------------------------------------------------------
// CSS-only bar chart
// ---------------------------------------------------------------------------

interface BarChartProps {
  data: DailyTaskRate[];
  height?: number;
}

function BarChart({ data, height = 100 }: BarChartProps) {
  const maxTotal = Math.max(...data.map(d => d.total), 1);

  if (data.length === 0) {
    return (
      <div
        className="flex items-end justify-center gap-1"
        style={{ height }}
        role="img"
        aria-label="No data"
      >
        <p className="text-xs text-slate-600 self-center">No data</p>
      </div>
    );
  }

  return (
    <div
      className="flex items-end gap-1"
      style={{ height }}
      role="img"
      aria-label="Task completion rate bar chart"
    >
      {data.map((d, idx) => {
        const completedPct = d.total > 0 ? (d.completed / d.total) * 100 : 0;
        const failedPct    = d.total > 0 ? (d.failed / d.total) * 100 : 0;
        const barHeight    = maxTotal > 0 ? (d.total / maxTotal) * (height - 20) : 0;

        const dateLabel = new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        return (
          <div
            key={idx}
            className="flex flex-col items-center gap-0.5 flex-1 group"
            title={`${dateLabel}: ${d.completed}/${d.total} completed`}
          >
            {/* Stacked bar */}
            <div
              className="w-full rounded-t overflow-hidden flex flex-col-reverse"
              style={{ height: barHeight, minHeight: d.total > 0 ? 2 : 0 }}
              aria-hidden="true"
            >
              {/* Completed (orange) */}
              <div
                className="bg-[#f7931a] w-full transition-all duration-500"
                style={{ height: `${completedPct}%` }}
              />
              {/* Failed (red) */}
              <div
                className="bg-red-500 w-full transition-all duration-500"
                style={{ height: `${failedPct}%` }}
              />
            </div>
            {/* Date label */}
            <span className="text-[8px] text-slate-700 text-center leading-none">
              {dateLabel.split(' ')[1]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSS-only pie chart via conic-gradient
// ---------------------------------------------------------------------------

interface PieChartProps {
  success: number;
  failure: number;
  timeout: number;
  size?: number;
}

function PieChart({ success, failure, timeout, size = 120 }: PieChartProps) {
  const total = success + failure + timeout;
  if (total === 0) {
    return (
      <div
        className="rounded-full bg-slate-800 flex items-center justify-center"
        style={{ width: size, height: size }}
        role="img"
        aria-label="No task data"
      >
        <span className="text-[10px] text-slate-600">No data</span>
      </div>
    );
  }

  const successPct = (success / total) * 100;
  const failPct    = (failure / total) * 100;
  // timeout is the remainder

  // conic-gradient angles
  const successEnd = successPct;
  const failEnd    = successPct + failPct;

  const gradient = `conic-gradient(
    #22c55e 0% ${successEnd}%,
    #ef4444 ${successEnd}% ${failEnd}%,
    #64748b ${failEnd}% 100%
  )`;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        className="rounded-full"
        style={{
          width: size,
          height: size,
          background: gradient,
        }}
        role="img"
        aria-label={`Task outcomes: ${Math.round(successPct)}% success, ${Math.round(failPct)}% failed, ${Math.round(100 - successPct - failPct)}% timeout`}
      />
      {/* Inner circle for donut effect */}
      <div
        className="absolute inset-0 m-auto rounded-full bg-slate-950 flex items-center justify-center"
        style={{ width: size * 0.55, height: size * 0.55 }}
        aria-hidden="true"
      >
        <div className="text-center">
          <p className="text-lg font-bold font-mono text-[#f7931a] leading-none">
            {Math.round(successPct)}%
          </p>
          <p className="text-[9px] text-slate-600">success</p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LLM Cost breakdown
// ---------------------------------------------------------------------------

function LLMCostRow({ cost, maxSats }: { cost: LLMModelCost; maxSats: number }) {
  const pct = maxSats > 0 ? (cost.sats_cost / maxSats) * 100 : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <Brain size={11} className="text-purple-400" aria-hidden="true" />
          <span className="text-slate-300 font-mono">{cost.model}</span>
          <span className="text-slate-600 text-[10px]">{cost.provider}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-500">
          <span className="flex items-center gap-0.5">
            <Cpu size={9} aria-hidden="true" />
            {(cost.input_tokens + cost.output_tokens).toLocaleString()} tok
          </span>
          <span className="flex items-center gap-0.5 text-[#f7931a]">
            <Zap size={9} aria-hidden="true" />
            {cost.sats_cost} sats
          </span>
        </div>
      </div>
      {/* Bar */}
      <div
        className="h-1.5 bg-slate-800 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${cost.model}: ${cost.sats_cost} sats`}
      >
        <div
          className="h-full bg-purple-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetricCard
// ---------------------------------------------------------------------------

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  iconCls,
  trend,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof BarChart2;
  iconCls?: string;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={13} className={clsx(iconCls ?? 'text-slate-500')} aria-hidden="true" />
        <span className="text-[10px] text-slate-600 uppercase tracking-wider">{label}</span>
        {trend === 'up' && <ArrowUp size={11} className="text-green-400 ml-auto" aria-hidden="true" aria-label="trending up" />}
        {trend === 'down' && <ArrowDown size={11} className="text-red-400 ml-auto" aria-hidden="true" aria-label="trending down" />}
      </div>
      <p className="text-xl font-bold font-mono text-slate-100">{value}</p>
      {sub && <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PerformanceReportPanel — main export
// ---------------------------------------------------------------------------

export interface PerformanceReportPanelProps {
  agentId?: string;
  className?: string;
}

export default function PerformanceReportPanel({
  agentId,
  className,
}: PerformanceReportPanelProps) {
  const { agents } = useAgentProfile();
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('7d');

  // In production these would come from a hook with real data.
  // Using typed placeholders derived from the agent profile hook.
  const agent = agentId ? agents.find(a => a.id === agentId) : agents[0];

  // Mock performance data shape — real data comes from Nostr trajectory events
  const perf: PerformanceData = {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    timedOutTasks: 0,
    avgDurationSeconds: 0,
    totalSatsSpent: 0,
    satsPerSuccessfulTask: 0,
    reputationDelta: 0,
    dailyRates: [],
    llmCosts: [],
  };

  const completionRate = perf.totalTasks > 0
    ? Math.round((perf.completedTasks / perf.totalTasks) * 100)
    : 0;

  const maxLLMCost = Math.max(...perf.llmCosts.map(c => c.sats_cost), 1);

  const timeRanges: Array<{ id: '7d' | '30d' | 'all'; label: string }> = [
    { id: '7d',  label: '7d' },
    { id: '30d', label: '30d' },
    { id: 'all', label: 'All' },
  ];

  return (
    <div className={clsx('space-y-5', className)}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BarChart2 size={16} className="text-[#f7931a]" aria-hidden="true" />
          <h2 className="heading-display text-base text-[#f7931a]">Performance Report</h2>
          {agent && (
            <span className="text-xs text-slate-500">{agent.name}</span>
          )}
        </div>

        {/* Time range selector */}
        <div
          className="flex gap-1 p-0.5 rounded-lg bg-slate-900 border border-slate-800"
          role="group"
          aria-label="Time range"
        >
          {timeRanges.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setTimeRange(r.id)}
              aria-pressed={timeRange === r.id}
              className={clsx(
                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                timeRange === r.id
                  ? 'bg-[#f7931a] text-black'
                  : 'text-slate-500 hover:text-slate-300',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard
          label="Completion Rate"
          value={`${completionRate}%`}
          sub={`${perf.completedTasks}/${perf.totalTasks} tasks`}
          icon={CheckCircle2}
          iconCls={completionRate > 80 ? 'text-green-400' : 'text-yellow-400'}
          trend={completionRate > 80 ? 'up' : 'down'}
        />
        <MetricCard
          label="Avg Duration"
          value={perf.avgDurationSeconds > 0
            ? perf.avgDurationSeconds < 60
              ? `${perf.avgDurationSeconds}s`
              : `${Math.round(perf.avgDurationSeconds / 60)}m`
            : '—'}
          sub="per task"
          icon={Clock}
          iconCls="text-blue-400"
        />
        <MetricCard
          label="Sats / Task"
          value={perf.satsPerSuccessfulTask > 0 ? perf.satsPerSuccessfulTask : '—'}
          sub={`${perf.totalSatsSpent} total sats`}
          icon={Zap}
          iconCls="text-[#f7931a]"
        />
        <MetricCard
          label="Reputation Δ"
          value={perf.reputationDelta >= 0 ? `+${perf.reputationDelta}` : String(perf.reputationDelta)}
          sub="this period"
          icon={Star}
          iconCls={perf.reputationDelta >= 0 ? 'text-[#ffd700]' : 'text-red-400'}
          trend={perf.reputationDelta > 0 ? 'up' : perf.reputationDelta < 0 ? 'down' : 'neutral'}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Bar chart — daily task rates */}
        <div className="sm:col-span-2 rounded-xl bg-slate-900 border border-slate-800 p-4">
          <h3 className="text-xs font-medium text-slate-400 mb-3 flex items-center gap-1.5">
            <BarChart2 size={12} aria-hidden="true" />
            Daily Task Completion
          </h3>
          {perf.dailyRates.length > 0 ? (
            <>
              <BarChart data={perf.dailyRates} height={100} />
              {/* Legend */}
              <div className="flex items-center gap-4 mt-2 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#f7931a]" aria-hidden="true" />
                  Completed
                </span>
                <span className="flex items-center gap-1 text-slate-500">
                  <span className="w-2.5 h-2.5 rounded-sm bg-red-500" aria-hidden="true" />
                  Failed
                </span>
              </div>
            </>
          ) : (
            <div className="h-24 flex items-center justify-center">
              <p className="text-xs text-slate-600">No task history yet</p>
            </div>
          )}
        </div>

        {/* Pie chart — success/fail/timeout */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
          <h3 className="text-xs font-medium text-slate-400 mb-3 flex items-center gap-1.5">
            <CheckCircle2 size={12} aria-hidden="true" />
            Task Outcomes
          </h3>
          <div className="flex flex-col items-center gap-3">
            <PieChart
              success={perf.completedTasks}
              failure={perf.failedTasks}
              timeout={perf.timedOutTasks}
              size={100}
            />
            {/* Legend */}
            <div className="w-full space-y-1">
              {[
                { label: 'Completed', count: perf.completedTasks, color: 'bg-green-500' },
                { label: 'Failed',    count: perf.failedTasks,    color: 'bg-red-500'   },
                { label: 'Timed Out', count: perf.timedOutTasks,  color: 'bg-slate-500' },
              ].map(({ label, count, color }) => (
                <div key={label} className="flex items-center justify-between text-[10px]">
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <span className={clsx('w-2 h-2 rounded-full', color)} aria-hidden="true" />
                    {label}
                  </span>
                  <span className="text-slate-400 font-mono">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* LLM cost breakdown */}
      {perf.llmCosts.length > 0 ? (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
          <h3 className="text-xs font-medium text-slate-400 mb-4 flex items-center gap-1.5">
            <Brain size={12} aria-hidden="true" />
            LLM Cost Breakdown
          </h3>
          <div className="space-y-3">
            {perf.llmCosts
              .sort((a, b) => b.sats_cost - a.sats_cost)
              .map((cost, idx) => (
                <LLMCostRow key={idx} cost={cost} maxSats={maxLLMCost} />
              ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-6 text-center">
          <Brain size={22} className="mx-auto text-slate-700 mb-2" aria-hidden="true" />
          <p className="text-xs text-slate-600">No LLM cost data yet</p>
          <p className="text-[10px] text-slate-700 mt-0.5">
            Costs will appear once agents complete tasks using LLM providers.
          </p>
        </div>
      )}
    </div>
  );
}

