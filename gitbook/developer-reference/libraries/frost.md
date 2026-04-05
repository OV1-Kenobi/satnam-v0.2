# FROST Client

**Module path:** `src/lib/frost/`
**Type definitions:** `src/lib/frost/types.ts`
**Package:** `@frostr/bifrost@^2.0.2`
**Import alias:** `@lib/frost`

---

## Overview

FROST (Flexible Round-Optimized Schnorr Threshold) enables a **t-of-n group** of participants to collaboratively sign Nostr events without any single party ever holding the full group secret key. The group's public identity is preserved across share rotations and membership changes — a cryptographic guarantee unique to FROST.

In Satnam v2, FROST replaces all Shamir Secret Sharing from v1. Key differences:

| v1 (SSS) | v2 (FROST) |
|---|---|
| Shamir shares stored in Supabase | Shares stored in each participant's OPFS Vault |
| Server reconstructs full nsec for signing | No party ever assembles the full nsec |
| Single point of failure (server compromise) | Threshold adversary model |
| Recovery required server round-trip | Recovery via NIP-44 encrypted kind:10000 events |

---

## Type Definitions

### `BfProfile`

The group's public configuration. Contains no secret material. Stored per-participant in OPFS (`frost/{groupNpub}.bfprofile`) and published as a kind:39200 event.

```typescript
interface BfProfile {
  /** Group public key (hex) — the threshold signing pubkey */
  groupPubkey: string;

  /** Threshold (t): minimum co-signers required */
  threshold: number;

  /** Total shares (n) */
  totalShares: number;

  /** Participant public keys (hex[]) in share-index order */
  participants: string[];

  metadata: GroupMetadata;
  createdAt: number; // Unix timestamp
}

interface GroupMetadata {
  name: string;
  description?: string;
  picture?: string;
  profileEventId?: string; // Set after publishing to relay
}
```

### `BfShare`

An individual participant's secret share. Treat as equivalent to an nsec — must never leave the OPFS Vault.

```typescript
interface BfShare {
  index: number;          // 1-based share index (per FROST spec)
  secretShare: string;    // ⚠️ Hex-encoded 32-byte scalar — SENSITIVE
  publicShare: string;    // Hex-encoded 33-byte compressed verification key
  groupPubkey: string;    // Group pubkey this share belongs to
  nonceCommitments?: string[]; // Pre-generated nonce commitments
}
```

### `BfOnboard`

Invitation payload from a Guardian to a new participant. Transmitted as an encrypted NIP-17 DM.

```typescript
interface BfOnboard {
  groupPubkey: string;
  threshold: number;
  totalShares: number;
  existingParticipants: string[]; // Hex pubkeys to verify quorum
  encryptedPayload: string;       // NIP-44 encrypted (share index assignment)
}
```

### `DkgSession` and `DkgState`

State machine for a Distributed Key Generation ceremony.

```typescript
type DkgState =
  | 'idle'
  | 'round1_initiated'
  | 'round1_collecting'
  | 'round2_initiated'
  | 'round2_collecting'
  | 'completed'
  | 'failed';

interface DkgSession {
  state: DkgState;
  groupId: string;           // Random 32-byte hex session ID
  threshold: number;
  totalShares: number;
  participants: string[];    // Hex pubkeys
  round1Commitments: Map<string, Uint8Array>;
  round2Shares: Map<string, Uint8Array>;
  error?: string;            // Present when state === 'failed'
  createdAt: number;
  coordinatorRelay?: string;
}
```

### `SigningSession` and `SigningState`

State machine for a group signing ceremony.

```typescript
type SigningState =
  | 'idle'
  | 'request_published'
  | 'collecting_partial_sigs'
  | 'combining'
  | 'completed'
  | 'failed';

interface SigningSession {
  state: SigningState;
  sessionId: string;
  groupPubkey: string;
  unsignedEvent: UnsignedNostrEvent;
  partialSigs: Map<number, Uint8Array>; // Keyed by share index
  threshold: number;
  finalSig?: string; // 64-byte hex when state === 'completed'
  error?: string;
  createdAt: number;
}
```

### `FrostConfig`

```typescript
interface FrostConfig {
  coordinatorRelay: string; // WSS URL for FROST coordinator channel
  signingRequestKind: number; // Must be ephemeral (20000–29999). Default: 20100
  dkgTimeout: number;         // ms to wait for DKG round participants. Default: 120000
  signingTimeout: number;     // ms to wait for partial sigs. Default: 60000
}
```

