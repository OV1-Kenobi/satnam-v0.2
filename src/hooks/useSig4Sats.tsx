/**
 * @module hooks/useSig4Sats
 * @description React hook for the Sig4Sats bond system.
 *
 * Provides access to all 3 bond types, creation flows, and spending operations.
 * The hook maintains reactive state by refreshing from BondManager on each
 * mutation and on mount.
 *
 * @example
 * ```tsx
 * const { entitlements, createEntitlement, spendAllowance } = useSig4Sats();
 *
 * // Check if user has premium access
 * const hasPremium = entitlements.some(
 *   e => e.featureId === 'premium-agents' && e.status === 'active'
 * );
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getBondManager } from '../lib/sig4sats/bond-manager.js';
import { getVault } from '../lib/vault/vault.js';
import type {
  EntitlementBond,
  RecoveryBond,
  AllowanceBond,
  CreateEntitlementParams,
  CreateRecoveryParams,
  CreateAllowanceParams,
  SpendResult,
} from '../lib/sig4sats/types.js';

// ============================================================================
// Hook State
// ============================================================================

export interface Sig4SatsState {
  /** All active/spent entitlement tokens */
  entitlements: EntitlementBond[];
  /** All recovery bond requests */
  recoveryBonds: RecoveryBond[];
  /** All allowance bonds (as guardian and as recipient) */
  allowances: AllowanceBond[];
  /** Whether any async operation is in progress */
  isLoading: boolean;
  /** Last error message, if any */
  error: string | null;
}

export interface Sig4SatsActions {
  /** Create a new entitlement bond */
  createEntitlement: (params: CreateEntitlementParams) => Promise<EntitlementBond>;
  /** Create a new recovery bond */
  createRecoveryBond: (params: CreateRecoveryParams) => Promise<RecoveryBond>;
  /** Create a new allowance bond */
  createAllowance: (params: CreateAllowanceParams) => Promise<AllowanceBond>;
  /** Spend an allowance token for a recipient */
  spendAllowance: (
    recipientPubkey: string,
    amount: number,
    rail?: 'lightning' | 'cashu'
  ) => Promise<SpendResult>;
  /** Validate an entitlement token */
  validateEntitlement: (featureId: string, token: string) => Promise<boolean>;
  /** Spend (consume) an entitlement token */
  spendEntitlement: (featureId: string) => Promise<boolean>;
  /** Add a guardian bond to a recovery request */
  addGuardianBond: (
    recoveryEventId: string,
    guardianPubkey: string,
    bondProof: string
  ) => Promise<RecoveryBond | null>;
  /** Execute a recovery that has met its threshold */
  executeRecovery: (recoveryEventId: string) => Promise<string | null>;
  /** Refresh bond lists from storage */
  refresh: () => void;
  /** Clear the last error */
  clearError: () => void;
}

export type UseSig4SatsReturn = Sig4SatsState & Sig4SatsActions;

// ============================================================================
// Hook
// ============================================================================

/**
 * useSig4Sats — Sig4Sats bond system React hook.
 *
 * @returns Combined state and action object for all bond operations
 */
export function useSig4Sats(): UseSig4SatsReturn {
  const manager = getBondManager(getVault());
  const mountedRef = useRef(true);

  const [state, setState] = useState<Sig4SatsState>({
    entitlements: [],
    recoveryBonds: [],
    allowances: [],
    isLoading: false,
    error: null,
  });

  // -------------------------------------------------------------------------
  // Refresh bond lists
  // -------------------------------------------------------------------------

  const refresh = useCallback(() => {
    if (!mountedRef.current) return;

    void (async () => {
      // Expire stale bonds first
      await manager.expireStaleBonds();

      const allBonds = await manager.listBonds();

      const entitlements = allBonds
        .filter((b) => b.bond.type === 'entitlement')
        .map((b) => b.bond as EntitlementBond);

      const recoveryBonds = allBonds
        .filter((b) => b.bond.type === 'recovery')
        .map((b) => b.bond as RecoveryBond);

      const allowances = allBonds
        .filter((b) => b.bond.type === 'allowance')
        .map((b) => b.bond as AllowanceBond);

      if (mountedRef.current) {
        setState((prev) => ({
          ...prev,
          entitlements,
          recoveryBonds,
          allowances,
        }));
      }
    })();
  }, [manager]);

  // Hydrate on mount
  useEffect(() => {
    mountedRef.current = true;
    refresh();

    // Refresh on window focus (to pick up changes from other tabs)
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  // -------------------------------------------------------------------------
  // Async action wrapper
  // -------------------------------------------------------------------------

  function withLoading<T>(
    fn: () => Promise<T>
  ): Promise<T> {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    return fn()
      .then((result) => {
        if (mountedRef.current) {
          refresh();
          setState((prev) => ({ ...prev, isLoading: false }));
        }
        return result;
      })
      .catch((err: unknown) => {
        if (mountedRef.current) {
          const message = err instanceof Error ? err.message : String(err);
          setState((prev) => ({ ...prev, isLoading: false, error: message }));
        }
        throw err;
      });
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const createEntitlement = useCallback(
    (params: CreateEntitlementParams): Promise<EntitlementBond> =>
      withLoading(() => manager.createEntitlementBond(params)),
    [manager]
  );

  const createRecoveryBond = useCallback(
    (params: CreateRecoveryParams): Promise<RecoveryBond> =>
      withLoading(() => manager.createRecoveryBond(params)),
    [manager]
  );

  const createAllowance = useCallback(
    (params: CreateAllowanceParams): Promise<AllowanceBond> =>
      withLoading(() => manager.createAllowanceBond(params)),
    [manager]
  );

  const spendAllowance = useCallback(
    (
      recipientPubkey: string,
      amount: number,
      rail: 'lightning' | 'cashu' = 'lightning'
    ): Promise<SpendResult> =>
      withLoading(() => manager.spendAllowanceToken(recipientPubkey, amount, rail)),
    [manager]
  );

  const validateEntitlement = useCallback(
    (featureId: string, token: string): Promise<boolean> =>
      manager.validateEntitlementToken(featureId, token),
    [manager]
  );

  const spendEntitlement = useCallback(
    (featureId: string): Promise<boolean> =>
      withLoading(() => manager.spendEntitlementToken(featureId)),
    [manager]
  );

  const addGuardianBond = useCallback(
    (
      recoveryEventId: string,
      guardianPubkey: string,
      bondProof: string
    ): Promise<RecoveryBond | null> =>
      withLoading(() => manager.addGuardianBond(recoveryEventId, guardianPubkey, bondProof)),
    [manager]
  );

  const executeRecovery = useCallback(
    (recoveryEventId: string): Promise<string | null> =>
      withLoading(() => manager.executeRecovery(recoveryEventId)),
    [manager]
  );

  const clearError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return {
    ...state,
    createEntitlement,
    createRecoveryBond,
    createAllowance,
    spendAllowance,
    validateEntitlement,
    spendEntitlement,
    addGuardianBond,
    executeRecovery,
    refresh,
    clearError,
  };
}

export default useSig4Sats;

