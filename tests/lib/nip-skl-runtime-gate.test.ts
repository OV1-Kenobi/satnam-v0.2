/**
 * @file nip-skl-runtime-gate.test.ts
 * @description Unit tests for the NIP-SKL Runtime Gate — verifySkillExecution().
 *
 * Tests cover all 5 gate checks:
 * 1. manifestExists     — manifest not found, invalid signature, expired
 * 2. guardianAttestationValid — no attestation, untrusted guardian, valid attestation
 * 3. noRevocation       — revocation event present, no revocation event
 * 4. versionPinMatches  — matching event IDs, mismatched event IDs
 * 5. constraintsSatisfied — skill in enabled_skills, skill NOT in enabled_skills
 *
 * All mocks use vi.mock() to avoid real relay WebSocket connections.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { SkillManifest, NostrEvent, RuntimeGateResult } from '../../src/lib/nip-skl/types.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

/** A minimal valid Nostr event for kind:33400. */
function makeManifestEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'aaaa0000' + '0'.repeat(56),
    pubkey: 'bbbb0000' + '0'.repeat(56),
    created_at: Math.floor(Date.now() / 1000),
    kind: 33400,
    tags: [
      ['d', 'test-skill'],
      ['name', 'Test Skill'],
      ['version', '1.0.0'],
      ['description', 'A test skill'],
    ],
    content: '{}',
    sig: 'cc' + '0'.repeat(126),
    ...overrides,
  };
}

