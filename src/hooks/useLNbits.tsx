/**
 * @module hooks/useLNbits
 * @description React hook for LNbits wallet operations in Satnam v2.
 *
 * Provides reactive access to an LNbits wallet: balance, payment history,
 * invoice creation, payment execution, and Boltz swap management.
 *
 * ## Usage
 * ```tsx
 * function WalletView() {
 *   const { wallet, balance, payments, createInvoice, payInvoice, isConnected } = useLNbits();
 *
 *   if (!isConnected) return <ConnectLNbits onConnect={connect} />;
 *   return <div>Balance: {balance} sats</div>;
 * }
 * ```
 *
 * ## Connection
 * Call `connect(config)` with the instance URL and API keys. Keys are stored
 * in the OPFS Vault — never in component state or localStorage.
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';

import type { Vault } from '../lib/vault/vault.js';
import { LNbitsClient } from '../lib/lnbits/client.js';
import type {
  LNbitsConfig,
  LNbitsWallet,
  LNbitsPayment,
  LNbitsExtension,
  BoltzSwapRequest,
  BoltzSwapStatus,
} from '../lib/lnbits/types.js';

// ---------------------------------------------------------------------------
// Hook state types
// ---------------------------------------------------------------------------

export interface UseLNbitsState {
  /** Whether an LNbits instance is configured */
  isConnected: boolean;
  /** Whether a network request is in progress */
  isLoading: boolean;
  /** Last error message (undefined if no error) */
  error: string | undefined;
  /** Wallet details including balance */
  wallet: LNbitsWallet | null;
  /** Balance in satoshis (derived from wallet.balance / 1000) */
  balance: number;
  /** Recent payments */
  payments: LNbitsPayment[];
  /** Available extensions */
  extensions: LNbitsExtension[];
}

export interface UseLNbitsActions {
  /**
   * Connect to an LNbits instance. Stores keys in OPFS Vault.
   * @param config - LNbits configuration with instance URL and keys
   */
  connect: (config: LNbitsConfig) => Promise<void>;
  /**
   * Disconnect from the current instance and remove stored keys.
   */
  disconnect: () => Promise<void>;
  /**
   * Refresh wallet details and payment list.
   */
  refresh: () => Promise<void>;
  /**
   * Create a Lightning invoice (BOLT-11).
   * @param amountSats - Amount in satoshis
   * @param memo - Invoice description
   * @returns BOLT-11 invoice string
   */
  createInvoice: (amountSats: number, memo: string) => Promise<string>;
  /**
   * Pay a BOLT-11 invoice.
   * @param bolt11 - Invoice to pay
   * @returns Payment record
   */
  payInvoice: (bolt11: string) => Promise<LNbitsPayment>;
  /**
   * Create or execute a Boltz swap.
   * @param request - Swap parameters
   * @returns Swap status
   */
  boltzSwap: (request: BoltzSwapRequest) => Promise<BoltzSwapStatus>;
  /**
   * Check the status of an existing Boltz swap.
   * @param swapId - Swap ID to check
   */
  checkBoltzSwap: (swapId: string) => Promise<BoltzSwapStatus>;
}

export type UseLNbitsReturn = UseLNbitsState & UseLNbitsActions;

// ---------------------------------------------------------------------------
// useLNbits hook
// ---------------------------------------------------------------------------

/**
 * React hook for LNbits wallet operations.
 *
 * @param vault - OPFS Vault instance (must be unlocked before use)
 * @param instanceUrl - Optional initial instance URL (no keys — call connect() to add keys)
 * @param autoRefreshIntervalMs - Interval for auto-refreshing balance/payments (default 60000ms)
 * @returns Combined state and action object
 */
