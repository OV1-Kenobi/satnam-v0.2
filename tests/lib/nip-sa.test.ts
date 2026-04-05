/**
 * @file nip-sa.test.ts
 * @description Unit tests for NIP-SA profile builder and agent state management.
 *
 * Tests cover:
 * 1. buildAgentProfile — correct kind, tags, and content serialization
 * 2. buildAgentProfile — threshold tag construction
 * 3. buildAgentProfile — optional fields (picture, lud16, nip05, groupPubkey)
 * 4. buildAgentProfile — enabled_skills variadic tag
 * 5. buildAgentProfile — wallet_policy JSON serialization (bigint → string)
 * 6. buildAgentProfile — coordination_relay multi-tag
 * 7. publishAgentProfile — signs event with nsec hex key
 * 8. publishAgentProfile — signs event with nsec bech32 key
 * 9. publishAgentProfile — appends NIP-26 delegation tag when provided
 * 10. updateAgentProfile — fetches existing profile and merges updates
 * 11. deactivateAgent — publishes kind:5 deletion with e tag
 * 12. publishAgentState — kind:39201, encrypts content, adds status tag
 * 13. publishAgentSchedule — kind:39202, validates heartbeat interval
 * 14. publishAgentSchedule — throws if interval < 30 seconds
 * 15. AgentOperationalState — bigint metrics serialization
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildAgentProfile,
  publishAgentProfile,
  updateAgentProfile,
  deactivateAgent,
} from '../../src/lib/nip-sa/profile-builder.js';
import {
  publishAgentState,
  publishAgentSchedule,
} from '../../src/lib/nip-sa/agent-state.js';
import type { AgentOperationalState } from '../../src/lib/nip-sa/agent-state.js';
import type { BuildAgentProfileParams } from '../../src/lib/nip-sa/profile-builder.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock nostr-tools to avoid real crypto in unit tests
vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>();
  return {
    ...actual,
    finalizeEvent: vi.fn((event: any, _secretKey: Uint8Array) => ({
      ...event,
      id: 'mock-event-id-' + Math.random().toString(36).slice(2),
      pubkey: 'aaaa'.repeat(16),
      sig: 'bbbb'.repeat(16),
    })),
    getPublicKey: vi.fn((_secretKey: Uint8Array) => 'cccc'.repeat(16)),
    nip19: {
      ...actual.nip19,
      decode: vi.fn((nsec: string) => {
        if (nsec === 'nsec1test') {
          return { type: 'nsec', data: new Uint8Array(32).fill(1) };
        }
        return actual.nip19.decode(nsec);
      }),
    },
    nip44: {
      v2: {
        utils: {
          getConversationKey: vi.fn(() => new Uint8Array(32)),
        },
        encrypt: vi.fn((plaintext: string, _key: Uint8Array) => `encrypted:${plaintext}`),
        decrypt: vi.fn((_ciphertext: string, _key: Uint8Array) => ''),
      },
    },
    SimplePool: vi.fn().mockImplementation(() => ({
      subscribeMany: vi.fn(() => ({ close: vi.fn() })),
      querySync: vi.fn(async () => []),
    })),
  };
});

vi.mock('@noble/hashes/utils', () => ({
  hexToBytes: vi.fn((hex: string) => {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return arr;
  }),
  bytesToHex: vi.fn((bytes: Uint8Array) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  ),
}));

// ---------------------------------------------------------------------------
// Mock CEPS client
// ---------------------------------------------------------------------------

function makeMockCeps(existingEvents: any[] = []) {
  return {
    publishEvent: vi.fn(async (event: any) => event.id ?? 'published-event-id'),
    list: vi.fn(async () => existingEvents),
    signEventWithActiveSession: vi.fn(async (event: any) => ({
      ...event,
      id: 'signed-event-id',
      pubkey: 'cccc'.repeat(16),
      sig: 'dddd'.repeat(16),
    })),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 64-char hex secret key fixture */
const TEST_NSEC_HEX = '0'.repeat(64);

