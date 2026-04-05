/**
 * DelegationHealthPanel — Delegation chain health dashboard
 *
 * Features:
 * - Delegation chain tree view (Guardian → Agent hierarchy)
 * - Chain validity indicators (green/red per node)
 * - Expired/revoked delegation warnings
 * - Active delegation count vs. capacity
 *
 * Data from useDelegation hook (Nostr NIP-AC delegation events).
 */

import React, { useState } from 'react';
import clsx from 'clsx';
import {
  Shield,
  ShieldCheck,
  ShieldX,
  ShieldAlert,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Link2,
  Link2Off,
  Zap,
  Users,
  RefreshCw,
} from 'lucide-react';

import { useDelegation } from '../../hooks/useDelegation.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DelegationStatus = 'valid' | 'expired' | 'revoked' | 'pending';

export interface DelegationNode {
  id: string;
  agentId: string;
  agentName: string;
  role: 'guardian' | 'delegate' | 'sub-delegate';
  status: DelegationStatus;
  delegatedAt: string;
  expiresAt?: string | null;
  capacity: number;
  activeCount: number;
  satsBudget?: number;
  satsUsed?: number;
  children?: DelegationNode[];
  revokedAt?: string | null;
  revokedReason?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatExpiry(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMs < 0) return 'Expired';
  if (diffMins < 60) return `${diffMins}m left`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h left`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d left`;
}

function isExpired(iso?: string | null): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

function statusConfig(status: DelegationStatus) {
  switch (status) {
    case 'valid':
      return {
        Icon: ShieldCheck,
        iconCls: 'text-green-400',
        dotCls: 'bg-green-400',
        label: 'Valid',
        labelCls: 'text-green-400',
        borderCls: 'border-green-500/20',
        bgCls: 'bg-green-500/5',
      };
    case 'expired':
      return {
        Icon: ShieldAlert,
        iconCls: 'text-yellow-400',
        dotCls: 'bg-yellow-400',
        label: 'Expired',
        labelCls: 'text-yellow-400',
        borderCls: 'border-yellow-500/20',
        bgCls: 'bg-yellow-500/5',
      };
    case 'revoked':
      return {
        Icon: ShieldX,
        iconCls: 'text-red-400',
        dotCls: 'bg-red-400',
        label: 'Revoked',
        labelCls: 'text-red-400',
        borderCls: 'border-red-500/20',
        bgCls: 'bg-red-500/5',
      };
    case 'pending':
      return {
        Icon: Shield,
        iconCls: 'text-slate-500',
        dotCls: 'bg-slate-500',
        label: 'Pending',
        labelCls: 'text-slate-500',
        borderCls: 'border-slate-700',
        bgCls: 'bg-slate-800/30',
      };
  }
}

// ---------------------------------------------------------------------------
// CapacityBar — CSS-only capacity indicator
// ---------------------------------------------------------------------------

