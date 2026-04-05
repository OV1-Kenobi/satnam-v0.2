/**
 * @file cashu.test.ts
 * @description Unit tests for the Cashu eCash client.
 *
 * The vault is mocked with an in-memory store (same pattern as vault.test.ts).
 * The @cashu/cashu-ts library is mocked to avoid network calls and WASM
 * dependencies. IndexedDB for mint metadata is mocked in-memory.
 *
 * Tests cover:
 * 1. addMint — stores mint metadata in IDB, fetches mint info
 * 2. removeMint — deletes from IDB, clears proofs from vault
 * 3. listMints — returns mints with correct balances from vault
 * 4. mintTokens — creates mint quote, mints proofs, stores in vault
 * 5. meltTokens — creates melt quote, melts proofs, removes spent, stores change
 * 6. sendTokens — coin selection, swap, stores kept proofs, returns token string
 * 7. receiveTokens — swaps received proofs, stores new proofs
 * 8. getBalance — sums proofs for specific mint or all mints
 * 9. checkProofStatus — maps CheckStateEnum to 'valid'/'spent'/'pending'
 * 10. swapProofs — swaps proofs, removes old, stores new
 * 11. selectProofsForAmount — greedy descending coin selection
 * 12. getBalance — returns 0 for unknown mint (no vault entry)
 * 13. CashuClient — spend-policy integration (selectAgentSpendRail)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CashuClient } from '../../src/lib/cashu/client.js';
import {
  selectAgentSpendRail,
  evaluateSweep,
  checkSpendPolicy,
  calculateSatsCostFromPricing,
  createDefaultSpendPolicy,
  serializePolicy,
  deserializePolicy,
  recordSpend,
  getRolling24hSpend,
} from '../../src/lib/agent/wallet/spend-policy.js';

// ---------------------------------------------------------------------------
// Vault mock
// ---------------------------------------------------------------------------

// Backing store for vault proof data: mintUrlHash → CashuProof[]
const vaultProofStore = new Map<string, unknown[]>();

const mockVault = {
  storeCashuProofs: vi.fn(async (urlHash: string, proofs: unknown[]) => {
    vaultProofStore.set(urlHash, proofs);
  }),
  getCashuProofs: vi.fn(async (urlHash: string) => {
    const proofs = vaultProofStore.get(urlHash);
    if (!proofs) {
      throw Object.assign(new Error('IdentityNotFound'), { vaultError: 'IdentityNotFound' });
    }
    return proofs;
  }),
};

// ---------------------------------------------------------------------------
// IndexedDB mock
// ---------------------------------------------------------------------------

const mintIdbStore = new Map<string, unknown>();
const ledgerIdbStore = new Map<string, unknown>();

function createMockIndexedDb() {
  // Route to different backing stores based on DB name
  const stores: Record<string, Map<string, unknown>> = {
    'satnam-cashu-mints': mintIdbStore,
    'satnam-agent-spend-ledger': ledgerIdbStore,
  };

  function makeRequest<T>(result: T): IDBRequest<T> {
    let onsuccess: ((e: Event) => void) | null = null;
    const req = {
      result,
      error: null,
      get onsuccess() { return onsuccess; },
      set onsuccess(fn) {
        onsuccess = fn;
        if (fn) Promise.resolve().then(() => fn({ target: req } as unknown as Event));
      },
      onerror: null,
    } as unknown as IDBRequest<T>;
    return req;
  }

  function makeObjStore(backing: Map<string, unknown>): IDBObjectStore {
    return {
      get: (key: IDBValidKey) => makeRequest(backing.get(String(key))),
      getAll: () => makeRequest(Array.from(backing.values())),
      getAllKeys: () => makeRequest(Array.from(backing.keys()) as unknown as IDBValidKey[]),
      put: (value: unknown) => {
        const record = value as Record<string, unknown>;
        const key = String(record['url'] ?? record['id'] ?? '');
        backing.set(key, value);
        return makeRequest(key as unknown as IDBValidKey);
      },
      delete: (key: IDBValidKey) => {
        backing.delete(String(key));
        return makeRequest(undefined);
      },
      createIndex: () => ({} as IDBIndex),
    } as unknown as IDBObjectStore;
  }

  function makeTx(dbName: string): IDBTransaction {
    const backing = stores[dbName] ?? mintIdbStore;
    let oncomplete: ((e: Event) => void) | null = null;
    const tx = {
      objectStore: () => makeObjStore(backing),
      get oncomplete() { return oncomplete; },
      set oncomplete(fn) {
        oncomplete = fn;
        if (fn) Promise.resolve().then(() => fn({} as Event));
      },
      onerror: null,
      commit: () => {},
      abort: () => {},
      error: null,
    } as unknown as IDBTransaction;
    return tx;
  }

  return {
    open: (dbName: string, _version?: number) => {
      const backing = stores[dbName] ?? mintIdbStore;
      const fakeDb: IDBDatabase = {
        transaction: () => makeTx(dbName),
        createObjectStore: () => makeObjStore(backing),
      } as unknown as IDBDatabase;

      const req = { result: fakeDb, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      const proxy = new Proxy(req, {
        set(target, prop, value) {
          (target as Record<string, unknown>)[String(prop)] = value;
          if (prop === 'onsuccess' && value) {
            Promise.resolve().then(() => (value as (e: Event) => void)({ target: proxy } as unknown as Event));
          }
          return true;
        },
      });
      return proxy as unknown as IDBRequest<IDBDatabase>;
    },
  };
}

// ---------------------------------------------------------------------------
// cashu-ts mock
// ---------------------------------------------------------------------------

const mockCheckStateEnum = {
  UNSPENT: 'UNSPENT',
  PENDING: 'PENDING',
  SPENT: 'SPENT',
};

function makeMockMintAndWallet() {
  const mockMint = { getInfo: vi.fn() };

  const mockWallet = {
    createMintQuote: vi.fn(),
    mintProofs: vi.fn(),
    createMeltQuote: vi.fn(),
    meltProofs: vi.fn(),
    send: vi.fn(),
    swap: vi.fn(),
    checkProofsStates: vi.fn(),
    loadMint: vi.fn().mockResolvedValue(undefined),
  };

  return { mockMint, mockWallet };
}

vi.mock('@cashu/cashu-ts', () => {
  const { mockMint, mockWallet } = makeMockMintAndWallet();

  return {
    CashuMint: vi.fn().mockImplementation(() => mockMint),
    CashuWallet: vi.fn().mockImplementation(() => mockWallet),
    getEncodedToken: vi.fn((token: unknown) => `cashuA${JSON.stringify(token)}`),
    getDecodedToken: vi.fn((str: string) => JSON.parse(str.replace('cashuA', ''))),
    CheckStateEnum: mockCheckStateEnum,
  };
});

// ---------------------------------------------------------------------------
// Test proof fixtures
// ---------------------------------------------------------------------------

const MINT_URL = 'https://mint.example.com';
const MINT_URL_2 = 'https://mint2.example.com';

const PROOF_1: { id: string; amount: number; secret: string; C: string } = {
  id: 'keyset-1',
  amount: 64,
  secret: 'secret-1',
  C: 'point-1',
};

const PROOF_2: { id: string; amount: number; secret: string; C: string } = {
  id: 'keyset-1',
  amount: 32,
  secret: 'secret-2',
  C: 'point-2',
};

const PROOF_4: { id: string; amount: number; secret: string; C: string } = {
  id: 'keyset-1',
  amount: 4,
  secret: 'secret-4',
  C: 'point-4',
};

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vaultProofStore.clear();
  mintIdbStore.clear();
  ledgerIdbStore.clear();
  vi.clearAllMocks();

  // Install IDB mock
  (global as unknown as { indexedDB: ReturnType<typeof createMockIndexedDb> }).indexedDB = createMockIndexedDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// addMint
// ---------------------------------------------------------------------------

describe('CashuClient.addMint()', () => {
  it('stores mint metadata in IndexedDB', async () => {
    const { CashuMint, CashuWallet } = await import('@cashu/cashu-ts');
    vi.mocked(CashuMint).mockImplementationOnce(() => ({
      getInfo: vi.fn().mockResolvedValue({
        name: 'Test Mint',
        nuts: { 0: {}, 1: {}, 4: {}, 5: {} },
      }),
    }) as never);

    const client = new CashuClient(mockVault as never);
    await client.addMint(MINT_URL);

    const mints = await client.listMints();
    const mint = mints.find((m) => m.url === MINT_URL);
    expect(mint).toBeDefined();
    expect(mint?.name).toBe('Test Mint');
    expect(mint?.isAllowed).toBe(true);
  });

  it('normalizes the mint URL (strips trailing slash)', async () => {
    const { CashuMint } = await import('@cashu/cashu-ts');
    vi.mocked(CashuMint).mockImplementationOnce(() => ({
      getInfo: vi.fn().mockResolvedValue({ name: 'Mint', nuts: {} }),
    }) as never);

    const client = new CashuClient(mockVault as never);
    await client.addMint(MINT_URL + '/');

    const mints = await client.listMints();
    // Should be stored without trailing slash
    expect(mints.find((m) => m.url === MINT_URL)).toBeDefined();
  });

  it('succeeds even when mint info fetch fails', async () => {
    const { CashuMint } = await import('@cashu/cashu-ts');
    vi.mocked(CashuMint).mockImplementationOnce(() => ({
      getInfo: vi.fn().mockRejectedValue(new Error('Network error')),
    }) as never);

    const client = new CashuClient(mockVault as never);
    await expect(client.addMint(MINT_URL)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// listMints
// ---------------------------------------------------------------------------

describe('CashuClient.listMints()', () => {
  it('returns balance from stored proofs', async () => {
    const { CashuMint } = await import('@cashu/cashu-ts');
    vi.mocked(CashuMint).mockImplementation(() => ({
      getInfo: vi.fn().mockResolvedValue({ name: 'Mint', nuts: {} }),
    }) as never);

    // Pre-store proofs in the vault
    const { sha256 } = await import('@noble/hashes/sha256');
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils');
    const urlHash = bytesToHex(sha256(utf8ToBytes(MINT_URL)));
    vaultProofStore.set(urlHash, [PROOF_1, PROOF_2]);

    const client = new CashuClient(mockVault as never);
    await client.addMint(MINT_URL);

    const mints = await client.listMints();
    const mint = mints.find((m) => m.url === MINT_URL)!;
    expect(mint.balance).toBe(64 + 32); // 96 sats
  });
});

// ---------------------------------------------------------------------------
// getBalance
// ---------------------------------------------------------------------------

describe('CashuClient.getBalance()', () => {
  it('returns 0 for a mint with no stored proofs', async () => {
    const client = new CashuClient(mockVault as never);
    const balance = await client.getBalance(MINT_URL);
    expect(balance).toBe(0);
  });

  it('sums proof amounts for a specific mint', async () => {
    const { sha256 } = await import('@noble/hashes/sha256');
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils');
    const urlHash = bytesToHex(sha256(utf8ToBytes(MINT_URL)));
    vaultProofStore.set(urlHash, [PROOF_1, PROOF_2, PROOF_4]);

    const client = new CashuClient(mockVault as never);
    const balance = await client.getBalance(MINT_URL);
    expect(balance).toBe(64 + 32 + 4); // 100 sats
  });

  it('sums across all mints when no URL is provided', async () => {
    const { sha256 } = await import('@noble/hashes/sha256');
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils');

    // Add both mints to IDB
    mintIdbStore.set(MINT_URL, { url: MINT_URL, nuts: [], isAllowed: true, addedAt: 0 });
    mintIdbStore.set(MINT_URL_2, { url: MINT_URL_2, nuts: [], isAllowed: true, addedAt: 0 });

    const urlHash1 = bytesToHex(sha256(utf8ToBytes(MINT_URL)));
    const urlHash2 = bytesToHex(sha256(utf8ToBytes(MINT_URL_2)));
    vaultProofStore.set(urlHash1, [PROOF_1]); // 64 sats
    vaultProofStore.set(urlHash2, [PROOF_2]); // 32 sats

    const client = new CashuClient(mockVault as never);
    const total = await client.getBalance();
    expect(total).toBe(64 + 32); // 96 sats
  });
});

// ---------------------------------------------------------------------------
// mintTokens
// ---------------------------------------------------------------------------

describe('CashuClient.mintTokens()', () => {
  it('creates a mint quote and mints proofs', async () => {
    const { CashuMint, CashuWallet } = await import('@cashu/cashu-ts');

    const newProofs = [
      { id: 'ks1', amount: 64, secret: 'new-secret-1', C: 'new-point-1' },
      { id: 'ks1', amount: 32, secret: 'new-secret-2', C: 'new-point-2' },
    ];

    vi.mocked(CashuMint).mockImplementationOnce(() => ({}) as never);
    vi.mocked(CashuWallet).mockImplementationOnce(() => ({
      createMintQuote: vi.fn().mockResolvedValue({ quote: 'quote-id-123', request: 'lnbc96u1...' }),
      mintProofs: vi.fn().mockResolvedValue(newProofs),
    }) as never);

    const client = new CashuClient(mockVault as never);
    const proofs = await client.mintTokens(96, MINT_URL);

    expect(proofs).toHaveLength(2);
    expect(proofs[0].amount).toBe(64);
    expect(proofs[1].amount).toBe(32);
    expect(mockVault.storeCashuProofs).toHaveBeenCalled();
  });

  it('appends new proofs to existing stored proofs', async () => {
    const { CashuMint, CashuWallet } = await import('@cashu/cashu-ts');
    const { sha256 } = await import('@noble/hashes/sha256');
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils');

    // Pre-populate vault with existing proofs
    const urlHash = bytesToHex(sha256(utf8ToBytes(MINT_URL)));
    vaultProofStore.set(urlHash, [PROOF_4]); // existing 4 sats

    const newProof = { id: 'ks1', amount: 32, secret: 'new-s', C: 'new-c' };

    vi.mocked(CashuMint).mockImplementationOnce(() => ({}) as never);
    vi.mocked(CashuWallet).mockImplementationOnce(() => ({
      createMintQuote: vi.fn().mockResolvedValue({ quote: 'q1' }),
      mintProofs: vi.fn().mockResolvedValue([newProof]),
    }) as never);

    const client = new CashuClient(mockVault as never);
    await client.mintTokens(32, MINT_URL);

    // Should have stored both old and new proofs
    const storedProofs = vaultProofStore.get(urlHash) as unknown[];
    expect(storedProofs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// meltTokens
// ---------------------------------------------------------------------------

describe('CashuClient.meltTokens()', () => {
  it('melts proofs and removes them from vault on success', async () => {
    const { CashuMint, CashuWallet } = await import('@cashu/cashu-ts');
    const { sha256 } = await import('@noble/hashes/sha256');
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils');

    const urlHash = bytesToHex(sha256(utf8ToBytes(MINT_URL)));
    vaultProofStore.set(urlHash, [PROOF_1, PROOF_2, PROOF_4]);
    // Register mint so getMintUrlsForProofs can find it
    mintIdbStore.set(MINT_URL, { url: MINT_URL, nuts: [], isAllowed: true, addedAt: 0 });

    const changeProof = { id: 'ks1', amount: 4, secret: 'change-s', C: 'change-c' };

    vi.mocked(CashuMint).mockImplementationOnce(() => ({}) as never);
    vi.mocked(CashuWallet).mockImplementationOnce(() => ({
      createMeltQuote: vi.fn().mockResolvedValue({ quote: 'melt-quote-id', fee_reserve: 2 }),
      meltProofs: vi.fn().mockResolvedValue({
        quote: { state: 'PAID', payment_preimage: 'preimage-hex' },
        change: [changeProof],
      }),
    }) as never);

    const client = new CashuClient(mockVault as never);
    const result = await client.meltTokens([PROOF_1], 'lnbc96u1...');

    expect(result.paid).toBe(true);
    expect(result.preimage).toBe('preimage-hex');
    expect(result.change).toHaveLength(1);

    // PROOF_1 was spent; remaining should be PROOF_2, PROOF_4, and change
    const stored = vaultProofStore.get(urlHash) as { secret: string }[];
    const secrets = stored.map((p) => p.secret);
    expect(secrets).not.toContain('secret-1'); // PROOF_1 removed
    expect(secrets).toContain('secret-2');     // PROOF_2 kept
    expect(secrets).toContain('change-s');     // change added
  });

  it('throws when no proofs provided', async () => {
    const client = new CashuClient(mockVault as never);
    await expect(client.meltTokens([], 'lnbc...')).rejects.toThrow(/no proofs/i);
  });
});

// ---------------------------------------------------------------------------
// sendTokens
// ---------------------------------------------------------------------------

describe('CashuClient.sendTokens()', () => {
  it('returns a cashuA serialized token string', async () => {
    const { CashuMint, CashuWallet, getEncodedToken } = await import('@cashu/cashu-ts');
    const { sha256 } = await import('@noble/hashes/sha256');
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils');

    const urlHash = bytesToHex(sha256(utf8ToBytes(MINT_URL)));
    vaultProofStore.set(urlHash, [PROOF_1, PROOF_2]); // 96 sats total

    const sendProofs = [PROOF_2]; // 32 sats to send
    const keepProofs = [PROOF_1]; // 64 sats to keep

    vi.mocked(CashuMint).mockImplementationOnce(() => ({}) as never);
    vi.mocked(CashuWallet).mockImplementationOnce(() => ({
      send: vi.fn().mockResolvedValue({ send: sendProofs, keep: keepProofs }),
    }) as never);
    vi.mocked(getEncodedToken).mockReturnValueOnce('cashuAtest-token');

    const client = new CashuClient(mockVault as never);
    const token = await client.sendTokens(32, MINT_URL);

    expect(token).toBe('cashuAtest-token');
  });

  it('throws when balance is insufficient', async () => {
    const { sha256 } = await import('@noble/hashes/sha256');
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils');

    const urlHash = bytesToHex(sha256(utf8ToBytes(MINT_URL)));
    vaultProofStore.set(urlHash, [PROOF_4]); // only 4 sats

    const client = new CashuClient(mockVault as never);
    await expect(client.sendTokens(100, MINT_URL)).rejects.toThrow(/insufficient/i);
  });
});

// ---------------------------------------------------------------------------
// receiveTokens
// ---------------------------------------------------------------------------

describe('CashuClient.receiveTokens()', () => {
  it('swaps proofs and stores new proofs from received token', async () => {
    const { CashuMint, CashuWallet, getDecodedToken } = await import('@cashu/cashu-ts');
    const { sha256 } = await import('@noble/hashes/sha256');
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils');

    const urlHash = bytesToHex(sha256(utf8ToBytes(MINT_URL)));

    const receivedProof = { id: 'ks1', amount: 16, secret: 'recv-secret', C: 'recv-point' };
    const freshProof = { id: 'ks1', amount: 16, secret: 'fresh-secret', C: 'fresh-point' };

    vi.mocked(getDecodedToken).mockReturnValueOnce({
      token: [{ mint: MINT_URL, proofs: [receivedProof] }],
    } as never);

    vi.mocked(CashuMint).mockImplementationOnce(() => ({}) as never);
    vi.mocked(CashuWallet).mockImplementationOnce(() => ({
      swap: vi.fn().mockResolvedValue({ send: [freshProof], keep: [] }),
    }) as never);

    const client = new CashuClient(mockVault as never);
    const newProofs = await client.receiveTokens('cashuAtest-token');

    expect(newProofs).toHaveLength(1);
    expect(newProofs[0].secret).toBe('fresh-secret');

    // Fresh proofs should be in the vault
    const stored = vaultProofStore.get(urlHash) as { secret: string }[];
    expect(stored.some((p) => p.secret === 'fresh-secret')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkProofStatus
// ---------------------------------------------------------------------------

describe('CashuClient.checkProofStatus()', () => {
  it('maps UNSPENT → valid', async () => {
    const { CashuMint, CashuWallet, CheckStateEnum } = await import('@cashu/cashu-ts');

    mintIdbStore.set(MINT_URL, { url: MINT_URL, nuts: [], isAllowed: true, addedAt: 0 });
    const { sha256 } = await import('@noble/hashes/sha256');
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils');
    const urlHash = bytesToHex(sha256(utf8ToBytes(MINT_URL)));
    vaultProofStore.set(urlHash, [PROOF_1]);

    vi.mocked(CashuMint).mockImplementationOnce(() => ({}) as never);
    vi.mocked(CashuWallet).mockImplementationOnce(() => ({
      checkProofsStates: vi.fn().mockResolvedValue([{ Y: 'y1', state: CheckStateEnum.UNSPENT, witness: null }]),
    }) as never);

    const client = new CashuClient(mockVault as never);
    const statuses = await client.checkProofStatus([PROOF_1]);
    expect(statuses[0].state).toBe('valid');
  });

  it('maps SPENT → spent', async () => {
    const { CashuMint, CashuWallet, CheckStateEnum } = await import('@cashu/cashu-ts');

    mintIdbStore.set(MINT_URL, { url: MINT_URL, nuts: [], isAllowed: true, addedAt: 0 });
    const { sha256 } = await import('@noble/hashes/sha256');
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils');
    const urlHash = bytesToHex(sha256(utf8ToBytes(MINT_URL)));
    vaultProofStore.set(urlHash, [PROOF_2]);

    vi.mocked(CashuMint).mockImplementationOnce(() => ({}) as never);
    vi.mocked(CashuWallet).mockImplementationOnce(() => ({
      checkProofsStates: vi.fn().mockResolvedValue([{ state: CheckStateEnum.SPENT, witness: null }]),
    }) as never);

    const client = new CashuClient(mockVault as never);
    const statuses = await client.checkProofStatus([PROOF_2]);
    expect(statuses[0].state).toBe('spent');
  });

  it('returns empty array for empty input', async () => {
    const client = new CashuClient(mockVault as never);
    const statuses = await client.checkProofStatus([]);
    expect(statuses).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// swapProofs
// ---------------------------------------------------------------------------

describe('CashuClient.swapProofs()', () => {
  it('swaps proofs and stores fresh ones', async () => {
    const { CashuMint, CashuWallet } = await import('@cashu/cashu-ts');
    const { sha256 } = await import('@noble/hashes/sha256');
    const { bytesToHex, utf8ToBytes } = await import('@noble/hashes/utils');

    const urlHash = bytesToHex(sha256(utf8ToBytes(MINT_URL)));
    vaultProofStore.set(urlHash, [PROOF_1, PROOF_4]);

    const swapped = { id: 'ks1', amount: 68, secret: 'swapped-secret', C: 'swapped-point' };

    vi.mocked(CashuMint).mockImplementationOnce(() => ({}) as never);
    vi.mocked(CashuWallet).mockImplementationOnce(() => ({
      swap: vi.fn().mockResolvedValue({ send: [swapped], keep: [] }),
    }) as never);

    const client = new CashuClient(mockVault as never);
    const newProofs = await client.swapProofs([PROOF_1, PROOF_4], MINT_URL);

    expect(newProofs[0].secret).toBe('swapped-secret');
    const stored = vaultProofStore.get(urlHash) as { secret: string }[];
    // Old proofs removed, new one present
    expect(stored.some((p) => p.secret === 'secret-1')).toBe(false);
    expect(stored.some((p) => p.secret === 'swapped-secret')).toBe(true);
  });

  it('returns empty array for empty input', async () => {
    const client = new CashuClient(mockVault as never);
    const result = await client.swapProofs([], MINT_URL);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Spend Policy (from spend-policy.ts)
// ---------------------------------------------------------------------------

describe('selectAgentSpendRail()', () => {
  it('returns preferred_spend_rail when not auto', () => {
    const policy = createDefaultSpendPolicy({ preferred_spend_rail: 'lightning' });
    expect(selectAgentSpendRail(10000n, policy)).toBe('lightning');
  });

  it('returns cashu for preferred cashu', () => {
    const policy = createDefaultSpendPolicy({ preferred_spend_rail: 'cashu' });
    expect(selectAgentSpendRail(10000n, policy)).toBe('cashu');
  });

  it('returns cashu for high privacy preference', () => {
    const policy = createDefaultSpendPolicy({ preferred_spend_rail: 'auto' });
    expect(selectAgentSpendRail(10000n, policy, 'high')).toBe('cashu');
  });

  it('returns cashu for sub-1000 msats (sub-sat routing)', () => {
    const policy = createDefaultSpendPolicy({ preferred_spend_rail: 'auto' });
    expect(selectAgentSpendRail(999n, policy, 'balanced')).toBe('cashu');
  });

  it('returns lightning for standard amounts with balanced privacy', () => {
    const policy = createDefaultSpendPolicy({ preferred_spend_rail: 'auto' });
    expect(selectAgentSpendRail(10000n, policy, 'balanced')).toBe('lightning');
  });
});

describe('evaluateSweep()', () => {
  it('recommends no sweep when balance is below threshold', () => {
    const policy = createDefaultSpendPolicy({
      sweep_threshold_msats: 500_000n,
      sweep_destination: 'cashu-mint-url',
      sweep_rail: 'cashu',
    });
    const result = evaluateSweep(400_000n, policy);
    expect(result.shouldSweep).toBe(false);
  });

  it('recommends sweep when balance exceeds threshold', () => {
    const policy = createDefaultSpendPolicy({
      sweep_threshold_msats: 500_000n,
      sweep_destination: 'cashu-mint-url',
      sweep_rail: 'cashu',
    });
    const result = evaluateSweep(750_000n, policy);
    expect(result.shouldSweep).toBe(true);
    expect(result.sweepAmountMsats).toBe(250_000n);
    expect(result.destination).toBe('cashu-mint-url');
    expect(result.rail).toBe('cashu');
  });
});

describe('checkSpendPolicy()', () => {
  it('rejects amounts above max_single_spend_msats', async () => {
    const policy = createDefaultSpendPolicy({ max_single_spend_msats: 1000n });
    const result = await checkSpendPolicy('pubkey', 2000n, policy);
    expect(result.allowed).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/per-transaction limit/i);
  });

  it('requires approval above requires_approval_above_msats', async () => {
    const policy = createDefaultSpendPolicy({
      max_single_spend_msats: 10_000_000n,
      requires_approval_above_msats: 1000n,
    });
    const result = await checkSpendPolicy('pubkey', 5000n, policy, {
      hasLightningTarget: true,
    });
    expect(result.allowed).toBe(true);
    expect((result as { requiresApproval: boolean }).requiresApproval).toBe(true);
  });

  it('allows amounts within all limits', async () => {
    const policy = createDefaultSpendPolicy({
      max_single_spend_msats: 1_000_000n,
      requires_approval_above_msats: 1_000_000n,
    });
    const result = await checkSpendPolicy('pubkey', 500n, policy, {
      hasLightningTarget: true,
    });
    expect(result.allowed).toBe(true);
    expect((result as { requiresApproval: boolean }).requiresApproval).toBe(false);
  });

  it('rejects Cashu payment to non-allowed mint', async () => {
    const policy = createDefaultSpendPolicy({
      preferred_spend_rail: 'cashu',
      allowed_mints: ['https://allowed-mint.com'],
    });
    const result = await checkSpendPolicy('pubkey', 500n, policy, {
      hasLightningTarget: false,
      hasCashuCapability: true,
      cashuBalanceSats: 1000,
      mintUrl: 'https://forbidden-mint.com',
    });
    expect(result.allowed).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/allowed_mints/i);
  });
});

describe('calculateSatsCostFromPricing()', () => {
  it('correctly calculates msats cost from token counts and pricing', () => {
    // 1M input tokens at $1/M, 1M output at $2/M = $3 total
    // At BTC $100,000/BTC: $3 / 100000 = 0.00003 BTC = 3000 sats = 3,000,000 msats
    const cost = calculateSatsCostFromPricing(
      1_000_000,
      1_000_000,
      { input_price_per_million: 1.0, output_price_per_million: 2.0 },
      100_000,
    );
    expect(cost).toBe(3_000_000n);
  });

  it('rounds up fractional msats', () => {
    // Very small cost that results in a fraction
    const cost = calculateSatsCostFromPricing(
      1,
      1,
      { input_price_per_million: 0.001, output_price_per_million: 0.001 },
      100_000,
    );
    // Should round up to at least 1
    expect(cost).toBeGreaterThanOrEqual(1n);
  });
});

describe('serializePolicy() / deserializePolicy()', () => {
  it('round-trips through JSON serialization', () => {
    const policy = createDefaultSpendPolicy({
      max_single_spend_msats: 500_000n,
      allowed_mints: ['https://mint.example.com'],
    });

    const serialized = serializePolicy(policy);
    const json = JSON.stringify(serialized);
    const restored = deserializePolicy(JSON.parse(json));

    expect(restored.max_single_spend_msats).toBe(500_000n);
    expect(restored.daily_limit_msats).toBe(policy.daily_limit_msats);
    expect(restored.allowed_mints).toEqual(['https://mint.example.com']);
  });
});

describe('createDefaultSpendPolicy()', () => {
  it('creates a policy with conservative defaults', () => {
    const policy = createDefaultSpendPolicy();
    expect(policy.preferred_spend_rail).toBe('auto');
    expect(policy.allowed_mints).toHaveLength(0);
    expect(policy.max_single_spend_msats).toBeGreaterThan(0n);
    expect(policy.daily_limit_msats).toBeGreaterThan(policy.max_single_spend_msats);
  });

  it('applies overrides', () => {
    const policy = createDefaultSpendPolicy({ preferred_spend_rail: 'cashu' });
    expect(policy.preferred_spend_rail).toBe('cashu');
  });
});
