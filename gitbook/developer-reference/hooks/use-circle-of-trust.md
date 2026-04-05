# useCircleOfTrust

**File:** `src/hooks/useCircleOfTrust.tsx`
**Provider:** `CircleOfTrustProvider` (requires `VaultProvider`)

---

## Purpose

`useCircleOfTrust` provides access to the user's Circle of Trust — their PoL-verified contacts, trust scores, Circle statistics, and the Handshake Ledger. All data is sourced from the encrypted OPFS Vault via `TrustStore` and computed locally by `TrustEngine`. No data is transmitted to any server.

---

## Return Value Shape

```typescript
interface UseCircleOfTrustReturn {
  // Contact list
  contacts: TrustedContact[];
  isLoading: boolean;
  error: string | null;

  // Circle stats
  stats: CircleOfTrustStats | null;

  // Per-contact queries
  trustScore: (pubkey: string) => TrustScore | null;
  getContact: (pubkey: string) => TrustedContact | null;
  handshakeLedger: (pubkey: string) => HandshakeLedgerEntry[];

  // Identity profile
  identityProfile: (pubkey: string) => Promise<IdentityTrustProfile>;

  // Mutations (called after a PoL ceremony)
  addContact: (contact: TrustedContact) => Promise<void>;
  addMeetingProof: (pubkey: string, proof: MeetingProof) => Promise<void>;
  removeContact: (pubkey: string) => Promise<void>;

  // Ledger mutations
  appendLedgerEntry: (pubkey: string, entry: HandshakeLedgerEntry) => Promise<void>;

  // Refresh (re-read from vault)
  refresh: () => Promise<void>;
}
```

---

## Methods

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `trustScore` | `pubkey: string` | `TrustScore \| null` | Compute trust score for a contact. Returns null if contact not found. |
| `getContact` | `pubkey: string` | `TrustedContact \| null` | Get full contact record by pubkey. |
| `handshakeLedger` | `pubkey: string` | `HandshakeLedgerEntry[]` | Return chronological ledger for a contact. |
| `identityProfile` | `pubkey: string` | `Promise<IdentityTrustProfile>` | Build identity profile for any pubkey (including self). |
| `addContact` | `contact: TrustedContact` | `Promise<void>` | Add a new Circle of Trust contact (called after PoL ceremony). |
| `addMeetingProof` | `pubkey, proof` | `Promise<void>` | Append a new meeting attestation to an existing contact. |
| `removeContact` | `pubkey: string` | `Promise<void>` | Remove a contact and all their ledger entries. |
| `appendLedgerEntry` | `pubkey, entry` | `Promise<void>` | Add any type of handshake event to the ledger. |
| `refresh` | — | `Promise<void>` | Re-read all contacts from vault (e.g., after a PoL ceremony). |

---

## Example Usage

### Displaying the Circle of Trust Overview

```tsx
import { useCircleOfTrust } from '@hooks/useCircleOfTrust';

function CircleOverview() {
  const { contacts, stats, isLoading, error } = useCircleOfTrust();

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div>
      <h2>Circle of Trust</h2>
      {stats && (
        <div className="stats-bar">
          <span>{stats.totalContacts} contacts</span>
          <span>Avg score: {stats.avgTrustScore.toFixed(0)}</span>
          <span>{stats.highTrustContacts} high trust</span>
          <span>{stats.totalMeetings} total meetings</span>
        </div>
      )}
      <div className="contact-grid">
        {contacts.map(contact => (
          <ContactTrustCard key={contact.pubkey} contact={contact} />
        ))}
      </div>
    </div>
  );
}
```

### Displaying a Trust Score Breakdown

```tsx
import { useCircleOfTrust } from '@hooks/useCircleOfTrust';

function TrustScoreDisplay({ pubkey }: { pubkey: string }) {
  const { trustScore, getContact } = useCircleOfTrust();

  const contact = getContact(pubkey);
  const score = trustScore(pubkey);

  if (!contact || !score) return null;

  return (
    <div>
      <div className="score-gauge">
        <span className="text-3xl font-mono">{score.composite}</span>
        <span className="text-zinc-400">/100</span>
      </div>
      <div className="factor-bars">
        <FactorBar label="Meeting Depth" value={score.factors.meetingDepth} max={30} />
        <FactorBar label="Time Consistency" value={score.factors.timeConsistency} max={30} />
        <FactorBar label="Mutual Contacts" value={score.factors.mutualContacts} max={20} />
        <FactorBar label="Financial Trust" value={score.factors.financialTrust} max={20} />
      </div>
      <p className="text-sm text-zinc-400">
        {contact.meetings.length} meetings over {score.timeSpanDays} days
      </p>
    </div>
  );
}
```

### Viewing the Handshake Ledger

```tsx
import { useCircleOfTrust } from '@hooks/useCircleOfTrust';

function HandshakeLedgerView({ pubkey }: { pubkey: string }) {
  const { handshakeLedger } = useCircleOfTrust();
  const entries = handshakeLedger(pubkey);

  return (
    <div className="ledger-timeline">
      {entries.map(entry => (
        <div key={entry.eventId} className="ledger-entry">
          <span className="entry-type badge">{entry.type}</span>
          {entry.blockHeight && (
            <span className="block-height font-mono text-xs text-zinc-400">
              block:{entry.blockHeight.toLocaleString()}
            </span>
          )}
          <span className="timestamp">
            {new Date(entry.timestamp * 1000).toLocaleDateString()}
          </span>
        </div>
      ))}
    </div>
  );
}
```

### Adding a Contact After PoL Ceremony

```typescript
// Called by ProofOfLifeService after CONFIRMED state
const { addContact, refresh } = useCircleOfTrust();

await addContact({
  pubkey: peerPubkey,
  nfcCardHash: sha256(peerCardUid),
  firstMeetingBlockHeight: 889774,
  meetings: [{
    attestationEventId: eventId,
    blockHeight: 889774,
    timestamp: Date.now() / 1000,
    welcomeMessageHash: welcomeHash,
  }],
  trustDepth: 1,
  trustScore: 12,   // Initial score (recalculated by TrustEngine)
  welcomeMessageId: welcomeEventId,
  addedAt: Date.now() / 1000,
});

await refresh();
```

---

## Related

- [Circle of Trust library](../libraries/circle-of-trust.md) — TrustEngine and TrustStore
- [Circle of Trust user guide](../../user-guides/circle-of-trust/README.md)
- [Trust Scoring](../../user-guides/circle-of-trust/trust-scoring.md)
