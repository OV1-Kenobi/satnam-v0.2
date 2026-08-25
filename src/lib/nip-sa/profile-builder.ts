/**
 * @module nip-sa/profile-builder
 * @description Agent profile event construction and publishing for NIP-SA.
 *
 * Implements kind:39200 (Agent Profile) Nostr event construction, signing,
 * publishing via CEPS, and NIP-09 deletion (deactivation). Agent profiles are
 * addressable replaceable events identified by the `d` tag "profile".
 *
 * Event flow:
 *   buildAgentProfile() → UnsignedEvent
 *   publishAgentProfile(unsignedEvent, nsec, ceps) → eventId
 *   updateAgentProfile(existingId, updates, nsec, ceps) → eventId
 *   deactivateAgent(profileEventId, nsec, ceps) → eventId
 *
 * @see phase3-spec-sections.md §7.1 — NIP-SA Agent Profiles
 */

import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { getVault } from '../vault/vault.js';
import type { CepsClient } from '../ceps/ceps-client.js';
import type {
  AgentCapabilityKey,
  AgentAutonomyLevel,
  AgentProfileContent,
  AgentWalletPolicy,
} from './types.js';
import type { AgentSpendPolicy } from '../agent/wallet/spend-policy.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * Unsigned Nostr event (pre-signature, pre-ID).
 * Matches the input format expected by nostr-tools `finalizeEvent()`.
 */
export interface UnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

/**
 * NIP-26 delegation tag produced by the delegation construction flow.
 * When present, the event is signed by a delegatee but carries authority
 * from the delegator (Governor) via the delegation tag.
 */
export interface DelegationTag {
  delegatorPubkey: string;
  conditions: string;
  token: string;
}

/**
 * Parameters for building an agent profile event (kind:39200).
 */
export interface BuildAgentProfileParams {
  /** Display name of the agent */
  name: string;
  /** Human-readable description */
  about: string;
  /** Avatar URL (optional) */
  picture?: string;
  /** Capabilities this agent advertises */
  capabilities: AgentCapabilityKey[];
  /** Autonomy level governs approval requirements */
  autonomyLevel: AgentAutonomyLevel;
  /** Governor/operator pubkey hex — controlling principal */
  governorPubkey: string;
  /** Group signing pubkey hex (for FROST threshold setups) */
  groupPubkey?: string;
  /** FROST threshold [t, n] (requires t-of-n signers) */
  threshold?: [number, number];
  /** Enabled NIP-SKL skill scope IDs */
  enabledSkills: string[];
  /** Wallet spend policy for this agent */
  walletPolicy: AgentSpendPolicy | AgentWalletPolicy;
  /** Coordination relay URLs (at least one Pylon relay) */
  coordinationRelays: string[];
  /** Lightning address e.g. "agent-name@satnam.pub" */
  lud16?: string;
  /** NIP-05 identifier e.g. "agent-name@satnam.pub" */
  nip05?: string;
  /** Semantic version string (default "2.0.0") */
  version?: string;
}

// ---------------------------------------------------------------------------
// buildAgentProfile
// ---------------------------------------------------------------------------

/**
 * Construct a kind:39200 agent profile unsigned event.
 *
 * Tags per spec §7.1:
 * - ["d", "profile"]
 * - ["threshold", "<t>", "<n>"]        (when threshold is set)
 * - ["operator", "<governor_pubkey>"]
 * - ["signer", "<group_pubkey>"]       (when groupPubkey is set)
 * - ["lud16", "<agent>@satnam.pub"]    (when lud16 is set)
 * - ["nip05", "<agent>@satnam.pub"]    (when nip05 is set)
 * - ["enabled_skills", "<id1>", ..."]  (one tag, variadic skill IDs)
 * - ["wallet_policy", "<json>"]
 * - ["coordination_relay", "<url>"]    (one tag per relay)
 *
 * Content: JSON-serialized AgentProfileContent
 *
 * @param params - Agent profile construction parameters
 * @returns Unsigned Nostr event ready for signing
 *
 * @example
 * ```ts
 * const unsigned = buildAgentProfile({
 *   name: 'ResearchBot-7',
 *   about: 'Researches market data and produces summaries',
 *   capabilities: ['research', 'summarization'],
 *   autonomyLevel: 'bounded',
 *   governorPubkey: '...',
 *   enabledSkills: ['skill-scope-id-1'],
 *   walletPolicy: DEFAULT_SPEND_POLICY,
 *   coordinationRelays: ['wss://pylon.openagents.com'],
 * });
 * ```
 */
