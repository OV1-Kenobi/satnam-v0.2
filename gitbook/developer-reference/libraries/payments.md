# Payments Library (`src/lib/payments/`)

The payments library provides three engines: `PaymentScheduler` for scheduled and recurring payments, `CascadeEngine` for split payment trees, and `AtomicSwapEngine` for cross-rail value movement. All three share a common type system.

---

## Installation and Import

```typescript
import { PaymentScheduler, CascadeEngine, AtomicSwapEngine } from '@/lib/payments';
import type {
  ScheduledPayment,
  PaymentSchedule,
  PaymentCondition,
  PaymentExecution,
  PaymentCascade,
  CascadeNode,
  CascadeExecution,
  AtomicSwapRequest,
  AtomicSwapQuote,
  AtomicSwapResult,
  SwapStep,
  PaymentRail,
  SwapType,
} from '@/lib/payments';
```

---

## Types Reference

### `PaymentRail`

```typescript
type PaymentRail = 'lightning' | 'cashu' | 'lnbits' | 'auto';
```

- `auto`: scheduler picks Cashu for amounts under 1,000 msats (1 sat); Lightning otherwise.

### `PaymentScheduleType`

```typescript
type PaymentScheduleType = 'one-time' | 'recurring' | 'conditional';
```

### `RecurrenceInterval`

```typescript
type RecurrenceInterval = 'hourly' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
```

### `ScheduledPayment`

```typescript
interface ScheduledPayment {
  id: string;
  label: string;
  recipientPubkey: string;
  recipientLud16?: string;          // LNURL-pay address
  amountMsats: bigint;
  rail: PaymentRail;
  schedule: PaymentSchedule;
  conditions?: PaymentCondition[];
  status: 'active' | 'paused' | 'completed' | 'failed';
  createdAt: number;
  lastExecutedAt?: number;
  nextExecutionAt?: number;
  executionHistory: PaymentExecution[];
}
```

### `PaymentSchedule`

```typescript
interface PaymentSchedule {
  type: PaymentScheduleType;
  interval?: RecurrenceInterval;    // for recurring
  executeAt?: number;               // Unix timestamp for one-time
  endAt?: number;                   // end date for recurring
  maxExecutions?: number;           // optional cap on total executions
}
```

### `PaymentCondition`

```typescript
interface PaymentCondition {
  type: 'balance_above' | 'time_window' | 'trust_score_above' | 'approval_required';
  params: Record<string, unknown>;
}

// Example params per type:
// balance_above:    { thresholdMsats: number }
// time_window:      { startHour: number, endHour: number }  (UTC)
// trust_score_above: { minScore: number }
// approval_required: {}
```

### `PaymentExecution`

```typescript
interface PaymentExecution {
  executedAt: number;
  amountMsats: bigint;
  rail: PaymentRail;
  success: boolean;
  paymentHash?: string;
  error?: string;
}
```

### `CascadeNode`

```typescript
interface CascadeNode {
  id: string;
  recipientPubkey: string;
  recipientLabel: string;
  recipientLud16?: string;
  percentage: number;               // 0–100; applied to parent amount
  fixedAmountMsats?: bigint;        // overrides percentage if set
  rail: PaymentRail;
  children: CascadeNode[];
}
```

### `PaymentCascade`

```typescript
interface PaymentCascade {
  id: string;
  label: string;
  totalAmountMsats: bigint;
  rootNodes: CascadeNode[];
  mode: 'sequential' | 'parallel';
  failurePolicy: 'stop' | 'skip' | 'retry';
  createdAt: number;
}
```

### `CascadeExecution`

```typescript
interface CascadeExecution {
  cascadeId: string;
  startedAt: number;
  completedAt?: number;
  nodeResults: Map<string, {
    success: boolean;
    amountMsats: bigint;
    paymentHash?: string;
    error?: string;
  }>;
  totalDistributed: bigint;
  totalFees: bigint;
}
```

### `SwapType`

```typescript
type SwapType =
  | 'cashu_to_cashu'        // Cross-mint via LN intermediary
  | 'cashu_to_lightning'    // Melt at mint, receive on LN
  | 'lightning_to_cashu'    // Pay LN invoice, mint at mint
  | 'onchain_to_lightning'  // Boltz submarine swap
  | 'lightning_to_onchain'; // Boltz reverse swap
```

