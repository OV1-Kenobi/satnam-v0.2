/**
 * @module hooks/useAgentProfile
 * @description React hook for NIP-SA agent profile management.
 *
 * Provides a complete agent profile lifecycle within a React component:
 * - Building and publishing new agent profiles (kind:39200)
 * - Updating existing profiles (NIP-33 replacement)
 * - Deactivating agents (NIP-09 deletion)
 * - Fetching agent profiles from relay
 * - Publishing agent state and schedule updates
 *
 * All write operations require an active CEPS session with a loaded nsec.
 * The hook handles loading, error, and success states.
 *
 * @example
 * ```tsx
 * const {
 *   profile,
 *   isLoading,
 *   error,
 *   publishProfile,
 *   updateProfile,
 *   deactivate,
 * } = useAgentProfile(agentPubkey);
 *
 * await publishProfile({
 *   name: 'ResearchBot-7',
 *   about: 'Market data researcher',
 *   capabilities: ['research', 'summarization'],
 *   autonomyLevel: 'bounded',
 *   governorPubkey: myPubkey,
 *   enabledSkills: ['research-v2'],
 *   walletPolicy: DEFAULT_SPEND_POLICY,
 *   coordinationRelays: ['wss://pylon.openagents.com'],
 * });
 * ```
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentProfileContent, AgentProfile, AgentWalletPolicy } from '../lib/nip-sa/types.js';
import type { BuildAgentProfileParams } from '../lib/nip-sa/profile-builder.js';
import type { AgentOperationalState } from '../lib/nip-sa/agent-state.js';
import type { CepsClient } from '../lib/ceps/ceps-client.js';
// Re-exports for component consumers
export type { AgentProfile } from '../lib/nip-sa/types.js';
export type { AgentSpendPolicy as SpendPolicy } from '../lib/agent/wallet/spend-policy.js';


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentProfileStatus =
  | 'idle'
  | 'loading'
  | 'publishing'
  | 'updating'
  | 'deactivating'
  | 'success'
  | 'error';

export interface UseAgentProfileResult {
  /** The fetched agent profile, or null if not loaded */
  profile: AgentProfile | null;
  /** Agent's current operational state (from kind:39201 events) */
  agentState: AgentOperationalState | null;
  /** Current status of the hook */
  status: AgentProfileStatus;
  /** True while any async operation is in progress */
  isLoading: boolean;
  /** Error message, or null */
  error: string | null;
  /** Publish a new agent profile */
  publishProfile: (params: BuildAgentProfileParams, signerNsec: string) => Promise<string>;
  /** Update an existing agent profile */
  updateProfile: (updates: Partial<AgentProfileContent>, signerNsec: string) => Promise<string>;
  /** Deactivate (delete) the agent profile */
  deactivate: (signerNsec: string) => Promise<string>;
  /** Publish an agent state update */
  publishState: (state: AgentOperationalState, signerNsec: string) => Promise<string>;
  /** Refetch the profile from relay */
  refetch: () => Promise<void>;
  /** Reset error state */
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * React hook for managing an agent's NIP-SA profile lifecycle.
 *
 * @param agentPubkey - Agent's hex pubkey to load profile for (optional)
 * @param ceps - Active CEPS client instance
 * @param relayUrl - Relay URL to query for profile events
 * @returns AgentProfile state and management actions
 */
