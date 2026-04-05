/**
 * @file tests/lib/payments-scheduler.test.ts
 * @description Unit tests for the PaymentScheduler.
 *
 * Tests schedule management, condition evaluation, recurrence calculation,
 * and persistence via vault stub.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PaymentScheduler } from '../../src/lib/payments/scheduler.js';
import type {
  ScheduledPayment,
  PaymentSchedule,
  PaymentCondition,
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

function createNwcStub() {
  return {
    getBalance: vi.fn(async () => BigInt(1_000_000_000)), // 1M sats in msats
    payInvoice: vi.fn(async (bolt11: string) => ({
      preimage: 'abc123',
      paymentHash: 'hash-' + bolt11.slice(0, 8),
      feeMsats: 10n,
      totalMsats: 1000n,
    })),
    makeInvoice: vi.fn(async () => 'lnbc1000u1test...'),
  };
}

function createCashuStub() {
  return {
    listMints: vi.fn(async () => [
      { url: 'https://mint.test', balance: 10000, isAllowed: true, name: 'Test', nuts: [] },
    ]),
    sendTokens: vi.fn(async () => 'cashuAtoken...'),
    getBalance: vi.fn(async () => 10000),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayment(overrides: Partial<ScheduledPayment> = {}): ScheduledPayment {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: crypto.randomUUID(),
    label: 'Test Payment',
    recipientPubkey: 'abc123',
    recipientLud16: 'user@example.com',
    amountMsats: 1000n,
    rail: 'lightning',
    schedule: { type: 'one-time', executeAt: now - 1 }, // due immediately
    status: 'active',
    createdAt: now,
    executionHistory: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PaymentScheduler', () => {
  let vault: ReturnType<typeof createVaultStub>;
  let nwc: ReturnType<typeof createNwcStub>;
  let cashu: ReturnType<typeof createCashuStub>;
  let scheduler: PaymentScheduler;

  beforeEach(async () => {
    vault = createVaultStub();
    nwc = createNwcStub();
    cashu = createCashuStub();
    scheduler = new PaymentScheduler(vault as never, nwc as never, cashu as never);
    await scheduler.load();
  });

  // -------------------------------------------------------------------------
  // load / initialization
  // -------------------------------------------------------------------------

  describe('load()', () => {
    it('starts with empty schedules', () => {
      expect(scheduler.listPayments()).toHaveLength(0);
    });

    it('throws if used before load()', async () => {
      const fresh = new PaymentScheduler(vault as never, nwc as never, cashu as never);
      expect(() => fresh.listPayments()).toThrow('call load()');
    });
  });

  // -------------------------------------------------------------------------
  // schedulePayment
  // -------------------------------------------------------------------------

  describe('schedulePayment()', () => {
    it('adds a payment to the schedule', async () => {
      const payment = makePayment();
      await scheduler.schedulePayment(payment);
      expect(scheduler.listPayments()).toHaveLength(1);
    });

    it('persists to vault after adding', async () => {
      const payment = makePayment();
      await scheduler.schedulePayment(payment);
      expect(vault.storeCashuProofs).toHaveBeenCalledWith(
        'payments_schedules',
        expect.arrayContaining([expect.objectContaining({ id: 'schedules' })]),
      );
    });

    it('throws if duplicate ID', async () => {
      const payment = makePayment();
      await scheduler.schedulePayment(payment);
      await expect(scheduler.schedulePayment(payment)).rejects.toThrow('already exists');
    });

    it('sets nextExecutionAt for one-time payment', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payment = makePayment({
        schedule: { type: 'one-time', executeAt: now + 3600 },
      });
      await scheduler.schedulePayment(payment);

      const stored = scheduler.getPayment(payment.id)!;
      expect(stored.nextExecutionAt).toBe(now + 3600);
    });
  });

  // -------------------------------------------------------------------------
  // cancelPayment
  // -------------------------------------------------------------------------

  describe('cancelPayment()', () => {
    it('removes the payment from the schedule', async () => {
      const payment = makePayment();
      await scheduler.schedulePayment(payment);
      await scheduler.cancelPayment(payment.id);
      expect(scheduler.listPayments()).toHaveLength(0);
    });

    it('throws if payment not found', async () => {
      await expect(scheduler.cancelPayment('nonexistent')).rejects.toThrow('not found');
    });
  });

  // -------------------------------------------------------------------------
  // pausePayment / resumePayment
  // -------------------------------------------------------------------------

  describe('pausePayment() / resumePayment()', () => {
    it('pauses an active payment', async () => {
      const payment = makePayment();
      await scheduler.schedulePayment(payment);
      await scheduler.pausePayment(payment.id);

      const stored = scheduler.getPayment(payment.id)!;
      expect(stored.status).toBe('paused');
    });

    it('resumes a paused payment', async () => {
      const payment = makePayment();
      await scheduler.schedulePayment(payment);
      await scheduler.pausePayment(payment.id);
      await scheduler.resumePayment(payment.id);

      const stored = scheduler.getPayment(payment.id)!;
      expect(stored.status).toBe('active');
    });
  });

  // -------------------------------------------------------------------------
  // computeNextExecution
  // -------------------------------------------------------------------------

  describe('computeNextExecution()', () => {
    it('returns executeAt for one-time future payment', () => {
      const future = Math.floor(Date.now() / 1000) + 3600;
      const schedule: PaymentSchedule = { type: 'one-time', executeAt: future };
      const next = scheduler.computeNextExecution(schedule);
      expect(next).toBe(future);
    });

    it('returns now for one-time immediate payment (no executeAt)', () => {
      const before = Math.floor(Date.now() / 1000);
      const schedule: PaymentSchedule = { type: 'one-time' };
      const next = scheduler.computeNextExecution(schedule);
      expect(next).toBeGreaterThanOrEqual(before);
    });

    it('computes next execution for daily recurrence', () => {
      const now = Math.floor(Date.now() / 1000);
      const schedule: PaymentSchedule = { type: 'recurring', interval: 'daily' };
      const next = scheduler.computeNextExecution(schedule, now);
      // Daily = 86400 seconds later
      expect(next).toBeCloseTo(now + 86400, -1);
    });

    it('computes next execution for weekly recurrence', () => {
      const now = Math.floor(Date.now() / 1000);
      const schedule: PaymentSchedule = { type: 'recurring', interval: 'weekly' };
      const next = scheduler.computeNextExecution(schedule, now);
      expect(next).toBeCloseTo(now + 7 * 86400, -1);
    });

    it('returns undefined for recurring beyond endAt', () => {
      const past = Math.floor(Date.now() / 1000) - 1000;
      const schedule: PaymentSchedule = {
        type: 'recurring',
        interval: 'daily',
        endAt: past,
      };
      const next = scheduler.computeNextExecution(schedule);
      expect(next).toBeUndefined();
    });

    it('returns current time for conditional payments', () => {
      const before = Math.floor(Date.now() / 1000);
      const schedule: PaymentSchedule = { type: 'conditional' };
      const next = scheduler.computeNextExecution(schedule);
      expect(next).toBeGreaterThanOrEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // checkConditions
  // -------------------------------------------------------------------------

  describe('checkConditions()', () => {
    it('returns true for payment with no conditions', async () => {
      const payment = makePayment({ conditions: undefined });
      const result = await scheduler.checkConditions(payment);
      expect(result).toBe(true);
    });

    it('returns true for payment with empty conditions array', async () => {
      const payment = makePayment({ conditions: [] });
      const result = await scheduler.checkConditions(payment);
      expect(result).toBe(true);
    });

    it('evaluates balance_above condition — passes when balance sufficient', async () => {
      // NWC stub returns 1,000,000,000 msats
      const condition: PaymentCondition = {
        type: 'balance_above',
        params: { thresholdMsats: 1000 },
      };
      const payment = makePayment({ conditions: [condition] });
      const result = await scheduler.checkConditions(payment);
      expect(result).toBe(true);
    });

    it('evaluates balance_above condition — fails when balance insufficient', async () => {
      nwc.getBalance.mockResolvedValueOnce(BigInt(500)); // tiny balance
      const condition: PaymentCondition = {
        type: 'balance_above',
        params: { thresholdMsats: 1_000_000 },
      };
      const payment = makePayment({ conditions: [condition] });
      const result = await scheduler.checkConditions(payment);
      expect(result).toBe(false);
    });

    it('evaluates approval_required condition — fails without approval', async () => {
      const condition: PaymentCondition = {
        type: 'approval_required',
        params: { approved: false },
      };
      const payment = makePayment({ conditions: [condition] });
      const result = await scheduler.checkConditions(payment);
      expect(result).toBe(false);
    });

    it('evaluates approval_required condition — passes with approval', async () => {
      const condition: PaymentCondition = {
        type: 'approval_required',
        params: { approved: true },
      };
      const payment = makePayment({ conditions: [condition] });
      const result = await scheduler.checkConditions(payment);
      expect(result).toBe(true);
    });

    it('returns false if any condition fails', async () => {
      const conditions: PaymentCondition[] = [
        { type: 'approval_required', params: { approved: true } },
        { type: 'approval_required', params: { approved: false } }, // this one fails
      ];
      const payment = makePayment({ conditions });
      const result = await scheduler.checkConditions(payment);
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // processScheduledPayments
  // -------------------------------------------------------------------------

  describe('processScheduledPayments()', () => {
    it('returns empty array when no payments are due', async () => {
      const future = makePayment({
        schedule: {
          type: 'one-time',
          executeAt: Math.floor(Date.now() / 1000) + 9999,
        },
      });
      await scheduler.schedulePayment(future);

      const results = await scheduler.processScheduledPayments();
      expect(results).toHaveLength(0);
    });

    it('skips paused payments', async () => {
      const payment = makePayment();
      await scheduler.schedulePayment(payment);
      await scheduler.pausePayment(payment.id);

      const results = await scheduler.processScheduledPayments();
      expect(results).toHaveLength(0);
    });

    it('marks one-time payment as completed after execution', async () => {
      // Mock fetch for LNURL-pay
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            tag: 'payRequest',
            callback: 'https://example.com/callback',
            minSendable: 1,
            maxSendable: 1_000_000_000,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ pr: 'lnbc1test...' }),
        });

      const payment = makePayment();
      await scheduler.schedulePayment(payment);

      const results = await scheduler.processScheduledPayments();

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(true);

      const stored = scheduler.getPayment(payment.id)!;
      expect(stored.status).toBe('completed');

      globalThis.fetch = originalFetch;
    });

    it('records failed execution in history', async () => {
      nwc.payInvoice.mockRejectedValueOnce(new Error('Route not found'));

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            tag: 'payRequest',
            callback: 'https://example.com/callback',
            minSendable: 1,
            maxSendable: 1_000_000_000,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ pr: 'lnbc1test...' }),
        });

      const payment = makePayment();
      await scheduler.schedulePayment(payment);

      const results = await scheduler.processScheduledPayments();

      expect(results).toHaveLength(1);
      expect(results[0]!.success).toBe(false);
      expect(results[0]!.error).toContain('Route not found');

      globalThis.fetch = originalFetch;
    });
  });

  // -------------------------------------------------------------------------
  // Persistence round-trip
  // -------------------------------------------------------------------------

  describe('Persistence round-trip', () => {
    it('persists and reloads schedules correctly', async () => {
      const payment = makePayment({
        amountMsats: 5000n,
        label: 'Persistent Payment',
      });
      await scheduler.schedulePayment(payment);

      // Create a new scheduler and load from same vault
      const scheduler2 = new PaymentScheduler(vault as never, nwc as never, cashu as never);
      await scheduler2.load();

      const loaded = scheduler2.listPayments();
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.label).toBe('Persistent Payment');
      expect(loaded[0]!.amountMsats).toBe(5000n);
    });

    it('correctly serializes and deserializes BigInt amounts', async () => {
      const largeAmount = 999_999_999_999n;
      const payment = makePayment({ amountMsats: largeAmount });
      await scheduler.schedulePayment(payment);

      const scheduler2 = new PaymentScheduler(vault as never, nwc as never, cashu as never);
      await scheduler2.load();

      const loaded = scheduler2.getPayment(payment.id)!;
      expect(loaded.amountMsats).toBe(largeAmount);
    });
  });
});
