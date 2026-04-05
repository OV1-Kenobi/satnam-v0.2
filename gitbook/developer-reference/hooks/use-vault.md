# useVault

**File:** `src/hooks/useVault.ts`
**Provider:** `VaultProvider` (must be at app root)

---

## Purpose

`useVault` is the primary interface for interacting with the OPFS Vault. It exposes vault lifecycle controls (lock/unlock/initialize) and all key-material operations (identity, FROST shares, NWC URIs, NFC keys, Cashu proofs).

Every other hook that touches sensitive data ultimately depends on `useVault`. It is the security root of the application.

---

## Return Value Shape

```typescript
interface UseVaultReturn {
  // Lifecycle
  isUnlocked: boolean;
  isInitialized: boolean; // false if no vault exists yet (first run)
  initialize: (method: 'webauthn' | 'passphrase', credential: Uint8Array | string) => Promise<void>;
  unlock: (method: 'webauthn' | 'passphrase', credential: Uint8Array | string) => Promise<void>;
  lock: () => void;
  promptUnlock: () => void; // Opens the unlock modal (UI helper)

  // Identity
  storeNsec: (npub: string, nsec: Uint8Array) => Promise<void>;
  getNsec: (npub: string) => Promise<Uint8Array>;
  deleteNsec: (npub: string) => Promise<void>;
  listIdentities: () => Promise<string[]>;

  // FROST
  storeBfprofile: (groupNpub: string, profile: Uint8Array) => Promise<void>;
  getBfprofile: (groupNpub: string) => Promise<Uint8Array>;
  storeBfshare: (groupNpub: string, share: Uint8Array) => Promise<void>;
  getBfshare: (groupNpub: string) => Promise<Uint8Array>;

  // NWC
  storeNwcUri: (connectionId: string, uri: string) => Promise<void>;
  getNwcUri: (connectionId: string) => Promise<string>;
  deleteNwcUri: (connectionId: string) => Promise<void>;

  // NFC
  storeNfcKey: (cardUid: string, keySlot: 'k1' | 'k2', key: Uint8Array) => Promise<void>;
  getNfcKey: (cardUid: string, keySlot: 'k1' | 'k2') => Promise<Uint8Array>;

  // Cashu
  storeCashuProofs: (mintUrlHash: string, proofs: CashuProof[]) => Promise<void>;
  getCashuProofs: (mintUrlHash: string) => Promise<CashuProof[]>;

  // Backup
  exportEncryptedBackup: () => Promise<Uint8Array>;
  importEncryptedBackup: (data: Uint8Array, wrappingKey: Uint8Array) => Promise<void>;

  // State
  loading: boolean;
  error: VaultError | null;
  idleTimeoutMs: number;
  setIdleTimeout: (ms: number) => void; // 300000–3600000
}
```

---

## Methods

### Lifecycle

| Method | Parameters | Returns | Notes |
|---|---|---|---|
| `initialize` | `method`, `credential` | `Promise<void>` | First run only. Generates master key. |
| `unlock` | `method`, `credential` | `Promise<void>` | Decrypts master key into heap. |
| `lock` | — | `void` | Zeros master key. Triggers re-auth prompt next op. |
| `promptUnlock` | — | `void` | Opens unlock modal. Safe to call from any component. |

### Key Material

See [Vault library reference](../libraries/vault.md) for full API docs on all key material operations. The hook exposes them as bound functions with the same signatures.

---

## Example Usage

### First-Run Onboarding

```tsx
import { useVault } from '@hooks/useVault';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

function OnboardingPage() {
  const vault = useVault();
  const [passphrase, setPassphrase] = useState('');

  async function handleCreateIdentity() {
    // 1. Initialize vault (first run)
    if (!vault.isInitialized) {
      await vault.initialize('passphrase', passphrase);
    }

    // 2. Generate Nostr keypair
    const nsec = generateSecretKey(); // Uint8Array (32 bytes)
    const npub = getPublicKey(nsec);  // hex pubkey

    // 3. Store nsec in vault
    await vault.storeNsec(npub, nsec);

    // 4. Zero nsec from heap
    nsec.fill(0);

    console.log('Identity created:', npub);
  }

  if (!vault.isInitialized) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); handleCreateIdentity(); }}>
        <input
          type="password"
          placeholder="Choose a vault passphrase (min 12 characters)"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          minLength={12}
        />
        <button type="submit">Create Identity</button>
      </form>
    );
  }

  return <Dashboard />;
}
```

### Vault Lock/Unlock UI

```tsx
import { useVault } from '@hooks/useVault';
import { VaultError } from '@lib/vault/types';

function VaultStatusBar() {
  const vault = useVault();
  const [error, setError] = useState<string | null>(null);

  async function handleUnlock(passphrase: string) {
    try {
      await vault.unlock('passphrase', passphrase);
      setError(null);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === VaultError.DecryptionFailed) {
        setError('Wrong passphrase. Try again.');
      }
    }
  }

  return (
    <div>
      {vault.isUnlocked ? (
        <button onClick={vault.lock}>Lock Vault</button>
      ) : (
        <button onClick={vault.promptUnlock}>Unlock Vault</button>
      )}
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}
```

### Checking Vault State Before Operations

```tsx
import { useVault } from '@hooks/useVault';

function SendPaymentButton({ onPay }: { onPay: () => void }) {
  const vault = useVault();

  function handleClick() {
    if (!vault.isUnlocked) {
      vault.promptUnlock(); // Opens unlock modal
      return;
    }
    onPay();
  }

  return (
    <button onClick={handleClick} disabled={vault.loading}>
      {vault.isUnlocked ? 'Send Payment' : 'Unlock to Pay'}
    </button>
  );
}
```

---

## Related Hooks

- [`useFrost`](./use-frost.md) — reads bfshare/bfprofile from vault
- [`useNwc`](./use-nwc.md) — reads NWC URIs from vault
- [`useCashu`](./use-cashu.md) — reads/writes Cashu proofs from vault
- [`useNfc`](./use-nfc.md) — reads NFC AES keys from vault

## Related Libraries

- [Vault library](../libraries/vault.md) — complete API reference
