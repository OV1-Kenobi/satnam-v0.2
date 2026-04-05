# `useCascade`

React hook for creating, validating, and executing payment cascade trees.

**Source:** `src/hooks/useCascade.tsx`

---

## Import

```typescript
import { useCascade } from '@/hooks/useCascade';
```

---

## Usage

```tsx
function CascadePanel() {
  const {
    cascades,
    createCascade,
    executeCascade,
    validateCascade,
    executionHistory,
    isExecuting,
    error,
  } = useCascade();

  return (
    <div>
      {cascades.map(c => (
        <div key={c.id}>
          <h3>{c.label}</h3>
          <button onClick={() => executeCascade(c, 1_000_000_000n)}>
            Execute 1,000,000 sats
          </button>
        </div>
      ))}
    </div>
  );
}
```

---

## Return Value

### State Properties

| Property | Type | Description |
|---|---|---|
| `cascades` | `PaymentCascade[]` | Saved cascade templates |
| `executionHistory` | `CascadeExecution[]` | All past cascade executions |
| `isExecuting` | `boolean` | True while a cascade is in progress |
| `error` | `Error \| null` | Last error |

---

### `createCascade(config: Omit<PaymentCascade, 'id' | 'createdAt'>): Promise<PaymentCascade>`

Create and persist a new cascade template.

```typescript
const cascade = await createCascade({
  label: 'Revenue split',
  totalAmountMsats: 0n, // 0 = set at execution time
  mode: 'parallel',
  failurePolicy: 'skip',
  rootNodes: [
    {
      id: 'node-alice',
      recipientPubkey: 'npub1alice...',
      recipientLabel: 'Alice',
      percentage: 60,
      rail: 'lightning',
      children: [],
    },
    {
      id: 'node-bob',
      recipientPubkey: 'npub1bob...',
      recipientLabel: 'Bob',
      percentage: 40,
      rail: 'cashu',
      children: [
        {
          id: 'node-affiliate',
          recipientPubkey: 'npub1aff...',
          recipientLabel: 'Affiliate',
          percentage: 10, // 10% of Bob's 40% = 4% of total
          rail: 'auto',
          children: [],
        },
      ],
    },
  ],
});
```

---

### `executeCascade(cascade: PaymentCascade, totalAmount: bigint): Promise<CascadeExecution>`

Execute a cascade for a given total amount. Returns the full execution record including per-node results.

```typescript
const execution = await executeCascade(cascade, 500_000_000n);

console.log(`Distributed: ${execution.totalDistributed} msats`);
console.log(`Fees: ${execution.totalFees} msats`);

for (const [nodeId, result] of execution.nodeResults) {
  if (!result.success) {
    console.warn(`Node ${nodeId} failed: ${result.error}`);
  }
}
```

`isExecuting` is `true` while the cascade runs. You can render a per-node status indicator by subscribing to `executionHistory` and finding the most recent execution.

---

### `validateCascade(cascade: PaymentCascade): { valid: boolean; errors: string[] }`

Validate a cascade before saving or executing. Checks percentage sums, node field validity, and rail values.

```typescript
const { valid, errors } = validateCascade(cascade);
if (!valid) {
  errors.forEach(e => console.error(e));
}
```

**Common validation errors:**
- `"Root level percentages sum to 110% — must be ≤ 100%"`
- `"Node node-bob has both percentage and fixedAmountMsats set"`
- `"Node node-xyz has an invalid rail 'bitcoin'"`

---

## CascadeNode Structure

```typescript
interface CascadeNode {
  id: string;
  recipientPubkey: string;
  recipientLabel: string;         // human-readable display name
  recipientLud16?: string;        // Lightning address alternative
  percentage: number;             // 0–100; relative to parent amount
  fixedAmountMsats?: bigint;      // overrides percentage if set
  rail: PaymentRail;
  children: CascadeNode[];        // empty for leaf nodes
}
```

---

## Execution Status

During execution, you can track per-node status by watching `executionHistory`:

```tsx
function CascadeProgress({ cascadeId }: { cascadeId: string }) {
  const { executionHistory } = useCascade();

  const latest = executionHistory
    .filter(e => e.cascadeId === cascadeId)
    .at(-1);

  if (!latest) return null;

  return (
    <ul>
      {Array.from(latest.nodeResults.entries()).map(([nodeId, result]) => (
        <li key={nodeId}>
          {nodeId}: {result.success
            ? `✓ ${result.amountMsats / 1000n} sats`
            : `✗ ${result.error}`}
        </li>
      ))}
    </ul>
  );
}
```

---

## Full Example: Building and Executing a Team Split

```tsx
import { useState } from 'react';
import { useCascade } from '@/hooks/useCascade';
import type { CascadeNode, PaymentCascade } from '@/lib/payments';

function TeamSplitCascade() {
  const { createCascade, executeCascade, validateCascade, isExecuting } = useCascade();
  const [amountSats, setAmountSats] = useState(100_000);

  const buildTree = (): Omit<PaymentCascade, 'id' | 'createdAt'> => ({
    label: 'Team Q2 split',
    totalAmountMsats: BigInt(amountSats * 1000),
    mode: 'parallel',
    failurePolicy: 'skip',
    rootNodes: [
      {
        id: 'lead',
        recipientPubkey: 'npub1lead...',
        recipientLabel: 'Lead Dev',
        percentage: 45,
        rail: 'lightning',
        children: [],
      },
      {
        id: 'design',
        recipientPubkey: 'npub1design...',
        recipientLabel: 'Designer',
        percentage: 30,
        rail: 'lightning',
        children: [],
      },
      {
        id: 'ops',
        recipientPubkey: 'npub1ops...',
        recipientLabel: 'Operations',
        percentage: 25,
        rail: 'lnbits',
        children: [],
      },
    ],
  });

  const handleExecute = async () => {
    const config = buildTree();
    const { valid, errors } = validateCascade({ ...config, id: '', createdAt: 0 });
    if (!valid) {
      alert(errors.join('\n'));
      return;
    }

    const cascade = await createCascade(config);
    const result = await executeCascade(cascade, BigInt(amountSats * 1000));

    alert(`Distributed ${result.totalDistributed / 1000n} sats`);
  };

  return (
    <div>
      <input
        type="number"
        value={amountSats}
        onChange={e => setAmountSats(Number(e.target.value))}
      />
      <button onClick={handleExecute} disabled={isExecuting}>
        {isExecuting ? 'Distributing...' : 'Execute Team Split'}
      </button>
    </div>
  );
}
```

---

## Related

- [CascadeEngine API](../libraries/payments.md#cascadeengine) — Underlying engine
- [Payment Cascades Guide](../../user-guides/wallet/payment-cascades.md) — User documentation
- [Tutorial: Building Your First Payment Cascade](../../tutorials/payment-cascade.md)
- [useScheduledPayments](./use-scheduled-payments.md) — Schedule recurring cascades
