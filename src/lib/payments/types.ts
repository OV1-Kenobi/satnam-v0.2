/**
 * @module payments/types
 * @description TypeScript type definitions for the payments subsystem in Satnam v2.
 *
 * Covers:
 * - Push payment scheduling (one-time, recurring, conditional)
 * - Payment cascades (tree-based multi-recipient distribution)
 * - Atomic swaps (cross-mint Cashu, Boltz on-chain ↔ LN)
 *
 * All payment amounts use bigint millisatoshis for precision.
 */

// ---------------------------------------------------------------------------
// Payment Rails
// ---------------------------------------------------------------------------

/**
 * Payment rail (transport mechanism) for a payment.
 *
 * - `lightning` — NWC/Lightning Network
 * - `cashu` — Cashu eCash via a configured mint
 * - `lnbits` — LNbits REST API
 * - `auto` — Automatically select based on context
 */
export type PaymentRail = 'lightning' | 'cashu' | 'lnbits' | 'auto';

// ---------------------------------------------------------------------------
// Scheduled Payments
// ---------------------------------------------------------------------------

/** Payment schedule type. */
export type PaymentScheduleType = 'one-time' | 'recurring' | 'conditional';

/** Recurrence interval for recurring payments. */
export type RecurrenceInterval = 'hourly' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

/**
 * A payment condition that must be satisfied before a scheduled payment executes.
 */
export interface PaymentCondition {
  /**
   * Condition type:
   * - `balance_above` — execute only if wallet balance > params.thresholdMsats
   * - `time_window` — execute only within a time window (params.startHour/endHour, UTC)
   * - `trust_score_above` — execute only if recipient trust score > params.minScore
   * - `approval_required` — require explicit human approval before executing
   */
  type: 'balance_above' | 'time_window' | 'trust_score_above' | 'approval_required';
  /** Condition-specific parameters */
  params: Record<string, unknown>;
}

/**
 * Schedule definition for when a payment should execute.
 */
export interface PaymentSchedule {
  /** Schedule type */
  type: PaymentScheduleType;
  /** Recurrence interval (for recurring schedules) */
  interval?: RecurrenceInterval;
  /** Specific execution timestamp in Unix seconds (for one-time scheduled payments) */
  executeAt?: number;
  /** End date Unix timestamp — stop recurring after this time */
  endAt?: number;
  /** Maximum number of executions before the schedule is marked completed */
  maxExecutions?: number;
}

/**
 * Record of a single payment execution attempt.
 */
export interface PaymentExecution {
  /** Unix timestamp when the execution was attempted */
  executedAt: number;
  /** Amount paid in millisatoshis */
  amountMsats: bigint;
  /** Payment rail used for this execution */
  rail: PaymentRail;
  /** Whether the payment succeeded */
  success: boolean;
  /** Payment hash (Lightning) or proof ID (Cashu) if successful */
  paymentHash?: string;
  /** Error message if the payment failed */
  error?: string;
}

/**
 * A scheduled push payment.
 *
 * Persisted in OPFS Vault at `payments/schedules.json`.
 */
export interface ScheduledPayment {
  /** UUID identifier */
  id: string;
  /** Human-readable label */
  label: string;
  /** Recipient Nostr pubkey (hex) */
  recipientPubkey: string;
  /** Recipient Lightning Address (LNURL-pay, e.g. user@domain.com) */
  recipientLud16?: string;
  /** Amount in millisatoshis */
  amountMsats: bigint;
  /** Payment rail to use */
  rail: PaymentRail;
  /** Schedule definition */
  schedule: PaymentSchedule;
  /** Optional conditions that must all be true for the payment to execute */
  conditions?: PaymentCondition[];
  /** Current status */
  status: 'active' | 'paused' | 'completed' | 'failed';
  /** Unix timestamp when this schedule was created */
  createdAt: number;
  /** Unix timestamp of the last successful execution (undefined if never executed) */
  lastExecutedAt?: number;
  /** Unix timestamp of the next scheduled execution */
  nextExecutionAt?: number;
  /** History of execution attempts (most recent last) */
  executionHistory: PaymentExecution[];
}

// ---------------------------------------------------------------------------
// Payment Cascades
// ---------------------------------------------------------------------------

