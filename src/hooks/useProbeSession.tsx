/**
 * @module hooks/useProbeSession
 * @description React hook for monitoring and interacting with Probe agent sessions.
 *
 * Provides:
 * - `sessions` — list of known TrajectorySession objects for the agent
 * - `activeSession` — the most recently active session (or null)
 * - `trajectory` — ordered list of TrajectoryEvent objects for the active session
 * - `subscribeSession(agentPubkey)` — start monitoring an agent
 * - `respondToToolCall(params)` — approve or reject a pending tool call
 * - `pendingApprovals` — tool calls awaiting user approval
 * - `isLoading` — true while fetching initial session data
 * - `error` — last error, if any
 *
 * ## Usage
 *
 * ```tsx
 * const {
 *   sessions,
 *   activeSession,
 *   trajectory,
 *   pendingApprovals,
 *   subscribeSession,
 *   respondToToolCall,
 * } = useProbeSession(probeSessionClient);
 *
 * // Subscribe to a Probe agent
 * useEffect(() => {
 *   const unsub = subscribeSession(agentPubkey);
 *   return unsub;
 * }, [agentPubkey]);
 *
 * // Approve a tool call
 * await respondToToolCall({
 *   callId: pendingApprovals[0].data.callId,
 *   approved: true,
 *   sessionId: activeSession.sessionId,
 *   agentPubkey,
 *   signerNsec,
 * });
 * ```
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ProbeSessionClient } from '../lib/probe/session-client.js';
import type {
  TrajectoryEvent,
  TrajectorySession,
  ToolCallData,
  SubscribeSessionOptions,
} from '../lib/probe/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters for respondToToolCall. */
export interface RespondToToolCallParams {
  callId: string;
  approved: boolean;
  sessionId: string;
  agentPubkey: string;
  signerNsec: string;
  modifiedParameters?: Record<string, unknown>;
}

/** Public state and actions exposed by useProbeSession(). */
export interface ProbeSessionState {
  /**
   * All known trajectory sessions for the subscribed agent.
   * Populated from initial fetch + live subscription updates.
   */
  sessions: TrajectorySession[];

  /**
   * The most recently active session, or null if none.
   */
  activeSession: TrajectorySession | null;

  /**
   * Ordered list of trajectory events for the active session.
   */
  trajectory: TrajectoryEvent[];

  /**
   * Tool call events that are awaiting user approval.
   * Filtered from trajectory — only unresolved tool calls with requiresApproval = true.
   */
  pendingApprovals: TrajectoryEvent[];

  /** Whether the initial session data is being fetched. */
  isLoading: boolean;

  /** Last error message, if any. */
  error: string | null;

  /**
   * Subscribe to live trajectory events for a Probe agent.
   *
   * @param agentPubkey - Hex pubkey of the agent to monitor
   * @param options - Optional filter options (since, until, limit)
   * @returns Unsubscribe function
   */
  subscribeSession: (
    agentPubkey: string,
    options?: SubscribeSessionOptions
  ) => () => void;

  /**
   * Publish a tool call approval or rejection.
   *
   * @param params - Approval parameters
   * @returns Published event ID
   */
  respondToToolCall: (params: RespondToToolCallParams) => Promise<string>;

  /**
   * Manually refresh session data for the current agent.
   */
  refresh: (agentPubkey: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// useProbeSession
// ---------------------------------------------------------------------------

/**
 * React hook for monitoring and interacting with Probe agent sessions.
 *
 * @param client - ProbeSessionClient instance (memoized — do not recreate on every render)
 * @returns ProbeSessionState
 */
export function useProbeSession(client?: ProbeSessionClient | null): ProbeSessionState {
  const [sessions, setSessions] = useState<TrajectorySession[]>([]);
  const [trajectory, setTrajectory] = useState<TrajectoryEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track approved/rejected call IDs to filter pendingApprovals
  const resolvedCallIds = useRef<Set<string>>(new Set());

  // Stable client ref
  const clientRef = useRef(client);
  clientRef.current = client ?? null;

  // ── Derived state ──────────────────────────────────────────────────────────

  const activeSession = sessions.find((s) => s.status === 'active') ?? sessions[0] ?? null;

  // Filter trajectory to unresolved tool calls requiring approval
  const pendingApprovals = trajectory.filter(
    (event): event is TrajectoryEvent & { data: ToolCallData } => {
      if (event.eventType !== 'tool_call') return false;
      const data = event.data as ToolCallData;
      return (
        data.requiresApproval === true &&
        !resolvedCallIds.current.has(data.callId)
      );
    }
  );

  // ── Subscribe ──────────────────────────────────────────────────────────────

  const subscribeSession = useCallback(
    (agentPubkey: string, options: SubscribeSessionOptions = {}): () => void => {
      // Clear stale data on new subscription
      setTrajectory([]);
      setError(null);

      const unsub = clientRef.current.subscribeAll(
        agentPubkey,
        // Trajectory event handler
        (event: TrajectoryEvent) => {
          setTrajectory((prev) => {
            // Deduplicate by timestamp + eventType + sessionId
            const key = `${event.sessionId}:${event.timestamp}:${event.eventType}`;
            const exists = prev.some(
              (e) =>
                `${e.sessionId}:${e.timestamp}:${e.eventType}` === key
            );
            if (exists) return prev;
            // Insert in chronological order
            const updated = [...prev, event].sort(
              (a, b) => a.timestamp - b.timestamp
            );
            return updated;
          });
        },
        // Session event handler
        (session: TrajectorySession) => {
          setSessions((prev) => {
            const idx = prev.findIndex(
              (s) => s.sessionId === session.sessionId
            );
            if (idx === -1) {
              return [...prev, session];
            }
            const updated = [...prev];
            updated[idx] = session;
            return updated;
          });
        },
        options
      );

      return unsub;
    },
    []
  );

  // ── Respond to Tool Call ───────────────────────────────────────────────────

  const respondToToolCall = useCallback(
    async (params: RespondToToolCallParams): Promise<string> => {
      const eventId = await clientRef.current.respondToToolCall(params);

      // Mark the call as resolved so it disappears from pendingApprovals
      resolvedCallIds.current.add(params.callId);

      // Force re-render by updating trajectory (no-op content change)
      setTrajectory((prev) => [...prev]);

      return eventId;
    },
    []
  );

  // ── Refresh ────────────────────────────────────────────────────────────────

  const refresh = useCallback(async (agentPubkey: string): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const activeSessions = await clientRef.current.getActiveSessions(agentPubkey);
      setSessions(activeSessions);

      // If there's an active session, fetch its trajectory
      const active = activeSessions.find((s) => s.status === 'active');
      if (active) {
        const events = await clientRef.current.getSessionTrajectory(
          active.sessionId,
          agentPubkey
        );
        setTrajectory(events);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    sessions,
    activeSession,
    trajectory,
    pendingApprovals,
    isLoading,
    error,
    subscribeSession,
    respondToToolCall,
    refresh,
  };
}

