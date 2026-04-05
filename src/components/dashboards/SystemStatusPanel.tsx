/**
 * SystemStatusPanel — System-wide status dashboard
 *
 * Features:
 * - Pylon connection status (connected/authenticated/disconnected)
 * - Vault status (locked/unlocked)
 * - Service worker status (active/updating/error)
 * - Relay connectivity (per-relay health)
 * - Queued events count (events waiting for connectivity)
 * - Last sync timestamp
 *
 * Compact version also suitable for HomePage dashboard sidebar.
 */

import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import {
  Server,
  Lock,
  Unlock,
  Wifi,
  WifiOff,
  Shield,
  ShieldCheck,
  Activity,
  Radio,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Zap,
  Network,
  GitMerge,
} from 'lucide-react';

import { usePylon } from '../../hooks/usePylon.js';
import { useSpacetimeBridge } from '../../hooks/useSpacetimeBridge.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RelayStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export interface RelayHealth {
  url: string;
  status: RelayStatus;
  latency_ms?: number;
  lastSeen?: string;
}

export type ServiceWorkerStatus = 'active' | 'installing' | 'waiting' | 'redundant' | 'error' | 'unsupported';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 5)  return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// ---------------------------------------------------------------------------
// StatusDot
// ---------------------------------------------------------------------------

type DotVariant = 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'pulse-green';

