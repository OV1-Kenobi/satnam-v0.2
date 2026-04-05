# NFC Operations

Satnam integrates with NFC cards for physical identity verification, presence ceremonies, and hardware-backed signing. NFC operations bridge the digital and physical worlds — proving that a real person with a real card is present at a specific moment.

---

## Supported Cards

Satnam v2 supports two NFC card types:

### NTAG424 DNA TT

The primary identity and ceremony card.

| Property | Details |
|---|---|
| Protocol | ISO 14443-4 with SUN (Secure Unique NFC) |
| Authentication | AES-128-CMAC over UID + read counter |
| Key storage | AES-128 keys stored in OPFS Vault |
| Primary use | Proof of Life ceremonies, identity binding |
| Android | Full read/write support via Web NFC API |
| iOS | Read support via Universal Link fallback |

The NTAG424 generates a unique cryptographic signature (CMAC) on every tap, incorporating the card UID and a monotonically increasing read counter. This proves both card authenticity (only a card with the correct AES key produces a valid CMAC) and recency (the counter prevents replay attacks from old taps).

**Key pair:** Each NTAG424 card uses two AES-128 keys:
- `k1` (primary, SUN/SDM key): Used for UID and counter encryption
- `k2` (CMAC key): Used for AES-128-CMAC computation over the SUN message

Both keys are stored in your OPFS Vault at `nfc/{card_uid}.k1` and `nfc/{card_uid}.k2`.

### TapSigner

A hardware NFC signer using the CKTAP protocol.

| Property | Details |
|---|---|
| Protocol | CKTAP |
| Authentication | ECDSA signatures on-card |
| Primary use | Nostr event signing (the key never leaves the card) |
| Android | Full support via Web NFC API |
| iOS | Limited support via Universal Link |

TapSigner acts as a hardware Nostr signer. When you use TapSigner for an operation, Satnam sends the unsigned event to the card, and the card signs it with its internal key. The private key never leaves the card.

> **Note:** BoltCard/LNbits NFC payment functionality is not supported in Satnam v2. NFC payments are handled entirely through NWC (Lightning), not through card-to-LNbits flows.

---

## Android vs. iOS Support

| Feature | Android Chrome | iOS Safari |
|---|---|---|
| Read NTAG424 SUN URL | ✓ Web NFC API | ✓ Universal Link fallback |
| Read NTAG424 NDEF | ✓ Web NFC API | ✗ |
| Write NTAG424 (provisioning) | ✓ Web NFC API | ✗ |
| TapSigner signing | ✓ Web NFC API | ✗ (limited) |
| Proof of Life ceremony | ✓ Full | ✓ Via Universal Link |

### iOS Universal Link Fallback

When an NTAG424 card is tapped on an iOS device, the SUN URL (`https://satnam.pub/nfc/{card_uid}?piccDataHex=...&cmacHex=...`) triggers Safari to open the Satnam Universal Link.

The Satnam PWA intercepts the URL, extracts `piccDataHex` and `cmacHex` as query parameters, and runs the same CMAC verification flow as Android. The user experience is seamless — the Proof of Life ceremony proceeds normally.

**iOS limitation:** Card provisioning (writing AES keys to the card during initial setup) requires Android or a dedicated NFC writer tool. Existing provisioned cards work fully on iOS for ceremony operations.

---

## What NFC Enables in Satnam

### 1. Physical Presence Verification and Mutual Contact Exchange

NFC provides proof that a real person tapped a real card at a real moment. Unlike purely digital operations, NFC ceremonies require physical possession of the card. This is used for:

- **Proof of Life ceremonies** — Two Satnam users meet in person and each scans the other’s NFC card. This creates a bilateral, cryptographically attested contact record, adding each person to the other’s contact list and anchoring the npub↗NFC card connection via OpenTimestamps. After the ceremony, that contact’s NFC card acts as a physical authenticator for all future communications — every DM or Zap they send to you requires them to tap their card and enter their PIN first.
- **High-value authorizations** — Requiring card tap before authorizing payments above threshold
- **Identity binding** — Linking a physical card (“Name Tag”) to a Nostr identity

### 2. Hardware-Backed Signing

With TapSigner, critical Nostr events can be signed by a hardware key that never leaves the card. This provides:
- Protection against device compromise (even if your phone is hacked, the TapSigner key is not exposed)
- Physical second-factor for group operations
- Airgapped signing capability

### 3. PIN Gate Security

Every NFC-triggered operation that modifies identity state requires PIN confirmation. The PIN is verified against an argon2id-derived verifier stored in the OPFS Vault — it is never sent to any server. See [Proof of Life](./proof-of-life.md#pin-gate).

---

## Client-Side CMAC Verification

> **Security note for developers:** This is a key security invariant (S6). CMAC values are never sent to any server.

When you tap an NTAG424 card:

1. The card generates a SUN message containing:
   - Encrypted UID + read counter (`piccDataHex`)
   - AES-128-CMAC over the message (`cmacHex`)

2. Satnam retrieves your card's AES-128 key (`k2`) from the OPFS Vault.

3. Client-side CMAC verification:
   ```
   expectedCmac = AES-128-CMAC(k2, piccDataHex)
   isValid = timing_safe_compare(expectedCmac, receivedCmac)
   ```

4. The read counter is verified to be monotonically increasing (stored counter in OPFS, prevents replay attacks).

5. **If valid:** Card presence is proven. The operation proceeds.
   **If invalid:** The tap is rejected. The card may be cloned or the message tampered.

6. The serverless function receives only the verification *result* (true/false) and the card UID — never the CMAC value itself.

---

## Setting Up a New Card

### Provisioning an NTAG424 (Android only)

1. Navigate to **Settings → NFC Cards → Add Card**.
2. Tap your NTAG424 card to your Android device.
3. Satnam reads the card UID and generates two fresh AES-128 keys.
4. Satnam writes the keys to the card's SDM configuration.
5. The keys are encrypted and stored in your OPFS Vault at `nfc/{card_uid}.k1` and `nfc/{card_uid}.k2`.
6. The card is now bound to your Satnam identity on this device.

### Setting Up a PIN

After provisioning, set a PIN for the card:
1. Navigate to **Settings → NFC Cards → [Your Card] → Set PIN**.
2. Enter a 4–8 digit PIN.
3. Satnam derives `argon2id(pin, card_uid, params)` → PIN verifier.
4. The verifier is stored in your OPFS Vault (not the PIN itself).

---

## Related Pages

- [Proof of Life](./proof-of-life.md) — Physical presence ceremony walkthrough
- [OPFS Vault](../../overview/architecture.md#opfs-vault-structure) — Where NFC keys are stored
- [Security Invariants](../../overview/what-is-satnam.md#the-12-security-invariants) — S6: No CMAC server-side
