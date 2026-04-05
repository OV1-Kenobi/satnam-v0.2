/**
 * Satnam v2 — ProtocolIndicator
 * Spec: messaging-spec.md § 4 (ProtocolIndicator)
 *
 * Small pill badge showing the active messaging protocol.
 * - NIP-17  → blue bg
 * - MLS     → green bg
 *
 * Tap/click expands a popover with:
 *   - Forward secrecy status
 *   - Peer protocol support
 *   - Key rotation info
 */

import React, { useRef, useState } from 'react';
import clsx from 'clsx';
import { Shield, ShieldCheck, X, RefreshCw, Users } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export type Protocol = 'nip17' | 'mls';

interface ProtocolIndicatorProps {
  protocol: Protocol;
  /** Whether the peer also supports MLS (kind:443 KeyPackage present) */
  peerSupportsMls?: boolean;
  /** Last key rotation timestamp (MLS only) */
  lastKeyRotation?: number;
  /** Additional classes */
  className?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRotation(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ProtocolIndicator({
  protocol,
  peerSupportsMls = false,
  lastKeyRotation,
  className,
}: ProtocolIndicatorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isMls = protocol === 'mls';
  const label = isMls ? 'MLS' : 'NIP-17';
  const bgClass = isMls ? 'bg-green-600' : 'bg-blue-600';
  const Icon = isMls ? ShieldCheck : Shield;

  // Close on outside click
  React.useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className={clsx('relative inline-block', className)}>
      {/* Badge pill */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={`Protocol: ${label}. Click for details.`}
        className={clsx(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white cursor-pointer',
          'hover:opacity-90 active:scale-95 transition-all duration-150',
          bgClass,
        )}
      >
        <Icon size={10} aria-hidden="true" />
        {label}
      </button>

      {/* Expanded popover */}
      {open && (
        <div
          role="dialog"
          aria-label="Protocol details"
          className={clsx(
            'absolute bottom-full left-0 mb-2 z-50',
            'w-72 rounded-xl bg-slate-900 border border-slate-800',
            'shadow-2xl p-4 space-y-3',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white', bgClass)}>
                <Icon size={10} aria-hidden="true" />
                {label}
              </span>
              <span className="text-xs text-slate-400">Active protocol</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close protocol details"
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* Details */}
          <div className="space-y-2 text-xs">
            {/* Forward secrecy */}
            <div className="flex items-start gap-2">
              <ShieldCheck
                size={13}
                className={isMls ? 'text-green-400 mt-0.5' : 'text-yellow-400 mt-0.5'}
                aria-hidden="true"
              />
              <div>
                <p className="text-slate-300 font-medium">Forward Secrecy</p>
                <p className="text-slate-500">
                  {isMls
                    ? 'Full forward secrecy via MLS epoch key rotation. Old keys are deleted after each rotation.'
                    : 'Per-session NIP-44 ChaCha20-Poly1305. Full forward secrecy requires MLS upgrade.'}
                </p>
              </div>
            </div>

            {/* Peer support */}
            <div className="flex items-start gap-2">
              <Users size={13} className="text-slate-400 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-slate-300 font-medium">Peer Protocol Support</p>
                <p className="text-slate-500">
                  {peerSupportsMls
                    ? 'Peer has published a kind:443 MLS KeyPackage. MLS upgrade is available.'
                    : 'Peer has not published a MLS KeyPackage. Using NIP-17 gift-wrap.'}
                </p>
              </div>
            </div>

            {/* Key rotation */}
            {isMls && (
              <div className="flex items-start gap-2">
                <RefreshCw size={13} className="text-green-400 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-slate-300 font-medium">Key Rotation</p>
                  <p className="text-slate-500">
                    {lastKeyRotation
                      ? `Last rotated ${formatRotation(lastKeyRotation)}. Group keys rotate every epoch (message send).`
                      : 'Automatic per-epoch rotation via MIP-01 group data extension.'}
                  </p>
                </div>
              </div>
            )}

            {!isMls && peerSupportsMls && (
              <div className="mt-2 p-2 rounded-lg bg-blue-900/20 border border-blue-800/30">
                <p className="text-blue-300 text-xs">
                  MLS upgrade available for this conversation. Upgrade when both clients support Marmot (MIP-00–05).
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
