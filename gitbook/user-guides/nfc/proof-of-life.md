# Proof of Life

**Proof of Life** is a Satnam ceremony in which two users who are physically co-present each scan the other's NFC "Name Tag" card. The result is a bilateral, OTS-anchored attestation that proves the npub↔NFC card connection for both participants. After the ceremony, the other person becomes an authenticated contact — their card acts as a physical authenticator for every DM and Zap they send you.

---

## What Is Proof of Life?

The ceremony is **mutual, not solo**. Both participants must be present and both must scan each other's card. This design ensures that only living humans — not bots or agents — can create a Proof of Life relationship.

When two users complete the ceremony:

1. **Each person is added to the other's contact list** (bidirectional).
2. **A bilateral OTS-anchored Nostr event is published** — a `kind:30078` event that attests to the npub↔NFC card connection for both participants.
3. **Physical MFA is established for all future communications** — any time that contact sends you a DM or Zap, their device requires them to tap their NFC card and enter their PIN before the event publishes.

### Why Only Humans Can Do This

The NFC card is a physical "Name Tag." It can only be tapped by someone holding it in their hands. Combined with the PIN, the ceremony proves that a living human with physical possession of a specific card controls a specific npub. This becomes the trust root for all future interactions from that contact.

---

## The Ceremony Flow: 10 States

```
IDLE
  │
  │  User A initiates the ceremony
  ▼
INITIATED
  │
  │  User A scans User B's NFC "Name Tag" card
  ▼
SCANNING_PEER
  │
  │  User B's card CMAC is verified client-side
  ▼
PEER_VERIFIED
  │
  │  User B scans User A's NFC card (reciprocal)
  ▼
AWAITING_RECIPROCAL
  │
  │  Both scans are complete
  ▼
MUTUAL_VERIFIED
  │
  │  Both users enter their PINs to authorize
  ▼
PIN_EXCHANGE
  │
  │  Bilateral attestation events are constructed
  ▼
ATTESTING
  │
  │  Events published to relay + OpenTimestamps anchored
  ▼
PUBLISHED
  │
  │  Both sides confirm receipt
  ▼
CONFIRMED ✓

FAILED — reached from any state on timeout, invalid CMAC, or wrong PIN
```

---

## Step-by-Step: Performing the Ceremony

**What you need:** Two Satnam users, physically co-present. Both must have provisioned NTAG424 NFC cards and set their PINs. Android is required for scanning (iOS cannot use Web NFC API to initiate scanning; iOS users can participate in the reciprocal step via Universal Link).

1. **User A** navigates to **Contacts → Add Contact → Proof of Life**.
2. Tap **Begin Ceremony**. State: `IDLE → INITIATED`.
3. **SCANNING_PEER:** User A sees: "Tap your contact's Name Tag."
   - User A holds their device to User B's NFC card.
   - Satnam reads User B's card and verifies the CMAC client-side.
   - State: `SCANNING_PEER → PEER_VERIFIED`.

4. **AWAITING_RECIPROCAL:** Satnam shows: "Now have your contact scan your card."
   - User A holds their NFC card up. User B taps their own device to User A's card.
   - Alternatively, User A hands their device to User B, who uses it to scan User A's card.
   - Both scans are now complete. State: `AWAITING_RECIPROCAL → MUTUAL_VERIFIED`.

5. **PIN_EXCHANGE:** Both users enter their PINs.
   - User A enters their PIN on their device.
   - User B enters their PIN on their device (or is prompted by User A's device if sharing).
   - State: `MUTUAL_VERIFIED → PIN_EXCHANGE`.

6. **ATTESTING:** Satnam constructs two bilateral attestation events — one for each participant. State: `PIN_EXCHANGE → ATTESTING`.

7. **PUBLISHED:** CEPS publishes both events to Pylon and the configured relays, and submits an OpenTimestamps commitment. State: `ATTESTING → PUBLISHED`.

8. **CONFIRMED:** Both sides confirm relay receipt. State: `PUBLISHED → CONFIRMED`.

A success screen shows the new contact's npub, NIP-05 identifier (if set), and a link to the published event ID.

---

## What Gets Published

For each participant, the ceremony publishes one `kind:30078` event:

```json
{
  "kind": 30078,
  "pubkey": "<participant_A_pubkey>",
  "created_at": <unix_timestamp>,
  "tags": [
    ["d", "satnam:proof-of-life"],
    ["p", "<participant_B_pubkey>"],
    ["nfc-card-hash", "<sha256_of_participant_B_card_uid>"],
    ["ots", "<opentimestamps_commitment>"],
    ["bilateral", "true"]
  ],
  "content": "{\"timestamp\": 1700000000, \"ceremony_type\": \"mutual\", \"peer_pubkey_hash\": \"...\"}"
}
```

And a contact list update (`kind:3` or `kind:30000`) adding the new contact.

**What each field means:**
- `p` tag — the OTHER participant's pubkey (the contact being added)
- `nfc-card-hash` — SHA-256 of the OTHER participant's card UID (hashed for privacy — the UID is not exposed in plaintext)
- `ots` — OpenTimestamps commitment, anchored to Bitcoin later via the `simpleproof-anchor` function
- `bilateral` — marks this as a mutual ceremony, not a solo attestation

---

## After the Ceremony: PIN-Gated Communications

Once a contact is established via Proof of Life, **every DM and Zap that contact sends you** is a PIN-gated operation on their end:

| Operation | Trigger | Requirement |
|---|---|---|
| `message_send` | NIP-17 DM to a PoL-verified contact | Card tap + PIN on the sender's device |
| `zap_send` | Zap payment to a PoL-verified contact | Card tap + PIN on the sender's device |

This ensures only a living human with physical possession of their card can initiate communications to you. A bot, agent, or stolen key cannot send you a DM or Zap without also tapping the card and knowing the PIN.

---

## Privacy Design

- The NFC card UID is **hashed** (SHA-256) in all published events. The raw UID is never exposed.
- The ceremony content is signed by each participant's nsec but does not reveal the card UID in plaintext.
- Location data is **opt-in only** — a consent dialog appears before publishing. If granted, coordinates are included as an ephemeral tag; they are not stored by Satnam.

---

## Viewing Proof of Life Contacts

Navigate to **Contacts → [Contact Name] → Proof of Life**.

The contact detail shows:
- Ceremony date and time
- The other party's npub and NIP-05 identifier (if set)
- The OTS-anchored event ID (linkable to the Nostr relay)
- PIN-gate status for this contact (active / suspended)

---

## Related Pages

- [NFC Operations Overview](./README.md) — Card types, Android vs. iOS, CMAC verification
- [Setting Up NFC Cards](../../tutorials/nfc-setup.md) — How to provision a card before the ceremony
- [OPFS Vault](../../overview/architecture.md#opfs-vault-structure) — Where NFC keys and PIN verifiers are stored
