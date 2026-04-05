# Circle of Trust Library

**Module path:** `src/lib/circle-of-trust/`
**Import alias:** `@lib/circle-of-trust`
**Persistence:** OPFS Vault (encrypted)

---

## Overview

The Circle of Trust library manages the encrypted Web of Trust built through Proof of Life ceremonies. It provides trust scoring, contact persistence, handshake ledger management, and identity profile computation — all client-side with no server involvement.

**Key modules:**
- `trust-engine.ts` — Trust scoring and identity computations
- `trust-store.ts` — Encrypted persistence layer (OPFS Vault)
- `types.ts` — TypeScript interfaces
- `index.ts` — Barrel export

---

## Types

### `TrustedContact`

```typescript
interface TrustedContact {
  pubkey: string;
  nip05?: string;
  nfcCardHash: string;               // SHA-256 of their NFC card UID
  firstMeetingBlockHeight: number;   // Bitcoin block height at first ceremony
  meetings: MeetingProof[];          // All PoL ceremonies with this contact
  trustDepth: number;                // Number of unique ceremonies
  trustScore: number;                // Composite 0-100 score
  welcomeMessageId: string;          // Event ID of the signed welcome from first ceremony
  addedAt: number;                   // Unix timestamp of first ceremony
}
```

### `MeetingProof`

```typescript
interface MeetingProof {
  attestationEventId: string;   // Event ID of the kind:30078 attestation
  blockHeight: number;          // Bitcoin block height at ceremony
  timestamp: number;            // Unix timestamp of ceremony
  welcomeMessageHash: string;   // SHA-256(alice_welcome || bob_welcome)
  // Location is optional and only stored locally (never published)
  localNote?: string;
}
```

### `TrustScore`

```typescript
interface TrustScore {
  meetingCount: number;         // Number of PoL meetings
  timeSpanDays: number;         // Days from first to last meeting
  composite: number;            // 0-100 composite score
  factors: {
    meetingDepth: number;       // 0-30 (logarithmic on meeting count)
    timeConsistency: number;    // 0-30 (based on time span)
    mutualContacts: number;     // 0-20 (shared PoL-verified contacts)
    financialTrust: number;     // 0-20 (payment success rate)
  };
}
```

### `CircleOfTrustStats`

```typescript
interface CircleOfTrustStats {
  totalContacts: number;
  avgTrustScore: number;
  highTrustContacts: number;    // score > 70
  mediumTrustContacts: number;  // score 30-70
  newContacts: number;          // score < 30
  totalMeetings: number;
  oldestRelationshipDays: number;
}
```

### `IdentityTrustProfile`

```typescript
interface IdentityTrustProfile {
  pubkey: string;
  nip05?: string;
  verificationCount: number;    // How many people have PoL-verified this identity
  chainDepth: number;           // Longest trust chain to well-known identities
  attestedSkills: string[];     // Skills attested by trusted contacts
  financialReputation: number;  // Successful envelopes / total envelopes
}
```

### `HandshakeLedgerEntry`

```typescript
type HandshakeLedgerEntry = {
  type: 'meeting' | 'message' | 'payment' | 'attestation';
  contactPubkey: string;
  timestamp: number;
  blockHeight?: number;         // For meeting entries
  eventId: string;
  encryptedDetails?: string;    // NIP-44 encrypted details (only the two parties can read)
};
```

---

## TrustEngine Class

**File:** `src/lib/circle-of-trust/trust-engine.ts`

The `TrustEngine` computes trust scores and identity profiles. All computations are client-side and deterministic.

```typescript
class TrustEngine {
  constructor(store: TrustStore);

  /**
   * Compute the composite TrustScore for a contact.
   * Uses four weighted factors: meetingDepth, timeConsistency,
   * mutualContacts, financialTrust.
   */
  calculateTrustScore(contact: TrustedContact): TrustScore;

  /**
   * Aggregate stats across the entire Circle of Trust.
   * Returns total counts, averages, and tier distributions.
   */
  calculateCircleStats(): CircleOfTrustStats;

  /**
   * Build an IdentityTrustProfile for a pubkey.
   * Reflects how the identity appears to others — verification count,
   * trust chain depth, attested skills, financial reputation.
   */
  getIdentityProfile(pubkey: string): Promise<IdentityTrustProfile>;

  /**
   * Check whether a verifier pubkey has PoL-verified the target pubkey.
   * Returns true if verifier is in your Circle AND target is in verifier's Circle.
   * Used for third-party identity validation.
   */
  validateThirdParty(pubkey: string, verifierPubkey: string): boolean;

  /**
   * Return contacts that both you and the given pubkey have PoL-verified.
   * Used for computing the mutualContacts trust factor.
   */
  getSharedContacts(pubkey: string): TrustedContact[];

  /**
   * Return the chronological handshake history for a contact.
   */
  getHandshakeLedger(contactPubkey: string): HandshakeLedgerEntry[];
}
```

