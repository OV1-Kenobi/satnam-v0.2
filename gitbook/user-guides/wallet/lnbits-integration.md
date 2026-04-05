# LNbits Integration

LNbits is a free, open-source Lightning wallet and accounts system you can self-host or use on a hosted instance. Satnam v2 treats LNbits as a **third payment rail** alongside NWC (Lightning) and Cashu (eCash). While NWC is the protocol-standard wallet connection, LNbits adds advanced features — notably the Boltz extension for on-chain ↔ Lightning atomic swaps and LNURL-pay forwarding.

---

## LNbits vs. NWC: Complementary Roles

| Capability | NWC | LNbits |
|---|---|---|
| Send Lightning payment | ✓ | ✓ |
| Receive Lightning payment | ✓ | ✓ |
| Protocol-standard (NIP-47) | ✓ | — |
| Boltz atomic swaps | — | ✓ |
| LNURL-pay forwarding | Via Lightning Address | ✓ (configurable) |
| Multiple sub-wallets | — | ✓ |
| Extension ecosystem | — | ✓ |
| Used by payment scheduler | ✓ | ✓ (lnbits rail) |

> **Recommendation:** Use NWC as your primary payment rail for standard Lightning operations. Add LNbits when you need Boltz swaps, advanced LNURL routing, or multi-wallet administration.

---

## Prerequisites

You need a running LNbits instance. Options:

- **Self-hosted:** [LNbits installation guide](https://github.com/lnbits/lnbits) — runs on any server with Python.
- **Hosted:** [lnbits.com](https://lnbits.com) — cloud-hosted with no self-hosting required.
- **Alby Hub:** Alby Hub exposes an LNbits-compatible API via its NWC extension.

---

## Connecting Your LNbits Instance

1. Open **Wallet → Settings → Add Payment Rail → LNbits**.
2. Enter your **Instance URL** (e.g., `https://lnbits.yourdomain.com`).
3. Enter your **Admin Key** (found in LNbits under Wallet → API Info).
4. Optionally enter your **Invoice Key** (read-only; used for balance queries without write access).
5. Tap **Connect**.

Satnam verifies the connection by fetching wallet details from the LNbits API. On success, your LNbits wallet name and balance appear in the Wallet Overview under the LNbits rail.

### Key Storage

Your Admin Key and Invoice Key are stored encrypted in the OPFS Vault at `lnbits/{instance_hash}.admin`. They are never stored in `localStorage`, never sent to Satnam servers, and never logged.

---

## Proxy Architecture

Browser pages cannot call your LNbits instance directly due to CORS restrictions. All LNbits API calls from the browser are routed through the existing `nwc-proxy` Netlify function, which adds your encrypted credentials and forwards the request to your LNbits instance. Agent processes running server-side call the LNbits REST API directly.

```
Browser → nwc-proxy Netlify function → Your LNbits instance
Agent   →                              Your LNbits instance (direct)
```

The proxy function never stores your Admin Key — it reads the key from the encrypted vault payload attached to each request and discards it immediately after forwarding.

---

## Wallet Administration

Once connected, the LNbits rail section of **Wallet → Overview** shows:

- **Balance** — Real-time wallet balance in sats
- **Recent Payments** — Incoming and outgoing with payment hash, amount, memo, and timestamp
- **Payment State** — pending / completed status for each payment

### Creating an Invoice

1. Go to **Wallet → Receive → LNbits**.
2. Enter amount and memo.
3. Satnam calls `createInvoice()` via the LNbits API and displays the BOLT-11 QR code.

### Paying an Invoice

1. Go to **Wallet → Send → LNbits**.
2. Paste the BOLT-11 invoice.
3. Review amount and fees, then confirm.
4. Satnam calls `payInvoice()` and shows the payment hash on success.

---

## LNURL-Pay Forwarding

LNbits can host a LNURL-pay endpoint for your username, allowing anyone with a LNURL-compatible wallet to pay you by typing your address.

To set up:

1. In LNbits, create or confirm a wallet.
2. Enable the **LNURLp** extension in LNbits.
3. In Satnam, go to **Wallet → LNbits → LNURL Setup**.
4. Enter the desired username and configure min/max amounts.
5. Satnam calls `createLnurlPay()` which configures a LNURL-pay endpoint routing through your LNbits wallet.

---

## Boltz Extension

The Boltz extension enables on-chain ↔ Lightning atomic swaps directly from your LNbits wallet. See [Atomic Swaps](./atomic-swaps.md) for full swap instructions.

### Enabling Boltz in LNbits

1. In your LNbits admin panel, go to **Extensions**.
2. Find **Boltz** and click **Enable**.
3. Return to Satnam. The connection check will detect the active Boltz extension.

Satnam's [Atomic Swap panel](./atomic-swaps.md) will now show **Submarine Swap** and **Reverse Swap** options.

### Checking Extension Status

In **Wallet → LNbits → Extensions**, Satnam lists all installed LNbits extensions with their active/inactive status. If Boltz is not listed as active, swaps will be unavailable until you enable it in your LNbits admin.

---

## Using LNbits as a Payment Rail

Once connected, LNbits appears as a rail option in:

- **Push Payments** — Set `rail: 'lnbits'` to route scheduled payments through LNbits
- **Payment Cascades** — Individual cascade nodes can use the `lnbits` rail
- **Manual Send** — Choose LNbits as the source wallet when sending

---

## Multiple LNbits Instances

Satnam supports multiple LNbits connections simultaneously. Each instance is identified by a hash of its URL. You can add a second instance via **Wallet → Settings → Add Payment Rail → LNbits** and entering a different Instance URL.

When using the `lnbits` rail in a payment, Satnam uses whichever instance is marked as **default** in your wallet settings.

---

## Disconnecting LNbits

Go to **Wallet → Settings → Payment Rails → LNbits → Disconnect**. This removes the connection and deletes the stored keys from your OPFS Vault. It does not affect your LNbits instance or its funds.

---

## Troubleshooting

| Symptom | Likely Cause | Solution |
|---|---|---|
| "Connection failed" on setup | Wrong Instance URL or CORS issue | Confirm the URL is reachable; check LNbits is running |
| Balance shows 0 but LNbits has funds | Invoice Key has no balance read access | Re-enter the Admin Key instead |
| Boltz extension not detected | Extension disabled in LNbits | Enable Boltz in LNbits admin → Extensions |
| Payment proxy timeout | nwc-proxy function timeout (10s) | Check your LNbits instance latency; consider self-hosting closer to the Netlify edge |

---

## Related Pages

- [Atomic Swaps](./atomic-swaps.md) — Using Boltz via LNbits
- [Push Payments](./push-payments.md) — Scheduling payments on the LNbits rail
- [Payment Cascades](./payment-cascades.md) — LNbits rail in cascade nodes
- [LNbitsClient API](../../developer-reference/libraries/lnbits.md) — Developer reference
- [useLNbits Hook](../../developer-reference/hooks/use-lnbits.md) — React hook
