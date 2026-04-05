/**
 * @module hooks/useSpacetimeBridge
 * @description React hook for the SpacetimeDB bridge state.
 *
 * Provides:
 * - `presenceStatus` — current published presence status
 * - `computeAssignments` — list of compute assignments from SpacetimeDB
 * - `syncCheckpoints` — recent sync checkpoints from SpacetimeDB
 * - `heartbeatActive` — whether the heartbeat interval is running
 * - `publishPresence(status, agentPubkey?)` — update presence
 * - `startHeartbeat(agentPubkey, intervalMs?)` — start heartbeat
 * - `stopHeartbeat()` — stop heartbeat
 * - `isLoading` — true while an async operation is in progress
 * - `error` — last error, if any
 *
 * ## Usage
 *
 * ```tsx
 * const bridge = new SpacetimeBridge(pylonCepsClient, vault);
 *
 * const {
 *   presenceStatus,
 *   computeAssignments,
 *   heartbeatActive,
 *   publishPresence,
 *   startHeartbeat,
 * } = useSpacetimeBridge(bridge);
 *
 * // Go online
 * await publishPresence('online', agentPubkey);
 *
 * // Start 30-second heartbeat
 * startHeartbeat(agentPubkey, 30_000);
 * ```
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { SpacetimeBridge } from '../lib/bridge/spacetime-bridge.js';
import type {
  ComputeAssignment,
  SyncCheckpoint,
  PresenceStatus,
} from '../lib/bridge/spacetime-bridge.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default heartbeat interval in milliseconds (30 seconds). */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

/** Maximum number of compute assignments to retain in state. */
const MAX_COMPUTE_ASSIGNMENTS = 100;

/** Maximum number of sync checkpoints to retain in state. */
const MAX_SYNC_CHECKPOINTS = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Public state and actions exposed by useSpacetimeBridge(). */
export interface SpacetimeBridgeState {
  /** Current published presence status (reflects last successful publishPresence call). */
  presenceStatus: PresenceStatus;

  /** Compute assignments received from SpacetimeDB via Pylon. */
  computeAssignments: ComputeAssignment[];

  /** Sync checkpoints received from SpacetimeDB via Pylon. */
  syncCheckpoints: SyncCheckpoint[];

  /** Whether the periodic heartbeat interval is currently active. */
  heartbeatActive: boolean;

  /** Whether an async operation is in progress. */
  isLoading: boolean;

  /** Last error message, if any. Cleared on the next successful operation. */
  error: string | null;

  /**
   * Publish a presence status update.
   *
   * @param status - New presence status
   * @param agentPubkey - Optional agent pubkey to include in the event
   */
  publishPresence: (status: PresenceStatus, agentPubkey?: string) => Promise<void>;

  /**
   * Start the periodic heartbeat for an agent.
   *
   * @param agentPubkey - Hex pubkey of the agent
   * @param intervalMs - Heartbeat interval in ms (default 30s, minimum 10s)
   */
  startHeartbeat: (agentPubkey: string, intervalMs?: number) => void;

  /** Stop the active heartbeat interval. */
  stopHeartbeat: () => void;

  /**
   * Subscribe to compute assignments for a pubkey.
   * Sets up a live subscription and returns an unsubscribe function.
   *
   * @param pubkey - Hex pubkey to receive assignments for
   */
  subscribeComputeAssignments: (pubkey: string) => () => void;

  /**
   * Subscribe to sync checkpoints for an agent.
   *
   * @param agentPubkey - Hex pubkey of the agent
   */
  subscribeSyncCheckpoints: (agentPubkey: string) => () => void;

  /** Clear all received compute assignments from local state. */
  clearComputeAssignments: () => void;
}

// ---------------------------------------------------------------------------
// useSpacetimeBridge
// ---------------------------------------------------------------------------

/**
 * React hook for the SpacetimeDB bridge.
 *
 * @param bridge - SpacetimeBridge instance (memoized — do not recreate on every render)
 * @returns SpacetimeBridgeState
 */
