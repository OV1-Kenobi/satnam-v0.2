# NFC Module

**Module path:** `src/lib/nfc/`
**Import alias:** `@lib/nfc`
**Hardware:** NTAG424 DNA NFC cards
**Platform support:** Android (Web NFC API) + iOS (Universal Link fallback)

---

## Overview

The NFC module provides client-side CMAC verification for NTAG424 DNA NFC cards, a PIN gate for high-security operations, and the Proof of Life state machine for physical presence ceremonies.

A critical design rule enforced by security invariant S6: **CMAC values are never transmitted to the server**. All verification is done client-side using AES keys stored in the OPFS Vault. The server receives only verified results.

---

## NTAG424 CMAC Verification

### How NTAG424 SUN Works

The NTAG424 DNA card uses **Secure Unique NFC (SUN)** message authentication. On each tap, the card appends a CMAC (Cipher-based Message Authentication Code) to the redirect URL. The CMAC is computed with AES-128 using a card-specific key (k1) and includes a monotonically incrementing read counter.

```
Card tap → SUN URL generated:
https://satnam.pub/nfc/{cardUid}?piccDataHex={piccData}&cmacHex={cmac}
```

The `piccData` contains the encrypted card UID and read counter. The `cmac` is the AES-128-CMAC over the URL data.

### Client-Side CMAC Verification

```typescript
import { verifyCmac } from '@lib/nfc/cmac';
import { useVault } from '@hooks/useVault';

async function verifyNfcTap(
  cardUid: string,
  piccDataHex: string,
  cmacHex: string
): Promise<boolean> {
  // Retrieve AES-128 k1 key from OPFS Vault
  const k1 = await vault.getNfcKey(cardUid, 'k1');

  // Client-side AES-128-CMAC verification
  const result = await verifyCmac({
    key: k1,
    piccDataHex,
    cmacHex,
  });

  return result.valid;
}
```

### `verifyCmac()` Function

```typescript
interface CmacVerifyInput {
  key: Uint8Array;     // 16-byte AES-128 key from vault
  piccDataHex: string; // Hex-encoded piccData from URL parameter
  cmacHex: string;     // Hex-encoded CMAC from URL parameter
}

interface CmacVerifyResult {
  valid: boolean;
  cardUid?: string;     // Recovered card UID (if valid)
  readCounter?: number; // Monotonic read counter value (if valid)
  error?: string;       // Human-readable error (if invalid)
}

function verifyCmac(input: CmacVerifyInput): Promise<CmacVerifyResult>;
```

### Read Counter Replay Protection

The read counter is monotonically increasing. Satnam stores the last verified counter value in OPFS per card. A CMAC with a counter value ≤ the stored value is rejected as a replay attack:

```typescript
interface NfcCardState {
  cardUid: string;
  lastVerifiedCounter: number;
  lastVerifiedAt: number; // Unix timestamp
}
```

---

## PinGate

The PIN gate adds a second authentication factor for high-security NFC operations. The PIN never leaves the device — it is verified client-side using a stored argon2id-derived verifier.

### PIN-Gated Operations

- Contact addition/removal
- Proof of Life ceremony publication
- Payment authorization above threshold
- Group membership changes
- Agent delegation changes

### `PinGate` Class

```typescript
class PinGate {
  constructor(vault: VaultOps, cardUid: string);

  /**
   * First-time PIN setup. Derives a verifier and stores it in vault.
   * @param pin - 4–8 digit PIN string
   */
  setup(pin: string): Promise<void>;

  /**
   * Verify a PIN submission.
   * Increments lockout counter on failure.
   * @param pin - User-entered PIN
   * @returns true if PIN is correct
   * @throws PinGate.PinLockedError if lockout is active
   */
  verify(pin: string): Promise<boolean>;

  /**
   * Check if the PIN gate is in lockout (too many failures).
   * Returns remaining lockout seconds (0 if not locked).
   */
  getLockoutSeconds(): number;

  /** Reset lockout counter (Guardian operation only). */
  resetLockout(): Promise<void>;
}
```

### PIN Derivation

```
argon2id(
  pin,
  salt = cardUid bytes,
  m = 65536,
  t = 3,
  p = 4
) → 32-byte verifier
```

The verifier is stored in OPFS. The PIN is never stored. Verification compares the freshly derived verifier against the stored one in constant time (to prevent timing attacks).

### Lockout Policy

| Attempt | Action |
|---|---|
| 1–2 failures | Warning shown, no lockout |
| 3–4 failures | 30-second lockout after each failure |
| 5+ failures | 5-minute lockout, Guardian notification |
| 10+ failures | Permanent lockout (requires Guardian reset) |

---

## ProofOfLifeService State Machine

The Proof of Life ceremony proves physical presence of an NFC cardholder. It is used for identity verification, recovery ceremonies, and governance confirmations.

### State Machine