### `AtomicSwapRequest`

```typescript
interface AtomicSwapRequest {
  type: SwapType;
  amountSats: number;
  sourceMint?: string;       // Cashu source mint URL
  destinationMint?: string;  // Cashu destination mint URL
  onchainAddress?: string;   // on-chain destination for reverse swaps
}
```

### `AtomicSwapQuote`

```typescript
interface AtomicSwapQuote {
  estimatedFees: {
    sourceFee: number;        // sats
    lightningFee: number;     // sats
    destinationFee: number;   // sats
    totalFee: number;         // sats
  };
  estimatedReceive: number;   // sats
  expiresAt: number;          // Unix timestamp
}
```

### `AtomicSwapResult`

```typescript
interface AtomicSwapResult {
  success: boolean;
  amountSent: number;
  amountReceived: number;
  totalFees: number;
  steps: SwapStep[];
}
```

### `SwapStep`

```typescript
interface SwapStep {
  description: string;
  status: 'pending' | 'completed' | 'failed';
  txId?: string;              // payment hash, txid, or proof ID
  timestamp: number;
}
```

---

## `PaymentScheduler`

Manages the lifecycle of scheduled and recurring payments.

### Constructor

```typescript
const scheduler = new PaymentScheduler({
  nwc,       // NWC client instance
  cashu,     // CashuClient instance
  lnbits,    // LNbitsClient instance (optional)
  vault,     // VaultClient for persistence
});
```

### Methods

#### `schedulePayment(payment: ScheduledPayment): Promise<void>`

Add a payment to the schedule. Persists immediately to `payments/schedules.json` in the vault.

```typescript
await scheduler.schedulePayment({
  id: crypto.randomUUID(),
  label: 'Weekly stipend',
  recipientPubkey: 'npub1...',
  amountMsats: 50_000_000n,
  rail: 'lightning',
  schedule: { type: 'recurring', interval: 'weekly' },
  conditions: [{ type: 'balance_above', params: { thresholdMsats: 200_000_000 } }],
  status: 'active',
  createdAt: Date.now(),
  executionHistory: [],
});
```

---

#### `cancelPayment(id: string): Promise<void>`

Remove a scheduled payment. The payment is deleted from vault storage. Execution history is preserved in the audit log.

---

#### `pausePayment(id: string): Promise<void>`

Set the payment status to `paused`. No further executions will fire until `resumePayment()` is called.

---

#### `resumePayment(id: string): Promise<void>`

Reactivate a paused payment. Recalculates `nextExecutionAt` from the current time.

---

#### `executePayment(payment: ScheduledPayment): Promise<PaymentExecution>`

Execute a single payment immediately, routing through the appropriate rail:

- `lightning` → NWC `payInvoice()`
- `cashu` → CashuClient `send()`
- `lnbits` → LNbitsClient `payInvoice()`
- `auto` → selects rail based on amount and availability

Returns a `PaymentExecution` record. Throws on unrecoverable failure.

---

#### `checkConditions(payment: ScheduledPayment): Promise<boolean>`

Evaluate all conditions attached to a payment. Returns `true` if all conditions pass.

```typescript
const canExecute = await scheduler.checkConditions(payment);
if (canExecute) {
  await scheduler.executePayment(payment);
}
```

---

#### `getNextExecution(payment: ScheduledPayment): number | null`

Calculate the next execution timestamp. Returns `null` if the schedule is complete (maxExecutions reached or endAt passed).

---

#### `processScheduledPayments(): Promise<void>`

Process all due payments in the active schedule list. Call this on a periodic timer (the app calls it every 60 seconds while active).

```typescript
// Called by the app's background tick
setInterval(() => scheduler.processScheduledPayments(), 60_000);
```

---

## `CascadeEngine`

Manages payment cascade tree creation, validation, and execution.

### Constructor

```typescript
const engine = new CascadeEngine({
  nwc,
  cashu,
  lnbits,
});
```

### Methods

#### `createCascade(config: Omit<PaymentCascade, 'id' | 'createdAt'>): Promise<PaymentCascade>`

Create and persist a cascade template.

```typescript
const cascade = await engine.createCascade({
  label: 'Team split',
  totalAmountMsats: 1_000_000n,
  mode: 'parallel',
  failurePolicy: 'skip',
  rootNodes: [ /* ... */ ],
});
```

---

