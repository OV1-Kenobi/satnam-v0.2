/**
 * SpendPolicyEditor — Spend policy configuration form
 * Phase 3: NIP-SA spend policy management
 *
 * Provides sliders + inputs for:
 * - max_single_spend_msats
 * - daily_limit_msats
 * - requires_approval_above_msats
 * - preferred_spend_rail toggle
 * - allowed_mints list editor
 * - sweep_threshold + sweep_destination
 */

import { useState } from 'react';
import clsx from 'clsx';
import { Plus, X, Zap, Coins } from 'lucide-react';
import type { SpendPolicy } from '../../hooks/useAgentProfile.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SpendPolicyEditorProps {
  value: SpendPolicy;
  onChange: (policy: SpendPolicy) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msatsToSats(msats: bigint): number {
  return Number(msats) / 1000;
}

function satsToMsats(sats: number): bigint {
  return BigInt(Math.round(sats * 1000));
}

function formatSats(sats: number): string {
  return sats.toLocaleString();
}

// Logarithmic slider mapping for large sat ranges
// Min: 100 sats, Max: 10,000,000 sats
const LOG_MIN = Math.log10(100);
const LOG_MAX = Math.log10(10_000_000);

function sliderToSats(sliderVal: number): number {
  const logVal = LOG_MIN + (sliderVal / 100) * (LOG_MAX - LOG_MIN);
  return Math.round(Math.pow(10, logVal));
}