```
IDLE
  │
  ▼
INITIATED ────────────────────────────────────────────► FAILED (timeout)
  │                                                         ▲
  ▼                                                         │
CARD_TAPPED ──────────────────────────────────────────► FAILED (invalid CMAC)
  │                                                         ▲
  ▼                                                         │
PIN_VERIFIED ─────────────────────────────────────────► FAILED (wrong PIN / lockout)
  │
  ▼
SIGNED (Nostr kind:30078 event constructed)
  │
  ▼
PUBLISHED (event published to Pylon via CEPS)
  │
  ▼
CONFIRMED (relay ACK received)
```

### `ProofOfLifeService` Class

```typescript
type ProofOfLifeState =
  | 'IDLE'
  | 'INITIATED'
  | 'CARD_TAPPED'
  | 'PIN_VERIFIED'
  | 'SIGNED'
  | 'PUBLISHED'
  | 'CONFIRMED'
  | 'FAILED';

interface ProofOfLifeEvent {
  timestamp: number;        // Unix timestamp of ceremony
  cardUidHash: string;      // SHA-256 of card UID (privacy — UID not exposed)
  guardianPubkey: string;   // Guardian who initiated or witnessed
  readCounter: number;      // CMAC counter at time of proof (proves recency)
  gpsCoords?: string;       // Optional, ephemeral — only if user consents
}

class ProofOfLifeService {
  readonly state: ProofOfLifeState;
  readonly lastEvent?: ProofOfLifeEvent;

  /** Initiate a new ceremony. Returns a session ID. */
  initiate(guardianPubkey: string, timeoutMs?: number): Promise<string>;

  /** Process an NFC tap. Updates state to CARD_TAPPED if CMAC is valid. */
  processTap(cardUid: string, piccDataHex: string, cmacHex: string): Promise<void>;

  /** Verify PIN and advance to PIN_VERIFIED. */
  verifyPin(pin: string): Promise<void>;

  /**
   * Sign and publish the Proof of Life event.
   * Constructs kind:30078 with d-tag 'satnam:proof-of-life'.
   * Publishes via CEPS to Pylon.
   */
  publish(opts?: { includeGps?: boolean }): Promise<string>; // Returns event ID

  /** Subscribe to state changes. */
  onStateChange(callback: (state: ProofOfLifeState) => void): () => void;
}
```

### Proof of Life Nostr Event

```json
{
  "kind": 30078,
  "tags": [
    ["d", "satnam:proof-of-life"],
    ["guardian", "<guardianPubkeyHex>"],
    ["counter", "<readCounterDecimal>"],
    ["card", "<cardUidHash>"]
  ],
  "content": "<JSON-encoded ProofOfLifeEvent>",
  "created_at": 1700000000
}
```

---

## iOS NFC Fallback

Web NFC API is **Android Chrome only**. iOS uses a Universal Link fallback.

### Flow

1. **Card provisioning:** NTAG424 SUN URL template is configured to redirect to `https://satnam.pub/nfc/{cardUid}`.
2. **iOS tap:** Safari intercepts the SUN URL via Universal Link registration.
3. **URL parameters:** The SUN URL includes `piccDataHex` and `cmacHex` as query parameters.
4. **PWA intercept:** The Satnam PWA reads the parameters from the URL and runs the same CMAC verification as Android.

```typescript
// In the NFC route handler (React Router)
import { useSearchParams } from 'react-router-dom';
import { useNfc } from '@hooks/useNfc';

function NfcLandingPage() {
  const [params] = useSearchParams();
  const nfc = useNfc();

  useEffect(() => {
    const piccDataHex = params.get('piccDataHex');
    const cmacHex = params.get('cmacHex');
    const cardUid = window.location.pathname.split('/nfc/')[1];

    if (piccDataHex && cmacHex && cardUid) {
      // Same verification as Android Web NFC
      nfc.processIosFallback({ cardUid, piccDataHex, cmacHex });
    }
  }, []);
}
```

### iOS Limitation

iOS Safari cannot write to NFC tags via the Web NFC API. **Card provisioning** (writing AES keys during initial setup) requires:
- Android Chrome (Web NFC write support), or
- A dedicated NFC writer tool (e.g., NFC Tools Pro on Android)

---

## Quick Start

```typescript
import { useNfc } from '@hooks/useNfc';

function NfcTapButton() {
  const nfc = useNfc();

  async function startNfcScan() {
    // Android: Uses Web NFC API
    if ('NDEFReader' in window) {
      const reader = new NDEFReader();
      await reader.scan();
      reader.onreading = async (event) => {
        for (const record of event.message.records) {
          if (record.recordType === 'url') {
            const url = new TextDecoder().decode(record.data);
            const parsed = new URL(url);
            await nfc.processTap({
              cardUid: parsed.pathname.split('/nfc/')[1],
              piccDataHex: parsed.searchParams.get('piccDataHex')!,
              cmacHex: parsed.searchParams.get('cmacHex')!,
            });
          }
        }
      };
    } else {
      // iOS: Show instruction to tap card to phone
      // The Universal Link will redirect to the NFC landing page
      nfc.showIosInstructions();
    }
  }

  return (
    <button onClick={startNfcScan}>
      Tap NFC Card
    </button>
  );
}
```

---

## Related

- [useNfc hook](../hooks/use-nfc.md)
- [Vault library](./vault.md) — NFC AES keys stored in vault
- Specification §5 — NFC / PIN Gate
