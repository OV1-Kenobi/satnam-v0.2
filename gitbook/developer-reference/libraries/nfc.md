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

The Proof of Life ceremony is a **mutual contact attestation** between two Satnam users who are physically co-present. Both users scan each other's NFC "Name Tag" card. The ceremony produces bilateral `kind:30078` events, adding each person to the other's contact list and establishing the NFC card as a physical authenticator for all future communications from that contact.

### State Machine

```
IDLE
  │
  ▼
INITIATED ───────────────────────────────────────────────────────► FAILED (timeout)
  │                                                                     ▲
  ▼                                                                     │
SCANNING_PEER (User A scans User B's card) ──────────────────────► FAILED (invalid CMAC)
  │                                                                     ▲
  ▼                                                                     │
PEER_VERIFIED (User B's card CMAC verified, credentials extracted) ──► FAILED (timeout)
  │                                                                     ▲
  ▼                                                                     │
AWAITING_RECIPROCAL (User B scans User A's card on their device) ─► FAILED (invalid CMAC)
  │                                                                     ▲
  ▼                                                                     │
MUTUAL_VERIFIED (both scans confirmed via relay) ─────────────────► FAILED (timeout)
  │
  ▼
WELCOME_SENT (each device sends a signed NIP-17 gift-wrapped welcome message to the other)
  │
  ▼
ATTESTING (construct kind:30078 with welcome hash + Bitcoin block height + OTS)
  │
  ▼
PUBLISHED (events published to Pylon via CEPS + OTS committed)
  │
  ▼
CONFIRMED (relay ACK received; contact added to Circle of Trust)
```

### `ProofOfLifeService` Class

```typescript
type ProofOfLifeState =
  | 'IDLE'
  | 'INITIATED'
  | 'SCANNING_PEER'
  | 'PEER_VERIFIED'
  | 'AWAITING_RECIPROCAL'
  | 'MUTUAL_VERIFIED'
  | 'WELCOME_SENT'
  | 'ATTESTING'
  | 'PUBLISHED'
  | 'CONFIRMED'
  | 'FAILED';

interface ProofOfLifeAttestation {
  timestamp: number;           // Unix timestamp of ceremony
  peerPubkey: string;          // The OTHER participant's pubkey (the new contact)
  peerCardUidHash: string;     // SHA-256 of the OTHER participant's card UID
  welcomeMessageHash: string;  // SHA-256 of both welcome messages concatenated
  bitcoinBlockHeight: number;  // Bitcoin block height at time of ceremony
  otsCommitment: string;       // OpenTimestamps commitment hash
  bilateral: true;             // Always true — solo attestation is not supported
}

class ProofOfLifeService {
  readonly state: ProofOfLifeState;
  readonly lastAttestation?: ProofOfLifeAttestation;

  /**
   * Initiate a new mutual ceremony. User A starts here.
   * Returns a session ID.
   */
  initiate(timeoutMs?: number): Promise<string>;

  /**
   * Process User A scanning User B's NFC card.
   * Verifies the CMAC client-side.
   * Updates state: INITIATED → SCANNING_PEER → PEER_VERIFIED (or FAILED).
   */
  scanPeer(cardUid: string, piccDataHex: string, cmacHex: string): Promise<void>;

  /**
   * Process User B scanning User A's NFC card (reciprocal step).
   * Updates state: PEER_VERIFIED → AWAITING_RECIPROCAL → MUTUAL_VERIFIED (or FAILED).
   */
  processReciprocal(cardUid: string, piccDataHex: string, cmacHex: string): Promise<void>;

  /**
   * Send a signed NIP-17 gift-wrapped welcome message to the peer.
   * Called automatically after MUTUAL_VERIFIED.
   * Both parties send their welcome; hashes are exchanged via relay.
   * State: MUTUAL_VERIFIED → WELCOME_SENT.
   */
  sendWelcomeMessage(): Promise<string>; // Returns welcome event ID

  /**
   * Construct and publish bilateral kind:30078 events.
   * Includes welcome message hash + Bitcoin block height in OTS attestation.
   * Submits OTS commitment via simpleproof-anchor.
   * Updates contact list (kind:3 or kind:30000).
   * Adds contact to Circle of Trust (TrustStore).
   * Returns array of published event IDs [myEventId, peerEventId].
   */
  publish(opts?: { includeLocation?: boolean }): Promise<[string, string]>;

  /** Subscribe to state changes. */
  onStateChange(callback: (state: ProofOfLifeState) => void): () => void;
}
```

### PIN-Gated Operations Added After Ceremony

The Proof of Life ceremony activates `message_send` and `zap_send` as PIN-gated **outgoing** operations on the user's own device. The PIN gate is a local security measure — the user taps their own card and enters their own PIN before their DM or Zap publishes. No PIN is ever entered on another person's device.

```typescript
type PinGatedOperation =
  | 'proof_of_life'        // The ceremony itself (own card tap to initiate)
  | 'contact_modify'       // Add/remove contact
  | 'payment_above_threshold'
  | 'group_membership'
  | 'agent_delegation'
  | 'message_send'         // NIP-17 DM to a PoL-verified contact (own card + own PIN)
  | 'zap_send';            // Zap payment to a PoL-verified contact (own card + own PIN)
```

### Bilateral kind:30078 Event Structure

Each participant publishes one event, pointing to the OTHER participant:

```json
{
  "kind": 30078,
  "pubkey": "<participant_A_pubkey>",
  "created_at": 1700000000,
  "tags": [
    ["d", "satnam:proof-of-life"],
    ["p", "<participant_B_pubkey>"],
    ["nfc-card-hash", "<sha256_of_participant_B_card_uid>"],
    ["welcome-hash", "<sha256_of_both_welcome_messages_concatenated>"],
    ["block-height", "<bitcoin_block_height_at_ceremony>"],
    ["ots", "<opentimestamps_commitment>"],
    ["bilateral", "true"]
  ],
  "content": "<JSON-encoded ProofOfLifeAttestation>"
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
