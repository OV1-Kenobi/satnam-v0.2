/**
 * @file nip-ac.test.ts
 * @description Unit tests for the NIP-AC credit lifecycle client.
 *
 * Tests cover:
 * 1. buildCreditIntent — kind:39240, correct tags and content
 * 2. buildCreditIntent — budget converted from msats to sats
 * 3. buildCreditIntent — required_skills and preferred_providers tags
 * 4. parseCreditOffer — parses kind:39241 event correctly
 * 5. parseCreditOffer — throws on wrong kind
 * 6. parseCreditOffer — throws on invalid JSON content
 * 7. buildCreditEnvelope — kind:39242, all required tags
 * 8. buildCreditEnvelope — performance_bond tag when provided
 * 9. buildSpendAuth — kind:39243 with bolt11 tag
 * 10. buildSpendAuth — kind:39243 without bolt11
 * 11. buildSettlementReceipt — kind:39244, score normalized 0–100
 * 12. buildSettlementReceipt — calculates reputation delta in content
 * 13. buildDefaultNotice — kind:39245, reason tag
 * 14. buildDefaultNotice — normalizes unknown reasons to 'expired'
 * 15. calculateReputationDelta — formula: base_rep = score * weight
 * 16. calculateReputationDelta — sig4sats_bonus = base_rep * 0.15 when bond
 * 17. calculateReputationDelta — no bonus when hasPerformanceBond=false
 * 18. calculateReputationDelta — score clamped to [0, 1]
 * 19. CreditLifecycleManager.createIntent — signs and publishes via CEPS
 * 20. CreditLifecycleManager.acceptOffer — creates envelope, removes offer
 * 21. CreditLifecycleManager.settleEnvelope — publishes settlement
 * 22. CreditLifecycleManager.issueDefault — publishes default notice
 * 23. CreditLifecycleManager.getActiveEnvelopes — filters expired envelopes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildCreditIntent,
  parseCreditOffer,
  buildCreditEnvelope,
  buildSpendAuth,
  buildSettlementReceipt,
  buildDefaultNotice,
  calculateReputationDelta,
  CreditLifecycleManager,
} from '../../src/lib/nip-ac/client.js';
import type { NostrEvent } from '../../src/lib/nip-ac/types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>();
  return {
    ...actual,
    SimplePool: vi.fn().mockImplementation(() => ({
      subscribeMany: vi.fn(() => ({ close: vi.fn() })),
      querySync: vi.fn(async () => []),
    })),
    nip19: {
      decode: vi.fn((nsec: string) => {
        if (nsec.startsWith('nsec1')) {
          return { type: 'nsec', data: new Uint8Array(32).fill(2) };
        }
        throw new Error('Invalid bech32');
      }),
    },
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

vi.mock('@noble/hashes/sha256', () => ({
  sha256: vi.fn((_data: Uint8Array) => new Uint8Array(32).fill(0xab)),
}));

// ---------------------------------------------------------------------------
// Mock CEPS
// ---------------------------------------------------------------------------

function makeMockCeps(listEvents: any[] = []) {
  return {
    publishEvent: vi.fn(async (event: any) => event.id ?? 'published-id-' + Math.random()),
    list: vi.fn(async () => listEvents),
    signEventWithActiveSession: vi.fn(async (event: any) => ({
      ...event,
      id: 'signed-' + Math.random().toString(36).slice(2),
      pubkey: 'eeee'.repeat(16),
      sig: 'ffff'.repeat(16),
    })),
  };
}

// ---------------------------------------------------------------------------
// Mock Vault
// ---------------------------------------------------------------------------

const mockVault = {
  loadAgentNsec: vi.fn(async (_npub: string) => '0'.repeat(64)),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeOfferEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'offer-event-id',
    pubkey: 'provider-pubkey',
    created_at: Math.floor(Date.now() / 1000),
    kind: 39241,
    tags: [
      ['e', 'intent-event-id'],
      ['d', 'offer-unique-id'],
    ],
    content: JSON.stringify({
      intent_id: 'intent-event-id',
      provider_pubkey: 'provider-pubkey',
      price_sats: 1000,
      delivery_seconds: 3600,
      capabilities: ['research', 'summarization'],
      quality_guarantee: 'Best effort',
    }),
    sig: 'mock-sig',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1–3: buildCreditIntent
// ---------------------------------------------------------------------------

describe('buildCreditIntent', () => {
  it('1. produces kind:39240 with d, budget, deadline tags', () => {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const event = buildCreditIntent({
      description: 'Research 5 AI companies',
      budgetMsats: BigInt(5_000_000),
      deadlineTimestamp: deadline,
      requiredSkills: [],
    });

    expect(event.kind).toBe(39240);

    const dTag = event.tags.find((t) => t[0] === 'd');
    expect(dTag).toBeDefined();
    expect(dTag![1]).toMatch(/^intent-/);

    const budgetTag = event.tags.find((t) => t[0] === 'budget');
    expect(budgetTag?.[1]).toBe('5000'); // 5_000_000 msats = 5000 sats

    const deadlineTag = event.tags.find((t) => t[0] === 'deadline');
    expect(deadlineTag?.[1]).toBe(String(deadline));
  });

  it('2. budget is correctly converted from msats to sats', () => {
    const event = buildCreditIntent({
      description: 'Test',
      budgetMsats: BigInt(1_500_000), // 1500 sats
      deadlineTimestamp: 9999999,
      requiredSkills: [],
    });

    const budgetTag = event.tags.find((t) => t[0] === 'budget');
    expect(budgetTag?.[1]).toBe('1500');

    const content = JSON.parse(event.content);
    expect(content.budget_sats).toBe(1500);
  });

  it('3. adds skill and preferred provider tags', () => {
    const event = buildCreditIntent({
      description: 'Test',
      budgetMsats: BigInt(1_000_000),
      deadlineTimestamp: 9999999,
      requiredSkills: ['research-v2', 'analysis-v1'],
      preferredProviders: ['provider-pk-1', 'provider-pk-2'],
    });

    const skillTags = event.tags.filter((t) => t[0] === 'skill');
    expect(skillTags).toHaveLength(2);
    expect(skillTags[0][1]).toBe('research-v2');
    expect(skillTags[1][1]).toBe('analysis-v1');

    const providerTags = event.tags.filter((t) => t[0] === 'p');
    expect(providerTags).toHaveLength(2);
  });

  it('3b. content includes required_skills array', () => {
    const event = buildCreditIntent({
      description: 'Analysis task',
      budgetMsats: BigInt(2_000_000),
      deadlineTimestamp: 9999999,
      requiredSkills: ['analysis-v1'],
    });

    const content = JSON.parse(event.content);
    expect(content.description).toBe('Analysis task');
    expect(content.required_skills).toEqual(['analysis-v1']);
  });
});

// ---------------------------------------------------------------------------
// 4–6: parseCreditOffer
// ---------------------------------------------------------------------------

describe('parseCreditOffer', () => {
  it('4. parses a valid kind:39241 event', () => {
    const offer = parseCreditOffer(makeOfferEvent());

    expect(offer.eventId).toBe('offer-event-id');
    expect(offer.providerPubkey).toBe('provider-pubkey');
    expect(offer.intentEventId).toBe('intent-event-id');
    expect(offer.priceSats).toBe(1000);
    expect(offer.deliverySeconds).toBe(3600);
    expect(offer.capabilities).toEqual(['research', 'summarization']);
    expect(offer.qualityGuarantee).toBe('Best effort');
  });

  it('5. throws on wrong event kind', () => {
    const badEvent = makeOfferEvent({ kind: 39240 });
    expect(() => parseCreditOffer(badEvent)).toThrow(/Expected kind:39241/);
  });

  it('6. throws on invalid JSON content', () => {
    const badEvent = makeOfferEvent({ content: 'not-json' });
    expect(() => parseCreditOffer(badEvent)).toThrow(
      /Failed to parse Credit Offer content as JSON/
    );
  });

  it('6b. uses e tag for intent_id over content.intent_id', () => {
    const event = makeOfferEvent();
    // e tag takes priority
    const offer = parseCreditOffer(event);
    expect(offer.intentEventId).toBe('intent-event-id'); // From e tag
  });
});

// ---------------------------------------------------------------------------
// 7–8: buildCreditEnvelope
// ---------------------------------------------------------------------------

describe('buildCreditEnvelope', () => {
  it('7. produces kind:39242 with all required tags', () => {
    const expiry = Math.floor(Date.now() / 1000) + 7200;
    const event = buildCreditEnvelope({
      intentEventId: 'intent-id',
      offerEventId: 'offer-id',
      providerPubkey: 'provider-pk',
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash-abc123',
      expiryTimestamp: expiry,
    });

    expect(event.kind).toBe(39242);

    const eTags = event.tags.filter((t) => t[0] === 'e');
    expect(eTags).toHaveLength(2);
    expect(eTags[0][1]).toBe('intent-id');
    expect(eTags[1][1]).toBe('offer-id');

    const pTag = event.tags.find((t) => t[0] === 'p');
    expect(pTag?.[1]).toBe('provider-pk');

    const maxSatsTag = event.tags.find((t) => t[0] === 'max_sats');
    expect(maxSatsTag?.[1]).toBe('1000');

    const expiresTag = event.tags.find((t) => t[0] === 'expires_at');
    expect(expiresTag?.[1]).toBe(String(expiry));

    const scopeTag = event.tags.find((t) => t[0] === 'scope_hash');
    expect(scopeTag?.[1]).toBe('scope-hash-abc123');
  });

  it('8. adds performance_bond tag when performanceBondSats > 0', () => {
    const event = buildCreditEnvelope({
      intentEventId: 'intent-id',
      offerEventId: 'offer-id',
      providerPubkey: 'provider-pk',
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash',
      expiryTimestamp: 9999999,
      performanceBondSats: 100,
    });

    const bondTag = event.tags.find((t) => t[0] === 'performance_bond');
    expect(bondTag?.[1]).toBe('100');
  });

  it('8b. omits performance_bond tag when not provided', () => {
    const event = buildCreditEnvelope({
      intentEventId: 'intent-id',
      offerEventId: 'offer-id',
      providerPubkey: 'provider-pk',
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash',
      expiryTimestamp: 9999999,
    });

    const bondTag = event.tags.find((t) => t[0] === 'performance_bond');
    expect(bondTag).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9–10: buildSpendAuth
// ---------------------------------------------------------------------------

describe('buildSpendAuth', () => {
  it('9. produces kind:39243 with bolt11 tag', () => {
    const event = buildSpendAuth({
      envelopeEventId: 'env-id',
      amountMsats: BigInt(100_000),
      description: 'Pay for research results',
      invoiceBolt11: 'lnbc1234...',
    });

    expect(event.kind).toBe(39243);

    const eTag = event.tags.find((t) => t[0] === 'e');
    expect(eTag?.[1]).toBe('env-id');

    const amountTag = event.tags.find((t) => t[0] === 'amount');
    expect(amountTag?.[1]).toBe('100000');

    const bolt11Tag = event.tags.find((t) => t[0] === 'bolt11');
    expect(bolt11Tag?.[1]).toBe('lnbc1234...');
  });

  it('10. omits bolt11 tag when not provided', () => {
    const event = buildSpendAuth({
      envelopeEventId: 'env-id',
      amountMsats: BigInt(50_000),
      description: 'Cashu payment',
    });

    expect(event.kind).toBe(39243);
    expect(event.tags.find((t) => t[0] === 'bolt11')).toBeUndefined();

    const content = JSON.parse(event.content);
    expect(content.description).toBe('Cashu payment');
    expect(content.amount_msats).toBe('50000');
  });
});

// ---------------------------------------------------------------------------
// 11–12: buildSettlementReceipt
// ---------------------------------------------------------------------------

describe('buildSettlementReceipt', () => {
  it('11. produces kind:39244 with score normalized to 0–100', () => {
    const event = buildSettlementReceipt({
      envelopeEventId: 'env-id',
      taskCompletionScore: 0.85,
      totalSpentMsats: BigInt(900_000),
      performanceBondRedeemed: false,
    });

    expect(event.kind).toBe(39244);

    const scoreTag = event.tags.find((t) => t[0] === 'score');
    expect(scoreTag?.[1]).toBe('85'); // 0.85 * 100 = 85

    const spentTag = event.tags.find((t) => t[0] === 'spent');
    expect(spentTag?.[1]).toBe('900000');

    const bondTag = event.tags.find((t) => t[0] === 'bond_redeemed');
    expect(bondTag?.[1]).toBe('false');
  });

  it('12. content includes calculated reputation_delta', () => {
    const event = buildSettlementReceipt({
      envelopeEventId: 'env-id',
      taskCompletionScore: 1.0,
      totalSpentMsats: BigInt(1_000_000),
      performanceBondRedeemed: true,
    });

    const content = JSON.parse(event.content);
    // score=1.0, weight=1.0, has_bond=true
    // base_rep = 1.0 * 1.0 = 1.0
    // sig4sats_bonus = 1.0 * 0.15 = 0.15
    // total = 1.15
    expect(content.reputation_delta).toBeCloseTo(1.15, 5);
    expect(content.has_performance_bond).toBe(true);
    expect(content.task_completion_score).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 13–14: buildDefaultNotice
// ---------------------------------------------------------------------------

describe('buildDefaultNotice', () => {
  it('13. produces kind:39245 with reason tag', () => {
    const event = buildDefaultNotice({
      envelopeEventId: 'env-id',
      reason: 'expired',
    });

    expect(event.kind).toBe(39245);

    const eTag = event.tags.find((t) => t[0] === 'e');
    expect(eTag?.[1]).toBe('env-id');

    const reasonTag = event.tags.find((t) => t[0] === 'reason');
    expect(reasonTag?.[1]).toBe('expired');
  });

  it('14. normalizes unknown reasons to expired', () => {
    const event = buildDefaultNotice({
      envelopeEventId: 'env-id',
      reason: 'some-unknown-reason',
    });

    const reasonTag = event.tags.find((t) => t[0] === 'reason');
    expect(reasonTag?.[1]).toBe('expired');
  });

  it('14b. preserves abandoned and disputed reasons', () => {
    const abandoned = buildDefaultNotice({ envelopeEventId: 'id', reason: 'abandoned' });
    const disputed = buildDefaultNotice({ envelopeEventId: 'id', reason: 'disputed' });

    expect(abandoned.tags.find((t) => t[0] === 'reason')?.[1]).toBe('abandoned');
    expect(disputed.tags.find((t) => t[0] === 'reason')?.[1]).toBe('disputed');
  });
});

// ---------------------------------------------------------------------------
// 15–18: calculateReputationDelta
// ---------------------------------------------------------------------------

describe('calculateReputationDelta', () => {
  it('15. base_rep = score * weight (no bond)', () => {
    const delta = calculateReputationDelta({
      taskCompletionScore: 0.8,
      weight: 2.0,
      hasPerformanceBond: false,
    });
    // base_rep = 0.8 * 2.0 = 1.6, no bonus
    expect(delta).toBeCloseTo(1.6, 10);
  });

  it('16. sig4sats_bonus = base_rep * 0.15 when bond present', () => {
    const delta = calculateReputationDelta({
      taskCompletionScore: 1.0,
      weight: 1.0,
      hasPerformanceBond: true,
    });
    // base_rep = 1.0, bonus = 0.15, total = 1.15
    expect(delta).toBeCloseTo(1.15, 10);
  });

  it('17. no sig4sats bonus when hasPerformanceBond=false', () => {
    const withBond = calculateReputationDelta({
      taskCompletionScore: 0.9,
      weight: 1.0,
      hasPerformanceBond: true,
    });
    const withoutBond = calculateReputationDelta({
      taskCompletionScore: 0.9,
      weight: 1.0,
      hasPerformanceBond: false,
    });
    expect(withBond).toBeGreaterThan(withoutBond);
    expect(withoutBond).toBeCloseTo(0.9, 10);
  });

  it('18. score is clamped to [0, 1]', () => {
    const overScore = calculateReputationDelta({
      taskCompletionScore: 1.5,
      weight: 1.0,
      hasPerformanceBond: false,
    });
    const underScore = calculateReputationDelta({
      taskCompletionScore: -0.5,
      weight: 1.0,
      hasPerformanceBond: false,
    });

    // Clamped to 1.0
    expect(overScore).toBeCloseTo(1.0, 10);
    // Clamped to 0.0
    expect(underScore).toBeCloseTo(0.0, 10);
  });

  it('18b. zero weight gives zero delta regardless of score', () => {
    const delta = calculateReputationDelta({
      taskCompletionScore: 1.0,
      weight: 0,
      hasPerformanceBond: true,
    });
    expect(delta).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 19–23: CreditLifecycleManager
// ---------------------------------------------------------------------------

describe('CreditLifecycleManager', () => {
  let ceps: ReturnType<typeof makeMockCeps>;
  let manager: CreditLifecycleManager;

  beforeEach(() => {
    vi.clearAllMocks();
    ceps = makeMockCeps();
    manager = new CreditLifecycleManager(ceps as any, mockVault);
  });

  it('19. createIntent signs and publishes via CEPS session', async () => {
    const eventId = await manager.createIntent({
      description: 'Research task',
      budgetMsats: BigInt(3_000_000),
      deadlineTimestamp: 9999999,
      requiredSkills: ['research-v2'],
    });

    expect(ceps.signEventWithActiveSession).toHaveBeenCalledOnce();
    expect(ceps.publishEvent).toHaveBeenCalledOnce();
    expect(typeof eventId).toBe('string');
  });

  it('20. acceptOffer constructs and publishes an envelope', async () => {
    const offer = parseCreditOffer(makeOfferEvent());
    const eventId = await manager.acceptOffer(offer);

    expect(ceps.signEventWithActiveSession).toHaveBeenCalledOnce();
    expect(ceps.publishEvent).toHaveBeenCalledOnce();
    expect(typeof eventId).toBe('string');
  });

  it('21. settleEnvelope publishes kind:39244 settlement', async () => {
    const eventId = await manager.settleEnvelope(
      'envelope-id',
      0.9,
      BigInt(800_000)
    );

    expect(ceps.signEventWithActiveSession).toHaveBeenCalledOnce();
    expect(ceps.publishEvent).toHaveBeenCalledOnce();

    const signedEvent = (ceps.signEventWithActiveSession as any).mock.calls[0][0];
    expect(signedEvent.kind).toBe(39244);
    expect(typeof eventId).toBe('string');
  });

  it('22. issueDefault publishes kind:39245 default notice', async () => {
    const eventId = await manager.issueDefault('envelope-id', 'expired');

    const signedEvent = (ceps.signEventWithActiveSession as any).mock.calls[0][0];
    expect(signedEvent.kind).toBe(39245);
    expect(typeof eventId).toBe('string');
  });

  it('23. getActiveEnvelopes filters out expired envelopes', async () => {
    const now = Math.floor(Date.now() / 1000);
    const activeEnvelopeEvent = {
      id: 'env-active',
      pubkey: 'agent-pk',
      kind: 39242,
      created_at: now - 1000,
      tags: [['expires_at', String(now + 7200)]],
      content: JSON.stringify({
        offer_id: 'offer-id',
        agent_pubkey: 'provider-pk',
        governor_pubkey: 'gov-pk',
        max_sats: 1000,
        scope_constraints_hash: 'hash',
        expires_at: now + 7200,
      }),
      sig: 'sig',
    };
    const expiredEnvelopeEvent = {
      id: 'env-expired',
      pubkey: 'agent-pk',
      kind: 39242,
      created_at: now - 10000,
      tags: [['expires_at', String(now - 3600)]],
      content: JSON.stringify({
        offer_id: 'offer-id',
        agent_pubkey: 'provider-pk',
        governor_pubkey: 'gov-pk',
        max_sats: 500,
        scope_constraints_hash: 'hash',
        expires_at: now - 3600,
      }),
      sig: 'sig',
    };

    ceps.list.mockResolvedValueOnce([activeEnvelopeEvent, expiredEnvelopeEvent]);

    const envelopes = await manager.getActiveEnvelopes('agent-pk', 'wss://relay.example.com');

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].eventId).toBe('env-active');
    expect(envelopes[0].maxSats).toBe(1000);
  });
});
