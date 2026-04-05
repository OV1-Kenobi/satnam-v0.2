/**
 * @component ProofOfLifeFlow
 * @description Multi-step mutual Proof of Life ceremony UI.
 *
 * Follows the corrected PoL state machine:
 * IDLE → INITIATED → SCANNING_PEER → PEER_VERIFIED → AWAITING_RECIPROCAL
 *      → MUTUAL_VERIFIED → PIN_EXCHANGE → ATTESTING → PUBLISHED → CONFIRMED
 *      → FAILED
 *
 * Two users scan EACH OTHER's NFC "Name Tag" cards to establish a bilateral
 * contact attestation. This proves physical co-presence and creates an
 * OTS-anchored Nostr event for each participant.
 *
 * Design: dark theme (bg-slate-950), btc-orange accents (#F7931A), Cinzel headings.
 * Optimized for mobile — full-screen modal, step-by-step progression.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type {
  PolCeremony,
  PolState,
  PeerScanResult,
} from '../../lib/nfc/proof-of-life.js';
import NfcTapHandler from './NfcTapHandler.js';
import PinEntry from './PinEntry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProofOfLifeFlowProps {
  /** Hex pubkey of the local user initiating the ceremony */
  localPubkey: string;
  /** nsec of the local signer (for constructing attestation events) */
  signerNsec?: string;
  /** NWC or Pylon relay URL for publishing */
  relayUrl?: string;
  /** Called when ceremony completes successfully */
  onComplete?: (ceremony: PolCeremony) => void;
  /** Called when ceremony is cancelled */
  onCancel?: () => void;
  /** Service methods — provided by useNfc hook or parent */
  service: {
    initiateCeremony: (localPubkey: string) => Promise<PolCeremony>;
    scanPeerCard: (
      ceremony: PolCeremony,
      piccDataHex: string,
      cmacHex: string,
    ) => Promise<PolCeremony>;
    awaitReciprocalScan: (ceremony: PolCeremony) => Promise<PolCeremony>;
    confirmReciprocalScan: (
      ceremony: PolCeremony,
      peerScanResult: PeerScanResult,
    ) => Promise<PolCeremony>;
    verifyLocalPin: (ceremony: PolCeremony, pin: string) => Promise<PolCeremony>;
    verifyPeerPin: (ceremony: PolCeremony) => Promise<PolCeremony>;
    constructAttestations: (
      ceremony: PolCeremony,
      localNsec: string,
    ) => Promise<PolCeremony>;
    publishAttestations: (
      ceremony: PolCeremony,
      relayUrl: string,
    ) => Promise<PolCeremony>;
  };
}

// ---------------------------------------------------------------------------
// Step visual config
// ---------------------------------------------------------------------------

const STATE_CONFIG: Record<
  PolState,
  { icon: string; label: string; color: string }
> = {
  IDLE:                { icon: '⏸',  label: 'Idle',                 color: 'text-[#555555]' },
  INITIATED:           { icon: '🔄',  label: 'Ready',                color: 'text-[#3B82F6]' },
  SCANNING_PEER:       { icon: '📡',  label: 'Scanning…',            color: 'text-[#FFD700]' },
  PEER_VERIFIED:       { icon: '✓',   label: 'Contact Found',        color: 'text-green-500' },
  AWAITING_RECIPROCAL: { icon: '⏳',  label: 'Waiting for Scan…',   color: 'text-[#FFD700]' },
  MUTUAL_VERIFIED:     { icon: '🤝',  label: 'Mutual Verified',      color: 'text-green-500' },
  PIN_EXCHANGE:        { icon: '🔐',  label: 'Authorizing…',         color: 'text-[#F7931A]' },
  ATTESTING:           { icon: '✍',   label: 'Building Trust…',      color: 'text-[#F7931A]' },
  PUBLISHED:           { icon: '📡',  label: 'Publishing…',          color: 'text-[#F7931A]' },
  CONFIRMED:           { icon: '✅',  label: 'Contact Added',        color: 'text-green-500' },
  FAILED:              { icon: '✗',   label: 'Failed',               color: 'text-red-400' },
};

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

