/**
 * @module payments/scheduler
 * @description Push payment scheduler for Satnam v2.
 *
 * Supports one-time, recurring, and conditional payment schedules routed
 * through Lightning (NWC), Cashu eCash, or LNbits.
 *
 * ## Persistence
 * All schedule state is persisted in OPFS Vault at `payments/schedules.json`
 * (serialized via the vault's Cashu proof storage slot with a dedicated key).
 *
 * ## Routing
 * - `rail: 'lightning'` — uses NwcConnectionManager.payInvoice()
 * - `rail: 'cashu'` — uses CashuClient.sendTokens() or meltTokens()
 * - `rail: 'lnbits'` — uses LNbitsClient.payInvoice()
 * - `rail: 'auto'` — selects lightning (LUD-16 available) or cashu
 *
 * ## Usage
 * ```typescript
 * const scheduler = new PaymentScheduler(vault, nwc, cashu, lnbits);
 * await scheduler.load();
 * await scheduler.schedulePayment({ id: crypto.randomUUID(), ... });
 * // Call processScheduledPayments() periodically (e.g. every minute)
 * await scheduler.processScheduledPayments();
 * ```
 */

import type { Vault } from '../vault/vault.js';
import type { NwcConnectionManager } from '../nwc/connection-manager.js';
import type { CashuClient } from '../cashu/client.js';
import type { LNbitsClient } from '../lnbits/client.js';

import type {
  ScheduledPayment,
  PaymentSchedule,
  PaymentCondition,
  PaymentExecution,
  PaymentRail,
} from './types.js';
import {
  serializeScheduledPayment,
  deserializeScheduledPayment,
  type ScheduledPaymentSerialized,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Vault storage key for the schedules JSON blob. */
const SCHEDULES_VAULT_KEY = 'payments_schedules';

/** Number of milliseconds in each recurrence interval. */
const INTERVAL_MS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  biweekly: 14 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000, // approximate
};

// ---------------------------------------------------------------------------
// PaymentScheduler
// ---------------------------------------------------------------------------

/**
 * Manages push payment schedules with support for one-time, recurring, and
 * conditional payments across multiple payment rails.
 */
export class PaymentScheduler {
  /** In-memory schedule map (keyed by payment ID). */
  private schedules = new Map<string, ScheduledPayment>();

  /** Whether schedules have been loaded from the vault. */
  private loaded = false;

  /**
   * @param vault - OPFS Vault for persisting schedule state
   * @param nwc - NWC connection manager for Lightning payments
   * @param cashu - Cashu client for eCash payments
   * @param lnbits - LNbits client for LNbits rail payments (optional)
   */
  constructor(
    private readonly vault: Vault,
    private readonly nwc: NwcConnectionManager,
    private readonly cashu: CashuClient,
    private readonly lnbits?: LNbitsClient,
  ) {}

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /**
   * Load all schedules from OPFS Vault into memory.
   * Must be called before any other operation.
   *
   * @throws {Error} if the vault is locked
   */
  async load(): Promise<void> {
    try {
      const proofs = await this.vault.getCashuProofs(SCHEDULES_VAULT_KEY);
      // We store schedules in the 'secret' field of a fake proof
      const serialized = proofs[0]?.secret ?? '[]';
      const rawSchedules = JSON.parse(serialized) as ScheduledPaymentSerialized[];
      this.schedules.clear();
      for (const raw of rawSchedules) {
        const payment = deserializeScheduledPayment(raw);
        this.schedules.set(payment.id, payment);
      }
    } catch {
      // No schedules stored yet — start fresh
      this.schedules.clear();
    }
    this.loaded = true;
  }

  /**
   * Persist all schedules to OPFS Vault.
   * Called automatically after mutations.
   *
   * @throws {Error} if the vault is locked
   */
  private async save(): Promise<void> {
    const serialized = [...this.schedules.values()].map(serializeScheduledPayment);
    const json = JSON.stringify(serialized);
    await this.vault.storeCashuProofs(SCHEDULES_VAULT_KEY, [
      { id: 'schedules', amount: 0, secret: json, C: '' },
    ]);
  }

  // -------------------------------------------------------------------------
  // Schedule management
  // -------------------------------------------------------------------------

