# Atomic Swaps

Atomic swaps let you move value between payment rails — Cashu mint to Cashu mint, Lightning to on-chain Bitcoin, on-chain to Lightning — without trusting an intermediary and without the risk of partial completion. If any step fails mid-swap, the engine attempts automatic rollback to recover your funds.

---

## Swap Types

Satnam supports five swap types:

| Type | Description | Use When |
|---|---|---|
| `cashu_to_cashu` | Cross-mint swap via Lightning intermediary | You hold proofs at Mint A but need them at Mint B |
| `cashu_to_lightning` | Melt eCash at a mint, receive on Lightning | Converting your eCash balance to Lightning sats |
| `lightning_to_cashu` | Pay Lightning invoice, mint eCash at destination | Converting Lightning balance to private eCash |
| `onchain_to_lightning` | Boltz submarine swap (on-chain → LN) | Receiving on-chain Bitcoin, want Lightning balance |
| `lightning_to_onchain` | Boltz reverse swap (LN → on-chain) | Receiving Lightning payment, want on-chain settlement |

---

## Cross-Mint Cashu Swaps

When you have Cashu proofs at one mint and need them at another, the engine performs a three-step operation:

1. **Melt** — Redeem your proofs at the source mint. The mint pays out a Lightning invoice.
2. **Route** — The Lightning payment travels from the source mint to the destination mint's Lightning node.
3. **Mint** — The destination mint issues fresh proofs for the received amount.

This is "atomic" in the sense that:
- If the melt fails, nothing happens — your proofs remain at the source.
- If the Lightning routing fails, the melt is reversed (the invoice expires without payment).
- If the remint fails after successful routing, the engine retries using the Lightning payment preimage as proof of payment.

### Executing a Cross-Mint Swap

1. Open **Wallet → Swaps**.
2. Under **Source**, select **Cashu** and pick the source mint.
3. Under **Destination**, select **Cashu** and pick the destination mint.
4. Enter the amount in sats.
5. Click **Get Quote** to see estimated fees.
6. Review and click **Execute Swap**.
7. The progress panel shows each step: Melt → Route → Mint.

---

## Cashu ↔ Lightning Swaps

### Cashu to Lightning

Convert your eCash balance to Lightning sats (routable to any Lightning wallet):

1. Source: **Cashu** (select mint)
2. Destination: **Lightning** (your NWC wallet)
3. Enter amount → Get Quote → Execute

The mint melts your proofs and pays a Lightning invoice routed to your NWC wallet.

### Lightning to Cashu

Convert Lightning sats to eCash at your preferred mint for privacy:

1. Source: **Lightning** (your NWC wallet)
2. Destination: **Cashu** (select mint)
3. Enter amount → Get Quote → Execute

Your NWC wallet pays the mint's Lightning invoice; the mint issues fresh proofs to your vault.

---

## Boltz On-Chain ↔ Lightning Swaps

Boltz swaps require your LNbits instance with the [Boltz extension](./lnbits-integration.md#boltz-extension) active. Satnam uses the LNbits Boltz extension as the swap backend.

### Submarine Swap (On-Chain → Lightning)

Move on-chain Bitcoin into your Lightning balance:

1. Source: **On-Chain Bitcoin**
2. Destination: **Lightning**
3. Enter amount → Get Quote → Execute
4. Satnam displays the on-chain Bitcoin address to send to.
5. Once your on-chain transaction confirms, Boltz atomically settles the Lightning-side payment.
6. Your LNbits Lightning balance increases.

**Typical fees:** 0.1–0.5% Boltz service fee + on-chain miner fee for the claim transaction.

### Reverse Swap (Lightning → On-Chain)

Move Lightning balance to an on-chain Bitcoin address:

1. Source: **Lightning**
2. Destination: **On-Chain Bitcoin** (enter your destination address)
3. Enter amount → Get Quote → Execute
4. Your LNbits wallet pays the Lightning invoice.
5. Boltz broadcasts an on-chain transaction to your address.

**Typical fees:** 0.5–1% Boltz service fee + on-chain miner fee for settlement.

---

## Fee Estimation

Before executing any swap, click **Get Quote** to see a fee breakdown:

| Fee Component | Description |
|---|---|
| Source fee | Cashu mint melt fee or Lightning routing reserve |
| Lightning fee | Routing fee for the intermediate LN payment |
| Destination fee | Cashu mint fee for issuing new proofs |
| Total fee | Sum of all components |
| Estimated receive | Amount you will receive after fees |

Quotes expire after 60 seconds. If the quote expires, click **Refresh Quote** before executing.

---

## Swap Progress Tracking

Every swap is tracked step by step with statuses:

```
● Melt proofs at source mint    [completed]
● Route Lightning payment       [completed]
● Mint proofs at destination    [in progress...]
```

Each step records:
- Step description
- Status (pending / completed / failed)
- Transaction ID (payment hash, txid, or proof ID)
- Timestamp

---

## Swap History

All completed (and failed) swaps are stored in your OPFS Vault. Browse history at **Wallet → Swaps → History**. Each entry shows:

- Swap type and direction
- Amounts sent and received
- Total fees paid
- Each step's result
- Final status (completed / failed / refunded)

---

## Rollback on Failure

If a swap fails mid-execution, the engine attempts automatic recovery:

- **Melt failure:** No action needed — your source proofs are untouched.
- **Routing failure:** The invoice expires; source proofs are automatically un-reserved.
- **Remint failure after successful routing:** The engine retries using the payment preimage. If retries fail, you will see a **Manual Recovery** option in the Swap History that guides you through claiming proofs manually using the preimage.

> **Note:** Boltz swaps have their own refund mechanism. If a submarine swap times out without the Lightning side settling, Boltz provides a refund transaction. Satnam surfaces this automatically in the swap history.

---

## When to Use Each Swap Type

| Situation | Swap Type |
|---|---|
| Agent has proofs at Mint A, needs them at Mint B | `cashu_to_cashu` |
| You want maximum payment privacy | `lightning_to_cashu` |
| You received eCash and want to pay a Lightning invoice | `cashu_to_lightning` |
| You received on-chain BTC and want Lightning liquidity | `onchain_to_lightning` |
| You want to settle off Lightning to cold storage | `lightning_to_onchain` |

---

## Related Pages

- [LNbits Integration](./lnbits-integration.md) — Required for Boltz swaps
- [Cashu eCash](./cashu-ecash.md) — Cashu proof management
- [Lightning Payments](./lightning-payments.md) — NWC Lightning operations
- [AtomicSwapEngine API](../../developer-reference/libraries/payments.md#atomicswapengine) — Library reference
