/**
 * @module hooks/usePylon
 * @description React hook for managing the Pylon relay NIP-42 AUTH connection.
 *
 * Provides application-wide access to Pylon connection state:
 * - `isConnected` — whether the WebSocket is open
 * - `isAuthenticated` — whether NIP-42 AUTH has been completed
 * - `connectionState` — detailed state machine value
 * - `connect(nsec?)` — initiate connection and AUTH
 * - `disconnect()` — close the connection
 * - `error` — last connection error, if any
 *
 * ## Usage
 *
 * ```tsx
 * const { isAuthenticated, connect, disconnect, error } = usePylon();
 *
 * // Connect with explicit nsec (typically retrieved from Vault)
 * await connect(signerNsec);
 *
 * // Or connect using Vault-managed nsec (default)
 * await connect();
 * ```
 *
 * ## Context
 *
 * Wrap your app in `<PylonProvider>` to share a single connection:
 *
 * ```tsx
 * <PylonProvider pylonAuth={pylonAuth}>
 *   <App />
 * </PylonProvider>
 * ```
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { PylonAuth } from '../lib/pylon/auth.js';
import { PYLON_RELAY_URL } from '../lib/pylon/auth.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Detailed Pylon connection state. */
export type PylonConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'authenticated'
  | 'error';

/** Public state and actions exposed by usePylon(). */
export interface PylonState {
  /** Whether the WebSocket connection to Pylon is open. */
  isConnected: boolean;

  /** Whether NIP-42 AUTH has been successfully completed. */
  isAuthenticated: boolean;

  /** Detailed connection state for UI rendering. */
  connectionState: PylonConnectionState;

  /** Whether a connection attempt is in progress. */
  isConnecting: boolean;

  /** Last connection error message, if any. Cleared on the next connect(). */
  error: string | null;

  /**
   * Initiate connection and NIP-42 AUTH.
   *
   * @param signerNsec - Optional nsec override; if omitted, the PylonAuth
   *   instance reads the nsec from the OPFS Vault.
   * @param relayUrl - Relay URL to connect to (defaults to Pylon)
   * @returns true if authentication succeeded, false otherwise
   */
  connect: (signerNsec?: string, relayUrl?: string) => Promise<boolean>;

  /**
   * Disconnect from Pylon and clear connection state.
   */
  disconnect: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface PylonContextValue {
  state: PylonState;
  pylonAuth: PylonAuth;
}

const PylonContext = createContext<PylonContextValue | null>(null);
PylonContext.displayName = 'PylonContext';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface PylonProviderProps {
  /** PylonAuth instance (constructed once at app root level). */
  pylonAuth: PylonAuth;
  children: React.ReactNode;
}

/**
 * PylonProvider — wrap your app root to share a single Pylon connection.
 *
 * @example
 * ```tsx
 * const auth = new PylonAuth(vault);
 * <PylonProvider pylonAuth={auth}>
 *   <App />
 * </PylonProvider>
 * ```
 */
export function PylonProvider({ pylonAuth, children }: PylonProviderProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [connectionState, setConnectionState] = useState<PylonConnectionState>('disconnected');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref to avoid stale closure in cleanup effect
  const authRef = useRef(pylonAuth);
  authRef.current = pylonAuth;

  // ── Connect ────────────────────────────────────────────────────────────────

  const connect = useCallback(
    async (signerNsec?: string, relayUrl: string = PYLON_RELAY_URL): Promise<boolean> => {
      if (isConnecting) return false;

      setIsConnecting(true);
      setConnectionState('connecting');
      setError(null);

      try {
        await authRef.current.connect(relayUrl, signerNsec);
        setIsConnected(true);
        setIsAuthenticated(true);
        setConnectionState('authenticated');
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setIsConnected(false);
        setIsAuthenticated(false);
        setConnectionState('error');
        return false;
      } finally {
        setIsConnecting(false);
      }
    },
    [isConnecting]
  );

  // ── Disconnect ─────────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    authRef.current.disconnect();
    setIsConnected(false);
    setIsAuthenticated(false);
    setConnectionState('disconnected');
    setError(null);
  }, []);

  // ── Sync state with underlying PylonAuth ───────────────────────────────────

  // Poll the auth state periodically to reflect external changes
  // (e.g., relay-initiated disconnects)
  useEffect(() => {
    const syncState = () => {
      const auth = authRef.current;
      const authenticated = auth.isAuthenticated();
      const ws = auth.getWebSocket();
      const wsOpen = ws !== null && ws.readyState === WebSocket.OPEN;

      setIsConnected(wsOpen);
      setIsAuthenticated(authenticated);

      if (authenticated) {
        setConnectionState('authenticated');
      } else if (wsOpen) {
        setConnectionState('connected');
      }
    };

    const interval = setInterval(syncState, 2_000);
    return () => clearInterval(interval);
  }, []);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      // Do not disconnect on unmount — the connection should persist across
      // component tree changes. The caller must explicitly disconnect().
    };
  }, []);

  // ── Context value ──────────────────────────────────────────────────────────

  const state: PylonState = {
    isConnected,
    isAuthenticated,
    connectionState,
    isConnecting,
    error,
    connect,
    disconnect,
  };

  return (
    <PylonContext.Provider value={{ state, pylonAuth }}>
      {children}
    </PylonContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * usePylon — access Pylon connection state and actions.
 *
 * Must be called inside a `<PylonProvider>`.
 *
 * @example
 * ```tsx
 * const { isAuthenticated, connect, disconnect, error } = usePylon();
 *
 * // Trigger connection on button press:
 * <button onClick={() => connect(signerNsec)}>Connect to Pylon</button>
 * ```
 *
 * @throws If called outside of `<PylonProvider>`
 */
export function usePylon(): PylonState {
  const ctx = useContext(PylonContext);

  if (ctx === null) {
    throw new Error(
      'usePylon must be called inside a <PylonProvider>. ' +
      'Ensure your component is wrapped by <PylonProvider> in App.tsx.'
    );
  }

  return ctx.state;
}

/**
 * usePylonAuth — access the underlying PylonAuth instance directly.
 *
 * Prefer `usePylon()` for UI state. Use this when you need the raw
 * PylonAuth object for advanced integration (e.g., in PylonCepsClient).
 *
 * @throws If called outside of `<PylonProvider>`
 */
export function usePylonAuth(): PylonAuth {
  const ctx = useContext(PylonContext);

  if (ctx === null) {
    throw new Error('usePylonAuth must be called inside a <PylonProvider>.');
  }

  return ctx.pylonAuth;
}
