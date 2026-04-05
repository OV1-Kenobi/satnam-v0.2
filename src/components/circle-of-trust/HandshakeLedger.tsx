/**
 * HandshakeLedger — Encrypted handshake timeline for a contact
 * Spec: circle-of-trust-spec.md § HandshakeLedger
 *
 * - Vertical timeline with entries (meeting, message, payment, attestation)
 * - Block height markers
 * - "Verified Handshake" badges for PoL meetings
 * - Each entry: icon + type + timestamp + details
 */

import React from 'react';
import clsx from 'clsx';
import {
  Handshake,
  MessageSquare,
  Zap,
  ShieldCheck,
  Hash,
  Clock,
  Lock,
} from 'lucide-react';
import type { HandshakeLedgerEntry } from '../../lib/circle-of-trust/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HandshakeLedgerProps {
  entries: HandshakeLedgerEntry[];
  contactLabel?: string;
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Entry type config
// ---------------------------------------------------------------------------

const ENTRY_CONFIG = {
  meeting: {
    icon: Handshake,
    label: 'PoL Meeting',
    color: '#ffd700',
    badge: true,
  },
  message: {
    icon: MessageSquare,
    label: 'Encrypted Message',
    color: '#a0a0a0',
    badge: false,
  },
  payment: {
    icon: Zap,
    label: 'Payment',
    color: '#f7931a',
    badge: false,
  },
  attestation: {
    icon: ShieldCheck,
    label: 'Attestation',
    color: '#22c55e',
    badge: false,
  },
} as const;

// ---------------------------------------------------------------------------
// Individual entry
// ---------------------------------------------------------------------------

function LedgerEntry({
  entry,
  isLast,
}: {
  entry: HandshakeLedgerEntry;
  isLast: boolean;
}) {
  const cfg = ENTRY_CONFIG[entry.type];
  const { icon: Icon } = cfg;

  const date = new Date(entry.timestamp * 1000);
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="relative flex gap-3" role="listitem">
      {/* Vertical line connector */}
      {!isLast && (
        <div
          className="absolute left-4 top-10 w-px bg-[#2a2a2a]"
          style={{ height: 'calc(100% - 8px)' }}
          aria-hidden="true"
        />
      )}

      {/* Icon bubble */}
      <div
        className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1"
        style={{ backgroundColor: `${cfg.color}20`, border: `1.5px solid ${cfg.color}50` }}
        aria-hidden="true"
      >
        <Icon size={14} style={{ color: cfg.color }} />
      </div>

      {/* Entry content */}
      <div className="flex-1 min-w-0 pb-5 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-[#f5f5f5]">{cfg.label}</span>

          {/* Verified Handshake badge for PoL meetings */}
          {cfg.badge && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={{
                backgroundColor: '#ffd70020',
                border: '1px solid #ffd70040',
                color: '#ffd700',
              }}
            >
              <ShieldCheck size={10} aria-hidden="true" />
              Verified Handshake
            </span>
          )}
        </div>

        {/* Timestamp */}
        <div className="flex items-center gap-3 text-xs text-[#555555]">
          <div className="flex items-center gap-1">
            <Clock size={11} aria-hidden="true" />
            <span>{dateStr} at {timeStr}</span>
          </div>
          {entry.blockHeight !== undefined && (
            <div className="flex items-center gap-1">
              <Hash size={11} aria-hidden="true" />
              <span className="font-mono">Block {entry.blockHeight.toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Event ID */}
        <p className="font-mono text-[10px] text-[#555555] truncate">
          Event: {entry.eventId.slice(0, 16)}…
        </p>

        {/* Encrypted details indicator */}
        {entry.encryptedDetails && (
          <div className="flex items-center gap-1.5 text-[11px] text-[#555555]">
            <Lock size={10} aria-hidden="true" />
            <span>Details encrypted (visible to you and counterparty)</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton entry
// ---------------------------------------------------------------------------

function SkeletonEntry() {
  return (
    <div className="flex gap-3" aria-hidden="true">
      <div className="w-8 h-8 rounded-full skeleton flex-shrink-0 mt-1" />
      <div className="flex-1 space-y-2 pb-5">
        <div className="h-4 skeleton rounded w-1/3" />
        <div className="h-3 skeleton rounded w-1/2" />
        <div className="h-3 skeleton rounded w-3/4" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HandshakeLedger({
  entries,
  contactLabel,
  isLoading = false,
}: HandshakeLedgerProps) {
  // Sort descending by timestamp (most recent first)
  const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <section className="card space-y-4" aria-label={`Handshake ledger${contactLabel ? ` for ${contactLabel}` : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="heading-display text-base text-[#ffd700]">Handshake Ledger</h3>
          {contactLabel && (
            <p className="text-xs text-[#555555] mt-0.5">{contactLabel}</p>
          )}
        </div>
        <div
          className="flex items-center gap-1.5 text-[11px] text-[#555555] px-2 py-1 rounded-md"
          style={{ backgroundColor: '#22c55e10', border: '1px solid #22c55e20' }}
        >
          <Lock size={10} className="text-[#22c55e]" aria-hidden="true" />
          <span className="text-[#22c55e]">E2E encrypted</span>
        </div>
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div role="list" aria-label="Loading ledger entries">
          {[1, 2, 3].map(i => <SkeletonEntry key={i} />)}
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-8 space-y-2">
          <Handshake size={28} className="mx-auto text-[#555555]" aria-hidden="true" />
          <p className="text-sm text-[#555555]">No handshake history yet</p>
          <p className="text-xs text-[#555555]">Complete a PoL ceremony to create your first entry</p>
        </div>
      ) : (
        <div role="list" aria-label={`${sorted.length} ledger entries`}>
          {sorted.map((entry, i) => (
            <LedgerEntry
              key={entry.eventId}
              entry={entry}
              isLast={i === sorted.length - 1}
            />
          ))}
        </div>
      )}

      {/* Entry count footer */}
      {!isLoading && sorted.length > 0 && (
        <p className="text-xs text-[#555555] text-right border-t border-[#2a2a2a] pt-3">
          {sorted.length} total {sorted.length === 1 ? 'entry' : 'entries'}
        </p>
      )}
    </section>
  );
}
