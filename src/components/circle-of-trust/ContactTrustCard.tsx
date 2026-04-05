/**
 * ContactTrustCard — Per-contact trust display card
 * Spec: circle-of-trust-spec.md § ContactTrustCard
 *
 * Features:
 * - Name/npub, NIP-05 identity
 * - Trust score gauge (SVG arc, colored by score)
 * - Meeting count badge + first/last meeting dates
 * - 4-factor breakdown as horizontal bars
 * - Quick actions: Message, Zap, Call, View Profile
 */

import React, { useMemo } from 'react';
import clsx from 'clsx';
import {
  MessageSquare,
  Zap,
  Phone,
  ExternalLink,
  Shield,
  Calendar,
  Hash,
} from 'lucide-react';
import type { TrustedContact, TrustScore } from '../../lib/circle-of-trust/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContactTrustCardProps {
  contact: TrustedContact;
  trustScore: TrustScore;
  onMessage?: (pubkey: string) => void;
  onZap?: (pubkey: string) => void;
  onCall?: (pubkey: string) => void;
  onViewProfile?: (pubkey: string) => void;
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// SVG Arc Gauge
// ---------------------------------------------------------------------------

function TrustGauge({ score }: { score: number }) {
  // Semi-circle arc: starts at 7 o'clock (210°), sweeps 120° per 50 points
  // We use a 180° arc from left to right at the bottom
  const SIZE = 80;
  const R = 32;
  const CX = SIZE / 2;
  const CY = SIZE / 2 + 8;
  const STROKE = 6;

  // Arc from -180° to 0° (left to right, semicircle at bottom)
  // Parametric: start = 180°, end based on score
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const startAngle = 180;
  const endAngle = 180 - (score / 100) * 180;

  function arcPath(start: number, end: number, r: number) {
    const s = toRad(start);
    const e = toRad(end);
    const x1 = CX + r * Math.cos(s);
    const y1 = CY + r * Math.sin(s);
    const x2 = CX + r * Math.cos(e);
    const y2 = CY + r * Math.sin(e);
    const large = Math.abs(start - end) > 180 ? 1 : 0;
    const sweep = end < start ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`;
  }

  const color = score > 70 ? '#ffd700' : score >= 30 ? '#f7931a' : '#3b82f6';
  const trackPath = arcPath(180, 0, R);
  const valuePath = arcPath(180, endAngle, R);

  return (
    <svg
      width={SIZE}
      height={SIZE / 2 + 16}
      viewBox={`0 0 ${SIZE} ${SIZE / 2 + 16}`}
      role="img"
      aria-label={`Trust score ${score} out of 100`}
      className="overflow-visible"
    >
      {/* Track */}
      <path
        d={trackPath}
        fill="none"
        stroke="#2a2a2a"
        strokeWidth={STROKE}
        strokeLinecap="round"
      />
      {/* Value arc */}
      <path
        d={valuePath}
        fill="none"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 4px ${color}80)` }}
      />
      {/* Score label */}
      <text
        x={CX}
        y={CY + 4}
        textAnchor="middle"
        fill={color}
        fontSize="14"
        fontWeight="700"
        fontFamily="monospace"
      >
        {score}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Factor bar
// ---------------------------------------------------------------------------

function FactorBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#a0a0a0]">{label}</span>
        <span className="text-[11px] font-mono text-[#555555]">{value}/{max}</span>
      </div>
      <div
        className="h-1 rounded-full bg-[#2a2a2a] overflow-hidden"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick action button
