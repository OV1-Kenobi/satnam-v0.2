/**
 * @module components/payments/ScheduledPaymentsPanel
 * @description Scheduled and push payment management.
 *
 * Features:
 * - Create schedules: recipient, amount, interval, conditions
 * - Active schedules list with countdown to next execution
 * - Execution history with success/failure indicators
 * - Pause/resume/cancel actions
 */

import { useState, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import {
  Calendar,
  Plus,
  Pause,
  Play,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Coins,
  AlertCircle,
  Repeat,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

type ScheduleInterval = 'hourly' | 'daily' | 'weekly' | 'monthly';
type ScheduleStatus = 'active' | 'paused' | 'cancelled';
type ExecStatus = 'success' | 'failed' | 'pending';
type Rail = 'lightning' | 'cashu';

interface ScheduledPayment {
  id: string;
  recipient: string;
  amountSats: number;
  interval: ScheduleInterval;
  rail: Rail;
  label: string;
  status: ScheduleStatus;
  nextExecAt: number;
  execCount: number;
  createdAt: number;
  condition?: string;
}

interface ExecRecord {
  id: string;
  scheduleId: string;
  scheduleName: string;
  amountSats: number;
  rail: Rail;
  status: ExecStatus;
  timestamp: number;
  error?: string;
}

// ============================================================================
// Mock data
// ============================================================================

function getMockSchedules(): ScheduledPayment[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      id: 'sched-1',
      recipient: 'alice@getalby.com',
      amountSats: 1_000,
      interval: 'daily',
      rail: 'lightning',
      label: 'Daily allowance — Alice',
      status: 'active',
      nextExecAt: now + 14400, // 4h
      execCount: 7,
      createdAt: now - 7 * 86400,
    },
    {
      id: 'sched-2',
      recipient: 'npub1...bob',
      amountSats: 5_000,
      interval: 'weekly',
      rail: 'cashu',
      label: 'Weekly guardian stake',
      status: 'paused',
      nextExecAt: now + 3 * 86400,
      execCount: 3,
      createdAt: now - 21 * 86400,
    },
  ];
}

function getMockHistory(): ExecRecord[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      id: 'exec-1',
      scheduleId: 'sched-1',
      scheduleName: 'Daily allowance — Alice',
      amountSats: 1_000,
      rail: 'lightning',
      status: 'success',
      timestamp: now - 86400,
    },
    {
      id: 'exec-2',
      scheduleId: 'sched-1',
      scheduleName: 'Daily allowance — Alice',
      amountSats: 1_000,
      rail: 'lightning',
      status: 'failed',
      timestamp: now - 2 * 86400,
      error: 'NWC connection timeout',
    },
    {
      id: 'exec-3',
      scheduleId: 'sched-2',
      scheduleName: 'Weekly guardian stake',
      amountSats: 5_000,
      rail: 'cashu',
      status: 'success',
      timestamp: now - 7 * 86400,
    },
  ];
}

// ============================================================================
// Helpers
// ============================================================================

