/**
 * @component ProofOfLifeFlow
 * @description Multi-step Proof of Life ceremony UI.
 *
 * Follows the PoL state machine:
 * IDLE → INITIATED → CARD_TAPPED → PIN_VERIFIED → SIGNED → PUBLISHED → CONFIRMED
 *
 * Designed for mobile. Full-screen modal with step-by-step progression.
 */

import React, { useState, useCallback } from 'react';
import type { PolCeremony, PolState } from '../../lib/nfc/proof-of-life.js';
import NfcTapHandler from './NfcTapHandler.js';
import PinEntry from './PinEntry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProofOfLifeFlowProps {
  /** Hex pubkey of the Guardian initiating the ceremony */
  guardianPubkey: string;
  /** nsec of the signer (for signing the PoL event) */
  signerNsec?: string;
  /** NWC or Pylon relay URL for publishing */
  relayUrl?: string;
  /** Called when ceremony completes successfully */
  onComplete?: (ceremony: PolCeremony) => void;
  /** Called when ceremony is cancelled */
  onCancel?: () => void;
  /** Service methods — provided by useNfc hook or parent */
  service: {
    initiate: (guardianPubkey: string) => Promise<PolCeremony>;
    processCardTap: (ceremony: PolCeremony, piccDataHex: string, cmacHex: string) => Promise<PolCeremony>;
    processPin: (ceremony: PolCeremony, pin: string) => Promise<PolCeremony>;
    sign: (ceremony: PolCeremony, signerNsec: string) => Promise<PolCeremony>;
    publish: (ceremony: PolCeremony, relayUrl: string) => Promise<PolCeremony>;
  };
}

// ---------------------------------------------------------------------------
// Step visual config
// ---------------------------------------------------------------------------

const STATE_CONFIG: Record<PolState, { icon: string; label: string; color: string }> = {
  IDLE:         { icon: '⏸', label: 'Idle',          color: 'text-[#555555]' },
  INITIATED:    { icon: '🔄', label: 'Initiated',     color: 'text-[#3B82F6]' },
  CARD_TAPPED:  { icon: '📳', label: 'Card Tapped',   color: 'text-[#FFD700]' },
  PIN_VERIFIED: { icon: '✓',  label: 'PIN Verified',  color: 'text-green-500' },
  SIGNED:       { icon: '✍',  label: 'Signed',        color: 'text-[#F7931A]' },
  PUBLISHED:    { icon: '📡', label: 'Publishing…',   color: 'text-[#F7931A]' },
  CONFIRMED:    { icon: '✅', label: 'Confirmed',     color: 'text-green-500' },
  FAILED:       { icon: '✗',  label: 'Failed',        color: 'text-red-400' },
};

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

const STATE_ORDER: PolState[] = [
  'INITIATED', 'CARD_TAPPED', 'PIN_VERIFIED', 'SIGNED', 'PUBLISHED', 'CONFIRMED',
];

