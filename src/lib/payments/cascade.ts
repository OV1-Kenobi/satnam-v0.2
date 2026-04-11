/**
 * @module payments/cascade
 * @description Payment cascade engine for Satnam v2.
 *
 * A cascade distributes a total payment amount across a tree of recipients.
 * Each node in the tree receives a percentage of its parent's allocation.
 * Cascades support sequential and parallel execution modes with configurable
 * failure policies.
 *
 * ## Validation
 * Percentages at each level of the tree must sum to ≤100%. Fixed amounts
 * are excluded from the percentage calculation.
 *
 * ## Execution modes
 * - `sequential` — Execute root nodes one at a time. For each root node,
 *   execute its children sequentially before moving to the next root.
 * - `parallel` — Execute all nodes at the same tree level simultaneously.
 *
 * ## Failure policies
 * - `stop` — Abort the entire cascade on the first failed payment.
 * - `skip` — Log the failure and continue with remaining nodes.
 * - `retry` — Retry the failed payment once before skipping.
 *
 * @example
 * ```typescript
 * const engine = new CascadeEngine(nwc, cashu, lnbits);
 * const cascade = engine.createCascade({
 *   label: 'Revenue split',
 *   totalAmountMsats: 100_000n,
 *   rootNodes: [
 *     { id: '1', recipientPubkey: 'alice...', percentage: 70, rail: 'lightning', children: [] },
 *     { id: '2', recipientPubkey: 'bob...', percentage: 30, rail: 'cashu', children: [] },
 *   ],
 *   mode: 'parallel',
 *   failurePolicy: 'skip',
 * });
 * const result = await engine.executeCascade(cascade, 100_000n);
 * ```
 */

import type { NwcConnectionManager } from '../nwc/connection-manager.js';
import type { CashuClient } from '../cashu/client.js';
import type { LNbitsClient } from '../lnbits/client.js';

import type {
  CascadeNode,
  PaymentCascade,
  CascadeExecution,
  CascadeNodeResult,
  PaymentRail,
} from './types.js';

// ---------------------------------------------------------------------------
// CascadeEngine
// ---------------------------------------------------------------------------

/**
 * Payment cascade execution engine.
 *
 * Routes individual node payments through the appropriate rail based on the
 * node's `rail` property. Uses NWC for lightning, CashuClient for cashu, and
 * LNbitsClient for the lnbits rail.
 */
export class CascadeEngine {
  /**
   * @param nwc - NWC connection manager for Lightning payments
   * @param cashu - Cashu client for eCash payments
   * @param lnbits - LNbits client (optional, required for 'lnbits' rail)
   */
  constructor(
    private readonly nwc: NwcConnectionManager,
    private readonly cashu: CashuClient,
    private readonly lnbits?: LNbitsClient,
  ) {}

  // -------------------------------------------------------------------------
  // Cascade creation
  // -------------------------------------------------------------------------

