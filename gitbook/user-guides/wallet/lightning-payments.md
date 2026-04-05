# Lightning Payments

Satnam sends and receives Lightning payments through your connected NWC wallet. All operations use BOLT-11 invoices as the standard payment format.

> **Prerequisite:** You must have a connected NWC wallet. See [Connecting a Wallet](../getting-started/connecting-wallet.md).

---

## Sending a Payment (BOLT-11)

### Step 1: Obtain a BOLT-11 invoice

A BOLT-11 invoice is a bech32-encoded string beginning with `lnbc` (mainnet) or `lntb` (testnet). You receive one from:
- The merchant or person you are paying (they generate it in their wallet)
- A DVM provider's job result (the `amount` tag contains the invoice)
- Any Lightning-compatible app

### Step 2: Pay in Satnam

1. Navigate to **Wallet → Send**.
2. Paste the BOLT-11 invoice into the invoice field, or tap **Scan QR** to use your device camera.
3. Satnam decodes the invoice and displays:
   - Amount (in sats)
   - Description / memo
   - Expiry time
   - Destination pubkey (routing node)
4. Review the payment details. Verify the amount is what you expect.
5. Tap **Pay**.

### Step 3: Payment confirmation

Satnam sends the `pay_invoice` command to your NWC wallet. The wallet attempts to route the payment over the Lightning Network.

On success:
- A green confirmation screen appears with the payment preimage.
- The transaction appears in your history.

On failure:
- An error message describes the failure reason (e.g., "No route found", "Invoice expired", "Insufficient balance").
- No sats are deducted — Lightning payments are atomic: they either fully succeed or fully fail.

```
Satnam                    NWC Relay                  Your Wallet
   │                          │                          │
   │── pay_invoice (enc) ────►│── pay_invoice (enc) ────►│
   │                          │                          │── route payment ──►
   │                          │                          │◄── preimage ──────
   │◄── payment_response ────◄│◄── payment_response ────◄│
   │                          │                          │
```

---

## Receiving a Payment (Invoice Generation)

### Step 1: Create an invoice

1. Navigate to **Wallet → Receive**.
2. Enter the amount in sats (or leave blank for a variable-amount invoice).
3. Optionally add a description/memo.
4. Tap **Create Invoice**.

Satnam calls `make_invoice` on your NWC wallet. Your wallet generates the BOLT-11 string.

### Step 2: Share the invoice

The Receive screen shows:
- A **QR code** for mobile scanning.
- The **BOLT-11 string** for copy-paste.
- The **Lightning Address** (`yourname@satnam.pub`) — anyone can pay this directly without requesting an invoice.

Share the QR code or invoice string with the sender.

### Step 3: Payment notification

Satnam polls your NWC wallet for invoice status using `lookup_invoice`. When the invoice is paid:
- The Receive screen shows a green payment confirmation.
- The transaction appears in your history.
- If you are in the background or the app is closed, the service worker queues a check for when you next open the app.

> **Tip:** Invoices expire. The default expiry for most wallets is 1 hour. If the invoice expires unpaid, create a new one.

---

## Fee Considerations

Lightning payments incur routing fees paid to the intermediate nodes in the payment path. Fees vary based on:

- Payment amount (larger payments typically have higher absolute fees)
- Network conditions and available routes
- Your wallet's routing policy and preferred channels

Satnam displays the fee paid in the transaction history for completed payments. Before sending, your NWC wallet estimates the fee — this estimate appears in the payment confirmation screen (if your wallet supports fee estimation via the NWC method).

> **Note:** Satnam does not set or control routing fees. Fee policy is determined by your Lightning wallet's routing logic.

---

## Lightning Address Payments

Your registered NIP-05 name doubles as a Lightning Address (`yourname@satnam.pub`). Senders can pay this address from any Lightning wallet that supports LNURL-pay without you needing to generate an invoice first.

When someone pays your Lightning Address:
1. Their wallet calls the LNURL endpoint at `satnam.pub/.well-known/lnurlp/yourname`.
2. The Satnam `lightning_addresses` Supabase table returns your LNURL-pay callback (from your NWC wallet).
3. Their wallet fetches an invoice from your wallet via the callback.
4. Payment flows directly to your NWC wallet.

> **Tip:** Share your Lightning Address (`yourname@satnam.pub`) instead of individual invoices for recurring payments.

---

## Transaction History

The transaction history for Lightning is pulled from your NWC wallet using `list_transactions`. Each entry shows:

| Field | Description |
|---|---|
| Direction | Sent or Received |
| Amount | Sats paid or received |
| Fee | Routing fee paid (for sends) |
| Memo | Payment description or memo |
| Timestamp | When the payment was settled |
| Status | Settled, Pending, or Failed |
| Payment hash | BOLT-11 payment identifier |

You can tap any transaction to see the full payment hash and preimage.

---

## Related Pages

- [Wallet Overview](./README.md) — When to use Lightning vs. Cashu
- [Cashu eCash](./cashu-ecash.md) — Privacy-preserving micropayments
- [Connecting a Wallet](../getting-started/connecting-wallet.md) — NWC setup