const STATE_ORDER: PolState[] = [
  'INITIATED',
  'SCANNING_PEER',
  'PEER_VERIFIED',
  'AWAITING_RECIPROCAL',
  'MUTUAL_VERIFIED',
  'PIN_EXCHANGE',
  'ATTESTING',
  'PUBLISHED',
  'CONFIRMED',
];

function ProgressBar({ state }: { state: PolState }) {
  const idx = STATE_ORDER.indexOf(state);
  const progress = idx < 0 ? 0 : ((idx + 1) / STATE_ORDER.length) * 100;

  return (
    <div
      className="w-full bg-[#1e293b] rounded-full h-1.5 overflow-hidden"
      role="progressbar"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full bg-[#F7931A] rounded-full transition-all duration-500"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

function Spinner({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const cls =
    size === 'sm'
      ? 'w-4 h-4 border-2 border-black/30 border-t-black'
      : 'w-8 h-8 border-2 border-[#1e293b] border-t-[#F7931A]';
  return <span className={`rounded-full ${cls} animate-spin inline-block`} />;
}

// ---------------------------------------------------------------------------
// Truncate npub / pubkey
// ---------------------------------------------------------------------------

function truncatePubkey(pubkey: string): string {
  if (!pubkey) return '—';
  if (pubkey.startsWith('npub1')) {
    return `${pubkey.slice(0, 12)}…${pubkey.slice(-6)}`;
  }
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// Step 1 — Scan peer's Name Tag
// ---------------------------------------------------------------------------

function StepScanPeer({
  onTap,
  isLoading,
}: {
  onTap: (piccDataHex: string, cmacHex: string) => void;
  isLoading: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <p className="text-[#f5f5f5] font-medium">
          Scan Your Contact's Name Tag
        </p>
        <p className="text-[#7c8fa6] text-sm">
          Hold your phone near your contact's NFC card to read it.
        </p>
      </div>

      <div className="flex justify-center">
        <div className="w-28 h-28 rounded-2xl bg-[#0f172a] border-2 border-dashed border-[#F7931A]/50 flex items-center justify-center">
          {isLoading ? (
            <Spinner size="md" />
          ) : (
            <span className="text-5xl select-none" aria-hidden="true">📇</span>
          )}
        </div>
      </div>

      <NfcTapHandler
        onTap={(event) => onTap(event.piccDataHex, event.cmacHex)}
        active={!isLoading}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Verifying peer card (SCANNING_PEER)
// ---------------------------------------------------------------------------

function StepVerifying() {
  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-full bg-[#F7931A]/10 border border-[#F7931A]/20 flex items-center justify-center">
          <Spinner size="md" />
        </div>
      </div>
      <div>
        <p className="text-[#f5f5f5] font-medium">Verifying…</p>
        <p className="text-[#7c8fa6] text-sm mt-1">
          Checking card authentication code
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Peer verified, now ask peer to scan our card
// ---------------------------------------------------------------------------

function StepPeerVerified({
  ceremony,
  onContinue,
  isLoading,
}: {
  ceremony: PolCeremony;
  onContinue: () => void;
  isLoading: boolean;
}) {
  const displayPubkey = ceremony.peerPubkey
    ? truncatePubkey(ceremony.peerPubkey)
    : `Card ${ceremony.peerCardUid.slice(0, 8)}…`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
        <span className="text-green-500 text-xl" aria-hidden="true">✓</span>
        <div>
          <p className="text-sm text-green-400 font-medium">Contact Verified</p>
          <p className="text-xs text-[#7c8fa6] font-mono mt-0.5">{displayPubkey}</p>
        </div>
      </div>

      <div className="p-4 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-2 text-center">
        <p className="text-[#F7931A] text-sm font-medium">Your turn to be scanned</p>
        <p className="text-[#7c8fa6] text-sm">
          Hand your device to your contact (or show them your card) so they can
          scan <span className="text-[#f5f5f5] font-medium">your</span> Name Tag.
        </p>
      </div>

      <button
        onClick={onContinue}
        disabled={isLoading}
        className="w-full py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] disabled:opacity-40 transition-colors"
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <Spinner /> Waiting…
          </span>
        ) : (
          'Contact Has Scanned My Card'
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Awaiting reciprocal scan
// ---------------------------------------------------------------------------

function StepAwaitingReciprocal({
  timeoutSec,
  onConfirm,
}: {
  timeoutSec: number;
  onConfirm: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((e) => {
        if (e + 1 >= timeoutSec) clearInterval(interval);
        return e + 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timeoutSec]);

  const remaining = Math.max(0, timeoutSec - elapsed);

  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="relative w-20 h-20">
          <div className="absolute inset-0 rounded-full border-2 border-[#1e293b]" />
          <div
            className="absolute inset-0 rounded-full border-2 border-[#F7931A] transition-all"
            style={{
              clipPath: `inset(0 ${100 - (remaining / timeoutSec) * 100}% 0 0)`,
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[#F7931A] font-mono font-bold text-lg">{remaining}</span>
          </div>
        </div>
      </div>

      <div>
        <p className="text-[#f5f5f5] font-medium">Waiting for reciprocal scan…</p>
        <p className="text-[#7c8fa6] text-sm mt-1">
          Your contact needs to scan your Name Tag
        </p>
      </div>

      <button
        onClick={onConfirm}
        className="w-full py-3 rounded-lg font-medium border border-[#F7931A] text-[#F7931A] hover:bg-[#F7931A]/10 transition-colors"
      >
        They've Scanned Me — Continue
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — Enter your PIN (PIN_EXCHANGE)
// ---------------------------------------------------------------------------

function StepPinExchange({
  onPinSubmit,
  isLoading,
  pinError,
  peerPinVerified,
}: {
  onPinSubmit: (pin: string) => void;
  isLoading: boolean;
  pinError?: string;
  peerPinVerified: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] text-sm space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[#7c8fa6]">Your PIN</span>
          <span className="text-yellow-400 text-xs">Required</span>
        </div>
        {peerPinVerified && (
          <div className="flex items-center gap-2 text-green-400 text-xs">
            <span>✓</span>
            <span>Contact has authorized</span>
          </div>
        )}
      </div>

      <PinEntry
        title="Enter Your PIN"
        description="Authorize the Proof of Life ceremony"
        mode="verify"
        onSubmit={onPinSubmit}
        isLoading={isLoading}
        error={pinError}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 6 — Attesting / Publishing
// ---------------------------------------------------------------------------

function StepAttesting({ state }: { state: PolState }) {
  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-full bg-[#F7931A]/10 border border-[#F7931A]/30 flex items-center justify-center">
          <Spinner size="md" />
        </div>
      </div>
      <div>
        <p className="text-[#f5f5f5] font-medium">
          {state === 'PUBLISHED' ? 'Publishing to Relay…' : 'Establishing Trust…'}
        </p>
        <p className="text-[#7c8fa6] text-sm mt-1">
          {state === 'PUBLISHED'
            ? 'Sending attestation to Nostr relay'
            : 'Constructing bilateral attestation events'}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 7 — Confirmed
// ---------------------------------------------------------------------------

function StepConfirmed({
  ceremony,
  onDone,
}: {
  ceremony: PolCeremony;
  onDone: () => void;
}) {
  const displayPubkey = ceremony.peerPubkey
    ? truncatePubkey(ceremony.peerPubkey)
    : `Card ${ceremony.peerCardUid.slice(0, 8)}…`;

  return (
    <div
      className="flex flex-col items-center gap-6 py-4"
      role="status"
      aria-live="polite"
    >
      <div className="w-24 h-24 rounded-full bg-green-500/10 border-2 border-green-500 flex items-center justify-center text-5xl">
        ✅
      </div>

      <div className="text-center">
        <h3 className="font-display text-xl text-green-500 mb-1">
          Contact Added
        </h3>
        <p className="text-sm text-[#7c8fa6]">
          Mutual Proof of Life established
        </p>
      </div>

      <div className="w-full p-4 rounded-lg bg-[#0f172a] border border-[#1e293b] space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-[#7c8fa6]">Contact</span>
          <span className="font-mono text-[#f5f5f5] text-xs">{displayPubkey}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#7c8fa6]">Card Hash</span>
          <span className="font-mono text-xs text-[#7c8fa6]">
            {ceremony.peerCardUidHash.slice(0, 16)}…
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#7c8fa6]">Time</span>
          <span className="text-[#7c8fa6]">
            {new Date(ceremony.timestamp * 1000).toLocaleTimeString()}
          </span>
        </div>
        {ceremony.relayUrl && (
          <div className="flex justify-between">
            <span className="text-[#7c8fa6]">Relay</span>
            <span className="font-mono text-xs text-[#F7931A]">
              {ceremony.relayUrl.replace('wss://', '')}
            </span>
          </div>
        )}
      </div>

      <div className="w-full p-3 rounded-lg bg-[#0f172a] border border-[#1e293b] text-xs text-[#7c8fa6] text-center">
        Future DMs and Zaps to this contact require your NFC card + PIN
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
// Error step
// ---------------------------------------------------------------------------

function StepFailed({
  ceremony,
  onRetry,
}: {
  ceremony: PolCeremony;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4">
      <div
        className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-center"
        role="alert"
      >
        <p className="text-red-400 font-semibold mb-1">Ceremony Failed</p>
        {ceremony.error && (
          <p className="text-sm text-[#7c8fa6]">{ceremony.error}</p>
        )}
      </div>
      <button
        onClick={onRetry}
        className="w-full py-3 rounded-lg font-medium bg-[#F7931A] text-black hover:bg-[#c46e00] transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ProofOfLifeFlow({
  localPubkey,
  signerNsec: initialNsec = '',
  relayUrl: initialRelay = 'wss://relay.satnam.pub',
  onComplete,
  onCancel,
  service,
}: ProofOfLifeFlowProps) {
  const [ceremony, setCeremony] = useState<PolCeremony | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pinError, setPinError] = useState<string | undefined>();
  const [relayUrl] = useState(initialRelay);

  // Ref to track whether we've already auto-advanced after attestation build
  const attestationBuilt = useRef(false);

  // ── Initiate ceremony on mount ─────────────────────────────────────────
  useEffect(() => {
    service.initiateCeremony(localPubkey).then(setCeremony);
  }, [localPubkey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-advance: when ATTESTING + events built, publish automatically ─
  useEffect(() => {
    if (
      !ceremony ||
      ceremony.state !== 'ATTESTING' ||
      !ceremony.attestationEvents ||
      attestationBuilt.current
    )
      return;
    attestationBuilt.current = true;
    setIsLoading(true);
    service
      .publishAttestations(ceremony, relayUrl)
      .then((updated) => {
        setCeremony(updated);
        if (updated.state === 'CONFIRMED') onComplete?.(updated);
      })
      .finally(() => setIsLoading(false));
  }, [ceremony, relayUrl, service, onComplete]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handlePeerCardTap = useCallback(
    async (piccDataHex: string, cmacHex: string) => {
      if (!ceremony) return;
      setIsLoading(true);
      const updated = await service.scanPeerCard(ceremony, piccDataHex, cmacHex);
      setCeremony(updated);
      setIsLoading(false);
    },
    [ceremony, service],
  );

  const handleAwaitReciprocal = useCallback(async () => {
    if (!ceremony) return;
    setIsLoading(true);
    const updated = await service.awaitReciprocalScan(ceremony);
    setCeremony(updated);
    setIsLoading(false);
  }, [ceremony, service]);

  // Called when user taps "They've Scanned Me — Continue" or timer fires
  const handleReciprocalConfirmed = useCallback(async () => {
    if (!ceremony) return;
    // Simulate: local card uid = same as local pubkey-hash for now.
    // In production this comes from the peer device's broadcast.
    const localCardUid = localPubkey.slice(0, 14);
    const peerScanResult: PeerScanResult = {
      peerCardUid: localCardUid,
      peerCardUidHash: '', // will be filled from ceremony state
      cmacCounter: ceremony.cmacCounter,
    };
    setIsLoading(true);
    const updated = await service.confirmReciprocalScan(ceremony, peerScanResult);
    setCeremony(updated);
    setIsLoading(false);
  }, [ceremony, service, localPubkey]);

  const handlePin = useCallback(
    async (pin: string) => {
      if (!ceremony) return;
      setIsLoading(true);
      setPinError(undefined);
      const afterPin = await service.verifyLocalPin(ceremony, pin);
      if (afterPin.state === 'FAILED') {
        setPinError(afterPin.error);
        setCeremony(afterPin);
        setIsLoading(false);
        return;
      }
      // Also acknowledge peer PIN verification (in co-present scenario they
      // confirm verbally, or via a Nostr ephemeral message)
      const afterPeerPin = await service.verifyPeerPin(afterPin);
      if (afterPeerPin.state === 'ATTESTING' && initialNsec) {
        // Immediately construct attestations
        const withAttestations = await service.constructAttestations(
          afterPeerPin,
          initialNsec,
        );
        setCeremony(withAttestations);
      } else {
        setCeremony(afterPeerPin);
      }
      setIsLoading(false);
    },
    [ceremony, service, initialNsec],
  );

  const handleRetry = useCallback(() => {
    attestationBuilt.current = false;
    setPinError(undefined);
    service.initiateCeremony(localPubkey).then(setCeremony);
  }, [localPubkey, service]);

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (!ceremony) {
    return (
      <div className="flex items-center justify-center py-16" role="status">
        <Spinner size="md" />
      </div>
    );
  }

  const cfg = STATE_CONFIG[ceremony.state];

  return (
    <div
      className="card space-y-6 max-w-sm mx-auto"
      role="region"
      aria-label="Proof of Life ceremony"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg text-[#F7931A] tracking-wider uppercase">
          Proof of Life
        </h3>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-[#555555] hover:text-[#a0a0a0] text-xl leading-none"
            aria-label="Cancel ceremony"
          >
            ×
          </button>
        )}
      </div>

      {/* Progress */}
      <ProgressBar state={ceremony.state} />

      {/* State badge */}
      <div className="flex items-center justify-center gap-2">
        <span className={`text-xl ${cfg.color}`} aria-hidden="true">
          {cfg.icon}
        </span>
        <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
      </div>

      {/* ── Step content ── */}

      {/* Step 1: Scan peer's card */}
      {ceremony.state === 'INITIATED' && (
        <StepScanPeer onTap={handlePeerCardTap} isLoading={isLoading} />
      )}

      {/* Step 2: Verifying */}
      {ceremony.state === 'SCANNING_PEER' && <StepVerifying />}

      {/* Step 3: Peer verified — instruct peer to scan our card */}
      {ceremony.state === 'PEER_VERIFIED' && (
        <StepPeerVerified
          ceremony={ceremony}
          onContinue={handleAwaitReciprocal}
          isLoading={isLoading}
        />
      )}

      {/* Step 4: Waiting for reciprocal scan */}
      {ceremony.state === 'AWAITING_RECIPROCAL' && (
        <StepAwaitingReciprocal
          timeoutSec={60}
          onConfirm={handleReciprocalConfirmed}
        />
      )}

      {/* Step 5: PIN entry (MUTUAL_VERIFIED or PIN_EXCHANGE) */}
      {(ceremony.state === 'MUTUAL_VERIFIED' ||
        ceremony.state === 'PIN_EXCHANGE') && (
        <StepPinExchange
          onPinSubmit={handlePin}
          isLoading={isLoading}
          pinError={pinError}
          peerPinVerified={ceremony.peerPinVerified}
        />
      )}

      {/* Step 6: Attesting / Publishing */}
      {(ceremony.state === 'ATTESTING' || ceremony.state === 'PUBLISHED') && (
        <StepAttesting state={ceremony.state} />
      )}

      {/* Step 7: Confirmed */}
      {ceremony.state === 'CONFIRMED' && (
        <StepConfirmed
          ceremony={ceremony}
          onDone={() => onComplete?.(ceremony)}
        />
      )}

      {/* Error */}
      {ceremony.state === 'FAILED' && (
        <StepFailed ceremony={ceremony} onRetry={handleRetry} />
      )}
    </div>
  );
}
