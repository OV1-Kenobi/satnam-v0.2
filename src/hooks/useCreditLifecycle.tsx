/**
 * @module hooks/useCreditLifecycle
 * @description React hook for NIP-AC credit lifecycle monitoring and management.
 *
 * Provides a complete credit lifecycle interface within a React component:
 * - Creating credit intents (kind:39240)
 * - Viewing and accepting provider offers (kind:39241)
 * - Managing active envelopes (kind:39242)
 * - Authorizing spends (kind:39243)
 * - Settling completed tasks (kind:39244)
 * - Issuing default notices (kind:39245)
 * - Live subscription to lifecycle events
 *
 * Uses CreditLifecycleManager internally for all event construction and publishing.
 *
 * @example
 * ```tsx
 * const {
 *   activeEnvelopes,
 *   pendingOffers,
 *   isLoading,
 *   createIntent,
 *   acceptOffer,
 *   authorizeSpend,
 *   settleEnvelope,
 * } = useCreditLifecycle(agentPubkey, ceps, vault);
 *
 * // Create an intent
 * await createIntent({
 *   description: 'Research 5 AI companies',
 *   budgetSats: 5000,
 *   deadlineTimestamp: Math.floor(Date.now() / 1000) + 3600,
 *   requiredSkills: ['research-v2'],
 * });
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { CepsClient } from '../lib/ceps/ceps-client.js';
import type {
  CreditLifecycleRecord,
  NostrEvent,
} from '../lib/nip-ac/types.js';
import type {
  CreditOffer,
  CreditEnvelope,
  IntentParams,
} from '../lib/nip-ac/client.js';
export type { CreditEnvelope };
import type { CreditLifecycleState } from '../lib/nip-ac/types.js';

/** CreditState is an alias for CreditLifecycleState — exported for component consumers. */
export type CreditState = CreditLifecycleState;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreditLifecycleHookStatus =
  | 'idle'
  | 'loading'
  | 'creating_intent'
  | 'accepting_offer'
  | 'authorizing_spend'
  | 'settling'
  | 'issuing_default'
  | 'success'
  | 'error';

/** Summary of a lifecycle event for display in the UI */
export interface LifecycleEvent {
  id: string;
  type: 'offer' | 'settlement' | 'default' | 'revocation';
  envelopeId: string;
  timestamp: number;
  rawEvent: NostrEvent;
}

export interface UseCreditLifecycleResult {
  /** Active (non-expired) envelopes for this agent */
  activeEnvelopes: CreditEnvelope[];
  /** Pending offers received for published intents */
  pendingOffers: CreditOffer[];
  /** Recent lifecycle events (offers, settlements, defaults) */
  lifecycleEvents: LifecycleEvent[];
  /** Lifecycle records for history display */
  lifecycleRecords: CreditLifecycleRecord[];
  /** Current hook status */
  status: CreditLifecycleHookStatus;
  /** True during any async operation */
  isLoading: boolean;
  /** Error message or null */
  error: string | null;
  /** Create and publish a credit intent */
  createIntent: (params: IntentParams) => Promise<string>;
  /** Accept a provider's offer and create an envelope */
  acceptOffer: (offer: CreditOffer, governorPubkey: string) => Promise<string>;
  /** Authorize a spend within an envelope */
  authorizeSpend: (envelopeId: string, agentPubkey: string, amountSats: number, purpose: string) => Promise<string>;
  /** Settle an envelope after task completion */
  settleEnvelope: (envelopeId: string, agentPubkey: string, governorPubkey: string, score: number, totalSatsSpent: number) => Promise<string>;
  /** Issue a default notice for an expired/abandoned envelope */
  issueDefault: (envelopeId: string, reason: string) => Promise<string>;
  /** Alias for activeEnvelopes — for callers that prefer shorter destructuring */
  envelopes: CreditEnvelope[];
  /** Manually refresh active envelopes from relay */
  refreshEnvelopes: () => Promise<void>;
  /** Clear error state */
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * React hook for NIP-AC credit lifecycle management.
 *
 * @param agentPubkey - Agent's hex pubkey (used for filtering events)
 * @param ceps - Active CEPS client instance
 * @param vault - OPFS Vault instance (for nsec access if needed)
 * @param relayUrl - Relay URL to subscribe on and query from
 * @returns Credit lifecycle state and management actions
 */
export function useCreditLifecycle(
  agentPubkey: string | null,
  ceps: CepsClient | null,
  vault: { loadAgentSigningKey(agentNpub: string): Promise<string> } | null,
  relayUrl?: string
): UseCreditLifecycleResult {
  const [activeEnvelopes, setActiveEnvelopes] = useState<CreditEnvelope[]>([]);
  const [pendingOffers, setPendingOffers] = useState<CreditOffer[]>([]);
  const [lifecycleEvents, setLifecycleEvents] = useState<LifecycleEvent[]>([]);
  const [lifecycleRecords] = useState<CreditLifecycleRecord[]>([]);
  const [status, setStatus] = useState<CreditLifecycleHookStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const managerRef = useRef<import('../lib/nip-ac/client.js').CreditLifecycleManager | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // ---------------------------------------------------------------------------
  // Initialize manager
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!ceps || !vault) return;

