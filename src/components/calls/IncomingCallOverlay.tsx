/**
 * IncomingCallOverlay — Full-screen incoming call notification
 * Spec: circle-of-trust-spec.md § IncomingCallOverlay
 *
 * - Full-screen overlay with backdrop blur
 * - Caller info (name/npub)
 * - Accept (green) / Reject (red) buttons
 * - CSS pulsing ring animation
 * - Accessible: focus trap, keyboard shortcuts
 */

import { useEffect, useRef } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import type { CallSession } from '../../lib/calls/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IncomingCallOverlayProps {
  call: CallSession;
  callerLabel?: string;
  onAnswer: () => void;
  onReject: () => void;
}

// ---------------------------------------------------------------------------
// Pulsing ring (CSS animation)
// ---------------------------------------------------------------------------

function PulsingRing({ color }: { color: string }) {
  return (
    <div className="relative w-32 h-32 flex items-center justify-center" aria-hidden="true">
      {/* Outer pulse ring 1 */}
      <div
        className="absolute w-32 h-32 rounded-full animate-ping opacity-20"
        style={{ backgroundColor: color }}
      />
      {/* Outer pulse ring 2 (delayed) */}
      <div
        className="absolute w-28 h-28 rounded-full animate-ping opacity-20"
        style={{ backgroundColor: color, animationDelay: '0.3s' }}
      />
      {/* Middle ring */}
      <div
        className="absolute w-24 h-24 rounded-full opacity-10"
        style={{ backgroundColor: color }}
      />
      {/* Avatar */}
      <div
        className="relative z-10 w-20 h-20 rounded-full flex items-center justify-center font-mono font-bold text-xl border-4"
        style={{
          backgroundColor: `${color}20`,
          borderColor: color,
          color,
        }}
      >
        {/* Will show contact initial or generic icon */}
        <Phone size={28} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main overlay
// ---------------------------------------------------------------------------

export default function IncomingCallOverlay({
  call,
  callerLabel,
  onAnswer,
  onReject,
}: IncomingCallOverlayProps) {
  const acceptRef = useRef<HTMLButtonElement>(null);

  // Focus Accept button on mount
  useEffect(() => {
    acceptRef.current?.focus();
  }, []);

  // Keyboard: Enter = answer, Escape = reject
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter')  onAnswer();
      if (e.key === 'Escape') onReject();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onAnswer, onReject]);

  const isVideo = call.type === 'video';
  const ringColor = isVideo ? '#3b82f6' : '#22c55e';

  const npubShort = `${call.peerPubkey.slice(0, 8)}…${call.peerPubkey.slice(-4)}`;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center"
      style={{
        background: 'rgba(10,10,10,0.92)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Incoming call"
    >
      {/* Call type indicator */}
      <div className="flex items-center gap-2 mb-8">
        {isVideo
          ? <Video size={16} className="text-[#3b82f6]" aria-hidden="true" />
          : <Phone size={16} className="text-[#22c55e]" aria-hidden="true" />
        }
        <span className="text-sm text-[#a0a0a0]">
          Incoming {isVideo ? 'video' : 'voice'} call
        </span>
      </div>

      {/* Pulsing avatar ring */}
      <PulsingRing color={ringColor} />

      {/* Caller identity */}
      <div className="mt-8 text-center space-y-1">
        {callerLabel ? (
          <h2 className="heading-display text-2xl text-[#f5f5f5]">{callerLabel}</h2>
        ) : (
          <h2 className="font-mono text-lg text-[#a0a0a0]">{npubShort}</h2>
        )}
        <p className="font-mono text-xs text-[#555555]">{npubShort}</p>
      </div>

      {/* Accept / Reject buttons */}
      <div className="flex items-center gap-12 mt-12">
        {/* Reject */}
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onReject}
            aria-label="Reject call"
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500"
            style={{
              backgroundColor: '#ef444420',
              border: '2px solid #ef4444',
              color: '#ef4444',
            }}
          >
            <PhoneOff size={24} aria-hidden="true" />
          </button>
          <span className="text-xs text-[#555555]">Reject</span>
        </div>

        {/* Accept */}
        <div className="flex flex-col items-center gap-3">
          <button
            ref={acceptRef}
            type="button"
            onClick={onAnswer}
            aria-label="Accept call"
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-500 animate-pulse"
            style={{
              backgroundColor: '#22c55e',
              border: '2px solid #16a34a',
              color: 'black',
            }}
          >
            {isVideo
              ? <Video size={24} aria-hidden="true" />
              : <Phone size={24} aria-hidden="true" />
            }
          </button>
          <span className="text-xs text-[#a0a0a0]">Accept</span>
        </div>
      </div>

      {/* Keyboard hint */}
      <p className="mt-8 text-xs text-[#555555]">Enter to accept · Esc to reject</p>
    </div>
  );
}


