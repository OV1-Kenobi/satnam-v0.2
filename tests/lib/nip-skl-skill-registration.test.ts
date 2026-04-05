/**
 * @file nip-skl-skill-registration.test.ts
 * @description Unit tests for NIP-SKL skill lifecycle management.
 *
 * Tests cover:
 * 1. buildSkillManifest()     — kind:33400 event structure and required tags
 * 2. buildSkillAttestation()  — kind:1985 NIP-32 labels (tier, verified, e-tag)
 * 3. buildSkillVersionLog()   — kind:33401 version history tracking
 * 4. buildSkillRevocation()   — kind:5 NIP-09 deletion with optional reason
 * 5. SkillManager.registerSkill()     — signs, hashes, and publishes manifest
 * 6. SkillManager.attestSkill()       — publishes attestation event
 * 7. SkillManager.updateSkillVersion() — new manifest + version log + optional revocation
 * 8. SkillManager.revokeSkill()       — publishes deletion event
 * 9. SkillManager.listSkills()        — queries relay and returns manifests
 * 10. SkillManager.getSkillWithAttestations() — fetches manifest + attestation status
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { SkillManifest } from '../../src/lib/nip-skl/types.js';
import {
  buildSkillManifest,
  buildSkillAttestation,
  buildSkillVersionLog,
  buildSkillRevocation,
  SkillManager,
} from '../../src/lib/nip-skl/skill-registration.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock CEPS
const mockPublishEvent = vi.fn().mockResolvedValue('published-event-id-0000');
const mockSignEvent = vi.fn().mockImplementation(async (event: any) => ({
  ...event,
  id: 'signed-event-id-' + Math.random().toString(36).slice(2, 10),
  pubkey: 'test-pubkey-' + '0'.repeat(52),
  sig: 'test-sig-' + '0'.repeat(119),
}));

const mockCeps = {
  publishEvent: mockPublishEvent,
  signEventWithActiveSession: mockSignEvent,
  list: vi.fn().mockResolvedValue([]),
  subscribeMany: vi.fn(),
  getRelays: vi.fn().mockReturnValue([]),
  setRelays: vi.fn(),
};

// Mock Vault
const mockVault = {
  storeNwcUri: vi.fn(),
  getNwcUri: vi.fn(),
  deleteNwcUri: vi.fn(),
};

// Mock manifest module
vi.mock('../../src/lib/nip-skl/manifest.js', async () => {
  const actual = await vi.importActual('../../src/lib/nip-skl/manifest.js') as any;
  return {
    ...actual,
    fetchSkillManifest: vi.fn(),
    validateManifest: vi.fn().mockReturnValue(true),
    computeManifestHash: vi.fn().mockResolvedValue('abc123def456' + '0'.repeat(52)),
    parseManifestContent: vi.fn(),
  };
});

// Mock attestation verifier
vi.mock('../../src/lib/nip-skl/attestation-verifier.js', () => ({
  verifyGuardianAttestation: vi.fn().mockResolvedValue({
    valid: true,
    reason: 'Valid attestation',
    tier: 'tier3',
    guardianPubkey: 'guardian' + '0'.repeat(56),
  }),
  checkAttestationTier: vi.fn(() => true),
  parseTierFromLabel: vi.fn(),
  getMinimumCrossPlatformTier: vi.fn(() => 'tier3'),
  tierMeetsMinimum: vi.fn(() => true),
}));

// Mock CEPS index
vi.mock('../../src/lib/ceps/index.js', () => ({
  listEventsWithCeps: vi.fn().mockResolvedValue([]),
  subscribeWithCeps: vi.fn(),
}));

import { fetchSkillManifest, validateManifest, computeManifestHash } from '../../src/lib/nip-skl/manifest.js';
import { verifyGuardianAttestation } from '../../src/lib/nip-skl/attestation-verifier.js';
import { listEventsWithCeps } from '../../src/lib/ceps/index.js';

const mockFetchSkillManifest = vi.mocked(fetchSkillManifest);
const mockVerifyGuardianAttestation = vi.mocked(verifyGuardianAttestation);
const mockListEventsWithCeps = vi.mocked(listEventsWithCeps);

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const BASE_MANIFEST_PARAMS = {
  scopeId: 'research-v2',
  name: 'Market Research',
  version: '2.0.0',
  description: 'Researches market data across public sources',
  capabilities: ['web_search', 'data_extraction', 'summarization'],
  tags: ['agent-skill', 'research'],
};

const MANIFEST_EVENT_ID = 'manifest0000' + '0'.repeat(52);
const GUARDIAN_PUBKEY = 'guardian000' + '0'.repeat(53);

function makeMockManifest(): SkillManifest {
  return {
    skillScopeId: `33400:pub000:research-v2:2.0.0`,
    version: '2.0.0',
    name: 'Market Research',
    description: 'Researches market data',
    inputSchema: {},
    outputSchema: {},
    runtimeConstraints: [],
    attestations: [],
    publisherPubkey: 'pub000' + '0'.repeat(58),
    manifestEventId: MANIFEST_EVENT_ID,
    rawEvent: {
      id: MANIFEST_EVENT_ID,
      pubkey: 'pub000' + '0'.repeat(58),
      created_at: 1700000000,
      kind: 33400,
      tags: [['d', 'research-v2'], ['name', 'Market Research'], ['version', '2.0.0']],
      content: '{}',
      sig: 'sig' + '0'.repeat(125),
    },
  };
}

// ---------------------------------------------------------------------------
// 1. buildSkillManifest
// ---------------------------------------------------------------------------

describe('buildSkillManifest()', () => {
  it('returns kind 33400 event', () => {
    const event = buildSkillManifest(BASE_MANIFEST_PARAMS);
    expect(event.kind).toBe(33400);
  });

  it('includes required tags: d, name, version, description, manifest_hash', () => {
    const event = buildSkillManifest(BASE_MANIFEST_PARAMS);
    const tags = event.tags;

    expect(tags.find((t) => t[0] === 'd')?.[1]).toBe('research-v2');
    expect(tags.find((t) => t[0] === 'name')?.[1]).toBe('Market Research');
    expect(tags.find((t) => t[0] === 'version')?.[1]).toBe('2.0.0');
    expect(tags.find((t) => t[0] === 'description')?.[1]).toMatch(/Researches/);
    expect(tags.find((t) => t[0] === 'manifest_hash')).toBeTruthy();
  });

  it('adds capability tags for each capability', () => {
    const event = buildSkillManifest(BASE_MANIFEST_PARAMS);
    const capTags = event.tags.filter((t) => t[0] === 'capability').map((t) => t[1]);
    expect(capTags).toContain('web_search');
    expect(capTags).toContain('data_extraction');
    expect(capTags).toContain('summarization');
  });

  it('adds t-tags for each tag', () => {
    const event = buildSkillManifest(BASE_MANIFEST_PARAMS);
    const tTags = event.tags.filter((t) => t[0] === 't').map((t) => t[1]);
    expect(tTags).toContain('agent-skill');
    expect(tTags).toContain('research');
  });

  it('includes expiry tag when expiryTimestamp is provided', () => {
    const expiry = Math.floor(Date.now() / 1000) + 86400;
    const event = buildSkillManifest({ ...BASE_MANIFEST_PARAMS, expiryTimestamp: expiry });
    const expiryTag = event.tags.find((t) => t[0] === 'expiry');
    expect(expiryTag?.[1]).toBe(expiry.toString());
  });

  it('omits expiry tag when expiryTimestamp is not provided', () => {
    const event = buildSkillManifest(BASE_MANIFEST_PARAMS);
    expect(event.tags.find((t) => t[0] === 'expiry')).toBeUndefined();
  });

  it('sets created_at to current unix timestamp', () => {
    const before = Math.floor(Date.now() / 1000);
    const event = buildSkillManifest(BASE_MANIFEST_PARAMS);
    const after = Math.floor(Date.now() / 1000);
    expect(event.created_at).toBeGreaterThanOrEqual(before);
    expect(event.created_at).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// 2. buildSkillAttestation
// ---------------------------------------------------------------------------

describe('buildSkillAttestation()', () => {
  it('returns kind 1985 event', () => {
    const event = buildSkillAttestation({ manifestEventId: MANIFEST_EVENT_ID, tier: 'tier3' });
    expect(event.kind).toBe(1985);
  });

  it('includes required NIP-32 tags: L, l/skill/verified, l/tier, e', () => {
    const event = buildSkillAttestation({ manifestEventId: MANIFEST_EVENT_ID, tier: 'tier3' });
    const tags = event.tags;

    expect(tags.find((t) => t[0] === 'L')?.[1]).toBe('skill');
    expect(tags.some((t) => t[0] === 'l' && t[1] === 'skill/verified')).toBe(true);
    expect(tags.some((t) => t[0] === 'l' && t[1] === 'tier3')).toBe(true);
    expect(tags.find((t) => t[0] === 'e')?.[1]).toBe(MANIFEST_EVENT_ID);
  });

  it('uses the correct tier label for each tier', () => {
    for (const tier of ['tier1', 'tier2', 'tier3', 'tier4'] as const) {
      const event = buildSkillAttestation({ manifestEventId: MANIFEST_EVENT_ID, tier });
      expect(event.tags.some((t) => t[0] === 'l' && t[1] === tier)).toBe(true);
    }
  });

  it('has empty content', () => {
    const event = buildSkillAttestation({ manifestEventId: MANIFEST_EVENT_ID, tier: 'tier2' });
    expect(event.content).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 3. buildSkillVersionLog
// ---------------------------------------------------------------------------

describe('buildSkillVersionLog()', () => {
  it('returns kind 33401 event', () => {
    const event = buildSkillVersionLog({
      scopeId: 'research-v2',
      previousVersion: '1.0.0',
      newVersion: '2.0.0',
      changeType: 'major',
      manifestEventId: MANIFEST_EVENT_ID,
    });
    expect(event.kind).toBe(33401);
  });

  it('includes all required tags', () => {
    const event = buildSkillVersionLog({
      scopeId: 'research-v2',
      previousVersion: '1.0.0',
      newVersion: '2.0.0',
      changeType: 'minor',
      manifestEventId: MANIFEST_EVENT_ID,
    });

    const tags = event.tags;
    expect(tags.find((t) => t[0] === 'd')?.[1]).toBe('research-v2');
    expect(tags.find((t) => t[0] === 'previous_version')?.[1]).toBe('1.0.0');
    expect(tags.find((t) => t[0] === 'new_version')?.[1]).toBe('2.0.0');
    expect(tags.find((t) => t[0] === 'change_type')?.[1]).toBe('minor');
    expect(tags.find((t) => t[0] === 'e')?.[1]).toBe(MANIFEST_EVENT_ID);
  });

  it('includes revoked_at tag when revokedAt is provided', () => {
    const revokedAt = Math.floor(Date.now() / 1000);
    const event = buildSkillVersionLog({
      scopeId: 'research-v2',
      previousVersion: '1.0.0',
      newVersion: '2.0.0',
      changeType: 'patch',
      manifestEventId: MANIFEST_EVENT_ID,
      revokedAt,
    });
    expect(event.tags.find((t) => t[0] === 'revoked_at')?.[1]).toBe(revokedAt.toString());
  });

  it('omits revoked_at when not provided', () => {
    const event = buildSkillVersionLog({
      scopeId: 'research-v2',
      previousVersion: '1.0.0',
      newVersion: '2.0.0',
      changeType: 'patch',
      manifestEventId: MANIFEST_EVENT_ID,
    });
    expect(event.tags.find((t) => t[0] === 'revoked_at')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. buildSkillRevocation
// ---------------------------------------------------------------------------

describe('buildSkillRevocation()', () => {
  it('returns kind 5 event (NIP-09 deletion)', () => {
    const event = buildSkillRevocation(MANIFEST_EVENT_ID);
    expect(event.kind).toBe(5);
  });

  it('includes e-tag referencing the manifest event ID', () => {
    const event = buildSkillRevocation(MANIFEST_EVENT_ID);
    expect(event.tags.find((t) => t[0] === 'e')?.[1]).toBe(MANIFEST_EVENT_ID);
  });

  it('includes reason in content when provided', () => {
    const event = buildSkillRevocation(MANIFEST_EVENT_ID, 'Security vulnerability discovered');
    expect(event.content).toBe('Security vulnerability discovered');
  });

  it('has empty content when no reason is provided', () => {
    const event = buildSkillRevocation(MANIFEST_EVENT_ID);
    expect(event.content).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 5. SkillManager — registerSkill
// ---------------------------------------------------------------------------

describe('SkillManager.registerSkill()', () => {
  let manager: SkillManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SkillManager(mockCeps as any, mockVault as any);
    mockPublishEvent.mockResolvedValue('published-manifest-id');
  });

  it('calls signEventWithActiveSession with kind:33400 event', async () => {
    await manager.registerSkill({
      ...BASE_MANIFEST_PARAMS,
      signerNsec: 'a'.repeat(64),
      relayUrls: ['wss://relay.example.com'],
    });

    expect(mockSignEvent).toHaveBeenCalledOnce();
    const signedArg = mockSignEvent.mock.calls[0][0];
    expect(signedArg.kind).toBe(33400);
  });

  it('replaces placeholder manifest_hash with computed SHA-256', async () => {
    vi.mocked(computeManifestHash).mockResolvedValue('realHash' + '0'.repeat(56));

    await manager.registerSkill({
      ...BASE_MANIFEST_PARAMS,
      signerNsec: 'a'.repeat(64),
      relayUrls: [],
    });

    const signedArg = mockSignEvent.mock.calls[0][0];
    const hashTag = signedArg.tags.find((t: string[]) => t[0] === 'manifest_hash');
    expect(hashTag[1]).not.toBe('pending');
  });

  it('calls publishEvent and returns the event ID', async () => {
    const eventId = await manager.registerSkill({
      ...BASE_MANIFEST_PARAMS,
      signerNsec: 'a'.repeat(64),
      relayUrls: ['wss://relay.example.com'],
    });

    expect(mockPublishEvent).toHaveBeenCalledOnce();
    expect(typeof eventId).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 6. SkillManager — attestSkill
// ---------------------------------------------------------------------------

describe('SkillManager.attestSkill()', () => {
  let manager: SkillManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SkillManager(mockCeps as any, mockVault as any);
    mockPublishEvent.mockResolvedValue('attestation-event-id');
  });

  it('calls signEventWithActiveSession with kind:1985', async () => {
    await manager.attestSkill(MANIFEST_EVENT_ID, 'tier3', 'nsec' + '0'.repeat(60));

    const signedArg = mockSignEvent.mock.calls[0][0];
    expect(signedArg.kind).toBe(1985);
  });

  it('returns the published attestation event ID', async () => {
    const id = await manager.attestSkill(MANIFEST_EVENT_ID, 'tier3', 'nsec' + '0'.repeat(60));
    expect(id).toBe('attestation-event-id');
  });
});

// ---------------------------------------------------------------------------
// 7. SkillManager — updateSkillVersion
// ---------------------------------------------------------------------------

describe('SkillManager.updateSkillVersion()', () => {
  let manager: SkillManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SkillManager(mockCeps as any, mockVault as any);

    let callCount = 0;
    mockPublishEvent.mockImplementation(async () => `event-${++callCount}`);
  });

  it('publishes a new manifest (kind:33400) and a version log (kind:33401)', async () => {
    await manager.updateSkillVersion({
      scopeId: 'research-v2',
      oldManifestEventId: MANIFEST_EVENT_ID,
      previousVersion: '1.0.0',
      newVersion: '2.0.0',
      changeType: 'major',
      revokeOldVersion: false,
      newManifest: {
        name: 'Market Research v2',
        description: 'Updated research skill',
        capabilities: ['web_search'],
        tags: ['agent-skill'],
      },
      signerNsec: 'a'.repeat(64),
      relayUrls: [],
    });

    // Should have been called at least twice: manifest + version log
    expect(mockPublishEvent.mock.calls.length).toBeGreaterThanOrEqual(2);

    const signedKinds = mockSignEvent.mock.calls.map((c) => c[0].kind);
    expect(signedKinds).toContain(33400); // new manifest
    expect(signedKinds).toContain(33401); // version log
  });

  it('publishes kind:5 revocation when revokeOldVersion is true', async () => {
    await manager.updateSkillVersion({
      scopeId: 'research-v2',
      oldManifestEventId: MANIFEST_EVENT_ID,
      previousVersion: '1.0.0',
      newVersion: '2.0.0',
      changeType: 'major',
      revokeOldVersion: true,
      newManifest: {
        name: 'Market Research v2',
        description: 'Updated',
        capabilities: [],
        tags: [],
      },
      signerNsec: 'a'.repeat(64),
      relayUrls: [],
    });

    const signedKinds = mockSignEvent.mock.calls.map((c) => c[0].kind);
    expect(signedKinds).toContain(5); // revocation
  });

  it('returns the new manifest event ID', async () => {
    const id = await manager.updateSkillVersion({
      scopeId: 'research-v2',
      oldManifestEventId: MANIFEST_EVENT_ID,
      previousVersion: '1.0.0',
      newVersion: '2.0.0',
      changeType: 'minor',
      revokeOldVersion: false,
      newManifest: {
        name: 'Market Research',
        description: 'Updated',
        capabilities: [],
        tags: [],
      },
      signerNsec: 'a'.repeat(64),
      relayUrls: [],
    });
    expect(typeof id).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 8. SkillManager — revokeSkill
// ---------------------------------------------------------------------------

describe('SkillManager.revokeSkill()', () => {
  let manager: SkillManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SkillManager(mockCeps as any, mockVault as any);
    mockPublishEvent.mockResolvedValue('revocation-event-id');
  });

  it('signs a kind:5 deletion event', async () => {
    await manager.revokeSkill(MANIFEST_EVENT_ID, 'a'.repeat(64));

    const signedArg = mockSignEvent.mock.calls[0][0];
    expect(signedArg.kind).toBe(5);
  });

  it('includes the e-tag referencing the manifest', async () => {
    await manager.revokeSkill(MANIFEST_EVENT_ID, 'a'.repeat(64));

    const signedArg = mockSignEvent.mock.calls[0][0];
    expect(signedArg.tags.find((t: string[]) => t[0] === 'e')?.[1]).toBe(MANIFEST_EVENT_ID);
  });

  it('returns the published revocation event ID', async () => {
    const id = await manager.revokeSkill(MANIFEST_EVENT_ID, 'a'.repeat(64));
    expect(id).toBe('revocation-event-id');
  });
});

// ---------------------------------------------------------------------------
// 9. SkillManager — listSkills
// ---------------------------------------------------------------------------

describe('SkillManager.listSkills()', () => {
  let manager: SkillManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SkillManager(mockCeps as any, mockVault as any);
  });

  it('queries kind:33400 events for the publisher pubkey', async () => {
    mockListEventsWithCeps.mockResolvedValue([]);
    const pubkey = 'publisher' + '0'.repeat(55);
    await manager.listSkills(pubkey, 'wss://relay.example.com');

    expect(mockListEventsWithCeps).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ kinds: [33400], authors: [pubkey] }),
      ]),
      expect.any(Array),
      expect.any(Object)
    );
  });

  it('returns an empty array when no manifests are found', async () => {
    mockListEventsWithCeps.mockResolvedValue([]);
    const skills = await manager.listSkills('pub' + '0'.repeat(61), 'wss://relay.example.com');
    expect(skills).toEqual([]);
  });

  it('filters out invalid manifest events', async () => {
    mockListEventsWithCeps.mockResolvedValue([
      // First event: invalid kind (would fail validateManifest)
      { id: 'e1', kind: 1, pubkey: 'pub', created_at: 100, tags: [], content: '', sig: 's' },
    ] as any);

    vi.mocked(validateManifest).mockReturnValue(false);

    const skills = await manager.listSkills('pub' + '0'.repeat(61), 'wss://relay.example.com');
    expect(skills).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 10. SkillManager — getSkillWithAttestations
// ---------------------------------------------------------------------------

describe('SkillManager.getSkillWithAttestations()', () => {
  let manager: SkillManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SkillManager(mockCeps as any, mockVault as any);
  });

  it('throws when the manifest is not found', async () => {
    mockFetchSkillManifest.mockResolvedValue(null);

    await expect(
      manager.getSkillWithAttestations('33400:pub:skill:1.0.0', 'wss://relay.example.com')
    ).rejects.toThrow(/not found/i);
  });

  it('returns manifest + attestationResult + attestations on success', async () => {
    const mockManifest = makeMockManifest();
    mockFetchSkillManifest.mockResolvedValue(mockManifest);
    mockVerifyGuardianAttestation.mockResolvedValue({
      valid: true,
      reason: 'Valid attestation',
      tier: 'tier3',
      guardianPubkey: GUARDIAN_PUBKEY,
    });

    const result = await manager.getSkillWithAttestations(
      mockManifest.skillScopeId,
      'wss://relay.example.com'
    );

    expect(result.manifest).toBe(mockManifest);
    expect(result.attestationResult.valid).toBe(true);
    expect(result.attestationResult.tier).toBe('tier3');
    expect(Array.isArray(result.attestations)).toBe(true);
  });
});
