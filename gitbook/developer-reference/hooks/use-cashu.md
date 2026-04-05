# useCashu

**File:** `src/hooks/useCashu.ts`
**Provider:** `CashuProvider` (requires `VaultProvider`)

---

## Purpose

`useCashu` provides access to the Cashu eCash client — mint management, token minting, melting (paying Lightning with eCash), sending tokens, and receiving tokens. All Cashu proofs are stored encrypted in the OPFS Vault.

---

## Return Value Shape

```typescript
interface UseCashuReturn {
  // Mints
  mints: MintInfo[];
  addMint: (mintUrl: string) => Promise<void>;
  removeMint: (mintUrl: string) => Promise<void>;

  // Token operations
  mintTokens: (amountSats: number, mintUrl: string) => Promise<CashuProof[]>;
  meltTokens: (proofs: CashuProof[], bolt11: string) => Promise<MeltResult>;
  sendTokens: (amountSats: number, mintUrl: string) => Promise<string>;
  receiveTokens: (serializedToken: string) => Promise<CashuProof[]>;

  // Balances
  totalBalance: number;        // Sats across all mints
  getBalance: (mintUrl?: string) => Promise<number>;

  // Proof management
  checkProofStatus: (proofs: CashuProof[]) => Promise<ProofStatus[]>;
  swapProofs: (proofs: CashuProof[], mintUrl: string) => Promise<CashuProof[]>;

  // State
  loading: boolean;
  error: string | null;
}
```

---

## Methods

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `addMint` | `mintUrl: string` | `Promise<void>` | Register a new Cashu mint and fetch its info |
| `removeMint` | `mintUrl: string` | `Promise<void>` | Remove mint and its stored proofs |
| `mintTokens` | `amountSats`, `mintUrl` | `CashuProof[]` | Mint from Lightning (prompts for invoice payment) |
| `meltTokens` | `proofs`, `bolt11` | `MeltResult` | Pay Lightning invoice using eCash proofs |
| `sendTokens` | `amountSats`, `mintUrl` | `string` | Create serialized `cashuA...` token for peer transfer |
| `receiveTokens` | `serializedToken` | `CashuProof[]` | Swap received token at mint and store proofs |
| `getBalance` | `mintUrl?` | `number` (sats) | Balance at one mint or total across all |
| `checkProofStatus` | `proofs` | `ProofStatus[]` | Check valid/spent/pending at mint |
| `swapProofs` | `proofs`, `mintUrl` | `CashuProof[]` | Swap proofs for fresh ones (privacy refresh) |

---

## Example Usage in a Component

### Cashu Wallet Panel

```tsx
import { useCashu } from '@hooks/useCashu';

function CashuWalletPanel() {
  const cashu = useCashu();

  return (
    <div>
      <h2>eCash Balance</h2>
      <p className="text-bitcoin-orange text-2xl">{cashu.totalBalance} sats</p>

      {cashu.mints.map((mint) => (
        <div key={mint.url}>
          <span>{mint.name ?? mint.url}</span>
          <span>{mint.balance} sats</span>
          {!mint.isAllowed && (
            <span className="text-red-400">Not in allowed list</span>
          )}
        </div>
      ))}
    </div>
  );
}
```

### Mint Tokens from Lightning

```tsx
import { useCashu } from '@hooks/useCashu';

function MintFlow({ mintUrl }: { mintUrl: string }) {
  const cashu = useCashu();
  const [amount, setAmount] = useState(1000);

  async function handleMint() {
    // mintTokens() returns a Lightning invoice for the user to pay
    // Once paid, proofs are automatically stored in vault
    const proofs = await cashu.mintTokens(amount, mintUrl);
    console.log(
      `Minted ${proofs.reduce((s, p) => s + p.amount, 0)} sats`
    );
  }

  return (
    <div>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
      />
      <button onClick={handleMint} disabled={cashu.loading}>
        {cashu.loading ? 'Minting...' : 'Mint Tokens'}
      </button>
    </div>
  );
}
```

### Receive a Token from a Peer

```tsx
import { useCashu } from '@hooks/useCashu';

function ReceiveTokenInput() {
  const cashu = useCashu();
  const [token, setToken] = useState('');

  async function handleReceive() {
    const proofs = await cashu.receiveTokens(token);
    const amount = proofs.reduce((s, p) => s + p.amount, 0);
    alert(`Received ${amount} sats`);
    setToken('');
  }

  return (
    <div>
      <textarea
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Paste cashuA... token here"
      />
      <button onClick={handleReceive} disabled={cashu.loading || !token}>
        Receive
      </button>
    </div>
  );
}
```

---

## Related Hooks

- [`useVault`](./use-vault.md) — Cashu proofs stored in vault
- [`useNwc`](./use-nwc.md) — Lightning rail for melt operations

## Related Libraries

- [Cashu library](../libraries/cashu.md) — complete API reference
