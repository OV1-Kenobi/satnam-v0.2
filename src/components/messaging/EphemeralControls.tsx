/**
 * Satnam v2 — EphemeralControls
 * Spec: messaging-spec.md § 4 (EphemeralControls)
 *
 * Controls for ephemeral/self-destruct messaging:
 *   - TTL selector dropdown (5m / 1h / 24h / 7d / custom)
 *   - Burn-after-read toggle (flame icon)
 *   - Active timer display for messages that are ephemeral (countdown + flame)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Flame, ChevronDown, Check } from 'lucide-react';
import type { EphemeralConfig } from '../../lib/messaging/types.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface EphemeralControlsProps {
  value: EphemeralConfig | null;
  onChange: (config: EphemeralConfig | null) => void;
  /** Show compact inline variant (for compose bar) */
  compact?: boolean;
  className?: string;
}

interface TimerBadgeProps {
  expiresAt: number; // unix seconds
}

// ── TTL options ────────────────────────────────────────────────────────────────

const TTL_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: 'Off', value: null },
  { label: '5 minutes', value: 5 * 60 },
  { label: '1 hour', value: 60 * 60 },
  { label: '24 hours', value: 24 * 60 * 60 },
  { label: '7 days', value: 7 * 24 * 60 * 60 },
];

function formatTtl(seconds: number | null): string {
  if (seconds === null) return 'Off';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

// ── Timer Badge ────────────────────────────────────────────────────────────────

/**
 * Countdown timer displayed on an ephemeral message bubble.
 * Shows remaining time with flame icon, updates every second.
 */
export function TimerBadge({ expiresAt }: TimerBadgeProps) {
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAt - Math.floor(Date.now() / 1000)));

  useEffect(() => {
    if (remaining <= 0) return;
    const interval = setInterval(() => {
      const r = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
      setRemaining(r);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, remaining]);

  function formatRemaining(secs: number): string {
    if (secs <= 0) return 'Expired';
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
    return `${Math.floor(secs / 86400)}d`;
  }

  const isUrgent = remaining < 60;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 text-[10px] font-mono font-medium',
        isUrgent ? 'text-red-400 animate-pulse' : 'text-yellow-500',
      )}
      aria-label={`Message expires in ${formatRemaining(remaining)}`}
      aria-live="polite"
    >
      <Flame size={10} aria-hidden="true" className={isUrgent ? 'text-red-400' : 'text-yellow-500'} />
      {formatRemaining(remaining)}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function EphemeralControls({
  value,
  onChange,
  compact = false,
  className,
}: EphemeralControlsProps) {
  const [open, setOpen] = useState(false);
  const [customSeconds, setCustomSeconds] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isActive = value !== null;
  const ttl = value?.ttl ?? null;
  const burnAfterRead = value?.burnAfterRead ?? false;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleTtlSelect = useCallback((seconds: number | null) => {
    if (seconds === null && !burnAfterRead) {
      onChange(null);
    } else {
      onChange({ ttl: seconds, burnAfterRead: value?.burnAfterRead ?? false });
    }
    setShowCustom(false);
    setOpen(false);
  }, [burnAfterRead, onChange, value]);

  const handleBurnToggle = useCallback(() => {
    const nextBurn = !burnAfterRead;
    if (!nextBurn && ttl === null) {
      onChange(null);
    } else {
      onChange({ ttl: ttl, burnAfterRead: nextBurn });
    }
  }, [burnAfterRead, ttl, onChange]);

  const handleCustomSubmit = useCallback(() => {
    const n = parseInt(customSeconds, 10);
    if (isNaN(n) || n <= 0) return;
    onChange({ ttl: n, burnAfterRead: value?.burnAfterRead ?? false });
    setShowCustom(false);
    setOpen(false);
  }, [customSeconds, onChange, value]);

  return (
    <div ref={ref} className={clsx('relative', className)}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={isActive ? `Ephemeral: ${value?.ttl ? formatTtl(value.ttl) : 'on'}${burnAfterRead ? ' + burn' : ''}` : 'Enable ephemeral messages'}
        className={clsx(
          'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-all duration-150',
          isActive
            ? 'bg-yellow-500/20 border border-yellow-500/40 text-yellow-400'
            : 'bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-300',
          compact && 'px-2 py-1 text-xs',
        )}
      >
        <Flame
          size={compact ? 13 : 14}
          aria-hidden="true"
          className={isActive ? 'text-yellow-500' : ''}
        />
        {!compact && (
          <span>{isActive ? formatTtl(ttl) : 'Ephemeral'}</span>
        )}
        {isActive && burnAfterRead && !compact && (
          <span className="text-[10px] text-orange-400">+BAR</span>
        )}
        {!compact && <ChevronDown size={12} aria-hidden="true" />}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Ephemeral message settings"
          className={clsx(
            'absolute bottom-full mb-2 z-50',
            compact ? 'right-0' : 'left-0',
            'w-64 rounded-xl bg-slate-900 border border-slate-800 shadow-2xl p-3 space-y-3',
          )}
        >
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Self-destruct timer
          </p>

          {/* TTL options */}
          <div className="space-y-1" role="group" aria-label="TTL options">
            {TTL_OPTIONS.map(opt => (
              <button
                key={opt.label}
                type="button"
                onClick={() => handleTtlSelect(opt.value)}
                className={clsx(
                  'w-full text-left flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors duration-100',
                  ttl === opt.value && !showCustom
                    ? 'bg-yellow-500/20 text-yellow-300'
                    : 'text-slate-300 hover:bg-slate-800',
                )}
              >
                <span>{opt.label}</span>
                {ttl === opt.value && !showCustom && <Check size={12} className="text-yellow-400" />}
              </button>
            ))}

            {/* Custom TTL */}
            <button
              type="button"
              onClick={() => setShowCustom(v => !v)}
              className={clsx(
                'w-full text-left flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors duration-100',
                showCustom ? 'bg-yellow-500/20 text-yellow-300' : 'text-slate-300 hover:bg-slate-800',
              )}
            >
              <span>Custom…</span>
              {showCustom && <Check size={12} className="text-yellow-400" />}
            </button>

            {showCustom && (
              <div className="flex gap-2 px-1">
                <input
                  type="number"
                  min="1"
                  value={customSeconds}
                  onChange={e => setCustomSeconds(e.target.value)}
                  placeholder="Seconds"
                  aria-label="Custom TTL in seconds"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-yellow-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={handleCustomSubmit}
                  className="px-3 py-1.5 rounded-lg bg-yellow-500 text-black text-sm font-medium hover:bg-yellow-400 transition-colors"
                >
                  Set
                </button>
              </div>
            )}
          </div>

          {/* Burn after read toggle */}
          <div className="border-t border-slate-800 pt-3">
            <button
              type="button"
              onClick={handleBurnToggle}
              role="switch"
              aria-checked={burnAfterRead}
              aria-label="Burn after read"
              className={clsx(
                'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors duration-150',
                burnAfterRead ? 'bg-orange-500/20 border border-orange-500/30' : 'hover:bg-slate-800',
              )}
            >
              <div className="flex items-center gap-2">
                <Flame
                  size={14}
                  className={burnAfterRead ? 'text-orange-400' : 'text-slate-500'}
                  aria-hidden="true"
                />
                <span className={burnAfterRead ? 'text-orange-300' : 'text-slate-300'}>
                  Burn after read
                </span>
              </div>
              {/* Toggle pill */}
              <div
                className={clsx(
                  'w-8 h-4 rounded-full transition-colors duration-200 relative',
                  burnAfterRead ? 'bg-orange-500' : 'bg-slate-700',
                )}
              >
                <div
                  className={clsx(
                    'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-200',
                    burnAfterRead ? 'translate-x-4' : 'translate-x-0.5',
                  )}
                />
              </div>
            </button>
            <p className="text-[10px] text-slate-600 px-3 mt-1">
              Message deletes after the recipient reads it (NIP-40 + kind:5 deletion)
            </p>
          </div>
        </div>
      )}
    </div>
  );
}


