/**
 * Tests for src/lib/circle-of-trust/
 *
 * Circle of Trust — face-to-face verified contact management.
 *
 * Test coverage:
 * - TrustEngine: trust score calculation (all 4 factors)
 * - TrustEngine: diminishing returns on meeting depth (log scale)
 * - TrustEngine: time consistency scoring (linear)
 * - TrustEngine: mutual contacts scoring
 * - TrustEngine: financial trust scoring
 * - TrustEngine: composite score aggregation (0-100)
 * - TrustEngine: calculateCircleStats — aggregates correctly
 * - TrustEngine: getIdentityProfile
 * - TrustEngine: validateThirdParty
 * - TrustEngine: getSharedContacts
 * - TrustEngine: getHandshakeLedger (sorted by timestamp)
 * - TrustStore: addTrustedContact, getTrustedContact, removeTrustedContact
 * - TrustStore: addMeetingProof — accumulates meetings, updates trustDepth
 * - TrustStore: appendHandshakeEntry, getHandshakeLedger
 * - TrustStore: deduplication (no duplicate meetings or ledger entries)
 * - Meeting proof aggregation — multiple meetings deepen trust
 * - Trust depth accumulation — each ceremony adds to trustDepth
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// No external crypto mocks needed for pure logic tests

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  TrustEngine,
  TrustStore,
  createTrustEngine,
  createTrustStore,
  HIGH_TRUST_THRESHOLD,
  NEW_CONTACT_THRESHOLD,
} from '../../src/lib/circle-of-trust/index.js';
import type {
  TrustedContact,
  MeetingProof,
  HandshakeLedgerEntry,
  TrustScore,
  CircleOfTrustStats,
} from '../../src/lib/circle-of-trust/index.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ALICE_PUBKEY = 'aa'.repeat(32);
const BOB_PUBKEY = 'bb'.repeat(32);
const CHARLIE_PUBKEY = 'cc'.repeat(32);

const MEETING_1: MeetingProof = {
  attestationEventId: 'ev1' + '0'.repeat(61),
  blockHeight: 800_000,
  timestamp: Math.floor(Date.now() / 1000) - 180 * 86400, // 180 days ago
  welcomeMessageHash: 'aa'.repeat(32),
};

const MEETING_2: MeetingProof = {
  attestationEventId: 'ev2' + '0'.repeat(61),
  blockHeight: 850_000,
  timestamp: Math.floor(Date.now() / 1000) - 30 * 86400, // 30 days ago
  welcomeMessageHash: 'bb'.repeat(32),
};

const MEETING_3: MeetingProof = {
  attestationEventId: 'ev3' + '0'.repeat(61),
  blockHeight: 873_000,
  timestamp: Math.floor(Date.now() / 1000), // now
  welcomeMessageHash: 'cc'.repeat(32),
};

function makeContact(
  pubkey: string,
  meetings: MeetingProof[] = [MEETING_1],
  overrides: Partial<TrustedContact> = {},
): TrustedContact {
  return {
    pubkey,
    nfcCardHash: 'dead'.repeat(16),
    firstMeetingBlockHeight: meetings[0]?.blockHeight ?? 800_000,
    meetings,
    trustDepth: meetings.length,
    trustScore: 0, // will be computed by engine
    welcomeMessageId: '0'.repeat(64),
    addedAt: meetings[0]?.timestamp ?? Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Vault for TrustStore tests
// ---------------------------------------------------------------------------

function createMockVault() {
  const storage = new Map<string, Uint8Array>();
  return {
    isUnlocked: vi.fn(() => true),
    storeNfcKey: vi.fn(async (uid: string, slot: string, key: Uint8Array) => {
      storage.set(`${uid}:${slot}`, key);
    }),
    getNfcKey: vi.fn(async (uid: string, slot: string) => {
      const key = storage.get(`${uid}:${slot}`);
      if (!key) throw new Error(`Not found: ${uid}:${slot}`);
      return key;
    }),
    _storage: storage,
  };
}

// ===========================================================================
// TrustEngine tests
// ===========================================================================

describe('TrustEngine', () => {
  // ── _scoreMeetingDepth ────────────────────────────────────────────────────

  describe('_scoreMeetingDepth (log scale, 0-30)', () => {
    let engine: TrustEngine;

    beforeEach(() => {
      engine = createTrustEngine([]);
    });

    it('returns 0 for 0 meetings', () => {
      expect(engine._scoreMeetingDepth(0)).toBe(0);
    });

    it('returns > 0 for 1 meeting', () => {
      const score = engine._scoreMeetingDepth(1);
      expect(score).toBeGreaterThan(0);
    });

    it('returns max 30 for 10+ meetings', () => {
      expect(engine._scoreMeetingDepth(10)).toBe(30);
      expect(engine._scoreMeetingDepth(50)).toBe(30);
    });

    it('shows diminishing returns (each new meeting adds less)', () => {
      const s1 = engine._scoreMeetingDepth(1);
      const s2 = engine._scoreMeetingDepth(2);
      const s3 = engine._scoreMeetingDepth(3);
      const delta12 = s2 - s1;
      const delta23 = s3 - s2;
      expect(delta12).toBeGreaterThanOrEqual(delta23);
    });

    it('is monotonically increasing', () => {
      let prev = 0;
      for (let n = 1; n <= 10; n++) {
        const score = engine._scoreMeetingDepth(n);
        expect(score).toBeGreaterThanOrEqual(prev);
        prev = score;
      }
    });

    /**
     * Formula: Math.round(30 * log2(n+1) / log2(11))
     *
     * For n=3: Math.round(30 * log2(4) / log2(11))
     *        = Math.round(30 * 2 / 3.4594...)
     *        = Math.round(17.356...)
     *        = 17
     *
     * The range [16, 19] covers the actual result (17) with reasonable
     * tolerance while confirming the log-scale diminishing-returns property.
     */
    it('score for 3 meetings is in the expected log-scale range (16–19)', () => {
      const score = engine._scoreMeetingDepth(3);
      expect(score).toBeGreaterThanOrEqual(16);
      expect(score).toBeLessThanOrEqual(19);
    });
  });

  // ── _scoreTimeConsistency ─────────────────────────────────────────────────

  describe('_scoreTimeConsistency (linear, 0-30)', () => {
    let engine: TrustEngine;

    beforeEach(() => {
      engine = createTrustEngine([]);
    });

    it('returns 0 for 0 days', () => {
      expect(engine._scoreTimeConsistency(0)).toBe(0);
    });

    it('returns 30 for 365+ days', () => {
      expect(engine._scoreTimeConsistency(365)).toBe(30);
      expect(engine._scoreTimeConsistency(400)).toBe(30);
    });

    it('returns ~15 for 180 days (half of max)', () => {
      const score = engine._scoreTimeConsistency(180);
      expect(score).toBeGreaterThanOrEqual(14);
      expect(score).toBeLessThanOrEqual(16);
    });

    it('is monotonically increasing', () => {
      const days = [0, 30, 90, 180, 270, 365];
      let prev = -1;
      for (const d of days) {
        const score = engine._scoreTimeConsistency(d);
        expect(score).toBeGreaterThanOrEqual(prev);
        prev = score;
      }
    });
  });

  // ── _scoreMutualContacts ──────────────────────────────────────────────────

  describe('_scoreMutualContacts (linear, 0-20)', () => {
    let engine: TrustEngine;

    beforeEach(() => {
      engine = createTrustEngine([]);
    });

    it('returns 0 for 0 shared contacts', () => {
      expect(engine._scoreMutualContacts(0)).toBe(0);
    });

    it('returns 20 for 10+ shared contacts', () => {
      expect(engine._scoreMutualContacts(10)).toBe(20);
      expect(engine._scoreMutualContacts(100)).toBe(20);
    });

    it('returns 10 for 5 shared contacts', () => {
      expect(engine._scoreMutualContacts(5)).toBe(10);
    });

    it('returns 2 for 1 shared contact', () => {
      expect(engine._scoreMutualContacts(1)).toBe(2);
    });
  });

  // ── calculateTrustScore ───────────────────────────────────────────────────

  describe('calculateTrustScore', () => {
    it('returns composite 0-100', () => {
      const contact = makeContact(ALICE_PUBKEY, [MEETING_1]);
      const engine = createTrustEngine([contact]);
      const score = engine.calculateTrustScore(contact);

      expect(score.composite).toBeGreaterThanOrEqual(0);
      expect(score.composite).toBeLessThanOrEqual(100);
    });

    it('includes all four factors in breakdown', () => {
      const contact = makeContact(ALICE_PUBKEY, [MEETING_1]);
      const engine = createTrustEngine([contact]);
      const score = engine.calculateTrustScore(contact);

      expect(typeof score.factors.meetingDepth).toBe('number');
      expect(typeof score.factors.timeConsistency).toBe('number');
      expect(typeof score.factors.mutualContacts).toBe('number');
      expect(typeof score.factors.financialTrust).toBe('number');
    });

    it('composite equals sum of factors (capped at 100)', () => {
      const contact = makeContact(ALICE_PUBKEY, [MEETING_1]);
      const engine = createTrustEngine([contact]);
      const score = engine.calculateTrustScore(contact);
      const factorSum =
        score.factors.meetingDepth +
        score.factors.timeConsistency +
        score.factors.mutualContacts +
        score.factors.financialTrust;

      expect(score.composite).toBe(Math.min(100, Math.round(factorSum)));
    });

    it('factor scores are within their max bounds', () => {
      const contact = makeContact(ALICE_PUBKEY, [MEETING_1, MEETING_2, MEETING_3]);
      const engine = createTrustEngine([contact]);
      const score = engine.calculateTrustScore(contact);

      expect(score.factors.meetingDepth).toBeLessThanOrEqual(30);
      expect(score.factors.timeConsistency).toBeLessThanOrEqual(30);
      expect(score.factors.mutualContacts).toBeLessThanOrEqual(20);
      expect(score.factors.financialTrust).toBeLessThanOrEqual(20);
    });

    it('reports correct meetingCount and timeSpanDays', () => {
      const contact = makeContact(ALICE_PUBKEY, [MEETING_1, MEETING_2]);
      const engine = createTrustEngine([contact]);
      const score = engine.calculateTrustScore(contact);

      expect(score.meetingCount).toBe(2);
      // MEETING_1 is 180 days ago, MEETING_2 is 30 days ago → span = 150 days
      expect(score.timeSpanDays).toBeGreaterThan(100);
      expect(score.timeSpanDays).toBeLessThanOrEqual(200);
    });

    it('contact with more meetings scores higher than contact with fewer', () => {
      const contactFew = makeContact(ALICE_PUBKEY, [MEETING_1]);
      const contactMany = makeContact(BOB_PUBKEY, [MEETING_1, MEETING_2, MEETING_3]);
      const engine = createTrustEngine([contactFew, contactMany]);

      const scoreFew = engine.calculateTrustScore(contactFew);
      const scoreMany = engine.calculateTrustScore(contactMany);

      expect(scoreMany.composite).toBeGreaterThan(scoreFew.composite);
    });

    it('accepts pre-computed mutual contacts count', () => {
      const contact = makeContact(ALICE_PUBKEY, [MEETING_1]);
      const engine = createTrustEngine([contact]);

      const withMutual = engine.calculateTrustScore(contact, ['pub1', 'pub2', 'pub3']);
      const withoutMutual = engine.calculateTrustScore(contact, []);

      expect(withMutual.factors.mutualContacts).toBeGreaterThan(
        withoutMutual.factors.mutualContacts,
      );
    });
  });

  // ── calculateCircleStats ──────────────────────────────────────────────────

  describe('calculateCircleStats', () => {
    it('returns empty stats for empty circle', () => {
      const engine = createTrustEngine([]);
      const stats = engine.calculateCircleStats();

      expect(stats.totalContacts).toBe(0);
      expect(stats.avgTrustScore).toBe(0);
      expect(stats.totalMeetings).toBe(0);
    });

    it('counts total contacts correctly', () => {
      const contacts = [
        makeContact(ALICE_PUBKEY, [MEETING_1]),
        makeContact(BOB_PUBKEY, [MEETING_1, MEETING_2]),
        makeContact(CHARLIE_PUBKEY, [MEETING_1, MEETING_2, MEETING_3]),
      ];
      const engine = createTrustEngine(contacts);
      const stats = engine.calculateCircleStats();

      expect(stats.totalContacts).toBe(3);
    });

    it('sums total meetings across all contacts', () => {
      const contacts = [
        makeContact(ALICE_PUBKEY, [MEETING_1]),           // 1 meeting
        makeContact(BOB_PUBKEY, [MEETING_1, MEETING_2]),  // 2 meetings
      ];
      const engine = createTrustEngine(contacts);
      const stats = engine.calculateCircleStats();

      expect(stats.totalMeetings).toBe(3);
    });

    it('categorizes contacts by trust tier', () => {
      // Create a contact with high score (many meetings, long relationship)
      const highContact = makeContact(ALICE_PUBKEY, [
        { ...MEETING_1, timestamp: Math.floor(Date.now() / 1000) - 400 * 86400 },
        MEETING_2,
        MEETING_3,
        { ...MEETING_3, attestationEventId: 'ev4' + '0'.repeat(61), blockHeight: 875_000 },
      ]);
      // Create a new contact (1 meeting, recent)
      const newContact = makeContact(BOB_PUBKEY, [MEETING_3]);

      const engine = createTrustEngine([highContact, newContact]);
      const stats = engine.calculateCircleStats();

      expect(stats.totalContacts).toBe(2);
      // newContact should be in newContacts or mediumTrust tier
      expect(stats.highTrustContacts + stats.mediumTrustContacts + stats.newContacts)
        .toBe(2);
    });

    it('calculates average trust score', () => {
      const contacts = [
        makeContact(ALICE_PUBKEY, [MEETING_1]),
        makeContact(BOB_PUBKEY, [MEETING_1, MEETING_2]),
      ];
      const engine = createTrustEngine(contacts);
      const stats = engine.calculateCircleStats();

      expect(stats.avgTrustScore).toBeGreaterThanOrEqual(0);
      expect(stats.avgTrustScore).toBeLessThanOrEqual(100);
    });

    it('oldestRelationshipDays reflects the most ancient contact', () => {
      const oldContact = makeContact(ALICE_PUBKEY, [MEETING_1], {
        addedAt: Math.floor(Date.now() / 1000) - 365 * 86400, // 1 year ago
      });
      const newContact = makeContact(BOB_PUBKEY, [MEETING_3], {
        addedAt: Math.floor(Date.now() / 1000) - 1 * 86400, // 1 day ago
      });

      const engine = createTrustEngine([oldContact, newContact]);
      const stats = engine.calculateCircleStats();

      expect(stats.oldestRelationshipDays).toBeGreaterThanOrEqual(364);
    });
  });

  // ── getIdentityProfile ────────────────────────────────────────────────────

  describe('getIdentityProfile', () => {
    it('returns verificationCount > 0 for known pubkey', () => {
      const contact = makeContact(ALICE_PUBKEY, [MEETING_1]);
      const engine = createTrustEngine([contact]);
      const profile = engine.getIdentityProfile(ALICE_PUBKEY);

      expect(profile.verificationCount).toBeGreaterThan(0);
      expect(profile.chainDepth).toBe(1);
    });

    it('returns verificationCount = 0 for unknown pubkey', () => {
      const engine = createTrustEngine([]);
      const profile = engine.getIdentityProfile('deadbeef'.repeat(8));

      expect(profile.verificationCount).toBe(0);
      expect(profile.chainDepth).toBe(0);
    });

    it('includes pubkey in profile', () => {
      const contact = makeContact(ALICE_PUBKEY, [MEETING_1]);
      const engine = createTrustEngine([contact]);
      const profile = engine.getIdentityProfile(ALICE_PUBKEY);

      expect(profile.pubkey).toBe(ALICE_PUBKEY);
    });

    it('includes nip05 if set on contact', () => {
      const contact = makeContact(ALICE_PUBKEY, [MEETING_1], {
        nip05: 'alice@satnam.pub',
      });
      const engine = createTrustEngine([contact]);
      const profile = engine.getIdentityProfile(ALICE_PUBKEY);

      expect(profile.nip05).toBe('alice@satnam.pub');
    });
  });

  // ── validateThirdParty ────────────────────────────────────────────────────

  describe('validateThirdParty', () => {
    it('returns false when verifier is not in circle', () => {
      const engine = createTrustEngine([]);
      expect(engine.validateThirdParty(ALICE_PUBKEY, BOB_PUBKEY)).toBe(false);
    });

    it('returns false when verifier is in circle but has no attestation for target', () => {
      const bob = makeContact(BOB_PUBKEY, [MEETING_1]);
      const engine = createTrustEngine([bob]);
      expect(engine.validateThirdParty(ALICE_PUBKEY, BOB_PUBKEY)).toBe(false);
    });

    it('returns true when verifier is in circle and has attestation entry for target', () => {
      const bob = makeContact(BOB_PUBKEY, [MEETING_1]);
      const ledger = new Map<string, HandshakeLedgerEntry[]>([
        [BOB_PUBKEY, [
          {
            type: 'attestation',
            contactPubkey: ALICE_PUBKEY,
            timestamp: Math.floor(Date.now() / 1000),
            eventId: '0'.repeat(64),
          },
        ]],
      ]);
      const engine = createTrustEngine([bob], ledger);
      expect(engine.validateThirdParty(ALICE_PUBKEY, BOB_PUBKEY)).toBe(true);
    });
  });

  // ── getSharedContacts ─────────────────────────────────────────────────────

  describe('getSharedContacts', () => {
    it('returns empty array for unknown pubkey', () => {
      const engine = createTrustEngine([]);
      expect(engine.getSharedContacts(ALICE_PUBKEY)).toEqual([]);
    });

    it('returns shared contacts when mutual meetings exist in ledger', () => {
      const alice = makeContact(ALICE_PUBKEY, [MEETING_1]);
      const bob = makeContact(BOB_PUBKEY, [MEETING_1]);
      const charlie = makeContact(CHARLIE_PUBKEY, [MEETING_1]);

      // Alice's ledger has meeting with Charlie
      const ledger = new Map<string, HandshakeLedgerEntry[]>([
        [ALICE_PUBKEY, [
          {
            type: 'meeting',
            contactPubkey: CHARLIE_PUBKEY,
            timestamp: Math.floor(Date.now() / 1000),
            eventId: '0'.repeat(64),
          },
        ]],
      ]);

      const engine = createTrustEngine([alice, bob, charlie], ledger);
      // Shared contacts of Alice = contacts in our circle that Alice has also met
      const shared = engine.getSharedContacts(ALICE_PUBKEY);
      expect(shared).toContain(CHARLIE_PUBKEY);
    });

    it('does not include the target pubkey itself in shared contacts', () => {
      const alice = makeContact(ALICE_PUBKEY, [MEETING_1]);
      const ledger = new Map<string, HandshakeLedgerEntry[]>([
        [ALICE_PUBKEY, [
          {
            type: 'meeting',
            contactPubkey: ALICE_PUBKEY, // self-reference
            timestamp: Math.floor(Date.now() / 1000),
            eventId: '0'.repeat(64),
          },
        ]],
      ]);

      const engine = createTrustEngine([alice], ledger);
      const shared = engine.getSharedContacts(ALICE_PUBKEY);
      expect(shared).not.toContain(ALICE_PUBKEY);
    });
  });

  // ── getHandshakeLedger ────────────────────────────────────────────────────

  describe('getHandshakeLedger', () => {
    it('returns empty array for contact with no ledger', () => {
      const alice = makeContact(ALICE_PUBKEY, [MEETING_1]);
      const engine = createTrustEngine([alice]);
      expect(engine.getHandshakeLedger(ALICE_PUBKEY)).toEqual([]);
    });

    it('returns entries sorted by timestamp (oldest first)', () => {
      const now = Math.floor(Date.now() / 1000);
      const entries: HandshakeLedgerEntry[] = [
        { type: 'payment', contactPubkey: ALICE_PUBKEY, timestamp: now, eventId: 'ev3' },
        { type: 'meeting', contactPubkey: ALICE_PUBKEY, timestamp: now - 200, eventId: 'ev1' },
        { type: 'message', contactPubkey: ALICE_PUBKEY, timestamp: now - 100, eventId: 'ev2' },
      ];

      const ledger = new Map([[ALICE_PUBKEY, entries]]);
      const alice = makeContact(ALICE_PUBKEY, [MEETING_1]);
      const engine = createTrustEngine([alice], ledger);

      const sorted = engine.getHandshakeLedger(ALICE_PUBKEY);
      expect(sorted[0].eventId).toBe('ev1');
      expect(sorted[1].eventId).toBe('ev2');
      expect(sorted[2].eventId).toBe('ev3');
    });
  });
});

