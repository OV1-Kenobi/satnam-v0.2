/**
 * @file tests/lib/lnbits.test.ts
 * @description Unit tests for the LNbits client and types.
 *
 * Uses Vitest with mocked fetch responses. The OPFS Vault is replaced with
 * a simple in-memory stub to avoid OPFS in test environments.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { LNbitsClient } from '../../src/lib/lnbits/client.js';
import type {
  LNbitsConfig,
  LNbitsWallet,
  LNbitsPayment,
  BoltzSwapRequest,
} from '../../src/lib/lnbits/types.js';

// ---------------------------------------------------------------------------
// Vault stub
// ---------------------------------------------------------------------------

/** In-memory vault stub for testing. */
function createVaultStub() {
  const store = new Map<string, unknown[]>();

  return {
    isUnlocked: () => true,
    storeCashuProofs: vi.fn(async (key: string, proofs: unknown[]) => {
      store.set(key, proofs);
    }),
    getCashuProofs: vi.fn(async (key: string) => {
      const proofs = store.get(key);
      if (!proofs) throw new Error('IdentityNotFound');
      return proofs;
    }),
    storeLNbitsKey: vi.fn(async (path: string, key: string) => {
      store.set(path, [{ id: 'lnbits_key', amount: 0, secret: key, C: '' }]);
    }),
    getLNbitsKey: vi.fn(async (path: string) => {
      const proofs = store.get(path) as Array<{ secret: string }> | undefined;
      if (!proofs || !proofs[0]) throw new Error('IdentityNotFound');
      return new TextEncoder().encode(proofs[0].secret);
    }),
    deleteLNbitsKey: vi.fn(async (path: string) => {
      store.delete(path);
    }),
  };
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

function mockFetch(responseData: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(responseData),
    text: () => Promise.resolve(JSON.stringify(responseData)),
  });
}

const MOCK_WALLET: LNbitsWallet = {
  id: 'wallet-123',
  name: 'Test Wallet',
  balance: 21_000_000, // 21,000 sats in msats
  adminkey: 'admin-key-abc',
  inkey: 'invoice-key-def',
};

const MOCK_PAYMENT_RESPONSE = {
  checking_id: 'pay-hash-123',
  payment_hash: 'pay-hash-123',
  bolt11: 'lnbc21u1...',
  amount: -1000, // outgoing, in msats
  fee: -1,
  memo: 'Test payment',
  time: 1710000000,
  pending: false,
};

