# NWC Connection Manager

**Module path:** `src/lib/nwc/`
**Type definitions:** `src/lib/nwc/types.ts`
**Specification:** NIP-47 (Nostr Wallet Connect)
**Import alias:** `@lib/nwc`

---

## Overview

The NWC Connection Manager is the Lightning payment layer in Satnam v2. All Lightning operations go through the NIP-47 protocol — there are no direct daemon API calls (no PhoenixD HTTP, no LNbits REST, no CLN RPC). NWC abstracts the wallet backend completely.

All NWC URIs are stored encrypted in the OPFS Vault. The `NwcConnection` type exposed to the rest of the application **never contains the connection secret** — the secret lives exclusively in the vault.

### Supported Wallet Backends

Any NIP-47 compliant wallet works without Satnam code changes:
- Alby Hub (self-hosted or cloud)
- PhoenixD (via NWC bridge)
- LND (via Alby or LNbits NWC extension)
- CLN (via NWC bridge)
- Mutiny Wallet (deprecated but functional)

---

## NIP-47 Kind Constants

```typescript
const NWC_REQUEST_KIND  = 23194; // Client → wallet request
const NWC_RESPONSE_KIND = 23195; // Wallet → client response
const NWC_INFO_KIND     = 13194; // Wallet capabilities announcement
```

---

## Type Definitions

### `NwcConnection`

Metadata for a stored NWC connection. The connection secret is absent — it lives in the vault.

```typescript
interface NwcConnection {
  id: string;                  // UUID — vault key for this connection
  label: string;               // Human-readable label, e.g. "Alby Hub"
  relayUrl: string;            // WSS relay URL extracted from NWC URI
  walletPubkey: string;        // Hex-encoded 32-byte secp256k1 wallet pubkey
  connectionSecret: '';        // Always empty — secret lives in vault
  createdAt: number;           // Unix timestamp
  isDefault: boolean;          // Whether this is the active connection
  lastKnownBalance?: bigint;   // Cached msats from last getBalance()
  lastBalanceUpdate?: number;  // Unix timestamp of last balance check
  supportedMethods?: string[]; // NIP-47 methods from info event
}
```

### `PaymentResult`

```typescript
interface PaymentResult {
  preimage: string;     // Hex-encoded payment preimage (proof of payment)
  paymentHash: string;  // SHA-256 of preimage (hex)
  feeMsats: bigint;     // Routing fees paid
  totalMsats: bigint;   // Total paid including fees
}
```

### `Transaction`

```typescript
interface Transaction {
  type: 'incoming' | 'outgoing';
  paymentHash: string;
  amountMsats: bigint;
  feeMsats?: bigint;         // Outgoing only
  description: string;
  createdAt: number;         // Unix timestamp
  settledAt?: number;        // Unix timestamp (if settled)
  bolt11?: string;           // Associated BOLT-11 invoice
  preimage?: string;         // Present for settled outgoing
}
```

### `InvoiceStatus`

```typescript
interface InvoiceStatus {
  paymentHash: string;
  bolt11: string;
  amountMsats: bigint;
  description: string;
  isPaid: boolean;
  paidAt?: number;     // Unix timestamp (if paid)
  expiresAt?: number;  // Unix timestamp
}
```

### `TxListOptions`

```typescript
interface TxListOptions {
  from?: number;    // Unix timestamp lower bound
  until?: number;   // Unix timestamp upper bound
  limit?: number;   // Max records
  offset?: number;  // Pagination offset
  type?: 'incoming' | 'outgoing';
  unpaid?: boolean; // Include only pending invoices
}
```

### `NwcError`

```typescript
interface NwcError {
  code: string;    // e.g. "INSUFFICIENT_BALANCE", "UNAUTHORIZED", "INVOICE_EXPIRED"
  message: string; // Human-readable description
}
```

---

## NwcConnectionManager API

```typescript
interface NwcConnectionManager {
  // Connection lifecycle
  addConnection(label: string, nwcUri: string): Promise<string>;         // Returns connectionId
  removeConnection(connectionId: string): Promise<void>;
  listConnections(): Promise<NwcConnection[]>;
  getDefaultConnection(): Promise<NwcConnection | null>;
  setDefaultConnection(connectionId: string): Promise<void>;

  // Operations — use default connection unless connectionId is provided
  payInvoice(bolt11: string, connectionId?: string): Promise<PaymentResult>;
  makeInvoice(
    amountMsats: bigint,
    description: string,
    connectionId?: string
  ): Promise<string>;                                                     // Returns BOLT-11 string
  getBalance(connectionId?: string): Promise<bigint>;                     // Returns msats
  lookupInvoice(paymentHash: string, connectionId?: string): Promise<InvoiceStatus>;
  listTransactions(options: TxListOptions, connectionId?: string): Promise<Transaction[]>;
}
```

---

## NWC URI Format and Parsing

The NWC URI format is defined by NIP-47:

```
nostr+walletconnect://<walletPubkeyHex>
  ?relay=<wsRelayUrl>
  &secret=<connectionSecretHex>
  [&lud16=<lightningAddress>]
```

