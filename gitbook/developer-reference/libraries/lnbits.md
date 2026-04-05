# LNbits Library (`src/lib/lnbits/`)

The LNbits library provides a typed REST client for interacting with a self-hosted or hosted LNbits instance. It implements the proxy pattern required for browser contexts (routing through the `nwc-proxy` Netlify function) while supporting direct calls from agent/server contexts.

---

## Installation and Import

```typescript
import { LNbitsClient } from '@/lib/lnbits';
import type { LNbitsConfig, LNbitsWallet, LNbitsPayment, BoltzSwapRequest, BoltzSwapStatus } from '@/lib/lnbits';
```

---

## Types

### `LNbitsConfig`

Configuration object used to initialize the client.

```typescript
interface LNbitsConfig {
  /** LNbits instance URL (user's self-hosted or hosted) */
  instanceUrl: string;
  /** Admin key — stored in OPFS Vault at lnbits/{instance_hash}.admin */
  adminKey?: string;
  /** Invoice/Read key */
  invoiceKey?: string;
}
```

### `LNbitsWallet`

Represents a single LNbits wallet.

```typescript
interface LNbitsWallet {
  id: string;
  name: string;
  balance: number; // msats
  adminkey: string;
  inkey: string;
}
```

### `LNbitsPayment`

Represents a single payment record.

```typescript
interface LNbitsPayment {
  paymentHash: string;
  bolt11: string;
  amount: number;    // msats, negative for outgoing
  fee: number;       // msats
  memo: string;
  time: number;      // Unix timestamp
  pending: boolean;
}
```

### `LNbitsExtension`

Represents an installed extension in LNbits.

```typescript
interface LNbitsExtension {
  id: string;
  name: string;
  isInstalled: boolean;
  isActive: boolean;
}
```

### `BoltzSwapRequest`

Request object for initiating a Boltz swap via the LNbits Boltz extension.

```typescript
interface BoltzSwapRequest {
  type: 'submarine' | 'reverse';
  /** submarine: on-chain → LN; reverse: LN → on-chain */
  amountSats: number;
  onchainAddress?: string; // required for reverse swaps
  invoice?: string;        // required for submarine swaps
}
```

### `BoltzSwapStatus`

Status of an active or completed Boltz swap.

```typescript
interface BoltzSwapStatus {
  id: string;
  status: 'created' | 'pending' | 'completed' | 'failed' | 'refunded';
  amountSats: number;
  feeSats: number;
  type: 'submarine' | 'reverse';
  createdAt: number;
}
```

### `LNURLPayConfig`

Configuration for a LNURL-pay endpoint.

```typescript
interface LNURLPayConfig {
  description: string;
  minSats: number;
  maxSats: number;
  callback: string; // LNURL callback URL
}
```

---

## `LNbitsClient`

The main client class. Instantiate with a config object.

```typescript
import { LNbitsClient } from '@/lib/lnbits';

const client = new LNbitsClient({
  instanceUrl: 'https://lnbits.yourdomain.com',
  adminKey: 'your-admin-key', // read from OPFS Vault
});
```

### Proxy Pattern

In browser contexts, the client automatically routes all requests through the `nwc-proxy` Netlify function to avoid CORS restrictions. The function is detected by checking whether `window` is defined.

```
Browser:  LNbitsClient → /.netlify/functions/nwc-proxy → LNbits REST API
Agent:    LNbitsClient → LNbits REST API (direct)
```

The Admin Key is encrypted in the vault payload on each proxied request and discarded immediately after forwarding. It is never stored in the proxy function.

---

## Methods

### `getWalletDetails(): Promise<LNbitsWallet>`

Fetch current wallet details including balance.

```typescript
const wallet = await client.getWalletDetails();
console.log(`Balance: ${wallet.balance / 1000} sats`);
```

---

### `createInvoice(amount: number, memo: string): Promise<string>`

Create a BOLT-11 invoice. `amount` is in sats. Returns the BOLT-11 string.

```typescript
const bolt11 = await client.createInvoice(10_000, 'Payment for services');
```

---

### `payInvoice(bolt11: string): Promise<LNbitsPayment>`

Pay a BOLT-11 invoice from the LNbits wallet. Returns the payment record on success.

```typescript
const payment = await client.payInvoice('lnbc10n...');
console.log(`Payment hash: ${payment.paymentHash}`);
```

