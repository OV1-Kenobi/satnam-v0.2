/**
 * TrustOverviewPanel — Concentric circle visualization of trusted contacts
 * Spec: circle-of-trust-spec.md § Circle of Trust Dashboard
 *
 * Three rings:
 *   Inner  (score > 70): sovereign-gold  #ffd700
 *   Middle (30–70):      btc-orange      #f7931a
 *   Outer  (< 30):       vault-blue      #3b82f6
 *
 * Contact dots are positioned on each ring.
 * Stats bar: total contacts, avg score, total meetings, oldest relationship.
 * CSS-only visualization — no chart library.
 */

import { useMemo } from 'react';
import clsx from 'clsx';
import { Users, Shield, Clock, TrendingUp } from 'lucide-react';
import type { TrustedContact, CircleOfTrustStats } from '../../lib/circle-of-trust/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrustOverviewPanelProps {
  contacts: TrustedContact[];
  stats: CircleOfTrustStats;
  onContactClick?: (pubkey: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateNpub(pubkey: string): string {
  if (pubkey.length <= 12) return pubkey;
  return `${pubkey.slice(0, 6)}…${pubkey.slice(-4)}`;
}

function scoreColor(score: number): string {
  if (score > 70) return '#ffd700';
  if (score >= 30) return '#f7931a';
  return '#3b82f6';
}

function scoreLabel(score: number): string {
  if (score > 70) return 'High Trust';
  if (score >= 30) return 'Medium Trust';
  return 'New Contact';
}

/** Place a dot on a ring. Returns CSS top/left as percent of the 300×300 container. */
function ringPosition(
  index: number,
  total: number,
  ringRadius: number,
): { top: string; left: string } {
  const angle = (2 * Math.PI * index) / Math.max(total, 1) - Math.PI / 2;
  // Container is 300px; center = 50% = 150px
  const cx = 50 + (ringRadius / 150) * 50 * Math.cos(angle);
  const cy = 50 + (ringRadius / 150) * 50 * Math.sin(angle);
  return { top: `${cy}%`, left: `${cx}%` };
}

// ---------------------------------------------------------------------------
// Stat pill
// ---------------------------------------------------------------------------

function StatPill({
  icon: Icon,
  label,
  value,
  color = '#f7931a',
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-0 flex-1">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${color}15`, border: `1px solid ${color}30` }}
      >
        <Icon size={15} style={{ color }} aria-hidden="true" />
      </div>
      <p className="font-mono text-sm font-bold text-[#f5f5f5] leading-none">{value}</p>
      <p className="text-[10px] text-[#555555] uppercase tracking-wider text-center leading-tight">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function TrustOverviewPanel({
  contacts,
  stats,
  onContactClick,
}: TrustOverviewPanelProps) {
  // Bucket contacts by tier
  const high   = useMemo(() => contacts.filter(c => c.trustScore > 70),  [contacts]);
  const medium = useMemo(() => contacts.filter(c => c.trustScore >= 30 && c.trustScore <= 70), [contacts]);
  const low    = useMemo(() => contacts.filter(c => c.trustScore < 30),  [contacts]);

  const isEmpty = contacts.length === 0;

  return (
    <section
      className="card space-y-6"
      aria-label="Circle of Trust overview"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="heading-display text-lg text-[#ffd700]">Circle of Trust</h2>
          <p className="text-xs text-[#555555] mt-0.5">PoL-verified contacts by trust depth</p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-[#ffd700]/10 border border-[#ffd700]/20 flex items-center justify-center">
          <Shield size={18} className="text-[#ffd700]" aria-hidden="true" />
        </div>
      </div>

      {/* Concentric ring visualization */}
      <div
        className="relative mx-auto"
        style={{ width: 300, height: 300 }}
        aria-label={`Trust rings: ${high.length} high trust, ${medium.length} medium trust, ${low.length} new contacts`}
        role="img"
      >
        {/* Outer ring: new contacts (blue) */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            border: '2px solid #3b82f620',
            boxShadow: 'inset 0 0 0 1px #3b82f615',
          }}
          aria-hidden="true"
        />
        {/* Middle ring: medium trust (orange) */}
        <div
          className="absolute rounded-full"
          style={{
            inset: '15%',
            border: '2px solid #f7931a25',
            boxShadow: 'inset 0 0 0 1px #f7931a15',
          }}
          aria-hidden="true"
        />
        {/* Inner ring: high trust (gold) */}
        <div
          className="absolute rounded-full"
          style={{
            inset: '30%',
            border: '2px solid #ffd70030',
            boxShadow: 'inset 0 0 0 1px #ffd70020',
          }}
          aria-hidden="true"
        />
        {/* Center dot */}
        <div
          className="absolute w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono font-bold"
          style={{
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'radial-gradient(circle, #ffd70030, #0a0a0a)',
            border: '1px solid #ffd70040',
            color: '#ffd700',
          }}
          aria-hidden="true"
        >
          me
        </div>

        {/* Empty state placeholder dots */}
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-xs text-[#555555] text-center px-8 leading-relaxed">
              Complete a PoL ceremony to add contacts to your circle
            </p>
          </div>
        )}

        {/* High trust contacts — inner ring (r≈60px from center) */}
        {high.map((c, i) => {
          const pos = ringPosition(i, high.length, 60);
          return (
            <button
              key={c.pubkey}
              type="button"
              className="absolute w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-mono font-bold transition-transform hover:scale-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#ffd700]"
              style={{
                top: pos.top,
                left: pos.left,
                transform: 'translate(-50%, -50%)',
                backgroundColor: '#ffd70020',
                border: '1.5px solid #ffd700',
                color: '#ffd700',
              }}
              title={`${truncateNpub(c.pubkey)} — Score: ${c.trustScore}`}
              aria-label={`High trust contact ${truncateNpub(c.pubkey)}, score ${c.trustScore}`}
              onClick={() => onContactClick?.(c.pubkey)}
            >
              {c.trustScore}
            </button>
          );
        })}

        {/* Medium trust contacts — middle ring (r≈105px) */}
        {medium.map((c, i) => {
          const pos = ringPosition(i, medium.length, 105);
          return (
            <button
              key={c.pubkey}
              type="button"
              className="absolute w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-mono font-bold transition-transform hover:scale-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f7931a]"
              style={{
                top: pos.top,
                left: pos.left,
                transform: 'translate(-50%, -50%)',
                backgroundColor: '#f7931a20',
                border: '1.5px solid #f7931a',
                color: '#f7931a',
              }}
              title={`${truncateNpub(c.pubkey)} — Score: ${c.trustScore}`}
              aria-label={`Medium trust contact ${truncateNpub(c.pubkey)}, score ${c.trustScore}`}
              onClick={() => onContactClick?.(c.pubkey)}
            >
              {c.trustScore}
            </button>
          );
        })}

        {/* New contacts — outer ring (r≈135px) */}
        {low.map((c, i) => {
          const pos = ringPosition(i, low.length, 135);
          return (
            <button
              key={c.pubkey}
              type="button"
              className="absolute w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-mono font-bold transition-transform hover:scale-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
              style={{
                top: pos.top,
                left: pos.left,
                transform: 'translate(-50%, -50%)',
                backgroundColor: '#3b82f620',
                border: '1.5px solid #3b82f6',
                color: '#3b82f6',
              }}
              title={`${truncateNpub(c.pubkey)} — Score: ${c.trustScore}`}
              aria-label={`New contact ${truncateNpub(c.pubkey)}, score ${c.trustScore}`}
              onClick={() => onContactClick?.(c.pubkey)}
            >
              {c.trustScore}
            </button>
          );
        })}
      </div>

      {/* Ring legend */}
      <div className="flex items-center justify-center gap-4 flex-wrap">
        {[
          { color: '#ffd700', label: `High (${high.length})`,   count: high.length },
          { color: '#f7931a', label: `Medium (${medium.length})`, count: medium.length },
          { color: '#3b82f6', label: `New (${low.length})`,    count: low.length },
        ].map(tier => (
          <div key={tier.label} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: tier.color, boxShadow: `0 0 6px ${tier.color}60` }}
              aria-hidden="true"
            />
            <span className="text-xs text-[#a0a0a0]">{tier.label}</span>
          </div>
        ))}
      </div>

      {/* Stats bar */}
      <div
        className="grid grid-cols-4 gap-3 pt-4 border-t border-[#2a2a2a]"
        aria-label="Trust statistics"
      >
        <StatPill
          icon={Users}
          label="Contacts"
          value={stats.totalContacts}
          color="#f7931a"
        />
        <StatPill
          icon={TrendingUp}
          label="Avg Score"
          value={Math.round(stats.avgTrustScore)}
          color="#ffd700"
        />
        <StatPill
          icon={Shield}
          label="Meetings"
          value={stats.totalMeetings}
          color="#22c55e"
        />
        <StatPill
          icon={Clock}
          label="Oldest (d)"
          value={stats.oldestRelationshipDays}
          color="#3b82f6"
        />
      </div>
    </section>
  );
}

