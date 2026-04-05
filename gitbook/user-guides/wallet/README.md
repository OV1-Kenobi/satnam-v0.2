# Wallet Overview

Satnam provides two payment rails: **Lightning Network** for standard sats payments, and **Cashu eCash** for privacy-preserving micropayments and agent commerce. Both are denominated exclusively in sats — no fiat, no altcoins.

---

## Two Rails, One Wallet Interface

```
┌──────────────────────────────────────────────────────────┐
│                   Satnam Wallet                           │
│                                                           │
│   Lightning (NWC)          Cashu (eCash)                  │
│   ─────────────────        ───────────────────────────    │
│   • Send (BOLT-11)         • Mint (LN → eCash)            │
│   • Receive (invoice)      • Send (token string)          │
│   • Transaction history    • Receive (token string)       │
│   • Balance (from NWC)     • Melt (eCash → LN)            │
│                            • Balance (by mint)            │
└──────────────────────────────────────────────────────────┘
```

Your Lightning balance lives in your connected wallet (Alby Hub, LND, etc.) and is accessed via NWC. Your Cashu balance lives in encrypted proof files in your [OPFS Vault](../../overview/architecture.md#opfs-vault-structure) — entirely on your device.

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

## When to Use Lightning vs. Cashu

| Situation | Recommended Rail | Reason |
|---|---|---|
| Paying a merchant BOLT-11 invoice | Lightning | Direct, standard, immediate settlement |
| Receiving a payment from anyone | Lightning | Universal compatibility |
| Sending a small payment to a contact | Lightning or Cashu | Either works; Cashu if privacy matters |
| Paying an agent for compute work | Cashu (preferred) or Lightning | Sub-sat routing is impractical on LN; Cashu is efficient for micropayments |
| Sig4Sats performance bond | Cashu | Bonds require bearer token semantics |
| You want maximum payment privacy | Cashu | Mint cannot link mint to melt operations |
| Payment is under 1 sat (1000 msats) | Cashu | Lightning routing is uneconomical at this size |
| You want on-chain settlement | Lightning → close channel | eCash requires eventual Lightning redemption |

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

## Related Pages

- [Connecting a Wallet](../getting-started/connecting-wallet.md) — Setting up your NWC connection
- [Lightning Payments](./lightning-payments.md) — Send and receive Lightning
- [Cashu eCash](./cashu-ecash.md) — Full eCash guide
- [Agent Wallets](../agents/creating-an-agent.md#setting-spend-policies) — Per-agent spend policy configuration