function formatCountdown(secs: number): string {
  if (secs <= 0) return 'now';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatRelativeTime(ts: number): string {
  const secs = Math.floor(Date.now() / 1000) - ts;
  const h = Math.floor(secs / 3600);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return `${Math.floor(secs / 60)}m ago`;
}

const INTERVAL_LABELS: Record<ScheduleInterval, string> = {
  hourly: 'Every hour',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};

const INTERVAL_SECS: Record<ScheduleInterval, number> = {
  hourly: 3600,
  daily: 86400,
  weekly: 7 * 86400,
  monthly: 30 * 86400,
};

const RAIL_META: Record<Rail, { label: string; color: string; icon: typeof Zap }> = {
  lightning: { label: 'Lightning', color: '#f7931a', icon: Zap },
  cashu: { label: 'Cashu', color: '#a855f7', icon: Coins },
};

// ============================================================================
// Create Schedule Form
// ============================================================================

interface CreateFormProps {
  onSave: (s: ScheduledPayment) => void;
  onCancel: () => void;
}

function CreateScheduleForm({ onSave, onCancel }: CreateFormProps) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState<number>(1000);
  const [interval, setInterval] = useState<ScheduleInterval>('daily');
  const [rail, setRail] = useState<Rail>('lightning');
  const [label, setLabel] = useState('');
  const [condition, setCondition] = useState('');

  const errors: Record<string, string> = {};
  if (!recipient.trim()) errors.recipient = 'Recipient required';
  if (amount <= 0) errors.amount = 'Amount must be > 0';

  const isValid = Object.keys(errors).length === 0;
  const now = Math.floor(Date.now() / 1000);

  const handleSave = () => {
    if (!isValid) return;
    const sched: ScheduledPayment = {
      id: `sched-${Date.now()}`,
      recipient: recipient.trim(),
      amountSats: amount,
      interval,
      rail,
      label: label.trim() || `${INTERVAL_LABELS[interval]} — ${recipient.trim()}`,
      status: 'active',
      nextExecAt: now + INTERVAL_SECS[interval],
      execCount: 0,
      createdAt: now,
      condition: condition.trim() || undefined,
    };
    onSave(sched);
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-4">
      <h3 className="text-sm font-medium text-slate-200">New Scheduled Payment</h3>

      {/* Recipient */}
      <div>
        <label htmlFor="sched-recipient" className="block text-xs text-slate-400 mb-1">
          Recipient <span className="text-red-400">*</span>
        </label>
        <input
          id="sched-recipient"
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="npub1... or user@domain.com"
          className={clsx(
            'w-full px-3 py-2 rounded-lg bg-slate-900 border text-sm text-slate-200 placeholder-slate-600',
            'focus:outline-none focus:border-[#f7931a] transition-colors',
            errors.recipient ? 'border-red-500' : 'border-slate-700'
          )}
          aria-invalid={!!errors.recipient}
        />
        {errors.recipient && <p className="text-xs text-red-400 mt-1">{errors.recipient}</p>}
      </div>

      {/* Label */}
      <div>
        <label htmlFor="sched-label" className="block text-xs text-slate-400 mb-1">
          Label <span className="text-slate-600">(optional)</span>
        </label>
        <input
          id="sched-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Alice's weekly allowance"
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#f7931a] transition-colors"
        />
      </div>

      {/* Amount + Interval */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="sched-amount" className="block text-xs text-slate-400 mb-1">
            Amount (sats)
          </label>
          <input
            id="sched-amount"
            type="number"
            min={1}
            value={amount || ''}
            onChange={(e) => setAmount(parseInt(e.target.value, 10) || 0)}
            className={clsx(
              'w-full px-3 py-2 rounded-lg bg-slate-900 border text-sm text-slate-200',
              'focus:outline-none focus:border-[#f7931a] transition-colors font-mono',
              errors.amount ? 'border-red-500' : 'border-slate-700'
            )}
          />
          {errors.amount && <p className="text-xs text-red-400 mt-1">{errors.amount}</p>}
        </div>

        <div>
          <label htmlFor="sched-interval" className="block text-xs text-slate-400 mb-1">
            Repeat
          </label>
          <select
            id="sched-interval"
            value={interval}
            onChange={(e) => setInterval(e.target.value as ScheduleInterval)}
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:border-[#f7931a] transition-colors"
          >
            {(Object.keys(INTERVAL_LABELS) as ScheduleInterval[]).map((k) => (
              <option key={k} value={k}>{INTERVAL_LABELS[k]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Rail */}
      <div>
        <p className="text-xs text-slate-400 mb-1.5">Rail</p>
        <div className="flex gap-2">
          {(Object.keys(RAIL_META) as Rail[]).map((r) => {
            const m = RAIL_META[r];
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRail(r)}
                aria-pressed={rail === r}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs transition-colors',
                  rail === r
                    ? 'font-medium border-transparent'
                    : 'border-slate-700 text-slate-500 hover:border-slate-600'
                )}
                style={rail === r ? { backgroundColor: `${m.color}20`, borderColor: `${m.color}50`, color: m.color } : {}}
              >
                <m.icon size={12} aria-hidden="true" />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Condition */}
      <div>
        <label htmlFor="sched-condition" className="block text-xs text-slate-400 mb-1">
          Condition <span className="text-slate-600">(optional, e.g. "balance &gt; 5000")</span>
        </label>
        <input
          id="sched-condition"
          type="text"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder="e.g. balance > 5000 sats"
          className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#f7931a] transition-colors"
        />
      </div>

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl border border-slate-700 text-sm text-slate-400 hover:border-slate-600 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isValid}
          className="flex-1 py-2.5 rounded-xl bg-[#f7931a] text-black font-medium text-sm hover:bg-[#c46e00] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Schedule
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Schedule Card
// ============================================================================

function ScheduleCard({
  schedule,
  onToggle,
  onCancel,
  now,
}: {
  schedule: ScheduledPayment;
  onToggle: (id: string) => void;
  onCancel: (id: string) => void;
  now: number;
}) {
  const meta = RAIL_META[schedule.rail];
  const countdown = Math.max(0, schedule.nextExecAt - now);

  return (
    <div
      className={clsx(
        'bg-slate-900 border rounded-xl p-4',
        schedule.status === 'active' ? 'border-slate-800' :
        schedule.status === 'paused' ? 'border-yellow-500/20 bg-yellow-500/5' :
        'border-slate-800 opacity-60'
      )}
      aria-label={`Schedule: ${schedule.label}, status: ${schedule.status}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ backgroundColor: `${meta.color}20` }}
          >
            <meta.icon size={13} style={{ color: meta.color }} aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">{schedule.label}</p>
            <p className="text-xs text-slate-500 truncate">{schedule.recipient}</p>
          </div>
        </div>
        <span className={clsx(
          'text-[10px] px-2 py-0.5 rounded-full flex-shrink-0',
          schedule.status === 'active' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
          schedule.status === 'paused' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
          'bg-slate-800 text-slate-500 border border-slate-700'
        )}>
          {schedule.status}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <p className="text-[10px] text-slate-500 mb-0.5">Amount</p>
          <p className="text-xs font-mono font-bold" style={{ color: meta.color }}>
            {schedule.amountSats.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-slate-500 mb-0.5">Repeat</p>
          <p className="text-xs text-slate-400">{INTERVAL_LABELS[schedule.interval].replace('Every ', '')}</p>
        </div>
        <div>
          <p className="text-[10px] text-slate-500 mb-0.5">Executions</p>
          <p className="text-xs text-slate-400">{schedule.execCount}×</p>
        </div>
      </div>

      {/* Countdown */}
      {schedule.status === 'active' && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50">
          <Clock size={12} className="text-slate-500 flex-shrink-0" aria-hidden="true" />
          <span className="text-xs text-slate-500">Next payment in</span>
          <span className="text-xs font-mono font-medium text-[#f7931a] ml-auto">
            {formatCountdown(countdown)}
          </span>
        </div>
      )}

      {/* Condition */}
      {schedule.condition && (
        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-3">
          <AlertCircle size={11} aria-hidden="true" />
          <span>Only if: {schedule.condition}</span>
        </div>
      )}

      {/* Actions */}
      {schedule.status !== 'cancelled' && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onToggle(schedule.id)}
            aria-label={schedule.status === 'active' ? 'Pause schedule' : 'Resume schedule'}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-slate-700 text-xs text-slate-400 hover:border-slate-600 transition-colors"
          >
            {schedule.status === 'active' ? (
              <><Pause size={12} aria-hidden="true" /> Pause</>
            ) : (
              <><Play size={12} aria-hidden="true" /> Resume</>
            )}
          </button>
          <button
            type="button"
            onClick={() => onCancel(schedule.id)}
            aria-label="Cancel schedule"
            className="px-3 py-2 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// History Row
// ============================================================================

function HistoryRow({ record }: { record: ExecRecord }) {
  const meta = RAIL_META[record.rail];
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-800/50 last:border-0">
      {record.status === 'success' ? (
        <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" aria-hidden="true" />
      ) : record.status === 'failed' ? (
        <XCircle size={14} className="text-red-400 flex-shrink-0" aria-hidden="true" />
      ) : (
        <Clock size={14} className="text-yellow-400 flex-shrink-0" aria-hidden="true" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-300 truncate">{record.scheduleName}</p>
        {record.error && <p className="text-[10px] text-red-400">{record.error}</p>}
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs font-mono" style={{ color: meta.color }}>
          {record.amountSats.toLocaleString()}
        </p>
        <p className="text-[10px] text-slate-500">{formatRelativeTime(record.timestamp)}</p>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export interface ScheduledPaymentsPanelProps {
  className?: string;
}

export default function ScheduledPaymentsPanel({ className }: ScheduledPaymentsPanelProps) {
  const [schedules, setSchedules] = useState<ScheduledPayment[]>(getMockSchedules());
  const [history] = useState<ExecRecord[]>(getMockHistory());
  const [showCreate, setShowCreate] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Live countdown tick
  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleAdd = useCallback((s: ScheduledPayment) => {
    setSchedules((prev) => [s, ...prev]);
    setShowCreate(false);
  }, []);

  const handleToggle = useCallback((id: string) => {
    setSchedules((prev) => prev.map((s) =>
      s.id === id
        ? { ...s, status: s.status === 'active' ? 'paused' : 'active' }
        : s
    ));
  }, []);

  const handleCancel = useCallback((id: string) => {
    setSchedules((prev) => prev.map((s) =>
      s.id === id ? { ...s, status: 'cancelled' } : s
    ));
  }, []);

  const active = schedules.filter((s) => s.status === 'active').length;
  const paused = schedules.filter((s) => s.status === 'paused').length;

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Repeat size={16} className="text-[#22c55e]" aria-hidden="true" />
          <h2 className="heading-display text-lg text-[#22c55e] tracking-wider">
            Scheduled Payments
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          aria-label={showCreate ? 'Cancel new schedule' : 'Create new schedule'}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors',
            showCreate
              ? 'bg-slate-800 text-slate-400 border border-slate-700'
              : 'bg-[#22c55e]/10 border border-[#22c55e]/20 text-[#22c55e] hover:bg-[#22c55e]/20'
          )}
        >
          <Plus size={12} aria-hidden="true" />
          {showCreate ? 'Cancel' : 'New'}
        </button>
      </div>

      {/* Summary */}
      <div className="flex gap-3">
        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <p className="font-mono text-xl font-bold text-green-400">{active}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Active</p>
        </div>
        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <p className="font-mono text-xl font-bold text-yellow-400">{paused}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Paused</p>
        </div>
        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <p className="font-mono text-xl font-bold text-slate-300">{history.length}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Executions</p>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateScheduleForm
          onSave={handleAdd}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Active schedules */}
      <div>
        <h3 className="text-xs text-slate-500 uppercase tracking-widest mb-3">Active Schedules</h3>
        {schedules.filter((s) => s.status !== 'cancelled').length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center">
            <Calendar size={24} className="mx-auto text-slate-600 mb-2" aria-hidden="true" />
            <p className="text-sm text-slate-500">No scheduled payments yet</p>
            <p className="text-xs text-slate-600 mt-1">Create one to automate recurring payments</p>
          </div>
        ) : (
          <div className="space-y-3">
            {schedules
              .filter((s) => s.status !== 'cancelled')
              .map((s) => (
                <ScheduleCard
                  key={s.id}
                  schedule={s}
                  onToggle={handleToggle}
                  onCancel={handleCancel}
                  now={now}
                />
              ))}
          </div>
        )}
      </div>

      {/* Execution history */}
      {history.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl">
          <div className="px-4 py-3 border-b border-slate-800">
            <h3 className="text-xs text-slate-500 uppercase tracking-widest">Execution History</h3>
          </div>
          <div className="px-4">
            {history.map((r) => <HistoryRow key={r.id} record={r} />)}
          </div>
        </div>
      )}
    </div>
  );
}