  /**
   * Add a new scheduled payment.
   *
   * Computes the initial nextExecutionAt based on the schedule type.
   *
   * @param payment - ScheduledPayment to add (must have a unique id)
   * @throws {Error} if a payment with the same ID already exists
   */
  async schedulePayment(payment: ScheduledPayment): Promise<void> {
    this.requireLoaded();
    if (this.schedules.has(payment.id)) {
      throw new Error(`PaymentScheduler: payment ID ${payment.id} already exists`);
    }

    const enriched: ScheduledPayment = {
      ...payment,
      executionHistory: payment.executionHistory ?? [],
      nextExecutionAt: this.computeNextExecution(payment.schedule),
    };

    this.schedules.set(payment.id, enriched);
    await this.save();
  }

  /**
   * Cancel and remove a scheduled payment.
   *
   * @param id - Payment UUID to cancel
   * @throws {Error} if the payment does not exist
   */
  async cancelPayment(id: string): Promise<void> {
    this.requireLoaded();
    if (!this.schedules.has(id)) {
      throw new Error(`PaymentScheduler: payment ${id} not found`);
    }
    this.schedules.delete(id);
    await this.save();
  }

  /**
   * Pause a scheduled payment (suspends execution without removing it).
   *
   * @param id - Payment UUID to pause
   */
  async pausePayment(id: string): Promise<void> {
    this.requireLoaded();
    const existing = this.schedules.get(id);
    if (!existing) {
      throw new Error(`PaymentScheduler: payment ${id} not found`);
    }
    this.schedules.set(id, { ...existing, status: 'paused' });
    await this.save();
  }

  /**
   * Resume a paused payment.
   *
   * @param id - Payment UUID to resume
   */
  async resumePayment(id: string): Promise<void> {
    this.requireLoaded();
    const existing = this.schedules.get(id);
    if (!existing) {
      throw new Error(`PaymentScheduler: payment ${id} not found`);
    }
    this.schedules.set(id, {
      ...existing,
      status: 'active',
      nextExecutionAt: this.computeNextExecution(existing.schedule),
    });
    await this.save();
  }