**Throws** if the payment fails (insufficient balance, routing failure).

---

### `getPayments(limit?: number, offset?: number): Promise<LNbitsPayment[]>`

Fetch the payment history. Defaults to the 20 most recent payments.

```typescript
const payments = await client.getPayments(50, 0);
```

---

### `checkPayment(paymentHash: string): Promise<LNbitsPayment>`

Fetch the status of a specific payment by its hash. Useful for polling pending payments.

```typescript
const payment = await client.checkPayment('abc123...');
if (!payment.pending) {
  console.log('Payment settled');
}
```

---

### `createLnurlPay(username: string): Promise<LNURLPayConfig>`

Set up a LNURL-pay endpoint routing through LNbits. Returns the LNURL-pay configuration.

```typescript
const lnurl = await client.createLnurlPay('alice');
console.log(`LNURL callback: ${lnurl.callback}`);
```

Requires the LNURLp extension to be active in the LNbits instance.

---

### `createBoltzSwap(request: BoltzSwapRequest): Promise<BoltzSwapStatus>`

Initiate a Boltz atomic swap via the LNbits Boltz extension.

```typescript
// Reverse swap: Lightning → on-chain
const swap = await client.createBoltzSwap({
  type: 'reverse',
  amountSats: 100_000,
  onchainAddress: 'bc1q...',
});
console.log(`Swap ID: ${swap.id}, Status: ${swap.status}`);
```

**Throws** `BoltzExtensionNotActiveError` if the Boltz extension is not installed and active.

---

### `checkBoltzSwap(swapId: string): Promise<BoltzSwapStatus>`

Poll the status of an active Boltz swap.

```typescript
const status = await client.checkBoltzSwap(swap.id);
if (status.status === 'completed') {
  console.log('Swap complete');
}
```

---

### `listExtensions(): Promise<LNbitsExtension[]>`

List all extensions in the LNbits instance with their installed and active status.

```typescript
const extensions = await client.listExtensions();
const boltz = extensions.find(e => e.id === 'boltz');
console.log(`Boltz active: ${boltz?.isActive}`);
```

---

## Key Storage

Admin and Invoice keys are stored in the OPFS Vault under the path `lnbits/{instance_hash}.admin`. The instance hash is `SHA-256(instanceUrl).slice(0, 16)`.

```typescript
// Keys are stored and retrieved via the vault — never access directly
import { useVault } from '@/hooks/useVault';

const vault = useVault();
const config = await vault.read(`lnbits/${instanceHash}.admin`);
```

Keys are **never** stored in `localStorage`, session storage, or any other browser storage mechanism. See the [Vault library](./vault.md) for encryption details.

---

## Error Handling

| Error | Thrown When |
|---|---|
| `LNbitsConnectionError` | Cannot reach the LNbits instance |
| `LNbitsAuthError` | Admin Key is invalid or expired |
| `BoltzExtensionNotActiveError` | Boltz extension is not installed/active |
| `InsufficientBalanceError` | Payment amount exceeds wallet balance |
| `PaymentRoutingError` | Lightning routing failure from LNbits |

All errors extend `LNbitsError` with a `code` property for programmatic handling:

```typescript
try {
  await client.payInvoice(bolt11);
} catch (e) {
  if (e instanceof InsufficientBalanceError) {
    console.error('Not enough balance');
  }
}
```

---

## Barrel Exports (`src/lib/lnbits/index.ts`)

```typescript
export { LNbitsClient } from './client';
export type {
  LNbitsConfig,
  LNbitsWallet,
  LNbitsPayment,
  LNbitsExtension,
  BoltzSwapRequest,
  BoltzSwapStatus,
  LNURLPayConfig,
} from './types';
export {
  LNbitsError,
  LNbitsConnectionError,
  LNbitsAuthError,
  BoltzExtensionNotActiveError,
  InsufficientBalanceError,
  PaymentRoutingError,
} from './errors';
```

---

## Related

- [useLNbits Hook](../hooks/use-lnbits.md) — React hook wrapper
- [LNbits Integration Guide](../../user-guides/wallet/lnbits-integration.md) — User-facing setup
- [Atomic Swaps](../../user-guides/wallet/atomic-swaps.md) — Boltz swap UI
- [NWC Library](./nwc.md) — Complementary Lightning rail
