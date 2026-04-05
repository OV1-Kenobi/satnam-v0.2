# Proof of Life

**Proof of Life** is a Satnam ceremony that proves a group member is physically present and in possession of their NFC card at a specific moment in time. It produces a signed, timestamped Nostr event (kind:30078) that serves as a cryptographic affidavit of presence.

---

## What Is Proof of Life?

In trust structures, a "proof of life" is evidence that a person is alive and capable of authorizing actions on their own behalf. Satnam's Proof of Life ceremony provides a digital equivalent:

- **Card possession** — Verified by NTAG424 CMAC authentication
- **PIN knowledge** — Verified by argon2id PIN verifier check
- **Moment of time** — Anchored by the CMAC counter (monotonically increasing, prevents replay)
- **Identity binding** — The resulting event is signed by the member's Nostr nsec

The published Proof of Life event can be used by:
- Guardians verifying that a beneficiary is alive and capable
- Smart trust protocols that trigger actions on periodic Proof of Life confirmation
- Legal or governance structures requiring documented presence attestation
- Group operations that require physical co-presence

---

## The Ceremony Flow: 7 States

The Proof of Life ceremony is a state machine with seven states:

```
IDLE
  │
  │  Member initiates ceremony
  ▼
INITIATED
  │
  │  Member taps NTAG424 card
  ▼
CARD_TAPPED
  │
  │  Client verifies CMAC (Section 5.2)
  │  Verifies counter is monotonically increasing
  ▼
  [If CMAC invalid or counter reused → FAILED]
  │
  ▼
PIN_VERIFIED
  │
  │  Member enters PIN
  │  argon2id(pin, card_uid) compared to stored verifier
  ▼
  [If PIN wrong → FAILED]
  │
  ▼
SIGNED
  │
  │  Client constructs and signs kind:30078 event with nsec
  ▼
PUBLISHED
  │
  │  CEPS publishes event to Pylon and configured relays
  ▼
CONFIRMED
  │
  │  Event confirmed by relay (EOSE received)
  ▼
  [Success]
```

**FAILED** can be reached from CARD_TAPPED (invalid CMAC or replayed counter) or PIN_VERIFIED (wrong PIN, 3 retries before lockout).

---

## Step-by-Step: Performing a Ceremony

1. Navigate to **Groups → [Your Group] → Proof of Life**.
2. Click **Begin Ceremony**.

   The ceremony can also be initiated by a Guardian on behalf of a member (remote request) — the member receives a NIP-17 direct message with the ceremony link.

3. **INITIATED:** Satnam displays: "Tap your NFC card now."

4. **CARD_TAPPED:** Tap your NTAG424 card to your device.
   - Android: Hold the card to the back of your phone.
   - iOS: Tap the card — the Universal Link opens Satnam automatically.

   Satnam reads the SUN message and verifies the CMAC client-side. Progress shows:
   - ✓ Card detected
   - ✓ CMAC verified
   - ✓ Counter valid (not replayed)

5. **PIN GATE:** A PIN entry dialog appears.

   Enter your 4–8 digit PIN. Satnam:
   - Derives `argon2id(pin, card_uid_as_salt, {m: 65536, t: 3, p: 4})` → 32-byte verifier
   - Compares to the stored verifier in OPFS Vault
   - If correct: proceeds to SIGNED state
   - If incorrect: shows remaining attempts (3 total before lockout)

6. **SIGNED:** Satnam constructs the Proof of Life event.

7. **PUBLISHED:** CEPS publishes the event.

8. **CONFIRMED:** Relay confirms receipt. The ceremony is complete.

A success screen shows the event details and a shareable event ID link.

---

## The Proof of Life Event (kind:30078)

The published event is a NIP-78 application-specific data event:

```json
{
  "kind": 30078,
  "pubkey": "<member_pubkey>",
  "created_at": <unix_timestamp>,
  "tags": [
    ["d", "satnam:proof-of-life"],
    ["card_uid_hash", "<sha256_of_card_uid>"],
    ["guardian", "<guardian_pubkey>"],
    ["cmac_counter", "<counter_value>"],
    ["relay", "wss://pylon.openagents.com"]
  ],
  "content": ""
}
```

**Privacy design:**
- The card UID is **hashed** (SHA-256), not included in plaintext. This prevents correlating the UID across events.
- GPS coordinates are **opt-in** only — a location consent dialog appears before publishing. If consented, coordinates are included as an `["location", "lat", "lon"]` tag. Location data is ephemeral — it is not stored by Satnam; it exists only in the published event.
- The CMAC counter value proves recency (high counter = recent tap, cannot be replayed from an old tap).

---

## PIN Gate Security

The PIN gate is enforced before any Proof of Life event is signed. Here is the full technical flow:

1. Member enters PIN (4–8 digits).
2. Client derives: `argon2id(pin, card_uid_bytes, { m: 65536, t: 3, p: 4 })` → 32-byte verifier.
3. Client compares the derived verifier to the stored verifier in OPFS Vault (`nfc/{card_uid}.pin_verifier`).
4. If PIN is correct: operation proceeds.
5. If PIN is wrong: counter increments. After 3 failed attempts, the card is locked for 15 minutes.

**PIN-gated operations in Satnam:**

| Operation | Requires PIN |
|---|---|
| Proof of Life ceremony | Yes |
| Contact addition/removal | Yes |
| Payment authorization above threshold | Yes |
| Group membership changes | Yes |
| Agent delegation changes | Yes |

The PIN never leaves the client. The server receives a derived verifier hash for the HMAC operation token — it cannot recover the original PIN from the hash.

---

## When to Use Proof of Life

| Scenario | Use Case |
|---|---|
| Trust maintenance | A Guardian requests periodic Proof of Life from all beneficiaries (e.g., annually) |
| Recovery authorization | Before releasing a group's FROST shares in a recovery ceremony |
| High-value spending | Guardian co-signs a payment by providing Proof of Life |
| Compliance | Legal or regulatory requirements for presence attestation |
| Agent operator verification | Human operator proves presence before extending agent autonomy |

### Offspring Members

Offspring members can perform a Proof of Life ceremony, but it requires a Guardian co-signature. The ceremony flow adds an additional step:

```
... PIN_VERIFIED
  │
  ▼
GUARDIAN_COSIGN_REQUESTED
  │  (Guardian receives NIP-17 message with ceremony event)
  │  (Guardian reviews and co-signs)
  ▼
SIGNED  →  PUBLISHED  →  CONFIRMED
```

---

## Viewing Proof of Life History

Navigate to **Groups → [Your Group] → Members → [Member Name] → Proof of Life History**.

The history shows all published kind:30078 events for that member, sorted by timestamp. Each entry shows:
- Ceremony date and time
- CMAC counter value
- Location (if consent was given)
- Guardian who co-signed (for Offspring ceremonies)
- Event ID (linkable to the Nostr relay)

---

## Related Pages

- [NFC Operations Overview](./README.md) — Card types, Android vs. iOS, CMAC verification
- [Group Management](../groups/README.md) — How Proof of Life fits into trust management
- [Managing Roles](../groups/managing-roles.md) — Guardian co-signature for Offspring
- [OPFS Vault](../../overview/architecture.md#opfs-vault-structure) — Where PIN verifiers and NFC keys are stored