**Example:**
```
nostr+walletconnect://3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d?relay=wss://relay.getalby.com/v1&secret=a1b2c3d4e5f6...
```

Parsing extracts:
- `walletPubkey` — hex pubkey from the URI authority component
- `relayUrl` — the `relay` query parameter (validated as a WSS URL)
- `connectionSecret` — the `secret` query parameter (stored in vault, never exposed in `NwcConnection`)

```typescript
import { parseNwcUri } from '@lib/nwc/parse';

const { walletPubkey, relayUrl, connectionSecret } = parseNwcUri(uri);
// connectionSecret is used immediately for vault storage, then discarded
```

---

## Connection Lifecycle

```
User pastes NWC URI
       │
       ▼
addConnection(label, uri)
  ├── parseNwcUri(uri) → { walletPubkey, relayUrl, secret }
  ├── vault.storeNwcUri(connectionId, uri)  ← secret goes to vault
  ├── Connect WebSocket to relayUrl
  ├── Subscribe to NWC_INFO_KIND (13194) to discover wallet capabilities
  └── Store NwcConnection (no secret) in React state

Connection is active
  ├── payInvoice()     → NWC_REQUEST_KIND (23194) → encrypted request
  ├── makeInvoice()    → NWC_REQUEST_KIND (23194) → encrypted request
  ├── getBalance()     → NWC_REQUEST_KIND (23194) → encrypted request
  └── (response on NWC_RESPONSE_KIND 23195, decrypted with connectionSecret)

removeConnection(connectionId)
  └── vault.deleteNwcUri(connectionId)
      └── WebSocket closed
```

All NWC request/response events are encrypted with **NIP-44** using the connection secret. The relay sees ciphertext only.

---

## Code Examples

### Add a Wallet Connection

```typescript
import { useNwc } from '@hooks/useNwc';

function WalletSetup() {
  const nwc = useNwc();

  async function connectWallet(uri: string) {
    try {
      const connectionId = await nwc.addConnection('My Alby Hub', uri);
      await nwc.setDefaultConnection(connectionId);
      console.log('Wallet connected:', connectionId);
    } catch (err) {
      console.error('Connection failed:', err);
    }
  }

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const uri = new FormData(e.currentTarget).get('uri') as string;
      connectWallet(uri);
    }}>
      <input name="uri" placeholder="nostr+walletconnect://..." />
      <button type="submit">Connect</button>
    </form>
  );
}
```

### Pay a BOLT-11 Invoice

```typescript
const nwc = useNwc();

async function pay(invoice: string) {
  const result = await nwc.payInvoice(invoice);
  console.log('Payment preimage:', result.preimage);
  console.log('Fees paid:', result.feeMsats, 'msats');
  console.log('Total paid:', result.totalMsats, 'msats');
}
```

### Generate a Receive Invoice

```typescript
const nwc = useNwc();

async function generateInvoice(sats: number, memo: string) {
  const amountMsats = BigInt(sats) * 1000n;
  const bolt11 = await nwc.makeInvoice(amountMsats, memo);
  // Display QR code with bolt11
  return bolt11;
}
```

### Check Balance

```typescript
const nwc = useNwc();

async function displayBalance() {
  const balanceMsats = await nwc.getBalance();
  const balanceSats = balanceMsats / 1000n;
  console.log(`Balance: ${balanceSats} sats`);
}
```

### Transaction History

```typescript
const nwc = useNwc();

async function recentTransactions() {
  const txs = await nwc.listTransactions({
    limit: 20,
    type: 'outgoing',
  });
  return txs.map(tx => ({
    amount: tx.amountMsats / 1000n,
    description: tx.description,
    date: new Date(tx.settledAt! * 1000),
  }));
}
```

---

## Supported NIP-47 Methods

| Method | Required | Description |
|---|---|---|
| `pay_invoice` | Yes | Pay a BOLT-11 invoice |
| `make_invoice` | Yes | Generate a BOLT-11 invoice for receiving |
| `get_balance` | Yes | Query wallet balance (msats) |
| `lookup_invoice` | Yes | Check invoice payment status |
| `list_transactions` | Yes | Transaction history with filters |
| `pay_keysend` | Optional | Keysend payment for zaps without invoice |
| `multi_pay_invoice` | Optional | Batch payment for NIP-90 split payments |

Wallet capability is discovered from the `NWC_INFO_KIND` event on connection. If a required method is absent, the UI disables the corresponding feature and prompts the user to upgrade their wallet.

---

## Amount Convention

All Lightning amounts in the NWC library use **`bigint` millisatoshis** to avoid floating-point precision loss. Conversion:

```typescript
// sats → msats
const msats = BigInt(sats) * 1000n;

// msats → sats (floor division)
const sats = msats / 1000n;

// Display with remainder (for sub-sat precision)
const wholeSats = msats / 1000n;
const remainderMsats = msats % 1000n;
```

---

## Related

- [useNwc hook](../hooks/use-nwc.md)
- [Vault library](./vault.md) — NWC URIs stored in vault
- [Cashu library](./cashu.md) — eCash alternative payment rail
- [Netlify Functions](../functions/README.md) — `nwc-proxy` function
