/**
 * @module hooks/useScheduledPayments
 * @description React hook for managing scheduled push payments in Satnam v2.
 *
 * Provides reactive access to the PaymentScheduler: list, create, cancel,
 * pause, and resume scheduled payments. Automatically polls for due payments
 * and exposes execution history.
 *
 * ## Usage
 * ```tsx
 * function PaymentManager() {
 *   const { schedules, createSchedule, cancelSchedule, executionHistory } =
 *     useScheduledPayments({ vault, nwc, cashu });
 *
 *   return (
 *     <div>
 *       {schedules.map(s => <ScheduleCard key={s.id} schedule={s} />)}
 *     </div>
 *   );
 * }
 * ```
 */

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';

import type { Vault } from '../lib/vault/vault.js';
import type { NwcConnectionManager } from '../lib/nwc/connection-manager.js';
import type { CashuClient } from '../lib/cashu/client.js';
import type { LNbitsClient } from '../lib/lnbits/client.js';

import { PaymentScheduler } from '../lib/payments/scheduler.js';
import type {
  ScheduledPayment,
  PaymentSchedule,
  PaymentCondition,
  PaymentExecution,
  PaymentRail,
} from '../lib/payments/types.js';

// ---------------------------------------------------------------------------
// Hook input types
// ---------------------------------------------------------------------------