/**
 * A single node in a payment cascade tree.
 *
 * Each node represents one recipient. Children receive a percentage of the
 * amount allocated to their parent node.
 */
export interface CascadeNode {
  /** UUID identifier for this node */
  id: string;
  /** Recipient Nostr pubkey (hex) */
  recipientPubkey: string;
  /** Human-readable label for this recipient */
  recipientLabel: string;
  /** Recipient Lightning Address (optional) */
  recipientLud16?: string;
  /**
   * Percentage of the parent amount to send to this node (0–100).
   * Percentages at each level must sum to ≤100.
   * Mutually exclusive with fixedAmountMsats.
   */
  percentage: number;
  /**
   * Fixed amount override in millisatoshis.
   * If set, ignores percentage and uses this exact amount.
   */
  fixedAmountMsats?: bigint;
  /** Payment rail to use for this node */
  rail: PaymentRail;
  /** Child nodes (for multi-tier cascades) */
  children: CascadeNode[];
}

/**
 * A payment cascade configuration.
 *
 * A cascade distributes a total amount among a tree of recipients.
 * Each root node receives a percentage of totalAmountMsats;
 * child nodes receive a percentage of their parent's allocation.
 */
export interface PaymentCascade {
  /** UUID identifier */
  id: string;
  /** Human-readable label */
  label: string;
  /** Total amount to distribute in millisatoshis */
  totalAmountMsats: bigint;
  /** Root nodes of the cascade tree */
  rootNodes: CascadeNode[];
  /**
   * Execution mode:
   * - `sequential` — execute root nodes one at a time, then their children
   * - `parallel` — execute all nodes at the same level simultaneously
   */
  mode: 'sequential' | 'parallel';
  /**
   * Failure policy:
   * - `stop` — abort the cascade on first node failure
   * - `skip` — skip failed nodes and continue
   * - `retry` — retry failed nodes once before skipping
   */
  failurePolicy: 'stop' | 'skip' | 'retry';
  /** Unix timestamp when this cascade was created */
  createdAt: number;
}

/**
 * Result of executing a single cascade node.
 */