### `FrostError`

Typed error discriminants.

```typescript
enum FrostError {
  VaultLocked             = 'FrostError.VaultLocked',
  ShareNotFound           = 'FrostError.ShareNotFound',
  ProfileNotFound         = 'FrostError.ProfileNotFound',
  CeremonyTimeout         = 'FrostError.CeremonyTimeout',
  InsufficientParticipants = 'FrostError.InsufficientParticipants',
  BifrostUnavailable      = 'FrostError.BifrostUnavailable',
  AggregationFailed       = 'FrostError.AggregationFailed',
  EncryptionFailed        = 'FrostError.EncryptionFailed',
  RelayConnectionFailed   = 'FrostError.RelayConnectionFailed',
  PermissionDenied        = 'FrostError.PermissionDenied',
  InvalidBackup           = 'FrostError.InvalidBackup',
}
```

---

## FrostClient API

```typescript
class FrostClient {
  constructor(vault: VaultOps, config?: Partial<FrostConfig>);

  // DKG Ceremony
  initiateDkg(
    params: { threshold: number; totalShares: number; participants: string[]; metadata: GroupMetadata }
  ): Promise<DkgSession>;

  joinDkg(onboard: BfOnboard): Promise<DkgSession>;

  processDkgRound1(
    session: DkgSession,
    commitmentPackage: Uint8Array
  ): Promise<DkgSession>;

  processDkgRound2(
    session: DkgSession,
    sharePackages: Map<string, Uint8Array>  // fromPubkey → encrypted share package
  ): Promise<DkgSession>;

  finalizeDkg(session: DkgSession): Promise<{
    profile: BfProfile;
    share: BfShare;
  }>;

  // Group Signing
  initiateGroupSigning(
    groupPubkey: string,
    unsignedEvent: UnsignedNostrEvent
  ): Promise<SigningSession>;

  submitPartialSignature(
    session: SigningSession,
    shareIndex: number
  ): Promise<SigningSession>;

  combineSignatures(session: SigningSession): Promise<string>; // Returns final sig hex

  // Share Rotation
  initiateShareRotation(groupPubkey: string): Promise<DkgSession>;

  // Share Backup / Restore
  backupShare(groupPubkey: string): Promise<string>; // Returns kind:10000 event ID
  restoreShare(groupPubkey: string, backupEventId: string): Promise<BfShare>;

  // Queries
  listGroups(): Promise<BfProfile[]>;
  getProfile(groupPubkey: string): Promise<BfProfile>;
  getShare(groupPubkey: string): Promise<BfShare>;
}
```

---

## DKG Ceremony Flow

The Distributed Key Generation ceremony establishes a group keypair. No party ever holds the full secret key.

```
Guardian (initiator)          Coordinator Relay          Other Participants
        │                           │                           │
        │── initiateDkg() ──────────►│── kind:20100 (dkg_init) ─►│
        │                           │                           │
        │◄─────────────────────────────────── round1 commitment ─│
        │── processDkgRound1() ─────►│                           │
        │                           │── kind:20100 (round1) ───►│
        │                           │                           │
        │◄──────────────────────── encrypted share packages ────│
        │── processDkgRound2() ─────►│                           │
        │                           │── kind:20100 (round2) ───►│
        │                           │                           │
        │── finalizeDkg() ──────────►│                           │
        │   (stores bfprofile +      │                           │
        │    bfshare in vault)       │                           │
```

### Step-by-Step

```typescript
import { FrostClient } from '@lib/frost/client';
import { useVault } from '@hooks/useVault';

// --- Guardian initiates DKG ---
const frostClient = new FrostClient(vault);

const session = await frostClient.initiateDkg({
  threshold: 2,
  totalShares: 3,
  participants: [guardianPubkey, steward1Pubkey, steward2Pubkey],
  metadata: {
    name: 'Doe Family Trust',
    description: '2-of-3 family treasury',
  },
});

// Session is now in state 'round1_initiated'
// Each participant receives a dkg_init event on the coordinator relay

// --- Each participant (including Guardian) processes Round 1 ---
const round1Package = await bifrost.generateCommitments(session.groupId);
const updatedSession = await frostClient.processDkgRound1(session, round1Package);
// State transitions to 'round1_collecting', then 'round2_initiated'

// --- Each participant processes Round 2 ---
const round2Packages = await bifrost.processRound1Commitments(session.round1Commitments);
const finalSession = await frostClient.processDkgRound2(updatedSession, round2Packages);

// --- Finalize (each participant calls this independently) ---
const { profile, share } = await frostClient.finalizeDkg(finalSession);
// profile: stored in OPFS vault/frost/{groupNpub}.bfprofile
// share:   stored in OPFS vault/frost/{groupNpub}.bfshare
// Group pubkey: profile.groupPubkey — no party holds the nsec
```

