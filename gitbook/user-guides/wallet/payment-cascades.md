# Payment Cascades

A payment cascade is a distribution tree that splits a single incoming amount across multiple recipients — automatically, proportionally, and in one operation. You define who gets what percentage (or fixed amount) at each tier, and the `CascadeEngine` walks the tree and executes each leaf payment on the correct rail.

---

## What Is a Cascade?

Imagine you receive 100,000 sats from a client. Rather than manually sending 60,000 to yourself, 25,000 to your business partner, and 15,000 to an affiliate, you trigger a cascade: one action, three payments, all tracked together.

Cascades can be single-tier (flat splits) or multi-tier (recursive trees where each recipient can themselves have sub-recipients). The engine validates that percentages at each level sum to ≤ 100% — the remainder (if any) stays with you.

---

## Cascade Modes

| Mode | Behavior |
|---|---|
| `sequential` | Execute root nodes in order, then their children. Stops on failure if `failurePolicy` is `stop`. |
| `parallel` | Execute all nodes at the same level simultaneously. Faster; all-or-nothing behavior depends on `failurePolicy`. |

---

## Failure Policies

| Policy | Behavior on Node Failure |
|---|---|
| `stop` | Halt the cascade immediately. No further payments execute. |
| `skip` | Skip the failed node and continue with siblings and children. |
| `retry` | Retry the failed node once before continuing. |

---

## Node Configuration

Each node in the cascade tree has:

| Field | Description |
|---|---|
| Recipient | A Nostr pubkey or LNURL-pay address |
| Percentage | Share of the parent node's amount (0–100) |
| Fixed Amount | Optional: override percentage with an exact msats figure |
| Rail | Lightning, Cashu, LNbits, or Auto |
| Children | Sub-nodes that receive a share of this node's amount |

If a node has children, those children split the node's received amount — not the top-level total. This enables recursive treasury structures.

---

## Building a Cascade

### Via the CascadeBuilder UI

1. Open **Wallet → Cascades → New Cascade**.
2. Enter a **Label** (e.g., "Revenue split — Q2").
3. Set the **Total Amount** or leave it blank to enter the amount at execution time.
4. Choose **Mode** (sequential or parallel) and **Failure Policy**.
5. Add root nodes:
   - Click **Add Recipient**
   - Pick the recipient (npub or Lightning address)
   - Set the percentage (e.g., 60%)
   - Choose the rail
6. To add a sub-level, click **Add Child** on any existing node and repeat.
7. The builder displays a live **validation status** — a warning appears if any level's percentages exceed 100%.
8. Click **Preview** to see how a sample amount (e.g., 100,000 sats) would distribute.
9. Click **Save as Template** to reuse this cascade.

### Via the Developer API

```typescript
import { CascadeEngine } from '@/lib/payments';

const cascade = await engine.createCascade({
  label: 'Revenue split',
  totalAmountMsats: 100_000_000n,
  mode: 'parallel',
  failurePolicy: 'skip',
  rootNodes: [
    {
      id: 'node-1',
      recipientPubkey: 'npub1...',
      recipientLabel: 'Alice',
      percentage: 60,
      rail: 'lightning',
      children: [],
    },
    {
      id: 'node-2',
      recipientPubkey: 'npub2...',
      recipientLabel: 'Bob',
      percentage: 25,
      rail: 'cashu',
      children: [
        {
          id: 'node-2-1',
          recipientPubkey: 'npub3...',
          recipientLabel: 'Affiliate',
          percentage: 20, // 20% of Bob's 25% = 5% of total
          rail: 'auto',
          children: [],
        }
      ],
    },
  ],
});
```

---

## Single-Tier Cascades (Percentage Splits)

The simplest cascade is a flat list of recipients at one level:

```
100,000 sats total
├── Alice    60%  → 60,000 sats (Lightning)
├── Bob      25%  → 25,000 sats (Cashu)
└── Charlie  15%  → 15,000 sats (LNbits)
```

