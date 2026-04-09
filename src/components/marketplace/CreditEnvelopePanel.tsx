/**
 * CreditEnvelopePanel — Credit envelope state machine visualization
 * Phase 3: CEPS credit envelope monitoring
 *
 * Displays:
 * - Envelope status (Intent → Offer → Envelope → SpendAuth → Settlement)
 * - Visual state machine progress indicator
 * - Max budget vs. spent
 * - Performance bond status
 * - Settlement/default actions
 */

import clsx from 'clsx';
import {
  FileText,
  Users2,
  Package,
  CreditCard,
  CheckCircle2,
  XCircle,
  Zap,
  Shield,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { useCreditLifecycle } from '../../hooks/useCreditLifecycle.js';
import type { CreditEnvelope, CreditState } from '../../hooks/useCreditLifecycle.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreditEnvelopePanelProps {
  agentId?: string;
  jobId?: string;
}

// ---------------------------------------------------------------------------
// State machine config
// ---------------------------------------------------------------------------

const STATES: Array<{
  id: CreditState;
  label: string;
  description: string;
  Icon: typeof FileText;
  color: string;
  textColor: string;
}> = [
  {
    id: 'Intent',
    label: 'Intent',
    description: 'Job request announced',
    Icon: FileText,
    color: 'bg-slate-600',
    textColor: 'text-slate-400',
  },
  {
    id: 'Offer',
    label: 'Offer',
    description: 'Provider offered terms',
    Icon: Users2,
    color: 'bg-blue-600',
    textColor: 'text-blue-400',
  },
  {
    id: 'Envelope',
    label: 'Envelope',
    description: 'Credit committed',
    Icon: Package,
    color: 'bg-[#f7931a]',
    textColor: 'text-[#f7931a]',
  },
  {
    id: 'SpendAuth',
    label: 'Spend Auth',
    description: 'Spend authorized',
    Icon: CreditCard,
    color: 'bg-yellow-600',
    textColor: 'text-yellow-400',
  },
  {
    id: 'Settlement',
    label: 'Settled',
    description: 'Payment complete',
    Icon: CheckCircle2,
    color: 'bg-green-600',
    textColor: 'text-green-400',
  },
];

