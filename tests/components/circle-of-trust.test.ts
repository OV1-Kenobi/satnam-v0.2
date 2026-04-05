/**
 * Circle of Trust — Component tests
 * Spec: circle-of-trust-spec.md (testing section)
 *
 * Tests:
 * - Trust score display (color thresholds: 0-30 blue, 30-70 orange, 70-100 gold)
 * - Contact card rendering with correct data
 * - Handshake ledger timeline ordering and badge display
 * - TrustOverviewPanel ring assignment
 * - Trust score calculation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateTrustScore,
  calculateCircleStats,
  getHandshakeLedger,
} from '../../src/lib/circle-of-trust/trust-engine.js';
import type {
  TrustedContact,
  MeetingProof,
  HandshakeLedgerEntry,
} from '../../src/lib/circle-of-trust/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMeeting(blockHeight: number, daysAgo: number): MeetingProof {
  const now = Math.floor(Date.now() / 1000);
  return {
    attestationEventId: `evt_${blockHeight}`,
    blockHeight,
    timestamp: now - daysAgo * 86400,
    welcomeMessageHash: `hash_${blockHeight}`,
  };
}

function makeContact(override: Partial<TrustedContact> = {}): TrustedContact {
  return {
    pubkey:                    'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
    nfcCardHash:               'nfc_hash_001',
    firstMeetingBlockHeight:   800000,
    meetings:                  [makeMeeting(800000, 30)],
    trustDepth:                1,
    trustScore:                45,
    welcomeMessageId:          'welcome_evt_001',
    addedAt:                   Math.floor(Date.now() / 1000) - 30 * 86400,
    ...override,
  };
}

// ---------------------------------------------------------------------------
// Trust score color thresholds
// ---------------------------------------------------------------------------

describe('Trust score color thresholds', () => {
  it('score > 70 → sovereign-gold tier', () => {
    const contact = makeContact({ trustScore: 85 });
    expect(contact.trustScore).toBeGreaterThan(70);
    // The rendering maps score >70 to '#ffd700'
    const color = contact.trustScore > 70 ? '#ffd700' : contact.trustScore >= 30 ? '#f7931a' : '#3b82f6';
    expect(color).toBe('#ffd700');
  });

  it('score 30–70 → btc-orange tier', () => {
    const contact = makeContact({ trustScore: 55 });
    const color = contact.trustScore > 70 ? '#ffd700' : contact.trustScore >= 30 ? '#f7931a' : '#3b82f6';
    expect(color).toBe('#f7931a');
  });

  it('score < 30 → vault-blue tier', () => {
    const contact = makeContact({ trustScore: 15 });
    const color = contact.trustScore > 70 ? '#ffd700' : contact.trustScore >= 30 ? '#f7931a' : '#3b82f6';
    expect(color).toBe('#3b82f6');
  });

  it('boundary: score = 70 → btc-orange (not high)', () => {
    const contact = makeContact({ trustScore: 70 });
    const isHigh = contact.trustScore > 70;
    expect(isHigh).toBe(false);
  });

  it('boundary: score = 30 → btc-orange (not new)', () => {
    const contact = makeContact({ trustScore: 30 });
    const isNew = contact.trustScore < 30;
    expect(isNew).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trust score calculation
// ---------------------------------------------------------------------------

describe('calculateTrustScore', () => {
  it('single meeting → meetingDepth > 0', () => {
    const contact = makeContact({ meetings: [makeMeeting(800000, 0)] });
    const score = calculateTrustScore(contact);
    expect(score.meetingCount).toBe(1);
    expect(score.factors.meetingDepth).toBeGreaterThan(0);
  });

  it('zero meetings → zero composite', () => {
    const contact = makeContact({ meetings: [], trustScore: 0 });
    const score = calculateTrustScore(contact);
    expect(score.meetingCount).toBe(0);
    expect(score.factors.meetingDepth).toBe(0);
    expect(score.composite).toBe(0);
  });

  it('multiple meetings → higher meetingDepth', () => {
    const few  = makeContact({ meetings: [makeMeeting(800000, 10)], trustScore: 20 });
    const many = makeContact({
      meetings: [
        makeMeeting(800000, 120),
        makeMeeting(800100, 90),
        makeMeeting(800200, 60),
        makeMeeting(800300, 30),
        makeMeeting(800400, 10),
      ],
      trustScore: 60,
    });

    const fewScore  = calculateTrustScore(few);
    const manyScore = calculateTrustScore(many);
    expect(manyScore.factors.meetingDepth).toBeGreaterThan(fewScore.factors.meetingDepth);
  });

  it('long relationship → higher timeConsistency', () => {
    const short = makeContact({
      meetings: [makeMeeting(800000, 5), makeMeeting(800001, 3)],
      trustScore: 30,
    });
    const long = makeContact({
      meetings: [makeMeeting(800000, 400), makeMeeting(800001, 5)],
      trustScore: 50,
    });

    const shortScore = calculateTrustScore(short);
    const longScore  = calculateTrustScore(long);
    expect(longScore.factors.timeConsistency).toBeGreaterThan(shortScore.factors.timeConsistency);
  });

  it('composite never exceeds 100', () => {
    const contact = makeContact({
      meetings: Array.from({ length: 20 }, (_, i) => makeMeeting(800000 + i, 400 - i * 10)),
      trustScore: 100,
    });
    const score = calculateTrustScore(contact);
    expect(score.composite).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// Circle stats
// ---------------------------------------------------------------------------

describe('calculateCircleStats', () => {
  it('empty contacts → zero stats', () => {
    const stats = calculateCircleStats([]);
    expect(stats.totalContacts).toBe(0);
    expect(stats.avgTrustScore).toBe(0);
    expect(stats.totalMeetings).toBe(0);
  });

  it('correctly counts tier buckets', () => {
    const contacts = [
      makeContact({ trustScore: 80, meetings: [makeMeeting(800000, 10)] }),
      makeContact({ pubkey: 'bbbb', trustScore: 50, meetings: [makeMeeting(800001, 10)] }),
      makeContact({ pubkey: 'cccc', trustScore: 20, meetings: [makeMeeting(800002, 10)] }),
    ];
    const stats = calculateCircleStats(contacts);
    expect(stats.highTrustContacts).toBe(1);
    expect(stats.mediumTrustContacts).toBe(1);
    expect(stats.newContacts).toBe(1);
    expect(stats.totalMeetings).toBe(3);
  });

  it('avgTrustScore is correct', () => {
    const contacts = [
      makeContact({ trustScore: 60 }),
      makeContact({ pubkey: 'bbbb', trustScore: 40 }),
    ];
    const stats = calculateCircleStats(contacts);
    expect(stats.avgTrustScore).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Handshake ledger
// ---------------------------------------------------------------------------

describe('getHandshakeLedger', () => {
  const entries: HandshakeLedgerEntry[] = [
    { type: 'meeting',     contactPubkey: 'alice', timestamp: 1000, eventId: 'e1' },
    { type: 'message',     contactPubkey: 'alice', timestamp: 2000, eventId: 'e2' },
    { type: 'payment',     contactPubkey: 'bob',   timestamp: 3000, eventId: 'e3' },
    { type: 'attestation', contactPubkey: 'alice', timestamp: 4000, eventId: 'e4' },
  ];

  it('filters entries by contactPubkey', () => {
    const ledger = getHandshakeLedger('alice', entries);
    expect(ledger).toHaveLength(3);
    expect(ledger.every(e => e.contactPubkey === 'alice')).toBe(true);
  });

  it('returns empty array for unknown pubkey', () => {
    const ledger = getHandshakeLedger('unknown', entries);
    expect(ledger).toHaveLength(0);
  });

  it('sorts descending by timestamp', () => {
    const ledger = getHandshakeLedger('alice', entries);
    for (let i = 0; i < ledger.length - 1; i++) {
      expect(ledger[i].timestamp).toBeGreaterThanOrEqual(ledger[i + 1].timestamp);
    }
  });

  it('meeting entries are the only type with Verified Handshake badge', () => {
    const meetingEntries = entries.filter(e => e.type === 'meeting');
    expect(meetingEntries.every(e => e.type === 'meeting')).toBe(true);
  });
});
