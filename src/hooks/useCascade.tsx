/**
 * @module hooks/useCascade
 * @description React hook for payment cascade management in Satnam v2.
 *
 * Provides reactive access to the CascadeEngine: create, validate, execute,
 * and view history of payment cascades.
 *
 * ## Usage
 * ```tsx
 * function CascadeView() {
 *   const { cascades, createCascade, executeCascade, isExecuting } =
 *     useCascade({ nwc, cashu });
 *
 *   const handleExecute = async (cascade) => {
 *     const result = await executeCascade(cascade.id);
 *     console.log('Distributed:', result.totalDistributed, 'msats');
 *   };
 *
 *   return <div>...</div>;
 * }
 * ```
 */

import {
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';

import type { NwcConnectionManager } from '../lib/nwc/connection-manager.js';
import type { CashuClient } from '../lib/cashu/client.js';
import type { LNbitsClient } from '../lib/lnbits/client.js';

import { CascadeEngine } from '../lib/payments/cascade.js';
import type {
  CascadeNode,
  PaymentCascade,
  CascadeExecution,
} from '../lib/payments/types.js';

// ---------------------------------------------------------------------------
// Hook input types
// ---------------------------------------------------------------------------

export interface UseCascadeOptions {
  /** NWC connection manager for Lightning payments */
  nwc: NwcConnectionManager;
  /** Cashu client for eCash payments */
  cashu: CashuClient;
  /** LNbits client (optional, for lnbits rail nodes) */
  lnbits?: LNbitsClient;
}

// ---------------------------------------------------------------------------
// Hook state and action types
// ---------------------------------------------------------------------------

export interface UseCascadeState {
  /** Whether a cascade is currently being executed */
  isExecuting: boolean;
  /** Last error message */
  error: string | undefined;
  /** All created cascades (in-memory, not persisted) */
  cascades: PaymentCascade[];
  /** Execution history (most recent first) */
  executionHistory: CascadeExecution[];
}

/** Parameters for creating a new cascade. */
export interface CreateCascadeParams {
  label: string;
  totalAmountMsats: bigint;
  rootNodes: CascadeNode[];
  mode: 'sequential' | 'parallel';
  failurePolicy: 'stop' | 'skip' | 'retry';
}

export interface UseCascadeActions {
  /**
   * Create a new cascade (validates and stores in-memory).
   * @param params - Cascade configuration
   * @returns Created cascade
   * @throws {Error} if validation fails
   */
  createCascade: (params: CreateCascadeParams) => PaymentCascade;
  /**
   * Validate a cascade configuration without storing it.
   * @param cascade - Cascade or partial cascade to validate
   * @returns Array of validation error messages (empty if valid)
   */
  validateCascade: (cascade: PaymentCascade) => string[];
  /**
   * Execute a cascade by ID.
   * @param cascadeId - Cascade to execute
   * @param totalAmountMsats - Override amount (uses cascade.totalAmountMsats if omitted)
   * @returns CascadeExecution with per-node results
   */
  executeCascade: (cascadeId: string, totalAmountMsats?: bigint) => Promise<CascadeExecution>;
  /**
   * Execute a cascade object directly (without storing it).
   * @param cascade - Cascade to execute
   * @param totalAmountMsats - Override amount
   * @returns CascadeExecution with per-node results
   */
  executeCascadeObject: (cascade: PaymentCascade, totalAmountMsats?: bigint) => Promise<CascadeExecution>;
  /**
   * Remove a cascade from the in-memory list.
   * @param cascadeId - Cascade ID to remove
   */
  removeCascade: (cascadeId: string) => void;
  /**
   * Get execution history for a specific cascade.
   * @param cascadeId - Cascade ID
   */
  getCascadeHistory: (cascadeId: string) => CascadeExecution[];
}

export type UseCascadeReturn = UseCascadeState & UseCascadeActions;

// ---------------------------------------------------------------------------
// useCascade hook
// ---------------------------------------------------------------------------

/**
 * React hook for payment cascade management.
 *
 * Cascades are stored in-memory only — for persistence, serialize them and
 * store in the OPFS Vault manually via the vault.storeCashuProofs() slot.
 *
 * @param options - Engine dependencies
 * @returns Combined state and action object
 */
export function useCascade(options: UseCascadeOptions): UseCascadeReturn {
  const { nwc, cashu, lnbits } = options;

  // Create engine instance (memoized — stable as long as dependencies are stable)
  const engine = useMemo(
    () => new CascadeEngine(nwc, cashu, lnbits),
    [nwc, cashu, lnbits],
  );

  const [state, setState] = useState<UseCascadeState>({
    isExecuting: false,
    error: undefined,
    cascades: [],
    executionHistory: [],
  });

  // Map for execution history per cascade (ref for stability)
  const historyRef = useRef<Map<string, CascadeExecution[]>>(new Map());

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const createCascade = useCallback((params: CreateCascadeParams): PaymentCascade => {
    setState((prev) => ({ ...prev, error: undefined }));
    try {
      const cascade = engine.createCascade(params);
      setState((prev) => ({
        ...prev,
        cascades: [...prev.cascades, cascade],
      }));
      return cascade;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: message }));
      throw err;
    }
  }, [engine]);

  const validateCascade = useCallback((cascade: PaymentCascade): string[] => {
    return engine.validateCascade(cascade);
  }, [engine]);

  const executeCascadeObject = useCallback(async (
    cascade: PaymentCascade,
    totalAmountMsats?: bigint,
  ): Promise<CascadeExecution> => {
    setState((prev) => ({ ...prev, isExecuting: true, error: undefined }));
    try {
      const execution = await engine.executeCascade(cascade, totalAmountMsats);

      // Store in history
      const cascadeHistory = historyRef.current.get(cascade.id) ?? [];
      historyRef.current.set(cascade.id, [execution, ...cascadeHistory]);

      setState((prev) => ({
        ...prev,
        isExecuting: false,
        executionHistory: [
          execution,
          ...prev.executionHistory,
        ].slice(0, 200), // keep last 200
      }));

      return execution;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, isExecuting: false, error: message }));
      throw err;
    }
  }, [engine]);

  const executeCascade = useCallback(async (
    cascadeId: string,
    totalAmountMsats?: bigint,
  ): Promise<CascadeExecution> => {
    const cascade = state.cascades.find((c) => c.id === cascadeId);
    if (!cascade) {
      throw new Error(`Cascade not found: ${cascadeId}`);
    }
    return executeCascadeObject(cascade, totalAmountMsats);
  }, [state.cascades, executeCascadeObject]);

  const removeCascade = useCallback((cascadeId: string): void => {
    setState((prev) => ({
      ...prev,
      cascades: prev.cascades.filter((c) => c.id !== cascadeId),
    }));
    historyRef.current.delete(cascadeId);
  }, []);

  const getCascadeHistory = useCallback((cascadeId: string): CascadeExecution[] => {
    return historyRef.current.get(cascadeId) ?? [];
  }, []);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    ...state,
    createCascade,
    validateCascade,
    executeCascade,
    executeCascadeObject,
    removeCascade,
    getCascadeHistory,
  };
}

// Prevent unused React import warning
void (null as unknown as ReactNode);