function ProgressBar({ state }: { state: PolState }) {
  const idx = STATE_ORDER.indexOf(state);
  const progress = idx < 0 ? 0 : ((idx + 1) / STATE_ORDER.length) * 100;

  return (
    <div className="w-full bg-[#2a2a2a] rounded-full h-1.5 overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="h-full bg-[#F7931A] rounded-full transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual step renderers
// ---------------------------------------------------------------------------

function StepInitiated({
  onTap,
}: {
  onTap: (piccDataHex: string, cmacHex: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-[#a0a0a0] text-sm">
          Tap your NFC card to prove physical presence.
        </p>
      </div>
      <NfcTapHandler
        onTap={event => onTap(event.piccDataHex, event.cmacHex)}
        active
      />
    </div>
  );
}

function StepCardTapped({
  ceremony,
  onPinSubmit,
  isLoading,
  pinError,
}: {
  ceremony: PolCeremony;
  onPinSubmit: (pin: string) => void;
  isLoading: boolean;
  pinError?: string;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
        <span className="text-green-500">✓</span>
        <p className="text-sm text-green-400">Card verified — UID #{ceremony.cardUid.slice(0, 8)}…</p>
      </div>

      <PinEntry
        title="Confirm Identity"
        description="Enter your PIN to authorize the Proof of Life"
        mode="verify"
        onSubmit={onPinSubmit}
        isLoading={isLoading}
        error={pinError}
      />
    </div>
  );
}

function StepPinVerified({
  ceremony,
  signerNsec,
  onNsecChange,
  onSign,
  isLoading,
}: {
  ceremony: PolCeremony;
  signerNsec: string;
  onNsecChange: (v: string) => void;
  onSign: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="p-4 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] space-y-3">
        <p className="text-xs text-[#555555] uppercase tracking-wider">Ceremony Details</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[#555555]">Card</span>
            <span className="font-mono text-[#a0a0a0]">{ceremony.cardUid.slice(0, 12)}…</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#555555]">Counter</span>
            <span className="font-mono text-[#a0a0a0]">{ceremony.cmacCounter}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#555555]">Time</span>
            <span className="text-[#a0a0a0]">
              {new Date(ceremony.timestamp * 1000).toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>

      {!signerNsec && (
        <div>
          <label htmlFor="pol-nsec" className="block text-sm font-medium text-[#a0a0a0] mb-2">
            Signing Key (nsec) <span className="text-[#F7931A]">*</span>
          </label>
          <input
            id="pol-nsec"
            type="password"
            value={signerNsec}
            onChange={e => onNsecChange(e.target.value)}
            placeholder="nsec1…"
            className="
              w-full px-4 py-3 rounded-lg
              bg-[#1a1a1a] border border-[#2a2a2a]
              text-[#f5f5f5] placeholder-[#555555] font-mono text-sm
              focus:outline-none focus:border-[#F7931A]
              transition-colors
            "
            autoComplete="off"
          />
        </div>
      )}

      <button
        onClick={onSign}
        disabled={isLoading}
        className="w-full py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] disabled:opacity-40 transition-colors"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 rounded-full border-2 border-black/30 border-t-black animate-spin" />
            Signing…
          </span>
        ) : 'Sign Proof of Life'}
      </button>
    </div>
  );
}

function StepSigned({
  relayUrl,
  onRelayChange,
  onPublish,
  isLoading,
}: {
  relayUrl: string;
  onRelayChange: (v: string) => void;
  onPublish: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 p-3 rounded-lg bg-[#F7931A]/10 border border-[#F7931A]/20">
        <span className="text-[#F7931A]">✍</span>
        <p className="text-sm text-[#F7931A]">Event signed — ready to publish</p>
      </div>

      <div>
        <label htmlFor="pol-relay" className="block text-sm font-medium text-[#a0a0a0] mb-2">
          Relay URL
        </label>
        <input
          id="pol-relay"
          type="url"
          value={relayUrl}
          onChange={e => onRelayChange(e.target.value)}
          placeholder="wss://relay.satnam.pub"
          className="
            w-full px-4 py-3 rounded-lg
            bg-[#1a1a1a] border border-[#2a2a2a]
            text-[#f5f5f5] placeholder-[#555555] font-mono text-sm
            focus:outline-none focus:border-[#F7931A]
            transition-colors
          "
        />
      </div>

      <button
        onClick={onPublish}
        disabled={isLoading || !relayUrl}
        className="w-full py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] disabled:opacity-40 transition-colors"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 rounded-full border-2 border-black/30 border-t-black animate-spin" />
            Publishing…
          </span>
        ) : 'Publish to Relay ⚡'}
      </button>
    </div>
  );
}

function StepConfirmed({ ceremony, onDone }: { ceremony: PolCeremony; onDone: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 py-4" role="status" aria-live="polite">
      <div className="w-20 h-20 rounded-full bg-green-500/10 border-2 border-green-500 flex items-center justify-center text-4xl">
        ✅
      </div>
      <div className="text-center">
        <h3 className="font-display text-xl text-green-500 mb-2">Proof of Life Confirmed</h3>
        <p className="text-sm text-[#555555]">
          Published to relay at {new Date(ceremony.timestamp * 1000).toLocaleString()}
        </p>
      </div>
      <div className="w-full p-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-[#555555]">Card Hash</span>
          <span className="font-mono text-xs text-[#a0a0a0]">{ceremony.cardUidHash.slice(0, 16)}…</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#555555]">Counter</span>
          <span className="font-mono text-[#a0a0a0]">{ceremony.cmacCounter}</span>
        </div>
      </div>
      <button
        onClick={onDone}
        className="w-full py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] transition-colors"
      >
        Done
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ProofOfLifeFlow({
  guardianPubkey,
  signerNsec: initialNsec = '',
  relayUrl: initialRelay = 'wss://relay.satnam.pub',
  onComplete,
  onCancel,
  service,
}: ProofOfLifeFlowProps) {
  const [ceremony, setCeremony] = useState<PolCeremony | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [signerNsec, setSignerNsec] = useState(initialNsec);
  const [relayUrl, setRelayUrl] = useState(initialRelay);
  const [pinError, setPinError] = useState<string | undefined>();

  // ── Initiate ceremony on mount ────────────────────────────────────────────
  React.useEffect(() => {
    service.initiate(guardianPubkey).then(setCeremony);
  }, [guardianPubkey]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCardTap = useCallback(async (piccDataHex: string, cmacHex: string) => {
    if (!ceremony) return;
    setIsLoading(true);
    const updated = await service.processCardTap(ceremony, piccDataHex, cmacHex);
    setCeremony(updated);
    setIsLoading(false);
  }, [ceremony, service]);

  const handlePin = useCallback(async (pin: string) => {
    if (!ceremony) return;
    setIsLoading(true);
    setPinError(undefined);
    const updated = await service.processPin(ceremony, pin);
    setCeremony(updated);
    if (updated.state === 'FAILED') {
      setPinError(updated.error);
    }
    setIsLoading(false);
  }, [ceremony, service]);

  const handleSign = useCallback(async () => {
    if (!ceremony) return;
    setIsLoading(true);
    const nsec = signerNsec || initialNsec;
    const updated = await service.sign(ceremony, nsec);
    setCeremony(updated);
    setIsLoading(false);
  }, [ceremony, signerNsec, initialNsec, service]);

  const handlePublish = useCallback(async () => {
    if (!ceremony) return;
    setIsLoading(true);
    const updated = await service.publish(ceremony, relayUrl);
    setCeremony(updated);
    if (updated.state === 'CONFIRMED') {
      onComplete?.(updated);
    }
    setIsLoading(false);
  }, [ceremony, relayUrl, service, onComplete]);

  if (!ceremony) {
    return (
      <div className="flex items-center justify-center py-16" role="status">
        <div className="h-8 w-8 rounded-full border-2 border-[#2a2a2a] border-t-[#F7931A] animate-spin" />
      </div>
    );
  }

  const cfg = STATE_CONFIG[ceremony.state];

  return (
    <div className="card space-y-6 max-w-sm mx-auto" role="region" aria-label="Proof of Life ceremony">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg text-[#F7931A] tracking-wider uppercase">
          Proof of Life
        </h3>
        {onCancel && (
          <button onClick={onCancel} className="text-[#555555] hover:text-[#a0a0a0] text-xl" aria-label="Cancel ceremony">×</button>
        )}
      </div>

      {/* Progress */}
      <ProgressBar state={ceremony.state} />

      {/* Current state badge */}
      <div className="flex items-center justify-center gap-2">
        <span className={`text-xl ${cfg.color}`} aria-hidden="true">{cfg.icon}</span>
        <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
      </div>

      {/* Step content */}
      {ceremony.state === 'INITIATED' && (
        <StepInitiated onTap={handleCardTap} />
      )}

      {ceremony.state === 'CARD_TAPPED' && (
        <StepCardTapped
          ceremony={ceremony}
          onPinSubmit={handlePin}
          isLoading={isLoading}
          pinError={pinError}
        />
      )}

      {ceremony.state === 'PIN_VERIFIED' && (
        <StepPinVerified
          ceremony={ceremony}
          signerNsec={signerNsec}
          onNsecChange={setSignerNsec}
          onSign={handleSign}
          isLoading={isLoading}
        />
      )}

      {(ceremony.state === 'SIGNED' || ceremony.state === 'PUBLISHED') && (
        <StepSigned
          relayUrl={relayUrl}
          onRelayChange={setRelayUrl}
          onPublish={handlePublish}
          isLoading={isLoading || ceremony.state === 'PUBLISHED'}
        />
      )}

      {ceremony.state === 'CONFIRMED' && (
        <StepConfirmed ceremony={ceremony} onDone={() => onComplete?.(ceremony)} />
      )}

      {ceremony.state === 'FAILED' && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-center" role="alert">
            <p className="text-red-400 font-semibold mb-1">Ceremony Failed</p>
            {ceremony.error && <p className="text-sm text-[#555555]">{ceremony.error}</p>}
          </div>
          <button
            onClick={() => service.initiate(guardianPubkey).then(setCeremony)}
            className="w-full py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] transition-colors"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