// ---------------------------------------------------------------------------

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  variant = 'default',
  disabled = false,
}: {
  icon: typeof MessageSquare;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'gold';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={clsx(
        'flex-1 flex flex-col items-center gap-1 py-2 rounded-lg text-xs font-medium transition-all duration-150 active:scale-95',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        variant === 'primary' && 'bg-[#f7931a]/15 text-[#f7931a] hover:bg-[#f7931a]/25',
        variant === 'gold'    && 'bg-[#ffd700]/15 text-[#ffd700] hover:bg-[#ffd700]/25',
        variant === 'default' && 'bg-slate-800 text-[#a0a0a0] hover:bg-slate-700 hover:text-[#f5f5f5]',
      )}
    >
      <Icon size={16} aria-hidden="true" />
      <span className="leading-none">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

export default function ContactTrustCard({
  contact,
  trustScore,
  onMessage,
  onZap,
  onCall,
  onViewProfile,
  compact = false,
}: ContactTrustCardProps) {
  const color = contact.trustScore > 70 ? '#ffd700' : contact.trustScore >= 30 ? '#f7931a' : '#3b82f6';
  const label = contact.trustScore > 70 ? 'High Trust' : contact.trustScore >= 30 ? 'Medium Trust' : 'New Contact';

  const firstMeeting = contact.meetings[0];
  const lastMeeting  = contact.meetings[contact.meetings.length - 1];

  const formatDate = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

  const npubShort = `${contact.pubkey.slice(0, 8)}…${contact.pubkey.slice(-6)}`;

  return (
    <article
      className="card space-y-4"
      aria-label={`Contact ${contact.nip05 ?? npubShort}`}
    >
      {/* Header row: avatar + name + gauge */}
      <div className="flex items-start gap-3">
        {/* Avatar placeholder */}
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 font-mono font-bold text-sm"
          style={{ backgroundColor: `${color}15`, border: `2px solid ${color}40`, color }}
          aria-hidden="true"
        >
          {contact.pubkey.slice(0, 2).toUpperCase()}
        </div>

        {/* Identity */}
        <div className="flex-1 min-w-0 space-y-0.5">
          {contact.nip05 ? (
            <p className="text-sm font-semibold text-[#f5f5f5] truncate">{contact.nip05}</p>
          ) : (
            <p className="font-mono text-xs text-[#a0a0a0] truncate">{npubShort}</p>
          )}
          <p className="font-mono text-xs text-[#555555] truncate">
            {contact.pubkey.slice(0, 16)}…
          </p>
          {/* Badge */}
          <span
            className="inline-block text-[10px] px-2 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}40` }}
          >
            {label}
          </span>
        </div>

        {/* Trust gauge */}
        <div className="flex-shrink-0">
          <TrustGauge score={contact.trustScore} />
        </div>
      </div>

      {/* Meeting info */}
      {!compact && (
        <div className="flex items-center gap-4 text-xs text-[#555555] flex-wrap">
          <div className="flex items-center gap-1.5">
            <Shield size={12} style={{ color: '#22c55e' }} aria-hidden="true" />
            <span>
              <span className="font-mono font-bold text-[#f5f5f5]">{contact.meetings.length}</span>
              {' '}meeting{contact.meetings.length !== 1 ? 's' : ''}
            </span>
          </div>
          {firstMeeting && (
            <div className="flex items-center gap-1.5">
              <Calendar size={12} aria-hidden="true" />
              <span>First: {formatDate(firstMeeting.timestamp)}</span>
            </div>
          )}
          {lastMeeting && contact.meetings.length > 1 && (
            <div className="flex items-center gap-1.5">
              <Calendar size={12} aria-hidden="true" />
              <span>Last: {formatDate(lastMeeting.timestamp)}</span>
            </div>
          )}
          {firstMeeting && (
            <div className="flex items-center gap-1.5">
              <Hash size={12} aria-hidden="true" />
              <span className="font-mono">{firstMeeting.blockHeight.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {/* 4-factor breakdown */}
      {!compact && (
        <div className="space-y-2">
          <p className="text-[10px] text-[#555555] uppercase tracking-widest">Trust Factors</p>
          <FactorBar label="Meeting Depth"    value={trustScore.factors.meetingDepth}    max={30} color="#22c55e" />
          <FactorBar label="Time Consistency" value={trustScore.factors.timeConsistency} max={30} color="#f7931a" />
          <FactorBar label="Mutual Contacts"  value={trustScore.factors.mutualContacts}  max={20} color="#ffd700" />
          <FactorBar label="Financial Trust"  value={trustScore.factors.financialTrust}  max={20} color="#3b82f6" />
        </div>
      )}

      {/* Quick actions */}
      <div className="flex items-center gap-2">
        <ActionBtn
          icon={MessageSquare}
          label="Message"
          onClick={() => onMessage?.(contact.pubkey)}
          variant="default"
        />
        <ActionBtn
          icon={Zap}
          label="Zap"
          onClick={() => onZap?.(contact.pubkey)}
          variant="primary"
        />
        <ActionBtn
          icon={Phone}
          label="Call"
          onClick={() => onCall?.(contact.pubkey)}
          variant="gold"
        />
        <ActionBtn
          icon={ExternalLink}
          label="Profile"
          onClick={() => onViewProfile?.(contact.pubkey)}
          variant="default"
        />
      </div>
    </article>
  );
}
