# useFrost

**File:** `src/hooks/useFrost.ts`
**Provider:** `FrostProvider` (requires `VaultProvider`, `CepsProvider`)

---

## Purpose

`useFrost` manages FROST threshold signing ceremonies — both Distributed Key Generation (DKG) for establishing group keypairs and group signing sessions for publishing group-authorized Nostr events.

Only the Guardian role can initiate a DKG. Both Guardian and Steward roles can participate in signing ceremonies.

---

## Return Value Shape

```typescript
interface UseFrostReturn {
  // DKG ceremonies
  activeDkgSession: DkgSession | null;
  initiateDkg: (params: {
    threshold: number;
    totalShares: number;
    participants: string[];
    metadata: GroupMetadata;
  }) => Promise<DkgSession>;
  joinDkg: (onboard: BfOnboard) => Promise<DkgSession>;
  processDkgRound1: (session: DkgSession, commitment: Uint8Array) => Promise<DkgSession>;
  processDkgRound2: (session: DkgSession, sharePackages: Map<string, Uint8Array>) => Promise<DkgSession>;
  finalizeDkg: (session: DkgSession) => Promise<{ profile: BfProfile; share: BfShare }>;

  // Group signing
  activeSigningSession: SigningSession | null;
  initiateGroupSigning: (groupPubkey: string, unsignedEvent: UnsignedNostrEvent) => Promise<SigningSession>;
  submitPartialSignature: (session: SigningSession, shareIndex: number) => Promise<SigningSession>;
  combineSignatures: (session: SigningSession) => Promise<string>;

  // Share management
  initiateShareRotation: (groupPubkey: string) => Promise<DkgSession>;
  backupShare: (groupPubkey: string) => Promise<string>;
  restoreShare: (groupPubkey: string, backupEventId: string) => Promise<BfShare>;

  // Queries
  groups: BfProfile[];           // All groups the current identity participates in
  getGroup: (groupPubkey: string) => BfProfile | undefined;

  // State
  loading: boolean;
  error: FrostError | null;
}
```

---

## Methods

| Method | Parameters | Returns | Notes |
|---|---|---|---|
| `initiateDkg` | threshold, totalShares, participants, metadata | `DkgSession` | Guardian only. Publishes kind:20100 init event. |
| `joinDkg` | `BfOnboard` | `DkgSession` | Participant joins existing DKG via invitation. |
| `processDkgRound1` | session, commitment | `DkgSession` | Submit Round 1 commitment package. |
| `processDkgRound2` | session, sharePackages | `DkgSession` | Submit Round 2 encrypted share packages. |
| `finalizeDkg` | session | `{profile, share}` | Stores bfprofile + bfshare in vault. |
| `initiateGroupSigning` | groupPubkey, unsignedEvent | `SigningSession` | Publishes kind:20100 signing request. |
| `submitPartialSignature` | session, shareIndex | `SigningSession` | Co-signer submits their partial sig. |
| `combineSignatures` | session | `string` (finalSig) | Aggregates threshold partial sigs. |
| `initiateShareRotation` | groupPubkey | `DkgSession` | Guardian-initiated share rotation (preserves pubkey). |
| `backupShare` | groupPubkey | `string` (eventId) | Publishes NIP-44 encrypted kind:10000 backup. |
| `restoreShare` | groupPubkey, backupEventId | `BfShare` | Decrypts and restores share from relay event. |

---

## Example Usage in a Component

### Creating a Group (Guardian Flow)

```tsx
import { useFrost } from '@hooks/useFrost';
import { useDelegation } from '@hooks/useDelegation';

function GroupCreateFlow() {
  const frost = useFrost();
  const delegation = useDelegation();
  const [step, setStep] = useState<'config' | 'waiting' | 'done'>('config');

  async function handleCreateGroup({
    name,
    threshold,
    stewardPubkeys,
  }: GroupFormData) {
    // 1. Initiate DKG (Guardian calls this)
    const session = await frost.initiateDkg({
      threshold,
      totalShares: stewardPubkeys.length + 1, // +1 for Guardian
      participants: [myPubkey, ...stewardPubkeys],
      metadata: { name },
    });

    setStep('waiting');
    // DKG ceremony runs asynchronously via Pylon relay
    // useFrost subscribes to round1/round2 events automatically

    // 2. Monitor for completion
    // (The hook updates activeDkgSession reactively as rounds complete)
  }

  // Reactive: session state drives UI
  const session = frost.activeDkgSession;

  return (
    <>
      {step === 'config' && <GroupConfigForm onSubmit={handleCreateGroup} />}
      {step === 'waiting' && session && (
        <div>
          <p>DKG Status: {session.state}</p>
          <p>
            Round 1 commitments: {session.round1Commitments.size}/
            {session.totalShares}
          </p>
        </div>
      )}
      {session?.state === 'completed' && (
        <p>Group created! Pubkey: {frost.groups.at(-1)?.groupPubkey}</p>
      )}
    </>
  );
}
```

### Co-Signing a Group Event (Steward Flow)

```tsx
import { useFrost } from '@hooks/useFrost';

function CoSignRequestPanel({ session }: { session: SigningSession }) {
  const frost = useFrost();

  async function handleApprove() {
    // Submit this participant's partial signature
    await frost.submitPartialSignature(session, myShareIndex);
    // Hook watches for threshold completion — CEPS publishes when ready
  }

  return (
    <div>
      <h3>Co-Signature Requested</h3>
      <p>Event kind: {session.unsignedEvent.kind}</p>
      <p>
        Partial sigs: {session.partialSigs.size}/{session.threshold}
      </p>
      <button onClick={handleApprove}>Approve & Sign</button>
    </div>
  );
}
```

---

## Related Hooks

- [`useVault`](./use-vault.md) — vault must be unlocked for all FROST operations
- [`useDelegation`](./use-delegation.md) — role verification (only Guardian can initiate DKG)

## Related Libraries

- [FROST library](../libraries/frost.md) — complete API reference
