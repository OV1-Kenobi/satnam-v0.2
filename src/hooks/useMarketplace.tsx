/**
 * @module hooks/useMarketplace
 * @description React hook wrapping {@link DvmMarketplace} for NIP-90 DVM
 * marketplace operations in Satnam v2 component trees.
 *
 * The hook provides access to provider discovery, job submission, result
 * subscription, payment, feedback, and active job tracking. All operations
 * surface loading/error state in the standard Satnam v2 hook pattern.
 *
 * ## Usage
 * ```tsx
 * function JobSubmissionPanel() {
 *   const {
 *     isLoading, error, activeJobs,
 *     discoverProviders, submitJob, subscribeToResults,
 *     payForResult, submitFeedback, executeJob,
 *   } = useMarketplace();
 *
 *   const handleExecute = async () => {
 *     const { requestId, result, paymentResult } = await executeJob({
 *       request: {
 *         kind: 5100,
 *         input: [{ data: 'Summarize BTC whitepaper', type: 'text' }],
 *         params: [],
 *         bid_msats: 10_000n,
 *       },
 *       signerNsec: nsec,
 *       autoPayBelow: 10_000n,
 *     });
 *   };
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

import { getCepsClient } from '../lib/ceps/ceps-client.js';
import { getVault } from '../lib/vault/vault.js';
import { NwcConnectionManager } from '../lib/nwc/connection-manager.js';
import { DvmMarketplace } from '../lib/nip90/marketplace.js';
import type { ActiveJob } from '../lib/nip90/marketplace.js';
import type { PaymentResult } from '../lib/nwc/connection-manager.js';
import type { DvmJobRequest, DvmJobResult, DvmProvider, DvmFeedbackStatus } from '../lib/nip90/types.js';

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface UseMarketplaceReturn {
  /** True while any async marketplace operation is in progress. */
  isLoading: boolean;

  /** Error message from the last failed operation, or null. */
  error: string | null;

  /**
   * All in-flight jobs submitted during this hook instance's lifetime.
   * Updated after each successful submitJob() call.
   */
  activeJobs: ActiveJob[];

  /**
   * Discover DVM providers that support a given job kind.
   *
   * @param jobKind   - NIP-90 job kind (5000-5999)
   * @param relayUrls - Optional relay overrides
   * @returns Array of DvmProvider objects
   */
  discoverProviders: (jobKind: number, relayUrls?: string[]) => Promise<DvmProvider[]>;

  /**
   * Sign and publish a NIP-90 job request.
   *
   * @param request    - DVM job request parameters
   * @param signerNsec - Hex nsec used to sign the event
   * @returns The published request event ID
   */
  submitJob: (request: DvmJobRequest, signerNsec: string) => Promise<string>;

  /**
   * Subscribe to job results for a submitted request.
   *
   * @param requestEventId - Hex event ID of the submitted job request
   * @param callback       - Called for each result or status update
   * @returns Unsubscribe function
   */
  subscribeToResults: (
    requestEventId: string,
    callback: (result: DvmJobResult) => void
  ) => () => void;

  /**
   * Pay for a job result via NWC.
   *
   * @param result - DvmJobResult containing payment info
   * @returns PaymentResult with preimage and fees
   */
  payForResult: (result: DvmJobResult) => Promise<PaymentResult>;

  /**
   * Publish kind:7000 feedback for a received result.
   *
   * @param params - Feedback parameters
   * @returns The published feedback event ID
   */
  submitFeedback: (params: {
    requestEventId: string;
    resultEventId: string;
    providerPubkey: string;
    status: DvmFeedbackStatus;
    amountMsats?: bigint;
    comment?: string;
    signerNsec: string;
  }) => Promise<string>;

  /**
   * Execute a complete job lifecycle: submit → wait → pay → feedback.
   *
   * @param params - Job execution parameters
   * @returns Object with requestId, result, and optional payment/feedback IDs
   */
  executeJob: (params: {
    request: DvmJobRequest;
    signerNsec: string;
    autoPayBelow?: bigint;
    timeout?: number;
  }) => Promise<{
    requestId: string;
    result: DvmJobResult;
    paymentResult?: PaymentResult;
    feedbackId?: string;
  }>;

  /**
   * Clear the last error.
   */
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * React hook providing NIP-90 DVM marketplace operations.
 *
 * The {@link DvmMarketplace} is created lazily on first use and reused across
 * renders. The hook tracks active jobs in React state so components can display
 * the current job queue.
 *
 * @param defaultRelayUrls - Optional relay URL overrides for this hook instance.
 *   Defaults to the marketplace's built-in fallback relays.
 * @returns UseMarketplaceReturn
 */
