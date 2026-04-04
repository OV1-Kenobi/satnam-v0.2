# Satnam v2 — Full Engineering Specification

**Document ID:** SATNAM-V2-SPEC-001
**Date:** 2026-04-04
**Author:** Senior Engineer — Post-Audit Greenfield Architecture
**Status:** DRAFT — ready for Principal review
**Prerequisite:** [Satnam.pub Senior Architect Audit Report (2026-04-03)](./satnam_audit_report.md) and [Audit Addendum (2026-04-03)](./satnam_audit_addendum.md)
**Verdict Applied:** Option B — new repository, hard architecture boundaries, selective salvage from `OV1-Kenobi/satnam_pub`

---

## 0. Preamble

This document is the complete engineering specification for Satnam v2. It is written for the engineer who will build it. Every section is implementation-directive: it names the exact module, the exact NIP kind, the exact cryptographic primitive, and the exact trust boundary. There are no "consider" or "evaluate" statements — every decision is made.

The audit report scored the v1 codebase at 3.2/10 against the mandate axioms. The critical failures were: encrypted nsec in Supabase (custody violation), JWT as primary auth (sovereignty violation), Sentry data exfiltration, CMAC server routing, Shamir shares with server reconstruction, and zero NIP-90 integration. The addendum raised Axiom 6 from 1 to 4 based on the agent subsystem push, but the structural violations in Axioms 3 and 4 remain.

v2 corrects every critical finding. Nothing from v1 is imported by default. The salvage manifest (Section 10) lists the 12 components that are copied into the new repo after isolation and decontamination from JWT/Supabase coupling. Everything else is written fresh against this specification.

### 0.1 Mandate Axioms

These are non-negotiable. Every design decision in this document traces back to one or more of these axioms. If a future implementation contradicts an axiom, the implementation is wrong.

| # | Axiom | Weight | Enforcement |
|---|---|---|---|
| 1 | All value denominated in sats — no fiat shims, no altcoins | 1x | Every price field is `u64` msats. No `currency` column. No USD conversion in storage. FX snapshots for display only, feature-flag gated. |
| 2 | Lightning Network, Nostr, and eCash are the only valid protocol rails | 1x | NWC for Lightning. Nostr events for identity/messaging/attestation. Cashu for eCash. No HTTP REST APIs for payment (LNbits, PhoenixD direct calls eliminated). |
| 3 | Security and sovereignty over convenience, always | 2x | Zero key material in any managed SaaS database. No third-party error reporting. No CDN-loaded assets without SRI. Client-side CMAC verification. OPFS vault for all secrets. |
| 4 | Minimize dependencies — every dependency is an attack surface | 2x | Target: ≤22 production dependencies. Every dependency must map to a mandate axiom. No redundant crypto libraries. No unused packages. |
| 5 | Maximize self-custody — no custodial shortcuts | 1x | NWC abstracts wallet backends. FROST replaces SSS. No LNbits custodial wallets. No server-side nsec access. |
| 6 | Smooth integration with OpenAgents Autopilot, Probe, and Pylon | 1x | NIP-90 DVM client stack. Probe session event subscriptions. Pylon NIP-42 AUTH. SpacetimeDB bridge for real-time presence. NIP-SA/NIP-AC/NIP-SKL as the agent economic layer. |
| 7 | Nothing is sacred except the above — challenge every choice | 1x | This document is versionable. Sections can be revised. But axiom violations require explicit Principal sign-off with written rationale. |

### 0.2 Glossary

| Term | Definition |
|---|---|
| **Principal** | A human user who holds a root Nostr keypair. The sovereign entity. |
| **Guardian** | Trust Protector. The highest-authority role in a group. Holds FROST share #1. Signs NIP-26 delegation events. |
| **Steward** | Trustee. The operational authority role. Holds FROST share #2. Co-signs group transactions above threshold. |
| **Adult** | Mature Beneficiary. An autonomous member (human or agent) with spending authority within policy limits. |
| **Offspring** | Immature Beneficiary. A member (human or agent) with restricted capabilities, requiring Guardian/Steward approval for most operations. |
| **Group** | A federation of Principals, Agents, or mixed. Replaces all v1 "family" naming. Groups have a FROST-managed group keypair. |
| **Agent** | An autonomous Nostr keypair operating under NIP-SA protocol. Holds its own nsec in a runner vault. Participates in NIP-90 DVM marketplace. |
| **OPFS Vault** | Origin Private File System storage encrypted under a device-bound key. The only permitted location for nsec, FROST shares, NWC URIs, NFC AES keys, and NIP-46 pairing state. |
| **CEPS** | Central Event Publishing Service. The relay abstraction layer for constructing, signing, and publishing Nostr events. Ported from v1. |
| **NIP Triumvirate** | NIP-SA (Sovereign Agents) + NIP-AC (Agent Credit) + NIP-SKL (Skill Registry). The three custom NIPs that define the agent economic layer. |
| **Pylon** | The OpenAgents authenticated Nostr relay. NIP-42 AUTH required. Primary relay for agent coordination events. |
| **Autopilot** | The OpenAgents NIP-90 DVM marketplace. Satnam Principals and Agents are consumers and providers of DVM jobs. |
| **Probe** | The OpenAgents coding agent. Satnam provides session monitoring, tool approval UI, and execution result display for Probe sessions. |
| **SpacetimeDB** | The real-time coordination database used by OpenAgents for presence, session sync, and compute assignment. |
| **NWC** | Nostr Wallet Connect (NIP-47). The wallet abstraction layer. All Lightning operations go through NWC. |
| **FROST** | Flexible Round-Optimized Schnorr Threshold signatures. The threshold signing primitive replacing Shamir. |
| **Cashu** | eCash protocol. Blind-signed tokens for privacy-preserving micropayments. Sats-denominated. |
| **CMAC** | Cipher-based Message Authentication Code. AES-128-CMAC used by NTAG424 DNA cards for SUN (Secure Unique NFC) authentication. |
| **bfprofile / bfshare / bfonboard** | FROSTR v2 package formats for group signing profile, individual share, and onboarding payloads. |

---

## 1. Architecture Overview

### 1.1 Layer Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                              │
│  React 18 + Vite + Tailwind                                  │
│  PWA Shell (manifest.webmanifest, sw.js)                     │
│  Web NFC API (Android Chrome) + iOS deep-link fallback       │
│  Components: Auth, Group Mgmt, Wallet, NFC, Agent Dashboard  │
├─────────────────────────────────────────────────────────────┤
│                     Client Logic Layer                        │
│  OPFS Vault (key storage, encryption)                        │
│  CEPS (relay abstraction, event publishing)                  │
│  NIP-98 Auth (kind:27235 HTTP auth events)                   │
│  NIP-26 Delegation (role hierarchy enforcement)              │
│  NWC Client (NIP-47 wallet operations)                       │
│  FROST Client (@frostr/bifrost@2.0.2)                        │
│  Cashu Client (blind token operations)                       │
│  NTAG424 Client (client-side CMAC verification)              │
│  NIP-90 DVM Client (job request/result/feedback)             │
│  NIP-SA/AC/SKL Client (agent economy events)                 │
│  SpacetimeDB Client (presence bridge)                        │
├─────────────────────────────────────────────────────────────┤
│                     Relay / Network Layer                     │
│  Pylon (primary authenticated relay — NIP-42)                │
│  Public relays (NIP-65 outbox model)                         │
│  Cashu mints (eCash issuance/redemption)                     │
│  NWC relay (wallet command relay)                             │
│  SpacetimeDB endpoint (real-time sync)                       │
├─────────────────────────────────────────────────────────────┤
│                   Serverless Functions (≤8)                   │
│  nip05-resolver     │ NIP-05 /.well-known/nostr.json         │
│  well-known-agent   │ /.well-known/agent.json (NIP-SA)       │
│  check-username     │ Username availability                   │
│  nwc-proxy          │ NWC connection relay proxy              │
│  nfc-ceremony       │ NFC ceremony orchestration (no CMAC)   │
│  simpleproof-ts     │ OpenTimestamps anchor (NIP-CA)          │
│  issuer-registry    │ NIP-CA issuer discovery                 │
│  unified-comms      │ NIP-17 gift-wrapped messaging relay     │
├─────────────────────────────────────────────────────────────┤
│                   Persistence Layer                           │
│  Supabase: nip05_identifiers, lightning_addresses,           │
│            rate_limits, username_reservations                 │
│  OPFS: nsec, FROST shares, NWC URI, NFC AES keys,           │
│        NIP-46 state, agent runner credentials                │
│  Nostr Relays: all identity, attestation, delegation,        │
│                group, agent, skill, credit events            │
│  SpacetimeDB: presence, session sync, compute assignment     │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Trust Boundaries

There are exactly three trust boundaries in v2:

**Boundary 1: The Device.** The browser origin is the trust perimeter. OPFS vault encrypted under a device-held key (WebAuthn-backed or passphrase-derived via argon2id). Key material never leaves this boundary. The nsec is generated in browser memory, encrypted, stored in OPFS, and used for signing in browser memory. The server never sees it.

**Boundary 2: The Relay Network.** Nostr relays are untrusted transport. Events are signed before transmission. Gift-wrapping (NIP-17) provides metadata protection for DMs. NIP-42 AUTH on Pylon provides authenticated relay access but does not grant trust — the relay sees event metadata (pubkey, kind, created_at) but not NIP-44 encrypted content. Relay compromise leaks metadata, not secrets.

**Boundary 3: The Serverless Edge.** Netlify functions are minimally trusted. They handle NIP-05 resolution (public data), username availability (public data), NWC connection proxying (encrypted NWC payloads pass through), NFC ceremony orchestration (receives verified result, not CMAC), OpenTimestamps anchoring (public attestation data), and NIP-17 relay (encrypted gift-wrapped events pass through). No function has access to nsec, FROST shares, NWC URIs, or any key material. Functions authenticate requests via NIP-98 (verify Nostr signature on kind:27235 event in Authorization header).

### 1.3 Custody Model

