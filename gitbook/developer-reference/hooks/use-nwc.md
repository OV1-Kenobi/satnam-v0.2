# useNwc

**File:** `src/hooks/useNwc.ts`
**Provider:** `NwcProvider` (requires `VaultProvider`)

---

## Purpose

`useNwc` manages Lightning wallet connections via NIP-47 (Nostr Wallet Connect) and exposes payment operations. NWC URIs are stored encrypted in the OPFS Vault — the hook handles vault reads transparently.

---

## Return Value Shape

```typescript
interface UseNwcReturn {
  // Connections
  connections: NwcConnection[];
  defaultConnection: NwcConnection | null;
  addConnection: (label: string, nwcUri: string) => Promise<string>;
  removeConnection: (connectionId: string) => Promise<void>;
  setDefaultConnection: (connectionId: string) => Promise<void>;

  // Payments
  payInvoice: (bolt11: string, connectionId?: string) => Promise<PaymentResult>;
  makeInvoice: (amountMsats: bigint, description: string, connectionId?: string) => Promise<string>;
  getBalance: (connectionId?: string) => Promise<bigint>;
  lookupInvoice: (paymentHash: string, connectionId?: string) => Promise<InvoiceStatus>;
  listTransactions: (options: TxListOptions, connectionId?: string) => Promise<Transaction[]>;

  // State
  loading: boolean;
  error: NwcError | null;
  isConnected: boolean; // Whether the default connection WebSocket is live
}
```

---

## Methods

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `addConnection` | `label`, `nwcUri` | `Promise<string>` | Parse URI, store in vault, connect WebSocket |
| `removeConnection` | `connectionId` | `Promise<void>` | Delete from vault, close WebSocket |
| `setDefaultConnection` | `connectionId` | `Promise<void>` | Set as active connection for all operations |
| `payInvoice` | `bolt11`, `connectionId?` | `PaymentResult` | Pay BOLT-11 invoice via default/specified connection |
| `makeInvoice` | `amountMsats`, `description`, `connectionId?` | `string` | Generate BOLT-11 invoice (returns the invoice string) |
| `getBalance` | `connectionId?` | `bigint` (msats) | Query wallet balance |
| `lookupInvoice` | `paymentHash`, `connectionId?` | `InvoiceStatus` | Check if an invoice has been paid |
| `listTransactions` | `TxListOptions`, `connectionId?` | `Transaction[]` | Paginated transaction history |

---

## Example Usage in a Component

### Wallet Dashboard

```tsx
import { useNwc } from '@hooks/useNwc';

function WalletDashboard() {
  const nwc = useNwc();
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    if (nwc.isConnected) {
      nwc.getBalance().then(setBalance);
    }
  }, [nwc.isConnected]);

  if (!nwc.defaultConnection) {
    return (
      <div>
        <p>No wallet connected.</p>
        <NWCSetupModal />
      </div>
    );
  }

  return (
    <div>
      <h2>{nwc.defaultConnection.label}</h2>
      {balance !== null && (
        <p className="text-bitcoin-orange text-3xl">
          {(balance / 1000n).toString()} sats
        </p>
      )}
      <div className="flex gap-4">
        <SendPayment />
        <ReceivePayment />
      </div>
      <TransactionList />
    </div>
  );
}
```

### Send Payment

```tsx
import { useNwc } from '@hooks/useNwc';

function SendPayment() {
  const nwc = useNwc();
  const [invoice, setInvoice] = useState('');
  const [result, setResult] = useState<PaymentResult | null>(null);

  async function handlePay() {
    try {
      const paid = await nwc.payInvoice(invoice);
      setResult(paid);
    } catch (err) {
      // err.code = "INSUFFICIENT_BALANCE" | "INVOICE_EXPIRED" | etc.
      console.error('Payment failed:', nwc.error?.message);
    }
  }

  return (
    <div>
      <textarea
        value={invoice}
        onChange={(e) => setInvoice(e.target.value)}
        placeholder="Paste BOLT-11 invoice..."
      />
      <button onClick={handlePay} disabled={nwc.loading}>
        {nwc.loading ? 'Sending...' : 'Pay'}
      </button>
      {result && <p>Paid ✓ — Preimage: {result.preimage}</p>}
    </div>
  );
}
```

### Receive Payment (Generate Invoice)

```tsx
import { useNwc } from '@hooks/useNwc';
import qrcode from 'qrcode-generator';

function ReceivePayment() {
  const nwc = useNwc();
  const [sats, setSats] = useState(1000);
  const [bolt11, setBolt11] = useState('');

  async function handleGenerate() {
    const amountMsats = BigInt(sats) * 1000n;
    const invoice = await nwc.makeInvoice(amountMsats, 'Payment to Satnam');
    setBolt11(invoice);
  }

  return (
    <div>
      <input
        type="number"
        value={sats}
        onChange={(e) => setSats(Number(e.target.value))}
      />
      <button onClick={handleGenerate}>Generate Invoice</button>
      {bolt11 && (
        <div>
          <QRCode data={bolt11.toUpperCase()} />
          <code>{bolt11}</code>
        </div>
      )}
    </div>
  );
}
```

---

## Amount Convention

All amounts use `bigint` millisatoshis. See [NWC library](../libraries/nwc.md) for conversion patterns.

---

## Related Hooks

- [`useVault`](./use-vault.md) — NWC URIs stored in vault
- [`useCashu`](./use-cashu.md) — eCash alternative payment rail

## Related Libraries

- [NWC library](../libraries/nwc.md) — complete API reference
- [Netlify Functions](../functions/README.md) — `nwc-proxy` function for connection proxying
