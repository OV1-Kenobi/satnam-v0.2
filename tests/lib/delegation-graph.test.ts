/**
 * Tests for src/lib/nip26/graph.ts
 *
 * DelegationGraph — graph operations, chain traversal, role resolution,
 * capability checks, relay sync, persistence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks for dependencies
// ---------------------------------------------------------------------------

vi.mock('@noble/hashes/sha256', () => ({
  sha256: vi.fn((data: Uint8Array) => {
    const result = new Uint8Array(32);
    for (let i = 0; i < data.length; i++) result[i % 32] ^= data[i];
    return result;
  }),
}));

vi.mock('@noble/hashes/utils', () => ({
  bytesToHex: (bytes: Uint8Array) =>
    Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''),
  hexToBytes: (hex: string) => {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    return arr;
  },
  utf8ToBytes: (s: string) => new TextEncoder().encode(s),
}));

// Mock verification — use a simplified pass-through
vi.mock('../../src/lib/nip26/verify.js', () => ({
  verifyDelegation: vi.fn(() => true),
  verifyDelegationChainAt: vi.fn(() => true),
  isDelegationCurrentlyValid: vi.fn(() => true),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { DelegationGraph } from '../../src/lib/nip26/graph.js';
import { RoleType } from '../../src/lib/nip26/types.js';
import type { DelegationEvent } from '../../src/lib/nip26/types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const GUARDIAN_PK = 'guardian' + '0'.repeat(57);
const STEWARD_PK  = 'steward0' + '0'.repeat(56);
const ADULT_PK    = 'adult000' + '0'.repeat(56);
const OFFSPRING_PK = 'offspring' + '0'.repeat(55);

function makeDelegation(
  delegatorPubkey: string,
  delegateePubkey: string,
  role: RoleType,
  conditions = 'kind=1',
): DelegationEvent {
  return {
    delegatorPubkey,
    delegateePubkey,
    conditions,
    signature: 'aa'.repeat(64),
    role,
    createdAt: new Date().toISOString(),
    nostrEventId: undefined,
  };
}

function buildFamilyGraph(): DelegationGraph {
  const graph = new DelegationGraph();
  graph.addGuardian(GUARDIAN_PK);

  // Guardian → Steward
  graph.addDelegation(makeDelegation(GUARDIAN_PK, STEWARD_PK, RoleType.Steward));
  // Steward → Adult
  graph.addDelegation(makeDelegation(STEWARD_PK, ADULT_PK, RoleType.Adult));
  // Adult → Offspring
  graph.addDelegation(makeDelegation(ADULT_PK, OFFSPRING_PK, RoleType.Offspring));

  return graph;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DelegationGraph', () => {
  let graph: DelegationGraph;

  beforeEach(() => {
    graph = new DelegationGraph();
  });

  // ── addDelegation ──────────────────────────────────────────────────────────

  describe('addDelegation', () => {
    it('adds delegation to the graph', () => {
      graph.addDelegation(makeDelegation(GUARDIAN_PK, STEWARD_PK, RoleType.Steward));
      expect(graph.size).toBe(1);
    });

    it('deduplicates by delegator+delegatee pair', () => {
      const d1 = makeDelegation(GUARDIAN_PK, STEWARD_PK, RoleType.Steward);
      const d2 = {
        ...makeDelegation(GUARDIAN_PK, STEWARD_PK, RoleType.Steward),
        createdAt: new Date(Date.now() + 1000).toISOString(),
      };
      graph.addDelegation(d1);
      graph.addDelegation(d2);
      expect(graph.size).toBe(1);
    });

    it('replaces older delegation with newer one', () => {
      const d1 = makeDelegation(GUARDIAN_PK, STEWARD_PK, RoleType.Steward);
      d1.conditions = 'kind=1';
      const d2 = {
        ...makeDelegation(GUARDIAN_PK, STEWARD_PK, RoleType.Steward),
        conditions: 'kind=1&kind=4',
        createdAt: new Date(Date.now() + 1000).toISOString(),
      };
      graph.addDelegation(d1);
      graph.addDelegation(d2);
      const delegations = graph.getDelegationsFrom(GUARDIAN_PK);
      expect(delegations[0].conditions).toBe('kind=1&kind=4');
    });
  });

  // ── addGuardian ─────────────────────────────────────────────────────────────

  describe('addGuardian', () => {
    it('registers a root Guardian', () => {
      graph.addGuardian(GUARDIAN_PK);
      const chain = graph.getChain(GUARDIAN_PK);
      expect(chain).toHaveLength(0);
    });

    it('assigns Guardian role to root pubkey', () => {
      graph.addGuardian(GUARDIAN_PK);
      expect(graph.getRole(GUARDIAN_PK)).toBe(RoleType.Guardian);
    });
  });

  // ── revokeDelegation ──────────────────────────────────────────────────────

  describe('revokeDelegation', () => {
    it('removes delegation from graph', () => {
      graph.addDelegation(makeDelegation(GUARDIAN_PK, STEWARD_PK, RoleType.Steward));
      graph.revokeDelegation(GUARDIAN_PK, STEWARD_PK);
      expect(graph.size).toBe(0);
    });

    it('is idempotent — no error for non-existent delegation', () => {
      expect(() => graph.revokeDelegation(GUARDIAN_PK, STEWARD_PK)).not.toThrow();
    });
  });

  // ── getChain ───────────────────────────────────────────────────────────────

  describe('getChain', () => {
    beforeEach(() => { graph = buildFamilyGraph(); });

    it('returns empty chain for Guardian', () => {
      expect(graph.getChain(GUARDIAN_PK)).toHaveLength(0);
    });

    it('returns one-element chain for Steward', () => {
      const chain = graph.getChain(STEWARD_PK);
      expect(chain).toHaveLength(1);
      expect(chain[0].delegatorPubkey).toBe(GUARDIAN_PK);
    });

    it('returns two-element chain for Adult', () => {
      const chain = graph.getChain(ADULT_PK);
      expect(chain).toHaveLength(2);
      expect(chain[0].delegatorPubkey).toBe(STEWARD_PK);
      expect(chain[1].delegatorPubkey).toBe(GUARDIAN_PK);
    });

    it('returns three-element chain for Offspring', () => {
      const chain = graph.getChain(OFFSPRING_PK);
      expect(chain).toHaveLength(3);
    });

    it('returns empty chain for unknown pubkey', () => {
      expect(graph.getChain('unknown' + '0'.repeat(57))).toHaveLength(0);
    });
  });

  // ── getDelegationsFrom / getDelegationsTo ──────────────────────────────────

  describe('getDelegationsFrom', () => {
    beforeEach(() => { graph = buildFamilyGraph(); });

    it('returns delegations issued by Guardian', () => {
      const ds = graph.getDelegationsFrom(GUARDIAN_PK);
      expect(ds).toHaveLength(1);
      expect(ds[0].delegateePubkey).toBe(STEWARD_PK);
    });

    it('returns empty array for Offspring (no delegations issued)', () => {
      expect(graph.getDelegationsFrom(OFFSPRING_PK)).toHaveLength(0);
    });
  });

  describe('getDelegationsTo', () => {
    beforeEach(() => { graph = buildFamilyGraph(); });

    it('returns delegations received by Steward', () => {
      const ds = graph.getDelegationsTo(STEWARD_PK);
      expect(ds).toHaveLength(1);
      expect(ds[0].delegatorPubkey).toBe(GUARDIAN_PK);
    });

    it('returns empty array for Guardian (no incoming delegations)', () => {
      expect(graph.getDelegationsTo(GUARDIAN_PK)).toHaveLength(0);
    });
  });

  // ── getRole ────────────────────────────────────────────────────────────────

  describe('getRole', () => {
    beforeEach(() => { graph = buildFamilyGraph(); });

    it('returns Guardian for root pubkey', () => {
      expect(graph.getRole(GUARDIAN_PK)).toBe(RoleType.Guardian);
    });

    it('returns Steward for delegated steward', () => {
      expect(graph.getRole(STEWARD_PK)).toBe(RoleType.Steward);
    });

    it('returns Adult for delegated adult', () => {
      expect(graph.getRole(ADULT_PK)).toBe(RoleType.Adult);
    });

    it('returns Offspring for delegated offspring', () => {
      expect(graph.getRole(OFFSPRING_PK)).toBe(RoleType.Offspring);
    });

    it('returns null for unknown pubkey', () => {
      expect(graph.getRole('unknown' + '0'.repeat(57))).toBeNull();
    });
  });

  // ── verifyChainAt ──────────────────────────────────────────────────────────

  describe('verifyChainAt', () => {
    beforeEach(() => { graph = buildFamilyGraph(); });

    it('returns true for Guardian (no chain needed)', () => {
      expect(graph.verifyChainAt(GUARDIAN_PK, Math.floor(Date.now() / 1000))).toBe(true);
    });

    it('returns true for valid chain (verifyDelegationChainAt mocked to true)', () => {
      expect(graph.verifyChainAt(STEWARD_PK, Math.floor(Date.now() / 1000))).toBe(true);
    });

    it('returns false for unknown pubkey', () => {
      const unknown = 'unknown' + '0'.repeat(57);
      // Unknown pubkey has no chain and is not a guardian
      expect(graph.verifyChainAt(unknown, Math.floor(Date.now() / 1000))).toBe(false);
    });
  });

  // ── hasCapability ──────────────────────────────────────────────────────────

  describe('hasCapability', () => {
    beforeEach(() => { graph = buildFamilyGraph(); });

    it('Guardian can create_group', () => {
      expect(graph.hasCapability(GUARDIAN_PK, 'create_group')).toBe(true);
    });

    it('Steward cannot create_group', () => {
      expect(graph.hasCapability(STEWARD_PK, 'create_group')).toBe(false);
    });

    it('Guardian can frost_initiate', () => {
      expect(graph.hasCapability(GUARDIAN_PK, 'frost_initiate')).toBe(true);
    });

    it('Steward cannot frost_initiate', () => {
      expect(graph.hasCapability(STEWARD_PK, 'frost_initiate')).toBe(false);
    });

    it('Steward can frost_participate', () => {
      expect(graph.hasCapability(STEWARD_PK, 'frost_participate')).toBe(true);
    });

    it('Adult can spend_lightning', () => {
      expect(graph.hasCapability(ADULT_PK, 'spend_lightning')).toBe(true);
    });

    it('Offspring cannot spend_lightning', () => {
      expect(graph.hasCapability(OFFSPRING_PK, 'spend_lightning')).toBe(false);
    });

    it('everyone can proof_of_life', () => {
      for (const pk of [GUARDIAN_PK, STEWARD_PK, ADULT_PK, OFFSPRING_PK]) {
        expect(graph.hasCapability(pk, 'proof_of_life')).toBe(true);
      }
    });

    it('returns false for unknown capability', () => {
      expect(graph.hasCapability(GUARDIAN_PK, 'unknown_capability')).toBe(false);
    });

    it('returns false for unknown pubkey', () => {
      const unknown = 'unknown' + '0'.repeat(57);
      expect(graph.hasCapability(unknown, 'spend_lightning')).toBe(false);
    });
  });

  // ── getGroupMembers ────────────────────────────────────────────────────────

  describe('getGroupMembers', () => {
    beforeEach(() => { graph = buildFamilyGraph(); });

    it('returns all members reachable from Guardian', () => {
      const members = graph.getGroupMembers(GUARDIAN_PK);
      expect(members.length).toBe(4);
    });

    it('includes Guardian in members', () => {
      const members = graph.getGroupMembers(GUARDIAN_PK);
      const guardian = members.find(m => m.pubkey === GUARDIAN_PK);
      expect(guardian?.role).toBe(RoleType.Guardian);
    });

    it('includes all role levels', () => {
      const members = graph.getGroupMembers(GUARDIAN_PK);
      const roles = members.map(m => m.role);
      expect(roles).toContain(RoleType.Guardian);
      expect(roles).toContain(RoleType.Steward);
      expect(roles).toContain(RoleType.Adult);
      expect(roles).toContain(RoleType.Offspring);
    });
  });

  // ── allPubkeys / size ──────────────────────────────────────────────────────

  describe('graph properties', () => {
    it('size returns correct count', () => {
      expect(graph.size).toBe(0);
      graph.addDelegation(makeDelegation(GUARDIAN_PK, STEWARD_PK, RoleType.Steward));
      expect(graph.size).toBe(1);
      graph.addDelegation(makeDelegation(STEWARD_PK, ADULT_PK, RoleType.Adult));
      expect(graph.size).toBe(2);
    });

    it('allPubkeys returns unique set', () => {
      graph = buildFamilyGraph();
      const pubkeys = graph.allPubkeys;
      // Includes guardian, steward, adult, offspring + their delegators
      expect(pubkeys.length).toBeGreaterThanOrEqual(4);
      // No duplicates
      expect(new Set(pubkeys).size).toBe(pubkeys.length);
    });
  });

  // ── Serialization (internal consistency) ───────────────────────────────────

  describe('serialization round-trip', () => {
    it('preserves all delegations after serialize/deserialize', () => {
      graph = buildFamilyGraph();
      const data = (graph as any)._serialize();

      const graph2 = new DelegationGraph();
      (graph2 as any)._deserialize(data);

      expect(graph2.size).toBe(graph.size);
      expect(graph2.getRole(STEWARD_PK)).toBe(RoleType.Steward);
    });
  });
});