function satsToSlider(sats: number): number {
  const clamped = Math.max(100, Math.min(10_000_000, sats));
  return Math.round(((Math.log10(clamped) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100);
}

// ---------------------------------------------------------------------------
// Log slider
// ---------------------------------------------------------------------------

function LogSlider({
  id,
  label,
  value,
  onChange,
  disabled,
  description,
}: {
  id: string;
  label: string;
  value: number; // in sats
  onChange: (sats: number) => void;
  disabled?: boolean;
  description?: string;
}) {
  const sliderVal = satsToSlider(value);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-[#a0a0a0]">
          {label}
        </label>
        <span className="font-mono text-sm font-bold text-[#f7931a]">
          {formatSats(value)} sats
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={sliderVal}
        onChange={e => onChange(sliderToSats(parseInt(e.target.value)))}
        disabled={disabled}
        aria-valuemin={100}
        aria-valuemax={10_000_000}
        aria-valuenow={value}
        aria-label={`${label}: ${formatSats(value)} sats`}
        className="w-full h-2 rounded-full appearance-none cursor-pointer bg-slate-800 accent-[#f7931a] disabled:opacity-50"
      />
      <div className="flex justify-between text-xs text-[#555555]">
        <span>100 sats</span>
        <span>10M sats</span>
      </div>
      {description && <p className="text-xs text-[#555555]">{description}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rail toggle
// ---------------------------------------------------------------------------

function RailToggle({
  value,
  onChange,
  disabled,
}: {
  value: 'lightning' | 'cashu' | 'auto';
  onChange: (rail: 'lightning' | 'cashu' | 'auto') => void;
  disabled?: boolean;
}) {
  const OPTIONS: Array<{ id: 'lightning' | 'cashu' | 'auto'; label: string; Icon: typeof Zap }> = [
    { id: 'lightning', label: 'Lightning', Icon: Zap },
    { id: 'cashu', label: 'Cashu', Icon: Coins },
    { id: 'auto', label: 'Auto', Icon: Zap },
  ];

  return (
    <div>
      <p className="text-sm font-medium text-[#a0a0a0] mb-2">Preferred Rail</p>
      <div className="flex rounded-lg border border-[#2a2a2a] overflow-hidden" role="radiogroup" aria-label="Preferred spend rail">
        {OPTIONS.map(opt => {
          const selected = value === opt.id;
          const { Icon } = opt;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => !disabled && onChange(opt.id)}
              disabled={disabled}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors',
                selected ? 'bg-[#f7931a] text-black' : 'bg-[#1a1a1a] text-[#555555] hover:bg-[#222222]',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Icon size={14} />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mint list editor
// ---------------------------------------------------------------------------

function MintListEditor({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (mints: string[]) => void;
  disabled?: boolean;
}) {
  const [newMint, setNewMint] = useState('');

  const add = () => {
    const url = newMint.trim();
    if (!url || value.includes(url)) return;
    onChange([...value, url]);
    setNewMint('');
  };

  const remove = (mint: string) => {
    onChange(value.filter(m => m !== mint));
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-[#a0a0a0]">Allowed Cashu Mints</label>
      <p className="text-xs text-[#555555]">Leave empty to allow any mint. Restrict for additional security.</p>

      {value.length > 0 && (
        <ul className="space-y-1" role="list">
          {value.map(mint => (
            <li key={mint} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a]">
              <span className="font-mono text-xs text-[#a0a0a0] flex-1 truncate">{mint}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(mint)}
                  aria-label={`Remove mint ${mint}`}
                  className="text-[#555555] hover:text-red-400 transition-colors flex-shrink-0"
                >
                  <X size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && (
        <div className="flex gap-2">
          <input
            type="url"
            value={newMint}
            onChange={e => setNewMint(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="https://mint.example.com"
            className="flex-1 px-3 py-1.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-xs font-mono focus:outline-none focus:border-[#f7931a] transition-colors"
            aria-label="New mint URL"
          />
          <button
            type="button"
            onClick={add}
            aria-label="Add mint"
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function SpendPolicyEditor({ value, onChange, disabled }: SpendPolicyEditorProps) {
  const update = (partial: Partial<SpendPolicy>) => {
    onChange({ ...value, ...partial });
  };

  return (
    <div className="space-y-6">
      {/* Max single spend */}
      <LogSlider
        id="max-single-spend"
        label="Max Single Spend"
        value={msatsToSats(value.max_single_spend_msats)}
        onChange={sats => update({ max_single_spend_msats: satsToMsats(sats) })}
        disabled={disabled}
        description="Maximum amount for a single transaction"
      />

      {/* Daily limit */}
      <LogSlider
        id="daily-limit"
        label="Daily Limit"
        value={msatsToSats(value.daily_limit_msats)}
        onChange={sats => update({ daily_limit_msats: satsToMsats(sats) })}
        disabled={disabled}
        description="Total spending cap per 24-hour period"
      />

      {/* Approval threshold */}
      <LogSlider
        id="approval-threshold"
        label="Approval Threshold"
        value={msatsToSats(value.requires_approval_above_msats)}
        onChange={sats => update({ requires_approval_above_msats: satsToMsats(sats) })}
        disabled={disabled}
        description="Require manual approval for amounts above this"
      />

      {/* Rail toggle */}
      <RailToggle
        value={value.preferred_spend_rail}
        onChange={rail => update({ preferred_spend_rail: rail })}
        disabled={disabled}
      />

      {/* Mint list */}
      <MintListEditor
        value={value.allowed_mints}
        onChange={mints => update({ allowed_mints: mints })}
        disabled={disabled}
      />

      {/* Sweep settings */}
      <div className="space-y-3 pt-2 border-t border-[#2a2a2a]">
        <p className="text-xs text-[#555555] uppercase tracking-widest">Sweep Settings (optional)</p>

        <div>
          <label htmlFor="sweep-threshold" className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
            Sweep Threshold (sats)
          </label>
          <input
            id="sweep-threshold"
            type="number"
            min={0}
            value={value.sweep_threshold_msats !== undefined ? Number(value.sweep_threshold_msats) / 1000 : ''}
            onChange={e => {
              const sats = parseInt(e.target.value);
              update({ sweep_threshold_msats: isNaN(sats) ? undefined : BigInt(Math.round(sats * 1000)) });
            }}
            disabled={disabled}
            placeholder="e.g. 50000"
            className="w-full px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-sm focus:outline-none focus:border-[#f7931a] transition-colors disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-[#555555]">Auto-sweep balance above this amount to destination</p>
        </div>

        <div>
          <label htmlFor="sweep-destination" className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
            Sweep Destination
          </label>
          <input
            id="sweep-destination"
            type="text"
            value={value.sweep_destination ?? ''}
            onChange={e => update({ sweep_destination: e.target.value || undefined })}
            disabled={disabled}
            placeholder="Lightning address or bolt11"
            className="w-full px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-sm focus:outline-none focus:border-[#f7931a] transition-colors disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}

