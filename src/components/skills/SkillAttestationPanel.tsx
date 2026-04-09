/**
 * SkillAttestationPanel — Attestation management panel
 * Phase 3: NIP-SKL skill attestations
 *
 * Features:
 * - List of attestations for a skill
 * - Attest button with tier selection
 * - Revocation button
 */

import { useState } from 'react';
import clsx from 'clsx';
import { Shield, X, CheckCircle, AlertTriangle, Plus, ChevronDown } from 'lucide-react';
import { useSkillManager } from '../../hooks/useSkillManager.js';
import type { Skill, SkillAttestation, AttestationTier } from '../../hooks/useSkillManager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillAttestationPanelProps {
  skill: Skill;
  currentUserPubkey?: string;
  canAttest?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const TIER_CONFIG: Record<AttestationTier, {
  label: string;
  description: string;
  badgeClass: string;
  textClass: string;
}> = {
  tier1: {
    label: 'Tier 1 — Self-declared',
    description: 'Publisher self-declares this skill. No external verification.',
    badgeClass: 'bg-slate-600 text-slate-200',
    textClass: 'text-slate-400',
  },
  tier2: {
    label: 'Tier 2 — Peer-reviewed',
    description: 'A peer in the network has reviewed and attested this skill.',
    badgeClass: 'bg-blue-600 text-white',
    textClass: 'text-blue-400',
  },
  tier3: {
    label: 'Tier 3 — Guardian-attested',
    description: 'A Guardian has formally attested this skill with higher authority.',
    badgeClass: 'bg-[#f7931a] text-white',
    textClass: 'text-[#f7931a]',
  },
  tier4: {
    label: 'Tier 4 — Oracle-verified',
    description: 'An oracle or automated system has cryptographically verified this skill.',
    badgeClass: 'bg-[#ffd700] text-slate-900',
    textClass: 'text-[#ffd700]',
  },
};

// ---------------------------------------------------------------------------
// Attestation row
// ---------------------------------------------------------------------------