/** Build a SkillManifest from a raw event. */
function makeManifest(eventOverrides: Partial<NostrEvent> = {}): SkillManifest {
  const rawEvent = makeManifestEvent(eventOverrides);
  return {
    skillScopeId: `33400:${rawEvent.pubkey}:test-skill:1.0.0`,
    version: '1.0.0',
    name: 'Test Skill',
    description: 'A test skill',
    inputSchema: {},
    outputSchema: {},
    runtimeConstraints: [],
    attestations: [
      {
        guardianPubkey: 'guardian000' + '0'.repeat(53),
        manifestEventId: rawEvent.id,
        label: 'skill/verified/tier3',
        tier: 'tier3',
        timestamp: rawEvent.created_at,
      },
    ],
    publisherPubkey: rawEvent.pubkey,
    manifestEventId: rawEvent.id,
    rawEvent,
  };
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Mock fetchSkillManifest and validateManifest from manifest.ts
vi.mock('../../src/lib/nip-skl/manifest.js', () => ({
  fetchSkillManifest: vi.fn(),
  validateManifest: vi.fn(),
  parseManifestContent: vi.fn(),
  computeManifestHash: vi.fn(),
  verifyManifestHash: vi.fn(),
}));

// Mock verifyGuardianAttestation from attestation-verifier.ts
vi.mock('../../src/lib/nip-skl/attestation-verifier.js', () => ({
  verifyGuardianAttestation: vi.fn(),
  checkAttestationTier: vi.fn(() => true),
  parseTierFromLabel: vi.fn((label: string) => {
    const m = label.match(/tier([1-4])$/);
    return m ? `tier${m[1]}` : undefined;
  }),
  getMinimumCrossPlatformTier: vi.fn(() => 'tier3'),
  tierMeetsMinimum: vi.fn((tier: string, min: string) => {
    const levels: Record<string, number> = { tier1: 1, tier2: 2, tier3: 3, tier4: 4 };
    return (levels[tier] ?? 0) >= (levels[min] ?? 0);
  }),
}));

// Mock CEPS listEventsWithCeps (for revocation check)
vi.mock('../../src/lib/ceps/index.js', () => ({
  listEventsWithCeps: vi.fn(),
  subscribeWithCeps: vi.fn(),
  getCepsClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the module under test after mocks are set up
// ---------------------------------------------------------------------------

import { verifySkillExecution } from '../../src/lib/nip-skl/runtime-gate.js';
import { fetchSkillManifest, validateManifest } from '../../src/lib/nip-skl/manifest.js';
import { verifyGuardianAttestation, tierMeetsMinimum } from '../../src/lib/nip-skl/attestation-verifier.js';
import { listEventsWithCeps } from '../../src/lib/ceps/index.js';

// Typed mock references
const mockFetchSkillManifest = vi.mocked(fetchSkillManifest);
const mockValidateManifest = vi.mocked(validateManifest);
const mockVerifyGuardianAttestation = vi.mocked(verifyGuardianAttestation);
const mockTierMeetsMinimum = vi.mocked(tierMeetsMinimum);
const mockListEventsWithCeps = vi.mocked(listEventsWithCeps);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set up all mocks for a "happy path" (all 5 checks pass). */
function setupHappyPath(manifest: SkillManifest): void {
  mockFetchSkillManifest.mockResolvedValue(manifest);
  mockValidateManifest.mockReturnValue(true);
  mockVerifyGuardianAttestation.mockResolvedValue({
    valid: true,
    reason: 'Valid guardian attestation found',
    tier: 'tier3',
    guardianPubkey: manifest.attestations[0]?.guardianPubkey,
  });
  mockTierMeetsMinimum.mockReturnValue(true);
  mockListEventsWithCeps.mockResolvedValue([]); // No revocation events
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('verifySkillExecution — Runtime Gate', () => {
  const SCOPE_ID = '33400:bbbb0000' + '0'.repeat(56) + ':test-skill:1.0.0';
  const MANIFEST_EVENT_ID = 'aaaa0000' + '0'.repeat(56);

  let manifest: SkillManifest;

  beforeEach(() => {
    manifest = makeManifest();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // CHECK 1: manifestExists
  // =========================================================================

  describe('Check 1 — manifestExists', () => {
    it('fails when fetchSkillManifest throws', async () => {
      mockFetchSkillManifest.mockRejectedValue(new Error('Relay unreachable'));

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID);

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Manifest fetch failed/);
      expect(result.checks?.manifestExists).toBe(false);
      expect(result.checks?.guardianAttestationValid).toBe(false);
    });

    it('fails when fetchSkillManifest returns null', async () => {
      mockFetchSkillManifest.mockResolvedValue(null);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID);

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/not found/i);
      expect(result.checks?.manifestExists).toBe(false);
    });

    it('fails when manifest is returned without rawEvent', async () => {
      const noRaw = { ...manifest, rawEvent: undefined };
      mockFetchSkillManifest.mockResolvedValue(noRaw as any);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID);

      expect(result.allowed).toBe(false);
      expect(result.checks?.manifestExists).toBe(false);
    });

    it('fails when validateManifest returns false (invalid signature)', async () => {
      mockFetchSkillManifest.mockResolvedValue(manifest);
      mockValidateManifest.mockReturnValue(false);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID);

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/signature|structure/i);
      expect(result.checks?.manifestExists).toBe(false);
    });

    it('fails when manifest has expired (validUntilUnix in the past)', async () => {
      const expiredManifest: SkillManifest = {
        ...manifest,
        validUntilUnix: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      };
      mockFetchSkillManifest.mockResolvedValue(expiredManifest);
      mockValidateManifest.mockReturnValue(true);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID);

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/expired/i);
      expect(result.checks?.manifestExists).toBe(false);
    });

    it('passes check 1 when manifest is valid and not expired', async () => {
      setupHappyPath(manifest);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID);

      expect(result.checks?.manifestExists).toBe(true);
    });
  });

  // =========================================================================
  // CHECK 2: guardianAttestationValid
  // =========================================================================

  describe('Check 2 — guardianAttestationValid', () => {
    it('fails when verifyGuardianAttestation returns invalid', async () => {
      mockFetchSkillManifest.mockResolvedValue(manifest);
      mockValidateManifest.mockReturnValue(true);
      mockVerifyGuardianAttestation.mockResolvedValue({
        valid: false,
        reason: 'No attestations from trusted guardians',
      });

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID);

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Guardian attestation invalid/);
      expect(result.checks?.manifestExists).toBe(true);
      expect(result.checks?.guardianAttestationValid).toBe(false);
    });

    it('fails when attestation tier is insufficient for required tier', async () => {
      mockFetchSkillManifest.mockResolvedValue(manifest);
      mockValidateManifest.mockReturnValue(true);
      mockVerifyGuardianAttestation.mockResolvedValue({
        valid: true,
        reason: 'Valid attestation found',
        tier: 'tier1',
      });
      // Override tierMeetsMinimum to return false
      mockTierMeetsMinimum.mockReturnValue(false);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID, {
        requiredTier: 'tier3',
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/tier insufficient/i);
      expect(result.checks?.guardianAttestationValid).toBe(false);
    });

    it('passes check 2 with valid tier3 attestation when tier3 is required', async () => {
      setupHappyPath(manifest);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID, {
        requiredTier: 'tier3',
      });

      expect(result.checks?.guardianAttestationValid).toBe(true);
    });

    it('passes check 2 with tier4 attestation when tier3 is required', async () => {
      mockFetchSkillManifest.mockResolvedValue(manifest);
      mockValidateManifest.mockReturnValue(true);
      mockVerifyGuardianAttestation.mockResolvedValue({
        valid: true,
        reason: 'Valid attestation',
        tier: 'tier4',
      });
      mockTierMeetsMinimum.mockReturnValue(true); // tier4 >= tier3
      mockListEventsWithCeps.mockResolvedValue([]);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID, {
        requiredTier: 'tier3',
      });

      expect(result.checks?.guardianAttestationValid).toBe(true);
    });
  });

  // =========================================================================
  // CHECK 3: noRevocation
  // =========================================================================

  describe('Check 3 — noRevocation', () => {
    it('fails when a kind:5 deletion event is found for the manifest', async () => {
      mockFetchSkillManifest.mockResolvedValue(manifest);
      mockValidateManifest.mockReturnValue(true);
      mockVerifyGuardianAttestation.mockResolvedValue({
        valid: true,
        reason: 'Valid',
        tier: 'tier3',
      });
      mockTierMeetsMinimum.mockReturnValue(true);
      // Return a deletion event
      mockListEventsWithCeps.mockResolvedValue([
        {
          id: 'del0001' + '0'.repeat(57),
          pubkey: manifest.publisherPubkey,
          kind: 5,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['e', MANIFEST_EVENT_ID]],
          content: 'Security vulnerability found',
          sig: 'sig' + '0'.repeat(125),
        },
      ] as any);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID);

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/revoked/i);
      expect(result.checks?.manifestExists).toBe(true);
      expect(result.checks?.guardianAttestationValid).toBe(true);
      expect(result.checks?.noRevocation).toBe(false);
    });

    it('treats revocation relay query failure as non-revoked (non-fatal)', async () => {
      mockFetchSkillManifest.mockResolvedValue(manifest);
      mockValidateManifest.mockReturnValue(true);
      mockVerifyGuardianAttestation.mockResolvedValue({
        valid: true,
        reason: 'Valid',
        tier: 'tier3',
      });
      mockTierMeetsMinimum.mockReturnValue(true);
      // Relay query throws
      mockListEventsWithCeps.mockRejectedValue(new Error('WebSocket connection lost'));

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID);

      // Gate should continue — revocation check failure is non-fatal
      expect(result.checks?.noRevocation).toBe(true);
    });

    it('passes check 3 when no revocation events are found', async () => {
      setupHappyPath(manifest);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID);

      expect(result.checks?.noRevocation).toBe(true);
    });
  });

  // =========================================================================
  // CHECK 4: versionPinMatches
  // =========================================================================

  describe('Check 4 — versionPinMatches (constant-time)', () => {
    it('fails when manifestEventId does not match the version pin', async () => {
      setupHappyPath(manifest);

      const wrongPin = 'ffff0000' + '0'.repeat(56);
      const result = await verifySkillExecution(SCOPE_ID, wrongPin);

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Version pin mismatch/);
      expect(result.checks?.noRevocation).toBe(true);
      expect(result.checks?.versionPinMatches).toBe(false);
    });

    it('passes when manifestEventId exactly matches the relay manifest ID', async () => {
      setupHappyPath(manifest);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID);

      expect(result.checks?.versionPinMatches).toBe(true);
    });

    it('uses constant-time comparison (timing-safe) — does not throw', async () => {
      setupHappyPath(manifest);

      // Test multiple mismatched inputs — should all return gracefully
      const inputs = [
        'a'.repeat(64),
        '0'.repeat(64),
        MANIFEST_EVENT_ID.slice(0, 32) + 'f'.repeat(32),
        '',
      ];

      for (const pin of inputs) {
        const result = await verifySkillExecution(SCOPE_ID, pin);
        expect(typeof result.allowed).toBe('boolean');
        // Should not throw — all errors caught internally
      }
    });
  });

  // =========================================================================
  // CHECK 5: constraintsSatisfied
  // =========================================================================

  describe('Check 5 — constraintsSatisfied', () => {
    it('fails when skill is not in agent enabled_skills list', async () => {
      setupHappyPath(manifest);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID, {
        agentPubkey: 'agent000' + '0'.repeat(56),
        agentProfileTags: [
          ['enabled_skills', 'some-other-skill', 'another-skill'],
        ],
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/enabled_skills/i);
      expect(result.checks?.versionPinMatches).toBe(true);
      expect(result.checks?.constraintsSatisfied).toBe(false);
    });

    it('passes when skill scopeId is in enabled_skills', async () => {
      setupHappyPath(manifest);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID, {
        agentProfileTags: [
          ['enabled_skills', manifest.skillScopeId, 'another-skill'],
        ],
      });

      expect(result.allowed).toBe(true);
      expect(result.checks?.constraintsSatisfied).toBe(true);
    });

    it('passes when skill d-tag is in enabled_skills (short form)', async () => {
      setupHappyPath(manifest);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID, {
        agentProfileTags: [
          ['enabled_skills', 'test-skill'],
        ],
      });

      expect(result.allowed).toBe(true);
      expect(result.checks?.constraintsSatisfied).toBe(true);
    });

    it('passes when no agentProfileTags are provided (no enabled_skills check)', async () => {
      setupHappyPath(manifest);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID, {
        agentPubkey: 'agent' + '0'.repeat(59),
        // No agentProfileTags — skip enabled_skills check
      });

      expect(result.allowed).toBe(true);
      expect(result.checks?.constraintsSatisfied).toBe(true);
    });

    it('passes when agent profile has no enabled_skills tag (all skills allowed)', async () => {
      setupHappyPath(manifest);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID, {
        agentProfileTags: [
          ['d', 'profile'],
          ['operator', 'op' + '0'.repeat(62)],
          // No enabled_skills tag
        ],
      });

      expect(result.allowed).toBe(true);
      expect(result.checks?.constraintsSatisfied).toBe(true);
    });
  });

  // =========================================================================
  // Full happy path — all 5 checks pass
  // =========================================================================

  describe('Full happy path', () => {
    it('returns allowed:true with all checks set to true', async () => {
      setupHappyPath(manifest);

      const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID, {
        requiredTier: 'tier3',
        agentProfileTags: [
          ['enabled_skills', manifest.skillScopeId],
        ],
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toMatch(/All 5/i);
      expect(result.checks).toEqual({
        manifestExists: true,
        guardianAttestationValid: true,
        noRevocation: true,
        versionPinMatches: true,
        constraintsSatisfied: true,
      });
    });
  });

  // =========================================================================
  // Never throws
  // =========================================================================

  describe('Error safety — never throws', () => {
    it('never throws, even if all mocks fail', async () => {
      mockFetchSkillManifest.mockRejectedValue(new Error('Network error'));

      await expect(
        verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID)
      ).resolves.toMatchObject({ allowed: false });
    });

    it('returns RuntimeGateResult shape on every code path', async () => {
      const testCases = [
        () => mockFetchSkillManifest.mockResolvedValue(null),
        () => {
          mockFetchSkillManifest.mockResolvedValue(manifest);
          mockValidateManifest.mockReturnValue(false);
        },
        () => {
          mockFetchSkillManifest.mockResolvedValue(manifest);
          mockValidateManifest.mockReturnValue(true);
          mockVerifyGuardianAttestation.mockResolvedValue({ valid: false, reason: 'fail' });
        },
      ];

      for (const setup of testCases) {
        vi.clearAllMocks();
        setup();
        const result = await verifySkillExecution(SCOPE_ID, MANIFEST_EVENT_ID);
        expect(typeof result.allowed).toBe('boolean');
        expect(typeof result.reason).toBe('string');
        expect(result.checks).toBeDefined();
      }
    });
  });
});
