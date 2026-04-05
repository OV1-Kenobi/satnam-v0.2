/**
 * @file nip90-marketplace.test.ts
 * @description Unit tests for the NIP-90 DVM Marketplace client.
 *
 * Tests cover:
 * 1. discoverProviders()          — stand-alone function wrapping fetchProviders
 * 2. DvmMarketplace.discoverProviders() — method-level provider discovery
 * 3. DvmMarketplace.submitJob()   — event construction, signing, publishing
 * 4. DvmMarketplace.subscribeToResults() — subscription setup and cleanup
 * 5. DvmMarketplace.payForResult() — BOLT-11 extraction → NWC payInvoice
 * 6. DvmMarketplace.submitFeedback() — kind:7000 event construction and publishing
 * 7. DvmMarketplace.executeJob()  — full lifecycle: submit → wait → pay → feedback
 * 8. DvmMarketplace.getActiveJobs() — returns tracked in-flight jobs
 * 9. Payment edge cases           — Cashu token rejection, missing invoice
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { DvmJobRequest, DvmJobResult, DvmProvider } from '../../src/lib/nip90/types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock nostr-tools finalizeEvent and hexToBytes
vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    finalizeEvent: vi.fn((event: any, _secretKey: any) => ({
      ...event,
      id: 'finalized-' + Math.random().toString(36).slice(2, 10),
      pubkey: 'consumer-pubkey-' + '0'.repeat(48),
      sig: 'sig-' + '0'.repeat(124),
    })),
  };
});

vi.mock('@noble/hashes/utils', () => ({
  hexToBytes: vi.fn((hex: string) => {
    // Return a valid 32-byte array for any 64-char hex string
    if (hex.length < 64) throw new Error('Invalid hex length');
    return new Uint8Array(32);
  }),
}));

// Mock subscribe.ts functions
const mockFetchProviders = vi.fn();
const mockSubscribeToJobResults = vi.fn();
const mockWaitForJobResult = vi.fn();

vi.mock('../../src/lib/nip90/subscribe.js', () => ({
  fetchProviders: mockFetchProviders,
  subscribeToProviders: vi.fn(),
  subscribeToJobResults: mockSubscribeToJobResults,
  waitForJobResult: mockWaitForJobResult,
}));

// Mock construct.ts functions
const mockConstructJobRequest = vi.fn();
const mockConstructJobFeedback = vi.fn();
const mockParseJobResult = vi.fn();

vi.mock('../../src/lib/nip90/construct.js', () => ({
  constructJobRequest: mockConstructJobRequest,
  constructJobFeedback: mockConstructJobFeedback,
  constructJobFeedbackFromObject: vi.fn(),
  parseJobResult: mockParseJobResult,
  getResultKind: vi.fn((k: number) => k + 1000),
}));

// Mock CEPS
const mockPublishEvent = vi.fn().mockResolvedValue('ceps-published-id');
const mockCeps = {
  publishEvent: mockPublishEvent,
  signEventWithActiveSession: vi.fn().mockImplementation(async (e: any) => ({ ...e, id: 'signed-id', sig: 's' })),
  list: vi.fn().mockResolvedValue([]),
  subscribeMany: vi.fn(),
  getRelays: vi.fn().mockReturnValue([]),
  setRelays: vi.fn(),
};

// Mock NWC
const mockPayInvoice = vi.fn();
const mockNwc = {
  payInvoice: mockPayInvoice,
  getBalance: vi.fn(),
  makeInvoice: vi.fn(),
  addConnection: vi.fn(),
  listConnections: vi.fn().mockResolvedValue([]),
  getDefaultConnection: vi.fn().mockResolvedValue(null),
};

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { discoverProviders, DvmMarketplace } from '../../src/lib/nip90/marketplace.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SIGNER_NSEC = 'a'.repeat(64); // Valid 64-char hex

const BASE_JOB_REQUEST: DvmJobRequest = {
  kind: 5100,
  input: [{ data: 'Summarize the Bitcoin whitepaper', type: 'text' }],
  params: [{ key: 'model', value: 'gpt-4o' }],
  bid_msats: 10_000n,
  relays: ['wss://pylon.openagents.com'],
};

function makeJobResult(overrides: Partial<DvmJobResult> = {}): DvmJobResult {
  return {
    id: 'result-event-id-' + '0'.repeat(47),
    providerPubkey: 'provider-pubkey-' + '0'.repeat(48),
    requestKind: 5100,
    requestEventId: 'request-event-id-' + '0'.repeat(47),
    content: 'Bitcoin is a decentralized digital currency...',
    encrypted: false,
    createdAt: Math.floor(Date.now() / 1000),
    tags: [
      ['e', 'request-event-id-' + '0'.repeat(47)],
      ['amount', '10000', 'lnbc100u1pjtest...'],
    ],
    payment: {
      amountMsats: 10_000n,
      invoice: 'lnbc100u1pjtestinvoice...',
      isCashu: false,
    },
    ...overrides,
  };
}

function makeProvider(overrides: Partial<DvmProvider> = {}): DvmProvider {
  return {
    pubkey: 'provider-' + '0'.repeat(55),
    supportedJobKinds: [5100],
    name: 'TestProvider',
    about: 'A test DVM provider',
    encryptedOnly: false,
    relays: ['wss://pylon.openagents.com'],
    skillScopeIds: [],
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a DvmMarketplace for tests
// ---------------------------------------------------------------------------

function makeMarketplace(relayUrls?: string[]): DvmMarketplace {
  return new DvmMarketplace(
    mockCeps as any,
    mockNwc as any,
    relayUrls ?? ['wss://test-relay.example.com']
  );
}

// ---------------------------------------------------------------------------
// 1. discoverProviders (stand-alone function)
// ---------------------------------------------------------------------------

describe('discoverProviders()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls fetchProviders with jobKind and relayUrls', async () => {
    mockFetchProviders.mockResolvedValue([makeProvider()]);

    const result = await discoverProviders({
      jobKind: 5100,
      relayUrls: ['wss://pylon.openagents.com', 'wss://relay.nostr.band'],
    });

    expect(mockFetchProviders).toHaveBeenCalledWith(
      5100,
      ['wss://pylon.openagents.com', 'wss://relay.nostr.band'],
      10_000
    );
    expect(result).toHaveLength(1);
  });

  it('uses provided timeoutMs override', async () => {
    mockFetchProviders.mockResolvedValue([]);

    await discoverProviders({ jobKind: 5200, relayUrls: [], timeoutMs: 5000 });

    expect(mockFetchProviders).toHaveBeenCalledWith(5200, [], 5000);
  });

  it('returns empty array when no providers are found', async () => {
    mockFetchProviders.mockResolvedValue([]);
    const result = await discoverProviders({ jobKind: 5100, relayUrls: [] });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. DvmMarketplace.discoverProviders
// ---------------------------------------------------------------------------

describe('DvmMarketplace.discoverProviders()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses instance default relay URLs', async () => {
    mockFetchProviders.mockResolvedValue([makeProvider()]);
    const marketplace = makeMarketplace(['wss://default-relay.example.com']);

    await marketplace.discoverProviders(5100);

    expect(mockFetchProviders).toHaveBeenCalledWith(
      5100,
      ['wss://default-relay.example.com'],
      expect.any(Number)
    );
  });

  it('uses override relay URLs when provided', async () => {
    mockFetchProviders.mockResolvedValue([]);
    const marketplace = makeMarketplace(['wss://default.example.com']);

    await marketplace.discoverProviders(5100, ['wss://override.example.com']);

    expect(mockFetchProviders).toHaveBeenCalledWith(
      5100,
      ['wss://override.example.com'],
      expect.any(Number)
    );
  });
});

// ---------------------------------------------------------------------------
// 3. DvmMarketplace.submitJob
// ---------------------------------------------------------------------------

describe('DvmMarketplace.submitJob()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConstructJobRequest.mockReturnValue({
      kind: 5100,
      created_at: 1700000000,
      tags: [['i', 'test', 'text']],
      content: '',
    });
    mockPublishEvent.mockResolvedValue('submitted-request-id');
  });

  it('constructs and publishes a kind:5xxx event', async () => {
    const marketplace = makeMarketplace();
    const eventId = await marketplace.submitJob(BASE_JOB_REQUEST, SIGNER_NSEC);

    expect(mockConstructJobRequest).toHaveBeenCalledWith(BASE_JOB_REQUEST);
    expect(mockPublishEvent).toHaveBeenCalledOnce();
    expect(typeof eventId).toBe('string');
  });

  it('includes job request relay hints in the publish relay list', async () => {
    const marketplace = makeMarketplace(['wss://default.example.com']);

    await marketplace.submitJob(
      { ...BASE_JOB_REQUEST, relays: ['wss://custom-relay.example.com'] },
      SIGNER_NSEC
    );

    const publishArg = mockPublishEvent.mock.calls[0];
    expect(publishArg[1]).toContain('wss://custom-relay.example.com');
    expect(publishArg[1]).toContain('wss://default.example.com');
  });

  it('throws for invalid signerNsec (too short)', async () => {
    const marketplace = makeMarketplace();

    await expect(
      marketplace.submitJob(BASE_JOB_REQUEST, 'short')
    ).rejects.toThrow(/invalid signerNsec/i);
  });
});

// ---------------------------------------------------------------------------
// 4. DvmMarketplace.subscribeToResults
// ---------------------------------------------------------------------------

describe('DvmMarketplace.subscribeToResults()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an unsubscribe function', async () => {
    const mockUnsub = vi.fn();
    mockSubscribeToJobResults.mockReturnValue(mockUnsub);

    const marketplace = makeMarketplace();
    // Submit a job first so the marketplace knows the kind
    mockConstructJobRequest.mockReturnValue({ kind: 5100, created_at: 1, tags: [], content: '' });
    mockPublishEvent.mockResolvedValue('req-id-001');
    await marketplace.submitJob(BASE_JOB_REQUEST, SIGNER_NSEC);

    const callback = vi.fn();
    const unsub = marketplace.subscribeToResults('req-id-001', callback);

    expect(typeof unsub).toBe('function');
    unsub(); // Should not throw
  });
});

// ---------------------------------------------------------------------------
// 5. DvmMarketplace.payForResult
// ---------------------------------------------------------------------------

describe('DvmMarketplace.payForResult()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pays the BOLT-11 invoice via NWC and returns PaymentResult', async () => {
    const paymentResult = {
      preimage: 'preimage' + '0'.repeat(56),
      paymentHash: 'hash' + '0'.repeat(60),
      feeMsats: 100n,
      totalMsats: 10_100n,
    };
    mockPayInvoice.mockResolvedValue(paymentResult);

    const marketplace = makeMarketplace();
    const result = makeJobResult();
    const paid = await marketplace.payForResult(result);

    expect(mockPayInvoice).toHaveBeenCalledWith('lnbc100u1pjtestinvoice...');
    expect(paid).toEqual(paymentResult);
  });

  it('throws when the result has no payment info', async () => {
    const marketplace = makeMarketplace();
    const result = makeJobResult({ payment: undefined });

    await expect(marketplace.payForResult(result)).rejects.toThrow(/no payment info/i);
  });

  it('throws for Cashu token payments (not supported via NWC)', async () => {
    const marketplace = makeMarketplace();
    const result = makeJobResult({
      payment: {
        amountMsats: 10_000n,
        invoice: 'cashuAtoken...',
        isCashu: true,
      },
    });

    await expect(marketplace.payForResult(result)).rejects.toThrow(/cashu/i);
  });

  it('throws when payment has no BOLT-11 invoice (amount-only tag)', async () => {
    const marketplace = makeMarketplace();
    const result = makeJobResult({
      payment: {
        amountMsats: 10_000n,
        invoice: undefined,
        isCashu: false,
      },
    });

    await expect(marketplace.payForResult(result)).rejects.toThrow(/no bolt-11 invoice/i);
  });
});

// ---------------------------------------------------------------------------
// 6. DvmMarketplace.submitFeedback
// ---------------------------------------------------------------------------

describe('DvmMarketplace.submitFeedback()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConstructJobFeedback.mockReturnValue({
      kind: 7000,
      created_at: 1700000000,
      tags: [['e', 'req-id'], ['p', 'provider-pubkey'], ['status', 'success']],
      content: '',
    });
    mockPublishEvent.mockResolvedValue('feedback-event-id');
  });

  it('constructs and publishes a kind:7000 feedback event', async () => {
    const marketplace = makeMarketplace();
    const feedbackId = await marketplace.submitFeedback({
      requestEventId: 'req-id',
      resultEventId: 'res-id',
      providerPubkey: 'provider-pub',
      status: 'success',
      amountMsats: 10_000n,
      signerNsec: SIGNER_NSEC,
    });

    expect(mockConstructJobFeedback).toHaveBeenCalledWith(
      'req-id',
      'res-id',
      'provider-pub',
      'success',
      10_000n
    );
    expect(mockPublishEvent).toHaveBeenCalledOnce();
    expect(feedbackId).toBe('feedback-event-id');
  });

  it('adds comment to event content', async () => {
    const marketplace = makeMarketplace();
    await marketplace.submitFeedback({
      requestEventId: 'req-id',
      resultEventId: 'res-id',
      providerPubkey: 'provider-pub',
      status: 'success',
      comment: 'Great result!',
      signerNsec: SIGNER_NSEC,
    });

    // The signed event should have content set to the comment
    const signedArg = mockCeps.signEventWithActiveSession.mock.calls[0][0];
    expect(signedArg.content).toBe('Great result!');
  });

  it('throws for invalid signerNsec', async () => {
    const marketplace = makeMarketplace();

    await expect(
      marketplace.submitFeedback({
        requestEventId: 'req-id',
        resultEventId: 'res-id',
        providerPubkey: 'pub',
        status: 'success',
        signerNsec: 'invalid',
      })
    ).rejects.toThrow(/invalid signerNsec/i);
  });
});

// ---------------------------------------------------------------------------
// 7. DvmMarketplace.executeJob (full lifecycle)
// ---------------------------------------------------------------------------

describe('DvmMarketplace.executeJob()', () => {
  const mockResult = makeJobResult();

  beforeEach(() => {
    vi.clearAllMocks();

    mockConstructJobRequest.mockReturnValue({
      kind: 5100,
      created_at: 1700000000,
      tags: [],
      content: '',
    });
    mockPublishEvent.mockResolvedValue('lifecycle-req-id');
    mockWaitForJobResult.mockResolvedValue(mockResult);
    mockConstructJobFeedback.mockReturnValue({
      kind: 7000,
      created_at: 1700000000,
      tags: [],
      content: '',
    });
  });

  it('returns requestId, result on success', async () => {
    const marketplace = makeMarketplace();

    const { requestId, result } = await marketplace.executeJob({
      request: BASE_JOB_REQUEST,
      signerNsec: SIGNER_NSEC,
      timeout: 5000,
    });

    expect(requestId).toBe('lifecycle-req-id');
    expect(result).toEqual(mockResult);
  });

  it('auto-pays when result has invoice and amount <= autoPayBelow', async () => {
    const paymentResult = {
      preimage: 'abc' + '0'.repeat(61),
      paymentHash: 'def' + '0'.repeat(61),
      feeMsats: 0n,
      totalMsats: 10_000n,
    };
    mockPayInvoice.mockResolvedValue(paymentResult);

    const marketplace = makeMarketplace();

    const { paymentResult: paid } = await marketplace.executeJob({
      request: BASE_JOB_REQUEST,
      signerNsec: SIGNER_NSEC,
      autoPayBelow: 50_000n, // 10_000n <= 50_000n → auto-pay
      timeout: 5000,
    });

    expect(mockPayInvoice).toHaveBeenCalledOnce();
    expect(paid).toEqual(paymentResult);
  });

  it('does not auto-pay when amount exceeds autoPayBelow', async () => {
    const expensiveResult = makeJobResult({
      payment: {
        amountMsats: 100_000n, // > autoPayBelow of 50_000n
        invoice: 'lnbc...',
        isCashu: false,
      },
    });
    mockWaitForJobResult.mockResolvedValue(expensiveResult);

    const marketplace = makeMarketplace();

    const { paymentResult: paid } = await marketplace.executeJob({
      request: BASE_JOB_REQUEST,
      signerNsec: SIGNER_NSEC,
      autoPayBelow: 50_000n,
      timeout: 5000,
    });

    expect(mockPayInvoice).not.toHaveBeenCalled();
    expect(paid).toBeUndefined();
  });

  it('publishes kind:7000 feedback after receiving the result', async () => {
    const marketplace = makeMarketplace();

    await marketplace.executeJob({
      request: BASE_JOB_REQUEST,
      signerNsec: SIGNER_NSEC,
      timeout: 5000,
    });

    const signedKinds = mockCeps.signEventWithActiveSession.mock.calls.map(
      (c: any[]) => c[0].kind
    );
    expect(signedKinds).toContain(7000);
  });

  it('returns feedbackId when feedback is published successfully', async () => {
    mockPublishEvent
      .mockResolvedValueOnce('req-id') // submitJob
      .mockResolvedValueOnce('feedback-id'); // submitFeedback

    const marketplace = makeMarketplace();

    const { feedbackId } = await marketplace.executeJob({
      request: BASE_JOB_REQUEST,
      signerNsec: SIGNER_NSEC,
      timeout: 5000,
    });

    expect(feedbackId).toBe('feedback-id');
  });

  it('propagates timeout error from waitForJobResult', async () => {
    mockWaitForJobResult.mockRejectedValue(
      new Error('NIP-90 job result timeout after 5000ms')
    );

    const marketplace = makeMarketplace();

    await expect(
      marketplace.executeJob({
        request: BASE_JOB_REQUEST,
        signerNsec: SIGNER_NSEC,
        timeout: 5000,
      })
    ).rejects.toThrow(/timeout/i);
  });
});

// ---------------------------------------------------------------------------
// 8. DvmMarketplace.getActiveJobs
// ---------------------------------------------------------------------------

describe('DvmMarketplace.getActiveJobs()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConstructJobRequest.mockReturnValue({
      kind: 5100,
      created_at: 1700000000,
      tags: [],
      content: '',
    });
  });

  it('returns empty array when no jobs have been submitted', async () => {
    const marketplace = makeMarketplace();
    const jobs = await marketplace.getActiveJobs('any-pubkey');
    expect(jobs).toEqual([]);
  });

  it('returns submitted jobs that have not yet received a result', async () => {
    mockPublishEvent
      .mockResolvedValueOnce('job-1')
      .mockResolvedValueOnce('job-2');

    const marketplace = makeMarketplace();
    await marketplace.submitJob(BASE_JOB_REQUEST, SIGNER_NSEC);
    await marketplace.submitJob({ ...BASE_JOB_REQUEST, kind: 5200 }, SIGNER_NSEC);

    const jobs = await marketplace.getActiveJobs('any-pubkey');
    expect(jobs.length).toBe(2);
    expect(jobs.map((j) => j.requestEventId)).toContain('job-1');
    expect(jobs.map((j) => j.requestEventId)).toContain('job-2');
  });
});
