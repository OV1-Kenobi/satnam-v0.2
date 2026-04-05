# Audit Trail and Compliance

Satnam v2 leverages the immutability of Nostr events and Bitcoin's proof-of-work to provide a tamper-evident audit trail for sensitive operations. This document explains how events are anchored, how signatures are verified, and what guarantees the system provides.

---

## OpenTimestamps Anchoring

The `simpleproof-anchor` Netlify function provides Bitcoin-anchored timestamps for Nostr events via the [OpenTimestamps](https://opentimestamps.org) protocol.

### How It Works

1. **Client** publishes a sensitive event (delegation, attestation, agent profile) to relay
2. **Client** sends the event ID to `simpleproof-anchor` via NIP-98 authenticated POST:
   ```json
   POST /.netlify/functions/simpleproof-anchor
   Authorization: Nostr <base64_nip98_event>

   { "event_id": "<hex_event_id>" }
   ```
3. **Server** submits the event ID hash to the OpenTimestamps network
4. **OpenTimestamps** returns an OTS receipt (a Merkle tree path to a Bitcoin transaction)
5. **Server** publishes the OTS receipt as a `kind:1985` label event referencing the original event
6. **Client** stores the OTS receipt locally and can present it as cryptographic proof that the event existed before a specific Bitcoin block

### What This Proves

An OTS-anchored event proves:
- The event existed at or before the Bitcoin block height in the OTS receipt
- The event content has not been modified since anchoring (modifying content changes the event ID, invalidating the anchor)
- The timestamp is secured by Bitcoin proof-of-work — it cannot be retroactively altered

This is used for:
- NIP-26 delegation events (proves when authority was granted)
- NIP-CA attestation events (proves when a certificate was issued)
- FROST DKG completion events (proves when a group was formed)
- Proof of Life ceremony events (proves when physical presence was demonstrated)

### OTS Verification

Anyone can verify an OTS-anchored Nostr event:

```bash
# Using the OpenTimestamps CLI
ots verify <receipt_file>

# Or via the web verifier at opentimestamps.org
```

---

## NIP-CA Issuer Registry

The `issuer-registry` Netlify function maintains a public registry of NIP-CA (Certificate Authority) issuers. These are Guardian-level Principals who have the authority to issue attestation events (`kind:1985`) with `tier3` or `tier4` status.

### Registry Structure

```
GET /.netlify/functions/issuer-registry
→ Returns list of registered issuers with pubkeys and metadata

POST /.netlify/functions/issuer-registry
Authorization: Nostr <base64_nip98_event>
→ Registers a new issuer (requires Guardian-level NIP-98 auth)
```

An issuer record:
```json
{
  "pubkey": "<guardian_pubkey_hex>",
  "name": "Satnam Protocol Authority",
  "about": "Guardian-level attestation authority for satnam.pub",
  "nip05": "authority@satnam.pub",
  "created_at": 1700000000,
  "ots_anchor": "<opentimestamps_receipt_hex>"
}
```

The issuer registry is itself anchored via OpenTimestamps — the registration event is timestamped so the authority cannot be backdated.

---

## Event Immutability Guarantees

### What "Immutable" Means on Nostr

Nostr events are immutable in the cryptographic sense: **an event's content is bound to its ID and signature**. Changing any field changes the event ID, invalidating the signature. A relay cannot silently modify an event without detection.

However, relays can:
- **Delete events** (respond to `kind:5` deletion requests)
- **Withhold events** (refuse to return them in subscriptions)
- **Lose events** (if the relay goes offline)

**Immutability strategy in Satnam v2:**

| Event Type | Immutability Mechanism |
|---|---|
| Delegation events | Published to 3+ relays; OTS-anchored for critical delegations |
| Attestation events | Published to 3+ relays; OTS-anchored via `simpleproof-anchor` |
| Agent profiles | Published to Pylon + 2 public relays; replaceable (NIP-33) but version-tracked |
| FROST group profiles | Published to Pylon; immutable content (replacing changes DKG parameters) |
| Proof of Life | Published to Pylon + public relay; OTS-anchored on request |

### Event Content Hash

The canonical immutability proof for a Nostr event is its **ID** — a SHA-256 hash of the serialized event:

```
id = sha256(
  "[" + "0" + "," +
  JSON.stringify(pubkey) + "," +
  created_at + "," +
  kind + "," +
  JSON.stringify(tags) + "," +
  JSON.stringify(content) +
  "]"
)
```

Any party can verify that a stored event matches its declared ID by recomputing this hash. If the IDs match, the content is authentic.

---

## How to Verify Nostr Event Signatures

Nostr uses secp256k1 Schnorr signatures (BIP-340). Verifying a Nostr event:

### Step 1 — Recompute the Event ID

```typescript
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

function computeEventId(event: {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return bytesToHex(sha256(new TextEncoder().encode(serialized)));
}
```

### Step 2 — Verify the ID Matches

```typescript
const computedId = computeEventId(event);
if (computedId !== event.id) {
  throw new Error('Event ID mismatch — content has been tampered with');
}
```

### Step 3 — Verify the Schnorr Signature

```typescript
import { schnorr } from '@noble/curves/secp256k1';
import { hexToBytes } from '@noble/hashes/utils';

const isValid = schnorr.verify(
  hexToBytes(event.sig),    // 64-byte signature
  hexToBytes(event.id),     // 32-byte message hash
  hexToBytes(event.pubkey)  // 32-byte public key (x-only)
);

if (!isValid) {
  throw new Error('Invalid Schnorr signature — event is not from claimed pubkey');
}
```

### Complete Verification Function

```typescript
import { verifyEvent } from 'nostr-tools';

// nostr-tools provides a convenience wrapper:
const isValid = verifyEvent(event);
// Returns true if ID is correct AND signature is valid
```

### What a Valid Verification Proves

A verified Nostr event proves:
1. The content has not been modified since the event was created (ID hash check)
2. The event was signed by the holder of the private key corresponding to the `pubkey` field
3. **It does not prove** when the event was created (only the content hash is signed, not a trusted timestamp) — use OTS anchoring for timestamp proofs

---

## How to Verify NIP-26 Delegation Signatures

NIP-26 delegation signatures use a different message format from regular Nostr event signatures:

```typescript
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';

function verifyDelegation(
  delegatePubkey: string,
  conditions: string,
  delegationSig: string,
  delegatorPubkey: string
): boolean {
  // Reconstruct the delegation token
  const token = `nostr:delegation:${delegatePubkey}:${conditions}`;

  // Hash the token
  const tokenHash = sha256(new TextEncoder().encode(token));

  // Verify the signature using the delegator's pubkey
  return schnorr.verify(
    hexToBytes(delegationSig),
    tokenHash,
    hexToBytes(delegatorPubkey)
  );
}
```

---

## Compliance Considerations

### Data Residency

All user key material resides on the user's device only. No key material is transmitted to servers based in any jurisdiction. The public data (NIP-05 names, pubkeys) is stored in Supabase — jurisdiction determined by the Supabase project's region setting.

### Right to Erasure (GDPR Article 17)

- **User key material:** Stored only on user's device. User can delete by clearing OPFS storage in browser settings.
- **NIP-05 registration:** Deletable via the `register-identity` function with a DELETE request.
- **Nostr events:** Published to public relays. `kind:5` deletion requests ask relays to delete events. Relays may honor or ignore these requests — Nostr does not provide hard deletion guarantees.

### Non-Repudiation

Signed Nostr events provide non-repudiation: the event publisher cannot credibly deny having signed an event, as only the holder of the nsec can produce a valid Schnorr signature. For legally significant operations, OTS anchoring adds timestamp non-repudiation.

### Audit Log Access

For compliance auditing, all sensitive operations leave Nostr events:
- Guardian grants delegation → `kind:1` with `delegation` tag
- Agent is created → `kind:39200` agent profile
- Skill is attested → `kind:1985` label
- Credit envelope opened → `kind:39242`
- Payment settled → `kind:39244`
- Proof of Life conducted → `kind:30078`

All events are queryable from the relay network by any party with knowledge of the relevant pubkeys.
