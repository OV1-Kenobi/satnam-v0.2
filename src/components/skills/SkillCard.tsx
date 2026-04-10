/**
 * SkillCard — Skill display card
 * Phase 3: NIP-SKL skill management
 *
 * Displays:
 * - Name, version, description
 * - Attestation tier badge (tier1-4 with colors)
 * - Capabilities as chips
 * - Publisher info
 * - Attest button (for Guardians)
 */

import clsx from 'clsx';
import { Shield, BookOpen, Calendar, ExternalLink } from 'lucide-react';
import type { Skill, AttestationTier } from '../../hooks/useSkillManager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillCardProps {
  skill: Skill;
  onAttest?: (skillId: string) => void;
  onViewDetails?: (skillId: string) => void;
  showAttestButton?: boolean;
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString();
}

function getTopTier(skill: Skill): AttestationTier | null {
  const attestations = skill.attestations;
  if (attestations.length === 0) return null;
  const sorted = [...attestations].sort((a, b) => {
    const tierNum = (t: AttestationTier | undefined) =>
      t ? parseInt(t.replace('tier', '')) : 0;
    return tierNum(b.tier) - tierNum(a.tier);
  });
  const top = sorted[0];
  return top?.tier ?? null;
}

function tierBadgeClass(tier: AttestationTier): string {
  switch (tier) {
    case 'tier4': return 'bg-[#ffd700] text-slate-900';
    case 'tier3': return 'bg-[#f7931a] text-white';
    case 'tier2': return 'bg-blue-600 text-white';
    default: return 'bg-slate-600 text-slate-200';
  }
}

function tierLabel(tier: AttestationTier): string {
  switch (tier) {
    case 'tier4': return 'T4 Oracle';
    case 'tier3': return 'T3 Guardian';
    case 'tier2': return 'T2 Peer';
    default: return 'T1 Self';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SkillCard({
  skill,
  onAttest,
  onViewDetails,
  showAttestButton = false,
  compact = false,
}: SkillCardProps) {
  const topTier = getTopTier(skill);
  const activeAttestations = skill.attestations;
  const isExpired = skill.validUntilUnix != null && skill.validUntilUnix < Date.now() / 1000;
  const capabilities = skill.capabilities ?? [];

  return (
    <article
      className={clsx(
        'card transition-all duration-150',
        onViewDetails && 'cursor-pointer hover:border-[#f7931a]/40 active:scale-[0.99]',
        isExpired && 'opacity-60',
      )}
      onClick={onViewDetails ? () => onViewDetails(skill.skillScopeId) : undefined}
      aria-label={`Skill: ${skill.name} v${skill.version}`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-blue-600/20 border border-blue-600/30 flex items-center justify-center flex-shrink-0">
          <BookOpen size={16} className="text-blue-400" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-[#f5f5f5] truncate">{skill.name}</h3>
            {topTier && (
              <span
                className={clsx(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold',
                  tierBadgeClass(topTier),
                )}
              >
                <Shield size={9} />
                {tierLabel(topTier)}
              </span>
            )}
            {isExpired && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-900/30 text-red-400 border border-red-900/30">
                EXPIRED
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            <span className="font-mono text-xs text-[#555555]">v{skill.version}</span>
            <span className="text-[#2a2a2a]">·</span>
            <span className="font-mono text-xs text-[#555555] truncate">{skill.skillScopeId}</span>
          </div>
        </div>

        {onViewDetails && (
          <ExternalLink size={14} className="text-[#555555] flex-shrink-0 mt-0.5" aria-hidden="true" />
        )}
      </div>

      {/* Description */}
      {!compact && skill.description && (
        <p className="text-sm text-[#a0a0a0] mb-3 line-clamp-2">{skill.description}</p>
      )}

      {/* Capability chips */}
      {capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3" aria-label="Capabilities">
          {capabilities.slice(0, compact ? 3 : 6).map(cap => (
            <span
              key={cap}
              className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-medium"
            >
              {cap}
            </span>
          ))}
          {capabilities.length > (compact ? 3 : 6) && (
            <span className="text-[10px] text-[#555555]">
              +{capabilities.length - (compact ? 3 : 6)} more
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-[#2a2a2a]">
        <div className="flex items-center gap-3">
          {/* Attestation count */}
          <div className="flex items-center gap-1">
            <Shield size={11} className="text-[#555555]" />
            <span className="text-xs text-[#555555]">
              {activeAttestations.length} attestation{activeAttestations.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Publisher */}
          <div className="hidden sm:flex items-center gap-1">
            <span className="text-xs text-[#555555]">by</span>
            <code className="font-mono text-xs text-[#555555]">
              {skill.publisherPubkey.slice(0, 8)}…
            </code>
          </div>
        </div>

        {/* Expiry */}
        {skill.validUntilUnix != null && (
          <div className="flex items-center gap-1">
            <Calendar size={10} className="text-[#555555]" />
            <span className="text-[10px] text-[#555555]">
              {isExpired ? 'Expired' : 'Expires'} {formatTimestamp(skill.validUntilUnix)}
            </span>
          </div>
        )}
      </div>

      {/* Attest button */}
      {showAttestButton && onAttest && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onAttest(skill.skillScopeId);
          }}
          aria-label={`Attest skill ${skill.name}`}
          className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f7931a]/20 hover:bg-[#f7931a]/30 text-[#f7931a] border border-[#f7931a]/30 text-xs font-medium transition-colors"
        >
          <Shield size={12} />
          Attest Skill
        </button>
      )}
    </article>
  );
}