### Trust Score Algorithm

```typescript
// meetingDepth: logarithmic, cap 30
const meetingDepth = Math.min(30, Math.floor(Math.log2(meetingCount + 1) * 10));

// timeConsistency: square-root, cap 30 (0 if only 1 meeting)
const timeConsistency = meetingCount < 2 ? 0
  : Math.min(30, Math.floor(Math.sqrt(timeSpanDays) * 1.5));

// mutualContacts: 4 points each, cap 20
const sharedCount = engine.getSharedContacts(contact.pubkey).length;
const mutualContacts = Math.min(20, sharedCount * 4);

// financialTrust: ratio × 20, 0 if no history
const financialTrust = totalInteractions === 0 ? 0
  : Math.floor((successfulInteractions / totalInteractions) * 20);

const composite = meetingDepth + timeConsistency + mutualContacts + financialTrust;
```

---

## TrustStore Class

**File:** `src/lib/circle-of-trust/trust-store.ts`

The `TrustStore` persists all Circle of Trust data encrypted in the OPFS Vault. Data is encrypted using the vault master key (AES-256-GCM / XChaCha20-Poly1305).

```typescript
class TrustStore {
  constructor(vault: VaultOps);

  // Contact CRUD

  /** Add or update a trusted contact. */
  addTrustedContact(contact: TrustedContact): Promise<void>;

  /** Remove a contact and all their ledger entries. */
  removeTrustedContact(pubkey: string): Promise<void>;

  /** Get a single contact by pubkey. Returns null if not found. */
  getTrustedContact(pubkey: string): Promise<TrustedContact | null>;

  /** List all trusted contacts, sorted by trust score descending. */
  listTrustedContacts(): Promise<TrustedContact[]>;

  // Meeting proofs

  /**
   * Append a new MeetingProof to an existing contact.
   * Updates trustDepth and recomputes trustScore.
   */
  addMeetingProof(pubkey: string, proof: MeetingProof): Promise<void>;

  // Handshake ledger

  /**
   * Return all HandshakeLedgerEntry records for a contact,
   * in chronological order.
   */
  getHandshakeLedger(pubkey: string): Promise<HandshakeLedgerEntry[]>;

  /**
   * Append a new entry to the handshake ledger for a contact.
   */
  appendHandshakeEntry(pubkey: string, entry: HandshakeLedgerEntry): Promise<void>;
}
```

---

## Quick Start

```typescript
import { TrustEngine, TrustStore } from '@lib/circle-of-trust';
import { useVault } from '@hooks/useVault';

// Initialize
const store = new TrustStore(vault);
const engine = new TrustEngine(store);

// Get all contacts and compute stats
const contacts = await store.listTrustedContacts();
const stats = engine.calculateCircleStats();
console.log(`${stats.totalContacts} contacts, avg score: ${stats.avgTrustScore}`);

// Get trust score for a specific contact
const alice = await store.getTrustedContact(alicePubkey);
if (alice) {
  const score = engine.calculateTrustScore(alice);
  console.log(`Alice's score: ${score.composite}/100`);
  console.log(`  Meeting depth: ${score.factors.meetingDepth}`);
  console.log(`  Time consistency: ${score.factors.timeConsistency}`);
  console.log(`  Mutual contacts: ${score.factors.mutualContacts}`);
  console.log(`  Financial trust: ${score.factors.financialTrust}`);
}

// Add a meeting proof after a PoL ceremony
await store.addMeetingProof(alicePubkey, {
  attestationEventId: eventId,
  blockHeight: 889774,
  timestamp: Date.now() / 1000,
  welcomeMessageHash: sha256(aliceWelcome + bobWelcome),
  localNote: 'Bitcoin conference, Austin TX',
});

// Get handshake ledger
const ledger = await store.getHandshakeLedger(alicePubkey);
ledger.forEach(entry => {
  console.log(`[${entry.type}] block:${entry.blockHeight} ${entry.eventId}`);
});
```

---

## Storage Layout

Data is stored in the OPFS Vault at:

```
vault/
  circle-of-trust/
    contacts/
      {pubkey_hex}.json      — TrustedContact (encrypted)
    ledger/
      {pubkey_hex}.json      — HandshakeLedgerEntry[] (encrypted)
    stats.json               — CircleOfTrustStats cache (encrypted)
```

---

## Related

- [useCircleOfTrust hook](../hooks/use-circle-of-trust.md)
- [Trust Scoring user guide](../../user-guides/circle-of-trust/trust-scoring.md)
- [Proof of Life library](./nfc.md#proofoflifeservice-state-machine)
- [Vault library](./vault.md)
