# FROST Threshold Signatures

FROST (Flexible Round-Optimized Schnorr Threshold) signatures provide group key management in Satnam v2. FROST replaces the previous Shamir Secret Sharing (SSS) approach, which required a server-side party to reconstruct the full private key for every signing operation — a critical custody violation.

With FROST, **no single party ever holds the complete group private key**. The group can sign as a collective without reconstructing the nsec.

---

## What FROST Is and Why It Replaces Shamir SSS

### Shamir Secret Sharing (v1 — eliminated)

In the v1 architecture, Shamir shares were:
- Stored in the `secret_shares` Supabase table
- Reconstructed server-side when the group needed to sign
- Exposed to the server as a complete secret during reconstruction

This means a Supabase compromise or server-side function compromise exposed the full group nsec. Rated **CRITICAL severity** in the audit.

### FROST (v2)

FROST is a threshold Schnorr signature scheme where:
- Each participant holds a **share** — a random-looking value with no connection to the full key
- Signing requires `t` of `n` participants to contribute **partial signatures**
- The final signature is assembled from partial signatures — the full private key is **never reconstructed anywhere**
- The group public key (npub) is derived from the DKG output and **never changes**, even across share rotations

| Property | Shamir SSS | FROST |
|---|---|---|
| Key reconstruction | Required for every signature | Never required |
| Server exposure | Full nsec exposed to server | Partial sigs only; server sees nothing |
| Share compromise | 1 compromised share helps attacker | Below threshold: no signing capability |
| Public key stability | Changes on re-keying | Preserved across share rotations |
| Implementation | `shamirs-secret-sharing` (eliminated) | `@frostr/bifrost@2.0.2` |

---

## Distributed Key Generation (DKG) Ceremony

The DKG ceremony runs once per group and produces the group public key plus individual shares. It is initiated by the Guardian.

**Step-by-step:**

1. **Guardian initiates** the DKG ceremony by publishing an ephemeral coordination event to Pylon.
2. **Participants join** — Guardian (share #1), Steward(s) (shares #2..#n). The threshold `t` and participant count `n` are set at this time (e.g., 2-of-3).
3. **Round 1 — Commitments:** Each participant generates a random polynomial and broadcasts the polynomial commitments (public values). Each participant keeps their polynomial secret.
4. **Round 2 — Shares:** Each participant generates a secret share value for every other participant and sends it to them (encrypted via NIP-44).
5. **Verification:** Each participant verifies the shares they received against the broadcasted commitments.
6. **Key derivation:** Each participant computes their final share and the group public key. All participants derive the **same** group public key through independent computation.
7. **Storage:** Each participant stores their `bfshare` in their OPFS Vault (`frost/{group_npub}.bfshare`). The `bfprofile` (group metadata, no secret material) is stored at `frost/{group_npub}.bfprofile` and published as a `kind:39200` event to Pylon.

If any participant drops out mid-ceremony, the ceremony is restarted. Partial DKG state is stored in OPFS to allow the local participant to resume without repeating Round 1.

---

## Group Signing Ceremony

When the group needs to sign an event (group profile update, group payment authorization, group attestation):

1. **Initiator** constructs the unsigned Nostr event and publishes a signing request to the FROST coordinator channel on Pylon.
2. **Participants are notified** and retrieve the signing request.
3. **Each participant** (at least `t` of them) generates a nonce commitment and partial signature using their `bfshare`.
4. **Initiator combines** the partial signatures into a single valid Schnorr signature — indistinguishable from a single-party signature.
5. **Signed event** is published to the target relay(s) via CEPS.

The ceremony uses `@frostr/bifrost@2.0.2` under the hood:

```typescript
import { Bifrost } from '@frostr/bifrost';
import { vault } from '../vault';

// Load share from OPFS
const bfshare = await vault.getBfshare(groupNpub);
const bfprofile = await vault.getBfprofile(groupNpub);

// Initialize FROST participant
const bifrost = new Bifrost({ share: bfshare, profile: bfprofile });

// Generate partial signature for an event
const partialSig = await bifrost.sign(unsignedEvent);

// (Initiator) Combine partial signatures
const finalSig = await bifrost.combine([partialSig1, partialSig2]);
```

---

## Share Rotation (Preserves Group Pubkey)

Share rotation refreshes all shares without changing the group public key. This is a cryptographic invariant of FROST: the group identity on the Nostr network is unchanged after rotation.

**Rotation is triggered by:**
- Guardian decision (scheduled rotation policy)
- Suspected share compromise (participant device lost/stolen)
- Member departure (departing member's share is invalidated)
- Scheduled policy (e.g., annual rotation)

**Rotation process:**
1. Guardian initiates a rotation ceremony (same round structure as DKG)
2. Participants run a re-sharing protocol — new shares are derived from the current shares
3. New `bfshare` files replace old ones in each participant's OPFS Vault
4. `bfprofile` is updated with new threshold metadata
5. The group public key **remains the same** — all existing signed events remain valid

---

## FROSTR Package Formats

| Format | File | Contents |
|---|---|---|
| `bfprofile` | `frost/{group_npub}.bfprofile` | Group public key, threshold parameters (`t-of-n`), participant pubkeys list, protocol version. **No secret material.** |
| `bfshare` | `frost/{group_npub}.bfshare` | Participant's secret share for this group. **Highly sensitive** — stored encrypted under vault master key. |
| `bfonboard` | Ephemeral (NIP-44 encrypted DM) | Onboarding payload sent to new participants. Contains the `bfprofile` and their encrypted `bfshare`. Deleted after successful delivery confirmation. |

All three formats are defined by the `@frostr/bifrost` library. The `bfprofile` is safe to publish — it is also included as the content of the `kind:39200` agent profile event for group agents.

---

## Security Properties

| Property | Description |
|---|---|
| No full nsec anywhere | The group private key is never assembled. It exists only as a mathematical construct derivable from `t` or more shares acting in concert. |
| Single share uselessness | A single compromised `bfshare` is computationally useless for forging signatures (below threshold). An attacker with share #1 cannot sign without also compromising share #2 (or more, depending on threshold). |
| Threshold flexibility | The `t-of-n` threshold is set at DKG time. Common configurations: 2-of-3 (Guardian + one Steward), 3-of-5 (majority of extended group). |
| Share rotation without rekey | Shares can be refreshed without changing the group public key, allowing revocation of compromised shares without disrupting the group's Nostr identity. |
| Backup recoverability | Each participant's `bfshare` is backed up encrypted in a `kind:10000` Nostr event (encrypted to self using NIP-44). Recovery requires only the participant's own nsec to decrypt — no server, no Guardian permission required. |
| Observable group key | The group public key (`npub`) is public — anyone can verify events signed by the group. The privacy benefit is that observers cannot determine *which* participants co-signed. |

---

## FROST Share Backup

Each participant backs up their `bfshare` as a `kind:10000` event encrypted to themselves:

```json
{
  "kind": 10000,
  "pubkey": "<participant_pubkey>",
  "created_at": 1700000000,
  "tags": [
    ["d", "frost-backup-<group_npub>"],
    ["p", "<participant_pubkey>"]
  ],
  "content": "<nip44_encrypted_bfshare>"
}
```

Recovery steps:
1. Principal imports their nsec (or unlocks vault on a new device)
2. Fetches `kind:10000` events matching `d: frost-backup-*` from relays
3. Decrypts with their nsec using NIP-44
4. Stores recovered `bfshare` in OPFS Vault
5. Group signing capability is restored
