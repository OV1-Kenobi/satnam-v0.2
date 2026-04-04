// Ported from v1 netlify/functions_active/nip-sa-agent.js
// Extracted: wallet policy schema + agent profile type definitions
// Stripped: Supabase inserts, supabaseAdmin, JWT auth, rate limiting (server-side)
//   action handlers (createAgentProfile, updateWalletPolicy, enableSkill, disableSkill)
// v2: Agent profiles are Nostr events (kind:39200) published via CEPS, not DB rows

/**
 * NIP-SA (Sovereign Agents) Type Definitions
 *
 * Types for the Nostr agent economic layer (kinds 39200–39231).
 * Aligned with spec §7.1 and OpenAgents NIP-SA.
 *
 * v2 note: Agent creation publishes a kind:39200 Nostr event via CEPS.
 * The `.well-known/agent.json` Netlify function reads the profile from relay
 * (cached with TTL) and serves it in the standard discovery format.
 */

// ============================================================================
// Agent autonomy and capability enums
// ============================================================================

export type AgentAutonomyLevel = "bounded" | "supervised" | "autonomous";

export type AgentCapabilityKey =
  | "research"
  | "summarization"
  | "nip90-provider"
  | "nip90-consumer"
  | "web_search"
  | "data_extraction"
  | "code_execution"
  | "file_access"
  | string; // extensible

// ============================================================================
// Wallet Policy (extracted from nip-sa-agent.js schema logic)
// ============================================================================

/**
 * Agent wallet spending policy.
 * Enforced by the Guardian who controls the agent.
 * All amounts in sats.
 */
export interface AgentWalletPolicy {
  /** Maximum spend in a single transaction (sats) */
  max_single_spend_sats: number;
  /** Maximum total spend per 24h rolling window (sats) */
  daily_limit_sats: number;
  /** Amounts above this threshold require Guardian approval (sats) */
  requires_approval_above_sats: number;
  /** Preferred payment rail */
  preferred_spend_rail: "lightning" | "cashu" | "auto";
  /** Allowed Cashu mints (empty = all) */
  allowed_mints: string[];
  /** Auto-sweep to Lightning when Cashu balance exceeds threshold (sats) */
  sweep_threshold_sats: number;
  /** Sweep destination (Lightning address or NWC URI) */
  sweep_destination: string | null;
  /** Rail to use for sweeps */
  sweep_rail: "lightning" | "cashu";
}

/** Default wallet policy for new agents */
export const DEFAULT_AGENT_WALLET_POLICY: AgentWalletPolicy = {
  max_single_spend_sats: 1000,
  daily_limit_sats: 100_000,
  requires_approval_above_sats: 10_000,
  preferred_spend_rail: "auto",
  allowed_mints: [],
  sweep_threshold_sats: 50_000,
  sweep_destination: null,
  sweep_rail: "lightning",
};

// ============================================================================
// Agent Profile (kind:39200)
// ============================================================================

/**
 * Agent profile content — stored as JSON in the Nostr event content field.
 * Published as kind:39200 via CEPS.
 */
export interface AgentProfileContent {
  name: string;
  about: string;
  picture?: string;
  capabilities: AgentCapabilityKey[];
  autonomy_level: AgentAutonomyLevel;
  version: string;
}

/**
 * Agent profile tags for kind:39200 event.
 * See spec §7.1 for the full tag schema.
 */
export interface AgentProfileTags {
  /** NIP-33 d-tag (typically "profile") */
  d: string;
  /** FROST threshold: [threshold, total] */
  threshold?: [string, string];
  /** Governor/operator pubkey */
  operator?: string;
  /** Group signing pubkey */
  signer?: string;
  /** Lightning address (NIP-57) */
  lud16?: string;
  /** NIP-05 identifier */
  nip05?: string;
  /** Enabled skill scope IDs */
  enabled_skills?: string[];
  /** Wallet policy JSON string */
  wallet_policy?: string;
  /** Coordination relay URLs */
  coordination_relays?: string[];
}

/**
 * Full agent profile model (combines content + tag fields).
 * Used by the agent creation UI and `.well-known/agent.json` endpoint.
 */
export interface AgentProfile {
  /** Agent's Nostr pubkey (hex) */
  pubkey: string;
  /** kind:39200 event ID */
  eventId: string;
  /** Profile content */
  content: AgentProfileContent;
  /** Structured tags */
  tags: AgentProfileTags;
  /** Unix timestamp of last profile update */
  createdAt: number;
  /** Wallet policy */
  walletPolicy: AgentWalletPolicy;
  /** NIP-05 username (e.g. "my-agent@satnam.pub") */
  nip05?: string;
  /** Lightning address (e.g. "my-agent@satnam.pub") */
  lud16?: string;
}

// ============================================================================
// Agent State (kind:39201 — NIP-44 encrypted)
// ============================================================================

export interface AgentStateContent {
  status: "idle" | "working" | "paused" | "error";
  currentTaskId?: string;
  lastHeartbeat: number;
  computeLoadPercent?: number;
  activeSessions?: number;
}

// ============================================================================
// Agent Schedule (kind:39202)
// ============================================================================

export interface AgentScheduleContent {
  heartbeatIntervalSeconds: number;
  maxConcurrentTasks: number;
  preferredWorkingHoursUTC?: { start: number; end: number };
}

// ============================================================================
// Skill License (kind:39220)
// ============================================================================

export interface SkillLicenseContent {
  skillScopeId: string;
  agentPubkey: string;
  grantedBy: string; // marketplace pubkey
  expiresAt?: number;
  usageLimit?: number;
}

// ============================================================================
// Trajectory (kind:39230 session, kind:39231 events)
// ============================================================================

export interface TrajectorySessionContent {
  agentPubkey: string;
  sessionId: string;
  taskDescription?: string;
  startedAt: number;
  probeSessionId?: string;
}

export interface TrajectoryEventContent {
  sessionId: string;
  step: number;
  eventType:
    | "message"
    | "tool_call"
    | "tool_result"
    | "delegation"
    | "error"
    | "completion";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  satsSpent?: number;
  tokensUsed?: number;
}

// ============================================================================
// Agent creation request (client-side, no server)
// ============================================================================

/**
 * Input for constructing and publishing a new agent profile (kind:39200).
 * Caller passes this to the agent creation service, which builds the Nostr
 * event, signs it with the agent's nsec (from OPFS Vault), and publishes via CEPS.
 */
export interface CreateAgentRequest {
  agentNsecHex: string; // From OPFS Vault — zeroed after use
  governorPubkeyHex: string;
  groupPubkeyHex?: string;
  username: string; // e.g. "my-agent" → NIP-05: my-agent@satnam.pub
  profileContent: AgentProfileContent;
  walletPolicy?: Partial<AgentWalletPolicy>;
  coordinationRelays?: string[];
  enabledSkillScopeIds?: string[];
}
