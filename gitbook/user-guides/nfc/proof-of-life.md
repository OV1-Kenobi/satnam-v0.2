# Proof of Life

**Proof of Life** is a Satnam ceremony in which two users who are physically co-present each scan the other's NFC "Name Tag" card. The result is a bilateral, Bitcoin block-height notarized attestation that proves the npub↔NFC card connection for both participants and adds each person to the other's Circle of Trust.

---

## What Is Proof of Life?

The ceremony is **mutual, not solo**. Both participants must be present and both must scan each other's card. This design ensures that only living humans — not bots or agents — can create a Proof of Life relationship.

When two users complete the ceremony:

1. **Each person scans the other's Name Tag** — both devices auto-extract NFC credentials (card UID and CMAC verification).
2. **Each device sends a signed welcome message** — a NIP-17 gift-wrapped "Welcome to my trusted contacts" message is sent to the other person.
3. **A Bitcoin block-height notarized OTS attestation is published** — the SHA-256 hash of both welcome messages concatenated, plus the current Bitcoin block height, are included in a `kind:30078` event submitted to OpenTimestamps.
4. **Each person is added to the other's Circle of Trust** — bidirectionally.

### Why Only Humans Can Do This

The NFC card is a physical "Name Tag." It can only be tapped by someone holding it in their hands. The ceremony proves that a living human with physical possession of a specific card controls a specific npub. This becomes the trust root for all future interactions from that contact.

### The PIN Gate

The PIN gate is **only for your own outgoing messages and zaps on your own device**. When you send a DM or Zap to a PoL-verified contact, you tap your own card and enter your own PIN before the event publishes. Nobody ever enters their PIN on someone else's phone.

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
  │  User B's card CMAC is verified client-side; credentials extracted
  ▼
PEER_VERIFIED
  │
  │  User B scans User A's NFC card on their own device (signaled via relay)
  ▼
AWAITING_RECIPROCAL
  │
  │  Both scans confirmed via relay exchange
  ▼
MUTUAL_VERIFIED
  │
  │  Each device sends a signed NIP-17 gift-wrapped welcome message to the other
  ▼
WELCOME_SENT
  │
  │  Construct kind:30078 with welcome message hash + OTS Bitcoin block height
  ▼
ATTESTING
  │
  │  Events published to relay; OTS commitment submitted
  ▼
PUBLISHED
  │
  │  Both sides confirm relay receipt; contact added to Circle of Trust
  ▼
CONFIRMED ✓

FAILED — reached from any state on timeout or invalid CMAC
```

---

## Step-by-Step: Performing the Ceremony

**What you need:** Two Satnam users, physically co-present. Both must have provisioned NTAG424 NFC cards. Android is required for scanning (iOS cannot use Web NFC API to initiate scanning; iOS users can participate via Universal Link when their card is tapped by User A's device).

1. **User A** navigates to **Contacts → Add Contact → Proof of Life**.
2. Tap **Begin Ceremony**. State: `IDLE → INITIATED`.
3. **SCANNING_PEER:** User A sees: "Tap your contact's Name Tag."
   - User A holds their device to User B's NFC card.
   - Satnam reads User B's card and verifies the CMAC client-side.
   - Credentials (card UID hash, npub) are auto-extracted.
   - State: `SCANNING_PEER → PEER_VERIFIED`.

4. **AWAITING_RECIPROCAL:** Satnam shows: "Now have your contact scan your card."
   - User B, on their own device, navigates to **Add Contact → Proof of Life** and scans User A's card.
   - Both devices signal completion to each other via the relay.
   - State: `AWAITING_RECIPROCAL → MUTUAL_VERIFIED`.

5. **WELCOME_SENT:** Each device automatically sends a signed "Welcome to my trusted contacts" NIP-17 gift-wrapped message to the other.
   - These welcome messages are signed by each party's nsec.
   - State: `MUTUAL_VERIFIED → WELCOME_SENT`.

6. **ATTESTING:** Satnam constructs a `kind:30078` attestation event containing:
   - The SHA-256 hash of both welcome messages concatenated
   - The current Bitcoin block height
   - An OpenTimestamps commitment
   - State: `WELCOME_SENT → ATTESTING`.

7. **PUBLISHED:** CEPS publishes the attestation event to Pylon and configured relays, and submits the OTS commitment. State: `ATTESTING → PUBLISHED`.

8. **CONFIRMED:** Both sides confirm relay receipt. The contact is added to each party's Circle of Trust. State: `PUBLISHED → CONFIRMED`.

A success screen shows the new contact's npub, NIP-05 identifier (if set), Trust Score (initial), and a link to the published attestation event ID.

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
    ["welcome-hash", "<sha256_of_both_welcome_messages_concatenated>"],
    ["block-height", "<bitcoin_block_height_at_ceremony>"],
    ["ots", "<opentimestamps_commitment>"],
    ["bilateral", "true"]
  ],
  "content": "{\"timestamp\": 1700000000, \"ceremony_type\": \"mutual\", \"peer_pubkey_hash\": \"...\"}"
}
```