#### `validateCascade(cascade: PaymentCascade): ValidationResult`

Validate the cascade tree structure. Checks:

- Percentages at each level sum to ≤ 100%
- No node has both `percentage` and `fixedAmountMsats` set
- All recipient identifiers are valid pubkeys or LNURL-pay addresses
- Rail values are one of the valid `PaymentRail` types

```typescript
const result = engine.validateCascade(cascade);
if (!result.valid) {
  console.error(result.errors);
}
```

Returns `{ valid: boolean, errors: string[] }`.

---

#### `executeCascade(cascade: PaymentCascade, totalAmount: bigint): Promise<CascadeExecution>`

Execute the cascade for a given total amount. Walks the tree per the configured `mode` and routes each leaf payment through the appropriate rail.

```typescript
const execution = await engine.executeCascade(cascade, 500_000_000n);
console.log(`Distributed: ${execution.totalDistributed} msats`);

for (const [nodeId, result] of execution.nodeResults) {
  if (!result.success) {
    console.error(`Node ${nodeId} failed: ${result.error}`);
  }
}
```

**Sequential mode:** Executes root nodes in array order, then their children recursively. Stops on first failure if `failurePolicy: 'stop'`.

**Parallel mode:** Executes all nodes at the same depth level concurrently using `Promise.allSettled()`.

---

## `AtomicSwapEngine`

Orchestrates atomic swaps across payment rails.

### Constructor

```typescript
const swapEngine = new AtomicSwapEngine({
  cashu,
  nwc,
  lnbits,
});
```

### Methods

#### `getQuote(request: AtomicSwapRequest): Promise<AtomicSwapQuote>`

Estimate fees for a swap without executing it. Quotes expire after 60 seconds.

```typescript
const quote = await swapEngine.getQuote({
  type: 'cashu_to_cashu',
  amountSats: 10_000,
  sourceMint: 'https://mint-a.example',
  destinationMint: 'https://mint-b.example',
});

console.log(`Total fee: ${quote.estimatedFees.totalFee} sats`);
console.log(`You receive: ${quote.estimatedReceive} sats`);
```

---

#### `executeSwap(request: AtomicSwapRequest): Promise<AtomicSwapResult>`

Execute the swap atomically. Each step is recorded in the returned `AtomicSwapResult`.

**Cross-mint Cashu flow:**
1. Melt proofs at source mint (generates Lightning invoice)
2. Pay the invoice via NWC
3. Mint fresh proofs at destination mint using the payment preimage

**Boltz submarine (on-chain → LN):**
1. Call `lnbits.createBoltzSwap({ type: 'submarine', ... })`
2. Display on-chain deposit address to user
3. Poll `lnbits.checkBoltzSwap()` until `status === 'completed'`

**Boltz reverse (LN → on-chain):**
1. Call `lnbits.createBoltzSwap({ type: 'reverse', onchainAddress, ... })`
2. Pay the Boltz-provided Lightning invoice from LNbits wallet
3. Poll until on-chain transaction confirms

```typescript
const result = await swapEngine.executeSwap({
  type: 'lightning_to_cashu',
  amountSats: 50_000,
  destinationMint: 'https://mint.example',
});

if (result.success) {
  console.log(`Received: ${result.amountReceived} sats`);
}
```

---

#### `getSwapHistory(): Promise<AtomicSwapResult[]>`

Retrieve past swap results from vault storage.

```typescript
const history = await swapEngine.getSwapHistory();
```

---

## Persistence

All scheduler data is persisted in the OPFS Vault:

| Path | Content |
|---|---|
| `payments/schedules.json` | Active and paused `ScheduledPayment` objects |
| `payments/cascade-templates.json` | Saved `PaymentCascade` templates |
| `payments/cascade-history.json` | `CascadeExecution` records |
| `payments/swap-history.json` | `AtomicSwapResult` records |

---

## Related

- [useScheduledPayments Hook](../hooks/use-scheduled-payments.md)
- [useCascade Hook](../hooks/use-cascade.md)
- [Push Payments Guide](../../user-guides/wallet/push-payments.md)
- [Payment Cascades Guide](../../user-guides/wallet/payment-cascades.md)
- [Atomic Swaps Guide](../../user-guides/wallet/atomic-swaps.md)
- [LNbits Library](./lnbits.md) — Used by the `lnbits` rail