export function buildAgentProfile(params: BuildAgentProfileParams): UnsignedEvent {
  const {
    name,
    about,
    picture,
    capabilities,
    autonomyLevel,
    governorPubkey,
    groupPubkey,
    threshold,
    enabledSkills,
    walletPolicy,
    coordinationRelays,
    lud16,
    nip05,
    version = '2.0.0',
  } = params;

  // --- Content field ---
  const content: AgentProfileContent = {
    name,
    about,
    ...(picture ? { picture } : {}),
    capabilities,
    autonomy_level: autonomyLevel,
    version,
  };

  // --- Tags ---
  const tags: string[][] = [
    ['d', 'profile'],
    ['operator', governorPubkey],
  ];

  if (threshold) {
    const [t, n] = threshold;
    tags.push(['threshold', String(t), String(n)]);
  }

  if (groupPubkey) {
    tags.push(['signer', groupPubkey]);
  }

  if (lud16) {
    tags.push(['lud16', lud16]);
  }

  if (nip05) {
    tags.push(['nip05', nip05]);
  }

  if (enabledSkills.length > 0) {
    tags.push(['enabled_skills', ...enabledSkills]);
  }

  // Serialize wallet policy — handle both AgentSpendPolicy (bigint msats) and
  // legacy AgentWalletPolicy (number sats) shapes
  const walletPolicyJson = JSON.stringify(walletPolicy, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
  tags.push(['wallet_policy', walletPolicyJson]);

  for (const relay of coordinationRelays) {
    tags.push(['coordination_relay', relay]);
  }

  return {
    kind: 39200,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(content),
  };
}

// ---------------------------------------------------------------------------
// publishAgentProfile
// ---------------------------------------------------------------------------

/**
 * Sign and publish an agent profile event to relays via CEPS.
 *
 * For bounded/supervised agents: signed by the agent's own nsec.
 * For Offspring agents: pass a `delegation` tag (NIP-26); the event is still
 * signed by the agent's nsec but carries the delegation tag proving Governor
 * authority.
 *
 * @param profile - Unsigned event from `buildAgentProfile()`
 * @param agentNpub - Agent's public key. The agent's secret key is retrieved
 *   from the OPFS Vault (vault/agents/{agent_npub}.nsec) and zeroed after use.
 * @param ceps - Active CEPS client for relay publishing
 * @param delegation - Optional NIP-26 delegation tag for Offspring agents
 * @returns Published event ID (hex)
 * @throws If the agent nsec is not in the vault, or signing/publishing fails
 */
export async function publishAgentProfile(
  profile: UnsignedEvent,
  agentNpub: string,
  ceps: CepsClient,
  delegation?: DelegationTag
): Promise<string> {
  const vault = getVault();
  const secretKey = await vault.getAgentNsec(agentNpub);
  try {
    // Append NIP-26 delegation tag if this is an Offspring agent
    let eventToSign = profile;
    if (delegation) {
      const delegationTags = profile.tags.filter((t) => t[0] !== 'delegation');
      delegationTags.push([
        'delegation',
        delegation.delegatorPubkey,
        delegation.conditions,
        delegation.token,
      ]);
      eventToSign = { ...profile, tags: delegationTags };
    }

    const signed = finalizeEvent(
      {
        kind: eventToSign.kind,
        created_at: eventToSign.created_at,
        tags: eventToSign.tags,
        content: eventToSign.content,
      },
      secretKey
    );

    const eventId = await ceps.publishEvent(signed as any);
    return eventId;
  } finally {
    secretKey.fill(0);
  }
}

// ---------------------------------------------------------------------------
// updateAgentProfile
// ---------------------------------------------------------------------------

/**
 * Update an existing agent profile by constructing and publishing a new
 * kind:39200 event with the same `d` tag "profile" (NIP-33 replacement).
 *
 * The relay will replace the old event since kind:39200 is addressable.
 * The `existingEventId` parameter is accepted for caller bookkeeping but
 * is not included in the replacement event (NIP-33 replaces by author+kind+d).
 *
 * @param existingEventId - Previous event ID (for caller reference only)
 * @param updates - Partial content fields to merge into the existing profile
 * @param agentNpub - Agent's public key (secret key retrieved from vault)
 * @param ceps - Active CEPS client
 * @returns New event ID (hex)
 * @throws If the existing profile cannot be fetched or signing fails
 */
export async function updateAgentProfile(
  existingEventId: string,
  updates: Partial<AgentProfileContent>,
  agentNpub: string,
  ceps: CepsClient
): Promise<string> {
  const vault = getVault();
  const secretKey = await vault.getAgentNsec(agentNpub);
  const pubkey = getPublicKey(secretKey);

  // Fetch the existing profile from relay to merge tags and content
  const existing = await ceps.list(
    {
      kinds: [39200],
      authors: [pubkey],
      '#d': ['profile'],
      limit: 1,
    },
    undefined as unknown as string[],
    { eoseTimeout: 5000 }
  );

  if (!existing || existing.length === 0) {
    throw new Error(
      `No existing kind:39200 profile found for pubkey ${pubkey} (referenced by ${existingEventId})`
    );
  }

  const current = existing[0] as any;
  let currentContent: AgentProfileContent;
  try {
    currentContent = JSON.parse(current.content);
  } catch {
    throw new Error('Failed to parse existing profile content as JSON');
  }

  // Merge updates into current content
  const mergedContent: AgentProfileContent = {
    ...currentContent,
    ...updates,
  };

  // Build a replacement event preserving all existing tags but bumping created_at
  const replacementEvent: UnsignedEvent = {
    kind: 39200,
    created_at: Math.floor(Date.now() / 1000),
    tags: current.tags as string[][],
    content: JSON.stringify(mergedContent),
  };

  try {
    const signed = finalizeEvent(
      {
        kind: replacementEvent.kind,
        created_at: replacementEvent.created_at,
        tags: replacementEvent.tags,
        content: replacementEvent.content,
      },
      secretKey
    );

    return await ceps.publishEvent(signed as any);
  } finally {
    secretKey.fill(0);
  }
}

// ---------------------------------------------------------------------------
// deactivateAgent
// ---------------------------------------------------------------------------

/**
 * Deactivate an agent by publishing a NIP-09 deletion event for its profile.
 *
 * Publishes a kind:5 event referencing the profile event ID with a reason
 * of "agent deactivated". The relay and clients that honour NIP-09 will
 * stop serving the profile event. The agent's nsec and Vault entry should
 * be separately purged by the caller.
 *
 * @param profileEventId - The kind:39200 event ID to delete
 * @param agentNpub - Agent's public key (secret key retrieved from vault; must match the profile author)
 * @param ceps - Active CEPS client
 * @returns Deletion event ID (hex)
 * @throws If signing or publishing fails
 */
export async function deactivateAgent(
  profileEventId: string,
  agentNpub: string,
  ceps: CepsClient
): Promise<string> {
  const vault = getVault();
  const secretKey = await vault.getAgentNsec(agentNpub);
  try {
    // NIP-09 deletion event
    const deletionEvent = finalizeEvent(
      {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['e', profileEventId],
          ['k', '39200'],
        ],
        content: 'agent deactivated',
      },
      secretKey
    );

    return await ceps.publishEvent(deletionEvent as any);
  } finally {
    secretKey.fill(0);
  }
}