// ===========================================================================
// TrustStore tests
// ===========================================================================

describe('TrustStore', () => {
  let vault: ReturnType<typeof createMockVault>;
  let store: TrustStore;

  beforeEach(() => {
    vault = createMockVault();
    store = createTrustStore(vault as any);
  });

  // ── addTrustedContact ─────────────────────────────────────────────────────

  describe('addTrustedContact', () => {
    it('persists a contact to vault', async () => {
      const alice = makeContact(ALICE_PUBKEY, [MEETING_1]);
      await store.addTrustedContact(alice);

      const retrieved = await store.getTrustedContact(ALICE_PUBKEY);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.pubkey).toBe(ALICE_PUBKEY);
    });

    it('overwrites an existing contact when called again', async () => {
      const alice = makeContact(ALICE_PUBKEY, [MEETING_1], { nip05: 'alice@old.pub' });
      await store.addTrustedContact(alice);

      const updated = makeContact(ALICE_PUBKEY, [MEETING_1], { nip05: 'alice@new.pub' });
      await store.addTrustedContact(updated);

      const retrieved = await store.getTrustedContact(ALICE_PUBKEY);
      expect(retrieved!.nip05).toBe('alice@new.pub');
    });
  });

  // ── getTrustedContact ─────────────────────────────────────────────────────

  describe('getTrustedContact', () => {
    it('returns null for unknown pubkey', async () => {
      const result = await store.getTrustedContact(ALICE_PUBKEY);
      expect(result).toBeNull();
    });

    it('returns the stored contact', async () => {
      const bob = makeContact(BOB_PUBKEY, [MEETING_1]);
      await store.addTrustedContact(bob);

      const retrieved = await store.getTrustedContact(BOB_PUBKEY);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.pubkey).toBe(BOB_PUBKEY);
      expect(retrieved!.trustDepth).toBe(1);
    });
  });

  // ── removeTrustedContact ──────────────────────────────────────────────────

  describe('removeTrustedContact', () => {
    it('removes a contact from storage', async () => {
      const alice = makeContact(ALICE_PUBKEY, [MEETING_1]);
      await store.addTrustedContact(alice);
      await store.removeTrustedContact(ALICE_PUBKEY);

      const result = await store.getTrustedContact(ALICE_PUBKEY);
      expect(result).toBeNull();
    });

    it('does not throw when removing non-existent contact', async () => {
      await expect(store.removeTrustedContact(ALICE_PUBKEY)).resolves.not.toThrow();
    });
  });

  // ── addMeetingProof ───────────────────────────────────────────────────────

  describe('addMeetingProof (trust depth accumulation)', () => {
    it('appends a meeting proof to an existing contact', async () => {
      const alice = makeContact(ALICE_PUBKEY, [MEETING_1]);
      await store.addTrustedContact(alice);

      await store.addMeetingProof(ALICE_PUBKEY, MEETING_2);

      const retrieved = await store.getTrustedContact(ALICE_PUBKEY);
      expect(retrieved!.meetings.length).toBe(2);
    });

    it('increments trustDepth with each new meeting', async () => {
      const alice = makeContact(ALICE_PUBKEY, [MEETING_1]);
      await store.addTrustedContact(alice);

      expect((await store.getTrustedContact(ALICE_PUBKEY))!.trustDepth).toBe(1);

      await store.addMeetingProof(ALICE_PUBKEY, MEETING_2);
      expect((await store.getTrustedContact(ALICE_PUBKEY))!.trustDepth).toBe(2);

      await store.addMeetingProof(ALICE_PUBKEY, MEETING_3);
      expect((await store.getTrustedContact(ALICE_PUBKEY))!.trustDepth).toBe(3);
    });

    it('does not create duplicate meeting proofs for same attestation event', async () => {
      const alice = makeContact(ALICE_PUBKEY, [MEETING_1]);
      await store.addTrustedContact(alice);

      // Add MEETING_2 twice
      await store.addMeetingProof(ALICE_PUBKEY, MEETING_2);
      await store.addMeetingProof(ALICE_PUBKEY, MEETING_2);

      const retrieved = await store.getTrustedContact(ALICE_PUBKEY);
      expect(retrieved!.meetings.length).toBe(2); // not 3
    });

    it('throws when contact does not exist', async () => {
      await expect(
        store.addMeetingProof(ALICE_PUBKEY, MEETING_1),
      ).rejects.toThrow('not found');
    });

    it('preserves original meeting when adding new ones', async () => {
      const alice = makeContact(ALICE_PUBKEY, [MEETING_1]);
      await store.addTrustedContact(alice);
      await store.addMeetingProof(ALICE_PUBKEY, MEETING_2);

      const retrieved = await store.getTrustedContact(ALICE_PUBKEY);
      const attestationIds = retrieved!.meetings.map((m) => m.attestationEventId);
      expect(attestationIds).toContain(MEETING_1.attestationEventId);
      expect(attestationIds).toContain(MEETING_2.attestationEventId);
    });
  });

  // ── getHandshakeLedger / appendHandshakeEntry ─────────────────────────────

  describe('handshake ledger', () => {
    beforeEach(async () => {
      const alice = makeContact(ALICE_PUBKEY, [MEETING_1]);
      await store.addTrustedContact(alice);
    });

    it('returns empty ledger for contact with no entries', async () => {
      const entries = await store.getHandshakeLedger(ALICE_PUBKEY);
      expect(entries).toEqual([]);
    });

    it('appends a ledger entry', async () => {
      const entry: HandshakeLedgerEntry = {
        type: 'meeting',
        contactPubkey: ALICE_PUBKEY,
        timestamp: Math.floor(Date.now() / 1000),
        blockHeight: 873_000,
        eventId: 'ev1' + '0'.repeat(61),
      };

      await store.appendHandshakeEntry(ALICE_PUBKEY, entry);
      const ledger = await store.getHandshakeLedger(ALICE_PUBKEY);

      expect(ledger.length).toBe(1);
      expect(ledger[0].type).toBe('meeting');
      expect(ledger[0].blockHeight).toBe(873_000);
    });

    it('accumulates multiple ledger entries', async () => {
      const now = Math.floor(Date.now() / 1000);
      const entries: HandshakeLedgerEntry[] = [
        { type: 'meeting', contactPubkey: ALICE_PUBKEY, timestamp: now - 200, eventId: 'ev1' + '0'.repeat(61) },
        { type: 'message', contactPubkey: ALICE_PUBKEY, timestamp: now - 100, eventId: 'ev2' + '0'.repeat(61) },
        { type: 'payment', contactPubkey: ALICE_PUBKEY, timestamp: now, eventId: 'ev3' + '0'.repeat(61) },
      ];

      for (const entry of entries) {
        await store.appendHandshakeEntry(ALICE_PUBKEY, entry);
      }

      const ledger = await store.getHandshakeLedger(ALICE_PUBKEY);
      expect(ledger.length).toBe(3);
    });

    it('does not create duplicate ledger entries for same event ID', async () => {
      const entry: HandshakeLedgerEntry = {
        type: 'payment',
        contactPubkey: ALICE_PUBKEY,
        timestamp: Math.floor(Date.now() / 1000),
        eventId: 'ev-dup' + '0'.repeat(59),
      };

      await store.appendHandshakeEntry(ALICE_PUBKEY, entry);
      await store.appendHandshakeEntry(ALICE_PUBKEY, entry);

      const ledger = await store.getHandshakeLedger(ALICE_PUBKEY);
      expect(ledger.length).toBe(1);
    });

    it('returns ledger entries sorted by timestamp (oldest first)', async () => {
      const now = Math.floor(Date.now() / 1000);

      // Insert out of order
      await store.appendHandshakeEntry(ALICE_PUBKEY, {
        type: 'payment',
        contactPubkey: ALICE_PUBKEY,
        timestamp: now,
        eventId: 'newest' + '0'.repeat(58),
      });
      await store.appendHandshakeEntry(ALICE_PUBKEY, {
        type: 'meeting',
        contactPubkey: ALICE_PUBKEY,
        timestamp: now - 300,
        eventId: 'oldest' + '0'.repeat(58),
      });
      await store.appendHandshakeEntry(ALICE_PUBKEY, {
        type: 'message',
        contactPubkey: ALICE_PUBKEY,
        timestamp: now - 100,
        eventId: 'middle' + '0'.repeat(58),
      });

      const ledger = await store.getHandshakeLedger(ALICE_PUBKEY);
      expect(ledger[0].eventId).toMatch(/^oldest/);
      expect(ledger[1].eventId).toMatch(/^middle/);
      expect(ledger[2].eventId).toMatch(/^newest/);
    });

    it('stores blockHeight in ledger entry', async () => {
      const entry: HandshakeLedgerEntry = {
        type: 'attestation',
        contactPubkey: ALICE_PUBKEY,
        timestamp: Math.floor(Date.now() / 1000),
        blockHeight: 873_200,
        eventId: '0'.repeat(64),
      };

      await store.appendHandshakeEntry(ALICE_PUBKEY, entry);
      const ledger = await store.getHandshakeLedger(ALICE_PUBKEY);

      expect(ledger[0].blockHeight).toBe(873_200);
    });
  });
});