| Material | v1 Location | v2 Location | Migration Path |
|---|---|---|---|
| User nsec | `user_identities.encrypted_nsec` (Supabase) | OPFS Vault (device-only) | User re-encrypts under device key during migration ceremony |
| User nsec IV | `user_identities.encrypted_nsec_iv` (Supabase) | OPFS Vault | Deleted from Supabase after migration |
| User salt | `user_identities.user_salt` (Supabase) | Not stored — argon2id derives from passphrase | Column dropped |
| Group nsec | `family_federations.federation_nsec_encrypted` (Supabase) | FROST-managed — no single party holds full nsec | FROST key ceremony generates new group keypair |
| Shamir shares | `secret_shares` (Supabase) | Eliminated — FROST replaces SSS | Table dropped |
| Recovery keys | `password_recovery_keys` (Supabase) | FROST share recovery via Guardian ceremony | Table dropped |
| NIP-46 pairing | `localStorage` (plaintext) | OPFS Vault (AES-GCM encrypted) | Automatic migration on first v2 load |
| NFC AES keys | Server-verified via LNbits | OPFS Vault (AES-GCM encrypted) | Re-provisioned during NFC setup ceremony |
| NWC URI | Unknown (not found in audit) | OPFS Vault (AES-GCM encrypted) | User re-enters NWC URI in v2 |
| FROST bfprofile | Not present (BIFROST disabled) | OPFS Vault (AES-GCM encrypted) | Generated fresh in v2 |
| LLM API keys | `agent_llm_credentials` (Supabase, encrypted) | OPFS Vault (AES-GCM encrypted) | Re-entered by Principal in v2 |

---

## 2. OPFS Vault

The OPFS Vault is the root of all key custody in v2. Every secret material listed in Section 1.3 lives here and nowhere else.

### 2.1 Vault Architecture

```
Origin Private File System (navigator.storage.getDirectory())
└── satnam/
    └── vault/
        ├── master.key          ← AES-256-GCM key, encrypted under wrapping key
        ├── identities/
        │   ├── {npub}.nsec     ← Encrypted nsec (XChaCha20-Poly1305)
        │   └── {npub}.meta    ← Role, group memberships, NIP-05 binding
        ├── frost/
        │   ├── {group_npub}.bfprofile  ← FROSTR v2 group profile
        │   └── {group_npub}.bfshare    ← Individual FROST share
        ├── nwc/
        │   └── {connection_id}.uri     ← Encrypted NWC URI
        ├── nfc/
        │   ├── {card_uid}.k1          ← NTAG424 AES-128 key (SUN/SDM)
        │   └── {card_uid}.k2          ← NTAG424 AES-128 key (secondary)
        ├── nip46/
        │   └── {session_id}.pairing   ← Encrypted NIP-46 ephemeral keypair + secret
        ├── agents/
        │   ├── {agent_npub}.nsec      ← Agent nsec (for runner-local agents)
        │   └── {agent_npub}.llm_keys  ← Encrypted LLM provider API keys
        └── cashu/
            └── {mint_url_hash}.proofs ← Encrypted Cashu proofs
```

### 2.2 Wrapping Key Derivation

The vault master key is encrypted under a wrapping key derived from one of two sources:

**Option A — WebAuthn (preferred):**
1. `navigator.credentials.create()` with `authenticatorSelection.userVerification: "required"` and `extensions.prf: { eval: { first: salt } }`.
2. The PRF output is 32 bytes of device-bound, user-verified key material.
3. This output is the wrapping key. It is never stored — it is re-derived on each unlock via `navigator.credentials.get()` with the same PRF extension.
4. The `credentialId` is stored in OPFS as `vault/webauthn.cred` (not secret — it is a public identifier).

**Option B — Passphrase (fallback for browsers without PRF support):**
1. User provides a passphrase (minimum 12 characters, enforced client-side).
2. `argon2id(passphrase, salt, { m: 65536, t: 3, p: 4 })` → 32-byte wrapping key.
3. The salt is stored in OPFS as `vault/passphrase.salt` (not secret — salt is public).
4. The argon2id parameters are stored alongside the salt for forward compatibility.

**In both cases:**
- The wrapping key encrypts/decrypts `vault/master.key` using AES-256-GCM.
- The master key is a random 256-bit key generated once during vault initialization.
- All other vault entries are encrypted under the master key using XChaCha20-Poly1305 (`@noble/ciphers`).
- The master key exists in JavaScript heap only while the vault is unlocked. On lock (tab close, explicit lock, idle timeout), the master key is zeroed.

### 2.3 Vault Operations API

```typescript
interface VaultOps {
  // Lifecycle
  initialize(method: 'webauthn' | 'passphrase', credential: Uint8Array | string): Promise<void>;
  unlock(method: 'webauthn' | 'passphrase', credential: Uint8Array | string): Promise<void>;
  lock(): void;
  isUnlocked(): boolean;

  // Identity
  storeNsec(npub: string, nsec: Uint8Array): Promise<void>;
  getNsec(npub: string): Promise<Uint8Array>;
  deleteNsec(npub: string): Promise<void>;
  listIdentities(): Promise<string[]>;

  // FROST
  storeBfprofile(groupNpub: string, profile: Uint8Array): Promise<void>;
  getBfprofile(groupNpub: string): Promise<Uint8Array>;
  storeBfshare(groupNpub: string, share: Uint8Array): Promise<void>;
  getBfshare(groupNpub: string): Promise<Uint8Array>;

  // NWC
  storeNwcUri(connectionId: string, uri: string): Promise<void>;
  getNwcUri(connectionId: string): Promise<string>;
  deleteNwcUri(connectionId: string): Promise<void>;

  // NFC
  storeNfcKey(cardUid: string, keySlot: 'k1' | 'k2', key: Uint8Array): Promise<void>;
  getNfcKey(cardUid: string, keySlot: 'k1' | 'k2'): Promise<Uint8Array>;

  // NIP-46
  storeNip46Pairing(sessionId: string, pairing: Nip46PairingState): Promise<void>;
  getNip46Pairing(sessionId: string): Promise<Nip46PairingState>;
  deleteNip46Pairing(sessionId: string): Promise<void>;

  // Agent
  storeAgentNsec(agentNpub: string, nsec: Uint8Array): Promise<void>;
  getAgentNsec(agentNpub: string): Promise<Uint8Array>;
  storeAgentLlmKeys(agentNpub: string, keys: EncryptedLlmKeys): Promise<void>;
  getAgentLlmKeys(agentNpub: string): Promise<EncryptedLlmKeys>;

  // Cashu
  storeCashuProofs(mintUrlHash: string, proofs: CashuProof[]): Promise<void>;
  getCashuProofs(mintUrlHash: string): Promise<CashuProof[]>;

  // Backup
  exportEncryptedBackup(): Promise<Uint8Array>;  // Full vault, encrypted under master key
  importEncryptedBackup(data: Uint8Array, wrappingKey: Uint8Array): Promise<void>;
}
```

### 2.4 Vault Security Invariants

1. **No key material in any storage other than OPFS.** Not localStorage. Not sessionStorage. Not IndexedDB (except as an OPFS polyfill on browsers without OPFS support, in which case the same encryption scheme applies). Not cookies. Not URL parameters. Not Supabase.
2. **No key material transmitted to any server.** The nsec is generated client-side. The npub (public key) is the only identity datum sent to the server (for NIP-05 binding).
3. **Vault auto-locks after 15 minutes of inactivity.** Configurable by Principal (minimum 5 minutes, maximum 60 minutes). Lock zeroes the master key from the JavaScript heap.
4. **Vault backup is encrypted.** The `exportEncryptedBackup()` output is the full vault contents encrypted under the master key. Restoring requires the wrapping key (WebAuthn credential or passphrase). A vault backup without the wrapping key is computationally infeasible to decrypt.
5. **No vault contents appear in error logs.** The vault module does not throw errors that include key material. All errors are typed enums with no data payload: `VaultLocked`, `IdentityNotFound`, `DecryptionFailed`, `StorageFull`.

---

## 3. Auth System — NIP-98 HTTP Authentication

v2 replaces the entire JWT/PBKDF2 auth system with NIP-98 HTTP Authentication. There is no JWT in v2. There is no `JWT_SECRET` environment variable. There is no `jsonwebtoken` package.

### 3.1 Client-Side Auth Flow

For every authenticated request to a Netlify function:

1. Client constructs a NIP-98 auth event (kind:27235):
   ```json
   {
     "kind": 27235,
     "created_at": <current_unix_timestamp>,
     "tags": [
       ["u", "<target_url>"],
       ["method", "<HTTP_METHOD>"],
       ["payload", "<sha256_of_request_body>"]   // only for POST/PUT/PATCH
     ],
     "content": ""
   }
   ```
2. Client signs the event with the Principal's nsec (from OPFS Vault).
3. Client base64-encodes the signed event JSON.
4. Client includes the encoded event in the `Authorization` header:
   ```
   Authorization: Nostr <base64_encoded_signed_event>
   ```

### 3.2 Server-Side Verification

Every Netlify function that requires authentication:

1. Extracts the `Authorization` header. Rejects if missing or not `Nostr` scheme.
2. Base64-decodes the event. Rejects if decode fails.
3. Validates the event:
   - `kind === 27235`
   - `created_at` is within ±60 seconds of server time (clock skew tolerance)
   - `u` tag matches the request URL
   - `method` tag matches the HTTP method
   - `payload` tag (if present) matches SHA-256 of the request body
   - Nostr signature is valid (secp256k1 Schnorr verification via `@noble/curves`)
4. Extracts `pubkey` from the verified event. This is the authenticated identity.
5. For role-gated operations: verifies NIP-26 delegation chain (Section 4).

### 3.3 Auth Middleware Module

```typescript
// lib/auth/nip98-verify.ts — runs in Netlify function context
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

interface AuthResult {
  authenticated: true;
  pubkey: string;          // hex-encoded pubkey of the signer
  delegatedBy?: string;    // hex-encoded pubkey of the delegator (if NIP-26)
  delegationConditions?: string;  // NIP-26 conditions string
}

interface AuthError {
  authenticated: false;
  reason: 'missing_header' | 'invalid_scheme' | 'decode_failed' |
          'wrong_kind' | 'expired' | 'url_mismatch' | 'method_mismatch' |
          'payload_mismatch' | 'invalid_signature' | 'delegation_invalid';
}

type AuthOutcome = AuthResult | AuthError;

export function verifyNip98(
  authHeader: string,
  requestUrl: string,
  httpMethod: string,
  requestBody?: Uint8Array
): AuthOutcome { /* ... */ }
```

### 3.4 Session Continuity

NIP-98 is per-request authentication. There is no session token. Each request is independently authenticated. This eliminates:
- Token theft (no token to steal)
- Token replay across endpoints (URL is bound into the auth event)
- Session fixation (no session)
- Refresh token rotation bugs (no refresh tokens)

For UX continuity (so the user does not re-enter their passphrase for every API call), the OPFS Vault remains unlocked in memory for the configured idle timeout. The nsec is available for signing as long as the vault is unlocked. When the vault locks, the user must re-authenticate (WebAuthn prompt or passphrase entry) to unlock it.