function CapacityBar({
  active,
  capacity,
}: {
  active: number;
  capacity: number;
}) {
  const pct = capacity > 0 ? Math.min(100, Math.round((active / capacity) * 100)) : 0;
  const overloaded = pct > 85;

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${active} of ${capacity} delegation slots used`}
      >
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-500',
            overloaded ? 'bg-red-500' : pct > 60 ? 'bg-yellow-500' : 'bg-[#f7931a]',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-slate-500 font-mono flex-shrink-0">
        {active}/{capacity}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DelegationNodeCard — recursive tree node
// ---------------------------------------------------------------------------

function DelegationNodeCard({
  node,
  depth = 0,
}: {
  node: DelegationNode;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const cfg = statusConfig(node.status);
  const hasChildren = node.children && node.children.length > 0;
  const expiryWarning = node.expiresAt && !isExpired(node.expiresAt) &&
    (new Date(node.expiresAt).getTime() - Date.now()) < 3600000; // < 1 hour

  const roleColors: Record<DelegationNode['role'], string> = {
    guardian:     'text-[#ffd700] bg-[#ffd700]/10',
    delegate:     'text-[#f7931a] bg-[#f7931a]/10',
    'sub-delegate':'text-blue-400 bg-blue-400/10',
  };

  return (
    <div className={clsx(depth > 0 && 'ml-5 relative')}>
      {/* Connector line for children */}
      {depth > 0 && (
        <div
          className="absolute -left-3 top-0 bottom-0 border-l-2 border-slate-800"
          aria-hidden="true"
        />
      )}

      <div
        className={clsx(
          'rounded-xl border p-3 mb-2 transition-all',
          cfg.borderCls,
          cfg.bgCls,
          'hover:border-opacity-60',
        )}
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-label={`${node.agentName} — ${cfg.label}`}
      >
        <div className="flex items-center gap-2">
          {/* Expand toggle */}
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              aria-label={expanded ? 'Collapse subtree' : 'Expand subtree'}
              className="text-slate-600 hover:text-slate-400 transition-colors flex-shrink-0"
            >
              {expanded
                ? <ChevronDown size={13} aria-hidden="true" />
                : <ChevronRight size={13} aria-hidden="true" />
              }
            </button>
          ) : (
            <span className="w-[13px] flex-shrink-0" aria-hidden="true" />
          )}

          {/* Status icon */}
          <cfg.Icon size={14} className={clsx(cfg.iconCls, 'flex-shrink-0')} aria-hidden="true" />

          {/* Agent info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-slate-200 truncate">
                {node.agentName}
              </span>
              <span className={clsx(
                'text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded',
                roleColors[node.role],
              )}>
                {node.role}
              </span>
              <span className={clsx('text-[10px] font-medium', cfg.labelCls)}>
                {cfg.label}
              </span>
            </div>
            <p className="text-[10px] text-slate-600 font-mono mt-0.5 truncate">{node.agentId}</p>
          </div>

          {/* Capacity indicator */}
          <div className="hidden sm:block w-28 flex-shrink-0">
            <CapacityBar active={node.activeCount} capacity={node.capacity} />
          </div>
        </div>

        {/* Details row */}
        <div className="mt-2 pl-6 grid grid-cols-2 gap-x-4 gap-y-1">
          {/* Expiry */}
          {node.expiresAt && (
            <div className={clsx(
              'flex items-center gap-1 text-[10px]',
              isExpired(node.expiresAt) ? 'text-red-400' :
              expiryWarning ? 'text-yellow-400' : 'text-slate-500',
            )}>
              <Clock size={9} aria-hidden="true" />
              {isExpired(node.expiresAt) ? 'Expired' : formatExpiry(node.expiresAt)}
            </div>
          )}

          {/* Sats budget */}
          {node.satsBudget != null && (
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <Zap size={9} aria-hidden="true" />
              {node.satsUsed ?? 0}/{node.satsBudget} sats
            </div>
          )}

          {/* Revocation info */}
          {node.status === 'revoked' && node.revokedReason && (
            <div className="col-span-2 flex items-center gap-1 text-[10px] text-red-400">
              <XCircle size={9} aria-hidden="true" />
              {node.revokedReason}
            </div>
          )}

          {/* Expiry warning */}
          {expiryWarning && !isExpired(node.expiresAt) && (
            <div className="col-span-2 flex items-center gap-1 text-[10px] text-yellow-400">
              <AlertTriangle size={9} aria-hidden="true" />
              Expiring soon
            </div>
          )}
        </div>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div role="group">
          {node.children!.map(child => (
            <DelegationNodeCard key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DelegationHealthPanel — main export
// ---------------------------------------------------------------------------

export interface DelegationHealthPanelProps {
  className?: string;
}

export default function DelegationHealthPanel({ className }: DelegationHealthPanelProps) {
  const { delegationChain, isLoading, lastUpdated, refresh } = useDelegation();

  // Compute aggregate stats
  const allNodes: DelegationNode[] = [];
  const flatten = (node: DelegationNode) => {
    allNodes.push(node);
    node.children?.forEach(flatten);
  };
  delegationChain?.forEach(flatten);

  const validCount    = allNodes.filter(n => n.status === 'valid').length;
  const expiredCount  = allNodes.filter(n => n.status === 'expired').length;
  const revokedCount  = allNodes.filter(n => n.status === 'revoked').length;
  const totalCapacity = allNodes.reduce((s, n) => s + n.capacity, 0);
  const totalActive   = allNodes.reduce((s, n) => s + n.activeCount, 0);

  const hasWarnings = expiredCount > 0 || revokedCount > 0;

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-[#f7931a]" aria-hidden="true" />
          <h2 className="heading-display text-base text-[#f7931a]">Delegation Health</h2>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[10px] text-slate-600">
              Updated {new Date(lastUpdated).toLocaleTimeString('en-US', { hour12: false })}
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh delegation chain"
            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-400 hover:bg-slate-800 transition-all"
          >
            <RefreshCw size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 text-center">
          <CheckCircle2 size={16} className="mx-auto text-green-400 mb-1" aria-hidden="true" />
          <p className="text-lg font-bold font-mono text-green-400">{validCount}</p>
          <p className="text-[10px] text-slate-600">Valid</p>
        </div>
        <div className={clsx(
          'rounded-xl border p-3 text-center',
          expiredCount > 0 ? 'bg-yellow-500/5 border-yellow-500/20' : 'bg-slate-900 border-slate-800',
        )}>
          <Clock size={16} className={clsx('mx-auto mb-1', expiredCount > 0 ? 'text-yellow-400' : 'text-slate-600')} aria-hidden="true" />
          <p className={clsx('text-lg font-bold font-mono', expiredCount > 0 ? 'text-yellow-400' : 'text-slate-600')}>
            {expiredCount}
          </p>
          <p className="text-[10px] text-slate-600">Expired</p>
        </div>
        <div className={clsx(
          'rounded-xl border p-3 text-center',
          revokedCount > 0 ? 'bg-red-500/5 border-red-500/20' : 'bg-slate-900 border-slate-800',
        )}>
          <XCircle size={16} className={clsx('mx-auto mb-1', revokedCount > 0 ? 'text-red-400' : 'text-slate-600')} aria-hidden="true" />
          <p className={clsx('text-lg font-bold font-mono', revokedCount > 0 ? 'text-red-400' : 'text-slate-600')}>
            {revokedCount}
          </p>
          <p className="text-[10px] text-slate-600">Revoked</p>
        </div>
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-3 text-center">
          <Users size={16} className="mx-auto text-[#f7931a] mb-1" aria-hidden="true" />
          <p className="text-lg font-bold font-mono text-[#f7931a]">{totalActive}/{totalCapacity}</p>
          <p className="text-[10px] text-slate-600">Capacity</p>
        </div>
      </div>

      {/* Warnings banner */}
      {hasWarnings && (
        <div className="rounded-xl bg-yellow-500/5 border border-yellow-500/20 px-4 py-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-yellow-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-xs text-yellow-300">
            {expiredCount > 0 && (
              <p>{expiredCount} delegation{expiredCount !== 1 ? 's' : ''} expired — renew to restore access</p>
            )}
            {revokedCount > 0 && (
              <p>{revokedCount} delegation{revokedCount !== 1 ? 's' : ''} revoked — review Guardian logs</p>
            )}
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 skeleton rounded-xl" aria-hidden="true" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!delegationChain || delegationChain.length === 0) && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-8 text-center">
          <Link2Off size={28} className="mx-auto text-slate-700 mb-3" aria-hidden="true" />
          <p className="text-sm text-slate-500">No delegation chain found</p>
          <p className="text-xs text-slate-600 mt-1">
            Delegation tokens will appear here once agents are authorized by a Guardian.
          </p>
        </div>
      )}

      {/* Tree */}
      {!isLoading && delegationChain && delegationChain.length > 0 && (
        <div
          role="tree"
          aria-label="Delegation chain tree"
          className="space-y-0"
        >
          {delegationChain.map(node => (
            <DelegationNodeCard key={node.id} node={node} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}
