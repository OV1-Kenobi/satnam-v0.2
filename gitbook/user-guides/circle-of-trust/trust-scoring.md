# Trust Scoring

The Trust Score is a composite 0–100 score computed locally from four weighted factors. It reflects the strength and depth of a real-world relationship as evidenced by Proof of Life ceremonies, shared contacts, and payment history.

---

## The Four Factors

### 1. Meeting Depth (0–30 points)

Meeting Depth rewards the number of unique PoL ceremonies you have completed with a contact. It uses a **logarithmic scale** — going from 0 to 5 meetings adds much more score than going from 20 to 25.

**Formula:**

```
meetingDepth = min(30, floor(log2(meetingCount + 1) × 10))
```

| Meetings | Meeting Depth Score |
|---|---|
| 0 | 0 |
| 1 | 10 |
| 2 | 15 |
| 3 | 20 |
| 4 | 23 |
| 5–6 | 26 |
| 7–10 | 28 |
| 11–15 | 29 |
| 16+ | 30 (cap) |

**Why logarithmic?** The trust difference between 1 and 2 meetings is significant — it means the relationship survived at least one follow-up encounter. The trust difference between 20 and 21 meetings is negligible. Diminishing returns reflect how trust actually works: early meetings carry more signal than incremental meetings in a long-established relationship.

---

### 2. Time Consistency (0–30 points)

Time Consistency rewards the duration of the relationship — specifically, the number of days from the first PoL ceremony to the most recent one.

**Formula:**

```
timeConsistency = min(30, floor(sqrt(timeSpanDays) × 1.5))
```

| Time Span | Time Consistency Score |
|---|---|
| Same day | 0 |
| 1 week (7 days) | 3 |
| 1 month (30 days) | 8 |
| 3 months (90 days) | 14 |
| 6 months (180 days) | 20 |
| 1 year (365 days) | 28 |
| 400+ days | 30 (cap) |

**Why time consistency?** A relationship of one year with repeated meetings is fundamentally more trustworthy than a relationship where someone met you many times in a single week. Time consistency rewards sustained relationships over manufactured meetings.

**Note:** Time Consistency only applies if there are at least 2 meetings. A single meeting always scores 0 for this factor regardless of when it occurred.

---

### 3. Mutual Contacts (0–20 points)

Mutual Contacts rewards shared social proof — contacts who have independently PoL-verified both you and the other person.

**Formula:**

```
mutualContacts = min(20, sharedContactCount × 4)
```

| Shared PoL Contacts | Mutual Contacts Score |
|---|---|
| 0 | 0 |
| 1 | 4 |
| 2 | 8 |
| 3 | 12 |
| 4 | 16 |
| 5+ | 20 (cap) |

**Why mutual contacts?** If Alice has PoL-verified both you and Bob, and Charlie has also PoL-verified both you and Bob, that is independent social proof that Bob is who he says he is. Each additional shared contact provides corroborating evidence from a different direction.

**Privacy:** Shared contact discovery uses local set intersection — only the contacts in your own Circle of Trust are compared. No contact list is published or transmitted to determine overlap.

---

### 4. Financial Trust (0–20 points)

Financial Trust measures the track record of economic interactions with a contact — specifically the ratio of successful outcomes to total interactions.

**Formula:**

```
financialTrust = floor(successfulInteractions / totalInteractions × 20)
```

**What counts as a "successful interaction":**
- Lightning zap received and settled
- Cashu token transfer completed
- Credit Envelope settled (not defaulted)
- Sig4Sats bond returned after job completion

**What counts as a "failure":**
- Credit Envelope defaulted
- Sig4Sats bond forfeited
- Failed payment (on the contact's end)

| Success Rate | Financial Trust Score |
|---|---|
| No history | 0 |
| 50% | 10 |
| 75% | 15 |
| 90% | 18 |
| 100% | 20 |

**Note:** Financial Trust starts at 0 for new contacts with no payment history. It does not penalize contacts who simply have no history with you — the score only moves once interactions occur.

---

## Composite Score

The composite Trust Score is the sum of all four factors:

```
trustScore = meetingDepth + timeConsistency + mutualContacts + financialTrust
```

Range: 0–100.

**Example calculation:**

| Factor | Value | Score |
|---|---|---|
| Meeting Depth | 3 meetings | 20 |
| Time Consistency | 90 days | 14 |
| Mutual Contacts | 2 shared | 8 |
| Financial Trust | 80% success | 16 |
| **Composite** | | **58 (Medium Trust)** |

---

## How Scores Accumulate Over Time

Scores are recalculated every time you open a contact's trust card. Because the formula is deterministic, the score is the same whether computed now or next month — it only changes when an underlying factor changes (new meeting, more time passes, new mutual contact, more payments).

**Growth trajectory for a typical ongoing relationship:**

| Milestone | Expected Score Range |
|---|---|
| Day 0 — first meeting | 10–14 |
| Week 1 — stayed in touch | 12–18 |
| Month 1 — second meeting | 28–35 |
| Month 3 — third meeting | 38–48 |
| Month 6 — payments exchanged | 52–65 |
| Year 1 — established relationship | 68–80 |

---

## Third-Party Validation

The Trust Score is computed locally and never published. However, the underlying data — PoL attestation events on Nostr, Bitcoin block heights via OTS — is publicly verifiable.

A verifier (for example, a mutual contact you introduce two people through) can independently confirm:
1. The existence and timing of PoL ceremonies between two parties
2. The Bitcoin block heights recorded in attestation events
3. The OTS proofs anchoring those block heights

The verifier cannot see the Trust Score itself (it is private), but can validate the evidence it is based on.

---

## Related Pages

- [Circle of Trust Overview](./README.md) — What the Circle of Trust is and how it works
- [Proof of Life](../nfc/proof-of-life.md) — How meeting attestations are created
- [TrustEngine API](../../developer-reference/libraries/circle-of-trust.md#trustengine-class) — Developer reference for the scoring algorithm
