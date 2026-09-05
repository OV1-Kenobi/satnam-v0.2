/**
 * @file nip-ac.test.ts
 * @description Unit tests for the NIP-AC credit lifecycle client.
 *
 * Tests cover:
 * 1. buildCreditIntent — kind:39240, correct tags and content
 * 2. buildCreditIntent — sats budget passthrough
 * 3. buildCreditIntent — required_skills and preferred_providers tags
 * 4. parseCreditOffer — parses kind:39241 event correctly
 * 5. parseCreditOffer — throws on wrong kind
 * 6. parseCreditOffer — throws on invalid JSON content
 * 7. buildCreditEnvelope — kind:39242, single-e grammar
 * 8. buildCreditEnvelope — never emits performance_bond
 * 9. buildSpendAuth — kind:39243, sats amount, p tag, rail in content
 * 10. buildSpendAuth — kind:39243, default rail, exact tag grammar (no bolt11)
 * 11. buildSettlementReceipt — kind:39244, score 0–100 tag, no spent/bond_redeemed tags
 * 12. buildSettlementReceipt — reputation delta on 0–100 scale + required fields in content
 * 13. buildDefaultNotice — kind:39245, reason tag
 * 14. buildDefaultNotice — normalizes unknown reasons to 'expired'
 * 15. calculateReputationDelta — positional (score 0–100, weight, bond): base_rep = score * weight
 * 16. calculateReputationDelta — positional: sig4sats_bonus = base_rep * 0.15 when bond
 * 17. calculateReputationDelta — positional: no bonus when hasPerformanceBond=false
 * 18. buildSettlementReceipt — score clamped to [0, 100] at the builder seam
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
  NipAcClientError,
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
      decode: vi.fn((input: string) => {
        // Protocol-faithful constants: real nostr-tools nip19.decode returns
        // { type: 'nsec' } for nsec1 bech32 — kept for mock fidelity (SEC-009).
        if (input.startsWith('nsec1')) {
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
  loadAgentSigningKey: vi.fn(async (_npub: string) => '0'.repeat(64)),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeOfferEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: 'offer-event-id',
    pubkey: 'a'.repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    kind: 39241,
    tags: [
      ['e', 'intent-event-id'],
      ['d', 'offer-unique-id'],
    ],
    content: JSON.stringify({
      intent_id: 'intent-event-id',
      provider_pubkey: 'a'.repeat(64),
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
      budgetSats: 5000,
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
      budgetSats: 1500,
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
      budgetSats: 1000,
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
      budgetSats: 2000,
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
    expect(offer.providerPubkey).toBe('a'.repeat(64));
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
      offerEventId: 'offer-id',
      providerPubkey: 'a'.repeat(64),
      governorPubkey: 'b'.repeat(64),
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash-abc123',
      expiryTimestamp: expiry,
    });

    expect(event.kind).toBe(39242);

    const eTags = event.tags.filter((t) => t[0] === 'e');
    expect(eTags).toHaveLength(1);
    expect(eTags[0][1]).toBe('offer-id');

    const pTag = event.tags.find((t) => t[0] === 'p');
    expect(pTag?.[1]).toBe('a'.repeat(64));

    const maxSatsTag = event.tags.find((t) => t[0] === 'max_sats');
    expect(maxSatsTag?.[1]).toBe('1000');

    const expiresTag = event.tags.find((t) => t[0] === 'expires_at');
    expect(expiresTag?.[1]).toBe(String(expiry));

    const scopeTag = event.tags.find((t) => t[0] === 'scope_hash');
    expect(scopeTag?.[1]).toBe('scope-hash-abc123');
  });

  it('8. never emits performance_bond tag (bond facts live in settlement content)', () => {
    const event = buildCreditEnvelope({
      offerEventId: 'offer-id',
      providerPubkey: 'a'.repeat(64),
      governorPubkey: 'b'.repeat(64),
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash',
      expiryTimestamp: 9999999,
    });

    expect(event.tags.find((t) => t[0] === 'performance_bond')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 9–10: buildSpendAuth
// ---------------------------------------------------------------------------

describe('buildSpendAuth', () => {
  it('9. produces kind:39243, sats amount, p tag, rail in content', () => {
    const event = buildSpendAuth({
      envelopeEventId: 'env-id',
      agentPubkey: 'a'.repeat(64),
      amountSats: 100,
      purpose: 'Pay for research results',
      rail: 'lightning',
    });

    expect(event.kind).toBe(39243);

    const eTag = event.tags.find((t) => t[0] === 'e');
    expect(eTag?.[1]).toBe('env-id');

    const pTag = event.tags.find((t) => t[0] === 'p');
    expect(pTag?.[1]).toBe('a'.repeat(64));

    const amountTag = event.tags.find((t) => t[0] === 'amount');
    expect(amountTag?.[1]).toBe('100'); // sats string

    const content = JSON.parse(event.content);
    expect(content.envelope_id).toBe('env-id');
    expect(content.agent_pubkey).toBe('a'.repeat(64));
    expect(content.amount_sats).toBe(100);
    expect(content.purpose).toBe('Pay for research results');
    expect(content.rail).toBe('lightning');
  });

  it('10. defaults rail to lightning and emits exactly the schema tag set', () => {
    const event = buildSpendAuth({
      envelopeEventId: 'env-id',
      agentPubkey: 'a'.repeat(64),
      amountSats: 100,
      purpose: 'Cashu payment',
    });

    expect(event.kind).toBe(39243);
    expect(event.tags).toEqual([
      ['e', 'env-id'],
      ['p', 'a'.repeat(64)],
      ['amount', '100'],
    ]);

    const content = JSON.parse(event.content);
    expect(content.rail).toBe('lightning');
    expect('amount_msats' in content).toBe(false);
    expect('recipient' in content).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11–12: buildSettlementReceipt
// ---------------------------------------------------------------------------

describe('buildSettlementReceipt', () => {
  it('11. produces kind:39244 with score tag and no spent/bond_redeemed tags', () => {
    const event = buildSettlementReceipt({
      envelopeEventId: 'env-id',
      agentPubkey: 'a'.repeat(64),
      governorPubkey: 'b'.repeat(64),
      taskCompletionScore: 85,
      totalSatsSpent: 900,
      performanceBondRedeemed: false,
    });

    expect(event.kind).toBe(39244);

    const scoreTag = event.tags.find((t) => t[0] === 'score');
    expect(scoreTag?.[1]).toBe('85');

    expect(event.tags.find((t) => t[0] === 'spent')).toBeUndefined();
    expect(event.tags.find((t) => t[0] === 'bond_redeemed')).toBeUndefined();
  });

  it('12. content includes reputation_delta on the 0–100 scale and required fields', () => {
    const event = buildSettlementReceipt({
      envelopeEventId: 'env-id',
      agentPubkey: 'a'.repeat(64),
      governorPubkey: 'b'.repeat(64),
      taskCompletionScore: 100,
      totalSatsSpent: 1000,
      performanceBondRedeemed: true,
    });

    const content = JSON.parse(event.content);
    // score=100 (0–100), weight=1.0, has_bond=true
    // base_rep = 100 * 1.0 = 100
    // sig4sats_bonus = 100 * 0.15 = 15
    // total = 115
    expect(content.reputation_delta).toBeCloseTo(115, 5);
    expect(content.has_performance_bond).toBe(true);
    expect(content.task_completion_score).toBe(100);
    expect(content.agent_pubkey).toBe('a'.repeat(64));
    expect(content.governor_pubkey).toBe('b'.repeat(64));
    expect('sig4sats_proof' in content).toBe(false);
    expect('completion_proof' in content).toBe(false);
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
    const delta = calculateReputationDelta(80, 2.0, false);
    // base_rep = 80 * 2.0 = 160, no bonus
    expect(delta).toBeCloseTo(160, 10);
  });

  it('16. sig4sats_bonus = base_rep * 0.15 when bond present', () => {
    const delta = calculateReputationDelta(100, 1.0, true);
    // base_rep = 100, bonus = 15, total = 115
    expect(delta).toBeCloseTo(115, 10);
  });

  it('17. no sig4sats bonus when hasPerformanceBond=false', () => {
    const withBond = calculateReputationDelta(90, 1, true);
    const withoutBond = calculateReputationDelta(90, 1, false);
    expect(withBond).toBeGreaterThan(withoutBond);
    expect(withoutBond).toBeCloseTo(90, 10);
  });

  it('18. score is clamped to [0, 100] at the builder seam', () => {
    const overEvent = buildSettlementReceipt({
      envelopeEventId: 'env-id',
      agentPubkey: 'a'.repeat(64),
      governorPubkey: 'b'.repeat(64),
      taskCompletionScore: 150,
      totalSatsSpent: 900,
      performanceBondRedeemed: false,
    });
    const overContent = JSON.parse(overEvent.content);
    expect(overContent.task_completion_score).toBe(100);
    expect(overContent.reputation_delta).toBe(100);

    const underEvent = buildSettlementReceipt({
      envelopeEventId: 'env-id',
      agentPubkey: 'a'.repeat(64),
      governorPubkey: 'b'.repeat(64),
      taskCompletionScore: -5,
      totalSatsSpent: 900,
      performanceBondRedeemed: false,
    });
    const underContent = JSON.parse(underEvent.content);
    expect(underContent.task_completion_score).toBe(0);
    expect(underContent.reputation_delta).toBe(0);
  });

  it('18b. zero weight gives zero delta regardless of score', () => {
    const delta = calculateReputationDelta(100, 0, true);
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
      budgetSats: 3000,
      deadlineTimestamp: 9999999,
      requiredSkills: ['research-v2'],
    });

    expect(ceps.signEventWithActiveSession).toHaveBeenCalledOnce();
    expect(ceps.publishEvent).toHaveBeenCalledOnce();
    expect(typeof eventId).toBe('string');
  });

  it('20. acceptOffer constructs and publishes an envelope', async () => {
    const offer = parseCreditOffer(makeOfferEvent());
    const eventId = await manager.acceptOffer(offer, 'b'.repeat(64));

    expect(ceps.signEventWithActiveSession).toHaveBeenCalledOnce();
    expect(ceps.publishEvent).toHaveBeenCalledOnce();
    expect(typeof eventId).toBe('string');
  });

  it('21. settleEnvelope publishes kind:39244 settlement', async () => {
    const eventId = await manager.settleEnvelope(
      'envelope-id',
      'a'.repeat(64),
      'b'.repeat(64),
      90,
      800
    );

    expect(ceps.signEventWithActiveSession).toHaveBeenCalledOnce();
    expect(ceps.publishEvent).toHaveBeenCalledOnce();

    const signedEvent = (ceps.signEventWithActiveSession as any).mock.calls[0][0];
    expect(signedEvent.kind).toBe(39244);
    const settledContent = JSON.parse(signedEvent.content);
    expect(settledContent.agent_pubkey).toBe('a'.repeat(64));
    expect(settledContent.governor_pubkey).toBe('b'.repeat(64));
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

// ---------------------------------------------------------------------------
// NIP-AC schema conformance (builders ↔ types.ts)
// ---------------------------------------------------------------------------

describe('NIP-AC schema conformance (builders ↔ types.ts)', () => {
  const AGENT_PK = 'a'.repeat(64);
  const GOVERNOR_PK = 'b'.repeat(64);
  const HEX64 = /^[0-9a-f]{64}$/;

  it('C1. buildCreditEnvelope output conforms to CreditEnvelopeContent/Tags', () => {
    const event = buildCreditEnvelope({
      offerEventId: 'offer-id',
      providerPubkey: AGENT_PK,
      governorPubkey: GOVERNOR_PK,
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash',
      expiryTimestamp: 9999999,
    });

    expect(event.kind).toBe(39242);

    // Exactly ONE e tag, equal to the offer id
    const eTags = event.tags.filter((t) => t[0] === 'e');
    expect(eTags).toHaveLength(1);
    expect(eTags[0][1]).toBe('offer-id');

    // p tag = agent pubkey
    const pTag = event.tags.find((t) => t[0] === 'p');
    expect(pTag?.[1]).toBe(AGENT_PK);

    // Required tags all present
    const dTag = event.tags.find((t) => t[0] === 'd');
    expect(dTag?.[1]).toMatch(/^envelope-/);
    const maxSatsTag = event.tags.find((t) => t[0] === 'max_sats');
    expect(maxSatsTag?.[1]).toBe('1000');
    const expiresTag = event.tags.find((t) => t[0] === 'expires_at');
    expect(expiresTag?.[1]).toBe('9999999');
    const scopeTag = event.tags.find((t) => t[0] === 'scope_hash');
    expect(scopeTag?.[1]).toBe('scope-hash');

    // Content key set EXACTLY matches the schema (no extra, no missing)
    const content = JSON.parse(event.content);
    expect(Object.keys(content).sort()).toEqual([
      'agent_pubkey',
      'expires_at',
      'governor_pubkey',
      'max_sats',
      'offer_id',
      'scope_constraints_hash',
    ]);
    expect(content.offer_id).toBe('offer-id');
    expect(content.agent_pubkey).toBe(AGENT_PK);
    expect(content.governor_pubkey).toBe(GOVERNOR_PK);
    expect(content.governor_pubkey).toMatch(HEX64);
    expect(typeof content.max_sats).toBe('number');

    // No performance_bond tag
    expect(event.tags.find((t) => t[0] === 'performance_bond')).toBeUndefined();
  });

  it('C2. buildSpendAuth output conforms to SpendAuthorizationContent/Tags', () => {
    const event = buildSpendAuth({
      envelopeEventId: 'env-id',
      agentPubkey: AGENT_PK,
      amountSats: 100,
      purpose: 'pay invoice',
      rail: 'cashu',
      recipient: 'merchant@example.com',
    });

    expect(event.kind).toBe(39243);

    // Tags EXACTLY the schema set
    expect(event.tags).toEqual([
      ['e', 'env-id'],
      ['p', AGENT_PK],
      ['amount', '100'],
    ]);

    // Content key set EXACTLY matches the schema
    const content = JSON.parse(event.content);
    expect(Object.keys(content).sort()).toEqual([
      'agent_pubkey',
      'amount_sats',
      'envelope_id',
      'purpose',
      'rail',
      'recipient',
    ]);
    expect(typeof content.amount_sats).toBe('number');
    expect(content.amount_sats).toBe(100);
    expect(content.rail).toBe('cashu');
    expect(JSON.stringify(content)).not.toContain('msats');

    // Default rail + omitted recipient when not provided
    const defaultEvent = buildSpendAuth({
      envelopeEventId: 'env-id',
      agentPubkey: AGENT_PK,
      amountSats: 100,
      purpose: 'pay invoice',
    });
    const defaultContent = JSON.parse(defaultEvent.content);
    expect(defaultContent.rail).toBe('lightning');
    expect('recipient' in defaultContent).toBe(false);
  });

  it('C3. buildSettlementReceipt output conforms to SettlementReceiptContent/Tags', () => {
    const event = buildSettlementReceipt({
      envelopeEventId: 'env-id',
      agentPubkey: AGENT_PK,
      governorPubkey: GOVERNOR_PK,
      taskCompletionScore: 85,
      totalSatsSpent: 900,
      performanceBondRedeemed: false,
    });

    expect(event.kind).toBe(39244);

    // Tags EXACTLY the schema set
    expect(event.tags).toEqual([
      ['e', 'env-id'],
      ['p', AGENT_PK],
      ['score', '85'],
    ]);

    // Content key set EXACTLY matches the schema (required fields present incl. D2 scoring fields)
    const content = JSON.parse(event.content);
    expect(Object.keys(content).sort()).toEqual([
      'agent_pubkey',
      'envelope_id',
      'governor_pubkey',
      'has_performance_bond',
      'reputation_delta',
      'task_completion_score',
      'total_sats_spent',
    ]);
    expect(content.reputation_delta).toBe(85); // 0–100 in, 0–100-scale delta

    // Optionals omitted (never nulled)
    expect('sig4sats_proof' in content).toBe(false);
    expect('completion_proof' in content).toBe(false);

    // Proof passes through only when provided; completion_proof stays independent
    const proofEvent = buildSettlementReceipt({
      envelopeEventId: 'env-id',
      agentPubkey: AGENT_PK,
      governorPubkey: GOVERNOR_PK,
      taskCompletionScore: 85,
      totalSatsSpent: 900,
      performanceBondRedeemed: false,
      cashuRedemptionProof: 'cashu-token-xyz',
    });
    const proofContent = JSON.parse(proofEvent.content);
    expect(proofContent.sig4sats_proof).toBe('cashu-token-xyz');
    expect('completion_proof' in proofContent).toBe(false);

    // Single-seam clamp at the builder
    const overEvent = buildSettlementReceipt({
      envelopeEventId: 'env-id',
      agentPubkey: AGENT_PK,
      governorPubkey: GOVERNOR_PK,
      taskCompletionScore: 150,
      totalSatsSpent: 900,
      performanceBondRedeemed: false,
    });
    const overContent = JSON.parse(overEvent.content);
    expect(overContent.task_completion_score).toBe(100);
    expect(overContent.reputation_delta).toBe(100);
  });

  it('C4. no msats field anywhere in builder output (kinds 39242/39243/39244)', () => {
    const envelope = buildCreditEnvelope({
      offerEventId: 'offer-id',
      providerPubkey: AGENT_PK,
      governorPubkey: GOVERNOR_PK,
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash',
      expiryTimestamp: 9999999,
    });
    const spendAuth = buildSpendAuth({
      envelopeEventId: 'env-id',
      agentPubkey: AGENT_PK,
      amountSats: 100,
      purpose: 'pay invoice',
    });
    const settlement = buildSettlementReceipt({
      envelopeEventId: 'env-id',
      agentPubkey: AGENT_PK,
      governorPubkey: GOVERNOR_PK,
      taskCompletionScore: 85,
      totalSatsSpent: 900,
      performanceBondRedeemed: false,
    });

    for (const event of [envelope, spendAuth, settlement]) {
      const serialized = JSON.stringify({ tags: event.tags, content: event.content });
      expect(serialized).not.toContain('msats');
      expect(serialized).not.toContain('_msats');
    }
  });
});

// ---------------------------------------------------------------------------
// Rider R1: 64-hex lowercase format validation at builder seams
// ---------------------------------------------------------------------------

describe('Rider R1: 64-hex lowercase format validation at builder seams', () => {
  const VALID_PK = 'a'.repeat(64);
  const INVALID_UPPERCASE = 'A'.repeat(64);
  const INVALID_63 = 'a'.repeat(63);
  const INVALID_65 = 'a'.repeat(65);
  const INVALID_NONHEX = 'a'.repeat(31) + 'G'.repeat(33);
  const EMPTY = '';

  it('R1a. buildCreditEnvelope: valid 64-char lowercase hex accepted', () => {
    expect(() => buildCreditEnvelope({
      offerEventId: 'offer-id',
      providerPubkey: VALID_PK,
      governorPubkey: 'b'.repeat(64),
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash',
      expiryTimestamp: 9999999,
    })).not.toThrow();
  });

  it('R1b. buildCreditEnvelope: uppercase pubkey rejected', () => {
    expect(() => buildCreditEnvelope({
      offerEventId: 'offer-id',
      providerPubkey: INVALID_UPPERCASE,
      governorPubkey: 'b'.repeat(64),
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash',
      expiryTimestamp: 9999999,
    })).toThrow(NipAcClientError);
  });

  it('R1c. buildCreditEnvelope: 63-char pubkey rejected', () => {
    expect(() => buildCreditEnvelope({
      offerEventId: 'offer-id',
      providerPubkey: INVALID_63,
      governorPubkey: 'b'.repeat(64),
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash',
      expiryTimestamp: 9999999,
    })).toThrow(NipAcClientError);
  });

  it('R1d. buildCreditEnvelope: 65-char pubkey rejected', () => {
    expect(() => buildCreditEnvelope({
      offerEventId: 'offer-id',
      providerPubkey: INVALID_65,
      governorPubkey: 'b'.repeat(64),
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash',
      expiryTimestamp: 9999999,
    })).toThrow(NipAcClientError);
  });

  it('R1e. buildCreditEnvelope: non-hex chars rejected', () => {
    expect(() => buildCreditEnvelope({
      offerEventId: 'offer-id',
      providerPubkey: INVALID_NONHEX,
      governorPubkey: 'b'.repeat(64),
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash',
      expiryTimestamp: 9999999,
    })).toThrow(NipAcClientError);
  });

  it('R1f. buildCreditEnvelope: empty pubkey rejected', () => {
    expect(() => buildCreditEnvelope({
      offerEventId: 'offer-id',
      providerPubkey: EMPTY,
      governorPubkey: 'b'.repeat(64),
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash',
      expiryTimestamp: 9999999,
    })).toThrow(NipAcClientError);
  });

  it('R1g. buildSpendAuth: valid 64-char lowercase hex accepted', () => {
    expect(() => buildSpendAuth({
      envelopeEventId: 'env-id',
      agentPubkey: VALID_PK,
      amountSats: 100,
      purpose: 'test',
    })).not.toThrow();
  });

  it('R1h. buildSpendAuth: uppercase pubkey rejected', () => {
    expect(() => buildSpendAuth({
      envelopeEventId: 'env-id',
      agentPubkey: INVALID_UPPERCASE,
      amountSats: 100,
      purpose: 'test',
    })).toThrow(NipAcClientError);
  });

  it('R1i. buildSettlementReceipt: valid 64-char lowercase hex accepted', () => {
    expect(() => buildSettlementReceipt({
      envelopeEventId: 'env-id',
      agentPubkey: VALID_PK,
      governorPubkey: 'b'.repeat(64),
      taskCompletionScore: 85,
      totalSatsSpent: 900,
      performanceBondRedeemed: false,
    })).not.toThrow();
  });

  it('R1j. buildSettlementReceipt: uppercase governor pubkey rejected', () => {
    expect(() => buildSettlementReceipt({
      envelopeEventId: 'env-id',
      agentPubkey: VALID_PK,
      governorPubkey: INVALID_UPPERCASE,
      taskCompletionScore: 85,
      totalSatsSpent: 900,
      performanceBondRedeemed: false,
    })).toThrow(NipAcClientError);
  });

  it('R1k. binding: p tag === content.agent_pubkey across all three builders', () => {
    const envelope = buildCreditEnvelope({
      offerEventId: 'offer-id',
      providerPubkey: VALID_PK,
      governorPubkey: 'b'.repeat(64),
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash',
      expiryTimestamp: 9999999,
    });
    const pTag = envelope.tags.find((t) => t[0] === 'p')![1];
    const contentAgent = JSON.parse(envelope.content).agent_pubkey;
    expect(pTag).toBe(contentAgent);

    const spendAuth = buildSpendAuth({
      envelopeEventId: 'env-id',
      agentPubkey: VALID_PK,
      amountSats: 100,
      purpose: 'test',
    });
    const spendPTag = spendAuth.tags.find((t) => t[0] === 'p')![1];
    const spendContentAgent = JSON.parse(spendAuth.content).agent_pubkey;
    expect(spendPTag).toBe(spendContentAgent);

    const settlement = buildSettlementReceipt({
      envelopeEventId: 'env-id',
      agentPubkey: VALID_PK,
      governorPubkey: 'b'.repeat(64),
      taskCompletionScore: 85,
      totalSatsSpent: 900,
      performanceBondRedeemed: false,
    });
    const settlePTag = settlement.tags.find((t) => t[0] === 'p')![1];
    const settleContentAgent = JSON.parse(settlement.content).agent_pubkey;
    expect(settlePTag).toBe(settleContentAgent);
  });

  it('R1l. binding: e tag === content field across builders', () => {
    // CreditEnvelope: e tag === content.offer_id
    const envelope = buildCreditEnvelope({
      offerEventId: 'offer-id',
      providerPubkey: VALID_PK,
      governorPubkey: 'b'.repeat(64),
      maxSats: 1000,
      scopeConstraintsHash: 'scope-hash',
      expiryTimestamp: 9999999,
    });
    const eTag = envelope.tags.find((t) => t[0] === 'e')![1];
    const contentOffer = JSON.parse(envelope.content).offer_id;
    expect(eTag).toBe(contentOffer);

    // SpendAuth: e tag === content.envelope_id
    const spendAuth = buildSpendAuth({
      envelopeEventId: 'env-id',
      agentPubkey: VALID_PK,
      amountSats: 100,
      purpose: 'test',
    });
    const spendEtag = spendAuth.tags.find((t) => t[0] === 'e')![1];
    const spendContentEnvId = JSON.parse(spendAuth.content).envelope_id;
    expect(spendEtag).toBe(spendContentEnvId);

    // SettlementReceipt: e tag === content.envelope_id
    const settlement = buildSettlementReceipt({
      envelopeEventId: 'env-id',
      agentPubkey: VALID_PK,
      governorPubkey: 'b'.repeat(64),
      taskCompletionScore: 85,
      totalSatsSpent: 900,
      performanceBondRedeemed: false,
    });
    const settleEtag = settlement.tags.find((t) => t[0] === 'e')![1];
    const settleContentEnvId = JSON.parse(settlement.content).envelope_id;
    expect(settleEtag).toBe(settleContentEnvId);
  });
});