export function useSpacetimeBridge(bridge: SpacetimeBridge): SpacetimeBridgeState {
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>('offline');
  const [computeAssignments, setComputeAssignments] = useState<ComputeAssignment[]>([]);
  const [syncCheckpoints, setSyncCheckpoints] = useState<SyncCheckpoint[]>([]);
  const [heartbeatActive, setHeartbeatActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable bridge ref
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;

  // Stop function ref — updated when startHeartbeat is called
  const stopHeartbeatRef = useRef<(() => void) | null>(null);

  // ── Presence ───────────────────────────────────────────────────────────────

  const publishPresence = useCallback(
    async (status: PresenceStatus, agentPubkey?: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        await bridgeRef.current.publishPresence({ status, agentPubkey });
        setPresenceStatus(status);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // ── Heartbeat ──────────────────────────────────────────────────────────────

  const startHeartbeat = useCallback(
    (agentPubkey: string, intervalMs: number = DEFAULT_HEARTBEAT_INTERVAL_MS): void => {
      // Stop any existing heartbeat first
      if (stopHeartbeatRef.current !== null) {
        stopHeartbeatRef.current();
        stopHeartbeatRef.current = null;
      }

      const stop = bridgeRef.current.startHeartbeatInterval(agentPubkey, intervalMs);
      stopHeartbeatRef.current = stop;
      setHeartbeatActive(true);
    },
    []
  );

  const stopHeartbeat = useCallback((): void => {
    if (stopHeartbeatRef.current !== null) {
      stopHeartbeatRef.current();
      stopHeartbeatRef.current = null;
    }
    bridgeRef.current.stopHeartbeatInterval();
    setHeartbeatActive(false);
  }, []);

  // ── Compute Assignments ────────────────────────────────────────────────────

  const subscribeComputeAssignments = useCallback(
    (pubkey: string): (() => void) => {
      return bridgeRef.current.subscribeComputeAssignments(
        pubkey,
        (assignment: ComputeAssignment) => {
          setComputeAssignments((prev) => {
            // Deduplicate by envelopeEventId
            if (prev.some((a) => a.envelopeEventId === assignment.envelopeEventId)) {
              return prev;
            }
            const updated = [assignment, ...prev];
            // Cap the list size
            return updated.slice(0, MAX_COMPUTE_ASSIGNMENTS);
          });
        }
      );
    },
    []
  );

  // ── Sync Checkpoints ───────────────────────────────────────────────────────

  const subscribeSyncCheckpoints = useCallback(
    (agentPubkey: string): (() => void) => {
      return bridgeRef.current.subscribeSyncCheckpoints(
        agentPubkey,
        (checkpoint: SyncCheckpoint) => {
          setSyncCheckpoints((prev) => {
            // Deduplicate by sessionId + checkpoint
            const key = `${checkpoint.sessionId}:${checkpoint.checkpoint}`;
            if (prev.some((c) => `${c.sessionId}:${c.checkpoint}` === key)) {
              return prev;
            }
            const updated = [checkpoint, ...prev];
            return updated.slice(0, MAX_SYNC_CHECKPOINTS);
          });
        }
      );
    },
    []
  );

  // ── Clear ──────────────────────────────────────────────────────────────────

  const clearComputeAssignments = useCallback((): void => {
    setComputeAssignments([]);
  }, []);

  // ── Sync presenceStatus from bridge ───────────────────────────────────────

  useEffect(() => {
    // Sync the bridge's internal presence status to React state
    setPresenceStatus(bridgeRef.current.presenceStatus);
  }, []);

  // Sync heartbeat active status from bridge
  useEffect(() => {
    const syncStatus = () => {
      setHeartbeatActive(bridgeRef.current.isHeartbeatActive);
    };
    const interval = setInterval(syncStatus, 1_000);
    return () => clearInterval(interval);
  }, []);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      // Do not stop heartbeat on unmount — it should persist across re-renders.
      // The caller must explicitly call stopHeartbeat().
    };
  }, []);

  return {
    presenceStatus,
    computeAssignments,
    syncCheckpoints,
    heartbeatActive,
    isLoading,
    error,
    publishPresence,
    startHeartbeat,
    stopHeartbeat,
    subscribeComputeAssignments,
    subscribeSyncCheckpoints,
    clearComputeAssignments,
  };
}
