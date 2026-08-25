/**
 * @module groups/onboarding
 * @description CR-I Layer 3 — the ONE group-onboarding state machine serving
 * companies, families, human/Agent teams, clubs, and event hosts.
 *
 * Flow: charter → roles (RBAC presets per group type) → invites → agents
 * (swarm wizard with guardrail review). Family-flavored copy is permitted in
 * family contexts per founder's naming directive; every variant shares this
 * one machine. Server contract: register-identity actions `group_create`
 * and `agent_deploy` (NIP-98 signed by the caller).
 */

import { buildNip98AuthHeader } from '../nip98/construct';

// ---------------------------------------------------------------------------
// Group types & RBAC presets
// ---------------------------------------------------------------------------

export type GroupType = 'business' | 'family' | 'team' | 'club' | 'event';
export type GroupRole = 'guardian' | 'steward' | 'adult' | 'offspring';

/** Role label per type — role SEMANTICS identical; only display warmth varies. */
export const ROLE_LABELS: Record<GroupType, Record<GroupRole, string>> = {
  business: {
    guardian: 'Director',
    steward: 'Operations Lead',
    adult: 'Member',
    offspring: 'Trainee',
  },
  family: {
    guardian: 'Guardian',
    steward: 'Steward',
    adult: 'Adult',
    offspring: 'Offspring',
  },
  team: { guardian: 'Team Lead', steward: 'Coordinator', adult: 'Member', offspring: 'Apprentice' },
  club: { guardian: 'Steward', steward: 'Organizer', adult: 'Member', offspring: 'Junior Member' },
  event: { guardian: 'Host', steward: 'Co-host', adult: 'Attendee', offspring: 'Guest' },
};

/** Default rights/responsibilities per role (identical across types). */
export const ROLE_DEFAULTS: Record<GroupRole, { rights: string[]; responsibilities: string[] }> = {
  guardian: {
    rights: ['Rotate keys', 'Approve spends above threshold', 'Deploy/remove agents'],
    responsibilities: ['Custody of charter', 'Final authority in disputes'],
  },
  steward: {
    rights: ['Invite members', 'Deploy agents (reviewed)', 'Manage daily operations'],
    responsibilities: ['Uphold charter', 'Review agent activity'],
  },
  adult: {
    rights: ['Send/receive payments within limits'],
    responsibilities: ['Verify contacts via proof-of-life'],
  },
  offspring: {
    rights: ['Receive allowance rails'],
    responsibilities: ['Guardian-approved spends above threshold'],
  },
};

export interface OnboardingState {
  step: 'charter' | 'roles' | 'invites' | 'agents' | 'done';
  groupType: GroupType;
  charter: string;
  creatorRole: GroupRole;
  /** Provisioned human members (pubkey + role). */
  members: Array<{ pubkey: string; role: GroupRole }>;
  /** Agents to deploy with guardrails. */
  agents: Array<{
    pubkey: string;
    name: string;
    max_single_spend_msats: number;
    daily_limit_msats: number;
    allowed_kinds: string[];
    delegation_expires_at?: string;
  }>;
}

export function initialOnboardingState(groupType: GroupType): OnboardingState {
  return {
    step: 'charter',
    groupType,
    charter: '',
    creatorRole: 'guardian',
    members: [],
    agents: [],
  };
}

// ---------------------------------------------------------------------------
// Server calls (NIP-98 signed)
// ---------------------------------------------------------------------------

async function postAction(
  secretHex: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${window.location.origin}/.netlify/functions/register-identity`;
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: buildNip98AuthHeader(secretHex, url, 'POST', encoded),
      'Content-Type': 'application/json',
    },
    body: encoded,
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok || !data['success']) {
    throw new Error((data['error'] as string) ?? `request failed (${response.status})`);
  }
  return data;
}

/** Step 2+4 combined server call: create group and provision members batch. */
export async function submitGroupCreate(params: {
  secretHex: string;
  state: OnboardingState;
}): Promise<{ groupId: string }> {
  const data = await postAction(params.secretHex, {
    action: 'group_create',
    charter: params.state.charter,
    role: params.state.creatorRole,
    members: params.state.members,
  });
  return { groupId: data['group_id'] as string };
}

/** Step 4: deploy one agent with guardrails into the created group. */
export async function submitAgentDeploy(params: {
  secretHex: string;
  groupId: string;
  agent: OnboardingState['agents'][number];
}): Promise<{ profileId: string }> {
  const data = await postAction(params.secretHex, {
    action: 'agent_deploy',
    group_id: params.groupId,
    agent_pubkey: params.agent.pubkey,
    name: params.agent.name,
    spend_policy: {
      max_single_spend_msats: params.agent.max_single_spend_msats,
      daily_limit_msats: params.agent.daily_limit_msats,
      allowed_kinds: params.agent.allowed_kinds,
      ...(params.agent.delegation_expires_at
        ? { delegation_expires_at: params.agent.delegation_expires_at }
        : {}),
    },
  });
  return { profileId: data['agent_profile_id'] as string };
}

// ---------------------------------------------------------------------------
// Validation helpers (shared by UI + tests)
// ---------------------------------------------------------------------------

export function canAdvanceFromCharter(state: OnboardingState): boolean {
  return state.charter.trim().length >= 3 && state.charter.length <= 2000;
}

export function validateAgentGuardrails(agent: OnboardingState['agents'][number]): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!/^[0-9a-f]{64}$/.test(agent.pubkey)) errors.push('agent pubkey must be 64 hex');
  if (!agent.name) errors.push('agent name required');
  if (agent.max_single_spend_msats < 1) errors.push('single-spend limit must be positive');
  if (agent.daily_limit_msats < agent.max_single_spend_msats) {
    errors.push('daily limit must be ≥ single-spend limit');
  }
  return { ok: errors.length === 0, errors };
}