  /**
   * Create and validate a payment cascade.
   *
   * @param config - Cascade configuration (id will be auto-generated if not provided)
   * @returns Validated PaymentCascade
   * @throws {Error} if the cascade configuration is invalid
   */
  createCascade(config: Omit<PaymentCascade, 'id' | 'createdAt'> & { id?: string }): PaymentCascade {
    const cascade: PaymentCascade = {
      id: config.id ?? crypto.randomUUID(),
      label: config.label,
      totalAmountMsats: config.totalAmountMsats,
      rootNodes: config.rootNodes,
      mode: config.mode,
      failurePolicy: config.failurePolicy,
      createdAt: Math.floor(Date.now() / 1000),
    };

    const errors = this.validateCascade(cascade);
    if (errors.length > 0) {
      throw new Error(`Invalid cascade: ${errors.join('; ')}`);
    }

    return cascade;
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Validate a cascade configuration.
   *
   * Checks:
   * 1. Root nodes percentages sum to ≤100%
   * 2. Child node percentages at each parent sum to ≤100%
   * 3. No circular references (by ID uniqueness)
   * 4. All node IDs are unique within the cascade
   *
   * @param cascade - Cascade to validate
   * @returns Array of validation error messages (empty if valid)
   */
  validateCascade(cascade: PaymentCascade): string[] {
    const errors: string[] = [];
    const seenIds = new Set<string>();

    this.validateNodeList(cascade.rootNodes, 'root', errors, seenIds);

    return errors;
  }

  /**
   * Validate a list of sibling nodes at one level of the tree.
   * @internal
   */
  private validateNodeList(
    nodes: CascadeNode[],
    levelLabel: string,
    errors: string[],
    seenIds: Set<string>,
  ): void {
    // Check for duplicate IDs
    for (const node of nodes) {
      if (seenIds.has(node.id)) {
        errors.push(`Duplicate node ID: ${node.id}`);
      }
      seenIds.add(node.id);
    }

    // Sum percentages for percentage-based nodes (exclude fixed-amount nodes)
    const percentageNodes = nodes.filter((n) => n.fixedAmountMsats === undefined);
    const totalPercentage = percentageNodes.reduce((sum, n) => sum + n.percentage, 0);

    if (totalPercentage > 100) {
      errors.push(
        `${levelLabel} nodes: percentages sum to ${totalPercentage}%, must be ≤100%`,
      );
    }

    // Validate individual percentages
    for (const node of percentageNodes) {
      if (node.percentage < 0) {
        errors.push(`Node ${node.id} (${node.recipientLabel}): percentage cannot be negative`);
      }
      if (node.percentage > 100) {
        errors.push(`Node ${node.id} (${node.recipientLabel}): percentage ${node.percentage}% exceeds 100%`);
      }
    }

    // Recursively validate children
    for (const node of nodes) {
      if (node.children.length > 0) {
        this.validateNodeList(
          node.children,
          `node ${node.id} children`,
          errors,
          seenIds,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  /**
   * Execute a payment cascade.
   *
   * Walks the cascade tree and executes a payment for each node. The amount
   * for each node is computed from its percentage of the parent's allocation
   * (or from fixedAmountMsats if set).
   *
   * @param cascade - The cascade to execute
   * @param totalAmountMsats - Override for total amount (uses cascade.totalAmountMsats if omitted)
   * @returns CascadeExecution with per-node results
   */
  async executeCascade(
    cascade: PaymentCascade,
    totalAmountMsats?: bigint,
  ): Promise<CascadeExecution> {
    const total = totalAmountMsats ?? cascade.totalAmountMsats;
    const startedAt = Math.floor(Date.now() / 1000);

    const execution: CascadeExecution = {
      cascadeId: cascade.id,
      startedAt,
      nodeResults: new Map(),
      totalDistributed: 0n,
      totalFees: 0n,
    };

    // Execute root nodes
    await this.executeNodeList(
      cascade.rootNodes,
      total,
      cascade.mode,
      cascade.failurePolicy,
      execution,
    );

    execution.completedAt = Math.floor(Date.now() / 1000);

    return execution;
  }

  /**
   * Execute a list of sibling nodes at one level of the cascade tree.
   * @internal
   */
  private async executeNodeList(
    nodes: CascadeNode[],
    parentAmountMsats: bigint,
    mode: 'sequential' | 'parallel',
    failurePolicy: 'stop' | 'skip' | 'retry',
    execution: CascadeExecution,
  ): Promise<void> {
    if (mode === 'parallel') {
      // Execute all nodes at this level simultaneously
      const tasks = nodes.map((node) =>
        this.executeNode(node, parentAmountMsats, mode, failurePolicy, execution),
      );
      await Promise.allSettled(tasks);
    } else {
      // Sequential: execute one node at a time (including its children)
      for (const node of nodes) {
        await this.executeNode(node, parentAmountMsats, mode, failurePolicy, execution);
      }
    }
  }

  /**
   * Execute a single cascade node and its children.
   * @internal
   */
  private async executeNode(
    node: CascadeNode,
    parentAmountMsats: bigint,
    mode: 'sequential' | 'parallel',
    failurePolicy: 'stop' | 'skip' | 'retry',
    execution: CascadeExecution,
  ): Promise<void> {
    // Calculate this node's allocation
    const nodeAmountMsats = this.computeNodeAmount(node, parentAmountMsats);

    // Execute the payment
    let result = await this.executeNodePayment(node, nodeAmountMsats);

    // Handle retry policy
    if (!result.success && failurePolicy === 'retry') {
      // Wait 2 seconds before retry
      await new Promise((resolve) => setTimeout(resolve, 2000));
      result = await this.executeNodePayment(node, nodeAmountMsats);
    }

    // Store result
    execution.nodeResults.set(node.id, result);

    if (result.success) {
      execution.totalDistributed += nodeAmountMsats;
      // Execute children with the node's amount as the parent amount
      if (node.children.length > 0) {
        await this.executeNodeList(
          node.children,
          nodeAmountMsats,
          mode,
          failurePolicy,
          execution,
        );
      }
    } else if (failurePolicy === 'stop') {
      throw new Error(
        `Cascade stopped: node ${node.id} (${node.recipientLabel}) failed: ${result.error}`,
      );
    }
    // For 'skip' and 'retry' (after retry failed), just move on
  }

  /**
   * Execute a single node's payment via the appropriate rail.
   * @internal
   */
  private async executeNodePayment(
    node: CascadeNode,
    amountMsats: bigint,
  ): Promise<CascadeNodeResult> {
    if (amountMsats <= 0n) {
      return { success: false, amountMsats, error: 'Amount is zero or negative' };
    }

    try {
      const paymentHash = await this.payViaRail(node, amountMsats);
      return { success: true, amountMsats, paymentHash };
    } catch (err) {
      return {
        success: false,
        amountMsats,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Route a node payment through the appropriate payment rail.
   * @internal
   */
  private async payViaRail(node: CascadeNode, amountMsats: bigint): Promise<string | undefined> {
    const rail = this.resolveNodeRail(node, amountMsats);
    const amountSats = Number(amountMsats / 1000n);

    switch (rail) {
      case 'lightning': {
        if (!node.recipientLud16) {
          throw new Error(`Lightning rail: node ${node.id} has no recipientLud16`);
        }
        const invoice = await this.fetchLnurlInvoice(node.recipientLud16, amountMsats);
        const result = await this.nwc.payInvoice(invoice);
        return result.paymentHash;
      }

      case 'cashu': {
        const mints = await this.cashu.listMints();
        const mint = mints.find((m) => m.isAllowed && m.balance >= amountSats);
        if (!mint) {
          throw new Error(`Cashu rail: no mint with sufficient balance for node ${node.id}`);
        }
        const token = await this.cashu.sendTokens(amountSats, mint.url);
        return token.slice(0, 64);
      }

      case 'lnbits': {
        if (!this.lnbits) {
          throw new Error('LNbits rail: LNbitsClient not provided to CascadeEngine');
        }
        if (!node.recipientLud16) {
          throw new Error(`LNbits rail: node ${node.id} has no recipientLud16`);
        }
        const invoice = await this.fetchLnurlInvoice(node.recipientLud16, amountMsats);
        const result = await this.lnbits.payInvoice(invoice);
        return result.paymentHash;
      }

      default:
        throw new Error(`Unknown rail: ${rail as string} for node ${node.id}`);
    }
  }

  /**
   * Compute the millisatoshi amount for a cascade node.
   * @internal
   */
  private computeNodeAmount(node: CascadeNode, parentAmountMsats: bigint): bigint {
    if (node.fixedAmountMsats !== undefined) {
      return node.fixedAmountMsats;
    }
    // percentage of parent amount
    return (parentAmountMsats * BigInt(Math.round(node.percentage * 100))) / 10000n;
  }

  /**
   * Resolve the effective payment rail for a node.
   * @internal
   */
  private resolveNodeRail(node: CascadeNode, amountMsats: bigint): PaymentRail {
    if (node.rail !== 'auto') return node.rail;
    // Auto: prefer lightning if LUD-16 is available, else cashu
    if (node.recipientLud16) return 'lightning';
    // Sub-1000 msats route via cashu (sub-sat routing uneconomical on LN)
    if (amountMsats < 1000n) return 'cashu';
    return 'lightning';
  }

  /**
   * Fetch a BOLT-11 invoice from a Lightning Address / LNURL-pay endpoint.
   * @internal
   */
  private async fetchLnurlInvoice(lud16: string, amountMsats: bigint): Promise<string> {
    const [username, domain] = lud16.split('@');
    if (!username || !domain) {
      throw new Error(`Invalid Lightning Address: ${lud16}`);
    }

    const metaUrl = `https://${domain}/.well-known/lnurlp/${username}`;
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) {
      throw new Error(`LNURL-pay metadata fetch failed: HTTP ${metaRes.status}`);
    }

    const meta = await metaRes.json() as {
      callback: string;
      minSendable: number;
      maxSendable: number;
      tag: string;
    };

    // SECURITY: Validate callback URL to prevent SSRF / attacker-controlled redirects.
    // The LNURL spec (LUD-06) requires the callback to be HTTPS. We additionally
    // verify the callback domain matches the Lightning Address domain to prevent
    // a compromised metadata endpoint from redirecting invoice fetches elsewhere.
    let callbackParsed: URL;
    try {
      callbackParsed = new URL(meta.callback);
    } catch {
      throw new Error(`LNURL-pay: invalid callback URL in metadata`);
    }
    if (callbackParsed.protocol !== 'https:') {
      throw new Error(`LNURL-pay: callback must be HTTPS, got ${callbackParsed.protocol}`);
    }
    if (callbackParsed.hostname !== domain) {
      throw new Error(
        `LNURL-pay: callback domain mismatch — expected ${domain}, got ${callbackParsed.hostname}`
      );
    }

    const msats = Number(amountMsats);
    const callbackUrl = `${meta.callback}${meta.callback.includes('?') ? '&' : '?'}amount=${msats}`;
    const invoiceRes = await fetch(callbackUrl);
    if (!invoiceRes.ok) {
      throw new Error(`LNURL-pay invoice fetch failed: HTTP ${invoiceRes.status}`);
    }

    const data = await invoiceRes.json() as { pr?: string; reason?: string };
    if (!data.pr) {
      throw new Error(`LNURL-pay: no invoice returned${data.reason ? `: ${data.reason}` : ''}`);
    }

    return data.pr;
  }
}