---

## 4. RBAC v2 — NIP-26 Delegation + FROST Threshold

### 4.1 Role Hierarchy

The four-level hierarchy is preserved from v1. The role names are correct (trust estate framing). The implementation changes completely.

```
Guardian (Trust Protector)
  └── Steward (Trustee)
        ├── Adult (Mature Beneficiary)
        │     ├── Adult (human)
        │     └── Adult (agent — NIP-SA autonomous)
        └── Offspring (Immature Beneficiary)
              ├── Offspring (human)
              └── Offspring (agent — NIP-SA supervised)
```

**Role capability matrix:**

| Capability | Guardian | Steward | Adult | Offspring |
|---|---|---|---|---|
| Create group | Yes | No | No | No |
| Add/remove members | Yes | Yes (≤Adult) | No | No |
| Sign NIP-26 delegation | Yes | Yes (for Adult/Offspring only) | No | No |
| Modify spending policy | Yes | Yes (within Guardian-set limits) | No | No |
| Spend (Lightning) | Yes | Yes | Yes (within policy) | Requires approval |
| Spend (Cashu) | Yes | Yes | Yes (within policy) | Requires approval |
| Create agent (NIP-SA) | Yes | Yes | Yes (within span of control) | No |
| Submit DVM job (NIP-90) | Yes | Yes | Yes | Requires approval |
| Receive DVM job (NIP-90 provider) | Yes | Yes | Yes | No |
| Publish NIP-CA attestation | Yes | No | No | No |
| Revoke NIP-CA attestation | Yes | No | No | No |
| Register skill (NIP-SKL) | Yes | Yes | Yes | No |
| FROST key ceremony (initiate) | Yes | No | No | No |
| FROST key ceremony (participate) | Yes | Yes | No | No |
| NFC Proof of Life ceremony | Yes | Yes | Yes | Yes (requires Guardian co-sign) |
| Export vault backup | Yes | Yes | Yes | No |

### 4.2 NIP-26 Delegation Events

Every role assignment in v2 is a NIP-26 delegation event. There is no database-backed role table.

**Delegation event structure:**

A Guardian delegating Steward authority to pubkey `P`:
```json
{
  "kind": 1,
  "pubkey": "<guardian_pubkey>",
  "created_at": <timestamp>,
  "tags": [
    ["delegation", "<steward_pubkey>", "kind=1&kind=4&kind=9735&kind=27235&kind=39200&created_at<1735689600", "<guardian_sig_over_conditions>"]
  ],
  "content": "NIP-26 delegation: steward role granted to <steward_npub>"
}
```

The `conditions` string restricts:
- Which event kinds the delegate can sign on behalf of the delegator
- Time bounds (`created_at<` for expiry)
- Additional constraints per the NIP-26 spec

**Delegation verification:**

When a function receives a NIP-98 auth event, it checks:
1. Is the `pubkey` directly authorized? (Guardian-level operations)
2. Does the event include a NIP-26 delegation tag? If so:
   a. Extract the delegator pubkey and conditions string
   b. Verify the delegation signature (`schnorr.verify()`)
   c. Verify the current event satisfies all conditions (kind matches, timestamp within bounds)
   d. The authenticated identity is the delegator, acting through the delegate

**Delegation chain storage:**

Delegation events are published to Pylon and cached locally in IndexedDB (encrypted under vault master key). The client maintains a local delegation graph:
```typescript
interface DelegationGraph {
  // Returns the chain of delegation from a pubkey back to a Guardian
  getChain(pubkey: string): DelegationEvent[];
  // Returns all active delegations issued by a pubkey
  getDelegationsFrom(pubkey: string): DelegationEvent[];
  // Verifies a delegation chain is valid at a given timestamp
  verifyChainAt(pubkey: string, timestamp: number): boolean;
  // Refreshes from relay
  syncFromRelay(relay: WebSocket): Promise<void>;
}
```

### 4.3 FROST Threshold Signatures

Group operations that require the group keypair (group profile updates, group payment authorizations, group attestation issuance) use FROST threshold signatures via `@frostr/bifrost@2.0.2`.

**Group key ceremony (one-time setup):**

