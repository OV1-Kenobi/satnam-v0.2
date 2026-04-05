/**
 * NIP-SA barrel export — Sovereign Agents
 * All public types and functions for the NIP-SA agent profile module (kinds 39200–39231).
 */

// ============================================================================
// Types (from types.ts — do not modify types.ts directly)
// ============================================================================

export type {
  AgentAutonomyLevel,
  AgentCapabilityKey,
  AgentWalletPolicy,
  AgentProfileContent,
  AgentProfileTags,
  AgentProfile,
  AgentStateContent,
  AgentScheduleContent,
  SkillLicenseContent,
  TrajectorySessionContent,
  TrajectoryEventContent,
  CreateAgentRequest,
} from "./types.js";

export { DEFAULT_AGENT_WALLET_POLICY } from "./types.js";

// ============================================================================
// Profile Builder (profile-builder.ts)
// ============================================================================

export type {
  UnsignedEvent,
  DelegationTag,
  BuildAgentProfileParams,
} from "./profile-builder.js";

export {
  buildAgentProfile,
  publishAgentProfile,
  updateAgentProfile,
  deactivateAgent,
} from "./profile-builder.js";

// ============================================================================
// Agent State (agent-state.ts)
// ============================================================================

export type {
  AgentOperationalState,
  PublishAgentScheduleParams,
} from "./agent-state.js";

export {
  publishAgentState,
  subscribeAgentState,
  publishAgentSchedule,
} from "./agent-state.js";