export interface CascadeNodeResult {
  /** Whether this node's payment succeeded */
  success: boolean;
  /** Amount paid in millisatoshis */
  amountMsats: bigint;
  /** Payment hash or proof ID if successful */
  paymentHash?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Result of executing an entire cascade.
 */
export interface CascadeExecution {
  /** ID of the cascade that was executed */
  cascadeId: string;
  /** Unix timestamp when execution started */
  startedAt: number;
  /** Unix timestamp when execution completed (undefined if still running) */
  completedAt?: number;
  /** Per-node results keyed by node ID */
  nodeResults: Map<string, CascadeNodeResult>;
  /** Total amount distributed successfully in millisatoshis */
  totalDistributed: bigint;
  /** Total fees paid in millisatoshis */
  totalFees: bigint;
}

// ---------------------------------------------------------------------------
// Atomic Swaps
// ---------------------------------------------------------------------------

/**
 * Atomic swap type.
 *
 * - `cashu_to_cashu` — Cross-mint swap: melt at source → LN invoice → mint at destination
 * - `cashu_to_lightning` — Melt Cashu proofs at a mint, receive on Lightning
 * - `lightning_to_cashu` — Pay Lightning invoice, mint eCash at destination mint
 * - `onchain_to_lightning` — Boltz submarine swap (on-chain → LN)
 * - `lightning_to_onchain` — Boltz reverse swap (LN → on-chain)
 */
export type SwapType =
  | 'cashu_to_cashu'
  | 'cashu_to_lightning'
  | 'lightning_to_cashu'
  | 'onchain_to_lightning'
  | 'lightning_to_onchain';

/**
 * Request to execute an atomic swap.
 */
export interface AtomicSwapRequest {
  /** Swap type */
  type: SwapType;
  /** Amount to swap in satoshis */
  amountSats: number;
  /** Source Cashu mint URL (for cashu_to_* swaps) */
  sourceMint?: string;
  /** Destination Cashu mint URL (for *_to_cashu and cashu_to_cashu swaps) */
  destinationMint?: string;
  /** Destination on-chain Bitcoin address (for lightning_to_onchain swaps) */
  onchainAddress?: string;
}

/**
 * Fee estimation for an atomic swap.
 */
export interface AtomicSwapQuote {
  /** Estimated fee breakdown */
  estimatedFees: {
    /** Fee at the source (melt fee, Cashu) */
    sourceFee: number;
    /** Lightning routing fee */
    lightningFee: number;
    /** Fee at the destination (mint fee, Cashu) */
    destinationFee: number;
    /** Total combined fee in satoshis */
    totalFee: number;
  };
  /** Estimated amount to receive at destination in satoshis */
  estimatedReceive: number;
  /** Unix timestamp when this quote expires */
  expiresAt: number;
}

/**
 * Result of an atomic swap execution.
 */
export interface AtomicSwapResult {
  /** Whether the swap completed successfully */
  success: boolean;
  /** Amount sent at source in satoshis */
  amountSent: number;
  /** Amount received at destination in satoshis */
  amountReceived: number;
  /** Total fees paid in satoshis */
  totalFees: number;
  /** Step-by-step execution log */
  steps: SwapStep[];
}

/**
 * A single step in an atomic swap execution.
 */
export interface SwapStep {
  /** Human-readable description of this step */
  description: string;
  /** Step status */
  status: 'pending' | 'completed' | 'failed';
  /** Transaction ID or payment hash (if applicable) */
  txId?: string;
  /** Unix timestamp when this step was recorded */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Serialization helpers (for OPFS persistence)
// ---------------------------------------------------------------------------

/**
 * JSON-serializable form of ScheduledPayment.
 * BigInt fields are stored as decimal strings.
 * @internal
 */
export interface ScheduledPaymentSerialized extends Omit<ScheduledPayment, 'amountMsats' | 'executionHistory'> {
  amountMsats: string;
  executionHistory: Array<Omit<PaymentExecution, 'amountMsats'> & { amountMsats: string }>;
}

/**
 * Serialize a ScheduledPayment for JSON storage.
 * @internal
 */
export function serializeScheduledPayment(p: ScheduledPayment): ScheduledPaymentSerialized {
  return {
    ...p,
    amountMsats: p.amountMsats.toString(),
    executionHistory: p.executionHistory.map((e) => ({
      ...e,
      amountMsats: e.amountMsats.toString(),
    })),
  };
}

/**
 * Deserialize a ScheduledPayment from JSON storage.
 * @internal
 */
export function deserializeScheduledPayment(raw: ScheduledPaymentSerialized): ScheduledPayment {
  return {
    ...raw,
    amountMsats: BigInt(raw.amountMsats),
    executionHistory: raw.executionHistory.map((e) => ({
      ...e,
      amountMsats: BigInt(e.amountMsats),
    })),
  };
}

/**
 * JSON-serializable form of CascadeNode.
 * BigInt fields are stored as decimal strings.
 * @internal
 */
export interface CascadeNodeSerialized extends Omit<CascadeNode, 'fixedAmountMsats' | 'children'> {
  fixedAmountMsats?: string;
  children: CascadeNodeSerialized[];
}

/**
 * JSON-serializable form of PaymentCascade.
 * @internal
 */
export interface PaymentCascadeSerialized extends Omit<PaymentCascade, 'totalAmountMsats' | 'rootNodes'> {
  totalAmountMsats: string;
  rootNodes: CascadeNodeSerialized[];
}

/**
 * Serialize a CascadeNode for JSON storage.
 * @internal
 */
export function serializeCascadeNode(node: CascadeNode): CascadeNodeSerialized {
  return {
    ...node,
    fixedAmountMsats: node.fixedAmountMsats?.toString(),
    children: node.children.map(serializeCascadeNode),
  };
}

/**
 * Deserialize a CascadeNode from JSON storage.
 * @internal
 */
export function deserializeCascadeNode(raw: CascadeNodeSerialized): CascadeNode {
  return {
    ...raw,
    fixedAmountMsats: raw.fixedAmountMsats !== undefined ? BigInt(raw.fixedAmountMsats) : undefined,
    children: raw.children.map(deserializeCascadeNode),
  };
}