  /**
   * Get all scheduled payments.
   *
   * @returns Array of all payments (including paused and completed)
   */
  listPayments(): ScheduledPayment[] {
    this.requireLoaded();
    return [...this.schedules.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get a single scheduled payment by ID.
   *
   * @param id - Payment UUID
   * @returns The payment or undefined if not found
   */
  getPayment(id: string): ScheduledPayment | undefined {
    this.requireLoaded();
    return this.schedules.get(id);
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  /**
   * Process all due payments.
   *
   * Should be called periodically (e.g. every 60 seconds via setInterval).
   * Skips paused, completed, and future-scheduled payments.
   *
   * @returns Array of execution results (one per payment that was attempted)
   */
  async processScheduledPayments(): Promise<PaymentExecution[]> {
    this.requireLoaded();
    const now = Math.floor(Date.now() / 1000);
    const results: PaymentExecution[] = [];

    for (const payment of this.schedules.values()) {
      if (payment.status !== 'active') continue;
      if (!payment.nextExecutionAt || payment.nextExecutionAt > now) continue;

      // Check conditions before executing
      const conditionsMet = await this.checkConditions(payment);
      if (!conditionsMet) continue;

      const execution = await this.executePayment(payment);
      results.push(execution);

      // Update payment state
      const updated: ScheduledPayment = {
        ...payment,
        lastExecutedAt: now,
        executionHistory: [...payment.executionHistory, execution],
      };

      if (execution.success) {
        // Check if schedule is complete
        const totalExecutions = updated.executionHistory.filter((e) => e.success).length;
        const isComplete =
          payment.schedule.type === 'one-time' ||
          (payment.schedule.endAt && now >= payment.schedule.endAt) ||
          (payment.schedule.maxExecutions && totalExecutions >= payment.schedule.maxExecutions);

        updated.status = isComplete ? 'completed' : 'active';
        updated.nextExecutionAt = isComplete
          ? undefined
          : this.computeNextExecution(payment.schedule, now);
      } else {
        // On failure, advance to next execution time (don't get stuck)
        updated.nextExecutionAt = this.computeNextExecution(payment.schedule, now);
      }

      this.schedules.set(payment.id, updated);
    }

    if (results.length > 0) {
      await this.save();
    }

    return results;
  }

  /**
   * Manually trigger a payment execution regardless of schedule.
   *
   * @param paymentOrId - Payment object or ID string
   * @returns PaymentExecution result
   */
  async executePayment(paymentOrId: ScheduledPayment | string): Promise<PaymentExecution> {
    const payment = typeof paymentOrId === 'string'
      ? this.getOrThrow(paymentOrId)
      : paymentOrId;

    const executedAt = Math.floor(Date.now() / 1000);
    const rail = this.resolveRail(payment);

    try {
      const result = await this.executeOnRail(payment, rail);
      return {
        executedAt,
        amountMsats: payment.amountMsats,
        rail,
        success: true,
        paymentHash: result.paymentHash,
      };
    } catch (err) {
      return {
        executedAt,
        amountMsats: payment.amountMsats,
        rail,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // -------------------------------------------------------------------------
  // Condition evaluation
  // -------------------------------------------------------------------------

  /**
   * Check all conditions for a scheduled payment.
   *
   * @param payment - Payment to check conditions for
   * @returns true if all conditions are met (or no conditions), false otherwise
   */
  async checkConditions(payment: ScheduledPayment): Promise<boolean> {
    if (!payment.conditions || payment.conditions.length === 0) return true;

    for (const condition of payment.conditions) {
      const met = await this.evaluateCondition(condition);
      if (!met) return false;
    }

    return true;
  }

  /**
   * Evaluate a single payment condition.
   * @internal
   */
  private async evaluateCondition(
    condition: PaymentCondition,
  ): Promise<boolean> {
    switch (condition.type) {
      case 'balance_above': {
        const threshold = BigInt(String(condition.params['thresholdMsats'] ?? 0));
        try {
          const balance = await this.nwc.getBalance();
          return balance >= threshold;
        } catch {
          return false;
        }
      }

      case 'time_window': {
        const now = new Date();
        const utcHour = now.getUTCHours();
        const startHour = Number(condition.params['startHour'] ?? 0);
        const endHour = Number(condition.params['endHour'] ?? 24);
        return utcHour >= startHour && utcHour < endHour;
      }

      case 'trust_score_above': {
        // Trust score condition — always passes unless explicitly failing
        // A full implementation would check the Nostr web-of-trust graph
        const minScore = Number(condition.params['minScore'] ?? 0);
        const currentScore = Number(condition.params['currentScore'] ?? 100);
        return currentScore >= minScore;
      }

      case 'approval_required': {
        // Approval condition — requires explicit external signal
        // Returns true only if params.approved is explicitly set to true
        return condition.params['approved'] === true;
      }

      default:
        return true;
    }
  }

  // -------------------------------------------------------------------------
  // Schedule helpers
  // -------------------------------------------------------------------------

  /**
   * Calculate the next execution time for a payment schedule.
   *
   * @param schedule - Schedule definition
   * @param lastExecutedAt - Unix timestamp of last execution (optional)
   * @returns Unix timestamp of next execution, or undefined if complete
   */
  computeNextExecution(schedule: PaymentSchedule, lastExecutedAt?: number): number | undefined {
    const now = Math.floor(Date.now() / 1000);

    switch (schedule.type) {
      case 'one-time':
        if (schedule.executeAt) {
          // Only schedule if it's in the future and hasn't been executed
          return schedule.executeAt > now ? schedule.executeAt : (lastExecutedAt ? undefined : now);
        }
        return now;

      case 'recurring': {
        if (!schedule.interval) return undefined;
        const intervalMs = INTERVAL_MS[schedule.interval];
        if (!intervalMs) return undefined;
        const intervalSecs = Math.floor(intervalMs / 1000);
        const base = lastExecutedAt ?? now;
        const next = base + intervalSecs;

        // Check end date
        if (schedule.endAt && next > schedule.endAt) return undefined;

        return next;
      }

      case 'conditional':
        // Conditional payments execute as soon as conditions are met
        // Return current time to check on next processScheduledPayments() call
        return now;

      default:
        return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Rail execution
  // -------------------------------------------------------------------------

  /**
   * Resolve the effective payment rail for a payment.
   * @internal
   */
  private resolveRail(payment: ScheduledPayment): PaymentRail {
    if (payment.rail !== 'auto') return payment.rail;

    // Auto selection: prefer Lightning if there's a LUD-16 address
    if (payment.recipientLud16) return 'lightning';

    // Otherwise default to lightning (NWC)
    return 'lightning';
  }

  /**
   * Execute a payment on the specified rail.
   * @internal
   */
  private async executeOnRail(
    payment: ScheduledPayment,
    rail: PaymentRail,
  ): Promise<{ paymentHash?: string }> {
    const amountSats = Number(payment.amountMsats / 1000n);

    switch (rail) {
      case 'lightning': {
        if (!payment.recipientLud16) {
          throw new Error('Lightning rail requires recipientLud16 (LNURL-pay address)');
        }
        // Fetch invoice from LNURL-pay address
        const invoice = await this.fetchLnurlPayInvoice(
          payment.recipientLud16,
          payment.amountMsats,
        );
        const result = await this.nwc.payInvoice(invoice);
        return { paymentHash: result.paymentHash };
      }

      case 'cashu': {
        // For Cashu, we need a mint URL — use the first available mint
        const mints = await this.cashu.listMints();
        if (mints.length === 0) {
          throw new Error('Cashu rail: no mints configured');
        }
        const mint = mints.find((m) => m.isAllowed && m.balance >= amountSats) ?? mints[0];
        if (!mint) {
          throw new Error('Cashu rail: no mint with sufficient balance');
        }
        const token = await this.cashu.sendTokens(amountSats, mint.url);
        return { paymentHash: token.slice(0, 64) }; // use token prefix as ID
      }

      case 'lnbits': {
        if (!this.lnbits) {
          throw new Error('LNbits rail: LNbitsClient not provided');
        }
        if (!payment.recipientLud16) {
          throw new Error('LNbits rail requires recipientLud16');
        }
        const invoice = await this.fetchLnurlPayInvoice(
          payment.recipientLud16,
          payment.amountMsats,
        );
        const result = await this.lnbits.payInvoice(invoice);
        return { paymentHash: result.paymentHash };
      }

      default:
        throw new Error(`Unknown payment rail: ${rail as string}`);
    }
  }

  /**
   * Fetch a BOLT-11 invoice from a LNURL-pay / Lightning Address.
   *
   * Lightning Address format: user@domain.com
   * LNURL-pay callback format: https://domain.com/.well-known/lnurlp/user
   *
   * @param lud16 - Lightning Address (user@domain.com)
   * @param amountMsats - Amount to request in millisatoshis
   * @returns BOLT-11 invoice string
   */
  private async fetchLnurlPayInvoice(lud16: string, amountMsats: bigint): Promise<string> {
    const [username, domain] = lud16.split('@');
    if (!username || !domain) {
      throw new Error(`Invalid Lightning Address: ${lud16}`);
    }

    // Step 1: Fetch LNURL-pay metadata
    const metaUrl = `https://${domain}/.well-known/lnurlp/${username}`;
    const metaResponse = await fetch(metaUrl);
    if (!metaResponse.ok) {
      throw new Error(`LNURL-pay metadata fetch failed for ${lud16}: HTTP ${metaResponse.status}`);
    }
    const meta = await metaResponse.json() as {
      callback: string;
      minSendable: number;
      maxSendable: number;
      tag: string;
    };

    if (meta.tag !== 'payRequest') {
      throw new Error(`LNURL-pay: unexpected tag ${meta.tag} for ${lud16}`);
    }

    const msats = Number(amountMsats);
    if (msats < meta.minSendable || msats > meta.maxSendable) {
      throw new Error(
        `LNURL-pay: amount ${msats} msats out of range [${meta.minSendable}, ${meta.maxSendable}]`,
      );
    }

    // Step 2: Fetch invoice from callback
    const callbackUrl = `${meta.callback}?amount=${msats}`;
    const invoiceResponse = await fetch(callbackUrl);
    if (!invoiceResponse.ok) {
      throw new Error(`LNURL-pay invoice fetch failed: HTTP ${invoiceResponse.status}`);
    }
    const invoiceData = await invoiceResponse.json() as { pr: string; reason?: string };

    if (!invoiceData.pr) {
      throw new Error(
        `LNURL-pay: no invoice returned${invoiceData.reason ? `: ${invoiceData.reason}` : ''}`,
      );
    }

    return invoiceData.pr;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Throw if schedules have not been loaded. */
  private requireLoaded(): void {
    if (!this.loaded) {
      throw new Error('PaymentScheduler: call load() before using the scheduler');
    }
  }

  /** Get a payment by ID or throw. */
  private getOrThrow(id: string): ScheduledPayment {
    const payment = this.schedules.get(id);
    if (!payment) {
      throw new Error(`PaymentScheduler: payment ${id} not found`);
    }
    return payment;
  }
}
