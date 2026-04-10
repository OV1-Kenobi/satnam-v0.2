/**
 * IdentityTrustPanel — Your own identity trust profile
 * Spec: circle-of-trust-spec.md § IdentityTrustPanel
 *
 * - Verification count (how many PoL verifications)
 * - Trust chain depth
 * - Skill attestations from trusted contacts
 * - Reputation score
 */

import { Fragment } from 'react';
import {
  ShieldCheck,
  Link2,
  Star,
  TrendingUp,
  Award,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import type { IdentityTrustProfile } from '../../lib/circle-of-trust/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IdentityTrustPanelProps {
  profile: IdentityTrustProfile | null;
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Metric card
// ---------------------------------------------------------------------------

function MetricCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div
      className="flex flex-col gap-2 p-4 rounded-xl border"
      style={{ backgroundColor: `${color}08`, borderColor: `${color}25` }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: `${color}20`, border: `1px solid ${color}40` }}
        aria-hidden="true"
      >
        <Icon size={16} style={{ color }} />
      </div>
      <div>
        <p className="font-mono text-xl font-bold" style={{ color }}>{value}</p>
        <p className="text-xs font-medium text-[#a0a0a0] mt-0.5">{label}</p>
        {sub && <p className="text-[11px] text-[#555555] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill attestation badge
// ---------------------------------------------------------------------------

function SkillBadge({ skill }: { skill: string }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{
        backgroundColor: '#22c55e15',
        border: '1px solid #22c55e30',
        color: '#22c55e',
      }}
    >
      <CheckCircle2 size={11} aria-hidden="true" />
      {skill}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reputation bar
// ---------------------------------------------------------------------------

function ReputationBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value * 100));
  const color = value > 0.8 ? '#22c55e' : value > 0.5 ? '#f7931a' : '#ef4444';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[#a0a0a0]">Financial Reputation</span>
        <span className="font-mono font-bold" style={{ color }}>
          {Math.round(value * 100)}%
        </span>
      </div>
      <div
        className="h-2 rounded-full bg-[#2a2a2a] overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Financial reputation"
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trust chain visual
// ---------------------------------------------------------------------------

function TrustChain({ depth }: { depth: number }) {
  const nodes = Math.min(depth, 6); // Show max 6 nodes

  return (
    <div className="space-y-2">
      <p className="text-xs text-[#555555] uppercase tracking-wider">Trust Chain Depth</p>
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {/* Origin node (self) */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-mono font-bold"
          style={{ backgroundColor: '#ffd70020', border: '2px solid #ffd700', color: '#ffd700' }}
          aria-label="You"
        >
          me
        </div>

        {Array.from({ length: nodes }).map((_, i) => (
          <Fragment key={i}>
            {/* Connector line */}
            <div className="w-4 h-px bg-[#2a2a2a] flex-shrink-0" aria-hidden="true" />
            {/* Chain node */}
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: '#f7931a10',
                border: `1.5px solid #f7931a${Math.max(20, 60 - i * 8).toString(16).padStart(2, '0')}`,
                color: '#f7931a',
                opacity: 1 - i * 0.1,
              }}
              aria-label={`Chain depth ${i + 1}`}
            >
              <Link2 size={12} aria-hidden="true" />
            </div>
          </Fragment>
        ))}

        {depth > 6 && (
          <span className="text-xs text-[#555555] ml-1 flex-shrink-0">+{depth - 6} more</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton state
// ---------------------------------------------------------------------------

function IdentitySkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-24 skeleton rounded-xl" />
        ))}
      </div>
      <div className="h-12 skeleton rounded-xl" />
      <div className="h-20 skeleton rounded-xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function IdentityEmpty() {
  return (
    <div className="text-center py-10 space-y-3">
      <div className="w-16 h-16 mx-auto rounded-2xl bg-[#ffd700]/10 border border-[#ffd700]/20 flex items-center justify-center">
        <ShieldCheck size={28} className="text-[#ffd700]" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-[#f5f5f5]">Identity Trust Not Yet Established</p>
        <p className="text-xs text-[#555555] mt-1 max-w-xs mx-auto">
          Complete PoL ceremonies to build your verifiable identity trust profile.
        </p>
      </div>
      <div className="flex items-center justify-center gap-2 text-xs text-[#555555]">
        <AlertCircle size={13} aria-hidden="true" />
        <span>Requires at least one PoL-verified contact</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function IdentityTrustPanel({
  profile,
  isLoading = false,
}: IdentityTrustPanelProps) {
  return (
    <section className="card space-y-5" aria-label="Identity trust profile">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="heading-display text-lg text-[#ffd700]">Identity Trust</h2>
          <p className="text-xs text-[#555555] mt-0.5">How your peers see your identity</p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-[#ffd700]/10 border border-[#ffd700]/20 flex items-center justify-center">
          <Award size={18} className="text-[#ffd700]" aria-hidden="true" />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <IdentitySkeleton />
      ) : !profile ? (
        <IdentityEmpty />
      ) : (
        <>
          {/* Metrics grid */}
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              icon={ShieldCheck}
              label="PoL Verifications"
              value={profile.verificationCount}
              sub={`People who verified you`}
              color="#22c55e"
            />
            <MetricCard
              icon={Link2}
              label="Chain Depth"
              value={profile.chainDepth}
              sub="Trust chain length"
              color="#f7931a"
            />
            <MetricCard
              icon={Star}
              label="Attested Skills"
              value={profile.attestedSkills.length}
              sub="Verified by contacts"
              color="#ffd700"
            />
            <MetricCard
              icon={TrendingUp}
              label="Financial Rep"
              value={`${Math.round(profile.financialReputation * 100)}%`}
              sub="Settlement rate"
              color="#3b82f6"
            />
          </div>

          {/* Reputation bar */}
          <div className="p-4 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
            <ReputationBar value={profile.financialReputation} />
          </div>

          {/* Trust chain visualization */}
          {profile.chainDepth > 0 && (
            <div className="p-4 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
              <TrustChain depth={profile.chainDepth} />
            </div>
          )}

          {/* Attested skills */}
          {profile.attestedSkills.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-[#555555] uppercase tracking-wider">Skills Attested by PoL Contacts</p>
              <div className="flex flex-wrap gap-2">
                {profile.attestedSkills.map(skill => (
                  <SkillBadge key={skill} skill={skill} />
                ))}
              </div>
            </div>
          )}

          {profile.nip05 && (
            <div className="pt-1 border-t border-[#2a2a2a]">
              <p className="text-xs text-[#555555]">NIP-05 Identity</p>
              <p className="text-sm font-medium text-[#f7931a] mt-0.5">{profile.nip05}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}