function StatusDot({ variant }: { variant: DotVariant }) {
  const cls = {
    'green':       'bg-green-400',
    'yellow':      'bg-yellow-400',
    'red':         'bg-red-400',
    'blue':        'bg-blue-400',
    'gray':        'bg-slate-600',
    'pulse-green': 'bg-green-400 animate-pulse',
  }[variant];

  return <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', cls)} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// StatusRow — reusable row for each system component
// ---------------------------------------------------------------------------

function StatusRow({
  label,
  value,
  detail,
  dotVariant,
  icon: Icon,
  iconCls,
}: {
  label: string;
  value: string;
  detail?: string;
  dotVariant: DotVariant;
  icon: typeof Server;
  iconCls?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-800 last:border-0">
      <div className={clsx('w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0', iconCls)}>
        <Icon size={15} aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm text-slate-300">{label}</p>
          {detail && <p className="text-[10px] text-slate-600 truncate">{detail}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <StatusDot variant={dotVariant} />
        <span className={clsx(
          'text-xs font-medium',
          dotVariant === 'green' || dotVariant === 'pulse-green' ? 'text-green-400' :
          dotVariant === 'yellow' ? 'text-yellow-400' :
          dotVariant === 'red'    ? 'text-red-400'    :
          dotVariant === 'blue'   ? 'text-blue-400'   :
          'text-slate-500',
        )}>
          {value}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RelayHealthRow
// ---------------------------------------------------------------------------

function RelayHealthRow({ relay }: { relay: RelayHealth }) {
  const dotVariant: DotVariant =
    relay.status === 'connected'    ? 'pulse-green' :
    relay.status === 'connecting'   ? 'yellow'      :
    relay.status === 'error'        ? 'red'         :
    'gray';

  const statusLabel =
    relay.status === 'connected'    ? 'Connected'    :
    relay.status === 'connecting'   ? 'Connecting…'  :
    relay.status === 'disconnected' ? 'Disconnected' :
    'Error';

  // Truncate relay URL for display
  const displayUrl = relay.url.replace(/^wss?:\/\//, '').replace(/\/$/, '');

  return (
    <div className="flex items-center gap-2 py-2 border-b border-slate-800/50 last:border-0">
      <StatusDot variant={dotVariant} />
      <p className="flex-1 font-mono text-[11px] text-slate-400 truncate">{displayUrl}</p>
      <div className="flex items-center gap-2 flex-shrink-0">
        {relay.latency_ms != null && relay.status === 'connected' && (
          <span className={clsx(
            'text-[10px] font-mono',
            relay.latency_ms < 200 ? 'text-green-400' :
            relay.latency_ms < 500 ? 'text-yellow-400' :
            'text-red-400',
          )}>
            {relay.latency_ms}ms
          </span>
        )}
        <span className={clsx(
          'text-[10px]',
          dotVariant === 'pulse-green' ? 'text-green-400' :
          dotVariant === 'yellow' ? 'text-yellow-400' :
          dotVariant === 'red'    ? 'text-red-400'    :
          'text-slate-600',
        )}>
          {statusLabel}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SW Status helpers
// ---------------------------------------------------------------------------

function getSWStatus(): ServiceWorkerStatus {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }
  // In production: read from navigator.serviceWorker.controller
  try {
    const sw = navigator.serviceWorker.controller;
    if (!sw) return 'installing';
    if (sw.state === 'activated') return 'active';
    if (sw.state === 'installing') return 'installing';
    if (sw.state === 'installed') return 'waiting';
    return 'redundant';
  } catch {
    return 'error';
  }
}

function swDotVariant(status: ServiceWorkerStatus): DotVariant {
  switch (status) {
    case 'active':       return 'pulse-green';
    case 'installing':
    case 'waiting':      return 'yellow';
    case 'error':        return 'red';
    default:             return 'gray';
  }
}

function swLabel(status: ServiceWorkerStatus): string {
  switch (status) {
    case 'active':       return 'Active';
    case 'installing':   return 'Installing…';
    case 'waiting':      return 'Waiting';
    case 'redundant':    return 'Redundant';
    case 'error':        return 'Error';
    case 'unsupported':  return 'Not Supported';
    default:             return 'Unknown';
  }
}

// ---------------------------------------------------------------------------
// SystemStatusPanel — main export
// ---------------------------------------------------------------------------

export interface SystemStatusPanelProps {
  /** Compact mode: no relay details, reduced spacing */
  compact?: boolean;
  className?: string;
}

export default function SystemStatusPanel({
  compact = false,
  className,
}: SystemStatusPanelProps) {
  const { isConnected, isAuthenticated } = usePylon();
  const { presenceStatus, computeAssignments, heartbeatActive } = useSpacetimeBridge();

  const [showRelays, setShowRelays] = useState(!compact);
  const [swStatus]   = useState<ServiceWorkerStatus>(getSWStatus);
  const [lastSync]   = useState<string>(new Date().toISOString());
  const [queuedEvents] = useState(0); // In production: from offline queue manager

  // Mock relay health — in production from useRelayPool or similar
  const relays: RelayHealth[] = [
    { url: 'wss://relay.damus.io', status: isConnected ? 'connected' : 'disconnected', latency_ms: 42 },
    { url: 'wss://relay.nostr.band', status: isConnected ? 'connected' : 'connecting', latency_ms: 128 },
    { url: 'wss://nos.lol', status: isConnected ? 'connected' : 'disconnected', latency_ms: 67 },
  ];

  const connectedRelays = relays.filter(r => r.status === 'connected').length;
  const totalRelays = relays.length;

  // Vault locked state — in production from useVault hook
  const vaultLocked = false; // placeholder

  // Pylon derived state
  const pylonDot: DotVariant =
    isAuthenticated ? 'pulse-green' :
    isConnected     ? 'yellow'      :
    'gray';

  const pylonLabel =
    isAuthenticated ? 'Authenticated' :
    isConnected     ? 'Connected'     :
    'Disconnected';

  const relayDot: DotVariant =
    connectedRelays === totalRelays ? 'pulse-green' :
    connectedRelays > 0             ? 'yellow'      :
    'red';

  const spacetimeDot: DotVariant = heartbeatActive ? 'pulse-green' : 'gray';

  return (
    <div className={clsx('space-y-3', className)}>
      {!compact && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-[#f7931a]" aria-hidden="true" />
            <h2 className="heading-display text-base text-[#f7931a]">System Status</h2>
          </div>
          {lastSync && (
            <div className="flex items-center gap-1 text-[10px] text-slate-600">
              <Clock size={10} aria-hidden="true" />
              Last sync {formatRelative(lastSync)}
            </div>
          )}
        </div>
      )}

      {/* Core status rows */}
      <div className={clsx(
        'rounded-xl bg-slate-900 border border-slate-800',
        compact ? 'px-3' : 'px-4',
      )}>
        {/* Pylon */}
        <StatusRow
          label="Pylon"
          value={pylonLabel}
          detail={isAuthenticated ? 'NIP-SA authenticated' : undefined}
          dotVariant={pylonDot}
          icon={Server}
          iconCls={isAuthenticated ? 'text-green-400' : isConnected ? 'text-yellow-400' : 'text-slate-500'}
        />

        {/* Vault */}
        <StatusRow
          label="Vault"
          value={vaultLocked ? 'Locked' : 'Unlocked'}
          dotVariant={vaultLocked ? 'yellow' : 'green'}
          icon={vaultLocked ? Lock : Unlock}
          iconCls={vaultLocked ? 'text-yellow-400' : 'text-green-400'}
        />

        {/* Service Worker */}
        <StatusRow
          label="Service Worker"
          value={swLabel(swStatus)}
          dotVariant={swDotVariant(swStatus)}
          icon={Shield}
          iconCls={swStatus === 'active' ? 'text-green-400' : swStatus === 'error' ? 'text-red-400' : 'text-slate-400'}
        />

        {/* Relay connectivity */}
        <div className="py-2.5 border-b border-slate-800 last:border-0">
          <div className="flex items-center gap-3">
            <div className={clsx('w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center flex-shrink-0',
              connectedRelays === totalRelays ? 'text-green-400' : connectedRelays > 0 ? 'text-yellow-400' : 'text-red-400',
            )}>
              <Network size={15} aria-hidden="true" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-slate-300">Relay Pool</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowRelays(s => !s)}
                aria-label={showRelays ? 'Hide relay details' : 'Show relay details'}
                aria-expanded={showRelays}
                className="p-1 text-slate-600 hover:text-slate-400 transition-colors"
              >
                {showRelays ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              <StatusDot variant={relayDot} />
              <span className={clsx(
                'text-xs font-medium',
                connectedRelays === totalRelays ? 'text-green-400' :
                connectedRelays > 0 ? 'text-yellow-400' :
                'text-red-400',
              )}>
                {connectedRelays}/{totalRelays}
              </span>
            </div>
          </div>

          {/* Relay list */}
          {showRelays && (
            <div className="mt-2 ml-11">
              {relays.map(relay => (
                <RelayHealthRow key={relay.url} relay={relay} />
              ))}
            </div>
          )}
        </div>

        {/* SpacetimeBridge presence */}
        <StatusRow
          label="SpacetimeBridge"
          value={heartbeatActive ? `${presenceStatus ?? 'Active'}` : 'Inactive'}
          detail={computeAssignments > 0 ? `${computeAssignments} compute assignments` : undefined}
          dotVariant={spacetimeDot}
          icon={GitMerge}
          iconCls={heartbeatActive ? 'text-blue-400' : 'text-slate-500'}
        />
      </div>

      {/* Queued events banner */}
      {queuedEvents > 0 && (
        <div className="rounded-xl bg-yellow-500/5 border border-yellow-500/20 px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={13} className="text-yellow-400 flex-shrink-0" aria-hidden="true" />
          <p className="text-xs text-yellow-300">
            {queuedEvents} event{queuedEvents !== 1 ? 's' : ''} queued — waiting for relay connectivity
          </p>
        </div>
      )}

      {/* Compact last sync */}
      {compact && lastSync && (
        <div className="flex items-center justify-end gap-1 text-[10px] text-slate-700">
          <Clock size={9} aria-hidden="true" />
          Last sync {formatRelative(lastSync)}
        </div>
      )}
    </div>
  );
}
