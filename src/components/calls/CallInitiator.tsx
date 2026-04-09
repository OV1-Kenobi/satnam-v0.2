/**
 * CallInitiator — Voice/video call buttons for contact profiles
 * Spec: circle-of-trust-spec.md § CallInitiator
 *
 * - Phone icon (audio call)
 * - Video icon (video call)
 * - Only shown/enabled for PoL-verified contacts
 * - Requires vault unlock (PIN gate for outgoing comms)
 */

import clsx from 'clsx';
import { Phone, Video, ShieldAlert } from 'lucide-react';
import type { CallType } from '../../lib/calls/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CallInitiatorProps {
  peerPubkey: string;
  peerLabel?: string;
  /** Is this contact PoL-verified? Calls require PoL verification */
  isPolVerified: boolean;
  onInitiateCall: (pubkey: string, type: CallType) => void;
  /** Optional size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show labels under buttons */
  showLabels?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CallInitiator({
  peerPubkey,
  peerLabel,
  isPolVerified,
  onInitiateCall,
  size = 'md',
  showLabels = false,
}: CallInitiatorProps) {
  const sizeMap = {
    sm: { icon: 14, btn: 'w-8 h-8', ring: 'p-1.5' },
    md: { icon: 17, btn: 'w-10 h-10', ring: 'p-2' },
    lg: { icon: 20, btn: 'w-12 h-12', ring: 'p-2.5' },
  };
  const s = sizeMap[size];

  const handleAudio = () => {
    if (!isPolVerified) return;
    onInitiateCall(peerPubkey, 'audio');
  };

  const handleVideo = () => {
    if (!isPolVerified) return;
    onInitiateCall(peerPubkey, 'video');
  };

  if (!isPolVerified) {
    return (
      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
          style={{ backgroundColor: '#555555/10', border: '1px solid #2a2a2a', color: '#555555' }}
        >
          <ShieldAlert size={13} aria-hidden="true" />
          <span>PoL verification required for calls</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2"
      role="group"
      aria-label={`Call ${peerLabel ?? peerPubkey.slice(0, 8)}`}
    >
      {/* Audio call */}
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={handleAudio}
          aria-label={`Audio call ${peerLabel ?? peerPubkey.slice(0, 8)}`}
          title="Voice call"
          className={clsx(
            s.btn,
            'rounded-full flex items-center justify-center transition-all duration-150',
            'bg-[#22c55e]/15 border border-[#22c55e]/30 text-[#22c55e]',
            'hover:bg-[#22c55e]/25 active:scale-90',
          )}
        >
          <Phone size={s.icon} aria-hidden="true" />
        </button>
        {showLabels && (
          <span className="text-[10px] text-[#555555]">Voice</span>
        )}
      </div>

      {/* Video call */}
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={handleVideo}
          aria-label={`Video call ${peerLabel ?? peerPubkey.slice(0, 8)}`}
          title="Video call"
          className={clsx(
            s.btn,
            'rounded-full flex items-center justify-center transition-all duration-150',
            'bg-[#3b82f6]/15 border border-[#3b82f6]/30 text-[#3b82f6]',
            'hover:bg-[#3b82f6]/25 active:scale-90',
          )}
        >
          <Video size={s.icon} aria-hidden="true" />
        </button>
        {showLabels && (
          <span className="text-[10px] text-[#555555]">Video</span>
        )}
      </div>
    </div>
  );
}