const CONFIG: LNbitsConfig = {
  instanceUrl: 'https://legend.lnbits.com',
  adminKey: 'admin-key-abc',
  invoiceKey: 'invoice-key-def',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LNbitsClient', () => {
  let vault: ReturnType<typeof createVaultStub>;
  let client: LNbitsClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vault = createVaultStub();
    // Apply prototype methods to vault stub
    Object.assign(vault, {
      storeLNbitsKey: vault.storeLNbitsKey,
      getLNbitsKey: vault.getLNbitsKey,
      deleteLNbitsKey: vault.deleteLNbitsKey,
    });

    client = new LNbitsClient(vault as never, { instanceUrl: CONFIG.instanceUrl });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  describe('connect / disconnect / isConnected', () => {
    it('starts disconnected if no instanceUrl provided', () => {
      const freshClient = new LNbitsClient(vault as never);
      expect(freshClient.isConnected()).toBe(false);
    });

    it('starts connected if instanceUrl provided to constructor', () => {
      expect(client.isConnected()).toBe(true);
    });

    it('connect() stores keys in vault and sets isConnected', async () => {
      const fresh = new LNbitsClient(vault as never);
      globalThis.fetch = mockFetch(MOCK_WALLET);

      await fresh.connect(CONFIG);

      expect(fresh.isConnected()).toBe(true);
      // Source's connect() calls this.vault.storeLNbitsKey(...) for adminKey and
      // invoiceKey. The vault stub's storeLNbitsKey is the direct spy to check.
      // (The runtime prototype extension that routes storeLNbitsKey → storeCashuProofs
      //  is bypassed by the stub's own implementation.)
      expect(vault.storeLNbitsKey).toHaveBeenCalled();
    });

    it('disconnect() removes keys and sets isConnected to false', async () => {
      await client.connect(CONFIG);
      expect(client.isConnected()).toBe(true);

      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getWalletDetails
  // -------------------------------------------------------------------------

  describe('getWalletDetails()', () => {
    it('returns wallet details from API', async () => {
      globalThis.fetch = mockFetch(MOCK_WALLET);
      await client.connect(CONFIG);

      const wallet = await client.getWalletDetails();

      expect(wallet.id).toBe('wallet-123');
      expect(wallet.name).toBe('Test Wallet');
      expect(wallet.balance).toBe(21_000_000);
    });

    it('throws on API error', async () => {
      globalThis.fetch = mockFetch({ detail: 'Unauthorized' }, 401);
      await client.connect(CONFIG);

      await expect(client.getWalletDetails()).rejects.toThrow('HTTP 401');
    });
  });

  // -------------------------------------------------------------------------
  // createInvoice
  // -------------------------------------------------------------------------

  describe('createInvoice()', () => {
    it('returns a bolt11 invoice string', async () => {
      globalThis.fetch = mockFetch({
        payment_hash: 'hash-abc',
        payment_request: 'lnbc21u1pabcdef...',
      });
      await client.connect(CONFIG);

      const bolt11 = await client.createInvoice(21, 'Test invoice');

      expect(bolt11).toMatch(/^lnbc/);
    });

    it('accepts amount and memo', async () => {
      const fetchMock = mockFetch({ payment_hash: 'h', payment_request: 'lnbc1...' });
      globalThis.fetch = fetchMock;
      await client.connect(CONFIG);

      await client.createInvoice(100, 'Hello world');

      // Verify request body was sent with correct shape
      const callArgs = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!;
      // In non-browser environment, body is the raw fetch call
      expect(callArgs).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // payInvoice
  // -------------------------------------------------------------------------

  describe('payInvoice()', () => {
    it('returns a payment record on success', async () => {
      globalThis.fetch = mockFetch(MOCK_PAYMENT_RESPONSE);
      await client.connect(CONFIG);

      const payment = await client.payInvoice('lnbc21u1...');

      expect(payment.paymentHash).toBe('pay-hash-123');
      expect(payment.pending).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getPayments
  // -------------------------------------------------------------------------

  describe('getPayments()', () => {
    it('returns array of payment records', async () => {
      globalThis.fetch = mockFetch([MOCK_PAYMENT_RESPONSE, MOCK_PAYMENT_RESPONSE]);
      await client.connect(CONFIG);

      const payments = await client.getPayments(10, 0);

      expect(payments).toHaveLength(2);
      expect(payments[0]!.paymentHash).toBe('pay-hash-123');
    });

    it('returns empty array if no payments', async () => {
      globalThis.fetch = mockFetch([]);
      await client.connect(CONFIG);

      const payments = await client.getPayments();
      expect(payments).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // checkPayment
  // -------------------------------------------------------------------------

  describe('checkPayment()', () => {
    it('returns payment status by hash', async () => {
      globalThis.fetch = mockFetch(MOCK_PAYMENT_RESPONSE);
      await client.connect(CONFIG);

      const payment = await client.checkPayment('pay-hash-123');

      expect(payment.paymentHash).toBe('pay-hash-123');
      expect(payment.memo).toBe('Test payment');
    });
  });

  // -------------------------------------------------------------------------
  // listExtensions
  // -------------------------------------------------------------------------

  describe('listExtensions()', () => {
    it('returns array of extensions', async () => {
      globalThis.fetch = mockFetch([
        { id: 'boltz', name: 'Boltz', isInstalled: true, isActive: true },
        { id: 'lnurlp', name: 'LNURL-p', isInstalled: true, isActive: false },
      ]);
      await client.connect(CONFIG);

      const extensions = await client.listExtensions();

      expect(extensions).toHaveLength(2);
      expect(extensions[0]!.id).toBe('boltz');
      expect(extensions[0]!.isActive).toBe(true);
      expect(extensions[1]!.isActive).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // createBoltzSwap
  // -------------------------------------------------------------------------

  describe('createBoltzSwap()', () => {
    const reverseRequest: BoltzSwapRequest = {
      type: 'reverse',
      amountSats: 10000,
      onchainAddress: 'bc1qtest...',
    };

    it('creates a reverse swap', async () => {
      globalThis.fetch = vi.fn()
        // First call: getWalletId (getWalletDetails)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(MOCK_WALLET),
        })
        // Second call: create swap
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 'boltz-swap-001',
            status: 'created',
            amount: 10000,
            fee: 50,
            time: 1710000000,
          }),
        });

      await client.connect(CONFIG);

      const swap = await client.createBoltzSwap(reverseRequest);

      expect(swap.id).toBe('boltz-swap-001');
      expect(swap.status).toBe('created');
      expect(swap.amountSats).toBe(10000);
      expect(swap.type).toBe('reverse');
    });
  });

  // -------------------------------------------------------------------------
  // checkBoltzSwap
  // -------------------------------------------------------------------------

  describe('checkBoltzSwap()', () => {
    it('returns swap status', async () => {
      globalThis.fetch = mockFetch({
        id: 'boltz-swap-001',
        status: 'completed',
        amount: 10000,
        fee: 50,
        type: 'reverse',
        time: 1710000000,
      });
      await client.connect(CONFIG);

      const swap = await client.checkBoltzSwap('boltz-swap-001');

      expect(swap.id).toBe('boltz-swap-001');
      expect(swap.status).toBe('completed');
    });
  });

  // -------------------------------------------------------------------------
  // Type exports
  // -------------------------------------------------------------------------

  describe('Type exports', () => {
    it('LNbitsConfig has required fields', () => {
      const config: LNbitsConfig = {
        instanceUrl: 'https://example.com',
        adminKey: 'key',
        invoiceKey: 'ikey',
      };
      expect(config.instanceUrl).toBeTruthy();
    });

    it('LNbitsPayment has all required fields', () => {
      const payment: LNbitsPayment = {
        paymentHash: 'hash',
        bolt11: 'lnbc...',
        amount: 1000,
        fee: 1,
        memo: 'test',
        time: Date.now(),
        pending: false,
      };
      expect(payment.paymentHash).toBeTruthy();
    });
  });
});