    import('../lib/nip-ac/client.js').then(({ CreditLifecycleManager }) => {
      managerRef.current = new CreditLifecycleManager(ceps, vault);
    });
  }, [ceps, vault]);

  // ---------------------------------------------------------------------------
  // Fetch active envelopes
  // ---------------------------------------------------------------------------

  const refreshEnvelopes = useCallback(async () => {
    if (!agentPubkey || !managerRef.current || !relayUrl) return;

    setStatus('loading');
    setError(null);

    try {
      const envelopes = await managerRef.current.getActiveEnvelopes(
        agentPubkey,
        relayUrl
      );
      setActiveEnvelopes(envelopes);
      setStatus('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch envelopes';
      setError(message);
      setStatus('error');
      console.error('[useCreditLifecycle] refreshEnvelopes error:', err);
    }
  }, [agentPubkey, relayUrl]);

  // ---------------------------------------------------------------------------
  // Subscribe to lifecycle events
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!agentPubkey || !relayUrl || !managerRef.current) return;

    let cleanup = false;

    // Short delay to ensure manager is initialized
    const timer = setTimeout(() => {
      if (cleanup || !managerRef.current) return;

      const unsubscribe = managerRef.current.subscribeLifecycle(
        agentPubkey,
        relayUrl,
        (event) => {
          const lifecycleEvent: LifecycleEvent = {
            id: event.rawEvent.id,
            type: event.type,
            envelopeId: event.envelopeId,
            timestamp: event.rawEvent.created_at,
            rawEvent: event.rawEvent,
          };

          setLifecycleEvents((prev) => {
            // Deduplicate by event ID
            if (prev.some((e) => e.id === lifecycleEvent.id)) return prev;
            return [lifecycleEvent, ...prev].slice(0, 100); // Keep last 100 events
          });

          // Handle offer events — add to pending offers list
          if (event.type === 'offer') {
            import('../lib/nip-ac/client.js').then(({ parseCreditOffer }) => {
              try {
                const offer = parseCreditOffer(event.rawEvent);
                setPendingOffers((prev) => {
                  if (prev.some((o) => o.eventId === offer.eventId)) return prev;
                  return [...prev, offer];
                });
              } catch (err) {
                console.warn('[useCreditLifecycle] Failed to parse offer:', err);
              }
            });
          }

          // Handle settlement/default — refresh envelopes to update state
          if (event.type === 'settlement' || event.type === 'default') {
            refreshEnvelopes();
          }
        }
      );

      unsubscribeRef.current = unsubscribe;
    }, 100);

    return () => {
      cleanup = true;
      clearTimeout(timer);
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [agentPubkey, relayUrl, refreshEnvelopes]);

  // ---------------------------------------------------------------------------
  // Initial data load
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (agentPubkey && ceps && relayUrl) {
      // Delay to allow manager initialization
      const timer = setTimeout(refreshEnvelopes, 200);
      return () => clearTimeout(timer);
    }
  }, [agentPubkey, ceps, relayUrl, refreshEnvelopes]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const createIntent = useCallback(
    async (params: IntentParams): Promise<string> => {
      if (!managerRef.current) {
        throw new Error('Credit lifecycle manager is not initialized');
      }

      setStatus('creating_intent');
      setError(null);

      try {
        const eventId = await managerRef.current.createIntent(params);
        setStatus('success');
        return eventId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create credit intent';
        setError(message);
        setStatus('error');
        throw err;
      }
    },
    []
  );

  const acceptOffer = useCallback(
    async (offer: CreditOffer, governorPubkey: string): Promise<string> => {
      if (!managerRef.current) {
        throw new Error('Credit lifecycle manager is not initialized');
      }

      setStatus('accepting_offer');
      setError(null);

      try {
        const eventId = await managerRef.current.acceptOffer(offer, governorPubkey);

        // Remove from pending offers
        setPendingOffers((prev) => prev.filter((o) => o.eventId !== offer.eventId));

        // Refresh envelopes to include the new one
        setTimeout(refreshEnvelopes, 500);

        setStatus('success');
        return eventId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to accept offer';
        setError(message);
        setStatus('error');
        throw err;
      }
    },
    [refreshEnvelopes]
  );

  const authorizeSpend = useCallback(
    async (envelopeId: string, agentPubkey: string, amountSats: number, purpose: string): Promise<string> => {
      if (!managerRef.current) {
        throw new Error('Credit lifecycle manager is not initialized');
      }

      setStatus('authorizing_spend');
      setError(null);

      try {
        const eventId = await managerRef.current.authorizeSpend(
          envelopeId,
          agentPubkey,
          amountSats,
          purpose
        );
        setStatus('success');
        return eventId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to authorize spend';
        setError(message);
        setStatus('error');
        throw err;
      }
    },
    []
  );

  const settleEnvelope = useCallback(
    async (
      envelopeId: string,
      agentPubkey: string,
      governorPubkey: string,
      score: number,
      totalSatsSpent: number
    ): Promise<string> => {
      if (!managerRef.current) {
        throw new Error('Credit lifecycle manager is not initialized');
      }

      setStatus('settling');
      setError(null);

      try {
        const eventId = await managerRef.current.settleEnvelope(
          envelopeId,
          agentPubkey,
          governorPubkey,
          score,
          totalSatsSpent
        );

        // Remove from active envelopes
        setActiveEnvelopes((prev) =>
          prev.filter((e) => e.eventId !== envelopeId)
        );

        setStatus('success');
        return eventId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to settle envelope';
        setError(message);
        setStatus('error');
        throw err;
      }
    },
    []
  );

  const issueDefault = useCallback(
    async (envelopeId: string, reason: string): Promise<string> => {
      if (!managerRef.current) {
        throw new Error('Credit lifecycle manager is not initialized');
      }

      setStatus('issuing_default');
      setError(null);

      try {
        const eventId = await managerRef.current.issueDefault(envelopeId, reason);

        // Remove from active envelopes
        setActiveEnvelopes((prev) =>
          prev.filter((e) => e.eventId !== envelopeId)
        );

        setStatus('success');
        return eventId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to issue default notice';
        setError(message);
        setStatus('error');
        throw err;
      }
    },
    []
  );

  const clearError = useCallback(() => {
    setError(null);
    if (status === 'error') setStatus('idle');
  }, [status]);

  return {
    /** Alias for activeEnvelopes — convenience for destructuring in callers */
    envelopes: activeEnvelopes,
    activeEnvelopes,
    pendingOffers,
    lifecycleEvents,
    lifecycleRecords,
    status,
    isLoading:
      status === 'loading' ||
      status === 'creating_intent' ||
      status === 'accepting_offer' ||
      status === 'authorizing_spend' ||
      status === 'settling' ||
      status === 'issuing_default',
    error,
    createIntent,
    acceptOffer,
    authorizeSpend,
    settleEnvelope,
    issueDefault,
    refreshEnvelopes,
    clearError,
  };
}


