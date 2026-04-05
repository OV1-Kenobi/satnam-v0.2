/**
 * FinancialTrustPanel — Financial trust & reputation
 * Spec: circle-of-trust-spec.md § FinancialTrustPanel
 *
 * - Payment history summary
 * - Credit envelope settlement rate (CSS bar)
 * - Reputation delta chart (CSS bars over time)
 * - Sig4Sats bond history
 *
 * CSS-only charts — no chart library.
 */

import React from 'react';
import clsx from 'clsx';
import {
  Zap,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  Clock,
  Bitcoin,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaymentRecord {
  id: string;
  contactPubkey: string;
  contactLabel?: string;
  amountSats: number;
  direction: 'sent' | 'received';
  status: 'settled' | 'pending' | 'failed';
  timestamp: number;
}

interface ReputationDelta {
  period: string; // e.g. "Jan", "Feb"
  delta: number;  // -100 to +100
}

interface FinancialTrustPanelProps {
  paymentHistory?: PaymentRecord[];
  settlementRate?: number;          // 0–1
  reputationDeltas?: ReputationDelta[];
  totalSettledSats?: number;
  totalPendingSats?: number;
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Settlement rate bar
// ---------------------------------------------------------------------------

function SettlementBar({ rate }: { rate: number }) {
  const pct = Math.min(100, Math.max(0, rate * 100));
  const color = rate >= 0.9 ? '#22c55e' : rate >= 0.7 ? '#f7931a' : '#ef4444';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[#a0a0a0] font-medium">Credit Envelope Settlement Rate</span>
        <span className="font-mono font-bold text-sm" style={{ color }}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div
        className="h-3 rounded-full bg-[#2a2a2a] overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Settlement rate"
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 8px ${color}60` }}
        />
      </div>
      <p className="text-[11px] text-[#555555]">
        {rate >= 0.9 ? 'Excellent' : rate >= 0.7 ? 'Good' : 'Needs improvement'} — based on credit envelope history
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reputation delta chart (CSS bars)
// ---------------------------------------------------------------------------

function ReputationChart({ deltas }: { deltas: ReputationDelta[] }) {
  if (deltas.length === 0) return null;

  const maxAbs = Math.max(...deltas.map(d => Math.abs(d.delta)), 1);

  return (
    <div className="space-y-2">
      <p className="text-xs text-[#555555] uppercase tracking-wider">Reputation Delta</p>
      <div
        className="flex items-end gap-1.5 h-20"
        role="img"
        aria-label="Reputation delta chart"
      >
        {deltas.map((d, i) => {
          const positive = d.delta >= 0;
          const barH = Math.round((Math.abs(d.delta) / maxAbs) * 60);
          const color = positive ? '#22c55e' : '#ef4444';
          return (
            <div key={i} className="flex flex-col items-center gap-0.5 flex-1 min-w-0">
              {/* Bar (top half for positive, aligned to bottom) */}
              <div className="flex flex-col justify-end h-16 w-full">
                {positive && (
                  <div
                    className="w-full rounded-t transition-all duration-500"
                    style={{ height: barH, backgroundColor: color, opacity: 0.85 }}
                    title={`${d.period}: +${d.delta}`}
                  />
                )}
                {!positive && (
                  <div
                    className="w-full rounded-b transition-all duration-500"
                    style={{ height: barH, backgroundColor: color, opacity: 0.85 }}
                    title={`${d.period}: ${d.delta}`}
                  />
                )}
              </div>
              <span className="text-[9px] text-[#555555] truncate w-full text-center">{d.period}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment row
// ---------------------------------------------------------------------------

function PaymentRow({ record }: { record: PaymentRecord }) {
  const statusIcon = record.status === 'settled'
    ? <CheckCircle2 size={13} className="text-green-500" aria-hidden="true" />
    : record.status === 'failed'
    ? <XCircle size={13} className="text-red-500" aria-hidden="true" />
    : <Clock size={13} className="text-amber-500" aria-hidden="true" />;

  const date = new Date(record.timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  });

  return (
    <div className="flex items-center gap-3" role="listitem">
      <div className={clsx(
        'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
        record.direction === 'sent' ? 'bg-[#f7931a]/15' : 'bg-[#22c55e]/15',
      )}>
        <Zap
          size={13}
          style={{ color: record.direction === 'sent' ? '#f7931a' : '#22c55e' }}
          aria-hidden="true"
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#f5f5f5] truncate">
          {record.direction === 'sent' ? 'Sent to' : 'Received from'}{' '}
          <span className="font-mono text-xs text-[#a0a0a0]">
            {record.contactLabel ?? `${record.contactPubkey.slice(0, 8)}…`}
          </span>
        </p>
        <p className="text-xs text-[#555555]">{date}</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {statusIcon}
        <span className="font-mono text-sm font-bold text-[#f5f5f5]">
          {record.direction === 'sent' ? '-' : '+'}{record.amountSats.toLocaleString()}
        </span>
        <span className="text-xs text-[#555555]">sats</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary stat
// ---------------------------------------------------------------------------

function SummaryStat({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Zap;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="p-3 rounded-xl text-center space-y-1" style={{ backgroundColor: `${color}08`, border: `1px solid ${color}20` }}>
      <div className="w-8 h-8 rounded-lg mx-auto flex items-center justify-center" style={{ backgroundColor: `${color}20` }}>
        <Icon size={15} style={{ color }} aria-hidden="true" />
      </div>
      <p className="font-mono text-lg font-bold" style={{ color }}>{value}</p>
      <p className="text-[10px] text-[#555555]">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

const MOCK_DELTAS: ReputationDelta[] = [
  { period: 'Oct', delta: 5 },
  { period: 'Nov', delta: 12 },
  { period: 'Dec', delta: -3 },
  { period: 'Jan', delta: 8 },
  { period: 'Feb', delta: 15 },
  { period: 'Mar', delta: 10 },
];

export default function FinancialTrustPanel({
  paymentHistory = [],
  settlementRate = 0,
  reputationDeltas = MOCK_DELTAS,
  totalSettledSats = 0,
  totalPendingSats = 0,
  isLoading = false,
}: FinancialTrustPanelProps) {
  const settled  = paymentHistory.filter(p => p.status === 'settled');
  const pending  = paymentHistory.filter(p => p.status === 'pending');
  const failed   = paymentHistory.filter(p => p.status === 'failed');

  return (
    <section className="card space-y-5" aria-label="Financial trust panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="heading-display text-lg text-[#f7931a]">Financial Trust</h2>
          <p className="text-xs text-[#555555] mt-0.5">Payment history & credit reputation</p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-[#f7931a]/10 border border-[#f7931a]/20 flex items-center justify-center">
          <Bitcoin size={18} className="text-[#f7931a]" aria-hidden="true" />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-hidden="true">
          {[1, 2, 3].map(i => <div key={i} className="h-16 skeleton rounded-xl" />)}
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3">
            <SummaryStat icon={CheckCircle2} label="Settled" value={settled.length.toString()} color="#22c55e" />
            <SummaryStat icon={Clock}        label="Pending" value={pending.length.toString()} color="#f59e0b" />
            <SummaryStat icon={XCircle}      label="Failed"  value={failed.length.toString()}  color="#ef4444" />
          </div>

          {/* Volume summary */}
          {(totalSettledSats > 0 || totalPendingSats > 0) && (
            <div className="p-3 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#555555]">Total Settled</span>
                <span className="font-mono font-bold text-[#22c55e]">{totalSettledSats.toLocaleString()} sats</span>
              </div>
              {totalPendingSats > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#555555]">Pending</span>
                  <span className="font-mono font-bold text-amber-400">{totalPendingSats.toLocaleString()} sats</span>
                </div>
              )}
            </div>
          )}

          {/* Settlement rate */}
          {settlementRate > 0 && (
            <div className="p-4 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
              <SettlementBar rate={settlementRate} />
            </div>
          )}

          {/* Reputation delta chart */}
          <div className="p-4 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
            <ReputationChart deltas={reputationDeltas} />
          </div>

          {/* Payment history */}
          {paymentHistory.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-[#555555] uppercase tracking-wider">Recent Payments</p>
              <div role="list" className="space-y-3" aria-label="Payment history">
                {paymentHistory.slice(0, 5).map(record => (
                  <PaymentRow key={record.id} record={record} />
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 space-y-2">
              <Zap size={24} className="mx-auto text-[#555555]" aria-hidden="true" />
              <p className="text-sm text-[#555555]">No payment history yet</p>
              <p className="text-xs text-[#555555]">Payments to trusted contacts will appear here</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