---

## Group Signing Flow

```typescript
// --- Initiator publishes signing request ---
const session = await frostClient.initiateGroupSigning(
  groupPubkey,
  {
    kind: 39200,
    pubkey: groupPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', 'profile']],
    content: JSON.stringify(newProfileContent),
  }
);
// State: 'request_published'

// --- Each co-signer submits their partial signature ---
// (This runs independently on each co-signer's device)
const coSignSession = await frostClient.submitPartialSignature(session, shareIndex);
// State: 'collecting_partial_sigs' → 'combining' when threshold met

// --- Initiator combines when threshold is reached ---
const finalSig = await frostClient.combineSignatures(coSignSession);
// State: 'completed', finalSig is the 64-byte Schnorr signature

// The signed event is now ready to publish via CEPS
```

---

## Share Rotation

Share rotation changes every participant's secret share without changing the group public key. The group's Nostr identity is preserved.

Trigger conditions: Guardian decision, suspected share compromise, member departure, scheduled rotation policy.

```typescript
// Guardian initiates rotation — runs a fresh DKG with the same group metadata
const rotationSession = await frostClient.initiateShareRotation(groupPubkey);

// The rotation ceremony follows the same DKG flow
// Each participant stores new bfshare in vault; old share is deleted
// groupPubkey remains the same — all existing signed events remain valid
```

---

## Share Backup and Restore

Each participant backs up their `bfshare` as a **NIP-44 encrypted kind:10000 Nostr event** (encrypted to self). The backup is recoverable from any relay that stores the event — no server dependency.

```typescript
// Backup current share to Nostr relay
const eventId = await frostClient.backupShare(groupPubkey);
console.log(`Share backed up as kind:10000 event: ${eventId}`);

// Restore from backup (e.g., after device replacement)
const restoredShare = await frostClient.restoreShare(groupPubkey, eventId);
// restoreShare decrypts the event content with the Principal's nsec
// and stores the share back in the OPFS Vault
```

### Share Backup Event Structure

```json
{
  "kind": 10000,
  "pubkey": "<participant_pubkey>",
  "tags": [
    ["d", "frost-share-backup"],
    ["g", "<groupPubkey>"]
  ],
  "content": "<NIP-44 encrypted ShareBackupContent>"
}
```

The encrypted content contains:
```typescript
interface ShareBackupContent {
  version: number;
  groupPubkey: string;
  shareIndex: number;
  encryptedShare: string; // Base64-encoded NIP-44 ciphertext of serialized BfShare
  createdAt: number;
}
```

---

## Quick Start

```typescript
import { FrostClient } from '@lib/frost/client';
import { useFrost } from '@hooks/useFrost';

// In a component — use the hook
function GroupDashboard({ groupPubkey }: { groupPubkey: string }) {
  const frost = useFrost();

  async function publishGroupProfile() {
    const unsignedEvent = {
      kind: 39200,
      pubkey: groupPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', 'profile']],
      content: JSON.stringify({ name: 'My Group', about: 'A FROST-managed group' }),
    };

    const session = await frost.initiateGroupSigning(groupPubkey, unsignedEvent);
    // Session UI renders: "Waiting for co-signers (1/2)"
    // When threshold met, CEPS publishes the signed event automatically
  }

  return (
    <button onClick={publishGroupProfile}>Update Group Profile</button>
  );
}
```

---

## Related

- [useFrost hook](../hooks/use-frost.md)
- [Vault library](./vault.md) — FROST shares stored in vault
- [CEPS + Pylon library](./ceps.md) — DKG coordinator events published via CEPS
- Specification §4.3 — FROST Threshold Signatures
