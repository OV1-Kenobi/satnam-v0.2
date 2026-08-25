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
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentProfileContent, AgentProfile, AgentWalletPolicy } from '../lib/nip-sa/types.js';
import type { BuildAgentProfileParams } from '../lib/nip-sa/profile-builder.js';
import type { AgentOperationalState } from '../lib/nip-sa/agent-state.js';
import type { CepsClient } from '../lib/ceps/ceps-client.js';
import { getDefaultRelays } from '../lib/ceps/ceps-client.js';
import type { AgentSpendPolicy } from '../lib/agent/wallet/spend-policy.js';

// Re-exports for component consumers
export type { AgentProfile } from '../lib/nip-sa/types.js';
export type { AgentSpendPolicy as SpendPolicy } from '../lib/agent/wallet/spend-policy.js';

// ---------------------------------------------------------------------------
// AgentViewModel — flat view model used by all UI components
// ---------------------------------------------------------------------------

/**
 * Flat view model for rendering agent cards, detail panels, and monitoring.
 * Derived from AgentProfile + AgentOperationalState at the hook layer.
 * Components should accept AgentViewModel instead of the raw AgentProfile.
 */
export interface AgentViewModel {
  /** Stable UI identifier (same as pubkey). */
  id: string;
  /** Agent's Nostr pubkey (hex). */
  pubkey: string;
  /** Agent display name. */
  name: string;
  /** Agent description. */
  about: string;
  /** Avatar URL (optional). */
  picture?: string;
  /** Operational status. */
  status: 'idle' | 'working' | 'paused' | 'error' | 'terminated';
  /** Autonomy level. */
  autonomy: 'bounded' | 'supervised' | 'autonomous';
  /** Enabled capability keys. */
  capabilities: string[];
  /** Enabled skill scope IDs. */
  skills: string[];
  /** Current wallet balance in sats (0 if not connected). */
  balanceSats: number;
  /** Sats spent today (rolling 24h). */
  dailySpendSats: number;
  /** Last heartbeat Unix timestamp (seconds). */
  lastHeartbeat?: number;
  /** Agent's spend policy. */
  spendPolicy: AgentSpendPolicy;
  /** Profile creation timestamp (Unix seconds). */
  createdAt: number;
  /** Coordination relay URLs. */
  relays: string[];
  /** Recent error messages. */
  errorLog?: string[];
  /** Governor pubkey (hex). */
  governorPubkey?: string;
  /** Group signing pubkey (hex). */
  groupPubkey?: string;
}

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
  /** All agents as flat view models */
  agents: AgentViewModel[];
  /** Agent's current operational state (from kind:39201 events) */
  agentState: AgentOperationalState | null;
  /** Current status of the hook */
  status: AgentProfileStatus;
  /** True while any async operation is in progress */
  isLoading: boolean;
  /** Error message, or null */
  error: string | null;
  /** Publish a new agent profile (returns event ID). Agent nsec is read from the vault. */
  publishProfile: (params: BuildAgentProfileParams, agentNpub: string) => Promise<string>;
  /** Create a new agent — generates a fresh agent keypair in the vault, then publishes the profile. Returns the agent npub. */
  createAgent: (params: BuildAgentProfileParams) => Promise<string>;
  /** Update an existing agent profile (agent nsec read from vault) */
  updateProfile: (updates: Partial<AgentProfileContent>, agentNpub: string) => Promise<string>;
  /** Update agent by ID (for status/partial updates from UI) */
  updateAgent: (id: string, updates: Partial<AgentViewModel>) => Promise<void>;
  /** Deactivate (delete) the agent profile (agent nsec read from vault) */
  deactivate: (agentNpub: string) => Promise<string>;
  /** Deactivate agent by ID */
  deactivateAgent: (id: string) => Promise<void>;
  /** Publish an agent state update */
  publishState: (state: AgentOperationalState, signerNsec: string) => Promise<string>;
  /** Refetch the profile from relay */
  refetch: () => Promise<void>;
  /** Reset error state */
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Default spend policy (used when no policy is set)
// ---------------------------------------------------------------------------

function defaultSpendPolicy(): AgentSpendPolicy {
  return {
    max_single_spend_msats: 10_000_000n,
    daily_limit_msats: 100_000_000_000n,
    requires_approval_above_msats: 1_000_000n,
    preferred_spend_rail: 'auto',
    allowed_mints: [],
    sweep_threshold_msats: 500_000_000_000n,
    sweep_destination: '',
    sweep_rail: 'cashu',
  };
}

// ---------------------------------------------------------------------------
// Convert AgentProfile → AgentViewModel
// ---------------------------------------------------------------------------