export function useLNbits(
  vault: Vault,
  instanceUrl?: string,
  autoRefreshIntervalMs = 60_000,
): UseLNbitsReturn {
  const clientRef = useRef<LNbitsClient>(
    new LNbitsClient(vault, instanceUrl ? { instanceUrl } : undefined),
  );

  const [state, setState] = useState<UseLNbitsState>({
    isConnected: !!instanceUrl,
    isLoading: false,
    error: undefined,
    wallet: null,
    balance: 0,
    payments: [],
    extensions: [],
  });

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  const setLoading = useCallback((isLoading: boolean) => {
    setState((prev) => ({ ...prev, isLoading }));
  }, []);

  const setError = useCallback((error: string | undefined) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const doRefresh = useCallback(async () => {
    if (!clientRef.current.isConnected()) return;

    setLoading(true);
    setError(undefined);

    try {
      const [walletData, paymentsData, extensionsData] = await Promise.allSettled([
        clientRef.current.getWalletDetails(),
        clientRef.current.getPayments(50, 0),
        clientRef.current.listExtensions(),
      ]);

      setState((prev) => ({
        ...prev,
        isLoading: false,
        wallet: walletData.status === 'fulfilled' ? walletData.value : prev.wallet,
        balance: walletData.status === 'fulfilled'
          ? Math.floor(walletData.value.balance / 1000)
          : prev.balance,
        payments: paymentsData.status === 'fulfilled' ? paymentsData.value : prev.payments,
        extensions: extensionsData.status === 'fulfilled' ? extensionsData.value : prev.extensions,
        error: walletData.status === 'rejected'
          ? (walletData.reason instanceof Error ? walletData.reason.message : String(walletData.reason))
          : undefined,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [setLoading, setError]);

  // -------------------------------------------------------------------------
  // Auto-refresh
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!state.isConnected) return;

    void doRefresh();

    const interval = setInterval(() => {
      void doRefresh();
    }, autoRefreshIntervalMs);

    return () => clearInterval(interval);
  }, [state.isConnected, autoRefreshIntervalMs, doRefresh]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const connect = useCallback(async (config: LNbitsConfig): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      await clientRef.current.connect(config);
      setState((prev) => ({ ...prev, isConnected: true, isLoading: false }));
      // Trigger initial refresh
      await doRefresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, isLoading: false, error: message }));
      throw err;
    }
  }, [setLoading, setError, doRefresh]);

  const disconnect = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      await clientRef.current.disconnect();
      setState({
        isConnected: false,
        isLoading: false,
        error: undefined,
        wallet: null,
        balance: 0,
        payments: [],
        extensions: [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, isLoading: false, error: message }));
      throw err;
    }
  }, [setLoading]);

  const refresh = useCallback(async (): Promise<void> => {
    await doRefresh();
  }, [doRefresh]);

  const createInvoice = useCallback(async (amountSats: number, memo: string): Promise<string> => {
    setError(undefined);
    try {
      const bolt11 = await clientRef.current.createInvoice(amountSats, memo);
      return bolt11;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    }
  }, [setError]);

  const payInvoice = useCallback(async (bolt11: string): Promise<LNbitsPayment> => {
    setLoading(true);
    setError(undefined);
    try {
      const payment = await clientRef.current.payInvoice(bolt11);
      // Refresh payments list after paying
      void doRefresh();
      return payment;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, isLoading: false, error: message }));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError, doRefresh]);

  const boltzSwap = useCallback(async (request: BoltzSwapRequest): Promise<BoltzSwapStatus> => {
    setLoading(true);
    setError(undefined);
    try {
      const swap = await clientRef.current.createBoltzSwap(request);
      return swap;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [setLoading, setError]);

  const checkBoltzSwap = useCallback(async (swapId: string): Promise<BoltzSwapStatus> => {
    setError(undefined);
    try {
      return await clientRef.current.checkBoltzSwap(swapId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      throw err;
    }
  }, [setError]);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    ...state,
    connect,
    disconnect,
    refresh,
    createInvoice,
    payInvoice,
    boltzSwap,
    checkBoltzSwap,
  };
}

// Prevent unused React import warning in some bundlers
void (null as unknown as ReactNode);
