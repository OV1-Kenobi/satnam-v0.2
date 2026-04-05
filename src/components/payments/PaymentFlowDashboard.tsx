/**
 * @module components/payments/PaymentFlowDashboard
 * @description Real-time payment flow monitoring dashboard.
 *
 * Features:
 * - Live payment stream with rail indicators
 * - Multi-rail balance summary
 * - CSS-only Sankey-style flow visualization (sats flowing between rails)
 * - Daily/weekly/monthly volume bar charts (CSS-only)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import clsx from 'clsx';
import {
  Zap,
  Coins,
  Server,
  ArrowLeftRight,
  ArrowDown,
  ArrowUp,
  TrendingUp,
  TrendingDown,
  Circle,
  BarChart3,
  Activity,
  RefreshCw,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type Rail = 'lightning' | 'cashu' | 'lnbits' | 'boltz';

interface PaymentEvent {
  id: string;
  rail: Rail;
  direction: 'in' | 'out';
  amountSats: number;
  description: string;
  timestamp: number;
  status: 'complete' | 'pending' | 'failed';
}

interface RailBalance {
  rail: Rail;
  balanceSats: number;
  label: string;
}

interface DayVolume {
  label: string;
  inSats: number;
  outSats: number;
}

// ============================================================================
// Constants
// ============================================================================

const RAIL_META: Record<Rail, { label: string; color: string; icon: typeof Zap }> = {
  lightning: { label: 'Lightning', color: '#f7931a', icon: Zap },
  cashu: { label: 'Cashu', color: '#a855f7', icon: Coins },
  lnbits: { label: 'LNbits', color: '#22c55e', icon: Server },
  boltz: { label: 'Boltz', color: '#3b82f6', icon: ArrowLeftRight },
};

// ============================================================================
// Mock data factory
// ============================================================================

function generateMockPayments(count = 8): PaymentEvent[] {
  const rails: Rail[] = ['lightning', 'cashu', 'lnbits', 'boltz'];
  const descriptions = [
    'Coffee ⚡', 'Nostr zap', 'DVM job payment', 'Cashu swap',
    'Agent payout', 'LNbits transfer', 'Boltz swap out', 'NWC payment',
  ];
  return Array.from({ length: count }, (_, i) => ({
    id: `evt-${i}`,
    rail: rails[i % rails.length],
    direction: i % 3 === 0 ? 'in' : 'out',
    amountSats: Math.floor(Math.random() * 50_000) + 100,
    description: descriptions[i % descriptions.length],
    timestamp: Math.floor(Date.now() / 1000) - i * 900,
    status: i === 0 ? 'pending' : 'complete',
  }));
}

function getMockBalances(): RailBalance[] {
  return [
    { rail: 'lightning', balanceSats: 84_000, label: 'NWC Lightning' },
    { rail: 'cashu', balanceSats: 5_030, label: 'Cashu (2 mints)' },
    { rail: 'lnbits', balanceSats: 12_500, label: 'LNbits' },
    { rail: 'boltz', balanceSats: 0, label: 'Boltz (bridge)' },
  ];
}

function getMockDayVolumes(): DayVolume[] {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return days.map((label) => ({
    label,
    inSats: Math.floor(Math.random() * 200_000) + 5_000,
    outSats: Math.floor(Math.random() * 150_000) + 3_000,
  }));
}

// ============================================================================
// Sub-components
// ============================================================================

// ─── Rail Balance Card ────────────────────────────────────────────────────────

function RailBalanceCard({ balance, totalSats }: { balance: RailBalance; totalSats: number }) {
  const meta = RAIL_META[balance.rail];
  const pct = totalSats > 0 ? (balance.balanceSats / totalSats) * 100 : 0;

  return (
    <div
      className="bg-slate-900 border border-slate-800 rounded-xl p-4"
      aria-label={`${meta.label} balance: ${balance.balanceSats.toLocaleString()} sats`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${meta.color}20` }}
          >
            <meta.icon size={14} style={{ color: meta.color }} aria-hidden="true" />
          </div>
          <span className="text-xs text-slate-400">{meta.label}</span>
        </div>
      </div>

      <p className="font-mono text-lg font-bold text-slate-100">
        {balance.balanceSats.toLocaleString()}
        <span className="text-xs text-slate-500 ml-1">sats</span>
      </p>

      {/* Allocation bar */}
      <div className="mt-3">
        <div className="flex justify-between text-[10px] text-slate-500 mb-1">
          <span>{balance.label}</span>
          <span>{pct.toFixed(1)}% of total</span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.max(2, pct)}%`,
              backgroundColor: meta.color,
              opacity: 0.8,
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Sankey Flow Visualization (CSS-only) ────────────────────────────────────

function FlowVisualization({ balances }: { balances: RailBalance[] }) {
  const total = balances.reduce((s, b) => s + b.balanceSats, 0);

  return (
    <div
      className="bg-slate-900 border border-slate-800 rounded-xl p-4"
      aria-label="Sats distribution across rails"
    >
      <h4 className="text-xs text-slate-500 uppercase tracking-widest mb-4">Allocation Flow</h4>

      {/* Central "total" label */}
      <div className="text-center mb-4">
        <p className="font-mono text-2xl font-bold text-slate-100">
          {total.toLocaleString()}
        </p>
        <p className="text-xs text-slate-500">total sats across all rails</p>
      </div>

      {/* Flow bars — simulate Sankey with stacked proportional bars */}
      <div className="space-y-3" role="list" aria-label="Rail allocation">
        {balances.map((b) => {
          const meta = RAIL_META[b.rail];
          const pct = total > 0 ? (b.balanceSats / total) * 100 : 0;
          return (
            <div key={b.rail} role="listitem">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <meta.icon size={12} style={{ color: meta.color }} aria-hidden="true" />
                  <span className="text-xs text-slate-400">{meta.label}</span>
                </div>
                <span className="text-xs font-mono" style={{ color: meta.color }}>
                  {b.balanceSats.toLocaleString()} sats
                </span>
              </div>

              {/* Proportional bar */}
              <div className="h-4 bg-slate-800 rounded-full overflow-hidden relative">
                <div
                  className="h-full rounded-full flex items-center justify-end pr-2 transition-all duration-700"
                  style={{
                    width: `${Math.max(4, pct)}%`,
                    backgroundColor: `${meta.color}40`,
                    borderRight: `2px solid ${meta.color}`,
                  }}
                >
                  {pct > 15 && (
                    <span
                      className="text-[9px] font-medium"
                      style={{ color: meta.color }}
                    >
                      {pct.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Volume Bar Chart (CSS-only) ─────────────────────────────────────────────

function VolumeChart({ volumes }: { volumes: DayVolume[] }) {
  const maxSats = Math.max(...volumes.map((v) => Math.max(v.inSats, v.outSats)));

  return (
    <div
      className="bg-slate-900 border border-slate-800 rounded-xl p-4"
      aria-label="Daily payment volume"
    >
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-xs text-slate-500 uppercase tracking-widest">Weekly Volume</h4>
        <div className="flex items-center gap-3 text-[10px]">
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] inline-block" />
            <span className="text-slate-500">In</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#f7931a] inline-block" />
            <span className="text-slate-500">Out</span>
          </div>
        </div>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-2 h-24" role="img" aria-label="Weekly volume bar chart">
        {volumes.map((day) => {
          const inPct = maxSats > 0 ? (day.inSats / maxSats) * 100 : 0;
          const outPct = maxSats > 0 ? (day.outSats / maxSats) * 100 : 0;
          return (
            <div
              key={day.label}
              className="flex-1 flex flex-col items-center gap-0.5"
              title={`${day.label}: In ${day.inSats.toLocaleString()} / Out ${day.outSats.toLocaleString()}`}
            >
              {/* Bars container */}
              <div className="w-full flex gap-0.5 items-end h-20">
                {/* In bar */}
                <div
                  className="flex-1 rounded-t bg-[#22c55e]/60 transition-all duration-500"
                  style={{ height: `${Math.max(4, inPct)}%` }}
                  aria-label={`${day.label} incoming: ${day.inSats.toLocaleString()} sats`}
                />
                {/* Out bar */}
                <div
                  className="flex-1 rounded-t bg-[#f7931a]/60 transition-all duration-500"
                  style={{ height: `${Math.max(4, outPct)}%` }}
                  aria-label={`${day.label} outgoing: ${day.outSats.toLocaleString()} sats`}
                />
              </div>
              <span className="text-[10px] text-slate-500">{day.label}</span>
            </div>
          );
        })}
      </div>

      {/* Totals */}
      <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 text-green-400">
          <TrendingUp size={12} aria-hidden="true" />
          <span>
            {volumes.reduce((s, v) => s + v.inSats, 0).toLocaleString()} in
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[#f7931a]">
          <TrendingDown size={12} aria-hidden="true" />
          <span>
            {volumes.reduce((s, v) => s + v.outSats, 0).toLocaleString()} out
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Live Payment Stream ──────────────────────────────────────────────────────

const STATUS_COLORS = {
  complete: 'text-green-400',
  pending: 'text-yellow-400',
  failed: 'text-red-400',
};

function PaymentStreamItem({ payment }: { payment: PaymentEvent }) {
  const meta = RAIL_META[payment.rail];
  const ago = Math.floor(Date.now() / 1000) - payment.timestamp;
  const agoLabel = ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.floor(ago / 60)}m ago` : `${Math.floor(ago / 3600)}h ago`;

  return (
    <div
      className="flex items-center gap-3 py-2.5 border-b border-slate-800/50 last:border-0"
      aria-label={`${payment.direction === 'in' ? 'Incoming' : 'Outgoing'} ${payment.amountSats.toLocaleString()} sats via ${meta.label}`}
    >
      {/* Direction + Rail icon */}
      <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
        {payment.direction === 'in' ? (
          <ArrowDown size={12} className="text-green-400" aria-hidden="true" />
        ) : (
          <ArrowUp size={12} className="text-[#f7931a]" aria-hidden="true" />
        )}
        <meta.icon size={12} style={{ color: meta.color }} aria-hidden="true" />
      </div>

      {/* Description */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-300 truncate">{payment.description}</p>
        <p className="text-[10px] text-slate-500">{meta.label} · {agoLabel}</p>
      </div>

      {/* Amount */}
      <div className="text-right flex-shrink-0">
        <p className={clsx(
          'text-xs font-mono font-medium',
          payment.direction === 'in' ? 'text-green-400' : 'text-slate-300'
        )}>
          {payment.direction === 'in' ? '+' : '-'}{payment.amountSats.toLocaleString()}
        </p>
        <p className={clsx('text-[10px]', STATUS_COLORS[payment.status])}>
          {payment.status}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export interface PaymentFlowDashboardProps {
  className?: string;
}

export default function PaymentFlowDashboard({ className }: PaymentFlowDashboardProps) {
  const [payments, setPayments] = useState<PaymentEvent[]>([]);
  const [balances, setBalances] = useState<RailBalance[]>([]);
  const [volumes, setVolumes] = useState<DayVolume[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    await new Promise((r) => setTimeout(r, 300));
    setPayments(generateMockPayments(10));
    setBalances(getMockBalances());
    setVolumes(getMockDayVolumes());
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, 15_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh]);

  const totalSats = balances.reduce((s, b) => s + b.balanceSats, 0);

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-[#f7931a]" aria-hidden="true" />
          <h2 className="heading-display text-lg text-[#f7931a] tracking-wider">
            Payment Flow
          </h2>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={isRefreshing}
          aria-label="Refresh payment data"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 transition-colors text-xs text-slate-400 disabled:opacity-50"
        >
          <RefreshCw
            size={12}
            className={clsx(isRefreshing && 'animate-spin')}
            aria-hidden="true"
          />
          Refresh
        </button>
      </div>

      {/* Total balance hero */}
      <div
        className="bg-slate-900 border border-slate-800 rounded-xl px-5 py-4"
        aria-label={`Total balance: ${totalSats.toLocaleString()} sats across all rails`}
      >
        <p className="text-xs text-slate-500 uppercase tracking-widest mb-1">Total Balance</p>
        <p className="font-mono text-3xl font-bold text-slate-100">
          {totalSats.toLocaleString()}
          <span className="text-base text-slate-500 ml-2">sats</span>
        </p>
        <p className="text-xs text-slate-500 mt-1">
          ≈ {(totalSats / 100_000_000).toFixed(6)} BTC across {balances.length} rails
        </p>
      </div>

      {/* Balance grid */}
      <div>
        <h3 className="text-xs text-slate-500 uppercase tracking-widest mb-3">Balance by Rail</h3>
        <div className="grid grid-cols-2 gap-3">
          {balances.map((b) => (
            <RailBalanceCard key={b.rail} balance={b} totalSats={totalSats} />
          ))}
        </div>
      </div>

      {/* Flow visualization */}
      <FlowVisualization balances={balances} />

      {/* Volume chart */}
      <VolumeChart volumes={volumes} />

      {/* Live stream */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Circle
              size={8}
              className="text-green-400 fill-green-400 animate-pulse"
              aria-hidden="true"
            />
            <h3 className="text-xs text-slate-300 font-medium">Live Stream</h3>
          </div>
          <span className="text-[10px] text-slate-500">{payments.length} recent</span>
        </div>
        <div className="px-4">
          {payments.length === 0 ? (
            <div className="py-8 text-center">
              <Activity size={24} className="mx-auto text-slate-600 mb-2" aria-hidden="true" />
              <p className="text-sm text-slate-500">No recent payments</p>
            </div>
          ) : (
            payments.slice(0, 8).map((p) => (
              <PaymentStreamItem key={p.id} payment={p} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