function profileToViewModel(profile: AgentProfile): AgentViewModel {
  let policy: AgentSpendPolicy;
  try {
    const walletPolicyRaw = profile.tags.wallet_policy;
    if (walletPolicyRaw) {
      const raw = JSON.parse(walletPolicyRaw) as Record<string, unknown>;
      policy = {
        max_single_spend_msats: BigInt(String(raw.max_single_spend_msats ?? '10000000')),
        daily_limit_msats: BigInt(String(raw.daily_limit_msats ?? '100000000000')),
        requires_approval_above_msats: BigInt(String(raw.requires_approval_above_msats ?? '1000000')),
        preferred_spend_rail: (raw.preferred_spend_rail as AgentSpendPolicy['preferred_spend_rail']) ?? 'auto',
        allowed_mints: Array.isArray(raw.allowed_mints) ? raw.allowed_mints as string[] : [],
        sweep_threshold_msats: BigInt(String(raw.sweep_threshold_msats ?? '500000000000')),
        sweep_destination: String(raw.sweep_destination ?? ''),
        sweep_rail: (raw.sweep_rail as AgentSpendPolicy['sweep_rail']) ?? 'cashu',
      };
    } else {
      policy = defaultSpendPolicy();
    }
  } catch {
    policy = defaultSpendPolicy();
  }

  return {
    id: profile.pubkey,
    pubkey: profile.pubkey,
    name: profile.content.name,
    about: profile.content.about,
    picture: profile.content.picture,
    status: 'idle',
    autonomy: profile.content.autonomy_level,
    capabilities: profile.content.capabilities,
    skills: profile.tags.enabled_skills ?? [],
    balanceSats: 0,
    dailySpendSats: 0,
    lastHeartbeat: undefined,
    spendPolicy: policy,
    createdAt: profile.createdAt,
    relays: profile.tags.coordination_relays ?? [],
    errorLog: [],
    governorPubkey: profile.tags.operator,
    groupPubkey: profile.tags.signer,
  };
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
  agentPubkey?: string | null,
  ceps?: CepsClient | null,
  relayUrl?: string
): UseAgentProfileResult {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [agents, setAgents] = useState<AgentViewModel[]>([]);
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
        {
          kinds: [39200],
          authors: [agentPubkey],
          '#d': ['profile'],
          limit: 1,
        },
        relayUrl ? [relayUrl] : getDefaultRelays(),
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
      setAgents([profileToViewModel(agentProfile)]);
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

    let cleanup = false;
    import('../lib/nip-sa/agent-state.js').then(({ subscribeAgentState }) => {
      if (cleanup) return;

      const unsubscribe = subscribeAgentState(
        agentPubkey,
        relayUrl,
        (state) => {
          setAgentState(state);
          // Update status in agents view model
          setAgents(prev => prev.map(a =>
            a.pubkey === agentPubkey
              ? { ...a, status: state.status as AgentViewModel['status'], lastHeartbeat: state.lastHeartbeat }
              : a
          ));
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
    async (params: BuildAgentProfileParams, agentNpub: string): Promise<string> => {
      if (!ceps) throw new Error('CEPS client is not initialized');

      setStatus('publishing');
      setError(null);

      try {
        const { buildAgentProfile, publishAgentProfile } = await import(
          '../lib/nip-sa/profile-builder.js'
        );
        const unsigned = buildAgentProfile(params);
        const eventId = await publishAgentProfile(unsigned, agentNpub, ceps);
        setStatus('success');
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

  const createAgent = useCallback(
    async (params: BuildAgentProfileParams): Promise<string> => {
      if (!ceps) throw new Error('CEPS client is not initialized');

      setStatus('publishing');
      setError(null);

      try {
        // Generate a fresh agent keypair and store it in the vault.
        // The nsec never leaves the vault in plaintext after this point.
        const { generateSecretKey, getPublicKey, nip19 } = await import('nostr-tools');
        const { getVault } = await import('../lib/vault/vault.js');

        const agentSecret = generateSecretKey();
        const agentNpub = nip19.npubEncode(getPublicKey(agentSecret));

        const vault = getVault();
        try {
          await vault.storeAgentNsec(agentNpub, agentSecret);
        } finally {
          agentSecret.fill(0);
        }

        const { buildAgentProfile, publishAgentProfile } = await import(
          '../lib/nip-sa/profile-builder.js'
        );
        const unsigned = buildAgentProfile(params);
        await publishAgentProfile(unsigned, agentNpub, ceps);
        setStatus('success');
        return agentNpub;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create agent';
        setError(message);
        setStatus('error');
        throw err;
      }
    },
    [ceps]
  );

  const updateProfile = useCallback(
    async (updates: Partial<AgentProfileContent>, agentNpub: string): Promise<string> => {
      if (!ceps) throw new Error('CEPS client is not initialized');
      if (!profile) throw new Error('No existing profile to update');

      setStatus('updating');
      setError(null);

      try {
        const { updateAgentProfile } = await import('../lib/nip-sa/profile-builder.js');
        const eventId = await updateAgentProfile(
          profile.eventId,
          updates,
          agentNpub,
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

  const updateAgent = useCallback(
    async (id: string, updates: Partial<AgentViewModel>): Promise<void> => {
      setAgents(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
    },
    []
  );

  const deactivate = useCallback(
    async (agentNpub: string): Promise<string> => {
      if (!ceps) throw new Error('CEPS client is not initialized');
      if (!profile) throw new Error('No profile to deactivate');

      setStatus('deactivating');
      setError(null);

      try {
        const { deactivateAgent: deactivateAgentLib } = await import('../lib/nip-sa/profile-builder.js');
        const eventId = await deactivateAgentLib(profile.eventId, agentNpub, ceps);
        setProfile(null);
        setAgents([]);
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

  const deactivateAgent = useCallback(
    async (id: string): Promise<void> => {
      setAgents(prev => prev.map(a =>
        a.id === id ? { ...a, status: 'terminated' as const } : a
      ));
    },
    []
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
    agents,
    agentState,
    status,
    isLoading: status === 'loading' || status === 'publishing' || status === 'updating' || status === 'deactivating',
    error,
    publishProfile,
    createAgent,
    updateProfile,
    updateAgent,
    deactivate,
    deactivateAgent,
    publishState,
    refetch: fetchProfile,
    clearError,
  };
}

