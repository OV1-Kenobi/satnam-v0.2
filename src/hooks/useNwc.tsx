/**
 * @module hooks/useNwc
 * @description React hook providing NWC (Nostr Wallet Connect) state and operations
 * to the Satnam v2 component tree.
 *
 * The hook lazily initializes a {@link NwcConnectionManager} backed by the OPFS
 * Vault. All state is kept in React state — the manager is stateless beyond
 * vault access and IndexedDB metadata.
 *
 * ## Usage
 * ```tsx
 * function WalletPanel() {
 *   const {
 *     connections, defaultConnection, balance, isLoading, error,
 *     addConnection, removeConnection, setDefault, payInvoice, makeInvoice,
 *     getBalance, listTransactions,
 *   } = useNwc();
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <ErrorBanner message={error} />;
 *
 *   return <ConnectionList connections={connections} />;
 * }
 * ```
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getVault } from '../lib/vault/vault.js';
import { NwcConnectionManager } from '../lib/nwc/connection-manager.js';
import type {
  NwcConnection,
  PaymentResult,
  Transaction,
  TxListOptions,
} from '../lib/nwc/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseNwcReturn {
  /** All configured NWC connections (metadata only, no secrets). */
  connections: NwcConnection[];

  /** The current default connection, or null if none exist. */
  defaultConnection: NwcConnection | null;

  /**
   * Latest fetched balance in millisatoshis for the default connection.
   * null if not yet fetched.
   */
  balance: bigint | null;

  /** True while any async operation is in progress. */
  isLoading: boolean;

  /** Error message from the last failed operation, or null. */
  error: string | null;

  /**
   * Parse and add a new NWC connection.
   *
   * @param label - User-provided label (e.g. "Alby Hub")
   * @param nwcUri - Full nostr+walletconnect:// URI
   * @returns The new connection's UUID
   */
  addConnection: (label: string, nwcUri: string) => Promise<string>;

  /**
   * Remove a connection and delete its secret from the vault.
   *
   * @param connectionId - UUID of the connection to remove
   */
  removeConnection: (connectionId: string) => Promise<void>;

  /**
   * Set a connection as the default.
   *
   * @param connectionId - UUID of the connection to promote
   */
  setDefault: (connectionId: string) => Promise<void>;

  /**
   * Pay a BOLT-11 invoice via NWC.
   *
   * @param bolt11 - BOLT-11 invoice string
   * @param connectionId - Optional UUID; uses default if omitted
   */
  payInvoice: (bolt11: string, connectionId?: string) => Promise<PaymentResult>;

  /**
   * Create a BOLT-11 invoice for receiving.
   *
   * @param amountMsats - Amount in millisatoshis
   * @param description - Invoice description
   * @param connectionId - Optional UUID; uses default if omitted
   * @returns BOLT-11 invoice string
   */
  makeInvoice: (
    amountMsats: bigint,
    description: string,
    connectionId?: string,
  ) => Promise<string>;

  /**
   * Refresh the balance for a connection (defaults to the default connection).
   *
   * @param connectionId - Optional UUID; uses default if omitted
   * @returns Balance in millisatoshis
   */
  getBalance: (connectionId?: string) => Promise<bigint>;

  /**
   * List transactions from the wallet history.
   *
   * @param options - Filtering options
   * @param connectionId - Optional UUID; uses default if omitted
   */
  listTransactions: (options: TxListOptions, connectionId?: string) => Promise<Transaction[]>;

  /** Manually clear the current error. */
  clearError: () => void;

  /** Re-fetch the connection list and default connection. */
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * React hook providing NWC state and operations.
 *
 * Initializes the {@link NwcConnectionManager} on first render and loads
 * the connection list from IndexedDB. Operations update the connection list
 * and default connection state automatically.
 *
 * The vault must be unlocked before any operation that touches vault secrets
 * (addConnection, payInvoice, makeInvoice, getBalance, etc.). If the vault is
 * locked, operations will throw VaultError.VaultLocked.
 */