// ===========================================================================
// Meeting proof aggregation & trust depth tests
// ===========================================================================

describe('Meeting proof aggregation and trust depth', () => {
  it('trust score increases with each new meeting (diminishing returns)', () => {
    const contact1 = makeContact(ALICE_PUBKEY, [MEETING_1]);
    const contact2 = makeContact(ALICE_PUBKEY, [MEETING_1, MEETING_2]);
    const contact3 = makeContact(ALICE_PUBKEY, [MEETING_1, MEETING_2, MEETING_3]);

    const engine = createTrustEngine([]);

    const score1 = engine.calculateTrustScore(contact1);
    const score2 = engine.calculateTrustScore(contact2);
    const score3 = engine.calculateTrustScore(contact3);

    // Scores increase
    expect(score2.composite).toBeGreaterThan(score1.composite);
    expect(score3.composite).toBeGreaterThan(score2.composite);

    // Diminishing returns: each additional meeting adds less
    const delta12 = score2.factors.meetingDepth - score1.factors.meetingDepth;
    const delta23 = score3.factors.meetingDepth - score2.factors.meetingDepth;
    expect(delta12).toBeGreaterThanOrEqual(delta23);
  });

  it('time span between meetings increases timeConsistency', () => {
    const now = Math.floor(Date.now() / 1000);

    // Two meetings close together → low time span
    const shortContact = makeContact(ALICE_PUBKEY, [
      { ...MEETING_1, timestamp: now - 2 * 86400 },   // 2 days ago
      { ...MEETING_2, timestamp: now - 1 * 86400 },   // 1 day ago
    ]);

    // Two meetings far apart → high time span
    const longContact = makeContact(BOB_PUBKEY, [
      { ...MEETING_1, timestamp: now - 300 * 86400 }, // 300 days ago
      { ...MEETING_2, timestamp: now },                // today
    ]);

    const engine = createTrustEngine([shortContact, longContact]);

    const shortScore = engine.calculateTrustScore(shortContact);
    const longScore = engine.calculateTrustScore(longContact);

    expect(longScore.factors.timeConsistency).toBeGreaterThan(
      shortScore.factors.timeConsistency,
    );
    expect(longScore.timeSpanDays).toBeGreaterThan(shortScore.timeSpanDays);
  });

  it('trust depth matches number of meetings', () => {
    const meetings = [MEETING_1, MEETING_2, MEETING_3];
    for (let n = 1; n <= 3; n++) {
      const contact = makeContact(ALICE_PUBKEY, meetings.slice(0, n));
      expect(contact.trustDepth).toBe(n);
    }
  });

  it('unique block heights confirm different meeting instances', () => {
    const meetings: MeetingProof[] = [
      { ...MEETING_1, blockHeight: 800_000 },
      { ...MEETING_2, blockHeight: 850_000 },
      { ...MEETING_3, blockHeight: 873_000 },
    ];

    const blockHeights = meetings.map((m) => m.blockHeight);
    const uniqueHeights = new Set(blockHeights);
    expect(uniqueHeights.size).toBe(3); // all different
  });
});

// ===========================================================================
// Constants
// ===========================================================================

describe('exported constants', () => {
  it('HIGH_TRUST_THRESHOLD is 70', () => {
    expect(HIGH_TRUST_THRESHOLD).toBe(70);
  });

  it('NEW_CONTACT_THRESHOLD is 30', () => {
    expect(NEW_CONTACT_THRESHOLD).toBe(30);
  });
});
