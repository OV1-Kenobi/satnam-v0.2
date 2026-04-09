/**
 * @module components/payments/AtomicSwapPanel
 * @description Atomic swap interface for moving sats between rails (Lightning ↔ Cashu ↔ on-chain).
 *
 * Features:
 * - Source/destination rail selector (mint/wallet/on-chain)
 * - Amount input with fee preview
 * - Step-by-step execution progress (CSS-only)
 * - Swap history table
 */

import { useState, useCallback } from 'react';
import clsx from 'clsx';
import {
  ArrowLeftRight,
  Zap,
  Coins,
  Server,
  Bitcoin,
  ArrowDown,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ChevronDown,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type SwapRail = 'lightning' | 'cashu' | 'lnbits' | 'onchain';

interface SwapStep {
  label: string;
  status: 'pending' | 'active' | 'complete' | 'error';
  detail?: string;
}

type SwapStatus = 'idle' | 'preparing' | 'executing' | 'complete' | 'error';

interface SwapRecord {
  id: string;
  fromRail: SwapRail;
  toRail: SwapRail;
  amountSats: number;
  feeSats: number;
  status: 'complete' | 'failed' | 'pending';
  timestamp: number;
  txId?: string;
}

// ============================================================================
// Constants
// ============================================================================

const RAIL_META: Record<SwapRail, { label: string; color: string; icon: typeof Zap; description: string }> = {
  lightning: { label: 'Lightning', color: '#f7931a', icon: Zap, description: 'NWC wallet' },
  cashu: { label: 'Cashu', color: '#a855f7', icon: Coins, description: 'Ecash mint' },
  lnbits: { label: 'LNbits', color: '#22c55e', icon: Server, description: 'LNbits wallet' },
  onchain: { label: 'On-chain', color: '#3b82f6', icon: Bitcoin, description: 'Bitcoin' },
};

// Fee estimates (in % of amount)
const FEE_ESTIMATES: Partial<Record<`${SwapRail}-${SwapRail}`, number>> = {
  'lightning-cashu': 0.1,
  'cashu-lightning': 0.1,
  'lightning-lnbits': 0.05,
  'lnbits-lightning': 0.05,
  'lightning-onchain': 0.5,
  'cashu-onchain': 0.6,
  'lnbits-onchain': 0.6,
  'cashu-lnbits': 0.15,
  'lnbits-cashu': 0.15,
};

function getSwapSteps(from: SwapRail, to: SwapRail): SwapStep[] {
  const steps: SwapStep[] = [
    { label: 'Verify balances', status: 'pending' },
    { label: `Lock ${RAIL_META[from].label} funds`, status: 'pending' },
    { label: 'Create swap invoice', status: 'pending' },
  ];

  if (to === 'onchain') {
    steps.push({ label: 'Broadcast transaction', status: 'pending' });
    steps.push({ label: 'Await confirmation', status: 'pending' });
  } else {
    steps.push({ label: `Credit ${RAIL_META[to].label}`, status: 'pending' });
  }
  steps.push({ label: 'Swap complete', status: 'pending' });
  return steps;
}

function getMockHistory(): SwapRecord[] {
  return [
    {
      id: 'swap-1',
      fromRail: 'lightning',
      toRail: 'cashu',
      amountSats: 10_000,
      feeSats: 10,
      status: 'complete',
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    },
    {
      id: 'swap-2',
      fromRail: 'cashu',
      toRail: 'lnbits',
      amountSats: 2_500,
      feeSats: 4,
      status: 'complete',
      timestamp: Math.floor(Date.now() / 1000) - 86400,
    },
    {
      id: 'swap-3',
      fromRail: 'lightning',
      toRail: 'onchain',
      amountSats: 50_000,
      feeSats: 250,
      status: 'failed',
      timestamp: Math.floor(Date.now() / 1000) - 172800,
    },
  ];
}

// ============================================================================
// Sub-components
// ============================================================================

function RailSelector({
  value,
  onChange,
  exclude,
  label,
  id,
}: {
  value: SwapRail;
  onChange: (r: SwapRail) => void;
  exclude?: SwapRail;
  label: string;
  id: string;
}) {
  const [open, setOpen] = useState(false);
  const meta = RAIL_META[value];
  const rails = (Object.keys(RAIL_META) as SwapRail[]).filter((r) => r !== exclude);

  return (
    <div className="relative">
      <p className="text-xs text-slate-500 mb-1.5">{label}</p>
      <button
        type="button"
        id={id}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Select ${label}: currently ${meta.label}`}
        className="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-slate-700 bg-slate-800 hover:border-slate-600 transition-colors text-left"
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${meta.color}20` }}
        >
          <meta.icon size={16} style={{ color: meta.color }} aria-hidden="true" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-200">{meta.label}</p>
          <p className="text-xs text-slate-500">{meta.description}</p>
        </div>
        <ChevronDown size={14} className={clsx('text-slate-500 transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden z-20 shadow-xl"
          role="listbox"
          aria-label={`${label} options`}
        >
          {rails.map((rail) => {
            const m = RAIL_META[rail];
            return (
              <button
                key={rail}
                type="button"
                role="option"
                aria-selected={rail === value}
                onClick={() => { onChange(rail); setOpen(false); }}
                className={clsx(
                  'w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-700 transition-colors text-left',
                  rail === value && 'bg-slate-700/50'
                )}
              >
                <m.icon size={14} style={{ color: m.color }} aria-hidden="true" />
                <div>
                  <p className="text-sm text-slate-200">{m.label}</p>
                  <p className="text-xs text-slate-500">{m.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SwapProgressSteps({ steps }: { steps: SwapStep[] }) {
  return (
    <div className="space-y-2" role="list" aria-label="Swap progress steps">
      {steps.map((step, i) => (
        <div
          key={i}
          role="listitem"
          className={clsx(
            'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
            step.status === 'active' && 'bg-[#f7931a]/10 border border-[#f7931a]/20',
            step.status === 'complete' && 'bg-green-500/5',
            step.status === 'error' && 'bg-red-500/10',
            step.status === 'pending' && 'opacity-50',
          )}
        >
          {step.status === 'complete' && (
            <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" aria-hidden="true" />
          )}
          {step.status === 'active' && (
            <Loader2 size={16} className="text-[#f7931a] animate-spin flex-shrink-0" aria-hidden="true" />
          )}
          {step.status === 'error' && (
            <XCircle size={16} className="text-red-400 flex-shrink-0" aria-hidden="true" />
          )}
          {step.status === 'pending' && (
            <Clock size={16} className="text-slate-600 flex-shrink-0" aria-hidden="true" />
          )}
          <div>
            <p className={clsx(
              'text-sm',
              step.status === 'active' ? 'text-[#f7931a] font-medium' :
              step.status === 'complete' ? 'text-green-400' :
              step.status === 'error' ? 'text-red-400' : 'text-slate-500'
            )}>
              {step.label}
            </p>
            {step.detail && <p className="text-xs text-slate-500">{step.detail}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryRow({ record }: { record: SwapRecord }) {
  const from = RAIL_META[record.fromRail];
  const to = RAIL_META[record.toRail];
  const ago = Math.floor(Date.now() / 1000) - record.timestamp;
  const agoLabel = ago < 3600 ? `${Math.floor(ago / 60)}m` : ago < 86400 ? `${Math.floor(ago / 3600)}h` : `${Math.floor(ago / 86400)}d`;

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-800/50 last:border-0">
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <from.icon size={12} style={{ color: from.color }} aria-hidden="true" />
        <ArrowLeftRight size={10} className="text-slate-600" aria-hidden="true" />
        <to.icon size={12} style={{ color: to.color }} aria-hidden="true" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-300">
          {from.label} → {to.label}
        </p>
        <p className="text-[10px] text-slate-500">{agoLabel} ago · {record.feeSats} sat fee</p>
      </div>

      <div className="text-right flex-shrink-0">
        <p className="text-xs font-mono text-slate-200">{record.amountSats.toLocaleString()}</p>
        <p className={clsx('text-[10px]',
          record.status === 'complete' ? 'text-green-400' :
          record.status === 'failed' ? 'text-red-400' : 'text-yellow-400'
        )}>
          {record.status}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export interface AtomicSwapPanelProps {
  className?: string;
}

export default function AtomicSwapPanel({ className }: AtomicSwapPanelProps) {
  const [fromRail, setFromRail] = useState<SwapRail>('lightning');
  const [toRail, setToRail] = useState<SwapRail>('cashu');
  const [amount, setAmount] = useState<number>(10_000);
  const [swapStatus, setSwapStatus] = useState<SwapStatus>('idle');
  const [steps, setSteps] = useState<SwapStep[]>([]);
  const [history, setHistory] = useState<SwapRecord[]>(getMockHistory());
  const [error, setError] = useState<string | null>(null);

  const feeKey = `${fromRail}-${toRail}` as `${SwapRail}-${SwapRail}`;
  const feePct = FEE_ESTIMATES[feeKey] ?? 0.3;
  const feeSats = Math.ceil(amount * feePct / 100);
  const receiveAmount = Math.max(0, amount - feeSats);

  // Swap rails
  const handleFlip = useCallback(() => {
    setFromRail(toRail);
    setToRail(fromRail);
  }, [fromRail, toRail]);

  // Prevent source = destination
  const handleFromChange = useCallback((r: SwapRail) => {
    setFromRail(r);
    if (r === toRail) setToRail(fromRail);
  }, [fromRail, toRail]);

  const handleToChange = useCallback((r: SwapRail) => {
    setToRail(r);
    if (r === fromRail) setFromRail(toRail);
  }, [fromRail, toRail]);

  // Execute swap simulation
  const executeSwap = useCallback(async () => {
    if (amount <= 0 || fromRail === toRail) return;
    setError(null);
    setSwapStatus('preparing');

    const swapSteps = getSwapSteps(fromRail, toRail);
    setSteps(swapSteps.map((s) => ({ ...s, status: 'pending' })));

    // Simulate step-by-step execution
    for (let i = 0; i < swapSteps.length; i++) {
      setSteps((prev) =>
        prev.map((s, idx) =>
          idx === i ? { ...s, status: 'active' } : s
        )
      );
      setSwapStatus('executing');

      await new Promise((r) => setTimeout(r, 800 + Math.random() * 600));

      // 10% chance of failure for demo purposes
      if (i === swapSteps.length - 2 && Math.random() < 0.1) {
        setSteps((prev) =>
          prev.map((s, idx) =>
            idx === i ? { ...s, status: 'error', detail: 'Insufficient liquidity' } : s
          )
        );
        setSwapStatus('error');
        setError('Swap failed: insufficient liquidity on route');
        return;
      }

      setSteps((prev) =>
        prev.map((s, idx) =>
          idx === i ? { ...s, status: 'complete' } : s
        )
      );
    }

    // Add to history
    const record: SwapRecord = {
      id: `swap-${Date.now()}`,
      fromRail,
      toRail,
      amountSats: amount,
      feeSats,
      status: 'complete',
      timestamp: Math.floor(Date.now() / 1000),
    };
    setHistory((prev) => [record, ...prev]);
    setSwapStatus('complete');
  }, [amount, fromRail, toRail, feeSats]);

  const resetSwap = useCallback(() => {
    setSwapStatus('idle');
    setSteps([]);
    setError(null);
  }, []);

  const isExecuting = swapStatus === 'preparing' || swapStatus === 'executing';

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <ArrowLeftRight size={16} className="text-[#3b82f6]" aria-hidden="true" />
        <h2 className="heading-display text-lg text-[#3b82f6] tracking-wider">
          Atomic Swaps
        </h2>
      </div>

      {/* Swap form */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
        <RailSelector
          value={fromRail}
          onChange={handleFromChange}
          exclude={toRail}
          label="From"
          id="swap-from"
        />

        {/* Flip button */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={handleFlip}
            aria-label="Flip swap direction"
            className="p-2 rounded-full bg-slate-800 border border-slate-700 hover:border-[#3b82f6]/50 hover:bg-slate-700 transition-colors"
          >
            <ArrowDown size={16} className="text-[#3b82f6]" aria-hidden="true" />
          </button>
        </div>

        <RailSelector
          value={toRail}
          onChange={handleToChange}
          exclude={fromRail}
          label="To"
          id="swap-to"
        />

        {/* Amount */}
        <div>
          <label htmlFor="swap-amount" className="block text-xs text-slate-500 mb-1.5">
            Amount (sats)
          </label>
          <input
            id="swap-amount"
            type="number"
            min={1}
            value={amount || ''}
            onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)}
            placeholder="e.g. 10000"
            className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-mono text-lg focus:outline-none focus:border-[#3b82f6] transition-colors"
            aria-label="Swap amount in sats"
          />
        </div>

        {/* Fee preview */}
        {amount > 0 && (
          <div className="rounded-xl bg-slate-800/50 border border-slate-700/50 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Swap fee ({feePct}%)</span>
              <span className="font-mono text-yellow-400">−{feeSats.toLocaleString()} sats</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">You receive</span>
              <span className="font-mono font-bold text-green-400">{receiveAmount.toLocaleString()} sats</span>
            </div>
            <div className="h-px bg-slate-700" />
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Powered by</span>
              <span className="text-[#3b82f6]">Boltz Exchange</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400" role="alert">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* Execute / Reset */}
        {swapStatus === 'idle' || swapStatus === 'error' ? (
          <button
            type="button"
            onClick={swapStatus === 'error' ? resetSwap : executeSwap}
            disabled={amount <= 0 || fromRail === toRail}
            className={clsx(
              'w-full py-3 rounded-xl font-medium text-sm transition-colors',
              swapStatus === 'error'
                ? 'bg-slate-800 text-slate-400 hover:bg-slate-700 border border-slate-700'
                : 'bg-[#3b82f6] text-white hover:bg-[#2563eb] disabled:opacity-40 disabled:cursor-not-allowed'
            )}
            aria-label={swapStatus === 'error' ? 'Reset swap' : `Swap ${amount.toLocaleString()} sats from ${RAIL_META[fromRail].label} to ${RAIL_META[toRail].label}`}
          >
            {swapStatus === 'error' ? (
              <span className="flex items-center justify-center gap-2">
                <RefreshCw size={14} aria-hidden="true" /> Try Again
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <ArrowLeftRight size={14} aria-hidden="true" />
                Swap {amount.toLocaleString()} sats
              </span>
            )}
          </button>
        ) : (
          <button
            type="button"
            disabled={isExecuting}
            className="w-full py-3 rounded-xl font-medium text-sm bg-green-500/10 border border-green-500/20 text-green-400 cursor-default"
            aria-label={swapStatus === 'complete' ? 'Swap complete' : 'Swap executing'}
          >
            <span className="flex items-center justify-center gap-2">
              {swapStatus === 'complete' ? (
                <><CheckCircle2 size={14} aria-hidden="true" /> Swap Complete</>
              ) : (
                <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Executing…</>
              )}
            </span>
          </button>
        )}
      </div>

      {/* Progress steps */}
      {steps.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <h3 className="text-xs text-slate-500 uppercase tracking-widest mb-3">Progress</h3>
          <SwapProgressSteps steps={steps} />
          {swapStatus === 'complete' && (
            <button
              type="button"
              onClick={resetSwap}
              className="mt-3 w-full py-2 rounded-lg text-xs text-slate-400 border border-slate-700 hover:border-slate-600 transition-colors"
            >
              New Swap
            </button>
          )}
        </div>
      )}

      {/* History */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl">
        <div className="px-4 py-3 border-b border-slate-800">
          <h3 className="text-xs text-slate-500 uppercase tracking-widest">Swap History</h3>
        </div>
        <div className="px-4">
          {history.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No swaps yet</p>
          ) : (
            history.map((r) => <HistoryRow key={r.id} record={r} />)
          )}
        </div>
      </div>
    </div>
  );
}

