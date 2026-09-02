/**
 * CreditEnvelopePanel — Credit envelope state machine visualization
 * Phase 3: CEPS credit envelope monitoring
 *
 * Displays:
 * - Envelope status (intent → offer → envelope → spend_auth → settlement)
 * - Visual state machine progress indicator
 * - Max budget vs. authorized spend
 * - Settlement/default actions
 */

import React from 'react';
import clsx from 'clsx';
import {
  FileText,
  Users2,
  Package,
  CreditCard,
  CheckCircle2,
  XCircle,
  Zap,
  Loader2,
} from 'lucide-react';
import { useCreditLifecycle } from '../../hooks/useCreditLifecycle.js';
import type { CreditEnvelope, CreditState as CreditLifecycleState } from '../../hooks/useCreditLifecycle.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreditEnvelopePanelProps {
  agentId?: string;
  jobId?: string;
}

// ---------------------------------------------------------------------------
// State machine config — maps to actual CreditLifecycleState values
// ---------------------------------------------------------------------------

type UiStateId = CreditLifecycleState;

const STATES: Array<{
  id: UiStateId;
  label: string;
  description: string;
  Icon: typeof FileText;
  color: string;
  textColor: string;
}> = [
  {
    id: 'intent_published',
    label: 'Intent',
    description: 'Job request announced',
    Icon: FileText,
    color: 'bg-slate-600',
    textColor: 'text-slate-400',
  },
  {
    id: 'offer_received',
    label: 'Offer',
    description: 'Provider offered terms',
    Icon: Users2,
    color: 'bg-blue-600',
    textColor: 'text-blue-400',
  },
  {
    id: 'envelope_constructed',
    label: 'Envelope',
    description: 'Credit committed',
    Icon: Package,
    color: 'bg-[#f7931a]',
    textColor: 'text-[#f7931a]',
  },
  {
    id: 'spend_authorized',
    label: 'Spend Auth',
    description: 'Spend authorized',
    Icon: CreditCard,
    color: 'bg-yellow-600',
    textColor: 'text-yellow-400',
  },
  {
    id: 'settled',
    label: 'Settled',
    description: 'Payment complete',
    Icon: CheckCircle2,
    color: 'bg-green-600',
    textColor: 'text-green-400',
  },
];

const STATE_ORDER: Partial<Record<CreditLifecycleState, number>> = {
  intent_published: 0,
  offer_received: 1,
  envelope_constructed: 2,
  spend_authorized: 3,
  settled: 4,
  defaulted: -1,
  revoked: -1,
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

function getStateIndex(state: CreditLifecycleState): number {
  return STATE_ORDER[state] ?? -1;
}

// ---------------------------------------------------------------------------
// State machine visualization
// ---------------------------------------------------------------------------

function StateMachineViz({ currentState }: { currentState: CreditLifecycleState }) {
  if (currentState === 'defaulted' || currentState === 'revoked') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/10 border border-red-900/30">
        <XCircle size={16} className="text-red-500 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-red-400">
            {currentState === 'defaulted' ? 'Default' : 'Revoked'}
          </p>
          <p className="text-xs text-red-500/70">
            {currentState === 'defaulted'
              ? 'Envelope defaulted — performance bond may be claimed'
              : 'Envelope revoked'}
          </p>
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
  onSettle?: (id: string, agentPubkey: string, governorPubkey: string) => void;
  isLoading?: boolean;
}) {
  const maxSats = envelope.maxSats;

  return (
    <div className="card space-y-5">
      {/* Envelope ID + timestamp */}
      <div className="flex items-center justify-between">
        <div>
          <code className="font-mono text-xs text-[#555555]">{envelope.eventId.slice(0, 20)}…</code>
          <p className="text-[10px] text-[#555555] mt-0.5">
            Expires {formatTimestamp(envelope.expiresAt)}
          </p>
        </div>
      </div>

      {/* State machine */}
      <StateMachineViz currentState={envelope.state} />

      {/* Budget visualization */}
      <div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-[#555555]">Max budget</span>
          <span className="font-mono text-[#f5f5f5]">
            {formatSats(maxSats)} sats
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#f7931a]"
            style={{ width: '100%' }}
            role="progressbar"
            aria-valuenow={maxSats}
            aria-valuemax={maxSats}
            aria-label="Budget"
          />
        </div>
      </div>

      {/* Provider link */}
      <div className="flex items-center gap-2">
        <Zap size={13} className="text-[#f7931a]" />
        <span className="text-xs text-[#555555]">
          Agent: <code className="font-mono text-[#a0a0a0]">{envelope.agentPubkey.slice(0, 16)}…</code>
        </span>
      </div>

      {/* Actions */}
      {envelope.state === 'envelope_constructed' && onSettle && (
        <button
          type="button"
          onClick={() => onSettle(envelope.eventId, envelope.agentPubkey, envelope.governorPubkey)}
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

export default function CreditEnvelopePanel({ agentId, jobId: _jobId }: CreditEnvelopePanelProps) {
  const { envelopes, settleEnvelope, isLoading } = useCreditLifecycle(null, null, null);

  // Filter to relevant envelopes if agentId provided
  const relevantEnvelopes = envelopes.filter(e => {
    if (agentId && e.agentPubkey !== agentId) return false;
    return true;
  });

  const handleSettle = async (id: string, agentPubkey: string, governorPubkey: string) => {
    await settleEnvelope(id, agentPubkey, governorPubkey, 5, 0);
  };

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
            {relevantEnvelopes.filter(e => e.state === 'settled').length}
          </p>
          <p className="text-[10px] text-[#555555] uppercase tracking-widest">Settled</p>
        </div>
        <div className="px-3 py-2 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] text-center">
          <p className="font-bold text-lg text-red-400">
            {relevantEnvelopes.filter(e => e.state === 'defaulted').length}
          </p>
          <p className="text-[10px] text-[#555555] uppercase tracking-widest">Defaulted</p>
        </div>
      </div>

      {/* Envelope cards */}
      <div className="space-y-4">
        {relevantEnvelopes.map(envelope => (
          <EnvelopeCard
            key={envelope.eventId}
            envelope={envelope}
            onSettle={handleSettle}
            isLoading={isLoading}
          />
        ))}
      </div>
    </div>
  );
}
