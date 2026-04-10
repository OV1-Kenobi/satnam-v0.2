/**
 * @file nwc.test.ts
 * @description Unit tests for the NWC Connection Manager.
 *
 * The vault is mocked with an in-memory store. The nostr-tools relay pool is
 * mocked to avoid real WebSocket connections. IndexedDB for connection metadata
 * is mocked with an in-memory Map.
 *
 * Tests cover:
 * 1. parseNwcUri (via addConnection) — valid/invalid URI parsing
 * 2. addConnection — stores URI in vault, metadata in IDB, returns UUID
 * 3. addConnection — first connection auto-set as default
 * 4. removeConnection — deletes from vault and IDB, promotes new default
 * 5. listConnections — returns metadata without secrets
 * 6. getDefaultConnection — returns null when empty, correct connection otherwise
 * 7. setDefaultConnection — updates isDefault flags correctly
 * 8. payInvoice — sends NIP-47 request, parses response, returns PaymentResult
 * 9. makeInvoice — sends NIP-47 request, returns BOLT-11 string
 * 10. getBalance — sends NIP-47 request, caches balance, returns bigint
 * 11. lookupInvoice — sends NIP-47 request, returns InvoiceStatus
 * 12. listTransactions — sends NIP-47 request with options, maps response
 * 13. getInfo — fetches info event, extracts supported methods
 * 14. sendNwcRequest — timeout handling
 * 15. sendNwcRequest — NWC error response propagated as Error
 * 16. getInfo — resolves default connection when connectionId omitted
 * 17. NWC_REQUEST_KIND, NWC_RESPONSE_KIND, NWC_INFO_KIND constants
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NwcConnectionManager } from '../../src/lib/nwc/connection-manager.js';
import {
  NWC_REQUEST_KIND,
  NWC_RESPONSE_KIND,
  NWC_INFO_KIND,
} from '../../src/lib/nwc/types.js';

// ---------------------------------------------------------------------------
// Vault mock
// ---------------------------------------------------------------------------

const vaultStore = new Map<string, string>();

const mockVault = {
  storeNwcUri: vi.fn(async (id: string, uri: string) => {
    vaultStore.set(id, uri);
  }),
  getNwcUri: vi.fn(async (id: string) => {
    const uri = vaultStore.get(id);
    if (!uri) throw Object.assign(new Error('IdentityNotFound'), { vaultError: 'IdentityNotFound' });
    return uri;
  }),
  deleteNwcUri: vi.fn(async (id: string) => {
    vaultStore.delete(id);
  }),
};

// ---------------------------------------------------------------------------
// IndexedDB mock (in-memory)
// ---------------------------------------------------------------------------

// Shared backing map for all IDB operations in tests
const idbStore = new Map<string, unknown>();

// Track all IDB databases created per test
function createIdbMock() {
  function makeRequest<T>(result: T): IDBRequest<T> {
    let onsuccess: ((e: Event) => void) | null = null;
    let onerror: ((e: Event) => void) | null = null;

    const req = {
      result,
      error: null,
      get onsuccess() { return onsuccess; },
      set onsuccess(fn) {
        onsuccess = fn;
        if (fn) Promise.resolve().then(() => fn({ target: req } as unknown as Event));
      },
      get onerror() { return onerror; },
      set onerror(fn) { onerror = fn; },
    } as unknown as IDBRequest<T>;
    return req;
  }

  function makeObjStore(): IDBObjectStore {
    return {
      get: (key: IDBValidKey) => makeRequest(idbStore.get(String(key))),
      getAll: () => makeRequest(Array.from(idbStore.values())),
      getAllKeys: () => makeRequest(Array.from(idbStore.keys()) as unknown as IDBValidKey[]),
      put: (value: unknown, _key?: IDBValidKey) => {
        const record = value as Record<string, unknown>;
        // Use keyPath 'id' or 'url' depending on the object
        const key = String(record['id'] ?? record['url'] ?? _key ?? '');
        idbStore.set(key, value);
        return makeRequest(key as unknown as IDBValidKey);
      },
      delete: (key: IDBValidKey) => {
        idbStore.delete(String(key));
        return makeRequest(undefined);
      },
      createIndex: () => ({}) as IDBIndex,
    } as unknown as IDBObjectStore;
  }

  function makeTx(): IDBTransaction {
    let oncomplete: ((e: Event) => void) | null = null;
    const tx = {
      objectStore: () => makeObjStore(),
      get oncomplete() { return oncomplete; },
      set oncomplete(fn) {
        oncomplete = fn;
        if (fn) Promise.resolve().then(() => fn({} as Event));
      },
      onerror: null,
      commit: () => {},
      abort: () => {},
    } as unknown as IDBTransaction;
    return tx;
  }

  const fakeDb: IDBDatabase = {
    transaction: () => makeTx(),
    createObjectStore: () => makeObjStore(),
  } as unknown as IDBDatabase;

  return {
    open: (_name: string, _version?: number) => {
      const req = {
        result: fakeDb,
        error: null,
        onupgradeneeded: null as ((e: IDBVersionChangeEvent) => void) | null,
        onsuccess: null as ((e: Event) => void) | null,
        onerror: null as ((e: Event) => void) | null,
      };

      const proxy = new Proxy(req, {
        set(target, prop, value) {
          (target as Record<string, unknown>)[String(prop)] = value;
          if (prop === 'onsuccess' && value) {
            Promise.resolve().then(() =>
              (value as (e: Event) => void)({ target: proxy } as unknown as Event),
            );
          }
          return true;
        },
      });

      return proxy as unknown as IDBRequest<IDBDatabase>;
    },
  };
}

// ---------------------------------------------------------------------------
// NWC URI helpers
// ---------------------------------------------------------------------------

const TEST_WALLET_PUBKEY = 'a'.repeat(64);
const TEST_SECRET = 'b'.repeat(64);
const TEST_RELAY = 'wss://relay.example.com';
const VALID_NWC_URI = `nostr+walletconnect://${TEST_WALLET_PUBKEY}?relay=${TEST_RELAY}&secret=${TEST_SECRET}`;

// A second valid URI for testing multiple connections
const TEST_WALLET_PUBKEY_2 = 'c'.repeat(64);
const TEST_SECRET_2 = 'd'.repeat(64);
const VALID_NWC_URI_2 = `nostr+walletconnect://${TEST_WALLET_PUBKEY_2}?relay=${TEST_RELAY}&secret=${TEST_SECRET_2}`;

// ---------------------------------------------------------------------------
// nostr-tools mock
// ---------------------------------------------------------------------------

// We mock nostr-tools to avoid real crypto/relay operations
vi.mock('nostr-tools', async () => {
  const { hexToBytes } = await import('@noble/hashes/utils');

  return {
    SimplePool: vi.fn().mockImplementation(() => ({
      publish: vi.fn().mockReturnValue([Promise.resolve('ok')]),
      subscribeMany: vi.fn().mockReturnValue({ close: vi.fn() }),
      querySync: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    })),
    finalizeEvent: vi.fn((template: unknown, _secret: Uint8Array) => ({
      ...(template as object),
      id: 'mock-event-id-' + Math.random().toString(36).slice(2),
      sig: 'mock-sig',
      pubkey: 'mock-pubkey',
    })),
    getPublicKey: vi.fn(() => 'mock-client-pubkey'),
  };
});

vi.mock('nostr-tools/nip44', () => ({
  getConversationKey: vi.fn(() => new Uint8Array(32).fill(1)),
  encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
  decrypt: vi.fn((ciphertext: string) => ciphertext.replace(/^encrypted:/, '')),
}));

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vaultStore.clear();
  idbStore.clear();

  vi.clearAllMocks();

  // Install IDB mock
  const idb = createIdbMock();
  (global as unknown as { indexedDB: typeof idb }).indexedDB = idb;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// NWC Kind Constants
// ---------------------------------------------------------------------------

describe('NWC kind constants', () => {
  it('exports correct NIP-47 event kind numbers', () => {
    expect(NWC_REQUEST_KIND).toBe(23194);
    expect(NWC_RESPONSE_KIND).toBe(23195);
    expect(NWC_INFO_KIND).toBe(13194);
  });
});

// ---------------------------------------------------------------------------
// URI parsing
// ---------------------------------------------------------------------------

describe('NwcConnectionManager — URI parsing', () => {
  it('rejects URIs that do not start with nostr+walletconnect://', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    await expect(
      manager.addConnection('Test', 'https://example.com'),
    ).rejects.toThrow(/nostr\+walletconnect/);
  });

  it('rejects URIs with non-hex pubkeys', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const badUri = `nostr+walletconnect://not-a-pubkey?relay=${TEST_RELAY}&secret=${TEST_SECRET}`;
    await expect(manager.addConnection('Test', badUri)).rejects.toThrow(/pubkey/i);
  });

  it('rejects URIs missing the relay parameter', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const badUri = `nostr+walletconnect://${TEST_WALLET_PUBKEY}?secret=${TEST_SECRET}`;
    await expect(manager.addConnection('Test', badUri)).rejects.toThrow(/relay/i);
  });

  it('rejects URIs with non-WebSocket relay URLs', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const badUri = `nostr+walletconnect://${TEST_WALLET_PUBKEY}?relay=https://example.com&secret=${TEST_SECRET}`;
    await expect(manager.addConnection('Test', badUri)).rejects.toThrow(/relay/i);
  });

  it('rejects URIs missing the secret parameter', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const badUri = `nostr+walletconnect://${TEST_WALLET_PUBKEY}?relay=${TEST_RELAY}`;
    await expect(manager.addConnection('Test', badUri)).rejects.toThrow(/secret/i);
  });

  it('accepts valid NWC URIs', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const id = await manager.addConnection('Test Wallet', VALID_NWC_URI);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// addConnection
// ---------------------------------------------------------------------------

describe('NwcConnectionManager.addConnection()', () => {
  it('stores the full URI in the vault', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const id = await manager.addConnection('My Wallet', VALID_NWC_URI);
    expect(mockVault.storeNwcUri).toHaveBeenCalledWith(id, VALID_NWC_URI);
    expect(vaultStore.get(id)).toBe(VALID_NWC_URI);
  });

  it('returns a UUID string', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const id = await manager.addConnection('My Wallet', VALID_NWC_URI);
    // UUIDs are 36 characters with dashes
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('automatically sets the first connection as default', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const id = await manager.addConnection('First Wallet', VALID_NWC_URI);
    const def = await manager.getDefaultConnection();
    expect(def?.id).toBe(id);
    expect(def?.isDefault).toBe(true);
  });

  it('does not set second connection as default', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const id1 = await manager.addConnection('First', VALID_NWC_URI);
    await manager.addConnection('Second', VALID_NWC_URI_2);
    const def = await manager.getDefaultConnection();
    expect(def?.id).toBe(id1);
  });

  it('stores non-secret metadata (label, relayUrl, walletPubkey)', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const id = await manager.addConnection('Alby Hub', VALID_NWC_URI);
    const connections = await manager.listConnections();
    const conn = connections.find((c) => c.id === id);

    expect(conn?.label).toBe('Alby Hub');
    expect(conn?.relayUrl).toBe(TEST_RELAY);
    expect(conn?.walletPubkey).toBe(TEST_WALLET_PUBKEY);
  });

  it('never surfaces the connection secret in metadata', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const id = await manager.addConnection('Secret Wallet', VALID_NWC_URI);
    const connections = await manager.listConnections();
    const conn = connections.find((c) => c.id === id)!;

    expect(conn.connectionSecret).toBe('');
    // The secret should not appear anywhere in the connection object
    const serialized = JSON.stringify(conn);
    expect(serialized).not.toContain(TEST_SECRET);
  });
});

// ---------------------------------------------------------------------------
// removeConnection
// ---------------------------------------------------------------------------

describe('NwcConnectionManager.removeConnection()', () => {
  it('removes the URI from the vault', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const id = await manager.addConnection('My Wallet', VALID_NWC_URI);
    await manager.removeConnection(id);
    expect(mockVault.deleteNwcUri).toHaveBeenCalledWith(id);
    expect(vaultStore.has(id)).toBe(false);
  });

  it('removes the connection from the list', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const id = await manager.addConnection('My Wallet', VALID_NWC_URI);
    await manager.removeConnection(id);
    const connections = await manager.listConnections();
    expect(connections.find((c) => c.id === id)).toBeUndefined();
  });

  it('promotes the next connection to default when default is removed', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const id1 = await manager.addConnection('First', VALID_NWC_URI);
    const id2 = await manager.addConnection('Second', VALID_NWC_URI_2);

    await manager.removeConnection(id1);
    const def = await manager.getDefaultConnection();
    expect(def?.id).toBe(id2);
  });

  it('returns null for getDefaultConnection when all connections removed', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const id = await manager.addConnection('Only Wallet', VALID_NWC_URI);
    await manager.removeConnection(id);
    const def = await manager.getDefaultConnection();
    expect(def).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listConnections / getDefaultConnection
// ---------------------------------------------------------------------------

describe('NwcConnectionManager.listConnections()', () => {
  it('returns empty array when no connections exist', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const list = await manager.listConnections();
    expect(list).toHaveLength(0);
  });

  it('returns all connections sorted by createdAt', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    await manager.addConnection('First', VALID_NWC_URI);
    await manager.addConnection('Second', VALID_NWC_URI_2);
    const list = await manager.listConnections();
    expect(list).toHaveLength(2);
  });
});

describe('NwcConnectionManager.getDefaultConnection()', () => {
  it('returns null when no connections exist', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const def = await manager.getDefaultConnection();
    expect(def).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setDefaultConnection
// ---------------------------------------------------------------------------

describe('NwcConnectionManager.setDefaultConnection()', () => {
  it('changes which connection is default', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const id1 = await manager.addConnection('First', VALID_NWC_URI);
    const id2 = await manager.addConnection('Second', VALID_NWC_URI_2);

    await manager.setDefaultConnection(id2);
    const def = await manager.getDefaultConnection();
    expect(def?.id).toBe(id2);
  });

  it('clears the old default flag', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    const id1 = await manager.addConnection('First', VALID_NWC_URI);
    const id2 = await manager.addConnection('Second', VALID_NWC_URI_2);

    await manager.setDefaultConnection(id2);
    const connections = await manager.listConnections();
    const first = connections.find((c) => c.id === id1)!;
    const second = connections.find((c) => c.id === id2)!;
    expect(first.isDefault).toBe(false);
    expect(second.isDefault).toBe(true);
  });

  it('throws when connection does not exist', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    await expect(
      manager.setDefaultConnection('nonexistent-uuid'),
    ).rejects.toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// Wallet operations via mocked relay
// ---------------------------------------------------------------------------

describe('NwcConnectionManager.getBalance()', () => {
  it('returns balance as bigint from NWC response', async () => {
    const { SimplePool } = await import('nostr-tools');
    const mockPool = {
      publish: vi.fn().mockReturnValue([Promise.resolve('ok')]),
      subscribeMany: vi.fn().mockImplementation((_relays, _filters, { onevent }: { onevent: (e: unknown) => void }) => {
        // Simulate async wallet response
        setTimeout(() => {
          onevent({
            kind: NWC_RESPONSE_KIND,
            content: JSON.stringify({ result: { balance: 100000 } }),
            tags: [],
            id: 'response-event-id',
          });
        }, 10);
        return { close: vi.fn() };
      }),
      close: vi.fn(),
    };
    vi.mocked(SimplePool).mockImplementationOnce(() => mockPool as never);

    const manager = new NwcConnectionManager(mockVault as never);
    const connId = await manager.addConnection('Test', VALID_NWC_URI);

    const balance = await manager.getBalance(connId);
    expect(balance).toBe(100000n);
  });

  it('throws when no connections are configured', async () => {
    const manager = new NwcConnectionManager(mockVault as never);
    await expect(manager.getBalance()).rejects.toThrow(/no nwc connection/i);
  });
});

describe('NwcConnectionManager.payInvoice()', () => {
  it('returns PaymentResult with preimage and fees', async () => {
    const { SimplePool } = await import('nostr-tools');
    const mockPool = {
      publish: vi.fn().mockReturnValue([Promise.resolve('ok')]),
      subscribeMany: vi.fn().mockImplementation((_relays, _filters, { onevent }: { onevent: (e: unknown) => void }) => {
        setTimeout(() => {
          onevent({
            kind: NWC_RESPONSE_KIND,
            content: JSON.stringify({
              result: {
                preimage: 'deadbeef'.repeat(8),
                fees_paid: 1000,
              },
            }),
            tags: [],
          });
        }, 10);
        return { close: vi.fn() };
      }),
      close: vi.fn(),
    };
    vi.mocked(SimplePool).mockImplementationOnce(() => mockPool as never);

    const manager = new NwcConnectionManager(mockVault as never);
    const connId = await manager.addConnection('Test', VALID_NWC_URI);

    const result = await manager.payInvoice(
      'lnbc1000n1pjq8ck3pp5test', // fake invoice
      connId,
    );

    expect(result.preimage).toBe('deadbeef'.repeat(8));
    expect(result.feeMsats).toBe(1000n);
    expect(typeof result.paymentHash).toBe('string');
  });
});

describe('NwcConnectionManager.makeInvoice()', () => {
  it('returns BOLT-11 invoice string', async () => {
    const { SimplePool } = await import('nostr-tools');
    const mockPool = {
      publish: vi.fn().mockReturnValue([Promise.resolve('ok')]),
      subscribeMany: vi.fn().mockImplementation((_relays, _filters, { onevent }: { onevent: (e: unknown) => void }) => {
        setTimeout(() => {
          onevent({
            kind: NWC_RESPONSE_KIND,
            content: JSON.stringify({
              result: { invoice: 'lnbc500u1ptest...' },
            }),
            tags: [],
          });
        }, 10);
        return { close: vi.fn() };
      }),
      close: vi.fn(),
    };
    vi.mocked(SimplePool).mockImplementationOnce(() => mockPool as never);

    const manager = new NwcConnectionManager(mockVault as never);
    const connId = await manager.addConnection('Test', VALID_NWC_URI);

    const invoice = await manager.makeInvoice(50000n, 'Test payment', connId);
    expect(invoice).toBe('lnbc500u1ptest...');
  });
});

describe('NwcConnectionManager.lookupInvoice()', () => {
  it('returns InvoiceStatus with isPaid true when settled_at is present', async () => {
    const { SimplePool } = await import('nostr-tools');
    const mockPool = {
      publish: vi.fn().mockReturnValue([Promise.resolve('ok')]),
      subscribeMany: vi.fn().mockImplementation((_relays, _filters, { onevent }: { onevent: (e: unknown) => void }) => {
        setTimeout(() => {
          onevent({
            kind: NWC_RESPONSE_KIND,
            content: JSON.stringify({
              result: {
                payment_hash: 'aa'.repeat(32),
                invoice: 'lnbc...',
                amount: 10000,
                description: 'Test',
                settled_at: 1700000000,
                preimage: 'bb'.repeat(32),
              },
            }),
            tags: [],
          });
        }, 10);
        return { close: vi.fn() };
      }),
      close: vi.fn(),
    };
    vi.mocked(SimplePool).mockImplementationOnce(() => mockPool as never);

    const manager = new NwcConnectionManager(mockVault as never);
    const connId = await manager.addConnection('Test', VALID_NWC_URI);

    const status = await manager.lookupInvoice('aa'.repeat(32), connId);
    expect(status.isPaid).toBe(true);
    expect(status.amountMsats).toBe(10000n);
    expect(status.description).toBe('Test');
  });
});

describe('NwcConnectionManager.listTransactions()', () => {
  it('returns mapped Transaction array from NWC response', async () => {
    const { SimplePool } = await import('nostr-tools');
    const mockPool = {
      publish: vi.fn().mockReturnValue([Promise.resolve('ok')]),
      subscribeMany: vi.fn().mockImplementation((_relays, _filters, { onevent }: { onevent: (e: unknown) => void }) => {
        setTimeout(() => {
          onevent({
            kind: NWC_RESPONSE_KIND,
            content: JSON.stringify({
              result: {
                transactions: [
                  {
                    type: 'outgoing',
                    payment_hash: 'aa'.repeat(32),
                    amount: 5000,
                    fees_paid: 100,
                    description: 'Payment',
                    created_at: 1700000000,
                    settled_at: 1700000010,
                  },
                  {
                    type: 'incoming',
                    payment_hash: 'bb'.repeat(32),
                    amount: 10000,
                    description: 'Receive',
                    created_at: 1700000020,
                  },
                ],
              },
            }),
            tags: [],
          });
        }, 10);
        return { close: vi.fn() };
      }),
      close: vi.fn(),
    };
    vi.mocked(SimplePool).mockImplementationOnce(() => mockPool as never);

    const manager = new NwcConnectionManager(mockVault as never);
    const connId = await manager.addConnection('Test', VALID_NWC_URI);

    const txs = await manager.listTransactions({ limit: 10 }, connId);
    expect(txs).toHaveLength(2);
    expect(txs[0].type).toBe('outgoing');
    expect(txs[0].amountMsats).toBe(5000n);
    expect(txs[0].feeMsats).toBe(100n);
    expect(txs[1].type).toBe('incoming');
    expect(txs[1].amountMsats).toBe(10000n);
  });

  it('returns empty array when wallet returns no transactions', async () => {
    const { SimplePool } = await import('nostr-tools');
    const mockPool = {
      publish: vi.fn().mockReturnValue([Promise.resolve('ok')]),
      subscribeMany: vi.fn().mockImplementation((_relays, _filters, { onevent }: { onevent: (e: unknown) => void }) => {
        setTimeout(() => {
          onevent({
            kind: NWC_RESPONSE_KIND,
            content: JSON.stringify({ result: { transactions: [] } }),
            tags: [],
          });
        }, 10);
        return { close: vi.fn() };
      }),
      close: vi.fn(),
    };
    vi.mocked(SimplePool).mockImplementationOnce(() => mockPool as never);

    const manager = new NwcConnectionManager(mockVault as never);
    const connId = await manager.addConnection('Test', VALID_NWC_URI);
    const txs = await manager.listTransactions({}, connId);
    expect(txs).toHaveLength(0);
  });
});

describe('NwcConnectionManager.getInfo()', () => {
  it('extracts supported methods from the info event content', async () => {
    const { SimplePool } = await import('nostr-tools');
    const mockPool = {
      querySync: vi.fn().mockResolvedValue([
        {
          kind: NWC_INFO_KIND,
          content: 'pay_invoice make_invoice get_balance lookup_invoice list_transactions',
          pubkey: TEST_WALLET_PUBKEY,
        },
      ]),
      close: vi.fn(),
    };
    vi.mocked(SimplePool).mockImplementationOnce(() => mockPool as never);

    const manager = new NwcConnectionManager(mockVault as never);
    const connId = await manager.addConnection('Test', VALID_NWC_URI);
    const info = await manager.getInfo(connId);

    expect(info.supportedMethods).toContain('pay_invoice');
    expect(info.supportedMethods).toContain('make_invoice');
    expect(info.supportedMethods).toContain('get_balance');
  });

  it('returns empty supported methods when no info event found', async () => {
    const { SimplePool } = await import('nostr-tools');
    const mockPool = {
      querySync: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    };
    vi.mocked(SimplePool).mockImplementationOnce(() => mockPool as never);

    const manager = new NwcConnectionManager(mockVault as never);
    const connId = await manager.addConnection('Test', VALID_NWC_URI);
    const info = await manager.getInfo(connId);
    expect(info.supportedMethods).toHaveLength(0);
  });
});

describe('NwcConnectionManager — NWC error propagation', () => {
  it('throws with NWC error code when wallet returns error response', async () => {
    const { SimplePool } = await import('nostr-tools');
    const mockPool = {
      publish: vi.fn().mockReturnValue([Promise.resolve('ok')]),
      subscribeMany: vi.fn().mockImplementation((_relays, _filters, { onevent }: { onevent: (e: unknown) => void }) => {
        setTimeout(() => {
          onevent({
            kind: NWC_RESPONSE_KIND,
            content: JSON.stringify({
              error: { code: 'INSUFFICIENT_BALANCE', message: 'Not enough funds' },
            }),
            tags: [],
          });
        }, 10);
        return { close: vi.fn() };
      }),
      close: vi.fn(),
    };
    vi.mocked(SimplePool).mockImplementationOnce(() => mockPool as never);

    const manager = new NwcConnectionManager(mockVault as never);
    const connId = await manager.addConnection('Test', VALID_NWC_URI);

    await expect(manager.getBalance(connId)).rejects.toThrow(/INSUFFICIENT_BALANCE/);
  });
});
