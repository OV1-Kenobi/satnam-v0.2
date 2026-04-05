/**
 * ActiveCallPanel — Active call display
 * Spec: circle-of-trust-spec.md § ActiveCallPanel
 *
 * - Video feeds: local (small, picture-in-picture), remote (large)
 * - Audio-only mode: avatar + waveform placeholder
 * - Controls: mute, video toggle, end call
 * - Duration timer (from useCalls hook)
 * - Connection quality indicator (CSS dot)
 */

import React, { useRef, useEffect } from 'react';
import clsx from 'clsx';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Wifi,
  WifiOff,
  User,
} from 'lucide-react';
import type { CallSession } from '../../lib/calls/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveCallPanelProps {
  call: CallSession;
  peerLabel?: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  callDuration: number;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onEndCall: () => void;
}

// ---------------------------------------------------------------------------
// Duration formatter
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Video element
// ---------------------------------------------------------------------------

function VideoEl({
  stream,
  muted = false,
  className,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={clsx('bg-[#0a0a0a] object-cover', className)}
      aria-label={muted ? 'Local camera feed' : 'Remote camera feed'}
    />
  );
}

// ---------------------------------------------------------------------------
// Control button
// ---------------------------------------------------------------------------

function ControlBtn({
  icon: Icon,
  iconOff: IconOff,
  label,
  isOff = false,
  onClick,
  danger = false,
}: {
  icon: typeof Mic;
  iconOff?: typeof MicOff;
  label: string;
  isOff?: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  const DisplayIcon = isOff && IconOff ? IconOff : Icon;
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={isOff}
        className={clsx(
          'w-14 h-14 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 focus-visible:outline focus-visible:outline-2',
          danger
            ? 'bg-[#ef4444] text-white hover:bg-red-600 focus-visible:outline-red-500 border-2 border-red-600'
            : isOff
            ? 'bg-[#2a2a2a] border border-[#3a3a3a] text-[#555555]'
            : 'bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] hover:bg-[#2a2a2a]',
        )}
      >
        <DisplayIcon size={22} aria-hidden="true" />
      </button>
      <span className="text-[10px] text-[#555555]">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quality dot
// ---------------------------------------------------------------------------

function QualityDot({ state }: { state: string }) {
  const color = state === 'connected' ? '#22c55e' : state === 'connecting' ? '#f59e0b' : '#ef4444';
  const label = state === 'connected' ? 'Connected' : state === 'connecting' ? 'Connecting…' : 'Poor connection';

  return (
    <div className="flex items-center gap-1.5" title={label} aria-label={`Call quality: ${label}`}>
      <div
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }}
        aria-hidden="true"
      />
      <span className="text-[11px]" style={{ color }}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audio-only display
// ---------------------------------------------------------------------------

function AudioOnlyDisplay({ peerLabel, peerPubkey }: { peerLabel?: string; peerPubkey: string }) {
  const initial = peerLabel ? peerLabel[0].toUpperCase() : peerPubkey[0].toUpperCase();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-[#0f0f0f]" aria-label="Audio call active">
      <div
        className="w-24 h-24 rounded-full flex items-center justify-center text-2xl font-mono font-bold animate-pulse"
        style={{ backgroundColor: '#22c55e20', border: '3px solid #22c55e', color: '#22c55e' }}
        aria-hidden="true"
      >
        {initial}
      </div>
      <div className="text-center">
        {peerLabel && <p className="heading-display text-xl text-[#f5f5f5]">{peerLabel}</p>}
        <p className="font-mono text-xs text-[#555555] mt-1">{peerPubkey.slice(0, 16)}…</p>
      </div>
      {/* Simulated audio waveform */}
      <div className="flex items-center gap-1 h-8" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="w-1.5 rounded-full bg-[#22c55e] opacity-60 animate-pulse"
            style={{
              height: `${Math.random() * 20 + 8}px`,
              animationDelay: `${i * 80}ms`,
              animationDuration: `${600 + i * 50}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function ActiveCallPanel({
  call,
  peerLabel,
  localStream,
  remoteStream,
  isMuted,
  isVideoOff,
  callDuration,
  onToggleMute,
  onToggleVideo,
  onEndCall,
}: ActiveCallPanelProps) {
  const isVideo = call.type === 'video';
  const npubShort = `${call.peerPubkey.slice(0, 8)}…${call.peerPubkey.slice(-4)}`;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-[#0a0a0a]"
      role="dialog"
      aria-modal="true"
      aria-label="Active call"
    >
      {/* Remote feed or audio display */}
      {isVideo && remoteStream ? (
        <VideoEl stream={remoteStream} className="flex-1 w-full" />
      ) : (
        <AudioOnlyDisplay peerLabel={peerLabel} peerPubkey={call.peerPubkey} />
      )}

      {/* Local video (PIP) */}
      {isVideo && localStream && !isVideoOff && (
        <div
          className="absolute top-4 right-4 w-24 h-32 rounded-xl overflow-hidden border-2 border-[#2a2a2a] shadow-2xl"
          aria-label="Your camera"
        >
          <VideoEl stream={localStream} muted className="w-full h-full" />
        </div>
      )}

      {/* Top bar: caller info + quality */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-4 bg-gradient-to-b from-black/80 to-transparent">
        <div>
          {peerLabel ? (
            <p className="heading-display text-lg text-[#f5f5f5]">{peerLabel}</p>
          ) : (
            <p className="font-mono text-sm text-[#a0a0a0]">{npubShort}</p>
          )}
          <p
            className="font-mono text-2xl font-bold text-[#ffd700] mt-0.5"
            aria-live="polite"
            aria-label={`Call duration: ${formatDuration(callDuration)}`}
          >
            {formatDuration(callDuration)}
          </p>
        </div>
        <QualityDot state={call.state} />
      </div>

      {/* Control bar */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-8 px-4 py-8 bg-gradient-to-t from-black/90 to-transparent pb-safe">
        <ControlBtn
          icon={Mic}
          iconOff={MicOff}
          label={isMuted ? 'Unmute' : 'Mute'}
          isOff={isMuted}
          onClick={onToggleMute}
        />
        {isVideo && (
          <ControlBtn
            icon={Video}
            iconOff={VideoOff}
            label={isVideoOff ? 'Camera on' : 'Camera off'}
            isOff={isVideoOff}
            onClick={onToggleVideo}
          />
        )}
        <ControlBtn
          icon={PhoneOff}
          label="End call"
          onClick={onEndCall}
          danger
        />
      </div>
    </div>
  );
}
