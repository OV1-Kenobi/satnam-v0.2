/**
 * @module components/payments/BondDashboard
 * @description Sig4Sats bond overview dashboard.
 *
 * Three sections:
 * 1. Entitlement tokens — active features, remaining value, creation wizard
 * 2. Recovery bonds — active requests, guardian participation status
 * 3. Allowance bonds — funding status, tokens remaining, spending rate
 */

import { useState } from 'react';
import clsx from 'clsx';
import {
  Shield,
  Key,
  Gift,
  Plus,
  Clock,
  Users,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  X,
} from 'lucide-react';
import { useSig4Sats } from '../../hooks/useSig4Sats.js';
import type {
  EntitlementBond,
  RecoveryBond,
  AllowanceBond,
  CreateEntitlementParams,
  CreateRecoveryParams,
  CreateAllowanceParams,
} from '../../lib/sig4sats/types.js';

// ============================================================================
// Helpers
// ============================================================================

function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

function formatExpiry(expiresAt: number): string {
  const secs = expiresAt - nowSecs();
  if (secs <= 0) return 'Expired';
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h left`;
  return `${Math.floor(secs / 60)}m left`;
}

// ============================================================================
// Status components
// ============================================================================

function StatusPill({ status }: { status: string }) {
  const configs: Record<string, { bg: string; text: string }> = {
    active: { bg: 'bg-green-500/10 border-green-500/20', text: 'text-green-400' },
    spent: { bg: 'bg-slate-800 border-slate-700', text: 'text-slate-500' },
    expired: { bg: 'bg-red-500/10 border-red-500/20', text: 'text-red-400' },
    collecting: { bg: 'bg-yellow-500/10 border-yellow-500/20', text: 'text-yellow-400' },
    threshold_met: { bg: 'bg-blue-500/10 border-blue-500/20', text: 'text-blue-400' },
    executed: { bg: 'bg-green-500/10 border-green-500/20', text: 'text-green-400' },
    refunded: { bg: 'bg-slate-800 border-slate-700', text: 'text-slate-500' },
    depleted: { bg: 'bg-orange-500/10 border-orange-500/20', text: 'text-orange-400' },
    paused: { bg: 'bg-yellow-500/10 border-yellow-500/20', text: 'text-yellow-400' },
  };
  const cfg = configs[status] ?? configs.active;
  return (
    <span className={clsx('text-[10px] px-2 py-0.5 rounded-full border', cfg.bg, cfg.text)}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ============================================================================
// Section Wrapper
// ============================================================================

interface SectionProps {
  title: string;
  icon: typeof Shield;
  color: string;
  count: number;
  children: React.ReactNode;
  action?: React.ReactNode;
}

function Section({ title, icon: Icon, color, count, children, action }: SectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/30 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        aria-label={`${title} section — ${count} bonds`}
      >
        <Icon size={15} style={{ color }} aria-hidden="true" />
        <span className="text-sm font-medium text-slate-200 flex-1 text-left">{title}</span>
        <span
          className="text-xs font-mono px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {count}
        </span>
        {collapsed ? (
          <ChevronDown size={14} className="text-slate-500" aria-hidden="true" />
        ) : (
          <ChevronUp size={14} className="text-slate-500" aria-hidden="true" />
        )}
      </button>

      {!collapsed && (
        <div className="border-t border-slate-800">
          {action && <div className="px-4 pt-3">{action}</div>}
          <div className="px-4 py-3">{children}</div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Creation Wizards
// ============================================================================

function EntitlementWizard({
  onSave,
  onClose,
}: {
  onSave: (p: CreateEntitlementParams) => void;
  onClose: () => void;
}) {
  const [featureId, setFeatureId] = useState('');
  const [amount, setAmount] = useState(500);
  const [mintUrl, setMintUrl] = useState('https://mint.minibits.cash/Bitcoin');

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3 mb-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-300">Create Entitlement Token</p>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-400">
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="ent-feature" className="block text-xs text-slate-400 mb-1">Feature ID</label>
        <input id="ent-feature" type="text" value={featureId} onChange={(e) => setFeatureId(e.target.value)}
          placeholder="e.g. premium-agents"
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#f7931a] transition-colors" />
      </div>

      <div>
        <label htmlFor="ent-amount" className="block text-xs text-slate-400 mb-1">Amount (sats)</label>
        <input id="ent-amount" type="number" value={amount} onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)}
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 font-mono focus:outline-none focus:border-[#f7931a] transition-colors" />
      </div>

      <div>
        <label htmlFor="ent-mint" className="block text-xs text-slate-400 mb-1">Mint URL</label>
        <input id="ent-mint" type="text" value={mintUrl} onChange={(e) => setMintUrl(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 font-mono focus:outline-none focus:border-[#f7931a] transition-colors" />
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-700 text-xs text-slate-400">Cancel</button>
        <button type="button" onClick={() => { onSave({ featureId, amount, mintUrl }); onClose(); }}
          disabled={!featureId || amount <= 0}
          className="flex-1 py-2 rounded-lg bg-[#f7931a] text-black text-xs font-medium disabled:opacity-40">
          Create
        </button>
      </div>
    </div>
  );
}

function RecoveryWizard({
  onSave,
  onClose,
}: {
  onSave: (p: CreateRecoveryParams) => void;
  onClose: () => void;
}) {
  const [recoveryEventId, setRecoveryEventId] = useState('');
  const [threshold, setThreshold] = useState(2);
  const [guardianCount, setGuardianCount] = useState(3);
  const [bondAmount, setBondAmount] = useState(1000);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3 mb-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-300">Create Recovery Bond</p>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-400">
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="rec-event" className="block text-xs text-slate-400 mb-1">Recovery Event ID</label>
        <input id="rec-event" type="text" value={recoveryEventId} onChange={(e) => setRecoveryEventId(e.target.value)}
          placeholder="nostr event ID to recover"
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-[#f7931a] transition-colors" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label htmlFor="rec-threshold" className="block text-xs text-slate-400 mb-1">Threshold</label>
          <input id="rec-threshold" type="number" min={1} max={guardianCount} value={threshold} onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
            className="w-full px-2 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 text-center focus:outline-none focus:border-[#ffd700]" />
        </div>
        <div>
          <label htmlFor="rec-total" className="block text-xs text-slate-400 mb-1">of Total</label>
          <input id="rec-total" type="number" min={threshold} value={guardianCount} onChange={(e) => setGuardianCount(parseInt(e.target.value, 10))}
            className="w-full px-2 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 text-center focus:outline-none focus:border-[#ffd700]" />
        </div>
        <div>
          <label htmlFor="rec-bond" className="block text-xs text-slate-400 mb-1">Bond (sats)</label>
          <input id="rec-bond" type="number" value={bondAmount} onChange={(e) => setBondAmount(parseInt(e.target.value, 10))}
            className="w-full px-2 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 text-center focus:outline-none focus:border-[#ffd700]" />
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-700 text-xs text-slate-400">Cancel</button>
        <button type="button"
          onClick={() => {
            onSave({
              recoveryEventId,
              threshold,
              guardians: Array.from({ length: guardianCount }, (_, i) => ({
                pubkey: `guardian-${i + 1}`,
                expectedBondAmount: bondAmount,
              })),
            });
            onClose();
          }}
          disabled={!recoveryEventId || threshold < 1 || threshold > guardianCount}
          className="flex-1 py-2 rounded-lg bg-[#ffd700] text-black text-xs font-medium disabled:opacity-40">
          Create
        </button>
      </div>
    </div>
  );
}

function AllowanceWizard({
  onSave,
  onClose,
}: {
  onSave: (p: CreateAllowanceParams) => void;
  onClose: () => void;
}) {
  const [recipientPubkey, setRecipientPubkey] = useState('');
  const [totalAmount, setTotalAmount] = useState(10_000);
  const [denomination, setDenomination] = useState(1_000);
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [maxSingle, setMaxSingle] = useState(2000);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3 mb-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-300">Create Allowance Bond</p>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-slate-400">
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div>
        <label htmlFor="alw-recipient" className="block text-xs text-slate-400 mb-1">Recipient pubkey</label>
        <input id="alw-recipient" type="text" value={recipientPubkey} onChange={(e) => setRecipientPubkey(e.target.value)}
          placeholder="npub1..."
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-[#3b82f6] transition-colors" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="alw-total" className="block text-xs text-slate-400 mb-1">Total (sats)</label>
          <input id="alw-total" type="number" value={totalAmount} onChange={(e) => setTotalAmount(parseInt(e.target.value, 10))}
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 font-mono focus:outline-none focus:border-[#3b82f6]" />
        </div>
        <div>
          <label htmlFor="alw-denom" className="block text-xs text-slate-400 mb-1">Denomination</label>
          <input id="alw-denom" type="number" value={denomination} onChange={(e) => setDenomination(parseInt(e.target.value, 10))}
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 font-mono focus:outline-none focus:border-[#3b82f6]" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="alw-cadence" className="block text-xs text-slate-400 mb-1">Cadence</label>
          <select id="alw-cadence" value={cadence} onChange={(e) => setCadence(e.target.value as any)}
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:border-[#3b82f6]">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div>
          <label htmlFor="alw-max-single" className="block text-xs text-slate-400 mb-1">Max/spend</label>
          <input id="alw-max-single" type="number" value={maxSingle} onChange={(e) => setMaxSingle(parseInt(e.target.value, 10))}
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 font-mono focus:outline-none focus:border-[#3b82f6]" />
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="flex-1 py-2 rounded-lg border border-slate-700 text-xs text-slate-400">Cancel</button>
        <button type="button"
          onClick={() => {
            onSave({
              recipientPubkey,
              totalAmount,
              tokenDenomination: denomination,
              cadence,
              constraints: {
                maxSingleSpend: maxSingle,
                dailyLimit: totalAmount,
                allowedRails: ['lightning', 'cashu'],
              },
              mintUrl: 'https://mint.minibits.cash/Bitcoin',
            });
            onClose();
          }}
          disabled={!recipientPubkey || totalAmount < denomination}
          className="flex-1 py-2 rounded-lg bg-[#3b82f6] text-white text-xs font-medium disabled:opacity-40">
          Create
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Bond Cards
// ============================================================================

function EntitlementCard({ bond }: { bond: EntitlementBond }) {
  return (
    <div className="py-2.5 border-b border-slate-800/50 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-slate-300 font-medium">{bond.featureId}</span>
        <StatusPill status={bond.status} />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">{bond.amount.toLocaleString()} sats</span>
        <span className={clsx(
          bond.expiresAt > nowSecs() ? 'text-slate-400' : 'text-red-400'
        )}>
          {formatExpiry(bond.expiresAt)}
        </span>
      </div>
    </div>
  );
}

function RecoveryCard({ bond }: { bond: RecoveryBond }) {
  const signed = bond.guardianBonds.filter((g) => g.signed).length;
  const pct = (signed / bond.threshold) * 100;

  return (
    <div className="py-2.5 border-b border-slate-800/50 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono text-slate-400">{bond.recoveryEventId.slice(0, 12)}…</span>
        <StatusPill status={bond.status} />
      </div>
      <div className="flex items-center gap-2 text-xs mb-2">
        <Users size={11} className="text-slate-500" aria-hidden="true" />
        <span className="text-slate-500">{signed}/{bond.threshold} signatures</span>
      </div>
      {/* Progress */}
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={clsx(
            'h-full rounded-full transition-all',
            signed >= bond.threshold ? 'bg-green-400' : 'bg-[#ffd700]'
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
          aria-label={`${signed} of ${bond.threshold} signatures`}
        />
      </div>
    </div>
  );
}

function AllowanceCard({ bond }: { bond: AllowanceBond }) {
  const remaining = bond.tokenCount - bond.tokensSpent;
  const pct = bond.tokenCount > 0 ? (remaining / bond.tokenCount) * 100 : 0;

  return (
    <div className="py-2.5 border-b border-slate-800/50 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono text-slate-400">{bond.recipientPubkey.slice(0, 16)}…</span>
        <StatusPill status={bond.status} />
      </div>
      <div className="flex items-center justify-between text-xs mb-2">
        <span className="text-slate-500">
          {remaining}/{bond.tokenCount} tokens · {(remaining * bond.tokenDenomination).toLocaleString()} sats left
        </span>
        <span className="text-slate-500 capitalize">{bond.cadence}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={clsx(
            'h-full rounded-full transition-all',
            pct > 60 ? 'bg-[#3b82f6]' : pct > 25 ? 'bg-yellow-400' : 'bg-red-400'
          )}
          style={{ width: `${Math.max(2, pct)}%` }}
          aria-label={`${pct.toFixed(0)}% remaining`}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export interface BondDashboardProps {
  className?: string;
}

export default function BondDashboard({ className }: BondDashboardProps) {
  const {
    entitlements,
    recoveryBonds,
    allowances,
    isLoading,
    error,
    createEntitlement,
    createRecoveryBond,
    createAllowance,
    clearError,
  } = useSig4Sats();

  const [showEntWizard, setShowEntWizard] = useState(false);
  const [showRecWizard, setShowRecWizard] = useState(false);
  const [showAlwWizard, setShowAlwWizard] = useState(false);

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield size={16} className="text-[#ffd700]" aria-hidden="true" />
        <h2 className="heading-display text-lg text-[#ffd700] tracking-wider">
          Bond Dashboard
        </h2>
      </div>

      {/* Loading/Error */}
      {isLoading && (
        <div className="flex items-center gap-2 text-xs text-slate-400 px-4 py-2 bg-slate-900 rounded-lg border border-slate-800" role="status">
          <Clock size={12} className="animate-spin" aria-hidden="true" />
          Processing bond operation…
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400" role="alert">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1">{error}</div>
          <button type="button" onClick={clearError} aria-label="Dismiss error" className="text-red-400/50 hover:text-red-400">
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Entitlement Tokens */}
      <Section
        title="Entitlement Tokens"
        icon={Key}
        color="#f7931a"
        count={entitlements.filter((e) => e.status === 'active').length}
        action={
          <button
            type="button"
            onClick={() => setShowEntWizard((v) => !v)}
            aria-label="Create entitlement token"
            className="flex items-center gap-1.5 mb-2 text-xs text-[#f7931a] hover:text-[#c46e00] transition-colors"
          >
            <Plus size={12} aria-hidden="true" />
            New Entitlement
          </button>
        }
      >
        {showEntWizard && (
          <EntitlementWizard
            onSave={(p) => createEntitlement(p)}
            onClose={() => setShowEntWizard(false)}
          />
        )}
        {entitlements.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-3">No entitlement tokens yet</p>
        ) : (
          entitlements.map((b, i) => <EntitlementCard key={i} bond={b} />)
        )}
      </Section>

      {/* Recovery Bonds */}
      <Section
        title="Recovery Bonds"
        icon={Shield}
        color="#ffd700"
        count={recoveryBonds.filter((b) => b.status === 'collecting' || b.status === 'threshold_met').length}
        action={
          <button
            type="button"
            onClick={() => setShowRecWizard((v) => !v)}
            aria-label="Create recovery bond"
            className="flex items-center gap-1.5 mb-2 text-xs text-[#ffd700] hover:text-[#ccb000] transition-colors"
          >
            <Plus size={12} aria-hidden="true" />
            New Recovery Bond
          </button>
        }
      >
        {showRecWizard && (
          <RecoveryWizard
            onSave={(p) => createRecoveryBond(p)}
            onClose={() => setShowRecWizard(false)}
          />
        )}
        {recoveryBonds.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-3">No recovery bonds active</p>
        ) : (
          recoveryBonds.map((b, i) => <RecoveryCard key={i} bond={b} />)
        )}
      </Section>

      {/* Allowance Bonds */}
      <Section
        title="Allowance Bonds"
        icon={Gift}
        color="#3b82f6"
        count={allowances.filter((a) => a.status === 'active').length}
        action={
          <button
            type="button"
            onClick={() => setShowAlwWizard((v) => !v)}
            aria-label="Create allowance bond"
            className="flex items-center gap-1.5 mb-2 text-xs text-[#3b82f6] hover:text-[#2563eb] transition-colors"
          >
            <Plus size={12} aria-hidden="true" />
            New Allowance
          </button>
        }
      >
        {showAlwWizard && (
          <AllowanceWizard
            onSave={(p) => createAllowance(p)}
            onClose={() => setShowAlwWizard(false)}
          />
        )}
        {allowances.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-3">No allowance bonds yet</p>
        ) : (
          allowances.map((b, i) => <AllowanceCard key={i} bond={b} />)
        )}
      </Section>
    </div>
  );
}