function AttestationRow({
  attestation,
  onRevoke,
  canRevoke,
}: {
  attestation: SkillAttestation;
  onRevoke?: (attesterPubkey: string) => void;
  canRevoke?: boolean;
}) {
  const config = TIER_CONFIG[attestation.tier];

  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
        attestation.revoked
          ? 'bg-[#111111] border-[#222222] opacity-50'
          : 'bg-[#1a1a1a] border-[#2a2a2a]',
      )}
    >
      {/* Tier badge */}
      <span
        className={clsx(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0',
          config.badgeClass,
        )}
      >
        <Shield size={9} />
        {attestation.tier.toUpperCase()}
      </span>

      {/* Attester info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <code className="font-mono text-xs text-[#a0a0a0] truncate">
            {attestation.attesterPubkey.slice(0, 16)}…
          </code>
          {attestation.revoked ? (
            <span className="text-[10px] text-red-400 font-medium">REVOKED</span>
          ) : (
            <CheckCircle size={11} className="text-green-500 flex-shrink-0" />
          )}
        </div>
        <p className="text-[10px] text-[#555555]">{formatTimestamp(attestation.timestamp)}</p>
      </div>

      {/* Revoke button */}
      {canRevoke && !attestation.revoked && onRevoke && (
        <button
          type="button"
          onClick={() => onRevoke(attestation.attesterPubkey)}
          aria-label="Revoke attestation"
          className="flex-shrink-0 p-1 rounded text-[#555555] hover:text-red-400 hover:bg-red-900/20 transition-colors"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tier selector dropdown
// ---------------------------------------------------------------------------

function TierSelector({
  value,
  onChange,
}: {
  value: AttestationTier;
  onChange: (tier: AttestationTier) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = TIER_CONFIG[value];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-sm text-[#f5f5f5] hover:border-[#f7931a] transition-colors w-full"
      >
        <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-bold', selected.badgeClass)}>
          {value.toUpperCase()}
        </span>
        <span className="flex-1 text-left text-[#a0a0a0] text-xs">{selected.label}</span>
        <ChevronDown size={14} className={clsx('text-[#555555] transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 right-0 mt-1 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] overflow-hidden z-10 shadow-xl"
          role="listbox"
          aria-label="Attestation tier"
        >
          {(Object.entries(TIER_CONFIG) as Array<[AttestationTier, typeof TIER_CONFIG.tier1]>).map(([tier, config]) => (
            <button
              key={tier}
              type="button"
              role="option"
              aria-selected={value === tier}
              onClick={() => { onChange(tier); setOpen(false); }}
              className={clsx(
                'w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-[#222222] transition-colors',
                value === tier && 'bg-[#222222]',
              )}
            >
              <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 mt-0.5', config.badgeClass)}>
                {tier.toUpperCase()}
              </span>
              <div>
                <p className="text-xs font-medium text-[#f5f5f5]">{config.label}</p>
                <p className="text-[10px] text-[#555555] mt-0.5">{config.description}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function SkillAttestationPanel({
  skill,
  currentUserPubkey,
  canAttest = false,
}: SkillAttestationPanelProps) {
  const { attestSkill, revokeSkill, isLoading } = useSkillManager();
  const [selectedTier, setSelectedTier] = useState<AttestationTier>('tier2');
  const [attestError, setAttestError] = useState<string | null>(null);
  const [attestSuccess, setAttestSuccess] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const activeAttestations = skill.attestations.filter(a => !a.revoked);
  const revokedAttestations = skill.attestations.filter(a => a.revoked);
  const userHasAttested = currentUserPubkey
    ? skill.attestations.some(a => a.attesterPubkey === currentUserPubkey && !a.revoked)
    : false;

  const handleAttest = async () => {
    setAttestError(null);
    setAttestSuccess(false);
    try {
      await attestSkill(skill.manifestEventId, selectedTier, '' /* signerNsec provided by vault in hook */);
      setAttestSuccess(true);
      setTimeout(() => setAttestSuccess(false), 3000);
    } catch (err) {
      setAttestError(err instanceof Error ? err.message : 'Attestation failed');
    }
  };

  const handleRevoke = async (attesterPubkey: string) => {
    setRevokeError(null);
    try {
      await revokeSkill(skill.manifestEventId, '' /* signerNsec provided by vault */, attesterPubkey);
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : 'Revocation failed');
    }
  };

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-[#555555] uppercase tracking-widest">Attestations</h3>
        <div className="flex items-center gap-2">
          <Shield size={12} className="text-[#555555]" />
          <span className="text-xs text-[#a0a0a0]">
            {activeAttestations.length} active
            {revokedAttestations.length > 0 && `, ${revokedAttestations.length} revoked`}
          </span>
        </div>
      </div>

      {/* Active attestations */}
      {activeAttestations.length === 0 ? (
        <div className="text-center py-6 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
          <Shield size={24} className="mx-auto text-[#555555] mb-2" />
          <p className="text-sm text-[#555555]">No active attestations</p>
          <p className="text-xs text-[#555555]">This skill is self-declared only</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeAttestations.map((attestation, i) => (
            <AttestationRow
              key={`${attestation.attesterPubkey}-${i}`}
              attestation={attestation}
              onRevoke={handleRevoke}
              canRevoke={currentUserPubkey === attestation.attesterPubkey}
            />
          ))}
        </div>
      )}

      {/* Revoked attestations (collapsed) */}
      {revokedAttestations.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-[#555555] uppercase tracking-widest">Revoked</p>
          {revokedAttestations.map((attestation, i) => (
            <AttestationRow
              key={`revoked-${attestation.attesterPubkey}-${i}`}
              attestation={attestation}
            />
          ))}
        </div>
      )}

      {/* Attest action */}
      {canAttest && !userHasAttested && (
        <div className="pt-3 border-t border-[#2a2a2a] space-y-3">
          <p className="text-xs font-medium text-[#a0a0a0]">Add Attestation</p>

          <TierSelector value={selectedTier} onChange={setSelectedTier} />

          {attestError && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/10 border border-red-900/30 text-red-400 text-xs" role="alert">
              <AlertTriangle size={12} />
              {attestError}
            </div>
          )}

          {attestSuccess && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-900/10 border border-green-900/30 text-green-400 text-xs" role="status">
              <CheckCircle size={12} />
              Attestation published successfully
            </div>
          )}

          <button
            type="button"
            onClick={handleAttest}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#f7931a] hover:bg-[#e8841a] text-white font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={14} />
            {isLoading ? 'Publishing…' : 'Attest This Skill'}
          </button>
        </div>
      )}

      {userHasAttested && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-900/10 border border-green-900/30 text-green-400 text-sm">
          <CheckCircle size={14} />
          You have attested this skill
        </div>
      )}

      {revokeError && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-900/10 border border-red-900/30 text-red-400 text-xs" role="alert">
          <AlertTriangle size={12} />
          {revokeError}
        </div>
      )}
    </div>
  );
}

