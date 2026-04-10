/**
 * ProviderCard — DVM provider display card
 * Phase 3: NIP-90 DVM marketplace
 *
 * Displays:
 * - Provider name/pubkey
 * - Supported job kinds
 * - Reputation score
 * - "Submit Job" button
 */

import clsx from 'clsx';
import { Server, Star, Shield, Zap, ArrowRight } from 'lucide-react';
import type { DVMProvider } from '../../hooks/useMarketplace.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderCardProps {
  provider: DVMProvider;
  onSubmitJob?: (provider: DVMProvider) => void;
  onViewDetails?: (provider: DVMProvider) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncatePubkey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
}

function reputationColor(score?: number): string {
  if (!score) return 'text-[#555555]';
  if (score >= 0.8) return 'text-green-500';
  if (score >= 0.5) return 'text-yellow-500';
  return 'text-red-500';
}

function reputationLabel(score?: number): string {
  if (!score) return 'Unknown';
  if (score >= 0.9) return 'Excellent';
  if (score >= 0.7) return 'Good';
  if (score >= 0.5) return 'Fair';
  return 'Poor';
}

// Map NIP-90 job kind numbers to readable labels
const JOB_KIND_LABELS: Record<number, string> = {
  5000: 'Text Generation',
  5001: 'Text Summary',
  5002: 'Translation',
  5003: 'Sentiment Analysis',
  5004: 'NLU',
  5100: 'Image Gen',
  5200: 'Audio Transcription',
  5300: 'TTS',
  5400: 'Video Gen',
  5500: 'Code Exec',
  5600: 'Web Search',
  5900: 'Image Classification',
};

function jobKindLabel(kind: number): string {
  return JOB_KIND_LABELS[kind] ?? `kind:${kind}`;
}

// ---------------------------------------------------------------------------
// Star rating
// ---------------------------------------------------------------------------

function StarRating({ score }: { score?: number }) {
  if (!score) return null;
  const stars = Math.round(score * 5);
  return (
    <div className="flex items-center gap-0.5" aria-label={`Rating: ${(score * 100).toFixed(0)}/100`}>
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={11}
          className={clsx(i <= stars ? 'text-[#ffd700] fill-[#ffd700]' : 'text-[#2a2a2a]')}
        />
      ))}
      <span className={clsx('text-xs ml-1', reputationColor(score))}>
        {reputationLabel(score)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProviderCard({
  provider,
  onSubmitJob,
  onViewDetails,
}: ProviderCardProps) {
  const displayName = provider.name ?? truncatePubkey(provider.pubkey);

  return (
    <article
      className={clsx(
        'card transition-all duration-150',
        onViewDetails && 'cursor-pointer hover:border-[#f7931a]/40 active:scale-[0.99]',
      )}
      onClick={onViewDetails ? () => onViewDetails(provider) : undefined}
      aria-label={`DVM Provider: ${displayName}`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        {/* No picture field on DvmProvider — use default icon */}
        <div className="w-10 h-10 rounded-lg bg-blue-600/20 border border-blue-600/30 flex items-center justify-center flex-shrink-0">
          <Server size={18} className="text-blue-400" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-[#f5f5f5] truncate">{displayName}</h3>
          <code className="font-mono text-xs text-[#555555]">{truncatePubkey(provider.pubkey)}</code>
        </div>

        {onViewDetails && (
          <ArrowRight size={14} className="text-[#555555] flex-shrink-0 mt-1" aria-hidden="true" />
        )}
      </div>

      {/* About */}
      {provider.about && (
        <p className="text-sm text-[#a0a0a0] mb-3 line-clamp-2">{provider.about}</p>
      )}

      {/* Reputation */}
      {provider.reputationScore !== undefined && (
        <div className="flex items-center gap-2 mb-3">
          <StarRating score={provider.reputationScore} />
          <span className="text-xs text-[#555555]">
            ({(provider.reputationScore * 100).toFixed(0)}/100)
          </span>
        </div>
      )}

      {/* Supported job kinds */}
      {provider.supportedJobKinds.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] text-[#555555] uppercase tracking-widest mb-1.5">Supported Jobs</p>
          <div className="flex flex-wrap gap-1">
            {provider.supportedJobKinds.slice(0, 5).map(kind => (
              <span
                key={kind}
                className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-medium"
              >
                {jobKindLabel(kind)}
              </span>
            ))}
            {provider.supportedJobKinds.length > 5 && (
              <span className="text-[10px] text-[#555555]">
                +{provider.supportedJobKinds.length - 5} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Skill scope IDs */}
      {provider.skillScopeIds.length > 0 && (
        <div className="flex items-center gap-1.5 mb-4">
          <Shield size={11} className="text-[#555555]" />
          <span className="text-xs text-[#555555]">
            {provider.skillScopeIds.length} skill{provider.skillScopeIds.length !== 1 ? 's' : ''} attested
          </span>
        </div>
      )}

      {/* Relay count */}
      <div className="flex justify-between items-center pt-3 border-t border-[#2a2a2a]">
        <span className="text-xs text-[#555555]">
          {provider.relays.length} relay{provider.relays.length !== 1 ? 's' : ''}
        </span>

        {onSubmitJob && (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onSubmitJob(provider);
            }}
            aria-label={`Submit job to ${displayName}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f7931a] hover:bg-[#e8841a] text-white text-xs font-medium transition-colors"
          >
            <Zap size={11} />
            Submit Job
          </button>
        )}
      </div>
    </article>
  );
}
