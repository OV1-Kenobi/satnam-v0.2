/**
 * @module components/payments/RailHealthIndicator
 * @description Per-rail health status indicator for Lightning (NWC), Cashu, LNbits, and Boltz.
 * CSS-only — no chart library. Shows connection, latency, balances, and swap availability.
 */

import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import {
  Zap,
  Coins,
  Server,
  ArrowLeftRight,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Wifi,
  WifiOff,
  Activity,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type RailStatus = 'online' | 'degraded' | 'offline' | 'unknown';

interface NwcRailHealth {
  rail: 'nwc';
  status: RailStatus;
  latencyMs: number | null;
  lastPaymentAt: number | null;
  walletPubkey?: string;
}

interface CashuMintHealth {
  mintUrl: string;
  displayName: string;
  status: RailStatus;
  balanceSats: number;
  proofCount: number;
  lastSwapAt: number | null;
}

interface CashuRailHealth {
  rail: 'cashu';
  status: RailStatus;
  mints: CashuMintHealth[];
}

interface LnbitsRailHealth {
  rail: 'lnbits';
  status: RailStatus;
  balanceSats: number;
  walletId?: string;
  extensions: Array<{ name: string; enabled: boolean }>;
}

interface BoltzRailHealth {
  rail: 'boltz';
  status: RailStatus;
  swapAvailable: boolean;
  currentFeePct: number;
  minSwapSats: number;
  maxSwapSats: number;
}

type RailHealth = NwcRailHealth | CashuRailHealth | LnbitsRailHealth | BoltzRailHealth;

// ============================================================================
// Mock data factory
// ============================================================================

function getMockHealth(): RailHealth[] {
  return [
    {
      rail: 'nwc',
      status: 'online',
      latencyMs: 142,
      lastPaymentAt: Math.floor(Date.now() / 1000) - 3600,
      walletPubkey: 'npub1...abc',
    } as NwcRailHealth,
    {
      rail: 'cashu',
      status: 'online',
      mints: [
        {
          mintUrl: 'https://mint.minibits.cash/Bitcoin',
          displayName: 'Minibits',
          status: 'online',
          balanceSats: 4200,
          proofCount: 7,
          lastSwapAt: Math.floor(Date.now() / 1000) - 7200,
        },
        {
          mintUrl: 'https://legend.lnbits.com/cashu/api/v1',
          displayName: 'LNbits Mint',
          status: 'degraded',
          balanceSats: 830,
          proofCount: 3,
          lastSwapAt: null,
        },
      ],
    } as CashuRailHealth,
    {
      rail: 'lnbits',
      status: 'online',
      balanceSats: 12500,
      walletId: 'abc123',
      extensions: [
        { name: 'Cashu', enabled: true },
        { name: 'LNURLp', enabled: true },
        { name: 'Tipjar', enabled: false },
      ],
    } as LnbitsRailHealth,
    {
      rail: 'boltz',
      status: 'online',
      swapAvailable: true,
      currentFeePct: 0.5,
      minSwapSats: 1000,
      maxSwapSats: 1_000_000,
    } as BoltzRailHealth,
  ];
}

// ============================================================================
// Sub-components
// ============================================================================

const STATUS_COLORS: Record<RailStatus, string> = {
  online: 'text-green-400',
  degraded: 'text-yellow-400',
  offline: 'text-red-400',
  unknown: 'text-slate-500',
};

const STATUS_DOT: Record<RailStatus, string> = {
  online: 'bg-green-400',
  degraded: 'bg-yellow-400',
  offline: 'bg-red-400',
  unknown: 'bg-slate-500',
};

function StatusDot({ status }: { status: RailStatus }) {
  return (
    <span
      className={clsx(
        'inline-block w-2 h-2 rounded-full',
        STATUS_DOT[status],
        status === 'online' && 'animate-pulse'
      )}
      aria-hidden="true"
    />
  );
}

function StatusBadge({ status }: { status: RailStatus }) {
  const labels: Record<RailStatus, string> = {
    online: 'Online',
    degraded: 'Degraded',
    offline: 'Offline',
    unknown: 'Unknown',
  };
  return (
    <span className={clsx('text-xs font-medium', STATUS_COLORS[status])}>
      {labels[status]}
    </span>
  );
}

function RelativeTime({ timestamp }: { timestamp: number | null }) {
  if (!timestamp) return <span className="text-slate-500">Never</span>;
  const secs = Math.floor(Date.now() / 1000) - timestamp;
  const minutes = Math.floor(secs / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let label = '';
  if (days > 0) label = `${days}d ago`;
  else if (hours > 0) label = `${hours}h ago`;
  else if (minutes > 0) label = `${minutes}m ago`;
  else label = 'Just now';

  return <span className="text-slate-400 text-xs">{label}</span>;
}

// ─── NWC Rail ────────────────────────────────────────────────────────────────

function NwcRailCard({ health }: { health: NwcRailHealth }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {health.status === 'online' ? (
            <Wifi size={14} className="text-green-400" aria-hidden="true" />
          ) : (
            <WifiOff size={14} className="text-red-400" aria-hidden="true" />
          )}
          <span className="text-xs text-slate-400">Connection</span>
        </div>
        <StatusBadge status={health.status} />
      </div>

      {health.latencyMs !== null && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Latency</span>
          <span className={clsx(
            'text-xs font-mono font-medium',
            health.latencyMs < 200 ? 'text-green-400' :
            health.latencyMs < 500 ? 'text-yellow-400' : 'text-red-400'
          )}>
            {health.latencyMs}ms
          </span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Last payment</span>
        <RelativeTime timestamp={health.lastPaymentAt} />
      </div>

      {/* Latency bar */}
      {health.latencyMs !== null && (
        <div aria-label={`Latency ${health.latencyMs}ms`}>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={clsx(
                'h-full rounded-full transition-all',
                health.latencyMs < 200 ? 'bg-green-400' :
                health.latencyMs < 500 ? 'bg-yellow-400' : 'bg-red-400'
              )}
              style={{ width: `${Math.min(100, (health.latencyMs / 1000) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cashu Rail ──────────────────────────────────────────────────────────────

function CashuRailCard({ health }: { health: CashuRailHealth }) {
  const totalBalance = health.mints.reduce((sum, m) => sum + m.balanceSats, 0);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Total balance</span>
        <span className="text-xs font-mono font-bold text-[#a855f7]">
          {totalBalance.toLocaleString()} sats
        </span>
      </div>

      <div className="space-y-2">
        {health.mints.map((mint) => (
          <div key={mint.mintUrl} className="rounded-lg bg-slate-800/50 px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <StatusDot status={mint.status} />
                <span className="text-xs text-slate-300">{mint.displayName}</span>
              </div>
              <span className="text-xs font-mono text-[#a855f7]">
                {mint.balanceSats.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>{mint.proofCount} proofs</span>
              <RelativeTime timestamp={mint.lastSwapAt} />
            </div>
            {/* Balance bar */}
            <div className="mt-1.5 h-1 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#a855f7]/70 rounded-full"
                style={{
                  width: totalBalance > 0
                    ? `${Math.min(100, (mint.balanceSats / totalBalance) * 100)}%`
                    : '0%',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LNbits Rail ─────────────────────────────────────────────────────────────

function LnbitsRailCard({ health }: { health: LnbitsRailHealth }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Wallet balance</span>
        <span className="text-xs font-mono font-bold text-[#22c55e]">
          {health.balanceSats.toLocaleString()} sats
        </span>
      </div>

      {health.walletId && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Wallet ID</span>
          <span className="text-xs font-mono text-slate-400">
            {health.walletId.slice(0, 8)}...
          </span>
        </div>
      )}

      <div>
        <p className="text-xs text-slate-500 mb-2">Extensions</p>
        <div className="flex flex-wrap gap-1.5">
          {health.extensions.map((ext) => (
            <span
              key={ext.name}
              className={clsx(
                'text-[10px] px-2 py-0.5 rounded-full border',
                ext.enabled
                  ? 'border-[#22c55e]/30 text-[#22c55e] bg-[#22c55e]/10'
                  : 'border-slate-700 text-slate-500'
              )}
            >
              {ext.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Boltz Rail ──────────────────────────────────────────────────────────────

function BoltzRailCard({ health }: { health: BoltzRailHealth }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Swap status</span>
        <span className={clsx(
          'text-xs font-medium',
          health.swapAvailable ? 'text-green-400' : 'text-red-400'
        )}>
          {health.swapAvailable ? 'Available' : 'Unavailable'}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Current fee</span>
        <span className="text-xs font-mono text-[#3b82f6] font-medium">
          {health.currentFeePct}%
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Min / Max swap</span>
        <span className="text-xs font-mono text-slate-400">
          {health.minSwapSats.toLocaleString()} / {health.maxSwapSats.toLocaleString()} sats
        </span>
      </div>

      {/* Fee visualization bar */}
      <div>
        <div className="flex justify-between text-[10px] text-slate-500 mb-1">
          <span>Fee rate</span>
          <span>{health.currentFeePct}%</span>
        </div>
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className={clsx(
              'h-full rounded-full',
              health.currentFeePct < 0.3 ? 'bg-green-400' :
              health.currentFeePct < 1.0 ? 'bg-[#3b82f6]' : 'bg-yellow-400'
            )}
            style={{ width: `${Math.min(100, health.currentFeePct * 20)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface RailConfig {
  key: string;
  label: string;
  icon: typeof Zap;
  color: string;
  bgColor: string;
}

const RAIL_CONFIGS: RailConfig[] = [
  { key: 'nwc', label: 'Lightning / NWC', icon: Zap, color: '#f7931a', bgColor: '#f7931a15' },
  { key: 'cashu', label: 'Cashu', icon: Coins, color: '#a855f7', bgColor: '#a855f715' },
  { key: 'lnbits', label: 'LNbits', icon: Server, color: '#22c55e', bgColor: '#22c55e15' },
  { key: 'boltz', label: 'Boltz Swaps', icon: ArrowLeftRight, color: '#3b82f6', bgColor: '#3b82f615' },
];

export interface RailHealthIndicatorProps {
  /** Compact single-row summary mode */
  compact?: boolean;
  className?: string;
}

export default function RailHealthIndicator({
  compact = false,
  className,
}: RailHealthIndicatorProps) {
  const [healths, setHealths] = useState<RailHealth[]>([]);
  const [expandedRail, setExpandedRail] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchHealth = useCallback(async () => {
    setIsRefreshing(true);
    // In production: concurrent calls to NWC info, Cashu mint status, LNbits, Boltz API
    await new Promise((r) => setTimeout(r, 400));
    setHealths(getMockHealth());
    setLastRefresh(new Date());
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30_000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const overallStatus: RailStatus =
    healths.length === 0 ? 'unknown' :
    healths.every((h) => h.status === 'online') ? 'online' :
    healths.some((h) => h.status === 'offline') ? 'degraded' : 'degraded';

  if (compact) {
    return (
      <div className={clsx('flex items-center gap-3 flex-wrap', className)}>
        {RAIL_CONFIGS.map((cfg) => {
          const health = healths.find((h) => h.rail === cfg.key);
          const status = health?.status ?? 'unknown';
          return (
            <div key={cfg.key} className="flex items-center gap-1.5" aria-label={`${cfg.label} status: ${status}`}>
              <cfg.icon size={12} style={{ color: cfg.color }} aria-hidden="true" />
              <StatusDot status={status} />
              <span className="text-xs text-slate-500">{cfg.label}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={clsx('bg-slate-900 border border-slate-800 rounded-xl', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Activity size={16} className={STATUS_COLORS[overallStatus]} aria-hidden="true" />
          <h3 className="text-sm font-medium text-slate-200">Rail Health</h3>
          <StatusDot status={overallStatus} />
        </div>
        <button
          type="button"
          onClick={fetchHealth}
          disabled={isRefreshing}
          aria-label="Refresh rail health"
          className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            size={14}
            className={clsx('text-slate-400', isRefreshing && 'animate-spin')}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* Rail cards */}
      <div className="divide-y divide-slate-800">
        {RAIL_CONFIGS.map((cfg) => {
          const health = healths.find((h) => h.rail === cfg.key);
          const status = health?.status ?? 'unknown';
          const isExpanded = expandedRail === cfg.key;

          return (
            <div key={cfg.key}>
              {/* Rail header row */}
              <button
                type="button"
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 transition-colors text-left"
                onClick={() => setExpandedRail(isExpanded ? null : cfg.key)}
                aria-expanded={isExpanded}
                aria-label={`${cfg.label} — ${status}. Click to ${isExpanded ? 'collapse' : 'expand'}`}
              >
                {/* Icon */}
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: cfg.bgColor, border: `1px solid ${cfg.color}25` }}
                >
                  <cfg.icon size={15} style={{ color: cfg.color }} aria-hidden="true" />
                </div>

                {/* Label + status */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200">{cfg.label}</p>
                </div>

                <StatusDot status={status} />
                <StatusBadge status={status} />
                {isExpanded ? (
                  <ChevronUp size={14} className="text-slate-500 flex-shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronDown size={14} className="text-slate-500 flex-shrink-0" aria-hidden="true" />
                )}
              </button>

              {/* Expanded detail */}
              {isExpanded && health && (
                <div className="px-4 pb-4 pt-1">
                  {health.rail === 'nwc' && <NwcRailCard health={health} />}
                  {health.rail === 'cashu' && <CashuRailCard health={health} />}
                  {health.rail === 'lnbits' && <LnbitsRailCard health={health} />}
                  {health.rail === 'boltz' && <BoltzRailCard health={health} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-slate-800">
        <p className="text-[10px] text-slate-600">
          Last refreshed {lastRefresh.toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}

