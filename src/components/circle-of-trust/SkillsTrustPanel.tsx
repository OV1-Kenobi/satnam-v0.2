/**
 * SkillsTrustPanel — Skills reputation from trusted contacts
 * Spec: circle-of-trust-spec.md § SkillsTrustPanel
 *
 * - Skills attested by PoL-verified contacts (higher weight)
 * - Attestation tier breakdown per skill
 * - Skill growth over time (CSS bars)
 */

import {
  BookOpen,
  TrendingUp,
  Award,
  ShieldCheck,
  Star,
  StarHalf,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillAttestation {
  skill: string;
  /** Number of PoL-verified contacts who attested this skill */
  polAttestations: number;
  /** Non-PoL attestations */
  generalAttestations: number;
  /** Tier: 0=unverified, 1=endorsed, 2=expert, 3=master */
  tier: 0 | 1 | 2 | 3;
  /** Growth: how many new attestations in last 90 days */
  recentGrowth: number;
}

interface SkillsTrustPanelProps {
  skills?: SkillAttestation[];
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Tier config
// ---------------------------------------------------------------------------

const TIER_CONFIG = {
  0: { label: 'Unverified', color: '#555555', icon: Star },
  1: { label: 'Endorsed',   color: '#3b82f6', icon: StarHalf },
  2: { label: 'Expert',     color: '#f7931a', icon: Award },
  3: { label: 'Master',     color: '#ffd700', icon: ShieldCheck },
} as const;

// ---------------------------------------------------------------------------
// Skill card
// ---------------------------------------------------------------------------

function SkillCard({ skill }: { skill: SkillAttestation }) {
  const tier = TIER_CONFIG[skill.tier];
  const { icon: TierIcon } = tier;
  const totalAttestations = skill.polAttestations + skill.generalAttestations;
  const polPct = totalAttestations > 0
    ? Math.round((skill.polAttestations / totalAttestations) * 100)
    : 0;

  return (
    <article
      className="p-4 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] space-y-3"
      aria-label={`Skill: ${skill.skill}, tier: ${tier.label}`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-[#f5f5f5] truncate">{skill.skill}</h4>
          <p className="text-xs text-[#555555] mt-0.5">{totalAttestations} total attestation{totalAttestations !== 1 ? 's' : ''}</p>
        </div>
        <div
          className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold flex-shrink-0"
          style={{ backgroundColor: `${tier.color}20`, border: `1px solid ${tier.color}40`, color: tier.color }}
        >
          <TierIcon size={11} aria-hidden="true" />
          {tier.label}
        </div>
      </div>

      {/* Attestation breakdown */}
      <div className="space-y-1.5">
        {/* PoL-verified attestations */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={11} className="text-[#22c55e]" aria-hidden="true" />
              <span className="text-[#a0a0a0]">PoL Verified</span>
            </div>
            <span className="font-mono text-[#22c55e] font-bold">{skill.polAttestations}</span>
          </div>
          <div
            className="h-1.5 rounded-full bg-[#2a2a2a] overflow-hidden"
            role="progressbar"
            aria-valuenow={skill.polAttestations}
            aria-valuemin={0}
            aria-valuemax={Math.max(totalAttestations, 1)}
            aria-label="PoL verified attestations"
          >
            <div
              className="h-full rounded-full bg-[#22c55e] transition-all duration-500"
              style={{ width: `${polPct}%` }}
            />
          </div>
        </div>

        {/* General attestations */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5">
              <Star size={11} className="text-[#555555]" aria-hidden="true" />
              <span className="text-[#a0a0a0]">General</span>
            </div>
            <span className="font-mono text-[#555555]">{skill.generalAttestations}</span>
          </div>
          <div
            className="h-1.5 rounded-full bg-[#2a2a2a] overflow-hidden"
            role="progressbar"
            aria-valuenow={skill.generalAttestations}
            aria-valuemin={0}
            aria-valuemax={Math.max(totalAttestations, 1)}
            aria-label="General attestations"
          >
            <div
              className="h-full rounded-full bg-[#3a3a3a] transition-all duration-500"
              style={{ width: `${100 - polPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Growth indicator */}
      {skill.recentGrowth > 0 && (
        <div className="flex items-center gap-1.5 text-[11px]">
          <TrendingUp size={11} className="text-[#22c55e]" aria-hidden="true" />
          <span className="text-[#22c55e]">+{skill.recentGrowth} new attestation{skill.recentGrowth !== 1 ? 's' : ''} in 90 days</span>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Tier summary bar
// ---------------------------------------------------------------------------

function TierSummary({ skills }: { skills: SkillAttestation[] }) {
  const counts = {
    0: skills.filter(s => s.tier === 0).length,
    1: skills.filter(s => s.tier === 1).length,
    2: skills.filter(s => s.tier === 2).length,
    3: skills.filter(s => s.tier === 3).length,
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {([3, 2, 1, 0] as const).map(tier => {
        const cfg = TIER_CONFIG[tier];
        const { icon: Icon } = cfg;
        if (counts[tier] === 0) return null;
        return (
          <div
            key={tier}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
            style={{ backgroundColor: `${cfg.color}15`, border: `1px solid ${cfg.color}30`, color: cfg.color }}
          >
            <Icon size={11} aria-hidden="true" />
            {counts[tier]} {cfg.label}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

const MOCK_SKILLS: SkillAttestation[] = [];

export default function SkillsTrustPanel({
  skills = MOCK_SKILLS,
  isLoading = false,
}: SkillsTrustPanelProps) {
  // Sort by tier desc, then polAttestations desc
  const sorted = [...skills].sort((a, b) => {
    if (b.tier !== a.tier) return b.tier - a.tier;
    return b.polAttestations - a.polAttestations;
  });

  return (
    <section className="card space-y-5" aria-label="Skills trust panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="heading-display text-lg text-[#22c55e]">Skills Trust</h2>
          <p className="text-xs text-[#555555] mt-0.5">Attested by PoL-verified contacts</p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-[#22c55e]/10 border border-[#22c55e]/20 flex items-center justify-center">
          <BookOpen size={18} className="text-[#22c55e]" aria-hidden="true" />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-hidden="true">
          {[1, 2, 3].map(i => <div key={i} className="h-32 skeleton rounded-xl" />)}
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-10 space-y-3">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[#22c55e]/10 border border-[#22c55e]/20 flex items-center justify-center">
            <BookOpen size={28} className="text-[#22c55e]" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium text-[#f5f5f5]">No Skills Attested Yet</p>
            <p className="text-xs text-[#555555] mt-1 max-w-xs mx-auto">
              Ask your PoL-verified contacts to attest your skills. PoL attestations carry higher weight.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Tier breakdown summary */}
          <TierSummary skills={sorted} />

          {/* Skill cards */}
          <div className="space-y-3">
            {sorted.map(skill => (
              <SkillCard key={skill.skill} skill={skill} />
            ))}
          </div>

          {/* Legend */}
          <div className="pt-2 border-t border-[#2a2a2a]">
            <p className="text-[10px] text-[#555555] uppercase tracking-wider mb-2">Tier Legend</p>
            <div className="grid grid-cols-2 gap-1.5">
              {([3, 2, 1, 0] as const).map(tier => {
                const cfg = TIER_CONFIG[tier];
                const { icon: Icon } = cfg;
                return (
                  <div key={tier} className="flex items-center gap-2 text-[11px]">
                    <Icon size={12} style={{ color: cfg.color }} aria-hidden="true" />
                    <span style={{ color: cfg.color }}>{cfg.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}