/** Minimal valid BuildAgentProfileParams */
function makeProfileParams(overrides: Partial<BuildAgentProfileParams> = {}): BuildAgentProfileParams {
  return {
    name: 'TestBot',
    about: 'A test agent',
    capabilities: ['research', 'summarization'],
    autonomyLevel: 'bounded',
    governorPubkey: 'gov' + 'a'.repeat(61),
    enabledSkills: ['skill-scope-1', 'skill-scope-2'],
    walletPolicy: {
      max_single_spend_msats: BigInt(1_000_000),
      daily_limit_msats: BigInt(100_000_000),
      requires_approval_above_msats: BigInt(10_000_000),
      preferred_rail: 'auto',
      allowed_mints: [],
      sweep_threshold_msats: BigInt(50_000_000),
      sweep_destination: null,
      sweep_rail: 'lightning',
    } as any,
    coordinationRelays: ['wss://pylon.openagents.com', 'wss://relay.satnam.pub'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1–6: buildAgentProfile
// ---------------------------------------------------------------------------

describe('buildAgentProfile', () => {
  it('1. produces kind:39200 with correct created_at', () => {
    const before = Math.floor(Date.now() / 1000);
    const event = buildAgentProfile(makeProfileParams());
    const after = Math.floor(Date.now() / 1000);

    expect(event.kind).toBe(39200);
    expect(event.created_at).toBeGreaterThanOrEqual(before);
    expect(event.created_at).toBeLessThanOrEqual(after);
  });

  it('2. always includes d=profile, operator tags', () => {
    const params = makeProfileParams({ governorPubkey: 'gov-pk-hex' });
    const event = buildAgentProfile(params);

    const dTag = event.tags.find((t) => t[0] === 'd');
    expect(dTag?.[1]).toBe('profile');

    const operatorTag = event.tags.find((t) => t[0] === 'operator');
    expect(operatorTag?.[1]).toBe('gov-pk-hex');
  });

  it('3. adds threshold tag when threshold is provided', () => {
    const event = buildAgentProfile(makeProfileParams({ threshold: [2, 3] }));
    const thresholdTag = event.tags.find((t) => t[0] === 'threshold');
    expect(thresholdTag).toEqual(['threshold', '2', '3']);
  });

  it('4. adds optional tags: lud16, nip05, signer', () => {
    const event = buildAgentProfile(
      makeProfileParams({
        lud16: 'testbot@satnam.pub',
        nip05: 'testbot@satnam.pub',
        groupPubkey: 'group-pubkey-hex',
      })
    );

    expect(event.tags.find((t) => t[0] === 'lud16')?.[1]).toBe('testbot@satnam.pub');
    expect(event.tags.find((t) => t[0] === 'nip05')?.[1]).toBe('testbot@satnam.pub');
    expect(event.tags.find((t) => t[0] === 'signer')?.[1]).toBe('group-pubkey-hex');
  });

  it('5. enabled_skills tag is variadic with all skill IDs', () => {
    const skills = ['skill-a', 'skill-b', 'skill-c'];
    const event = buildAgentProfile(makeProfileParams({ enabledSkills: skills }));
    const skillsTag = event.tags.find((t) => t[0] === 'enabled_skills');
    expect(skillsTag).toEqual(['enabled_skills', 'skill-a', 'skill-b', 'skill-c']);
  });

  it('6. coordination_relay produces one tag per relay', () => {
    const relays = ['wss://relay1.com', 'wss://relay2.com'];
    const event = buildAgentProfile(makeProfileParams({ coordinationRelays: relays }));
    const relayTags = event.tags.filter((t) => t[0] === 'coordination_relay');
    expect(relayTags).toHaveLength(2);
    expect(relayTags[0][1]).toBe('wss://relay1.com');
    expect(relayTags[1][1]).toBe('wss://relay2.com');
  });

  it('7. content is valid JSON with expected fields', () => {
    const event = buildAgentProfile(
      makeProfileParams({
        name: 'ResearchBot-7',
        about: 'Market data researcher',
        capabilities: ['research'],
        autonomyLevel: 'supervised',
        picture: 'https://satnam.pub/agent.png',
      })
    );

    const content = JSON.parse(event.content);
    expect(content.name).toBe('ResearchBot-7');
    expect(content.about).toBe('Market data researcher');
    expect(content.capabilities).toEqual(['research']);
    expect(content.autonomy_level).toBe('supervised');
    expect(content.picture).toBe('https://satnam.pub/agent.png');
    expect(content.version).toBe('2.0.0');
  });

  it('8. wallet_policy tag is serialized JSON (bigint as string)', () => {
    const event = buildAgentProfile(makeProfileParams());
    const walletTag = event.tags.find((t) => t[0] === 'wallet_policy');
    expect(walletTag).toBeDefined();

    // Must be parseable JSON
    const parsed = JSON.parse(walletTag![1]);
    expect(typeof parsed).toBe('object');
    // BigInt values serialized to strings
    expect(typeof parsed.max_single_spend_msats).toBe('string');
  });

  it('9. omits optional tags when not provided', () => {
    const event = buildAgentProfile(makeProfileParams());
    const tagNames = event.tags.map((t) => t[0]);

    expect(tagNames).not.toContain('threshold');
    expect(tagNames).not.toContain('signer');
    expect(tagNames).not.toContain('lud16');
    expect(tagNames).not.toContain('nip05');
  });
});

// ---------------------------------------------------------------------------
// 7–9: publishAgentProfile
// ---------------------------------------------------------------------------

describe('publishAgentProfile', () => {
  it('7. signs and publishes with hex nsec', async () => {
    const ceps = makeMockCeps();
    const unsigned = buildAgentProfile(makeProfileParams());
    const eventId = await publishAgentProfile(unsigned, TEST_NSEC_HEX, ceps as any);

    expect(ceps.publishEvent).toHaveBeenCalledOnce();
    expect(typeof eventId).toBe('string');
    expect(eventId.length).toBeGreaterThan(0);
  });

  it('8. signs and publishes with nsec bech32', async () => {
    const ceps = makeMockCeps();
    const unsigned = buildAgentProfile(makeProfileParams());
    const eventId = await publishAgentProfile(unsigned, 'nsec1test', ceps as any);

    expect(ceps.publishEvent).toHaveBeenCalledOnce();
    expect(typeof eventId).toBe('string');
  });

  it('9. appends delegation tag for Offspring agents', async () => {
    const ceps = makeMockCeps();
    const unsigned = buildAgentProfile(makeProfileParams());

    await publishAgentProfile(unsigned, TEST_NSEC_HEX, ceps as any, {
      delegatorPubkey: 'gov-pubkey-hex',
      conditions: 'kind=39200',
      token: 'delegation-token-hex',
    });

    const publishedEvent = (ceps.publishEvent as any).mock.calls[0][0];
    const delegationTag = publishedEvent.tags.find(
      (t: string[]) => t[0] === 'delegation'
    );
    expect(delegationTag).toBeDefined();
    expect(delegationTag[1]).toBe('gov-pubkey-hex');
    expect(delegationTag[2]).toBe('kind=39200');
    expect(delegationTag[3]).toBe('delegation-token-hex');
  });
});

// ---------------------------------------------------------------------------
// 10: updateAgentProfile
// ---------------------------------------------------------------------------

describe('updateAgentProfile', () => {
  it('10. fetches existing profile and publishes merged update', async () => {
    const existingEvent = {
      id: 'existing-event-id',
      pubkey: 'cccc'.repeat(16),
      kind: 39200,
      created_at: 1000000,
      tags: [['d', 'profile'], ['operator', 'gov-pk']],
      content: JSON.stringify({
        name: 'OldName',
        about: 'Old about',
        capabilities: ['research'],
        autonomy_level: 'bounded',
        version: '2.0.0',
      }),
      sig: 'sig',
    };

    const ceps = makeMockCeps([existingEvent]);
    const eventId = await updateAgentProfile(
      'existing-event-id',
      { name: 'NewName', about: 'New about' },
      TEST_NSEC_HEX,
      ceps as any
    );

    expect(ceps.list).toHaveBeenCalledOnce();
    expect(ceps.publishEvent).toHaveBeenCalledOnce();

    const publishedEvent = (ceps.publishEvent as any).mock.calls[0][0];
    const mergedContent = JSON.parse(publishedEvent.content);
    expect(mergedContent.name).toBe('NewName');
    expect(mergedContent.about).toBe('New about');
    expect(mergedContent.capabilities).toEqual(['research']); // Preserved
  });

  it('10b. throws if no existing profile found on relay', async () => {
    const ceps = makeMockCeps([]); // Empty result
    await expect(
      updateAgentProfile('nonexistent-id', { name: 'X' }, TEST_NSEC_HEX, ceps as any)
    ).rejects.toThrow(/No existing kind:39200 profile found/);
  });
});

// ---------------------------------------------------------------------------
// 11: deactivateAgent
// ---------------------------------------------------------------------------

describe('deactivateAgent', () => {
  it('11. publishes kind:5 deletion event with e tag', async () => {
    const ceps = makeMockCeps();
    await deactivateAgent('profile-event-id', TEST_NSEC_HEX, ceps as any);

    expect(ceps.publishEvent).toHaveBeenCalledOnce();
    const publishedEvent = (ceps.publishEvent as any).mock.calls[0][0];

    expect(publishedEvent.kind).toBe(5);
    const eTag = publishedEvent.tags.find((t: string[]) => t[0] === 'e');
    expect(eTag?.[1]).toBe('profile-event-id');
    const kTag = publishedEvent.tags.find((t: string[]) => t[0] === 'k');
    expect(kTag?.[1]).toBe('39200');
    expect(publishedEvent.content).toBe('agent deactivated');
  });
});

// ---------------------------------------------------------------------------
// 12–14: publishAgentState, publishAgentSchedule
// ---------------------------------------------------------------------------

describe('publishAgentState', () => {
  it('12. publishes kind:39201 with encrypted content and status tag', async () => {
    const ceps = makeMockCeps();
    const state: AgentOperationalState = {
      status: 'active',
      currentTask: 'Researching AI sector',
      lastHeartbeat: Math.floor(Date.now() / 1000),
      metrics: {
        tasksCompleted: 5,
        tasksFailed: 1,
        totalSpentMsats: BigInt(500_000),
        uptimeSeconds: 3600,
      },
    };

    await publishAgentState({
      agentPubkey: 'agent-pubkey-hex',
      state,
      signerNsec: TEST_NSEC_HEX,
      governorPubkey: 'gov-pubkey-hex',
      ceps: ceps as any,
    });

    expect(ceps.publishEvent).toHaveBeenCalledOnce();
    const published = (ceps.publishEvent as any).mock.calls[0][0];

    expect(published.kind).toBe(39201);

    const dTag = published.tags.find((t: string[]) => t[0] === 'd');
    expect(dTag?.[1]).toBe('state');

    const statusTag = published.tags.find((t: string[]) => t[0] === 'status');
    expect(statusTag?.[1]).toBe('active');

    const pTag = published.tags.find((t: string[]) => t[0] === 'p');
    expect(pTag?.[1]).toBe('gov-pubkey-hex');

    // Content should be encrypted (starts with 'encrypted:' per mock)
    expect(published.content).toContain('encrypted:');
  });
});

describe('publishAgentSchedule', () => {
  it('13. publishes kind:39202 with correct heartbeat tag', async () => {
    const ceps = makeMockCeps();

    await publishAgentSchedule({
      agentPubkey: 'agent-pk',
      heartbeatIntervalSecs: 60,
      signerNsec: TEST_NSEC_HEX,
      ceps: ceps as any,
    });

    expect(ceps.publishEvent).toHaveBeenCalledOnce();
    const published = (ceps.publishEvent as any).mock.calls[0][0];

    expect(published.kind).toBe(39202);

    const dTag = published.tags.find((t: string[]) => t[0] === 'd');
    expect(dTag?.[1]).toBe('schedule');

    const hbTag = published.tags.find((t: string[]) => t[0] === 'heartbeat_interval');
    expect(hbTag?.[1]).toBe('60');
  });

  it('13b. includes active_hours tag when activeHours provided', async () => {
    const ceps = makeMockCeps();

    await publishAgentSchedule({
      agentPubkey: 'agent-pk',
      heartbeatIntervalSecs: 120,
      activeHours: { start: 9, end: 17 },
      signerNsec: TEST_NSEC_HEX,
      ceps: ceps as any,
    });

    const published = (ceps.publishEvent as any).mock.calls[0][0];
    const ahTag = published.tags.find((t: string[]) => t[0] === 'active_hours');
    expect(ahTag).toEqual(['active_hours', '9', '17']);
  });

  it('14. throws if heartbeat interval is below 30 seconds', async () => {
    const ceps = makeMockCeps();

    await expect(
      publishAgentSchedule({
        agentPubkey: 'agent-pk',
        heartbeatIntervalSecs: 15, // Too short
        signerNsec: TEST_NSEC_HEX,
        ceps: ceps as any,
      })
    ).rejects.toThrow(/at least 30 seconds/);
  });
});

// ---------------------------------------------------------------------------
// 15: AgentOperationalState bigint handling
// ---------------------------------------------------------------------------

describe('AgentOperationalState serialization', () => {
  it('15. bigint metrics serialized to string in JSON', () => {
    const state: AgentOperationalState = {
      status: 'idle',
      lastHeartbeat: 1000000,
      metrics: {
        tasksCompleted: 0,
        tasksFailed: 0,
        totalSpentMsats: BigInt(9_999_999_999),
        uptimeSeconds: 86400,
      },
    };

    // Simulate the serialization used in publishAgentState
    const json = JSON.stringify(state, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );

    const parsed = JSON.parse(json);
    expect(typeof parsed.metrics.totalSpentMsats).toBe('string');
    expect(parsed.metrics.totalSpentMsats).toBe('9999999999');
  });
});
