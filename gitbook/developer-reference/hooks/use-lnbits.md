# `useLNbits`

React hook for managing the LNbits payment rail. Provides wallet state, payment operations, and Boltz swap access in a single hook.

**Source:** `src/hooks/useLNbits.tsx`

---

## Import

```typescript
import { useLNbits } from '@/hooks/useLNbits';
```

---

## Usage

```tsx
function WalletPanel() {
  const {
    wallet,
    balance,
    payments,
    isConnected,
    isLoading,
    connect,
    createInvoice,
    payInvoice,
    boltzSwap,
    checkBoltzSwap,
    listExtensions,
    refresh,
    error,
  } = useLNbits();

  if (!isConnected) {
    return <button onClick={() => connect(config)}>Connect LNbits</button>;
  }

  return (
    <div>
      <p>Balance: {(balance ?? 0) / 1000} sats</p>
      <p>Wallet: {wallet?.name}</p>
    </div>
  );
}
```

---

## Return Value

### State Properties

| Property | Type | Description |
|---|---|---|
| `wallet` | `LNbitsWallet \| null` | Current wallet details; `null` if not connected |
| `balance` | `number \| null` | Wallet balance in msats; `null` if not connected |
| `payments` | `LNbitsPayment[]` | Recent payment history (default: last 20 payments) |
| `isConnected` | `boolean` | Whether a valid LNbits connection is active |
| `isLoading` | `boolean` | True during any async operation |
| `error` | `LNbitsError \| null` | Last error; `null` if no error |

---

### `connect(config: LNbitsConfig): Promise<void>`

Connect to an LNbits instance. Stores the config encrypted in the OPFS Vault and verifies the connection by fetching wallet details.

```typescript
await connect({
  instanceUrl: 'https://lnbits.yourdomain.com',
  adminKey: 'your-admin-key',
  invoiceKey: 'your-invoice-key', // optional
});
```

Throws `LNbitsConnectionError` if the instance is unreachable, or `LNbitsAuthError` if the key is invalid.

---

### `createInvoice(amount: number, memo: string): Promise<string>`

Create a BOLT-11 invoice from the LNbits wallet. Returns the invoice string.

```typescript
const invoice = await createInvoice(10_000, 'Service payment');
```

`amount` is in sats.

---

### `payInvoice(bolt11: string): Promise<LNbitsPayment>`

Pay a BOLT-11 invoice from the LNbits wallet. Returns the payment record on success.

```tsx
const handlePay = async () => {
  try {
    const payment = await payInvoice(bolt11Input);
    showSuccess(`Paid! Hash: ${payment.paymentHash}`);
  } catch (e) {
    showError(e.message);
  }
};
```

---

### `boltzSwap(request: BoltzSwapRequest): Promise<BoltzSwapStatus>`

Initiate a Boltz atomic swap via the LNbits Boltz extension.

```typescript
const swap = await boltzSwap({
  type: 'reverse',
  amountSats: 100_000,
  onchainAddress: 'bc1q...',
});
console.log(`Swap created: ${swap.id}`);
```

Throws `BoltzExtensionNotActiveError` if the Boltz extension is not active in your LNbits instance.

---

### `checkBoltzSwap(swapId: string): Promise<BoltzSwapStatus>`

Check the current status of a Boltz swap. Use with polling to monitor completion.

```typescript
// Poll every 10 seconds
const poll = setInterval(async () => {
  const status = await checkBoltzSwap(swap.id);
  if (status.status === 'completed') {
    clearInterval(poll);
    handleSwapComplete(status);
  }
}, 10_000);
```

---

### `listExtensions(): Promise<LNbitsExtension[]>`

List all installed LNbits extensions with their status.

```typescript
const extensions = await listExtensions();
const hasBoltz = extensions.some(e => e.id === 'boltz' && e.isActive);
```

---

### `refresh(): Promise<void>`

Manually refresh wallet details and payment history.

```typescript
<button onClick={refresh}>Refresh Balance</button>
```

The hook also auto-refreshes every 30 seconds when the component is mounted and `isConnected` is true.

---

## Full Example: LNbits Dashboard

```tsx
import { useLNbits } from '@/hooks/useLNbits';
import type { LNbitsConfig } from '@/lib/lnbits';

function LNbitsDashboard() {
  const {
    wallet,
    balance,
    payments,
    isConnected,
    isLoading,
    connect,
    createInvoice,
    payInvoice,
    error,
    refresh,
  } = useLNbits();

  const [config, setConfig] = useState<LNbitsConfig>({
    instanceUrl: '',
    adminKey: '',
  });

  if (isLoading) return <Spinner />;

  if (!isConnected) {
    return (
      <form onSubmit={e => { e.preventDefault(); connect(config); }}>
        <input
          placeholder="https://lnbits.yourdomain.com"
          onChange={e => setConfig(c => ({ ...c, instanceUrl: e.target.value }))}
        />
        <input
          placeholder="Admin Key"
          type="password"
          onChange={e => setConfig(c => ({ ...c, adminKey: e.target.value }))}
        />
        <button type="submit">Connect</button>
      </form>
    );
  }

  return (
    <div>
      <h2>{wallet?.name}</h2>
      <p className="font-mono text-bitcoin-orange">
        {((balance ?? 0) / 1000).toLocaleString()} sats
      </p>
      {error && <p className="text-red-500">{error.message}</p>}
      <button onClick={refresh}>Refresh</button>

      <ul>
        {payments.map(p => (
          <li key={p.paymentHash}>
            {p.amount < 0 ? '↑' : '↓'} {Math.abs(p.amount) / 1000} sats — {p.memo}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## Related

- [LNbits Library](../libraries/lnbits.md) — Underlying client
- [LNbits Integration Guide](../../user-guides/wallet/lnbits-integration.md) — User setup
- [useNwc](./use-nwc.md) — Complementary NWC Lightning hook
- [useCashu](./use-cashu.md) — Cashu eCash hook