export interface UseScheduledPaymentsOptions {
  /** OPFS Vault (must be unlocked) */
  vault: Vault;
  /** NWC connection manager for Lightning payments */
  nwc: NwcConnectionManager;
  /** Cashu client for eCash payments */
  cashu: CashuClient;
  /** LNbits client (optional, for lnbits rail) */
  lnbits?: LNbitsClient;
  /**
   * Interval for processing due payments in milliseconds.
   * Default: 60_000 (1 minute)
   */
  pollIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Hook state and action types
// ---------------------------------------------------------------------------

export interface UseScheduledPaymentsState {
  /** Whether the scheduler has been initialized */
  isReady: boolean;
  /** Whether an operation is in progress */
  isLoading: boolean;
  /** Last error message */
  error: string | undefined;
  /** All scheduled payments */
  schedules: ScheduledPayment[];
  /** All recent execution results (across all schedules, most recent first) */
  executionHistory: PaymentExecution[];
}

/** Parameters for creating a new scheduled payment. */
export interface CreateScheduleParams {
  label: string;
  recipientPubkey: string;
  recipientLud16?: string;
  amountMsats: bigint;
  rail: PaymentRail;
  schedule: PaymentSchedule;
  conditions?: PaymentCondition[];
}

export interface UseScheduledPaymentsActions {
  /**
   * Create and schedule a new payment.
   * @returns The created payment ID
   */
  createSchedule: (params: CreateScheduleParams) => Promise<string>;
  /**
   * Cancel a scheduled payment by ID.
   */
  cancelSchedule: (id: string) => Promise<void>;
  /**
   * Pause a scheduled payment.
   */
  pauseSchedule: (id: string) => Promise<void>;
  /**
   * Resume a paused payment.
   */
  resumeSchedule: (id: string) => Promise<void>;
  /**
   * Manually trigger execution of a payment regardless of schedule.
   */
  executeNow: (id: string) => Promise<PaymentExecution>;
  /**
   * Manually trigger processing of all due payments.
   */
  processDue: () => Promise<PaymentExecution[]>;
  /**
   * Get execution history for a specific payment.
   */
  getPaymentHistory: (id: string) => PaymentExecution[];
}

export type UseScheduledPaymentsReturn = UseScheduledPaymentsState & UseScheduledPaymentsActions;

// ---------------------------------------------------------------------------
// useScheduledPayments hook
// ---------------------------------------------------------------------------

/**
 * React hook for managing scheduled push payments.
 *
 * @param options - Scheduler dependencies and configuration
 * @returns Combined state and action object
 */
export function useScheduledPayments(
  options: UseScheduledPaymentsOptions,
): UseScheduledPaymentsReturn {
  const { vault, nwc, cashu, lnbits, pollIntervalMs = 60_000 } = options;

  const schedulerRef = useRef<PaymentScheduler | null>(null);

  const [state, setState] = useState<UseScheduledPaymentsState>({
    isReady: false,
    isLoading: false,
    error: undefined,
    schedules: [],
    executionHistory: [],
  });

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  useEffect(() => {
    // Create and load the scheduler
    const scheduler = new PaymentScheduler(vault, nwc, cashu, lnbits);
    schedulerRef.current = scheduler;

    void (async () => {
      try {
        await scheduler.load();
        const schedules = scheduler.listPayments();
        const history = schedules.flatMap((s) => s.executionHistory)
          .sort((a, b) => b.executedAt - a.executedAt);

        setState((prev) => ({
          ...prev,
          isReady: true,
          schedules,
          executionHistory: history,
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isReady: true,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    })();
  }, [vault, nwc, cashu, lnbits]);

  // -------------------------------------------------------------------------
  // Auto-polling for due payments
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!state.isReady) return;

    const interval = setInterval(() => {
      const scheduler = schedulerRef.current;
      if (!scheduler) return;

      void (async () => {
        try {
          const results = await scheduler.processScheduledPayments();
          if (results.length > 0) {
            // Update state with fresh schedule data
            const schedules = scheduler.listPayments();
            const history = schedules.flatMap((s) => s.executionHistory)
              .sort((a, b) => b.executedAt - a.executedAt);

            setState((prev) => ({
              ...prev,
              schedules,
              executionHistory: history,
            }));
          }
        } catch (err) {
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      })();
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [state.isReady, pollIntervalMs]);

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  const requireScheduler = (): PaymentScheduler => {
    if (!schedulerRef.current) {
      throw new Error('Scheduler not initialized');
    }
    return schedulerRef.current;
  };

  const refreshState = (): void => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return;

    const schedules = scheduler.listPayments();
    const history = schedules.flatMap((s) => s.executionHistory)
      .sort((a, b) => b.executedAt - a.executedAt);

    setState((prev) => ({ ...prev, schedules, executionHistory: history }));
  };

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const createSchedule = useCallback(async (params: CreateScheduleParams): Promise<string> => {
    const scheduler = requireScheduler();
    const id = crypto.randomUUID();

    const payment: ScheduledPayment = {
      id,
      label: params.label,
      recipientPubkey: params.recipientPubkey,
      recipientLud16: params.recipientLud16,
      amountMsats: params.amountMsats,
      rail: params.rail,
      schedule: params.schedule,
      conditions: params.conditions,
      status: 'active',
      createdAt: Math.floor(Date.now() / 1000),
      executionHistory: [],
    };

    setState((prev) => ({ ...prev, isLoading: true, error: undefined }));
    try {
      await scheduler.schedulePayment(payment);
      refreshState();
      return id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: message }));
      throw err;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  const cancelSchedule = useCallback(async (id: string): Promise<void> => {
    const scheduler = requireScheduler();
    setState((prev) => ({ ...prev, isLoading: true, error: undefined }));
    try {
      await scheduler.cancelPayment(id);
      refreshState();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: message }));
      throw err;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  const pauseSchedule = useCallback(async (id: string): Promise<void> => {
    const scheduler = requireScheduler();
    setState((prev) => ({ ...prev, isLoading: true, error: undefined }));
    try {
      await scheduler.pausePayment(id);
      refreshState();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: message }));
      throw err;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  const resumeSchedule = useCallback(async (id: string): Promise<void> => {
    const scheduler = requireScheduler();
    setState((prev) => ({ ...prev, isLoading: true, error: undefined }));
    try {
      await scheduler.resumePayment(id);
      refreshState();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: message }));
      throw err;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  const executeNow = useCallback(async (id: string): Promise<PaymentExecution> => {
    const scheduler = requireScheduler();
    setState((prev) => ({ ...prev, isLoading: true, error: undefined }));
    try {
      const result = await scheduler.executePayment(id);
      refreshState();
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: message }));
      throw err;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  const processDue = useCallback(async (): Promise<PaymentExecution[]> => {
    const scheduler = requireScheduler();
    setState((prev) => ({ ...prev, isLoading: true, error: undefined }));
    try {
      const results = await scheduler.processScheduledPayments();
      refreshState();
      return results;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: message }));
      throw err;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  const getPaymentHistory = useCallback((id: string): PaymentExecution[] => {
    const scheduler = schedulerRef.current;
    if (!scheduler) return [];
    return scheduler.getPayment(id)?.executionHistory ?? [];
  }, []);

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    ...state,
    createSchedule,
    cancelSchedule,
    pauseSchedule,
    resumeSchedule,
    executeNow,
    processDue,
    getPaymentHistory,
  };
}

// Prevent unused React import warning
void (null as unknown as ReactNode);
