/**
 * @module hooks/useCashu
 * @description React hook providing Cashu eCash state and operations to the
 * Satnam v2 component tree.
 *
 * The hook lazily initializes a {@link CashuClient} backed by the OPFS Vault.
 * Proof balances are read from vault-backed storage and surfaced as React state.
 *
 * ## Usage
 * ```tsx
 * function WalletCashu() {
 *   const { mints, balance, isLoading, error, addMint, sendTokens } = useCashu();
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return (
 *     <MintList
 *       mints={mints}
 *       totalBalance={balance}
 *       onAddMint={addMint}
 *     />
 *   );
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
import { CashuClient } from '../lib/cashu/client.js';
import type { MintInfo, CashuProof, MeltResult } from '../lib/cashu/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseCashuReturn {
  /** All configured Cashu mints with their current balances. */
  mints: MintInfo[];

  /** Total balance across all mints in satoshis. */
  balance: number;

  /** True while any async operation is in progress. */
  isLoading: boolean;

  /** Error message from the last failed operation, or null. */
  error: string | null;

  /**
   * Add a Cashu mint. Fetches the mint info to validate reachability.
   *
   * @param mintUrl - Base URL of the Cashu mint
   */
  addMint: (mintUrl: string) => Promise<void>;

  /**
   * Remove a Cashu mint and delete all stored proofs.
   *
   * @param mintUrl - Base URL of the mint to remove
   */
  removeMint: (mintUrl: string) => Promise<void>;

  /**
   * Mint new Cashu tokens by paying a Lightning invoice.
   *
   * The mint returns a BOLT-11 invoice. After the invoice is paid (externally
   * via NWC), the mint issues proofs. This method attempts to mint immediately.
   *
   * @param amountSats - Amount to mint in satoshis
   * @param mintUrl - Mint URL to use
   * @returns Array of new proofs
   */
  mintTokens: (amountSats: number, mintUrl: string) => Promise<CashuProof[]>;

  /**
   * Melt Cashu tokens (pay a Lightning invoice using Cashu proofs).
   *
   * @param proofs - Proofs to use for the payment
   * @param bolt11 - BOLT-11 invoice to pay
   * @returns Melt result with payment status and change
   */
  meltTokens: (proofs: CashuProof[], bolt11: string) => Promise<MeltResult>;

  /**
   * Send Cashu tokens to another user.
   *
   * @param amountSats - Amount to send in satoshis
   * @param mintUrl - Mint URL where the proofs are held
   * @returns Serialized cashuA token string to share with the recipient
   */
  sendTokens: (amountSats: number, mintUrl: string) => Promise<string>;

  /**
   * Receive a Cashu token from another user.
   *
   * Swaps the received proofs at the mint and stores new proofs in the vault.
   *
   * @param serializedToken - cashuA... token string from the sender
   * @returns Array of new proofs added to the vault
   */
  receiveTokens: (serializedToken: string) => Promise<CashuProof[]>;

  /** Manually clear the current error. */
  clearError: () => void;

  /** Re-fetch mint list and balances from vault and IndexedDB. */
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * React hook providing Cashu eCash state and operations.
 *
 * Initializes the {@link CashuClient} on first render and loads mint metadata
 * from IndexedDB, reading proof balances from the OPFS Vault.
 *
 * The vault must be unlocked before any vault-accessing operation (mintTokens,
 * meltTokens, sendTokens, receiveTokens, refresh). If the vault is locked,
 * vault operations will throw VaultError.VaultLocked.
 */
export function useCashu(): UseCashuReturn {
  const [mints, setMints] = useState<MintInfo[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable client reference
  const clientRef = useRef<CashuClient | null>(null);

  const getClient = useCallback((): CashuClient => {
    if (!clientRef.current) {
      clientRef.current = new CashuClient(getVault());
    }
    return clientRef.current;
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

  const syncMints = useCallback(async () => {
    const client = getClient();
    try {
      const mintList = await client.listMints();
      const total = mintList.reduce((sum, m) => sum + m.balance, 0);
      setMints(mintList);
      setBalance(total);
    } catch (err) {
      // If the vault is locked, we can still show mint metadata without balances
      // (listMints will throw VaultLocked when it tries to read proofs)
      const message = err instanceof Error ? err.message : String(err);
      // Only set error if it's not a vault-locked error — those are expected
      // when the vault hasn't been unlocked yet
      if (!message.includes('VaultLocked')) {
        setError(message);
      }
    }
  }, [getClient]);

  // -------------------------------------------------------------------------
  // Initial load
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const client = getClient();
      try {
        const mintList = await client.listMints();
        const total = mintList.reduce((sum, m) => sum + m.balance, 0);
        if (!cancelled) {
          setMints(mintList);
          setBalance(total);
        }
      } catch {
        // Silently ignore load errors — vault may be locked at startup
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [getClient]);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const addMint = useCallback(
    async (mintUrl: string): Promise<void> => {
      return withLoading(async () => {
        const client = getClient();
        await client.addMint(mintUrl);
        await syncMints();
      });
    },
    [withLoading, getClient, syncMints],
  );

  const removeMint = useCallback(
    async (mintUrl: string): Promise<void> => {
      return withLoading(async () => {
        const client = getClient();
        await client.removeMint(mintUrl);
        await syncMints();
      });
    },
    [withLoading, getClient, syncMints],
  );

  const mintTokens = useCallback(
    async (amountSats: number, mintUrl: string): Promise<CashuProof[]> => {
      return withLoading(async () => {
        const client = getClient();
        const proofs = await client.mintTokens(amountSats, mintUrl);
        await syncMints();
        return proofs;
      });
    },
    [withLoading, getClient, syncMints],
  );

  const meltTokens = useCallback(
    async (proofs: CashuProof[], bolt11: string): Promise<MeltResult> => {
      return withLoading(async () => {
        const client = getClient();
        const result = await client.meltTokens(proofs, bolt11);
        await syncMints();
        return result;
      });
    },
    [withLoading, getClient, syncMints],
  );

  const sendTokens = useCallback(
    async (amountSats: number, mintUrl: string): Promise<string> => {
      return withLoading(async () => {
        const client = getClient();
        const token = await client.sendTokens(amountSats, mintUrl);
        await syncMints();
        return token;
      });
    },
    [withLoading, getClient, syncMints],
  );

  const receiveTokens = useCallback(
    async (serializedToken: string): Promise<CashuProof[]> => {
      return withLoading(async () => {
        const client = getClient();
        const proofs = await client.receiveTokens(serializedToken);
        await syncMints();
        return proofs;
      });
    },
    [withLoading, getClient, syncMints],
  );

  const clearError = useCallback(() => setError(null), []);

  const refresh = useCallback(async () => {
    return withLoading(syncMints);
  }, [withLoading, syncMints]);

  // -------------------------------------------------------------------------
  // Return value
  // -------------------------------------------------------------------------

  return useMemo(
    () => ({
      mints,
      balance,
      isLoading,
      error,
      addMint,
      removeMint,
      mintTokens,
      meltTokens,
      sendTokens,
      receiveTokens,
      clearError,
      refresh,
    }),
    [
      mints,
      balance,
      isLoading,
      error,
      addMint,
      removeMint,
      mintTokens,
      meltTokens,
      sendTokens,
      receiveTokens,
      clearError,
      refresh,
    ],
  );
}