export function useMarketplace(defaultRelayUrls?: string[]): UseMarketplaceReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);

  /** Stable ref to the lazy-initialised DvmMarketplace instance. */
  const marketplaceRef = useRef<DvmMarketplace | null>(null);
  /** Promise tracking the in-progress initialisation. */
  const initPromiseRef = useRef<Promise<DvmMarketplace> | null>(null);

  // ---------------------------------------------------------------------------
  // Lazy marketplace initialisation
  // ---------------------------------------------------------------------------

  /**
   * Get or create the DvmMarketplace instance.
   * Safe to call concurrently.
   */
  const getMarketplace = useCallback(async (): Promise<DvmMarketplace> => {
    if (marketplaceRef.current) return marketplaceRef.current;

    if (!initPromiseRef.current) {
      initPromiseRef.current = (async () => {
        const [ceps, vault] = await Promise.all([
          getCepsClient(),
          getVault(),
        ]);
        const nwc = new NwcConnectionManager(vault);
        const marketplace = new DvmMarketplace(ceps, nwc, defaultRelayUrls);
        marketplaceRef.current = marketplace;
        return marketplace;
      })();
    }

    return initPromiseRef.current;
  }, [defaultRelayUrls]);

  // ---------------------------------------------------------------------------
  // Generic operation wrapper
  // ---------------------------------------------------------------------------

  /**
   * Wrap an async operation with loading/error state management.
   * @internal
   */
  const withState = useCallback(
    async <T,>(operation: (m: DvmMarketplace) => Promise<T>): Promise<T> => {
      setIsLoading(true);
      setError(null);
      try {
        const marketplace = await getMarketplace();
        return await operation(marketplace);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [getMarketplace]
  );

  // ---------------------------------------------------------------------------
  // Active jobs refresh helper
  // ---------------------------------------------------------------------------

  /**
   * Refresh the activeJobs state from the marketplace's internal tracker.
   * Called after submitJob() to keep the UI in sync.
   * @internal
   */
  const refreshActiveJobs = useCallback(async () => {
    const marketplace = marketplaceRef.current;
    if (!marketplace) return;
    try {
      const jobs = await marketplace.getActiveJobs("*");
      setActiveJobs(jobs);
    } catch {
      // Non-fatal — silently ignore
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Public operations
  // ---------------------------------------------------------------------------

  const discoverProviders = useCallback(
    (jobKind: number, relayUrls?: string[]) =>
      withState((m) => m.discoverProviders(jobKind, relayUrls)),
    [withState]
  );

  const submitJob = useCallback(
    async (request: DvmJobRequest, signerNsec: string): Promise<string> => {
      const eventId = await withState((m) => m.submitJob(request, signerNsec));
      // Refresh active jobs after successful submission
      void refreshActiveJobs();
      return eventId;
    },
    [withState, refreshActiveJobs]
  );

  const subscribeToResults = useCallback(
    (requestEventId: string, callback: (result: DvmJobResult) => void): (() => void) => {
      // subscribeToResults is synchronous; we need the marketplace instance
      // Use a flag pattern since we can't make this callback async
      let unsub: (() => void) | null = null;
      let unsubCalled = false;

      getMarketplace().then((marketplace) => {
        if (unsubCalled) return;
        unsub = marketplace.subscribeToResults(requestEventId, callback);
      }).catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });

      return () => {
        unsubCalled = true;
        if (unsub) unsub();
      };
    },
    [getMarketplace]
  );

  const payForResult = useCallback(
    (result: DvmJobResult) =>
      withState((m) => m.payForResult(result)),
    [withState]
  );

  const submitFeedback = useCallback(
    (params: {
      requestEventId: string;
      resultEventId: string;
      providerPubkey: string;
      status: DvmFeedbackStatus;
      amountMsats?: bigint;
      comment?: string;
      signerNsec: string;
    }) =>
      withState((m) => m.submitFeedback(params)),
    [withState]
  );

  const executeJob = useCallback(
    async (params: {
      request: DvmJobRequest;
      signerNsec: string;
      autoPayBelow?: bigint;
      timeout?: number;
    }) => {
      const result = await withState((m) => m.executeJob(params));
      // Refresh active jobs list
      void refreshActiveJobs();
      return result;
    },
    [withState, refreshActiveJobs]
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({
      isLoading,
      error,
      activeJobs,
      discoverProviders,
      submitJob,
      subscribeToResults,
      payForResult,
      submitFeedback,
      executeJob,
      clearError,
    }),
    [
      isLoading,
      error,
      activeJobs,
      discoverProviders,
      submitJob,
      subscribeToResults,
      payForResult,
      submitFeedback,
      executeJob,
      clearError,
    ]
  );
}

