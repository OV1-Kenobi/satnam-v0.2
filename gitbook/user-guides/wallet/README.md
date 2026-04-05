# Wallet Overview

Satnam provides three payment rails: **Lightning Network** via NWC for standard sats payments, **Cashu eCash** for privacy-preserving micropayments and agent commerce, and **LNbits** for advanced operations including on-chain↔Lightning atomic swaps. All rails are denominated exclusively in sats — no fiat, no altcoins.

---

## Three Rails, One Wallet Interface

```
┌──────────────────────────────────────────────────────────────────┐
│                       Satnam Wallet                               │
│                                                                   │
│  Lightning (NWC)    Cashu (eCash)       LNbits                    │
│  ───────────────    ─────────────────   ──────────────────────    │
│  • Send (BOLT-11)   • Mint (LN→eCash)  • Send (BOLT-11)          │
│  • Receive          • Send (token)      • Receive (invoice)       │
│  • Tx history       • Receive (token)  • Boltz atomic swaps       │
│  • Balance (NWC)    • Melt (eCash→LN)  • LNURL-pay forwarding     │
│                     • Balance by mint   • Extension ecosystem     │
└──────────────────────────────────────────────────────────────────┘
```

Your Lightning balance lives in your connected wallet (Alby Hub, LND, etc.) and is accessed via NWC. Your Cashu balance lives in encrypted proof files in your [OPFS Vault](../../overview/architecture.md#opfs-vault-structure) — entirely on your device. Your LNbits balance lives in your self-hosted or hosted LNbits instance, accessed via its REST API through the nwc-proxy function.

---

## Lightning Payments

Lightning is the primary payment rail for standard-size payments (typically 1 sat and above). All Lightning operations go through the NWC (Nostr Wallet Connect) connection you configured.

**Capabilities:**
- **Send:** Paste or scan a BOLT-11 invoice and pay it.
- **Receive:** Generate an invoice (with optional amount and memo) and share the QR code.
- **Transaction history:** View past sends and receives with timestamps, amounts, and fee data.
- **Balance:** Live balance query from your connected NWC wallet.

[Full Lightning guide →](./lightning-payments.md)

---

## Cashu eCash

Cashu tokens are blind-signed bearer instruments issued by Cashu mints. They offer stronger privacy than Lightning because the mint cannot link token issuance (minting) to redemption (melting) — a property called **Chaumian blindness**.

**Capabilities:**
- **Mint:** Convert Lightning sats into eCash tokens at a Cashu mint.
- **Send:** Package tokens into a serialized token string and share it (via message, QR, or clipboard).
- **Receive:** Paste a token string to claim the tokens into your vault.
- **Melt:** Convert eCash tokens back to Lightning by paying a BOLT-11 invoice.
- **Balance:** Total sats across all proofs, queryable by mint.

[Full Cashu guide →](./cashu-ecash.md)

---

## When to Use Lightning vs. Cashu vs. LNbits

| Situation | Recommended Rail | Reason |
|---|---|---|
| Paying a merchant BOLT-11 invoice | Lightning | Direct, standard, immediate settlement |
| Receiving a payment from anyone | Lightning | Universal compatibility |
| Sending a small payment to a contact | Lightning or Cashu | Either works; Cashu if privacy matters |
| Paying an agent for compute work | Cashu (preferred) or Lightning | Sub-sat routing is impractical on LN; Cashu is efficient for micropayments |
| Sig4Sats performance bond | Cashu | Bonds require bearer token semantics |
| You want maximum payment privacy | Cashu | Mint cannot link mint to melt operations |
| Payment is under 1 sat (1000 msats) | Cashu | Lightning routing is uneconomical at this size |
| You want on-chain settlement | LNbits (Boltz reverse swap) | Lightning → on-chain via Boltz submarine swap |
| You received on-chain BTC and want Lightning | LNbits (Boltz submarine swap) | On-chain → Lightning via Boltz |
| Scheduled / recurring payments | Lightning, Cashu, or LNbits | Use the push payment scheduler with any rail |
| Split a payment across multiple recipients | Any (cascade) | Payment cascades distribute across all rails |

> **Tip:** Satnam agents with `preferred_spend_rail: 'auto'` automatically choose Cashu for amounts under 1 sat and when high privacy is requested; otherwise they use Lightning.

---

## Transaction History

The Transaction History view in the Wallet section shows:

- **Lightning transactions:** Pulled from your NWC wallet via the `list_transactions` method. Each entry shows direction (send/receive), amount in sats, fees paid, timestamp, and memo.
- **Cashu operations:** Tracked locally — mint, melt, send, and receive events stored in the vault's proof records with timestamps.

Both streams are displayed together in a unified timeline, sorted by time.

---

## Wallet Security

- **Lightning:** Your NWC URI (the wallet control credential) is encrypted in OPFS. Satnam never holds your Lightning funds — they live in your self-custody wallet.
- **Cashu:** Proofs are bearer instruments. If your device is lost and you have no vault backup, your Cashu balance is unrecoverable. Export an encrypted vault backup regularly.

> **Warning:** Cashu proofs are like physical cash. There is no "forgot my wallet" recovery for proofs that exist only on your device. Use the vault backup export feature to protect your eCash balance.

---

## Advanced Payment Features

Satnam v2 adds a full suite of advanced payment capabilities on top of the three rails:

### Push Payments (Scheduled & Recurring)

Automate outbound payments on any interval — hourly, daily, weekly, biweekly, or monthly. Attach conditions (balance threshold, time window, approval required) to gate execution.

[Push Payments Guide →](./push-payments.md)

### Payment Cascades

Split a single payment into a tree of sub-payments. Single-tier percentage splits or multi-tier recursive trees. Visual builder with live validation and template saving.

[Payment Cascades Guide →](./payment-cascades.md)

### Atomic Swaps

Move value between rails without trusting an intermediary: Cashu↔Cashu (cross-mint), Cashu↔Lightning, and on-chain↔Lightning via Boltz. Each swap tracks every step and attempts automatic rollback on failure.

[Atomic Swaps Guide →](./atomic-swaps.md)

### LNbits Integration

Connect a self-hosted or hosted LNbits instance as a third payment rail. Enables Boltz swaps, LNURL-pay forwarding, and multi-wallet administration. All API keys stored encrypted in the OPFS Vault.

[LNbits Integration Guide →](./lnbits-integration.md)

### Sig4Sats Bonds

Three cryptographic bond types backed by Cashu and adaptor signatures:
- **Entitlement bonds** — pay Cashu, receive a blinded capability token for premium features
- **Recovery bonds** — Guardians stake economic collateral for recovery approvals (N-of-M)
- **Allowance bonds** — Guardians fund offspring spending with constrained blinded tokens

[Sig4Sats Bonds Guide →](./sig4sats-bonds.md)

---

## Related Pages

- [Connecting a Wallet](../getting-started/connecting-wallet.md) — Setting up your NWC connection
- [Lightning Payments](./lightning-payments.md) — Send and receive Lightning
- [Cashu eCash](./cashu-ecash.md) — Full eCash guide
- [LNbits Integration](./lnbits-integration.md) — Third payment rail setup
- [Push Payments](./push-payments.md) — Scheduled and recurring payments
- [Payment Cascades](./payment-cascades.md) — Split payment trees
- [Atomic Swaps](./atomic-swaps.md) — Cross-rail swaps
- [Sig4Sats Bonds](./sig4sats-bonds.md) — Entitlement, recovery, and allowance bonds
- [Agent Wallets](../agents/creating-an-agent.md#setting-spend-policies) — Per-agent spend policy configuration