1. Guardian initiates a FROST Distributed Key Generation (DKG) ceremony.
2. Participants: Guardian (share #1), Steward (share #2), and optionally additional Stewards (shares #3..#n).
3. Threshold: 2-of-n (Guardian + any Steward, or 2 Stewards if Guardian grants that policy).
4. Each participant runs the DKG protocol and stores their `bfshare` in OPFS Vault.
5. The group `bfprofile` (containing the group public key and threshold metadata, but no secret material) is stored in each participant's OPFS Vault and published as a kind:39200 agent profile event to Pylon.
6. The group pubkey is derived from the DKG output. No party ever holds the full group nsec.

**Group signing ceremony (per-operation):**

1. Initiator creates a signing request (the unsigned Nostr event to be signed by the group).
2. Initiator publishes the request to the FROST coordinator channel (Nostr relay, ephemeral kind).
3. Threshold number of participants (e.g., 2-of-3) respond with their partial signatures.
4. Initiator combines partial signatures into the final Schnorr signature.
5. The signed event is published to the target relay(s).

**FROST share rotation:**

Shares can be rotated without changing the group public key. This is a cryptographic invariant of FROST — the group identity is preserved across share rotations. Rotation is triggered by: Guardian decision, suspected share compromise, member departure, or scheduled rotation policy.

**FROST share backup:**

Each participant's `bfshare` is backed up encrypted via kind:10000 Nostr event (encrypted to self using NIP-44). The backup is recoverable from any Nostr relay that stores the event. Decryption requires the participant's nsec.

---

## 5. NFC / PIN Gate

### 5.1 Supported Hardware

| Card | Protocol | v2 Role |
|---|---|---|
| NTAG424 DNA TT | ISO 14443-4, SUN/SDM with AES-128-CMAC | Primary identity/ceremony card |
| TapSigner | CKTAP protocol | Nostr signer adapter (signs events on-card) |

BoltCard/LNbits integration is eliminated. NFC payment functionality is handled through NWC, not through direct card-to-LNbits flows.

### 5.2 Client-Side CMAC Verification

The CMAC verification path is moved entirely to the client. The server never sees CMAC values.

**Flow:**

1. User taps NTAG424 card to device (Web NFC API on Android Chrome).
2. Browser reads NDEF record containing the SUN message: `piccDataHex` (UID + read counter, encrypted) and `cmacHex` (AES-128-CMAC over the message).
3. Client retrieves the card's AES-128 SUN key (K2) from OPFS Vault (`nfc/{card_uid}.k2`).
4. Client computes expected CMAC using `@noble/ciphers` AES-128-CMAC:
   ```typescript
   import { cmac } from '@noble/ciphers/aes';
   const expectedCmac = cmac(aes128, key, message);
   const isValid = timingSafeEqual(expectedCmac, receivedCmac);
   ```
5. Client verifies the read counter is monotonically increasing (stored in OPFS, incremented after each successful verification).
6. If CMAC is valid and counter is valid: card presence is proven.
7. Client sends only the verification result (true/false) and the card UID to the serverless function for ceremony progression.

### 5.3 PIN Gate

Every NFC-triggered operation that modifies identity state requires PIN confirmation before execution.

**PIN verification flow:**

1. User taps card → CMAC verified client-side (Section 5.2).
2. UI presents PIN entry dialog.
3. User enters PIN (4-8 digits).
4. Client derives PIN verifier: `argon2id(pin, card_uid_as_salt, { m: 65536, t: 3, p: 4 })` → 32-byte verifier.
5. Client compares verifier against stored verifier in OPFS Vault (`nfc/{card_uid}.pin_verifier`).
6. If PIN is correct: client constructs a PIN-bound operation token: `HMAC-SHA256(operation_payload, pin_derived_key)`.
7. The operation token is included in the request to the serverless function. The function verifies the HMAC using a server-side copy of the PIN verifier hash (not the PIN itself — the verifier is a one-way derived value that the server can use to verify the HMAC without recovering the PIN).

**PIN-gated operations:**
- Contact addition/removal
- Proof of Life ceremony publication
- Payment authorization above threshold
- Group membership changes
- Agent delegation changes

### 5.4 Proof of Life Ceremony

New in v2. A state machine for proving physical presence of a card holder.

**States:**
```
IDLE → INITIATED → CARD_TAPPED → PIN_VERIFIED → SIGNED → PUBLISHED → CONFIRMED
                                                    ↓
                                              FAILED (timeout, wrong PIN, invalid CMAC)
```

**Event kind:** The Proof of Life event is a kind:30078 (NIP-78 app-specific data) with `d` tag `satnam:proof-of-life` and content containing:
- Timestamp of the ceremony
- Card UID hash (not the UID itself — privacy)
- Guardian pubkey who initiated or witnessed
- CMAC counter value at time of proof (monotonic — proves recency)
- Optional: GPS coordinates (opt-in, ephemeral, not stored — only included if user consents at ceremony time)

### 5.5 iOS NFC Fallback

Web NFC API is Android Chrome-only. For iOS:

1. Universal Link / App Clip: register `satnam.pub/nfc/{card_uid}` as a Universal Link.
2. When an NTAG424 card is tapped on iOS, the SUN URL triggers Safari to open the Universal Link.
3. The URL includes `piccDataHex` and `cmacHex` as query parameters (as configured in the NTAG424 SUN URL template).
4. The Satnam PWA intercepts the URL, extracts the parameters, and runs the same CMAC verification flow as Android.
5. Limitation: iOS does not support writing to NFC tags via Web NFC. Card provisioning (writing AES keys during setup) requires Android or a dedicated NFC writer tool.

---

## 6. Payment Rails

### 6.1 NWC Abstraction Layer

All Lightning operations go through NWC (NIP-47). No direct daemon APIs (PhoenixD, LNbits, CLN) in v2.

**Supported NWC methods:**

| Method | Required | Purpose |
|---|---|---|
| `pay_invoice` | Yes | Pay a BOLT-11 invoice |
| `make_invoice` | Yes | Generate a BOLT-11 invoice for receiving |
| `get_balance` | Yes | Query wallet balance (sats) |
| `lookup_invoice` | Yes | Check invoice payment status |
| `list_transactions` | Yes | Transaction history |
| `pay_keysend` | Optional | Keysend payment (for zaps without invoice) |
| `multi_pay_invoice` | Optional | Batch payment (for NIP-90 split payments) |

**NWC Connection Manager:**

```typescript
interface NwcConnectionManager {
  // Connection lifecycle
  addConnection(label: string, nwcUri: string): Promise<string>;  // returns connectionId
  removeConnection(connectionId: string): Promise<void>;
  listConnections(): Promise<NwcConnection[]>;
  getDefaultConnection(): Promise<NwcConnection | null>;
  setDefaultConnection(connectionId: string): Promise<void>;

  // Operations (use default connection unless specified)
  payInvoice(bolt11: string, connectionId?: string): Promise<PaymentResult>;
  makeInvoice(amountMsats: bigint, description: string, connectionId?: string): Promise<string>;
  getBalance(connectionId?: string): Promise<bigint>;  // msats
  lookupInvoice(paymentHash: string, connectionId?: string): Promise<InvoiceStatus>;
  listTransactions(options: TxListOptions, connectionId?: string): Promise<Transaction[]>;
}
```

**NWC URI storage:** Encrypted in OPFS Vault (`nwc/{connectionId}.uri`). The URI contains the relay URL, the wallet pubkey, and the connection secret. It never touches Supabase or any server.

**Wallet backend compatibility:** NWC is wallet-agnostic. The following backends are supported without any Satnam code changes:
- Alby Hub (self-hosted or cloud)
- PhoenixD (via NWC bridge)
- LND (via NWC bridge — Alby, LNbits NWC extension)
- CLN (via NWC bridge)
- Mutiny (deprecated but functional)
- Any NIP-47 compliant wallet

### 6.2 Cashu / eCash

Cashu is the eCash rail for privacy-preserving micropayments.

**Use cases in v2:**
1. **Blind tokens for metered access:** Platform actions (event publish, task creation, contact addition, DM send) are metered via Cashu blind tokens with sat-denominated prices. Ported from v1 agent token system.
2. **Agent-to-agent micropayments:** Agents use Cashu for sub-invoice-minimum payments where Lightning routing would be uneconomical.
3. **Sig4Sats performance bonds:** Task completion bonds are posted as Cashu tokens, redeemed on successful completion.
4. **Privacy preference:** When a user/agent prefers maximum privacy (no Lightning routing metadata), Cashu is the preferred spend rail.

**Cashu client interface:**

```typescript
interface CashuClient {
  // Mint management
  addMint(mintUrl: string): Promise<void>;
  removeMint(mintUrl: string): Promise<void>;
  listMints(): Promise<MintInfo[]>;

  // Token operations
  mintTokens(amountSats: number, mintUrl: string): Promise<CashuProof[]>;
  meltTokens(proofs: CashuProof[], bolt11: string): Promise<MeltResult>;
  sendTokens(amountSats: number, mintUrl: string): Promise<string>;  // returns serialized token
  receiveTokens(serializedToken: string): Promise<CashuProof[]>;
  getBalance(mintUrl?: string): Promise<number>;  // total sats across proofs

  // Proof management
  checkProofStatus(proofs: CashuProof[]): Promise<ProofStatus[]>;
  swapProofs(proofs: CashuProof[], mintUrl: string): Promise<CashuProof[]>;
}
```

**Cashu proof storage:** Encrypted in OPFS Vault (`cashu/{mint_url_hash}.proofs`). Proofs are the bearer instruments — if leaked, the sats are lost. The vault encryption is the only protection.

**Allowed mints:** Configurable per group policy. Guardian sets the list of allowed Cashu mint URLs. Default: only mints operated by the group or by OpenAgents. The `allowed_mints` policy field from v1 agent profiles is preserved.

### 6.3 Agent Wallet

Agents (NIP-SA autonomous entities) have their own wallet interface, enforcing spend policies set by their Governor (Guardian or Steward).

**Spend policy enforcement (ported from v1 — schema correct, implementation refactored):**

```typescript
interface AgentSpendPolicy {
  max_single_spend_msats: bigint;     // Maximum per-transaction
  daily_limit_msats: bigint;          // Rolling 24h limit
  requires_approval_above_msats: bigint;  // Human-in-the-loop threshold
  preferred_spend_rail: 'lightning' | 'cashu' | 'auto';
  allowed_mints: string[];            // Cashu mint URLs
  sweep_threshold_msats: bigint;      // Auto-sweep when balance exceeds
  sweep_destination: string;          // NWC connection or Cashu mint
  sweep_rail: 'lightning' | 'cashu';
}
```

**Rail selection logic (ported from v1 `agent-wallet-helpers.ts` — stateless, clean):**

```typescript
function selectSpendRail(
  amount_msats: bigint,
  policy: AgentSpendPolicy,
  privacy_preference: 'standard' | 'high'
): 'lightning' | 'cashu' {
  if (policy.preferred_spend_rail !== 'auto') return policy.preferred_spend_rail;
  if (privacy_preference === 'high') return 'cashu';
  if (amount_msats < 1000n) return 'cashu';  // Sub-1-sat routing uneconomical on LN
  return 'lightning';
}
```

### 6.4 LLM Cost Tracking

Ported from v1 `agent-llm-proxy.ts` — the BigInt msats math is correct and preserved.

```typescript
function calculateSatsCostFromPricing(
  inputTokens: number,
  outputTokens: number,
  pricing: LlmModelPricing,
  btcUsdRate: number
): bigint {
  const inputCostUsd = (inputTokens / 1_000_000) * pricing.input_price_per_million;
  const outputCostUsd = (outputTokens / 1_000_000) * pricing.output_price_per_million;
  const totalCostUsd = inputCostUsd + outputCostUsd;
  const totalCostBtc = totalCostUsd / btcUsdRate;
  const totalCostMsats = BigInt(Math.ceil(totalCostBtc * 100_000_000_000));
  return totalCostMsats;
}
```

The FX snapshot (`btcUsdRate`) is fetched client-side, feature-flag gated (`VITE_FX_ENABLED`), and used for display/cost accounting only. No fiat values are stored in any persistent column.

---

## 7. NIP Triumvirate — NIP-SA, NIP-AC, NIP-SKL

The three custom NIPs form the agent economic layer. Their canonical definitions live in the [OpenAgents monorepo](https://github.com/OpenAgentsInc/openagents) under `crates/nostr/core/src/`. Satnam v2 implements the client-side TypeScript equivalents.

### 7.1 NIP-SA: Sovereign Agents (kinds 39200–39231)

**Event kinds implemented:**

| Kind | Name | Satnam v2 Surface |
|---|---|---|
| 39200 | Agent Profile | Agent creation UI, `.well-known/agent.json` endpoint, group dashboard |
| 39201 | Agent State | NIP-44 encrypted; managed by agent runner, displayed in monitoring dashboard |
| 39202 | Agent Schedule | Heartbeat interval config in agent setup UI |
| 39203 | Agent Goals | Optional transparency toggle in agent config |
| 39210 | Tick Request | Ephemeral; displayed in monitoring dashboard if subscribed |
| 39211 | Tick Result | Ephemeral; displayed in monitoring dashboard if subscribed |
| 39220 | Skill License | Issued when a marketplace grants an agent access to a skill |
| 39221 | Skill Delivery | Gift-wrapped skill content delivery |
| 39230 | Trajectory Session | Agent session metadata for Probe integration |
| 39231 | Trajectory Event | Individual steps in an agent trajectory |

**Agent Profile (kind:39200) construction:**

Ported from v1 `nip-sa-agent.js` and `well-known-agent.js`. Refactored to remove JWT auth and Supabase storage. The profile is now:
1. Constructed client-side as a Nostr event.
2. Signed by the agent's nsec (or by the Governor via NIP-26 delegation for Offspring agents).
3. Published to Pylon and public relays via CEPS.
4. The `.well-known/agent.json` Netlify function reads the profile from relay (cached with TTL) and serves it in the standard discovery format.

**Agent profile content (JSON):**

```json
{
  "name": "ResearchBot-7",
  "about": "Researches market data and produces summaries",
  "picture": "https://satnam.pub/agents/research-bot-7.png",
  "capabilities": ["research", "summarization", "nip90-provider"],
  "autonomy_level": "bounded",
  "version": "2.0.0"
}
```

**Agent profile tags:**

```json
[
  ["d", "profile"],
  ["threshold", "2", "3"],
  ["operator", "<governor_pubkey>"],
  ["signer", "<group_pubkey>"],
  ["lud16", "research-bot-7@satnam.pub"],
  ["nip05", "research-bot-7@satnam.pub"],
  ["enabled_skills", "<skill_scope_id_1>", "<skill_scope_id_2>"],
  ["wallet_policy", "{\"max_single_spend\":10000,\"daily_limit\":100000,\"preferred_rail\":\"auto\"}"],
  ["coordination_relay", "wss://pylon.openagents.com"],
  ["coordination_relay", "wss://relay.satnam.pub"]
]
```

### 7.2 NIP-AC: Agent Credit (kinds 39240–39245)

The credit lifecycle for machine-to-machine commerce:

```
Intent (39240) → Offer (39241) → Envelope (39242) → Spend Auth (39243) → Settlement (39244)
                                                                              ↓
                                                                    Default Notice (39245)
```

**Satnam v2 implements the consumer side:**

1. **Credit Intent (kind:39240):** Principal or Agent publishes a need (e.g., "research 5 companies, budget 5000 sats, deadline 1 hour"). Constructed via the DVM job submission UI.
2. **Credit Offer (kind:39241):** Received from DVM providers. Displayed in the marketplace UI for Principal review.
3. **Credit Envelope (kind:39242):** Accepted offer becomes an envelope — the authority state machine. The `scope_constraints_hash` ties the envelope to a specific skill manifest (NIP-SKL). Satnam constructs and publishes this event, ported from v1 `credit-envelope-lifecycle.ts` (NIP-AC field validation and CEPS publishing are preserved).
4. **Spend Authorization (kind:39243):** When an agent needs to spend against an envelope, Satnam signs the spend auth event within the envelope's `max_sats` cap.
5. **Settlement Receipt (kind:39244):** Published after task completion. Includes Cashu token redemption proof for Sig4Sats bonds.
6. **Default Notice (kind:39245):** Published if an envelope expires without settlement. Triggers reputation penalty.

**Reputation delta calculation (ported from v1 — correct):**

```typescript
const base_rep = task_completion_score * weight;
const sig4sats_bonus = has_performance_bond ? base_rep * 0.15 : 0;
const total_rep_delta = base_rep + sig4sats_bonus;
```

### 7.3 NIP-SKL: Skill Registry (kinds 33400–33401)

**Skill Manifest (kind:33400):**

Ported from v1 `nip-skl-registry.js`. The registry function is refactored:
- v1: JWT auth → Supabase insert
- v2: NIP-98 auth → Nostr event verification → relay publish (CEPS) + optional Supabase cache for fast queries

**Skill manifest tags:**

```json
[
  ["d", "research-v2"],
  ["name", "Market Research"],
  ["version", "2.0.0"],
  ["description", "Researches market data across public sources"],
  ["manifest_hash", "<sha256_of_canonical_payload>"],
  ["capability", "web_search"],
  ["capability", "data_extraction"],
  ["capability", "summarization"],
  ["t", "agent-skill"],
  ["t", "research"],
  ["expiry", "<unix_timestamp>"]
]
```

**Skill Attestation (kind:1985, NIP-32 labels):**

Guardians attest skills via NIP-32 label events:
```json
{
  "kind": 1985,
  "tags": [
    ["L", "skill"],
    ["l", "skill/verified", "skill"],
    ["l", "tier3", "skill"],
    ["e", "<skill_manifest_event_id>"]
  ]
}
```

Attestation tiers (ported from v1): `tier1` (self-declared), `tier2` (peer-reviewed), `tier3` (guardian-attested), `tier4` (oracle-verified).

**Skill Version Log (kind:33401):**

Tracks version history with `previousVersion`, `changeType` (major/minor/patch), and optional `revokedAt` for deprecated versions.

**Runtime gate (typed in v1, implemented in v2):**

```typescript
interface RuntimeGateResult {
  manifestExists: boolean;
  guardianAttestationValid: boolean;
  noRevocation: boolean;
  versionPinMatches: boolean;
  constraintsSatisfied: boolean;
}

function verifySkillExecution(
  skillScopeId: string,
  agentPubkey: string,
  requiredAttestation: AttestationTier
): RuntimeGateResult { /* ... */ }
```

In v2, `verifySkillExecution()` is implemented as executable code (not just types). It is called before any agent executes a skill, blocking execution if any gate check fails.

---

## 8. OpenAgents Integration

### 8.1 NIP-90 DVM Marketplace (Autopilot)

The complete NIP-90 client stack, absent from v1:

**Job Request (kind:5xxx):**

```typescript
interface DvmJobRequest {
  kind: number;           // 5000-5999 per NIP-90 (5100 for text generation, etc.)
  input: DvmInput[];      // Input data items
  params: DvmParam[];     // Job parameters
  bid_msats?: bigint;     // Maximum price willing to pay
  relays?: string[];      // Preferred result relays
  encryptTo?: string;     // Pubkey for NIP-44 encryption of results
}

function constructJobRequest(request: DvmJobRequest): UnsignedEvent {
  const tags: string[][] = [];
  for (const input of request.input) {
    tags.push(['i', input.data, input.type, ...(input.relay ? [input.relay] : [])]);
  }
  for (const param of request.params) {
    tags.push(['param', param.key, param.value]);
  }
  if (request.bid_msats) {
    tags.push(['bid', request.bid_msats.toString()]);
  }
  if (request.relays) {
    for (const relay of request.relays) {
      tags.push(['relays', relay]);
    }
  }
  if (request.encryptTo) {
    tags.push(['encrypted']);
  }
  return {
    kind: request.kind,
    tags,
    content: request.encryptTo ? nip44Encrypt(JSON.stringify(request.input), request.encryptTo) : '',
    created_at: Math.floor(Date.now() / 1000),
  };
}
```

**Job Result (kind:6xxx):**

Subscription filter:
```typescript
const resultFilter = {
  kinds: [request.kind + 1000],  // 6xxx = 5xxx + 1000
  '#e': [requestEventId],
};
```

Result parsing extracts the `amount` tag (invoice or payment info), `content` (result data, possibly NIP-44 encrypted), and `status` tag.

**Job Feedback (kind:7000):**

Published by the consumer after receiving results:
```json
{
  "kind": 7000,
  "tags": [
    ["e", "<job_request_event_id>"],
    ["e", "<job_result_event_id>"],
    ["p", "<provider_pubkey>"],
    ["status", "success"],
    ["amount", "5000", "msats"]
  ],
  "content": "Result was accurate and timely."
}
```

**Provider Discovery (kind:31990):**

Subscription filter for discovering DVM providers:
```typescript
const providerFilter = {
  kinds: [31990],
  '#k': [targetJobKind.toString()],  // e.g., "5100" for text generation
};
```

The marketplace UI displays providers with their capabilities, pricing, reputation scores, and NIP-SKL skill attestations.

**Payment flow:**

1. Provider's job result includes an `amount` tag with a BOLT-11 invoice (or Cashu token request).
2. Satnam presents the invoice to the Principal for approval (or auto-pays if within agent spend policy).
3. Payment is executed via NWC (`payInvoice(bolt11)`).
4. Payment confirmation event (kind:7000 feedback with payment proof) is published.

### 8.2 Probe Session Protocol

Probe is the OpenAgents coding agent. Satnam provides the management interface.

**Session monitoring:**

Satnam subscribes to Probe trajectory events (kinds 39230, 39231) on Pylon:
```typescript
const probeSessionFilter = {
  kinds: [39230, 39231],
  '#p': [agentPubkey],  // Probe agent's pubkey
  since: sessionStartTimestamp,
};
```

**Tool call approval UI:**

Probe publishes tool call events as kind:39231 trajectory events with a `tool_call` tag. Satnam renders:
1. Tool name and parameters
2. Approve / Reject / Modify buttons
3. Approval response is published as a kind:39231 event with `tool_approval` tag

This extends the v1 `TaskChallengeDialog.tsx` concept from task-level to per-tool-call granularity.

**Session diff display:**

kind:39231 events with `diff` tags are rendered as code diffs in the Probe session panel. The diff renderer uses a lightweight syntax highlighter (no heavy dependency — CSS-based highlighting with `<pre><code>` blocks and line-number gutters).

**Execution result display:**

kind:39231 events with `result` tags are rendered as structured output: stdout/stderr blocks, file change summaries, test results.

### 8.3 Pylon Relay (NIP-42 AUTH)

Pylon is the OpenAgents authenticated relay. Connection requires NIP-42 AUTH.

**NIP-42 AUTH flow:**

1. Client opens WebSocket to `wss://pylon.openagents.com`.
2. Relay sends `["AUTH", "<challenge_string>"]`.
3. Client constructs a kind:22242 auth event:
   ```json
   {
     "kind": 22242,
     "tags": [
       ["relay", "wss://pylon.openagents.com"],
       ["challenge", "<challenge_string>"]
     ],
     "content": ""
   }
   ```
4. Client signs the event with the Principal's nsec and sends `["AUTH", <signed_event>]`.
5. Relay verifies the signature and grants authenticated access.

**CEPS integration:**

The v1 CEPS (Central Event Publishing Service) is extended with Pylon-specific behavior:
- Pylon is the primary relay for all agent coordination events (kinds 39200-39245).
- CEPS handles the NIP-42 AUTH challenge/response automatically on connection.
- Fallback relays are configured via NIP-65 (kind:10002) relay list.
- If Pylon is unreachable, CEPS queues events for retry with exponential backoff and publishes to fallback relays immediately.

### 8.4 SpacetimeDB Bridge

SpacetimeDB is used by OpenAgents for real-time coordination. Satnam v2 bridges to it rather than replacing it.

**Bridge architecture:**

Satnam does not add `@clockworklabs/spacetimedb-sdk` as a direct dependency (axiom 4 — minimize deps). Instead, it bridges via Pylon relay events:

1. **Presence sync:** Satnam publishes presence events (kind:10003, custom) to Pylon. A Pylon-side bridge module (part of the OpenAgents Pylon deployment, not Satnam's responsibility) translates these into SpacetimeDB `session_presence` table inserts.
2. **Session sync:** Agent session state changes (start, pause, resume, terminate) are published as NIP-SA state events (kind:39201) to Pylon. The bridge translates to SpacetimeDB `sync_event` entries.
3. **Compute assignment subscription:** Satnam subscribes to Pylon for kind:39242 (Credit Envelope) events that reference the Principal's or Agent's pubkey, which represent compute assignments routed from SpacetimeDB.

**SpacetimeDB tables bridged (from [OpenAgents autopilot-spacetime schema](https://github.com/OpenAgentsInc/openagents)):**

| SpacetimeDB Table | Bridge Direction | Nostr Event Kind |
|---|---|---|
| `session_presence` | Satnam → SpacetimeDB (via Pylon) | kind:10003 (presence) |
| `sync_event` | Bidirectional | kind:39201 (agent state) |
| `sync_checkpoint` | SpacetimeDB → Satnam (via Pylon) | kind:39231 (trajectory event) |
| `provider_capability` | Satnam → SpacetimeDB (via Pylon) | kind:31990 (NIP-90 provider) |
| `compute_assignment` | SpacetimeDB → Satnam (via Pylon) | kind:39242 (credit envelope) |
| `bridge_outbox` | SpacetimeDB → Satnam (via Pylon) | kind:39211 (tick result) |
| `presence_event` | Satnam → SpacetimeDB (via Pylon) | kind:10003 (presence) |

This bridge pattern means Satnam depends only on Nostr relay connections (already required) and does not add SpacetimeDB SDK to the client bundle. The translation logic lives server-side in Pylon.

---

## 9. Infrastructure

### 9.1 Supabase (Constrained)

Supabase is retained for exactly four purposes. No key material. No auth tokens. No session state.

**Retained tables:**

| Table | Purpose | Data Classification |
|---|---|---|
| `nip05_identifiers` | NIP-05 name → npub mapping (`user@satnam.pub` → pubkey) | Public |
| `lightning_addresses` | Lightning address → LNURL routing | Public |
| `rate_limits` | Per-IP and per-pubkey rate limiting for serverless functions | Operational |
| `username_reservations` | Short-lived reservation during registration flow | Operational |

**Dropped tables (v1 → v2 migration):**

All of the following are dropped in the decommission migration:
- `user_identities` (encrypted_nsec, user_salt, all auth columns)
- `family_federations` → no replacement (group identity is Nostr-native)
- `family_members` → no replacement (roles are NIP-26 delegation events)
- `secret_shares` → no replacement (FROST replaces SSS)
- `password_recovery_keys` → no replacement (FROST share backup)
- `pkarr_records` and all PKARR-related tables
- `trust_provider_*` tables
- `citadel_*` / badge tables
- All 23 agent-related migration tables (agent sessions, profiles, etc. — v2 agent data is Nostr-native)
- `admin_hierarchy`, `signing_permissions`, `nfc_mfa_setup`

### 9.2 Netlify Functions (≤8)

| # | Function | Auth | Purpose | Data Handled |
|---|---|---|---|---|
| 1 | `nip05-resolver` | None | Serves `/.well-known/nostr.json` | Public NIP-05 mappings from Supabase |
| 2 | `well-known-agent` | None | Serves `/.well-known/agent.json` | Cached NIP-SA profiles from relay |
| 3 | `check-username` | None | Username availability check | Public Supabase query |
| 4 | `register-identity` | NIP-98 | Register NIP-05 name + Lightning address | npub + username + lud16 (no nsec) |
| 5 | `nwc-proxy` | NIP-98 | NWC connection relay proxy | Encrypted NWC payloads (pass-through) |
| 6 | `simpleproof-anchor` | NIP-98 | OpenTimestamps Bitcoin anchoring | Public attestation event IDs |
| 7 | `issuer-registry` | NIP-98 | NIP-CA issuer discovery | Public issuer pubkeys and metadata |
| 8 | `unified-comms` | NIP-98 | NIP-17 gift-wrapped message relay | Encrypted messages (pass-through) |

**Functions eliminated from v1:**
- All `auth-*` functions (replaced by NIP-98)
- All `family-*` functions (replaced by Nostr events)
- All `pkarr-*` functions (feature cut)
- All `trust-*` functions (feature cut)
- All `agent-session-*` functions (Nostr-native in v2)
- All `agent-wallet-*` functions (client-side in v2)
- `btc-price.ts`, `bitcoin-fee-estimate.ts` (client-side fetch)
- `lnbits-proxy.ts`, `phoenixd-status.js` (NWC replaces)
- `badge-system.ts` (feature cut)
- `iroh-proxy.ts` (feature cut)
- `did-json.ts` (W3C VC cut)

### 9.3 PWA Architecture

v2 is a Progressive Web App. No Capacitor. No React Native.

**PWA manifest (`manifest.webmanifest`):**

```json
{
  "name": "Satnam",
  "short_name": "Satnam",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#f7931a",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

**Service Worker (`sw.js`):**

- Cache-first strategy for static assets (HTML, CSS, JS, fonts, icons)
- Network-first strategy for API calls (Netlify functions)
- Offline fallback page for when network is unavailable
- Background sync for queued Nostr events (published when connectivity returns)

**Font self-hosting:**

Cinzel font (used in v1 from Google Fonts CDN) is self-hosted in `/public/fonts/`. No external font CDN dependencies. The `<link>` tag to `fonts.googleapis.com` is removed.

```css
@font-face {
  font-family: 'Cinzel';
  src: url('/fonts/cinzel-v21-latin-regular.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
```

### 9.4 Content Security Policy

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
connect-src 'self' wss://pylon.openagents.com wss://*.nostr.com wss://*.relay.* https://*.supabase.co;
img-src 'self' data: blob: https:;
font-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
```

Key points:
- `'wasm-unsafe-eval'` required for FROSTR bifrost WASM bridge
- No `'unsafe-eval'` — no `eval()` permitted
- `font-src 'self'` — no external font CDN
- `connect-src` explicitly lists allowed relay origins
- `frame-ancestors 'none'` — no embedding in iframes (clickjacking protection)

---

## 10. Salvage Manifest

The following components are copied from `OV1-Kenobi/satnam_pub` into the new v2 repository. Each item is decontaminated: all JWT imports, Supabase auth calls, `getRequestClient()`, `SecureSessionManager.validateSession()`, and `getSupabaseClient()` for key material tables are stripped during copy.

| # | Component | Source Path(s) | Decontamination Required | v2 Target Path |
|---|---|---|---|---|
| 1 | CEPS (Central Event Publishing Service) | `src/lib/central_event_publishing_service.ts` | Remove JWT-gated relay auth; add NIP-42 AUTH handler | `src/lib/ceps/` |
| 2 | NIP-17 gift-wrapped messaging | `src/lib/nip17/` | None — correctly implemented | `src/lib/nip17/` |
| 3 | NTAG424 production client | `src/lib/ntag424-production.ts` | Remove server CMAC routing; add client-side CMAC verification | `src/lib/nfc/ntag424.ts` |
| 4 | NWC modal + connection management | `src/components/NWCModal.tsx`, `NWCWalletSetupModal.tsx` | Remove Supabase URI storage; add OPFS Vault storage | `src/components/wallet/` |
| 5 | NIP-05 resolver | `netlify/functions_active/nip05-resolver.ts` | None — reads public Supabase table | `netlify/functions/nip05-resolver.ts` |
| 6 | NIP-SKL registry types + schema | `types/nip-skl.ts`, `nip-skl-registry.js` schema logic | Remove JWT auth; add NIP-98; extract Nostr event verification logic | `src/lib/nip-skl/` |
| 7 | NIP-SA agent profile types + schema | `types/nip-sa.ts`, `nip-sa-agent.js` schema logic, `well-known-agent.js` | Remove JWT auth; add NIP-98; refactor to CEPS publish | `src/lib/nip-sa/` |
| 8 | Agent wallet helpers | `agent-wallet-helpers.ts` | None — stateless utilities | `src/lib/agent/wallet-helpers.ts` |
| 9 | Task challenge/evaluator types | `TaskChallengeEvaluator`, `AdaptiveDelegationCoordinator` types | None — framework-agnostic types | `src/lib/agent/delegation.ts` |
| 10 | Agent session types | `types/agent-sessions.ts` | None — framework-agnostic types | `src/lib/agent/session-types.ts` |
| 11 | Blind token types + pricing | `types/agent-tokens.ts`, `agent-action-pricing.ts` | None — clean type definitions | `src/lib/agent/tokens.ts` |
| 12 | LLM cost math | `calculateSatsCostFromPricing()` from `agent-llm-proxy.ts` | Extract function only — strip Netlify function wrapper | `src/lib/agent/llm-cost.ts` |

**Components explicitly NOT salvaged (from addendum):**
- 23 agent-related Supabase migrations (JWT session assumptions, `family_*` naming)
- Agent session Netlify functions (JWT-coupled)
- `create-agent-with-fees.ts` (no auth token, JWT-coupled)
- `task-complete.ts` (all integration points are mocks)

---

## 11. Database Schema

### 11.1 v2 Supabase Schema

```sql
-- v2 schema: minimal, no key material, no auth tokens

-- NIP-05 name registry
CREATE TABLE nip05_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  pubkey TEXT NOT NULL,           -- hex-encoded Nostr pubkey
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_nip05_pubkey ON nip05_identifiers(pubkey);
CREATE INDEX idx_nip05_username ON nip05_identifiers(username);

-- Lightning address routing
CREATE TABLE lightning_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE REFERENCES nip05_identifiers(username),
  lnurl_callback TEXT NOT NULL,   -- LNURL-pay callback URL (from NWC or self-hosted)
  min_sendable_msats BIGINT NOT NULL DEFAULT 1000,
  max_sendable_msats BIGINT NOT NULL DEFAULT 100000000000,
  metadata_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rate limiting
CREATE TABLE rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,       -- IP address or pubkey
  endpoint TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (identifier, endpoint, window_start)
);

CREATE INDEX idx_rate_limits_lookup ON rate_limits(identifier, endpoint, window_start);

-- Username reservation (short-lived during registration)
CREATE TABLE username_reservations (
  username TEXT PRIMARY KEY,
  reserved_by_pubkey TEXT NOT NULL,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes')
);

-- RLS: nip05_identifiers readable by all, writable by authenticated function
ALTER TABLE nip05_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY nip05_read ON nip05_identifiers FOR SELECT USING (true);
CREATE POLICY nip05_write ON nip05_identifiers FOR ALL USING (
  current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
);

-- Same pattern for other tables
ALTER TABLE lightning_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY la_read ON lightning_addresses FOR SELECT USING (true);
CREATE POLICY la_write ON lightning_addresses FOR ALL USING (
  current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY rl_all ON rate_limits FOR ALL USING (
  current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
);

ALTER TABLE username_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ur_all ON username_reservations FOR ALL USING (
  current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
);
```

Note: Supabase RLS policies reference `service_role` because Netlify functions use the Supabase service role key (stored as a Netlify environment variable) to read/write these tables. No user-facing JWT is involved — the NIP-98 verification happens in the Netlify function before the Supabase query.

### 11.2 v1 → v2 Migration

The migration is a **data extraction + decommission**, not a schema evolution.

**Migration tool (`scripts/v1-migration.ts`):**

1. **NIP-05 preservation:** Copy all `user_identities.username` → `nip05_identifiers.username` and `user_identities.nostr_pubkey` → `nip05_identifiers.pubkey`.
2. **Lightning address preservation:** Copy all Lightning address configurations.
3. **nsec migration ceremony:** For each user:
   a. Fetch `encrypted_nsec`, `encrypted_nsec_iv`, `user_salt` from v1 Supabase.
   b. Present the user with a migration UI: "Enter your password to decrypt and re-encrypt your identity under your device key."
   c. Client decrypts nsec using v1 PBKDF2(password, salt).
   d. Client re-encrypts nsec under the v2 OPFS Vault master key.
   e. Client stores in OPFS Vault.
   f. Client sends confirmation to migration endpoint.
   g. Migration endpoint deletes `encrypted_nsec`, `encrypted_nsec_iv`, `user_salt` for that user.
4. **Table drops:** After all users are migrated (or after a deadline), drop all v1 tables.

---

## 12. Security Invariants & Threat Model

### 12.1 Security Invariants

These are boolean properties that must be true in every deployment. CI/CD checks enforce them.

| # | Invariant | Enforcement |
|---|---|---|
| S1 | No `encrypted_nsec`, `nsec`, `secret_key`, or `private_key` column exists in any Supabase table | Schema linter in CI |
| S2 | No `jsonwebtoken`, `jose`, `JWT_SECRET`, or `jwt` import exists in any source file | Grep check in CI |
| S3 | No `@sentry/*` package exists in `package.json` | Dependency audit in CI |
| S4 | No `localStorage.setItem` call stores any value matching `/nsec|priv|secret|key|pairing/i` | AST lint rule |
| S5 | No Netlify function reads from or writes to OPFS | Architecture constraint (functions run server-side) |
| S6 | No CMAC value (`cmacHex`, `piccDataHex`) appears in any server-side function body | Grep check in CI |
| S7 | All fonts are served from `/public/fonts/` — no external font CDN `<link>` tags | HTML linter in CI |
| S8 | `package.json` production dependencies count ≤ 22 | Package audit in CI |
| S9 | Netlify function count ≤ 8 | Directory count check in CI |
| S10 | Every Netlify function with NIP-98 auth calls `verifyNip98()` before any business logic | Code review requirement |
| S11 | No `console.log` or `console.error` call includes a variable matching `/nsec|key|secret|share|proof/i` | AST lint rule |
| S12 | CSP header does not include `'unsafe-eval'` | Header check in deployment |

### 12.2 Threat Model

| # | Threat | v1 Severity | v2 Mitigation | v2 Residual Risk |
|---|---|---|---|---|
| T1 | Supabase compromise → nsec extraction | CRITICAL | nsec not in Supabase. NIP-05 names are public data. | LOW — attacker gets usernames and pubkeys (already public on Nostr) |
| T2 | Netlify function compromise → auth bypass | CRITICAL (JWT_SECRET leak) | No JWT. NIP-98 auth requires valid Nostr signature. Function compromise cannot forge signatures. | LOW — attacker can DoS or read public data, cannot impersonate users |
| T3 | XSS → key extraction | HIGH (localStorage nsec, NIP-46 keys) | Keys in OPFS (not accessible via `document.cookie` or `window.localStorage`). OPFS requires async API calls. | MEDIUM — sophisticated XSS with async OPFS access is theoretically possible. CSP `script-src 'self'` mitigates. |
| T4 | Supply chain (malicious npm package) | HIGH | Reduced to 22 deps. No `eval()`. CSP blocks inline scripts. Lockfile integrity checks. | MEDIUM — supply chain risk is inherent to npm. Mitigation is minimization + SRI. |
| T5 | Sentry data exfiltration | CRITICAL | Sentry removed entirely. | NONE |
| T6 | CMAC replay | CRITICAL | CMAC verified client-side. Server never sees CMAC. | LOW — attacker would need physical device access |
| T7 | Google Fonts tracking | MEDIUM | Fonts self-hosted. | NONE |
| T8 | Relay metadata analysis | MEDIUM | NIP-17 gift-wrapping for DMs. NIP-42 AUTH on Pylon (authenticated channel). | MEDIUM — relay operator sees event metadata (pubkey, kind, timestamp). Mitigated by ephemeral events where appropriate. |
| T9 | FROST share compromise (single device) | N/A (new) | Threshold: 2-of-n. Single share compromise does not yield signing capability. | LOW — attacker needs 2+ devices |
| T10 | OPFS vault brute-force (passphrase) | N/A (new) | argon2id with m=65536, t=3, p=4. 12-char minimum passphrase. | MEDIUM — depends on passphrase entropy. WebAuthn preferred. |

---

## 13. Phase Plan

### Phase 1: Foundation (Weeks 1-4)

**Goal:** PWA shell, OPFS Vault, NIP-98 auth, NIP-05 registration, single-identity management.

| Week | Deliverables |
|---|---|
| 1 | New repo. Vite + React 18 + Tailwind scaffold. PWA manifest + service worker. Self-hosted fonts. CSP headers. CI pipeline with security invariant checks. |
| 2 | OPFS Vault implementation (full API from Section 2.3). WebAuthn + passphrase wrapping key. Vault lock/unlock UI. Unit tests for all vault operations. |
| 3 | NIP-98 auth middleware (Section 3.3). `nip05-resolver` and `check-username` and `register-identity` Netlify functions. Identity registration flow (generate nsec in browser → store in vault → register NIP-05 name). |
| 4 | CEPS port from v1 (with NIP-42 AUTH). NIP-65 relay list management. kind:0 profile management UI. v1 migration ceremony UI (nsec extraction from Supabase → OPFS vault). |

**Phase 1 exit criteria:**
- User can create a new identity (nsec generated client-side, stored in OPFS, NIP-05 registered)
- User can migrate a v1 identity (nsec extracted from Supabase, re-encrypted in OPFS)
- NIP-98 auth works for all Netlify functions
- CEPS publishes events to Pylon with NIP-42 AUTH
- All S1-S12 invariants pass in CI

### Phase 2: Groups + Payments (Weeks 5-8)

**Goal:** FROST group management, NWC wallet, NIP-26 delegation, NFC gate.

| Week | Deliverables |
|---|---|
| 5 | `@frostr/bifrost@2.0.2` integration. FROST DKG ceremony UI. bfprofile/bfshare storage in OPFS Vault. Group creation flow (Guardian initiates → Steward joins → group pubkey generated). |
| 6 | NIP-26 delegation event construction + verification. Delegation graph (Section 4.2). Role assignment UI (Guardian assigns Steward, Adult, Offspring roles via NIP-26 events). |
| 7 | NWC connection manager (Section 6.1). NWC URI storage in OPFS Vault. Wallet balance/send/receive UI. BOLT-11 invoice display + QR code. NFC NTAG424 client-side CMAC verification port from v1. |
| 8 | NFC PIN gate (Section 5.3). Proof of Life ceremony state machine (Section 5.4). iOS deep-link fallback (Section 5.5). Cashu client (Section 6.2 — mint management, token operations). |

**Phase 2 exit criteria:**
- Guardian can create a group with FROST threshold signing
- Guardian can delegate roles via NIP-26
- All group members can send/receive Lightning via NWC
- NFC card verification works client-side (Android)
- Cashu tokens can be minted, sent, and received

### Phase 3: Agent Economy (Weeks 9-12)

**Goal:** NIP Triumvirate (NIP-SA/AC/SKL), NIP-90 DVM marketplace, agent dashboard.

| Week | Deliverables |
|---|---|
| 9 | NIP-SA agent profile construction + publishing (kind:39200). Agent creation UI (Principal creates agent with spend policy). `well-known-agent` Netlify function. Agent wallet with spend policy enforcement (Section 6.3). |
| 10 | NIP-SKL skill registry client (kind:33400). Skill registration UI. Skill attestation (kind:1985 NIP-32 labels). Runtime gate implementation (`verifySkillExecution()` — Section 7.3). |
| 11 | NIP-AC credit lifecycle client (kinds 39240-39245). Credit envelope construction. Spend authorization. Settlement receipt with Sig4Sats bond redemption. Reputation delta calculation. |
| 12 | NIP-90 DVM marketplace client (Section 8.1). Job request construction (kind:5xxx). Job result subscription (kind:6xxx). Provider discovery (kind:31990). Payment flow (invoice → NWC → feedback). |

**Phase 3 exit criteria:**
- Agents can be created with NIP-SA profiles published to Pylon
- Skills can be registered, attested, and gated
- Credit envelopes can be constructed and settled
- DVM jobs can be submitted, results received, and providers paid

### Phase 4: OpenAgents Integration (Weeks 13-16)

**Goal:** Probe session protocol, SpacetimeDB bridge, monitoring dashboards, production hardening.

| Week | Deliverables |
|---|---|
| 13 | Probe session monitoring UI (trajectory event subscription, tool call display). Tool approval UI (per-tool-call approve/reject). Session diff renderer. |
| 14 | SpacetimeDB bridge via Pylon (Section 8.4). Presence sync. Compute assignment subscription. Agent heartbeat publishing. |
| 15 | Agent monitoring dashboards: delegation health panel, performance report, session manager. Port v1 dashboard components (`AgentDelegationMonitoringDashboard`, `DelegationHealthPanel`, `AgentPerformanceReport`) with Nostr-native data sources. |
| 16 | Production hardening: load testing, security audit, accessibility pass, error handling review, offline behavior testing, cross-browser PWA testing. Documentation. |

**Phase 4 exit criteria:**
- Probe sessions can be monitored with tool-level approval
- Presence syncs to SpacetimeDB via Pylon bridge
- All dashboards render with Nostr-native data
- Production-ready: no S1-S12 violations, CSP enforced, offline fallback works

### Phase 5: Decommission v1 (Week 17)

| Deliverable | Detail |
|---|---|
| Migration deadline | All v1 users have migrated or been notified |
| v1 table drops | Run decommission migration: drop all v1 tables with key material |
| v1 function teardown | Disable all v1 Netlify functions |
| v1 repo archival | Archive `OV1-Kenobi/satnam_pub`, mark as read-only |

---

## 14. Dependency Manifest

### 14.1 Production Dependencies (Target: ≤22)

| # | Package | Version | Category | Axiom Justification |
|---|---|---|---|---|
| 1 | `@frostr/bifrost` | `^2.0.2` | crypto | Axioms 1, 3, 5 — FROST threshold signing |
| 2 | `@noble/ciphers` | `^1.3.0` | crypto | Axiom 3 — AES-GCM, XChaCha20-Poly1305, AES-128-CMAC |
| 3 | `@noble/curves` | `^2.0.0` | crypto | Axiom 3 — secp256k1 Schnorr signatures |
| 4 | `@noble/hashes` | `^1.8.0` | crypto | Axiom 3 — SHA-256, HMAC, argon2id |
| 5 | `@scure/bip32` | `^1.1.5` | crypto | Axiom 3 — HD key derivation |
| 6 | `@scure/bip39` | `^1.1.1` | crypto | Axiom 3 — Mnemonic seed phrases |
| 7 | `@getalby/lightning-tools` | `^6.0.0` | payment | Axiom 2 — Lightning address resolution |
| 8 | `@getalby/sdk` | `^6.0.1` | payment | Axiom 2 — NWC wallet abstraction |
| 9 | `@cashu/cashu-ts` | `latest` | payment | Axiom 2 — Cashu eCash client |
| 10 | `@supabase/supabase-js` | `^2.50.2` | storage | Axiom 6 — NIP-05 registry (constrained) |
| 11 | `nostr-tools` | `^2.15.0` | nostr | Axiom 2 — Core Nostr protocol |
| 12 | `react` | `^18.2.0` | ui | UI framework |
| 13 | `react-dom` | `^18.2.0` | ui | UI framework |
| 14 | `react-router-dom` | `^6.30.1` | ui | Client-side routing |
| 15 | `react-helmet-async` | `^2.0.5` | ui | PWA meta tags |
| 16 | `clsx` | `^2.1.1` | ui | Class merging utility |
| 17 | `tailwind-merge` | `^3.3.1` | ui | Tailwind class deduplication |
| 18 | `lucide-react` | `^0.263.1` | ui | Icon library |
| 19 | `date-fns` | `^4.1.0` | ui | Date formatting (tree-shake required) |
| 20 | `bolt11` | `^1.4.1` | payment | BOLT-11 invoice decoding |
| 21 | `qrcode-generator` | `^2.0.4` | ui | QR codes for NWC URIs and invoices |
| 22 | `websocket-polyfill` | `^1.0.0` | nostr | Relay connection polyfill |

**Total: 22 production dependencies.**

### 14.2 Eliminated Dependencies (from v1)

| Package | Reason |
|---|---|
| `@capacitor/android`, `@capacitor/core` | Capacitor cut — PWA-first |
| `@cmdcode/frost` | Redundant with `@frostr/bifrost` |
| `@netlify/functions` | Kept as dev dependency only — not production |
| `@sentry/node`, `@sentry/react`, `@sentry/vite-plugin` | Sentry cut entirely |
| `@types/pg`, `@types/redis` | pg and redis cut |
| `crypto-js` | Redundant with `@noble/ciphers` |
| `jose` | W3C VC stack cut |
| `jsonwebtoken` | JWT auth system cut |
| `pg` | Direct PostgreSQL driver cut |
| `phoenix-server-js` | PhoenixD direct integration cut — NWC replaces |
| `react-easy-crop` | Scope cut — v3 |
| `recharts` | Unused/dead dependency |
| `redis` | Redis cut |
| `shamirs-secret-sharing` | SSS replaced by FROST |
| `z32` | PKARR cut; z32 not needed without PKARR |
| `react-loading-skeleton` | Replaced with CSS skeleton |
| `react-qr-code` | Redundant with `qrcode-generator` |

### 14.3 Added Dependencies (new in v2)

| Package | Category | Justification |
|---|---|---|
| `@cashu/cashu-ts` | payment | eCash client — axiom 2 (Cashu as valid rail) |

### 14.4 Dev Dependencies (unchanged from v1 audit)

| Package | Purpose |
|---|---|
| `@testing-library/react`, `@testing-library/jest-dom` | React testing |
| `@types/node`, `@types/react`, `@types/react-dom` | Type declarations |
| `@vitejs/plugin-react` | Vite React plugin |
| `@vitest/coverage-v8`, `@vitest/ui` | Test coverage + UI |
| `dotenv` | Environment variables |
| `jsdom` | DOM simulation for tests |
| `terser` | Production minification |
| `tsx` | TypeScript execution for scripts |
| `typescript` | Type system |
| `vite` | Build tool |
| `vite-plugin-top-level-await` | WASM async init |
| `vite-plugin-wasm` | FROSTR bifrost WASM bridge |
| `vitest` | Test runner |
| `tailwindcss`, `postcss`, `autoprefixer` | CSS build tooling |
| `@netlify/functions` | Netlify function types (dev only) |

---

## 15. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | NIP Triumvirate spec instability — NIP-SA/AC/SKL event kinds or tag schemas change before v2 ships | HIGH | HIGH | Pin to current OpenAgents monorepo commit hash for event kind definitions. Abstract event construction behind interfaces so schema changes require updating one module, not the entire codebase. Monitor OpenAgents repo for breaking changes. |
| R2 | `@frostr/bifrost@2.0.2` instability — FROST DKG ceremony fails under real-world conditions (network latency, partial participant dropout) | MEDIUM | HIGH | Implement ceremony timeout and retry logic. Store intermediate DKG state in OPFS so a dropped participant can rejoin. Fallback: single-sig Guardian key for emergency operations (documented as a temporary override, not a permanent mode). |
| R3 | OPFS browser support gaps — Safari OPFS implementation is incomplete or buggy | MEDIUM | MEDIUM | Implement IndexedDB fallback with identical encryption scheme. Feature-detect OPFS availability: `navigator.storage.getDirectory()` try/catch → IndexedDB path. Test on Safari 17+, Chrome, Firefox, Edge. |
| R4 | Web NFC API deprecation or restriction — Google narrows Web NFC availability | LOW | MEDIUM | NFC is Android Chrome-only today. iOS fallback (Universal Links) does not depend on Web NFC. If Web NFC is restricted, NFC features become Android-only with read-only iOS support. The core identity/payment system does not depend on NFC. |
| R5 | SpacetimeDB bridge reliability — Pylon relay bridge introduces latency or message loss for real-time presence | MEDIUM | MEDIUM | Implement client-side presence heartbeat directly to SpacetimeDB as a Phase 4 enhancement if relay bridge proves insufficient. The bridge is the Phase 1 approach (axiom 4 — minimize deps); direct SDK integration is the Phase 5 fallback. |
| R6 | Cashu mint trust — user funds at risk if a Cashu mint is malicious or compromised | MEDIUM | HIGH | `allowed_mints` policy restricts which mints agents can use. Guardian-set mint allowlist. Default to well-known, audited mints. Sweep automation moves Cashu balances above threshold to Lightning (self-custodial). |
| R7 | v1 user migration adoption — users fail to complete the nsec migration ceremony | MEDIUM | MEDIUM | 90-day migration window. Email/Nostr DM reminders at 30/60/80 days. After deadline, encrypted_nsec remains in Supabase (encrypted, unusable without password) but v1 auth endpoints are decommissioned. Users must complete migration to access v2. |
| R8 | NWC provider lock-in — `@getalby/sdk` wrapping creates Alby-specific behavior | LOW | MEDIUM | Abstract NWC operations behind `NwcConnectionManager` interface (Section 6.1). The interface is wallet-agnostic. If `@getalby/sdk` introduces Alby-specific behavior, replace with raw NIP-47 WebSocket implementation using `nostr-tools`. |
| R9 | Bundle size regression — new dependencies (Cashu, FROST WASM) push bundle above 800KB target | MEDIUM | LOW | Lazy-load FROST WASM (only loaded during DKG/signing ceremonies). Lazy-load Cashu client (only loaded in wallet views). Tree-shake `date-fns` and `lucide-react`. Target: ≤800KB gzipped for main entry point, ≤1.2MB total including lazy chunks. |
| R10 | NIP-26 delegation event relay propagation — some relays may not store or relay NIP-26 delegation events reliably | MEDIUM | MEDIUM | Publish delegation events to multiple relays (Pylon + 2 public relays). Cache delegation graph locally in encrypted IndexedDB. Re-publish on relay reconnection. |

---

## 16. Architecture Diagram — Protocol Boundary Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SATNAM v2 CLIENT                             │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │  OPFS Vault   │  │   CEPS       │  │    UI Components          │   │
│  │  ───────────  │  │   ────       │  │    ──────────────          │   │
│  │  nsec         │  │   NIP-42     │→ │    Auth / Groups           │   │
│  │  FROST shares │  │   NIP-65     │  │    Wallet / NFC            │   │
│  │  NWC URIs     │  │   Publish    │  │    Agent Dashboard         │   │
│  │  NFC keys     │  │   Subscribe  │  │    DVM Marketplace         │   │
│  │  Cashu proofs │  │   Queue      │  │    Probe Session           │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────────┘   │
│         │                  │                      │                    │
│  ┌──────┴──────────────────┴──────────────────────┴──────────────┐   │
│  │                    Protocol Clients                            │   │
│  │  NIP-98 Auth │ NIP-26 Delegation │ NIP-17 DM │ NIP-90 DVM    │   │
│  │  NIP-SA Agent │ NIP-AC Credit │ NIP-SKL Skill │ FROST/DKG    │   │
│  │  NWC (NIP-47) │ Cashu │ NTAG424 CMAC │ SpacetimeDB Bridge   │   │
│  └──────────────────────────┬────────────────────────────────────┘   │
│                              │                                        │
└──────────────────────────────┼────────────────────────────────────────┘
                               │
              ┌────────────────┼────────────────────────┐
              │                │                         │
    ┌─────────▼─────────┐ ┌───▼──────────────┐ ┌───────▼────────┐
    │   PYLON RELAY      │ │  PUBLIC RELAYS    │ │ NETLIFY EDGE   │
    │   (NIP-42 AUTH)    │ │  (NIP-65 outbox)  │ │ (≤8 functions) │
    │                    │ │                    │ │                │
    │  Agent events      │ │  kind:0 profiles   │ │ NIP-05 resolve │
    │  39200-39245       │ │  kind:1 notes       │ │ username check │
    │  DVM 5xxx/6xxx     │ │  kind:10002 relays  │ │ register-id    │
    │  Trajectory 39230  │ │  kind:1985 labels   │ │ NWC proxy      │
    │  Presence 10003    │ │  NIP-17 DMs         │ │ OTS anchor     │
    │  NIP-26 delegation │ │  NIP-26 delegation  │ │ issuer reg     │
    │                    │ │                      │ │ comms relay    │
    │  ┌──────────────┐  │ │                      │ │       │        │
    │  │ SpacetimeDB   │  │ │                      │ │       │        │
    │  │ Bridge Module │  │ │                      │ │       ▼        │
    │  └──────┬───────┘  │ │                      │ │  ┌─────────┐  │
    │         │           │ │                      │ │  │Supabase │  │
    │         ▼           │ │                      │ │  │(NIP-05, │  │
    │  ┌──────────────┐  │ │                      │ │  │ LN addr, │  │
    │  │ SpacetimeDB   │  │ │                      │ │  │ rate lim)│  │
    │  │ (OpenAgents)  │  │ │                      │ │  └─────────┘  │
    │  └──────────────┘  │ │                      │ │                │
    └────────────────────┘ └──────────────────────┘ └────────────────┘
```

---

## 17. Acceptance Criteria Summary

The specification is complete when a v2 deployment satisfies all of the following:

1. **Axiom 1:** Every price field in the application is `u64` msats. No fiat columns. No altcoin references.
2. **Axiom 2:** The only protocol rails in use are Lightning (via NWC), Nostr (events + relays), and Cashu (eCash). No HTTP REST payment APIs.
3. **Axiom 3:** Zero key material in Supabase. Zero third-party error reporting. Zero external CDN dependencies. Client-side CMAC. OPFS Vault for all secrets. NIP-98 auth on all authenticated endpoints.
4. **Axiom 4:** ≤22 production dependencies. ≤8 Netlify functions. No redundant crypto libraries.
5. **Axiom 5:** NWC abstracts all wallet backends. FROST replaces SSS. No LNbits custodial wallets. No server-side nsec.
6. **Axiom 6:** NIP-90 DVM client stack functional. Probe session monitoring operational. Pylon NIP-42 AUTH working. SpacetimeDB bridge syncing presence. NIP-SA/AC/SKL client stack functional.
7. **Axiom 7:** Every design decision in this document has a written justification. Future changes must reference the axiom they serve.

All 12 security invariants (S1-S12) pass in CI.

All 10 threat mitigations (T1-T10) are implemented.

---

*End of specification. Document is versionable in git. Every section is independently addressable for review. Nothing in this document modifies the v1 codebase — it is a blueprint for a new repository.*
