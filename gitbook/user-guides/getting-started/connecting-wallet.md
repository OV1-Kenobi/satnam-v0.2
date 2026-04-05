# Connecting a Wallet

Satnam is not a custodial wallet — it is a wallet *interface*. Your funds live in a Lightning wallet you own and control. Satnam connects to your wallet using NWC (Nostr Wallet Connect, NIP-47), a standardized protocol that lets Satnam request payments and generate invoices on your wallet's behalf without ever holding your funds.

---

## What Is NWC?

**Nostr Wallet Connect (NIP-47)** is an open protocol for controlling a Lightning wallet via Nostr events. It works as follows:

1. Your wallet generates a **NWC URI** — a connection string containing the relay URL, your wallet's public key, and a connection secret.
2. You paste this URI into Satnam.
3. Satnam uses the URI to send encrypted wallet commands (pay invoice, make invoice, get balance) to your wallet via a Nostr relay.
4. Your wallet executes the commands and returns the results.

The NWC URI is stored encrypted in your [OPFS Vault](../../overview/architecture.md#opfs-vault-structure) — it never touches any server.

```
Satnam (NWC Client)
        │
        │  Encrypted NIP-47 commands (via Nostr relay)
        ▼
  NWC Relay (Nostr)
        │
        ▼
  Your Wallet (NWC Server)
  (Alby Hub / PhoenixD / LND / CLN)
```

---

## Compatible Wallets

Any NIP-47 compliant Lightning wallet works with Satnam. The following wallets have been tested:

| Wallet | Type | NWC Support | Notes |
|---|---|---|---|
| **Alby Hub** | Self-hosted or cloud | Native | Recommended. Full NIP-47 method support including `multi_pay_invoice`. |
| **PhoenixD** | Self-hosted node | Via NWC bridge | Run PhoenixD locally; use Alby Hub or a NWC bridge to expose NWC. |
| **LND** | Self-hosted node | Via bridge (Alby, LNbits NWC extension) | Install the NWC extension on your LNbits instance, or use Alby Hub as a signer. |
| **CLN (Core Lightning)** | Self-hosted node | Via NWC bridge | Use the CLN NWC plugin or Alby Hub connected to CLN. |
| **Mutiny Wallet** | Self-custodial mobile | Native (deprecated) | Functional but Mutiny is sunset. Migrate to Alby Hub. |
| **Any NIP-47 wallet** | — | Native | If the wallet produces a `nostr+walletconnect://` URI, it will work. |

> **Tip:** If you do not have a Lightning wallet yet, [Alby Hub](https://albyhub.com) is the simplest path to self-custody. It can be self-hosted on a Raspberry Pi, a VPS, or run in Alby's managed cloud.

---

## Step-by-Step: Connecting via NWC URI

### Step 1: Generate a NWC URI from your wallet

**Alby Hub:**
1. Open your Alby Hub dashboard.
2. Go to **Connections → Add Connection**.
3. Name the connection (e.g., "Satnam").
4. Set spending limits (optional but recommended — e.g., 100,000 sats/day).
5. Click **Create Connection**. Copy the `nostr+walletconnect://...` URI.

**LNbits (NWC extension):**
1. Open LNbits → Extensions → Nostr Wallet Connect.
2. Create a new connection with a budget and expiry.
3. Copy the NWC URI from the QR code or text field.

**Other wallets:** Consult your wallet's documentation for "Nostr Wallet Connect" or "NWC". The URI always begins with `nostr+walletconnect://`.

### Step 2: Add the connection in Satnam

1. In Satnam, navigate to **Wallet → Manage Connections** (or click the wallet icon in the top navigation).
2. Click **Add Wallet**.
3. The NWC setup modal appears. Paste your NWC URI into the text field.
4. Enter a label for this connection (e.g., "My Alby Hub").
5. Click **Connect**.

Satnam will:
- Validate the URI format.
- Test the connection by calling `get_balance` on your wallet.
- Encrypt the URI and store it in your OPFS Vault under `nwc/{connectionId}.uri`.

### Step 3: Verify the connection

After connecting, you should see:
- Your wallet label in the Wallet section.
- Your current Lightning balance (in sats).
- A green status indicator showing the connection is active.

If the balance shows as unavailable or the status is red, see [Troubleshooting](#troubleshooting) below.

---

## Multiple Wallets

Satnam supports multiple NWC connections. You might have:
- A personal wallet for daily spending
- A group wallet for group expenses (via a shared NWC connection authorized by the group)
- An agent wallet for a specific AI agent

### Setting a Default Wallet

1. Go to **Wallet → Manage Connections**.
2. Next to the connection you want as default, click **Set as Default**.
3. The default wallet is used for all payment operations unless overridden.

### Wallet per Agent

When creating or editing an agent, you can assign a specific NWC connection as the agent's wallet. This keeps agent spending separate from personal spending and allows the agent's spend policy to be enforced independently.

---

## Supported NWC Methods

Satnam uses the following NWC methods:

| Method | Required | Used For |
|---|---|---|
| `get_balance` | Yes | Displaying wallet balance |
| `make_invoice` | Yes | Generating receive QR codes |
| `pay_invoice` | Yes | Sending Lightning payments |
| `lookup_invoice` | Yes | Checking payment status |
| `list_transactions` | Yes | Transaction history |
| `pay_keysend` | Optional | Keysend zaps without invoice |
| `multi_pay_invoice` | Optional | Batch payments for NIP-90 split payments |

If your wallet does not support `multi_pay_invoice`, batch payment operations will fall back to sequential individual payments.

---

## Troubleshooting

**Connection times out during test**

- Verify your wallet's NWC relay is reachable from your current network.
- Some routers block WebSocket connections — try a mobile data connection to test.
- Check that your wallet backend (Alby Hub, LND, etc.) is running and online.

**Balance shows as unavailable**

- The NWC URI may have expired. Regenerate a new URI from your wallet and update it in Satnam.
- Alby Hub connections can expire if you set an expiry date — check your connection settings.

**"Authorization failed" error**

- The NWC URI connection secret may have been rotated by your wallet. Re-generate and re-enter the URI.

**Payments fail but balance is visible**

- Check your wallet's outbound liquidity (for Lightning sends).
- Verify the spending limit on your NWC connection is sufficient for the payment amount.

---

## Security Notes

- Your NWC URI contains a connection secret. Anyone with your URI can control your wallet within the spending limits you set. Treat it like a private key.
- Satnam encrypts the URI in OPFS under your vault master key. It never leaves your device.
- The Satnam `nwc-proxy` serverless function handles NWC relay proxying — encrypted NWC payloads pass through it without being decrypted. The function authenticates you via NIP-98 before relaying.

---

## Related Pages

- [Lightning Payments](../wallet/lightning-payments.md) — Sending and receiving via BOLT-11
- [Cashu eCash](../wallet/cashu-ecash.md) — Mint, send, receive, and melt blind tokens
- [Wallet Overview](../wallet/README.md) — When to use Lightning vs. Cashu
- [OPFS Vault](../../overview/architecture.md#opfs-vault-structure) — How your NWC URI is stored and protected
