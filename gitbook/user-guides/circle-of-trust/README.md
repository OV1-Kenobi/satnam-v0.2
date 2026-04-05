# Circle of Trust

Your **Circle of Trust** is an encrypted Web of Trust built through physical Proof of Life ceremonies. Every person in your Circle has been face-to-face verified — their identity is anchored to a real NFC Name Tag, and every meeting between you is notarized to a Bitcoin block height via OpenTimestamps.

---

## What Is Circle of Trust?

Circle of Trust is Satnam's trust infrastructure for human relationships. Unlike social-graph follows (which are unverified), every contact in your Circle of Trust has been:

1. **Physically co-present** — you met in person and scanned each other's NFC Name Tags.
2. **Cryptographically attested** — both devices signed welcome messages exchanged as NIP-17 gift-wrapped events.
3. **Bitcoin block-height notarized** — the meeting's welcome message hash and Bitcoin block height are included in an OTS (OpenTimestamps) attestation, creating a permanent, tamper-evident record of the face-to-face encounter.

This is fundamentally different from declaring trust in software. You cannot fake physical presence. You cannot pre-date a block height. The Circle of Trust is the closest thing to an unforgeable, privacy-preserving proof that two human beings have met.

---

## How Trust Grows Over Time

Trust is not binary. A single meeting establishes initial contact; repeated meetings over time deepen trust. Each Proof of Life ceremony with the same contact adds a new attestation — a new block height, a new timestamp, a new signed welcome message hash.

| Meetings | Relationship Character |
|---|---|
| 1 meeting | New contact — identity verified, basic trust established |
| 2–4 meetings | Growing trust — multiple encounters, relationship forming |
| 5–9 meetings | Established trust — sustained relationship over time |
| 10+ meetings | Deep trust — long-term, consistent relationship |

The **Trust Depth** for a contact equals the number of unique PoL ceremonies you have completed with them. Multiple ceremonies at different times and locations provide stronger trust evidence than a single ceremony, because they demonstrate an ongoing relationship rather than a one-time event.

---

## Trust Score Explained

Each contact receives a **Trust Score** from 0 to 100. The score is a composite of four weighted factors:

| Factor | Weight | What It Measures |
|---|---|---|
| **Meeting Depth** | 0–30 points | Number of PoL ceremonies (logarithmic — diminishing returns) |
| **Time Consistency** | 0–30 points | Time span from first to last meeting in days |
| **Mutual Contacts** | 0–20 points | Shared PoL-verified contacts in both Circles |
| **Financial Trust** | 0–20 points | History of successful Lightning payments and Cashu settlements |

**Score tiers:**

| Score Range | Tier | Ring Color |
|---|---|---|
| 70–100 | High Trust | Sovereign Gold (inner ring) |
| 30–69 | Medium Trust | Bitcoin Orange (middle ring) |
| 0–29 | New Contact | Vault Blue (outer ring) |

The score is computed entirely locally — it is never transmitted to Satnam servers or published to relays. See [Trust Scoring](./trust-scoring.md) for the full algorithm.

---

## The Handshake Ledger

Every interaction with a Circle of Trust contact is recorded in your **Handshake Ledger** — an encrypted chronological log stored in your OPFS Vault. The ledger records:

- **Meetings** — each PoL ceremony, with attestation event ID and Bitcoin block height
- **Messages** — NIP-17 DMs sent and received
- **Payments** — Lightning zaps and Cashu transfers
- **Attestations** — skill attestations you have issued or received

The ledger is encrypted and private. You can optionally authorize a third party to verify specific ledger entries (for example, to prove that you have met someone to a mutual contact), but the full ledger is never published.

```
Handshake Ledger for alice@satnam.pub
──────────────────────────────────────
[block:870,145]  2025-03-12  MEETING    PoL ceremony #1 — attestation 3f8a...
[block:874,201]  2025-04-02  PAYMENT    5,000 sats zap
[block:881,009]  2025-05-14  MESSAGE    DM exchange
[block:889,774]  2025-06-28  MEETING    PoL ceremony #2 — attestation a1c4...
[block:901,532]  2025-08-11  ATTESTATION  Skill: "Bitcoin Development" endorsed
```

---

## How Others Can Validate Your Trust Network

Because each PoL attestation is a published `kind:30078` Nostr event, anyone can verify:

1. That the event was signed by your npub
2. That the event's OTS commitment timestamps to a specific Bitcoin block height
3. That the `nfc-card-hash` tag corresponds to a known Name Tag

This creates a **publicly verifiable chain of face-to-face meetings** without revealing private details. A third party can confirm "these two people have met at block height X" without knowing where or when — only the existence and ordering of the meeting is public.

Your **Identity Trust Profile** aggregates:
- How many people have PoL-verified you (verification count)
- The longest trust chain to well-known identities (chain depth)
- Skills attested by your trusted contacts
- Your financial reputation (successful payment history)

---

## Bitcoin Block Height Notarization

When a Proof of Life ceremony completes, Satnam records the **Bitcoin block height** at the time of the ceremony. This block height is included in the OTS attestation alongside the SHA-256 hash of both welcome messages concatenated.

```
OTS Attestation Content:
  - welcome_message_hash: SHA-256(alice_welcome || bob_welcome)
  - bitcoin_block_height: 889,774
  - ots_commitment: <OpenTimestamps commitment>
```

This means the meeting is anchored to a specific moment in Bitcoin history. You cannot claim a meeting happened at block 889,774 if you did not actually exchange welcome messages at that time — the OTS commitment proves it.

**Why this matters:** Bitcoin block height creates an objective, global, censorship-resistant timestamp that does not depend on any company or server. Even if Satnam shut down tomorrow, your PoL attestations would still exist on Nostr relays and remain verifiable against the Bitcoin blockchain.

---

## Circle of Trust Dashboard

Navigate to **Circle** in the main navigation to access your Circle of Trust dashboard.

The dashboard has five tabs:

| Tab | Contents |
|---|---|
| **Overview** | Concentric ring visualization of contacts by trust tier; stats bar |
| **Contacts** | Searchable list of all Circle members with trust cards |
| **Identity** | Your trust profile as others see it |
| **Financial** | Payment history, credit envelope reputation, Sig4Sats history |
| **Skills** | Skills attested by your trusted contacts |

---

## Related Pages

- [Trust Scoring](./trust-scoring.md) — Detailed algorithm for all four trust factors
- [Proof of Life](../nfc/proof-of-life.md) — How to perform a ceremony
- [Note to Self](../note-to-self.md) — Encrypted private notes
- [Circle of Trust Library](../../developer-reference/libraries/circle-of-trust.md) — Developer reference
- [useCircleOfTrust hook](../../developer-reference/hooks/use-circle-of-trust.md)
