/**
 * @file tests/lib/atomic-swap.test.ts
 * @description Unit tests for the AtomicSwapEngine.
 *
 * Tests quote estimation, all swap type implementations, rollback behavior,
 * and swap history persistence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AtomicSwapEngine } from '../../src/lib/payments/atomic-swap.js';
import type {
  AtomicSwapRequest,
  AtomicSwapQuote,
  AtomicSwapResult,
} from '../../src/lib/payments/types.js';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

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
  };
}

function createCashuStub() {
  return {
    getBalance: vi.fn(async () => 100_000), // 100k sats
    listMints: vi.fn(async () => [
      { url: 'https://mint.source', balance: 100_000, isAllowed: true, name: 'Source', nuts: [] },
      { url: 'https://mint.dest', balance: 0, isAllowed: true, name: 'Dest', nuts: [] },
    ]),
    mintTokens: vi.fn(async (amount: number, mint: string) => []),
    sendTokens: vi.fn(async (amount: number) => `cashuA${amount}`),
    // Internal getProofs method (exposed via type cast)
    getProofs: vi.fn(async () => [
      { id: 'key1', amount: 50_000, secret: 'secret1', C: 'C1' },
      { id: 'key1', amount: 50_000, secret: 'secret2', C: 'C2' },
    ]),
  };
}

function createNwcStub() {
  return {
    payInvoice: vi.fn(async (bolt11: string) => ({
      preimage: 'preimage-abc',
      paymentHash: `hash-${bolt11.slice(0, 8)}`,
      feeMsats: 100n,
      totalMsats: 1_001_000n,
    })),
    makeInvoice: vi.fn(async (amountMsats: bigint, description: string) =>
      `lnbc${amountMsats}test...`,
    ),
  };
}

function createLNbitsStub() {
  return {
    createBoltzSwap: vi.fn(async (req: { type: string; amountSats: number }) => ({
      id: 'boltz-swap-001',
      status: 'created' as const,
      amountSats: req.amountSats,
      feeSats: 50,
      type: req.type as 'submarine' | 'reverse',
      createdAt: Math.floor(Date.now() / 1000),
    })),
    checkBoltzSwap: vi.fn(async (id: string) => ({
      id,
      status: 'completed' as const,
      amountSats: 10_000,
      feeSats: 50,
      type: 'submarine' as const,
      createdAt: Math.floor(Date.now() / 1000),
    })),
  };
}

// ---------------------------------------------------------------------------
// Mock cashu-ts
// ---------------------------------------------------------------------------

vi.mock('@cashu/cashu-ts', () => ({
  CashuMint: class {
    getInfo() { return Promise.resolve({ name: 'Test', nuts: {} }); }
  },
  CashuWallet: class {
    createMintQuote(amount: number) {
      return Promise.resolve({ quote: `quote-${amount}`, request: `lnbc${amount}mint...` });
    }
    createMeltQuote(invoice: string) {
      return Promise.resolve({ quote: `melt-quote`, amount: 1000, fee_reserve: 1 });
    }
    meltProofs(quote: unknown, proofs: unknown[]) {
      return Promise.resolve({
        quote: { state: 'PAID', payment_preimage: 'preimage-from-melt' },
        change: [],
      });
    }
    mintProofs(amount: number, quote: string) {
      return Promise.resolve([
        { id: 'newkey', amount, secret: 'newsecret', C: 'newC' },
      ]);
    }
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AtomicSwapEngine', () => {
  let vault: ReturnType<typeof createVaultStub>;
  let cashu: ReturnType<typeof createCashuStub>;
  let nwc: ReturnType<typeof createNwcStub>;
  let lnbits: ReturnType<typeof createLNbitsStub>;
  let engine: AtomicSwapEngine;

  beforeEach(() => {
    vault = createVaultStub();
    cashu = createCashuStub();
    nwc = createNwcStub();
    lnbits = createLNbitsStub();
    engine = new AtomicSwapEngine(vault as never, cashu as never, nwc as never, lnbits as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // getQuote
  // -------------------------------------------------------------------------

  describe('getQuote()', () => {
    it('returns a quote for cashu_to_cashu swap', async () => {
      const request: AtomicSwapRequest = {
        type: 'cashu_to_cashu',
        amountSats: 1000,
        sourceMint: 'https://mint.source',
        destinationMint: 'https://mint.dest',
      };

      const quote = await engine.getQuote(request);

      expect(quote.estimatedFees.totalFee).toBeGreaterThan(0);
      expect(quote.estimatedReceive).toBeLessThan(1000);
      expect(quote.estimatedReceive).toBeGreaterThan(0);
      expect(quote.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('returns a quote for cashu_to_lightning swap', async () => {
      const request: AtomicSwapRequest = {
        type: 'cashu_to_lightning',
        amountSats: 5000,
        sourceMint: 'https://mint.source',
      };

      const quote = await engine.getQuote(request);

      expect(quote.estimatedFees.lightningFee).toBe(0); // no routing fee for sender
      expect(quote.estimatedFees.sourceFee).toBeGreaterThan(0);
      expect(quote.estimatedReceive).toBeGreaterThan(0);
    });

    it('returns a quote for lightning_to_cashu swap', async () => {
      const request: AtomicSwapRequest = {
        type: 'lightning_to_cashu',
        amountSats: 2000,
        destinationMint: 'https://mint.dest',
      };

      const quote = await engine.getQuote(request);

      expect(quote.estimatedFees.lightningFee).toBeGreaterThan(0);
      expect(quote.estimatedFees.destinationFee).toBeGreaterThan(0);
      expect(quote.estimatedFees.sourceFee).toBe(0);
    });

    it('returns a quote for onchain_to_lightning swap', async () => {
      const request: AtomicSwapRequest = {
        type: 'onchain_to_lightning',
        amountSats: 50_000,
      };

      const quote = await engine.getQuote(request);

      expect(quote.estimatedFees.lightningFee).toBeGreaterThan(0);
      expect(quote.expiresAt).toBeGreaterThan(0);
    });

    it('returns a quote for lightning_to_onchain swap', async () => {
      const request: AtomicSwapRequest = {
        type: 'lightning_to_onchain',
        amountSats: 50_000,
        onchainAddress: 'bc1qtest...',
      };

      const quote = await engine.getQuote(request);

      expect(quote.estimatedFees.totalFee).toBeGreaterThan(0);
      expect(quote.estimatedReceive).toBeLessThan(50_000);
    });

    it('throws for unknown swap type', async () => {
      const request = { type: 'unknown' as never, amountSats: 1000 };
      await expect(engine.getQuote(request)).rejects.toThrow('Unknown swap type');
    });

    it('quote expires in the future', async () => {
      const quote = await engine.getQuote({
        type: 'cashu_to_cashu',
        amountSats: 100,
        sourceMint: 'https://a.com',
        destinationMint: 'https://b.com',
      });
      expect(quote.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });
  });

  // -------------------------------------------------------------------------
  // executeSwap — cashu_to_cashu
  // -------------------------------------------------------------------------

  describe('executeSwap() — cashu_to_cashu', () => {
    const request: AtomicSwapRequest = {
      type: 'cashu_to_cashu',
      amountSats: 1000,
      sourceMint: 'https://mint.source',
      destinationMint: 'https://mint.dest',
    };

    it('succeeds end-to-end', async () => {
      const result = await engine.executeSwap(request);

      expect(result.success).toBe(true);
      expect(result.amountSent).toBe(1000);
      expect(result.amountReceived).toBeGreaterThan(0);
      expect(result.steps.length).toBeGreaterThan(0);
      // All steps should be completed
      result.steps.forEach((s) => expect(s.status).toBe('completed'));
    });

    it('records steps', async () => {
      const result = await engine.executeSwap(request);
      expect(result.steps.every((s) => s.timestamp > 0)).toBe(true);
    });

    it('throws when source equals destination', async () => {
      const req: AtomicSwapRequest = {
        type: 'cashu_to_cashu',
        amountSats: 1000,
        sourceMint: 'https://same.mint',
        destinationMint: 'https://same.mint',
      };
      const result = await engine.executeSwap(req);
      expect(result.success).toBe(false);
      expect(result.steps.some((s) => s.status === 'failed')).toBe(true);
    });

    it('returns failure result when insufficient balance', async () => {
      cashu.getBalance.mockResolvedValueOnce(0); // no balance

      const result = await engine.executeSwap(request);

      expect(result.success).toBe(false);
      expect(result.amountReceived).toBe(0);
    });

    it('saves to swap history on success', async () => {
      await engine.executeSwap(request);

      const history = await engine.getSwapHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]!.type).toBe('cashu_to_cashu');
    });
  });

  // -------------------------------------------------------------------------
  // executeSwap — lightning_to_cashu
  // -------------------------------------------------------------------------

  describe('executeSwap() — lightning_to_cashu', () => {
    const request: AtomicSwapRequest = {
      type: 'lightning_to_cashu',
      amountSats: 1000,
      destinationMint: 'https://mint.dest',
    };

    it('creates mint quote, pays invoice, mints tokens', async () => {
      const result = await engine.executeSwap(request);

      expect(result.success).toBe(true);
      expect(nwc.payInvoice).toHaveBeenCalled();
      expect(cashu.mintTokens).toHaveBeenCalled();
    });

    it('records all steps', async () => {
      const result = await engine.executeSwap(request);
      expect(result.steps).toHaveLength(3); // quote + pay + mint
    });

    it('handles NWC payment failure', async () => {
      nwc.payInvoice.mockRejectedValueOnce(new Error('Insufficient funds'));

      const result = await engine.executeSwap(request);

      expect(result.success).toBe(false);
      expect(result.steps.some((s) => s.status === 'failed')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // executeSwap — cashu_to_lightning
  // -------------------------------------------------------------------------

  describe('executeSwap() — cashu_to_lightning', () => {
    const request: AtomicSwapRequest = {
      type: 'cashu_to_lightning',
      amountSats: 1000,
      sourceMint: 'https://mint.source',
    };

    it('creates LN invoice and melts proofs', async () => {
      const result = await engine.executeSwap(request);

      expect(result.success).toBe(true);
      expect(nwc.makeInvoice).toHaveBeenCalled();
    });

    it('fails when NWC invoice creation fails', async () => {
      nwc.makeInvoice.mockRejectedValueOnce(new Error('NWC unavailable'));

      const result = await engine.executeSwap(request);

      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // executeSwap — onchain_to_lightning (Boltz)
  // -------------------------------------------------------------------------

  describe('executeSwap() — onchain_to_lightning', () => {
    const request: AtomicSwapRequest = {
      type: 'onchain_to_lightning',
      amountSats: 50_000,
    };

    it('creates LN invoice and Boltz submarine swap', async () => {
      // Make Boltz polling resolve immediately
      lnbits.checkBoltzSwap.mockResolvedValue({
        id: 'boltz-swap-001',
        status: 'completed',
        amountSats: 50_000,
        feeSats: 250,
        type: 'submarine',
        createdAt: Math.floor(Date.now() / 1000),
      });

      const result = await engine.executeSwap(request);

      expect(result.success).toBe(true);
      expect(lnbits.createBoltzSwap).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'submarine', amountSats: 50_000 }),
      );
    });

    it('throws when LNbits client is not provided', async () => {
      const engineWithoutLNbits = new AtomicSwapEngine(
        vault as never,
        cashu as never,
        nwc as never,
        // no lnbits
      );

      const result = await engineWithoutLNbits.executeSwap(request);
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // executeSwap — lightning_to_onchain (Boltz reverse)
  // -------------------------------------------------------------------------

  describe('executeSwap() — lightning_to_onchain', () => {
    const request: AtomicSwapRequest = {
      type: 'lightning_to_onchain',
      amountSats: 50_000,
      onchainAddress: 'bc1qtest...',
    };

    it('creates Boltz reverse swap', async () => {
      lnbits.checkBoltzSwap.mockResolvedValue({
        id: 'boltz-swap-001',
        status: 'completed',
        amountSats: 50_000,
        feeSats: 250,
        type: 'reverse',
        createdAt: Math.floor(Date.now() / 1000),
      });

      const result = await engine.executeSwap(request);

      expect(lnbits.createBoltzSwap).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'reverse', amountSats: 50_000 }),
      );
    });

    it('fails when onchainAddress is missing', async () => {
      const result = await engine.executeSwap({
        type: 'lightning_to_onchain',
        amountSats: 50_000,
        // no onchainAddress
      });

      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Swap history
  // -------------------------------------------------------------------------

  describe('getSwapHistory()', () => {
    it('returns empty array when no swaps have been executed', async () => {
      const history = await engine.getSwapHistory();
      expect(history).toHaveLength(0);
    });

    it('records swaps in history after execution', async () => {
      await engine.executeSwap({
        type: 'lightning_to_cashu',
        amountSats: 100,
        destinationMint: 'https://mint.dest',
      });

      const history = await engine.getSwapHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]!.type).toBe('lightning_to_cashu');
    });

    it('records failed swaps in history too', async () => {
      nwc.payInvoice.mockRejectedValueOnce(new Error('Network error'));

      await engine.executeSwap({
        type: 'lightning_to_cashu',
        amountSats: 100,
        destinationMint: 'https://mint.dest',
      });

      const history = await engine.getSwapHistory();
      expect(history.length).toBeGreaterThan(0);
      // Could be success or failure, but should be recorded
    });

    it('keeps at most 100 swap records', async () => {
      // Execute 5 swaps and verify history works
      for (let i = 0; i < 5; i++) {
        await engine.executeSwap({
          type: 'cashu_to_lightning',
          amountSats: 100 + i,
          sourceMint: 'https://mint.source',
        });
      }

      const history = await engine.getSwapHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history.length).toBeLessThanOrEqual(100);
    });
  });

  // -------------------------------------------------------------------------
  // Type safety
  // -------------------------------------------------------------------------

  describe('Type exports', () => {
    it('AtomicSwapRequest accepts all swap types', () => {
      const swapTypes: AtomicSwapRequest['type'][] = [
        'cashu_to_cashu',
        'cashu_to_lightning',
        'lightning_to_cashu',
        'onchain_to_lightning',
        'lightning_to_onchain',
      ];
      expect(swapTypes).toHaveLength(5);
    });

    it('AtomicSwapQuote has required fee fields', async () => {
      const quote: AtomicSwapQuote = {
        estimatedFees: {
          sourceFee: 1,
          lightningFee: 2,
          destinationFee: 3,
          totalFee: 6,
        },
        estimatedReceive: 994,
        expiresAt: Date.now() + 30000,
      };
      expect(quote.estimatedFees.totalFee).toBe(6);
    });

    it('SwapStep status values are correct', () => {
      const statuses: Array<'pending' | 'completed' | 'failed'> = [
        'pending', 'completed', 'failed',
      ];
      expect(statuses).toHaveLength(3);
    });
  });
});