const STATE_ORDER: Record<CreditState, number> = {
  Intent: 0,
  Offer: 1,
  Envelope: 2,
  SpendAuth: 3,
  Settlement: 4,
  Default: -1, // terminal failure state
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSats(sats: number): string {
  return sats.toLocaleString();
}

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStateIndex(state: CreditState): number {
  return STATE_ORDER[state] ?? -1;
}

// ---------------------------------------------------------------------------
// State machine visualization
// ---------------------------------------------------------------------------

function StateMachineViz({ currentState }: { currentState: CreditState }) {
  if (currentState === 'Default') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/10 border border-red-900/30">
        <XCircle size={16} className="text-red-500 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-red-400">Default</p>
          <p className="text-xs text-red-500/70">Envelope defaulted — performance bond may be claimed</p>
        </div>
      </div>
    );
  }

  const currentIdx = getStateIndex(currentState);

  return (
    <div className="relative">
      {/* Mobile: vertical layout */}
      <div className="flex flex-col gap-2 sm:hidden">
        {STATES.map((state, idx) => {
          const completed = idx < currentIdx;
          const active = idx === currentIdx;
          const pending = idx > currentIdx;
          const { Icon } = state;

          return (
            <div key={state.id} className="flex items-center gap-3">
              <div className={clsx(
                'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border-2',
                completed && 'bg-green-600 border-green-600',
                active && `${state.color} border-current`,
                pending && 'bg-[#1a1a1a] border-[#2a2a2a]',
              )}>
                {completed ? (
                  <CheckCircle2 size={14} className="text-white" />
                ) : (
                  <Icon size={14} className={clsx(active ? 'text-white' : 'text-[#555555]')} />
                )}
              </div>
              <div>
                <p className={clsx(
                  'text-sm font-medium',
                  completed && 'text-green-400',
                  active && state.textColor,
                  pending && 'text-[#555555]',
                )}>
                  {state.label}
                  {active && <span className="ml-2 text-[10px] bg-current/20 px-1.5 py-0.5 rounded-full">Current</span>}
                </p>
                <p className="text-xs text-[#555555]">{state.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop: horizontal layout */}
      <div className="hidden sm:flex items-center gap-1" role="progressbar" aria-label="Credit envelope progress">
        {STATES.map((state, idx) => {
          const completed = idx < currentIdx;
          const active = idx === currentIdx;
          const { Icon } = state;

          return (
            <React.Fragment key={state.id}>
              <div className="flex flex-col items-center gap-1">
                <div
                  className={clsx(
                    'w-9 h-9 rounded-full flex items-center justify-center transition-all border-2',
                    completed && 'bg-green-600 border-green-600',
                    active && `${state.color} border-transparent`,
                    !completed && !active && 'bg-[#1a1a1a] border-[#2a2a2a]',
                  )}
                  aria-label={`${state.label}: ${completed ? 'completed' : active ? 'current' : 'pending'}`}
                >
                  {completed ? (
                    <CheckCircle2 size={16} className="text-white" />
                  ) : (
                    <Icon size={16} className={active ? 'text-white' : 'text-[#555555]'} />
                  )}
                </div>
                <span className={clsx(
                  'text-[9px] font-medium text-center',
                  completed && 'text-green-400',
                  active && state.textColor,
                  !completed && !active && 'text-[#555555]',
                )}>
                  {state.label}
                </span>
              </div>
              {idx < STATES.length - 1 && (
                <div
                  className={clsx(
                    'flex-1 h-0.5 mb-4 transition-colors',
                    idx < currentIdx ? 'bg-green-600' : 'bg-[#2a2a2a]',
                  )}
                  aria-hidden="true"
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Envelope card
// ---------------------------------------------------------------------------

function EnvelopeCard({
  envelope,
  onSettle,
  isLoading,
}: {
  envelope: CreditEnvelope;
  onSettle?: (id: string) => void;
  isLoading?: boolean;
}) {
  const budgetPct = envelope.maxBudgetSats > 0
    ? Math.min(100, (envelope.spentSats / envelope.maxBudgetSats) * 100)
    : 0;

  return (
    <div className="card space-y-5">
      {/* Envelope ID + timestamp */}
      <div className="flex items-center justify-between">
        <div>
          <code className="font-mono text-xs text-[#555555]">{envelope.id.slice(0, 20)}…</code>
          <p className="text-[10px] text-[#555555] mt-0.5">Created {formatTimestamp(envelope.createdAt)}</p>
        </div>
        {envelope.expiresAt && (
          <p className="text-[10px] text-[#555555]">
            Expires {formatTimestamp(envelope.expiresAt)}
          </p>
        )}
      </div>

      {/* State machine */}
      <StateMachineViz currentState={envelope.state} />

      {/* Budget visualization */}
      <div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-[#555555]">Budget usage</span>
          <span className="font-mono text-[#f5f5f5]">
            {formatSats(envelope.spentSats)} / {formatSats(envelope.maxBudgetSats)} sats
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className={clsx(
              'h-full rounded-full transition-all duration-500',
              budgetPct > 90 ? 'bg-red-600' : budgetPct > 70 ? 'bg-yellow-600' : 'bg-[#f7931a]',
            )}
            style={{ width: `${budgetPct}%` }}
            role="progressbar"
            aria-valuenow={envelope.spentSats}
            aria-valuemax={envelope.maxBudgetSats}
            aria-label="Budget usage"
          />
        </div>
        <div className="flex justify-between text-xs text-[#555555] mt-1">
          <span>{budgetPct.toFixed(1)}% used</span>
          <span>{formatSats(envelope.maxBudgetSats - envelope.spentSats)} sats remaining</span>
        </div>
      </div>

      {/* Performance bond */}
      {envelope.performanceBond !== undefined && (
        <div className="flex items-center gap-2">
          <Shield size={13} className="text-[#555555]" />
          <span className="text-xs text-[#555555]">
            Performance bond: <span className="text-[#a0a0a0] font-mono">{formatSats(envelope.performanceBond)} sats</span>
          </span>
        </div>
      )}

      {/* Provider link */}
      {envelope.providerPubkey && (
        <div className="flex items-center gap-2">
          <Zap size={13} className="text-[#f7931a]" />
          <span className="text-xs text-[#555555]">
            Provider: <code className="font-mono text-[#a0a0a0]">{envelope.providerPubkey.slice(0, 16)}…</code>
          </span>
        </div>
      )}

      {/* Actions */}
      {envelope.state === 'Envelope' && onSettle && (
        <button
          type="button"
          onClick={() => onSettle(envelope.id)}
          disabled={isLoading}
          aria-label="Settle envelope"
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          {isLoading ? 'Settling…' : 'Settle Envelope'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function CreditEnvelopePanel({ agentId, jobId }: CreditEnvelopePanelProps) {
  const { envelopes, settleEnvelope, isLoading } = useCreditLifecycle();

  // Filter to relevant envelopes if agentId or jobId provided
  const relevantEnvelopes = envelopes.filter(e => {
    if (agentId && e.agentId !== agentId) return false;
    if (jobId && e.jobId !== jobId) return false;
    return true;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={24} className="animate-spin text-[#555555]" />
      </div>
    );
  }

  if (relevantEnvelopes.length === 0) {
    return (
      <div className="text-center py-10">
        <CreditCard size={32} className="mx-auto text-[#555555] mb-3" />
        <p className="text-sm text-[#555555]">No credit envelopes</p>
        <p className="text-xs text-[#555555] mt-1">
          Credit envelopes are created when you submit jobs to providers
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="px-3 py-2 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-center">
          <p className="font-bold text-lg text-[#f5f5f5]">{relevantEnvelopes.length}</p>
          <p className="text-[10px] text-[#555555] uppercase tracking-widest">Total</p>
        </div>
        <div className="px-3 py-2 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-center">
          <p className="font-bold text-lg text-green-400">
            {relevantEnvelopes.filter(e => e.state === 'Settlement').length}
          </p>
          <p className="text-[10px] text-[#555555] uppercase tracking-widest">Settled</p>
        </div>
        <div className="px-3 py-2 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-center">
          <p className="font-bold text-lg text-red-400">
            {relevantEnvelopes.filter(e => e.state === 'Default').length}
          </p>
          <p className="text-[10px] text-[#555555] uppercase tracking-widest">Defaulted</p>
        </div>
      </div>

      {/* Envelope cards */}
      <div className="space-y-4">
        {relevantEnvelopes.map(envelope => (
          <EnvelopeCard
            key={envelope.id}
            envelope={envelope}
            onSettle={settleEnvelope}
            isLoading={isLoading}
          />
        ))}
      </div>
    </div>
  );
}