Percentages sum to 100%, so every sat is distributed.

---

## Multi-Tier Cascades (Recursive Trees)

Sub-recipients are expressed as children of a node. Each child's percentage applies to the parent's received amount:

```
100,000 sats total
├── Operations  50%  → 50,000 sats
│   ├── DevOps     40%  → 20,000 sats (Lightning)
│   └── SecOps     60%  → 30,000 sats (Lightning)
├── Treasury    30%  → 30,000 sats (Cashu)
└── Marketing   20%  → 20,000 sats
    ├── Ads        70%  → 14,000 sats (LNbits)
    └── Affiliate  30%  →  6,000 sats (Auto)
```

The engine validates each level independently: Operations' children must sum to ≤ 100%, and Marketing's children must sum to ≤ 100%.

---

## Executing a Cascade

### From the UI

1. Open **Wallet → Cascades**.
2. Select the cascade template.
3. Enter the amount (if not baked into the template).
4. Click **Execute**.
5. The cascade progress panel shows each node's status in real time — green (paid), red (failed), yellow (pending).

### From code

```typescript
const result = await engine.executeCascade(cascade, 100_000_000n);
console.log(`Distributed: ${result.totalDistributed} msats`);
console.log(`Fees: ${result.totalFees} msats`);
for (const [nodeId, res] of result.nodeResults) {
  console.log(`${nodeId}: ${res.success ? 'OK' : res.error}`);
}
```

---

## Templates

Save any cascade as a **template** to reuse it without rebuilding the tree. Templates are stored encrypted in your OPFS Vault. When executing a template:

- You can override the total amount at execution time.
- Node percentages and rails are preserved.
- Execution history is tracked separately per execution run.

---

## Cascade Execution History

Every execution is stored in the vault with:

- Start and completion timestamps
- Per-node result (success, amount sent, payment hash, error)
- Total sats distributed and total fees paid

You can browse history in **Wallet → Cascades → History**.

---

## Use Cases

### Team Payment Distribution

At the end of each sprint, distribute the client payment to team members proportionally:

```
Client payment: 500,000 sats
├── Lead Dev    45%  → 225,000 sats (Lightning)
├── Designer    25%  → 125,000 sats (Lightning)
├── QA          15%  →  75,000 sats (Lightning)
└── Overhead    15%  →  75,000 sats (LNbits)
```

### Treasury Allocation

Incoming revenue automatically splits across operational buckets:

```
Revenue: 1,000,000 sats
├── Operations  40%  → 400,000 sats (Cashu)
├── Reserve     35%  → 350,000 sats (Lightning cold)
└── Payroll     25%  → 250,000 sats
    ├── Alice   60%  → 150,000 sats
    └── Bob     40%  → 100,000 sats
```

### Affiliate Splits

Marketplace sale with automatic affiliate commission:

```
Sale: 100,000 sats
├── Platform fee   10%  →  10,000 sats (LNbits)
├── Affiliate      15%  →  15,000 sats (Lightning)
└── Seller         75%  →  75,000 sats (Cashu)
```

---

## Validation Rules

- Percentages at each level must sum to **≤ 100%**. Sums over 100% are rejected at save time.
- A node can have either a `percentage` or a `fixedAmountMsats` — not both.
- Fixed amounts are deducted from the parent's amount first, then percentages apply to the remainder.
- An empty `children` array is valid — it means the node is a leaf (no further split).

---

## Related Pages

- [Push Payments](./push-payments.md) — Schedule recurring cascades automatically
- [LNbits Integration](./lnbits-integration.md) — Using the LNbits rail in cascades
- [useCascade Hook](../../developer-reference/hooks/use-cascade.md) — Developer API
- [CascadeEngine API](../../developer-reference/libraries/payments.md#cascadeengine) — Library reference
- [Tutorial: Building Your First Payment Cascade](../../tutorials/payment-cascade.md)
