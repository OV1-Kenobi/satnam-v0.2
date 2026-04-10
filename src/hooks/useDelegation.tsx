/**
 * @hook useDelegation
 * @description React hook wrapping DelegationGraph for use in components.
 *
 * Provides:
 * - Local delegation graph with React state integration
 * - Role resolution for the current user
 * - Delegation CRUD operations (add, revoke)
 * - Relay sync with loading/error states
 * - Persistence to vault
 *
 * @example
 * ```tsx
 * const { graph, role, addDelegation, syncFromRelay, isLoading } = useDelegation({
 *   guardianPubkey: '...',
 *   vault,
 * });
 * ```
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';

import { DelegationGraph } from '../lib/nip26/graph.js';
import { RoleType } from '../lib/nip26/types.js';
import type { DelegationEvent } from '../lib/nip26/types.js';
import type { VaultOps } from '../lib/vault/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseDelegationOptions {
  /** Hex pubkey of the root Guardian */
  guardianPubkey?: string;
  /** Hex pubkey of the current user */
  currentUserPubkey?: string;
  /** Vault instance for persistence */
  vault?: VaultOps;
  /** Auto-load graph from vault on mount (default: true) */
  autoLoad?: boolean;
}

interface UseDelegationReturn {
  /** The delegation graph instance */
  graph: DelegationGraph;
  /** Role of the current user (null if not in graph) */
  currentRole: RoleType | null;
  /**
   * Ordered delegation chain (Guardian → Agent members).
   * Null when the graph has no members yet.
   */
  delegationChain: Array<{ pubkey: string; role: RoleType }> | null;
  /** All members reachable from the Guardian */
  groupMembers: Array<{ pubkey: string; role: RoleType }>;
  /** Unix timestamp (ms) of the last successful sync; null if never synced */
  lastUpdated: number | null;
  /** Trigger manual refresh — reloads graph from vault */
  refresh: () => void;
  /** Add a delegation event to the graph */
  addDelegation: (event: DelegationEvent) => void;
  /** Revoke a delegation */
  revokeDelegation: (delegatorPubkey: string, delegateePubkey: string) => void;
  /** Get role of any pubkey */
  getRole: (pubkey: string) => RoleType | null;
  /** Check capability for any pubkey */
  hasCapability: (pubkey: string, capability: string) => boolean;
  /** Verify chain for any pubkey at current time */
  verifyChain: (pubkey: string) => boolean;
  /** Sync from Nostr relay */
  syncFromRelay: (relayUrl: string, pubkeys?: string[]) => Promise<void>;
  /** Persist graph to vault */
  persist: () => Promise<void>;
  /** Load graph from vault */
  load: () => Promise<void>;
  /** Whether sync/load is in progress */
  isLoading: boolean;
  /** Last sync error */
  error: string | null;
  /** Number of delegations in the graph */
  delegationCount: number;
}

// ---------------------------------------------------------------------------
// Context (optional — for app-wide delegation graph)
// ---------------------------------------------------------------------------

interface DelegationContextValue {
  graph: DelegationGraph;
  currentRole: RoleType | null;
}

const DelegationContext = createContext<DelegationContextValue | null>(null);

export function DelegationProvider({
  children,
  graph,
  currentRole,
}: {
  children: ReactNode;
  graph: DelegationGraph;
  currentRole: RoleType | null;
}) {
  return (
    <DelegationContext.Provider value={{ graph, currentRole }}>
      {children}
    </DelegationContext.Provider>
  );
}

export function useDelegationContext(): DelegationContextValue {
  const ctx = useContext(DelegationContext);
  if (!ctx) {
    throw new Error('useDelegationContext must be used within a DelegationProvider');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

export function useDelegation(options: UseDelegationOptions = {}): UseDelegationReturn {
  const {
    guardianPubkey,
    currentUserPubkey,
    vault,
    autoLoad = true,
  } = options;

  // Stable graph instance
  const graphRef = useRef<DelegationGraph>(new DelegationGraph());
  const graph = graphRef.current;

  // State for triggering re-renders on graph mutations
  const [version, setVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // Register guardian on config change
  useEffect(() => {
    if (guardianPubkey) {
      graph.addGuardian(guardianPubkey);
      setVersion(v => v + 1);
    }
  }, [guardianPubkey]);

  // Auto-load from vault on mount
  useEffect(() => {
    if (autoLoad && vault) {
      load();
    }
  }, [autoLoad, vault]);

  // ── Mutations ────────────────────────────────────────────────────────────

  const addDelegation = useCallback((event: DelegationEvent) => {
    graph.addDelegation(event);
    setVersion(v => v + 1);
  }, []);

  const revokeDelegation = useCallback((delegatorPubkey: string, delegateePubkey: string) => {
    graph.revokeDelegation(delegatorPubkey, delegateePubkey);
    setVersion(v => v + 1);
  }, []);

  // ── Queries ──────────────────────────────────────────────────────────────

  const getRole = useCallback((pubkey: string) => {
    return graph.getRole(pubkey);
  }, [version]);

  const hasCapability = useCallback((pubkey: string, capability: string) => {
    return graph.hasCapability(pubkey, capability);
  }, [version]);

  const verifyChain = useCallback((pubkey: string) => {
    return graph.verifyChainAt(pubkey, Math.floor(Date.now() / 1000));
  }, [version]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const currentRole = currentUserPubkey
    ? graph.getRole(currentUserPubkey)
    : null;

  const groupMembers = guardianPubkey
    ? graph.getGroupMembers(guardianPubkey)
    : [];

  const delegationCount = graph.size;

  // ── Async operations ──────────────────────────────────────────────────────

  const syncFromRelay = useCallback(async (relayUrl: string, pubkeys?: string[]) => {
    setIsLoading(true);
    setError(null);
    try {
      const syncPubkeys = pubkeys ?? (guardianPubkey ? [guardianPubkey] : []);
      if (syncPubkeys.length > 0) {
        await graph.syncFromRelay(relayUrl, syncPubkeys);
        setVersion(v => v + 1);
        setLastUpdated(Date.now());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setIsLoading(false);
    }
  }, [guardianPubkey]);

  const persist = useCallback(async () => {
    if (!vault) {
      console.warn('[useDelegation] No vault provided — cannot persist');
      return;
    }
    setIsLoading(true);
    try {
      await graph.persist(vault);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Persist failed');
    } finally {
      setIsLoading(false);
    }
  }, [vault]);

  const load = useCallback(async () => {
    if (!vault) {
      console.warn('[useDelegation] No vault provided — cannot load');
      return;
    }
    setIsLoading(true);
    try {
      await graph.load(vault);
      if (guardianPubkey) graph.addGuardian(guardianPubkey);
      setVersion(v => v + 1);
    } catch (err) {
      // Non-fatal — graph starts empty
      console.debug('[useDelegation] Load failed (likely first run):', err);
    } finally {
      setIsLoading(false);
    }
  }, [vault, guardianPubkey]);

  const delegationChain = groupMembers.length > 0 ? groupMembers : null;

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return {
    graph,
    currentRole,
    delegationChain,
    groupMembers,
    lastUpdated,
    refresh,
    addDelegation,
    revokeDelegation,
    getRole,
    hasCapability,
    verifyChain,
    syncFromRelay,
    persist,
    load,
    isLoading,
    error,
    delegationCount,
  };
}

export default useDelegation;


