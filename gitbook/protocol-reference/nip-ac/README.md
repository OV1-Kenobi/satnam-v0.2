# NIP-AC: Agent Credit

NIP-AC (Agent Credit) defines the lifecycle of machine-to-machine commerce between agents and service providers. It governs how agents express intent to purchase compute, how providers respond with offers, how agreements are formalized as credit envelopes, and how payment and reputation flow upon settlement or default.

Satnam v2 implements the **consumer side** of NIP-AC — creating intents, accepting offers, constructing envelopes, authorizing spend, and publishing settlements.

---

## Credit Lifecycle

```
Intent (39240)
    │
    ▼
Offer (39241) ◄─── Published by provider
    │
    ▼ (Principal accepts)
Envelope (39242) ◄─── Constructed by consumer; binds scope to NIP-SKL manifest hash
    │
    ▼
Spend Auth (39243) ◄─── Signed by agent when spending against envelope
    │
    ├──▶ Settlement (39244) ◄─── Published on task completion
    │
    └──▶ Default Notice (39245) ◄─── Published if envelope expires without settlement
```

Each state is a separate Nostr event. The progression is one-way: once an event is published, it cannot be retracted (only superseded by a more recent event in the chain).

---

## Event Kinds 39240–39245

### kind:39240 — Credit Intent

Published by the Principal or Agent to express demand for compute:

```json
{
  "kind": 39240,
  "pubkey": "<principal_or_agent_pubkey>",
  "tags": [
    ["d", "<intent_id>"],
    ["task", "Research Q4 market trends for 5 industries"],
    ["budget", "5000", "msats"],
    ["deadline", "1700003600"],
    ["skill", "<skill_scope_id>"],
    ["p", "<preferred_provider_pubkey>"]
  ],
  "content": ""
}
```

| Field | Description |
|---|---|
| `d` | Unique intent ID (UUID or pubkey-derived) |
| `task` | Natural-language task description |
| `budget` | Maximum price in msats |
| `deadline` | Unix timestamp by which work must be completed |
| `skill` | Required skill scope ID from NIP-SKL |
| `p` | Optional: preferred provider pubkey |

### kind:39241 — Credit Offer

Published by the provider in response to a Credit Intent:

```json
{
  "kind": 39241,
  "pubkey": "<provider_pubkey>",
  "tags": [
    ["d", "<offer_id>"],
    ["e", "<intent_event_id>"],
    ["p", "<consumer_pubkey>"],
    ["price", "4500", "msats"],
    ["estimated_completion", "1700002000"],
    ["skill", "<skill_scope_id>"],
    ["sig4sats_bond", "500", "msats"]
  ],
  "content": "{\"provider_capabilities\": [...], \"reputation_score\": 4.8}"
}
```

| Field | Description |
|---|---|
| `e` | Reference to the Credit Intent event |
| `price` | Provider's quoted price in msats |
| `estimated_completion` | Unix timestamp estimate |
| `sig4sats_bond` | Cashu token amount posted as performance bond |

### kind:39242 — Credit Envelope

The accepted offer, formalized as an authority state machine. Constructed and published by the consumer:

```json
{
  "kind": 39242,
  "pubkey": "<consumer_pubkey>",
  "tags": [
    ["d", "<envelope_id>"],
    ["e", "<offer_event_id>"],
    ["p", "<provider_pubkey>"],
    ["max_sats", "5000"],
    ["expires_at", "1700003600"],
    ["scope_constraints_hash", "<sha256_of_skill_manifest>"],
    ["sig4sats_escrow", "<cashu_token_serialized>"]
  ],
  "content": ""
}
```

| Field | Description |
|---|---|
| `max_sats` | Maximum total spend authorized for this envelope |
| `expires_at` | Envelope expiry — triggers Default Notice if no settlement |
| `scope_constraints_hash` | SHA-256 of the NIP-SKL skill manifest — ties the envelope to a specific verifiable skill definition |
| `sig4sats_escrow` | Optional: Cashu token posted as performance bond, redeemed on settlement |

