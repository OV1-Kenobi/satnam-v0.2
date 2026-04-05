# Cashu eCash

Cashu is a privacy-preserving eCash protocol built on blind Chaumian signatures. Tokens are bearer instruments denominated in sats — whoever holds the tokens can spend them. The mint that issues tokens cannot link issuance to redemption, making Cashu strongly private by design.

---

## What Is Cashu?

Cashu tokens are like digital cash: they represent value, they are transferable without revealing your identity, and they settle without an on-chain transaction for each transfer. Here is how the basic flow works:

```
You ──(Lightning payment)──► Cashu Mint ──(blind signatures)──► Tokens (in your Vault)
                                │
                                │  (Mint cannot link these operations)
                                │
Tokens (in your Vault) ──► Cashu Mint ──(Lightning payment)──► Payee
```

**Key properties:**
- Tokens are stored as encrypted proof files in your [OPFS Vault](../../overview/architecture.md#opfs-vault-structure) — not on any server.
- Tokens are bearer instruments: if someone obtains your token string, they can claim the value. Guard them accordingly.
- The mint knows the total circulating supply but cannot tell who holds specific tokens.

---

## Minting Tokens (Lightning → eCash)

Minting converts Lightning sats into Cashu tokens held in your vault.

1. Navigate to **Wallet → Cashu → Mint**.
2. Select the Cashu mint to use (from your configured mint list).
3. Enter the amount in sats.
4. Tap **Mint Tokens**.

Satnam:
1. Calls `make_invoice` on your NWC wallet to generate a Lightning invoice.
2. Displays the invoice — the mint requests this payment.
3. Pays the invoice automatically from your NWC wallet (or you pay it from another wallet).
4. The mint verifies payment and issues blind-signed tokens.
5. Tokens are stored as proof files in your OPFS Vault: `cashu/{mint_url_hash}.proofs`.

> **Note:** Minting is a two-step process: pay the Lightning invoice, receive the tokens. If the invoice expires before payment, the mint operation fails cleanly — no sats are lost.

---

## Sending Tokens to Another User

Cashu tokens are transferred as a serialized token string — a base64-encoded blob that represents the value.

1. Navigate to **Wallet → Cashu → Send**.
2. Select the source mint and enter the amount.
3. Tap **Create Token**.

Satnam selects appropriate proofs from your vault and packages them into a serialized token string (the `cashuA...` format).

4. Share the token string with the recipient via:
   - Clipboard (copy and paste into a message)
   - QR code
   - NIP-17 encrypted direct message (the most private option)

> **Warning:** Once you create a send token, those proofs are marked as pending in your vault. If the recipient never claims the token, you can reclaim the proofs by re-importing the token into your own wallet.

---

## Receiving Tokens

To receive Cashu tokens from someone, you need to claim the token string into your vault.

1. Navigate to **Wallet → Cashu → Receive**.
2. Paste the `cashuA...` token string, or scan the QR code.
3. Tap **Claim Tokens**.

Satnam:
1. Parses the token and identifies the mint.
2. Calls the mint's `swap` endpoint to exchange the received proofs for fresh proofs (this prevents double-spend detection by the original sender).
3. Stores the new proofs in your OPFS Vault.

Your Cashu balance updates immediately.

> **Tip:** Always swap received tokens immediately (Satnam does this automatically). Holding unswapped proofs risks the sender being able to observe that you have not claimed them.

---

## Melting Tokens (eCash → Lightning)

Melting converts Cashu tokens back to Lightning sats by paying a BOLT-11 invoice.

1. Navigate to **Wallet → Cashu → Melt**.
2. Paste the BOLT-11 invoice you want to pay, or enter a Lightning Address.
3. Satnam displays the invoice amount and the estimated Cashu fee (mints charge a small fee for melting).
4. Tap **Melt & Pay**.

Satnam sends the proofs to the mint, which pays the Lightning invoice on your behalf and burns the proofs.

> **Note:** Melting fees are typically 0–1% depending on the mint. The fee comes out of your Cashu balance — you are not charged from your Lightning wallet.

---

## Privacy Benefits

Cashu provides significantly stronger privacy than Lightning for certain payment patterns:

| Property | Lightning | Cashu |
|---|---|---|
| Payment graph visible to routing nodes | Yes (to intermediate nodes) | No |
| Sender/receiver linkability | Partial (via invoice metadata) | No (blind signatures) |
| Mint can link sender to receiver | N/A | No (Chaumian blindness) |
| Proof of payment to third parties | Yes (preimage) | No |
| Works without revealing identity | No (pubkey routing) | Yes |

Satnam uses Cashu as the preferred rail when:
- High privacy is requested by a user or agent
- Payment amounts are under 1 sat (1000 msats), where Lightning routing is uneconomical
- Sig4Sats performance bonds are required (bearer token semantics)
- Agent-to-agent micropayments where routing overhead would exceed value

---

## Mint Management

### Adding a Mint

1. Go to **Wallet → Cashu → Mints**.
2. Tap **Add Mint**.
3. Enter the mint URL (e.g., `https://mint.example.com`).
4. Satnam fetches the mint's info and displays its supported denominations and keyset.
5. Tap **Add** to confirm.

### Removing a Mint

Before removing a mint, melt all proofs from that mint — once removed, proofs from that mint URL cannot be redeemed through Satnam unless you re-add the mint.

### Group-Allowed Mints

If you are in a group, the Guardian can configure a policy list of allowed Cashu mints. Only mints on this list are available for group-authorized spending. Personal mints are not restricted by group policy.

### Mint Trust

> **Warning:** The Cashu mint is a custodian of in-flight value. During the melt operation, the mint holds your proofs while routing the Lightning payment. Select mints operated by the group itself, by OpenAgents, or by well-known operators. Avoid unknown mints with no track record.

---

## Balance and Proof Management

Your Cashu balance is the sum of all valid proofs in your vault across all configured mints. The wallet dashboard shows:
- Total Cashu balance (aggregate, in sats)
- Per-mint balance breakdown
- Proof count and estimated storage size

### Consolidating Proofs

Over time, you may accumulate many small proofs. Satnam can consolidate these with a **swap** operation — sending small proofs to the mint and receiving a single larger proof. Access this via **Wallet → Cashu → Consolidate**.

---

## Related Pages

- [Wallet Overview](./README.md) — When to use Lightning vs. Cashu
- [Lightning Payments](./lightning-payments.md) — Standard Lightning send/receive
- [Credit Envelopes](../marketplace/credit-envelopes.md) — How Cashu is used in Sig4Sats bonds
- [Agent Wallets](../agents/creating-an-agent.md#setting-spend-policies) — Per-agent Cashu mint configuration
