/**
 * Satnam v2 — Vault Context & Hook
 * Spec: SATNAM-V2-SPEC-001 § 2.3, § 9.3
 *
 * Provides application-wide access to the OPFS Vault state:
 *   - isUnlocked: whether the vault is currently open
 *   - unlock(passphrase): attempt to open the vault
 *   - lock(): seal the vault and clear key material from memory
 *
 * The vault itself (OPFS read/write, argon2id key derivation, WebAuthn)
 * is implemented in src/lib/vault/ (Phase 1, Week 2). This hook is the
 * React integration layer — it holds no crypto state of its own; all
 * sensitive material lives inside the vault module behind its API.
 *
 * AUTO-LOCK:
 *   The vault auto-locks after IDLE_TIMEOUT_MS of user inactivity.
 *   Activity is measured via pointer, keyboard, and touch events.
 *   The timer resets on each interaction.
 *
 * SECURITY NOTE:
 *   The `isUnlocked` boolean is the only vault state surfaced to the React
 *   tree. The actual vault session token (used to authorize OPFS reads) never
 *   leaves the vault module. Components cannot extract key material via context.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { getVault, VaultError } from '../lib/vault/index.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Auto-lock after 10 minutes of inactivity */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** User activity events that reset the idle timer */
const ACTIVITY_EVENTS: readonly string[] = [
  'pointerdown',
  'pointermove',
  'keydown',
  'touchstart',
  'wheel',
  'visibilitychange',
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VaultState {
  /** Whether the OPFS vault is currently unlocked and accessible */
  isUnlocked: boolean;

  /** Whether an unlock attempt is in progress */
  isUnlocking: boolean;

  /**
   * Attempt to unlock the vault with the provided passphrase.
   * Returns true if successful, false if the passphrase is incorrect.
   * Throws if the vault does not exist (first-run) or on unexpected error.
   *
   * In Phase 1 Week 2, this delegates to the vault module's open() function.
   * Until that module exists, it accepts any non-empty passphrase.
   */
  unlock: (passphrase: string) => Promise<boolean>;

  /**
   * Seal the vault: clear the in-memory vault session, stop the idle timer.
   * Any in-flight operations against the vault will fail after this call.
   */
  lock: () => void;

  /**
   * Error from the most recent unlock attempt, if any.
   * Cleared on the next unlock attempt.
   */
  unlockError: string | null;
}

// ── Context ───────────────────────────────────────────────────────────────────

const VaultContext = createContext<VaultState | null>(null);
VaultContext.displayName = 'VaultContext';

// ── Provider ──────────────────────────────────────────────────────────────────

interface VaultProviderProps {
  children: React.ReactNode;
  /**
   * Override the idle timeout for testing purposes.
   * Do not pass this in production code.
   */
  idleTimeoutMs?: number;
}

export function VaultProvider({
  children,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
}: VaultProviderProps) {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Idle timer reference — reset on activity, fires lock() when expired
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Idle timer management ───────────────────────────────────────────────────

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const resetIdleTimer = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      // Idle timeout expired — lock the vault and clear key material
      try {
        getVault().lock();
      } catch {
        // Vault may not be initialized
      }
      setIsUnlocked(false);
    }, idleTimeoutMs);
  }, [clearIdleTimer, idleTimeoutMs]);

  // ── Lock ────────────────────────────────────────────────────────────────────

  const lock = useCallback(() => {
    clearIdleTimer();
    try {
      getVault().lock();
    } catch {
      // Vault may not be initialized yet — locking the React state is sufficient.
    }
    setIsUnlocked(false);
    setUnlockError(null);
  }, [clearIdleTimer]);

  // ── Unlock ──────────────────────────────────────────────────────────────────

  const unlock = useCallback(
    async (passphrase: string): Promise<boolean> => {
      if (!passphrase || passphrase.trim().length === 0) {
        setUnlockError('Passphrase is required.');
        return false;
      }

      setIsUnlocking(true);
      setUnlockError(null);

      try {
        const vault = getVault();
        await vault.unlock('passphrase', passphrase);

        setIsUnlocked(true);
        resetIdleTimer();
        return true;
      } catch (err) {
        // DecryptionFailed means wrong passphrase — not an unexpected error
        if (err instanceof Error && err.message.includes(VaultError.DecryptionFailed)) {
          setUnlockError('Incorrect passphrase. Please try again.');
          return false;
        }
        const message =
          err instanceof Error ? err.message : 'An unexpected error occurred.';
        setUnlockError(message);
        return false;
      } finally {
        setIsUnlocking(false);
      }
    },
    [resetIdleTimer]
  );

  // ── Activity listeners (idle timer reset) ───────────────────────────────────

  useEffect(() => {
    if (!isUnlocked) return;

    const handleActivity = () => resetIdleTimer();

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, handleActivity, { passive: true })
    );

    // Start the timer when vault is first unlocked
    resetIdleTimer();

    return () => {
      ACTIVITY_EVENTS.forEach((event) =>
        window.removeEventListener(event, handleActivity)
      );
      clearIdleTimer();
    };
  }, [isUnlocked, resetIdleTimer, clearIdleTimer]);

  // ── Page visibility: lock when tab goes to background for > idle timeout ────

  useEffect(() => {
    if (!isUnlocked) return;

    let backgroundSince: number | null = null;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        backgroundSince = Date.now();
      } else if (document.visibilityState === 'visible' && backgroundSince !== null) {
        const elapsed = Date.now() - backgroundSince;
        if (elapsed >= idleTimeoutMs) {
          lock();
        }
        backgroundSince = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isUnlocked, idleTimeoutMs, lock]);

  // ── Cleanup on unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    return () => clearIdleTimer();
  }, [clearIdleTimer]);

  // ── Context value ───────────────────────────────────────────────────────────

  const value: VaultState = {
    isUnlocked,
    isUnlocking,
    unlock,
    lock,
    unlockError,
  };

  return (
    <VaultContext.Provider value={value}>
      {children}
    </VaultContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useVault — access vault state from any component inside VaultProvider.
 *
 * @example
 *   const { isUnlocked, unlock, lock } = useVault();
 *
 * @throws {Error} if called outside of <VaultProvider>
 */
export function useVault(): VaultState {
  const context = useContext(VaultContext);

  if (context === null) {
    throw new Error(
      'useVault must be called inside a <VaultProvider>. ' +
      'Ensure your component is wrapped by <VaultProvider> in App.tsx.'
    );
  }

  return context;
}
