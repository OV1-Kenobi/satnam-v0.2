/**
 * @hook useNfc
 * @description React hook for NFC operations — tap handling, PIN entry, Proof of Life.
 *
 * Provides:
 * - NFC tap state management (Web NFC + iOS Universal Link)
 * - PIN gate operations (setup, verify, lockout state)
 * - Proof of Life ceremony management
 * - Platform detection
 *
 * @example
 * ```tsx
 * const { tap, pinGate, pol, startPolCeremony } = useNfc({ vault, cardUid });
 * ```
 */

import React, {
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';

import { PinGate, createPinGate } from '../lib/nfc/pin-gate.js';
import { ProofOfLifeService } from '../lib/nfc/proof-of-life.js';
import {
  getNfcMethod,
  isIos,
  isWebNfcAvailable,
  type NfcUrlParams,
} from '../lib/nfc/ios-fallback.js';
import type { PolCeremony } from '../lib/nfc/proof-of-life.js';
import type { VaultOps } from '../lib/vault/types.js';
import type { NfcTapEvent } from '../components/nfc/NfcTapHandler.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseNfcOptions {
  /** Vault instance (required for PIN operations) */
  vault?: VaultOps;
  /** Card UID to scope PIN gate to (if known in advance) */
  cardUid?: string;
  /** Guardian pubkey for PoL ceremonies */
  guardianPubkey?: string;
  /** Called when a card is tapped */
  onTap?: (event: NfcTapEvent) => void;
}

interface PinGateState {
  isLocked: boolean;
  remainingAttempts: number;
  lockoutRemainingMs: number;
  state: ReturnType<PinGate['getState']>;
}

interface UseNfcReturn {
  // Platform info
  platform: 'android' | 'ios' | 'none';
  isWebNfcSupported: boolean;
  nfcMethod: 'web-nfc' | 'universal-link' | 'none';

  // Last tap event
  lastTap: NfcTapEvent | null;
  clearTap: () => void;

  // PIN gate
  pinGateState: PinGateState;
  setupPin: (cardUid: string, pin: string) => Promise<void>;
  verifyPin: (cardUid: string, pin: string) => Promise<boolean>;
  createOperationToken: (cardUid: string, operationPayload: Uint8Array, pin: string) => Promise<Uint8Array>;
  hasPinSetup: (cardUid: string) => Promise<boolean>;

  // Proof of Life
  polCeremony: PolCeremony | null;
  polService: ProofOfLifeService | null;
  startPolCeremony: (guardianPubkey: string) => Promise<PolCeremony | null>;
  processPolTap: (piccDataHex: string, cmacHex: string) => Promise<void>;
  processPolPin: (pin: string) => Promise<void>;
  signPolEvent: (signerNsec: string) => Promise<void>;
  publishPolEvent: (relayUrl: string) => Promise<void>;
  resetPol: () => void;

  // Loading states
  isPinLoading: boolean;
  isPolLoading: boolean;

  // Errors
  pinError: string | null;
  polError: string | null;
  clearErrors: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNfc(options: UseNfcOptions = {}): UseNfcReturn {
  const { vault, cardUid, guardianPubkey, onTap } = options;

  // ── Platform detection ─────────────────────────────────────────────────────
  const isWebNfcSupported = isWebNfcAvailable();
  const nfcMethod = getNfcMethod();
  const platform: 'android' | 'ios' | 'none' = isWebNfcSupported
    ? 'android'
    : isIos()
      ? 'ios'
      : 'none';

  // ── Tap state ──────────────────────────────────────────────────────────────
  const [lastTap, setLastTap] = useState<NfcTapEvent | null>(null);

  // ── PIN gate ───────────────────────────────────────────────────────────────
  const pinGateCache = useRef<Map<string, PinGate>>(new Map());
  const [isPinLoading, setIsPinLoading] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinGateState, setPinGateState] = useState<PinGateState>({
    isLocked: false,
    remainingAttempts: 5,
    lockoutRemainingMs: 0,
    state: 'idle',
  });

  // ── Proof of Life ──────────────────────────────────────────────────────────
  const [polCeremony, setPolCeremony] = useState<PolCeremony | null>(null);
  const [isPolLoading, setIsPolLoading] = useState(false);
  const [polError, setPolError] = useState<string | null>(null);
  const polServiceRef = useRef<ProofOfLifeService | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const _getPinGate = useCallback((uid: string): PinGate | null => {
    if (!vault) return null;

    if (!pinGateCache.current.has(uid)) {
      pinGateCache.current.set(uid, createPinGate(vault, uid));
    }
    return pinGateCache.current.get(uid)!;
  }, [vault]);

  const _updatePinGateState = useCallback((gate: PinGate) => {
    setPinGateState({
      isLocked: gate.isLockedOut(),
      remainingAttempts: gate.getRemainingAttempts(),
      lockoutRemainingMs: gate.getRemainingLockout(),
      state: gate.getState(),
    });
  }, []);

  const _getPolService = useCallback((): ProofOfLifeService | null => {
    if (!vault) return null;
    if (!polServiceRef.current) {
      const gate = _getPinGate(cardUid ?? 'default');
      if (!gate) return null;
      polServiceRef.current = new ProofOfLifeService(vault, gate);
    }
    return polServiceRef.current;
  }, [vault, cardUid]);