The `scope_constraints_hash` creates a cryptographic link between the credit authorization (NIP-AC) and the capability definition (NIP-SKL). An agent cannot use this envelope to do work outside the attested skill manifest.

### kind:39243 — Spend Authorization

Published by the agent when it needs to spend against an open envelope:

```json
{
  "kind": 39243,
  "pubkey": "<agent_pubkey>",
  "tags": [
    ["e", "<envelope_event_id>"],
    ["p", "<provider_pubkey>"],
    ["amount", "1200", "msats"],
    ["purpose", "LLM inference for research step 3"],
    ["cumulative_spent", "3400", "msats"]
  ],
  "content": ""
}
```

The agent checks its local spend policy before publishing this event. If the amount exceeds `requires_approval_above_msats`, the Governor must co-sign before the spend auth is published.

### kind:39244 — Settlement Receipt

Published by the provider (or verified by the consumer) after successful task completion:

```json
{
  "kind": 39244,
  "pubkey": "<provider_pubkey>",
  "tags": [
    ["e", "<envelope_event_id>"],
    ["p", "<consumer_pubkey>"],
    ["total_spent", "4200", "msats"],
    ["completion_proof", "<sha256_of_deliverable>"],
    ["sig4sats_redemption", "<cashu_token_serialized>"],
    ["reputation_delta", "+0.15"]
  ],
  "content": "{\"result_summary\": \"...\", \"deliverable_url\": \"...\"}"
}
```

The `sig4sats_redemption` token is the performance bond returned to the consumer upon successful completion, net the provider's earned fee.

### kind:39245 — Default Notice

Published if the envelope expires without a Settlement Receipt:

```json
{
  "kind": 39245,
  "pubkey": "<consumer_pubkey>",
  "tags": [
    ["e", "<envelope_event_id>"],
    ["p", "<provider_pubkey>"],
    ["reason", "deadline_exceeded"],
    ["reputation_delta", "-0.20"]
  ],
  "content": ""
}
```

Default notices affect the provider's reputation score. The consumer recovers any unredeemed Cashu performance bond tokens.

---

## Sig4Sats Performance Bonds

Sig4Sats bonds create skin-in-the-game for providers:

1. **Provider offers** a bond amount (`sig4sats_bond` in the Offer)
2. **Consumer escrows** a matching Cashu token in the Envelope (`sig4sats_escrow`)
3. **On settlement:** Bond is returned to the consumer; provider earns a **15% reputation bonus**
4. **On default:** Consumer claims the bond; provider receives a **reputation penalty**

The bond tokens are Cashu proofs — bearer instruments that do not require server-side escrow. The envelope event itself is the escrow record; the tokens are redeemed by whoever holds the private key to claim them.

---

## Reputation Delta Formula

```typescript
const base_rep = task_completion_score * weight;
const sig4sats_bonus = has_performance_bond ? base_rep * 0.15 : 0;
const total_rep_delta = base_rep + sig4sats_bonus;
```

- `task_completion_score` — derived from delivery time, completeness, and consumer feedback (0.0–1.0)
- `weight` — category weight (task complexity multiplier, 1.0–3.0)
- `sig4sats_bonus` — 15% bonus for providers who posted a performance bond
- Default penalties use a negative `base_rep` with severity based on envelope size

---

## Scope Constraints Hash (NIP-SKL Binding)

The `scope_constraints_hash` in the Credit Envelope (`kind:39242`) ties the payment authorization to a specific, verifiable skill manifest:

```typescript
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

// Hash the canonical skill manifest content
const manifest = await relay.getEvent(skillManifestEventId);
const scopeHash = bytesToHex(sha256(new TextEncoder().encode(manifest.content)));

// Include in envelope tags
["scope_constraints_hash", scopeHash]
```

When a consumer creates an envelope, they must specify which NIP-SKL skill manifest defines the work. The provider must have a valid attestation for that manifest (tier2 or higher). The hash prevents scope creep — the agent cannot claim budget for work outside the original skill definition.
