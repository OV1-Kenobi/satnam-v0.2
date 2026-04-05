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

  // Proof of Life (mutual ceremony)
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

`ProofOfLifeState` follows the corrected mutual ceremony state machine:
`'IDLE' | 'INITIATED' | 'SCANNING_PEER' | 'PEER_VERIFIED' | 'AWAITING_RECIPROCAL' | 'MUTUAL_VERIFIED' | 'PIN_EXCHANGE' | 'ATTESTING' | 'PUBLISHED' | 'CONFIRMED' | 'FAILED'`

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

The Proof of Life ceremony is mutual — both users must scan each other's card. The state machine follows:
`IDLE → INITIATED → SCANNING_PEER → PEER_VERIFIED → AWAITING_RECIPROCAL → MUTUAL_VERIFIED → PIN_EXCHANGE → ATTESTING → PUBLISHED → CONFIRMED`

```tsx
import { useNfc } from '@hooks/useNfc';

function ProofOfLifeFlow() {
  const nfc = useNfc();
  const { proofOfLife, activeProofState } = nfc;

  async function start() {
    await proofOfLife.initiate();
    // State: IDLE → INITIATED
    await nfc.startScan();
    // User A scans User B's card → State: SCANNING_PEER → PEER_VERIFIED
  }

  async function handleReciprocal() {
    // User B scans User A's card
    // processTap() is called automatically by startScan()
    // State: PEER_VERIFIED → AWAITING_RECIPROCAL → MUTUAL_VERIFIED
  }

  async function submitPins(myPin: string, peerPin: string) {
    await proofOfLife.exchangePins(myPin, peerPin);
    // State: MUTUAL_VERIFIED → PIN_EXCHANGE → ATTESTING
    const [myEventId, peerEventId] = await proofOfLife.publish();
    console.log('Bilateral PoL published:', myEventId, peerEventId);
    // State: PUBLISHED → CONFIRMED
  }

  const stateMessages: Record<string, string> = {
    IDLE: 'Ready to start.',
    INITIATED: 'Tap your contact’s Name Tag...',
    SCANNING_PEER: 'Reading contact’s card...',
    PEER_VERIFIED: 'Card verified. Have your contact scan your card.',
    AWAITING_RECIPROCAL: 'Waiting for your contact to tap your card...',
    MUTUAL_VERIFIED: 'Both scans complete. Enter your PINs.',
    PIN_EXCHANGE: 'Authorizing...',
    ATTESTING: 'Constructing attestation...',
    PUBLISHED: 'Waiting for relay confirmation...',
    CONFIRMED: 'Contact added ✓ Proof of Life recorded',
    FAILED: 'Ceremony failed.',
  };

  return (
    <div>
      <p>{stateMessages[activeProofState ?? 'IDLE']}</p>
      {activeProofState === 'IDLE' && (
        <button onClick={start}>Begin Ceremony</button>
      )}
      {activeProofState === 'MUTUAL_VERIFIED' && (
        <DualPinEntry onSubmit={submitPins} />
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