  // ── Public API ─────────────────────────────────────────────────────────────

  const clearTap = useCallback(() => setLastTap(null), []);

  const setupPin = useCallback(async (uid: string, pin: string) => {
    const gate = _getPinGate(uid);
    if (!gate) {
      setPinError('Vault not available');
      return;
    }
    setIsPinLoading(true);
    setPinError(null);
    try {
      await gate.setupPin(pin);
      _updatePinGateState(gate);
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'PIN setup failed');
    } finally {
      setIsPinLoading(false);
    }
  }, [_getPinGate, _updatePinGateState]);

  const verifyPin = useCallback(async (uid: string, pin: string): Promise<boolean> => {
    const gate = _getPinGate(uid);
    if (!gate) {
      setPinError('Vault not available');
      return false;
    }
    setIsPinLoading(true);
    setPinError(null);
    try {
      const result = await gate.verifyPin(pin);
      _updatePinGateState(gate);
      if (!result) {
        setPinError(gate.isLockedOut()
          ? `Locked out for ${Math.ceil(gate.getRemainingLockout() / 1000)}s`
          : `Incorrect PIN. ${gate.getRemainingAttempts()} attempt(s) remaining.`
        );
      }
      return result;
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'PIN verification failed');
      return false;
    } finally {
      setIsPinLoading(false);
    }
  }, [_getPinGate, _updatePinGateState]);

  const createOperationToken = useCallback(async (
    uid: string,
    operationPayload: Uint8Array,
    pin: string,
  ): Promise<Uint8Array> => {
    const gate = _getPinGate(uid);
    if (!gate) throw new Error('Vault not available');
    return gate.createOperationToken(operationPayload, pin);
  }, [_getPinGate]);

  const hasPinSetup = useCallback(async (uid: string): Promise<boolean> => {
    const gate = _getPinGate(uid);
    if (!gate) return false;
    return gate.hasPinSetup();
  }, [_getPinGate]);

  // ── Proof of Life methods ──────────────────────────────────────────────────

  const startPolCeremony = useCallback(async (
    gpubkey: string,
  ): Promise<PolCeremony | null> => {
    const svc = _getPolService();
    if (!svc) {
      setPolError('Service not available');
      return null;
    }
    setIsPolLoading(true);
    setPolError(null);
    try {
      const ceremony = await svc.initiate(gpubkey);
      setPolCeremony(ceremony);
      return ceremony;
    } catch (err) {
      setPolError(err instanceof Error ? err.message : 'Failed to start ceremony');
      return null;
    } finally {
      setIsPolLoading(false);
    }
  }, [_getPolService]);

  const processPolTap = useCallback(async (piccDataHex: string, cmacHex: string) => {
    const svc = _getPolService();
    if (!svc || !polCeremony) return;
    setIsPolLoading(true);
    try {
      const updated = await svc.processCardTap(polCeremony, piccDataHex, cmacHex);
      setPolCeremony(updated);
      if (updated.state === 'FAILED') setPolError(updated.error ?? null);
    } finally {
      setIsPolLoading(false);
    }
  }, [polCeremony, _getPolService]);

  const processPolPin = useCallback(async (pin: string) => {
    const svc = _getPolService();
    if (!svc || !polCeremony) return;
    setIsPolLoading(true);
    setPolError(null);
    try {
      const updated = await svc.processPin(polCeremony, pin);
      setPolCeremony(updated);
      if (updated.state === 'FAILED') setPolError(updated.error ?? null);
    } finally {
      setIsPolLoading(false);
    }
  }, [polCeremony, _getPolService]);

  const signPolEvent = useCallback(async (signerNsec: string) => {
    const svc = _getPolService();
    if (!svc || !polCeremony) return;
    setIsPolLoading(true);
    try {
      const updated = await svc.sign(polCeremony, signerNsec);
      setPolCeremony(updated);
      if (updated.state === 'FAILED') setPolError(updated.error ?? null);
    } finally {
      setIsPolLoading(false);
    }
  }, [polCeremony, _getPolService]);

  const publishPolEvent = useCallback(async (relayUrl: string) => {
    const svc = _getPolService();
    if (!svc || !polCeremony) return;
    setIsPolLoading(true);
    try {
      const updated = await svc.publish(polCeremony, relayUrl);
      setPolCeremony(updated);
      if (updated.state === 'FAILED') setPolError(updated.error ?? null);
    } finally {
      setIsPolLoading(false);
    }
  }, [polCeremony, _getPolService]);

  const resetPol = useCallback(() => {
    setPolCeremony(null);
    setPolError(null);
  }, []);

  const clearErrors = useCallback(() => {
    setPinError(null);
    setPolError(null);
  }, []);

  return {
    platform,
    isWebNfcSupported,
    nfcMethod,
    lastTap,
    clearTap,
    pinGateState,
    setupPin,
    verifyPin,
    createOperationToken,
    hasPinSetup,
    polCeremony,
    polService: polServiceRef.current,
    startPolCeremony,
    processPolTap,
    processPolPin,
    signPolEvent,
    publishPolEvent,
    resetPol,
    isPinLoading,
    isPolLoading,
    pinError,
    polError,
    clearErrors,
  };
}

export default useNfc;
