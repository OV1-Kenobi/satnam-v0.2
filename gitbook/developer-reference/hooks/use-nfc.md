# useNfc

**File:** `src/hooks/useNfc.ts`
**Provider:** `NfcProvider` (requires `VaultProvider`)
**Feature flag:** `VITE_ENABLE_NFC=true`

---

## Purpose

`useNfc` manages NTAG424 NFC card operations — CMAC verification, PIN gate, and the Proof of Life ceremony. Returns a no-op interface when NFC is disabled or when running on iOS (where the Universal Link fallback is handled by the router instead).

---

## Return Value Shape

```typescript
interface UseNfcReturn {
  // Platform detection
  isSupported: boolean;          // true if Web NFC API is available (Android Chrome)
  isIos: boolean;                // true if running on iOS
  isEnabled: boolean;            // Feature flag state

  // NFC reading
  startScan: () => Promise<void>;
  stopScan: () => void;
  isScanning: boolean;

  // iOS fallback
  processIosFallback: (params: {
    cardUid: string;
    piccDataHex: string;
    cmacHex: string;
  }) => Promise<void>;

  // Card setup
  setupCard: (cardUid: string, k1: Uint8Array, k2?: Uint8Array) => Promise<void>;
  setupPin: (cardUid: string, pin: string) => Promise<void>;

  // Tap result
  lastTap: NfcTapResult | null;
  clearLastTap: () => void;

  // Proof of Life
  proofOfLife: ProofOfLifeService;
  activeProofState: ProofOfLifeState | null;

  // State
  loading: boolean;
  error: string | null;
}

interface NfcTapResult {
  cardUid: string;
  readCounter: number;
  verifiedAt: number; // Unix timestamp
  cmacValid: boolean;
}
```

---

## Methods

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `startScan` | — | `Promise<void>` | Start Web NFC scan (Android only). Updates `lastTap` on tap. |
| `stopScan` | — | `void` | Stop ongoing NFC scan. |
| `processIosFallback` | `{ cardUid, piccDataHex, cmacHex }` | `Promise<void>` | Handle iOS Universal Link parameters. |
| `setupCard` | `cardUid`, `k1`, `k2?` | `Promise<void>` | Store NFC AES keys in vault. |
| `setupPin` | `cardUid`, `pin` | `Promise<void>` | Derive and store PIN verifier in vault. |

---

## Example Usage in a Component

### NFC Tap Handler

```tsx
import { useNfc } from '@hooks/useNfc';
import { useEffect } from 'react';

function NfcTapHandler() {
  const nfc = useNfc();

  useEffect(() => {
    if (nfc.isSupported && !nfc.isScanning) {
      nfc.startScan();
    }
    return () => nfc.stopScan();
  }, [nfc.isSupported]);

  if (!nfc.isEnabled) {
    return null; // Feature flag disabled
  }

  if (nfc.isIos) {
    return (
      <p>Tap your NFC card to open the link in Safari.</p>
    );
  }

  return (
    <div>
      {nfc.isScanning && <p>Ready — tap your NFC card...</p>}
      {nfc.lastTap && (
        <p>
          Card verified ✓ (read #{nfc.lastTap.readCounter})
        </p>
      )}
      {nfc.error && <p className="text-red-500">{nfc.error}</p>}
    </div>
  );
}
```

### Proof of Life Ceremony

```tsx
import { useNfc } from '@hooks/useNfc';

function ProofOfLifeFlow({ guardianPubkey }: { guardianPubkey: string }) {
  const nfc = useNfc();
  const { proofOfLife, activeProofState } = nfc;

  async function start() {
    await proofOfLife.initiate(guardianPubkey);
    // State: IDLE → INITIATED
    await nfc.startScan();
    // User taps card → State: CARD_TAPPED
  }

  async function submitPin(pin: string) {
    await proofOfLife.verifyPin(pin);
    // State: PIN_VERIFIED → SIGNED → PUBLISHED → CONFIRMED
    const eventId = await proofOfLife.publish();
    console.log('Proof of Life published:', eventId);
  }

  const stateMessages: Record<string, string> = {
    IDLE: 'Ready to start.',
    INITIATED: 'Tap your NFC card...',
    CARD_TAPPED: 'Card verified. Enter PIN.',
    PIN_VERIFIED: 'Signing...',
    SIGNED: 'Publishing to relay...',
    PUBLISHED: 'Waiting for confirmation...',
    CONFIRMED: 'Proof of Life recorded ✓',
    FAILED: 'Ceremony failed.',
  };

  return (
    <div>
      <p>{stateMessages[activeProofState ?? 'IDLE']}</p>
      {activeProofState === 'IDLE' && (
        <button onClick={start}>Begin Ceremony</button>
      )}
      {activeProofState === 'CARD_TAPPED' && (
        <PinEntry onSubmit={submitPin} />
      )}
    </div>
  );
}
```

---

## iOS Universal Link Route

The iOS fallback is handled by a dedicated route registered in React Router:

```tsx
// src/pages/NfcLandingPage.tsx
import { useSearchParams, useParams } from 'react-router-dom';
import { useNfc } from '@hooks/useNfc';

export function NfcLandingPage() {
  const { cardUid } = useParams<{ cardUid: string }>();
  const [params] = useSearchParams();
  const nfc = useNfc();

  useEffect(() => {
    const piccDataHex = params.get('piccDataHex');
    const cmacHex = params.get('cmacHex');
    if (cardUid && piccDataHex && cmacHex) {
      nfc.processIosFallback({ cardUid, piccDataHex, cmacHex });
    }
  }, []);
}
```

---

## Related Hooks

- [`useVault`](./use-vault.md) — NFC AES keys stored in vault

## Related Libraries

- [NFC library](../libraries/nfc.md) — complete reference
