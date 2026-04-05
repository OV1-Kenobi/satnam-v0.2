# Building Your Circle of Trust

This tutorial walks through meeting someone for the first time, completing a Proof of Life ceremony, and watching your trust relationship deepen over time through repeated meetings.

**Time:** 10–15 minutes for each ceremony
**Prerequisites:**
- Both users have Satnam installed and an npub
- Both users have a provisioned NTAG424 NFC Name Tag (see [Setting Up NFC Cards](./nfc-setup.md))
- Both users are physically co-present
- At least one user has an Android device (required to initiate NFC scanning)

---

## Step 1: Meet Someone and Start the Ceremony

You have just met Alice at a Bitcoin conference. Alice has Satnam and a Name Tag. You both want to add each other to your Circles of Trust.

**On your device (Android):**

1. Open Satnam and navigate to **Contacts → Add Contact → Proof of Life**.
2. Tap **Begin Ceremony**.

Your screen shows: "Tap your contact's Name Tag."

State: `IDLE → INITIATED`

---

## Step 2: Scan Alice's Name Tag

Hold your Android device close to Alice's NFC Name Tag card. Satnam reads the card and verifies the CMAC client-side in about a second.

Your screen shows: "Card verified! Have your contact scan your card on their device."

State: `SCANNING_PEER → PEER_VERIFIED`

At this point, Satnam has extracted Alice's NFC credentials and confirmed the card is authentic. Alice's npub is now associated with her card in the pending ceremony.

---

## Step 3: Alice Scans Your Name Tag

**On Alice's device:**

Alice navigates to **Contacts → Add Contact → Proof of Life** on her own device and taps **Begin Ceremony**. She holds her device close to your Name Tag.

Both devices signal each other through the relay — your device detects that Alice has completed the reciprocal scan.

Your screen shows: "Both scans complete. Exchanging welcome messages..."

State: `AWAITING_RECIPROCAL → MUTUAL_VERIFIED`

---

## Step 4: Welcome Messages Are Exchanged

This step is automatic. Your device sends Alice a signed NIP-17 gift-wrapped message: "Welcome to my trusted contacts." Alice's device sends you the same. These welcome messages are signed by each party's nsec.

State: `MUTUAL_VERIFIED → WELCOME_SENT`

The SHA-256 hash of both welcome messages concatenated is computed:
```
welcomeHash = SHA-256(your_welcome_message || alice_welcome_message)
```

---

## Step 5: Bitcoin Block-Height Attestation

Satnam fetches the current Bitcoin block height (for example, block 889,774) and constructs a `kind:30078` attestation event for each of you:

```json
{
  "kind": 30078,
  "tags": [
    ["d", "satnam:proof-of-life"],
    ["p", "<alice_pubkey>"],
    ["nfc-card-hash", "<sha256_alice_card_uid>"],
    ["welcome-hash", "<sha256_welcome_messages>"],
    ["block-height", "889774"],
    ["ots", "<opentimestamps_commitment>"],
    ["bilateral", "true"]
  ]
}
```

State: `WELCOME_SENT → ATTESTING → PUBLISHED`

Both events are published to your relay. The OTS commitment is submitted to an OpenTimestamps calendar for future Bitcoin block anchoring.

---

## Step 6: Ceremony Complete

Both devices confirm relay receipt. Alice appears in your **Circle of Trust** with an initial Trust Score.

State: `PUBLISHED → CONFIRMED ✓`

**Your screen shows:**
```
✓ Contact Added

Alice
npub1abc...
NIP-05: alice@satnam.pub

Trust Score: 12/100
  Meeting Depth:    10  (1 meeting)
  Time Consistency:  0  (first meeting)
  Mutual Contacts:   2  (2 shared contacts)
  Financial Trust:   0  (no history yet)

First meeting: Block #889,774
Attestation: 3f8a...
```

---

## Step 7: The PIN Gate Is Now Active

From this moment, when you send Alice a DM or Zap, Satnam will ask you to tap your own Name Tag and enter your own PIN before the event publishes. This is your personal security gate — it proves a human with physical possession of your card sent the message, not a bot or stolen key.

> **Reminder:** You tap your own card on your own device. Alice does the same on hers. Neither party enters a PIN on the other's device.

---

## Step 8: A Month Later — Second Meeting

You and Alice meet again at a follow-up meetup. Repeat the ceremony:

1. Navigate to **Circle → Alice's profile → Add Meeting**.
2. Complete the full scan + welcome message + attestation flow.

This time the ceremony produces a new `kind:30078` event at a different block height (for example, block 905,321).

**Alice's updated Trust Score:**
```
Trust Score: 32/100  (+20 from first meeting)
  Meeting Depth:     15  (2 meetings)
  Time Consistency:   8  (30 days apart)
  Mutual Contacts:    2  (same 2 shared contacts)
  Financial Trust:    7  (a 5,000-sat zap settled)
```

Alice has moved from the "New Contact" tier (outer ring, vault blue) into the "Medium Trust" tier (middle ring, bitcoin orange).

---

## Step 9: Six Months Later — Established Trust

Over the next six months:
- You complete a third ceremony at a local Bitcoin meetup (block 920,088)
- You exchange several successful Cashu payments
- Three more of your mutual contacts have PoL-verified Alice

**Alice's Trust Score at month 6:**
```
Trust Score: 62/100
  Meeting Depth:     20  (3 meetings, logarithmic scale)
  Time Consistency:  18  (180 days)
  Mutual Contacts:    8  (2 additional shared contacts)
  Financial Trust:   16  (80% payment success rate)
```

Alice is solidly in the Medium Trust tier. At a year with 5+ meetings, she may reach High Trust (≥70).

---

## What You Have Built

After these ceremonies, your Handshake Ledger for Alice looks like:

```
Handshake Ledger for alice@satnam.pub
──────────────────────────────────────
[block:889,774]  2025-06-15  MEETING    PoL #1 — attestation 3f8a...
[block:895,001]  2025-06-22  PAYMENT    5,000 sats zap
[block:901,532]  2025-07-10  MESSAGE    DM exchange (3 messages)
[block:905,321]  2025-07-16  MEETING    PoL #2 — attestation a1c4...
[block:912,004]  2025-08-03  PAYMENT    Cashu 10,000 sats
[block:920,088]  2025-09-02  MEETING    PoL #3 — attestation f7e2...
```

This ledger is:
- **Encrypted** — only you can read it (stored in your OPFS Vault)
- **Anchored** — each meeting is tied to a Bitcoin block height
- **Verifiable** — the attestation event IDs are on Nostr and publicly verifiable

---

## Next Steps

- **View Alice's trust card:** Circle → Contacts → Alice — see the full score breakdown, meeting history, and handshake ledger.
- **Introduce Alice to Bob:** If you both have Bob in your Circles of Trust, he becomes a mutual contact and boosts both your scores.
- **Financial trust:** Exchange sats — each successful payment builds financial trust.
- **Deeper verification:** Check Alice's Identity Trust Profile to see how many people have independently PoL-verified her.

---

## Related Pages

- [Circle of Trust](../user-guides/circle-of-trust/README.md) — Complete user guide
- [Trust Scoring](../user-guides/circle-of-trust/trust-scoring.md) — How scores are calculated
- [Proof of Life](../user-guides/nfc/proof-of-life.md) — Ceremony details
- [Setting Up NFC Cards](./nfc-setup.md) — Card provisioning prerequisite