export function useAgentProfile(
  agentPubkey: string | null,
  ceps: CepsClient | null,
  relayUrl?: string
): UseAgentProfileResult {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [agentState, setAgentState] = useState<AgentOperationalState | null>(null);
  const [status, setStatus] = useState<AgentProfileStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const unsubscribeRef = useRef<(() => void) | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch profile from relay
  // ---------------------------------------------------------------------------

  const fetchProfile = useCallback(async () => {
    if (!agentPubkey || !ceps) return;

    setStatus('loading');
    setError(null);

    try {
      const events = await ceps.list(
        [
          {
            kinds: [39200],
            authors: [agentPubkey],
            '#d': ['profile'],
            limit: 1,
          },
        ],
        relayUrl ? [relayUrl] : undefined,
        { eoseTimeout: 5000 }
      );

      if (!events || events.length === 0) {
        setProfile(null);
        setStatus('idle');
        return;
      }

      const event = events[0] as any;
      let content: AgentProfileContent;
      try {
        content = JSON.parse(event.content);
      } catch {
        throw new Error('Failed to parse agent profile content');
      }

      // Extract tags
      const getTag = (name: string): string | undefined =>
        event.tags.find((t: string[]) => t[0] === name)?.[1];

      const getTagAll = (name: string): string[] =>
        event.tags
          .filter((t: string[]) => t[0] === name)
          .map((t: string[]) => t[1])
          .filter(Boolean);

      const enabledSkillsTag = event.tags.find(
        (t: string[]) => t[0] === 'enabled_skills'
      );
      const coordination_relays = getTagAll('coordination_relay');

      const walletPolicyRaw = getTag('wallet_policy');
      let walletPolicy: AgentWalletPolicy | undefined;
      if (walletPolicyRaw) {
        try {
          walletPolicy = JSON.parse(walletPolicyRaw);
        } catch {
          console.warn('[useAgentProfile] Failed to parse wallet_policy tag');
        }
      }

      const agentProfile: AgentProfile = {
        pubkey: agentPubkey,
        eventId: event.id,
        content,
        tags: {
          d: getTag('d') || 'profile',
          threshold: (() => {
            const t = event.tags.find((tag: string[]) => tag[0] === 'threshold');
            return t ? ([t[1], t[2]] as [string, string]) : undefined;
          })(),
          operator: getTag('operator'),
          signer: getTag('signer'),
          lud16: getTag('lud16'),
          nip05: getTag('nip05'),
          enabled_skills: enabledSkillsTag ? enabledSkillsTag.slice(1) : [],
          wallet_policy: walletPolicyRaw,
          coordination_relays,
        },
        createdAt: event.created_at,
        walletPolicy: walletPolicy as AgentWalletPolicy,
        nip05: getTag('nip05'),
        lud16: getTag('lud16'),
      };

      setProfile(agentProfile);
      setStatus('success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch agent profile';
      setError(message);
      setStatus('error');
      console.error('[useAgentProfile] fetchProfile error:', err);
    }
  }, [agentPubkey, ceps, relayUrl]);

  // ---------------------------------------------------------------------------
  // Subscribe to agent state updates
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!agentPubkey || !relayUrl) return;

    // Lazy import to avoid SSR issues
    let cleanup = false;
    import('../lib/nip-sa/agent-state.js').then(({ subscribeAgentState }) => {
      if (cleanup) return;

      const unsubscribe = subscribeAgentState(
        agentPubkey,
        relayUrl,
        (state) => {
          setAgentState(state);
        }
      );

      unsubscribeRef.current = unsubscribe;
    });

    return () => {
      cleanup = true;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [agentPubkey, relayUrl]);

  // ---------------------------------------------------------------------------
  // Initial fetch
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (agentPubkey && ceps) {
      fetchProfile();
    }
  }, [agentPubkey, ceps, fetchProfile]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const publishProfile = useCallback(
    async (params: BuildAgentProfileParams, signerNsec: string): Promise<string> => {
      if (!ceps) throw new Error('CEPS client is not initialized');

      setStatus('publishing');
      setError(null);

      try {
        const { buildAgentProfile, publishAgentProfile } = await import(
          '../lib/nip-sa/profile-builder.js'
        );
        const unsigned = buildAgentProfile(params);
        const eventId = await publishAgentProfile(unsigned, signerNsec, ceps);
        setStatus('success');
        // Refetch after publish
        await fetchProfile();
        return eventId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to publish agent profile';
        setError(message);
        setStatus('error');
        throw err;
      }
    },
    [ceps, fetchProfile]
  );

  const updateProfile = useCallback(
    async (updates: Partial<AgentProfileContent>, signerNsec: string): Promise<string> => {
      if (!ceps) throw new Error('CEPS client is not initialized');
      if (!profile) throw new Error('No existing profile to update');

      setStatus('updating');
      setError(null);

      try {
        const { updateAgentProfile } = await import('../lib/nip-sa/profile-builder.js');
        const eventId = await updateAgentProfile(
          profile.eventId,
          updates,
          signerNsec,
          ceps
        );
        setStatus('success');
        await fetchProfile();
        return eventId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update agent profile';
        setError(message);
        setStatus('error');
        throw err;
      }
    },
    [ceps, profile, fetchProfile]
  );

  const deactivate = useCallback(
    async (signerNsec: string): Promise<string> => {
      if (!ceps) throw new Error('CEPS client is not initialized');
      if (!profile) throw new Error('No profile to deactivate');

      setStatus('deactivating');
      setError(null);

      try {
        const { deactivateAgent } = await import('../lib/nip-sa/profile-builder.js');
        const eventId = await deactivateAgent(profile.eventId, signerNsec, ceps);
        setProfile(null);
        setStatus('success');
        return eventId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to deactivate agent';
        setError(message);
        setStatus('error');
        throw err;
      }
    },
    [ceps, profile]
  );

  const publishState = useCallback(
    async (state: AgentOperationalState, signerNsec: string): Promise<string> => {
      if (!ceps) throw new Error('CEPS client is not initialized');
      if (!agentPubkey) throw new Error('No agent pubkey set');
      if (!profile?.tags.operator) throw new Error('No governor pubkey in profile');

      try {
        const { publishAgentState } = await import('../lib/nip-sa/agent-state.js');
        const eventId = await publishAgentState({
          agentPubkey,
          state,
          signerNsec,
          governorPubkey: profile.tags.operator,
          ceps,
        });
        setAgentState(state);
        return eventId;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to publish agent state';
        setError(message);
        throw err;
      }
    },
    [ceps, agentPubkey, profile]
  );

  const clearError = useCallback(() => {
    setError(null);
    if (status === 'error') setStatus('idle');
  }, [status]);

  return {
    profile,
    agentState,
    status,
    isLoading: status === 'loading' || status === 'publishing' || status === 'updating' || status === 'deactivating',
    error,
    publishProfile,
    updateProfile,
    deactivate,
    publishState,
    refetch: fetchProfile,
    clearError,
  };
}