And a contact list update (`kind:3` or `kind:30000`) adding the new contact with their Circle of Trust entry.

**What each field means:**
- `p` tag — the OTHER participant's pubkey (the contact being added)
- `nfc-card-hash` — SHA-256 of the OTHER participant's card UID (hashed for privacy)
- `welcome-hash` — SHA-256 of both welcome messages concatenated; proves the bilateral exchange occurred
- `block-height` — Bitcoin block height at the time of the ceremony; anchors the meeting in time
- `ots` — OpenTimestamps commitment, anchored to Bitcoin via the `simpleproof-anchor` function
- `bilateral` — marks this as a mutual ceremony, not a solo attestation

---

## After the Ceremony: PIN-Gated Outgoing Communications

Once a contact is established via Proof of Life, **every DM and Zap you send to that contact** is a PIN-gated operation on your end:

| Operation | Trigger | Requirement |
|---|---|---|
| `message_send` | NIP-17 DM to a PoL-verified contact | Your card tap + your PIN on your device |
| `zap_send` | Zap payment to a PoL-verified contact | Your card tap + your PIN on your device |

This ensures only a living human with physical possession of their card can initiate communications to a PoL-verified contact. A bot, agent, or stolen key cannot send a DM or Zap to your PoL contacts without also tapping your card and knowing your PIN.

> **Clarification:** The PIN gate applies only to **outgoing** messages **from your own device**. You do not enter your PIN on your contact's device at any point during the ceremony or afterward.

---

## Privacy Design

- The NFC card UID is **hashed** (SHA-256) in all published events. The raw UID is never exposed.
- The ceremony content is signed by each participant's nsec but does not reveal the card UID in plaintext.
- Welcome messages are NIP-17 gift-wrapped — their content is end-to-end encrypted; only the recipient can read them.
- Location data is **opt-in only** — a consent dialog appears before publishing. If granted, coordinates are included as an ephemeral tag; they are not stored by Satnam.
- The Handshake Ledger entry for this meeting (including any local notes) is stored only in your OPFS Vault — it is never published.

---

## Viewing Proof of Life Contacts

Navigate to **Circle → Contacts → [Contact Name]**.

The contact trust card shows:
- Ceremony date(s) and Bitcoin block height(s) for each meeting
- The other party's npub and NIP-05 identifier (if set)
- The OTS-anchored attestation event ID(s) (linkable to the Nostr relay)
- Trust Score breakdown (Meeting Depth, Time Consistency, Mutual Contacts, Financial Trust)
- Handshake Ledger preview (last 3 entries)

---

## Building Trust Over Time

A single Proof of Life ceremony adds a contact to your Circle of Trust with a Trust Score reflecting one meeting. **Each subsequent ceremony with the same contact** adds a new attestation at a different block height, deepening the trust:

| Ceremonies | Trust Depth | Approximate Score Range |
|---|---|---|
| 1 | 1 | 10–14 |
| 2 | 2 | 28–35 |
| 3 | 3 | 38–48 |
| 5 | 5 | 50–65 |
| 10+ | 10+ | 70+ |

See [Trust Scoring](../circle-of-trust/trust-scoring.md) for the full algorithm.

---

## Related Pages

- [NFC Operations Overview](./README.md) — Card types, Android vs. iOS, CMAC verification
- [Circle of Trust](../circle-of-trust/README.md) — Your encrypted Web of Trust
- [Trust Scoring](../circle-of-trust/trust-scoring.md) — How Trust Scores are calculated
- [Setting Up NFC Cards](../../tutorials/nfc-setup.md) — How to provision a card before the ceremony
- [OPFS Vault](../../overview/architecture.md#opfs-vault-structure) — Where NFC keys and PIN verifiers are stored