export function useNwc(): UseNwcReturn {
  const [connections, setConnections] = useState<NwcConnection[]>([]);
  const [defaultConnection, setDefaultConnection] = useState<NwcConnection | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable manager reference — created once, never recreated
  const managerRef = useRef<NwcConnectionManager | null>(null);

  const getManager = useCallback((): NwcConnectionManager => {
    if (!managerRef.current) {
      managerRef.current = new NwcConnectionManager(getVault());
    }
    return managerRef.current;
  }, []);

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  const withLoading = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      setIsLoading(true);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const syncConnections = useCallback(async () => {
    const manager = getManager();
    const [all, def] = await Promise.all([
      manager.listConnections(),
      manager.getDefaultConnection(),
    ]);
    setConnections(all);
    setDefaultConnection(def);
  }, [getManager]);

  // -------------------------------------------------------------------------
  // Initial load
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const manager = getManager();
        const [all, def] = await Promise.all([
          manager.listConnections(),
          manager.getDefaultConnection(),
        ]);
        if (!cancelled) {
          setConnections(all);
          setDefaultConnection(def);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
        }
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [getManager]);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const addConnection = useCallback(
    async (label: string, nwcUri: string): Promise<string> => {
      return withLoading(async () => {
        const manager = getManager();
        const id = await manager.addConnection(label, nwcUri);
        await syncConnections();
        return id;
      });
    },
    [withLoading, getManager, syncConnections],
  );

  const removeConnection = useCallback(
    async (connectionId: string): Promise<void> => {
      return withLoading(async () => {
        const manager = getManager();
        await manager.removeConnection(connectionId);
        await syncConnections();
        // Clear cached balance if the removed connection was the default
        setBalance(null);
      });
    },
    [withLoading, getManager, syncConnections],
  );

  const setDefault = useCallback(
    async (connectionId: string): Promise<void> => {
      return withLoading(async () => {
        const manager = getManager();
        await manager.setDefaultConnection(connectionId);
        await syncConnections();
        // Balance belongs to the default connection — clear it
        setBalance(null);
      });
    },
    [withLoading, getManager, syncConnections],
  );

  const payInvoice = useCallback(
    async (bolt11: string, connectionId?: string): Promise<PaymentResult> => {
      return withLoading(async () => {
        const manager = getManager();
        return manager.payInvoice(bolt11, connectionId);
      });
    },
    [withLoading, getManager],
  );

  const makeInvoice = useCallback(
    async (amountMsats: bigint, description: string, connectionId?: string): Promise<string> => {
      return withLoading(async () => {
        const manager = getManager();
        return manager.makeInvoice(amountMsats, description, connectionId);
      });
    },
    [withLoading, getManager],
  );

  const getBalance = useCallback(
    async (connectionId?: string): Promise<bigint> => {
      return withLoading(async () => {
        const manager = getManager();
        const bal = await manager.getBalance(connectionId);
        // Only cache the balance in state if it's the default connection
        if (!connectionId || connectionId === defaultConnection?.id) {
          setBalance(bal);
        }
        return bal;
      });
    },
    [withLoading, getManager, defaultConnection],
  );

  const listTransactions = useCallback(
    async (options: TxListOptions, connectionId?: string): Promise<Transaction[]> => {
      return withLoading(async () => {
        const manager = getManager();
        return manager.listTransactions(options, connectionId);
      });
    },
    [withLoading, getManager],
  );

  const clearError = useCallback(() => setError(null), []);

  const refresh = useCallback(async () => {
    return withLoading(syncConnections);
  }, [withLoading, syncConnections]);

  // -------------------------------------------------------------------------
  // Return value
  // -------------------------------------------------------------------------

  return useMemo(
    () => ({
      connections,
      defaultConnection,
      balance,
      isLoading,
      error,
      addConnection,
      removeConnection,
      setDefault,
      payInvoice,
      makeInvoice,
      getBalance,
      listTransactions,
      clearError,
      refresh,
    }),
    [
      connections,
      defaultConnection,
      balance,
      isLoading,
      error,
      addConnection,
      removeConnection,
      setDefault,
      payInvoice,
      makeInvoice,
      getBalance,
      listTransactions,
      clearError,
      refresh,
    ],
  );
}
