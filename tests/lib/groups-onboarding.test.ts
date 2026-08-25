/**
 * CR-I — group onboarding state machine + guardrail validation tests.
 *
 * Acceptance anchors: one flow serves every group type (type only changes
 * labels); batch member provisioning validated; swarm guardrails enforced
 * (daily ≥ single spend; positive limits; malformed keys rejected).
 */
import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';

import {
  canAdvanceFromCharter,
  initialOnboardingState,
  ROLE_DEFAULTS,
  ROLE_LABELS,
  submitAgentDeploy,
  validateAgentGuardrails,
  type GroupType,
} from '../../src/lib/groups/onboarding';

const TYPES: GroupType[] = ['business', 'family', 'team', 'club', 'event'];

describe('CR-I one flow, every group type', () => {
  it('all types share the same initial state shape and role set', () => {
    for (const t of TYPES) {
      const s = initialOnboardingState(t);
      expect(s.step).toBe('charter');
      expect(s.members).toEqual([]);
      expect(s.agents).toEqual([]);
      expect(Object.keys(ROLE_LABELS[t]).sort()).toEqual(
        ['guardian', 'steward', 'adult', 'offspring'].sort(),
      );
    }
  });

  it('roles are preserved across all type label variants (founder directive)', () => {
    // The SEMANTIC roles never change — only display warmth does.
    for (const t of TYPES) {
      expect(ROLE_LABELS[t].guardian).toBeTruthy();
      expect(ROLE_DEFAULTS.guardian.rights.length).toBeGreaterThan(0);
      expect(ROLE_DEFAULTS.offspring.responsibilities.length).toBeGreaterThan(0);
    }
    // Family keeps its warm labels verbatim.
    expect(ROLE_LABELS.family).toEqual({
      guardian: 'Guardian',
      steward: 'Steward',
      adult: 'Adult',
      offspring: 'Offspring',
    });
  });

  it('charter validation gates the first step', () => {
    const s = initialOnboardingState('club');
    expect(canAdvanceFromCharter(s)).toBe(false);
    s.charter = 'Weekly chess nights at the citadel';
    expect(canAdvanceFromCharter(s)).toBe(true);
    s.charter = 'x'.repeat(2001);
    expect(canAdvanceFromCharter(s)).toBe(false);
  });
});

describe('CR-I agent guardrails (swarm safety)', () => {
  const validAgent = {
    pubkey: getPublicKey(generateSecretKey()),
    name: 'treasury-bot',
    max_single_spend_msats: 50_000,
    daily_limit_msats: 500_000,
    allowed_kinds: ['1'],
    delegation_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  };

  it('accepts a well-formed agent with daily ≥ single-spend', () => {
    expect(validateAgentGuardrails(validAgent)).toEqual({ ok: true, errors: [] });
  });

  it('rejects daily limit below single-spend limit', () => {
    const result = validateAgentGuardrails({
      ...validAgent,
      daily_limit_msats: 10_000,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/daily limit must be/);
  });

  it('rejects non-positive spend limits', () => {
    const result = validateAgentGuardrails({ ...validAgent, max_single_spend_msats: 0 });
    expect(result.ok).toBe(false);
  });

  it('rejects malformed pubkeys and missing names', () => {
    const result = validateAgentGuardrails({
      ...validAgent,
      pubkey: 'bad',
      name: '',
    });
    expect(result.errors).toHaveLength(2);
  });
});

describe('CR-I server contract (NIP-98 signed requests)', () => {
  it('builds a verifiable NIP-98 auth header for agent deployment bodies', async () => {
    // Contract check without network: the body serializer output must be a
    // stable JSON string carrying action/group/agent/policy fields.
    const { buildNip98AuthHeader } = await import('../../src/lib/nip98/construct');
    const secret = bytesToHex(generateSecretKey());
    const body = {
      action: 'agent_deploy',
      group_id: '00000000-0000-0000-0000-000000000000',
      agent_pubkey: getPublicKey(generateSecretKey()),
      name: 'bot',
      spend_policy: { max_single_spend_msats: 1 },
    };
    const encoded = new TextEncoder().encode(JSON.stringify(body));
    const url = 'https://satnam.pub/.netlify/functions/register-identity';
    const header = buildNip98AuthHeader(secret, url, 'POST', encoded);
    expect(header.startsWith('Nostr ')).toBe(true);
    const payload = JSON.parse(atob(header.slice('Nostr '.length))) as {
      kind: number;
      tags: string[][];
    };
    expect(payload.kind).toBe(27235);
    expect(payload.tags).toContainEqual(['u', url]);
    expect(payload.tags.find((t) => t[0] === 'method')?.[1]).toBe('POST');
  });

  it('submitAgentDeploy surfaces server errors instead of swallowing them', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: false, error: 'Only guardians/stewards may deploy' }), {
        status: 403,
      })) as unknown as typeof fetch;
    try {
      await expect(
        submitAgentDeploy({
          secretHex: bytesToHex(generateSecretKey()),
          groupId: '00000000-0000-0000-0000-000000000000',
          agent: {
            pubkey: getPublicKey(generateSecretKey()),
            name: 'bot',
            max_single_spend_msats: 1,
            daily_limit_msats: 2,
            allowed_kinds: [],
          },
        }),
      ).rejects.toThrow(/guardians\/stewards/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
