# System Architecture

Satnam v2 is a four-layer Progressive Web App with a hard dependency ceiling, three defined trust boundaries, and a custody model that keeps all key material on the user's device.

---

## Layer Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                              │
│  React 18 + Vite + Tailwind CSS + TypeScript                 │
│  PWA Shell (manifest.webmanifest, sw.js)                     │
│  Web NFC API (Android Chrome) + iOS deep-link fallback       │
│  Components: Auth, Group Mgmt, Wallet, NFC, Agent Dashboard  │
├─────────────────────────────────────────────────────────────┤
│                     Client Logic Layer                        │
│  OPFS Vault (key storage, AES-256-GCM + XChaCha20-Poly1305)  │
│  CEPS (relay abstraction, event publishing)                  │
│  NIP-98 Auth (kind:27235 HTTP auth events)                   │
│  NIP-26 Delegation (role hierarchy enforcement)              │
│  NWC Client (NIP-47 wallet operations)                       │
│  FROST Client (@frostr/bifrost@2.0.2)                        │
│  Cashu Client (blind token operations)                       │
│  NTAG424 Client (client-side CMAC verification)              │
│  NIP-90 DVM Client (job request/result/feedback)             │
│  NIP-SA/AC/SKL Client (agent economy events)                 │
│  SpacetimeDB Client (presence bridge via Pylon)              │
├─────────────────────────────────────────────────────────────┤
│                     Relay / Network Layer                     │
│  Pylon (primary authenticated relay — NIP-42)                │
│  Public relays (NIP-65 outbox model)                         │
│  Cashu mints (eCash issuance/redemption)                     │
│  NWC relay (wallet command relay)                            │
│  SpacetimeDB endpoint (real-time sync, via Pylon bridge)     │
├─────────────────────────────────────────────────────────────┤
│                   Serverless Functions (≤8)                   │
│  nip05-resolver     │ NIP-05 /.well-known/nostr.json         │
│  well-known-agent   │ /.well-known/agent.json (NIP-SA)       │
│  check-username     │ Username availability                   │
│  register-identity  │ NIP-05 + LN address registration       │
│  nwc-proxy          │ NWC connection relay proxy             │
│  simpleproof-anchor │ OpenTimestamps Bitcoin anchoring        │
│  issuer-registry    │ NIP-CA issuer discovery                │
│  unified-comms      │ NIP-17 gift-wrapped message relay      │
├─────────────────────────────────────────────────────────────┤
│                   Persistence Layer                           │
│  Supabase: nip05_identifiers, lightning_addresses,           │
│            rate_limits, username_reservations                 │
│  OPFS: nsec, FROST shares, NWC URIs, NFC AES keys,          │
│        NIP-46 state, agent runner credentials                │
│  Nostr Relays: all identity, attestation, delegation,        │
│                group, agent, skill, and credit events        │
│  SpacetimeDB: presence, session sync, compute assignment     │
└─────────────────────────────────────────────────────────────┘
```

---

## Trust Boundaries

Satnam defines exactly three trust boundaries. Understanding these boundaries is essential for reasoning about what can and cannot be compromised.

### Boundary 1: The Device

The browser origin is the innermost trust perimeter. The [OPFS Vault](../developer-reference/libraries/vault.md) is encrypted under a device-held key derived either from a WebAuthn PRF credential (preferred) or an argon2id-derived passphrase (fallback). Key material is generated in browser memory, encrypted, stored in OPFS, and used for signing — entirely within this boundary.

**What lives here:** nsec, FROST bfshares, NWC URIs, NFC AES keys, NIP-46 pairing state, agent runner credentials, Cashu proofs.

**Compromise scenario:** If an attacker gains access to the device's OPFS storage, they obtain encrypted blobs. Without the WebAuthn credential or the passphrase, decryption is computationally infeasible (AES-256-GCM wrapping, argon2id with m=65536 iterations).

### Boundary 2: The Relay Network

Nostr relays are **untrusted transport**. Events are signed before transmission and verified by recipients. Gift-wrapping (NIP-17) provides metadata protection for direct messages. NIP-42 AUTH on Pylon provides authenticated relay access but does not grant trust — the relay sees event metadata (pubkey, kind, created_at) but not NIP-44 encrypted content.

**Compromise scenario:** A compromised relay can:
- Withhold events (availability attack)
- Leak event metadata: pubkeys, timestamps, event kinds
- Cannot forge signatures or decrypt NIP-44 content

### Boundary 3: The Serverless Edge

Netlify functions are **minimally trusted**. They handle public-data endpoints (NIP-05 resolution, username availability) and encrypted-passthrough operations (NWC relay proxy, NIP-17 relay). No function has access to nsec, FROST shares, NWC URIs, or any key material. Every authenticated function call is gated by NIP-98 (`verifyNip98()`): a kind:27235 Nostr event signed by the caller, bound to the specific URL and HTTP method.

**Compromise scenario:** A compromised serverless function can:
- Corrupt public NIP-05 mappings
- Deny service to authenticated endpoints
- Cannot access key material (it never arrives), cannot forge Nostr signatures

---

## Custody Model

The table below shows where each category of sensitive material lives in v1 (the audited failing state) and v2 (the corrected architecture), along with the migration path for existing users.

| Material | v1 Location | v2 Location | Migration |
|---|---|---|---|
| User nsec | `user_identities.encrypted_nsec` (Supabase) | OPFS Vault (device-only) | User re-encrypts under device key during migration ceremony |
| Group nsec | `family_federations.federation_nsec_encrypted` (Supabase) | FROST-managed — no single party holds full nsec | FROST key ceremony generates new group keypair |
| Shamir shares | `secret_shares` table (Supabase) | Eliminated — FROST replaces SSS | Table dropped |
| NIP-46 pairing | `localStorage` (plaintext) | OPFS Vault (AES-GCM encrypted) | Automatic migration on first v2 load |
| NFC AES keys | Server-verified via LNbits | OPFS Vault (AES-GCM encrypted) | Re-provisioned during NFC setup ceremony |
| NWC URI | Unknown/absent in v1 audit | OPFS Vault (AES-GCM encrypted) | User re-enters NWC URI in v2 |
| LLM API keys | `agent_llm_credentials` (Supabase, encrypted) | OPFS Vault (AES-GCM encrypted) | Re-entered by Principal in v2 |
| FROST bfprofile | Not present (BIFROST disabled in v1) | OPFS Vault (AES-GCM encrypted) | Generated fresh in v2 |

> **Note:** Supabase in v2 stores only four tables of **public, non-sensitive data**: `nip05_identifiers`, `lightning_addresses`, `rate_limits`, and `username_reservations`. Zero key material. Zero auth tokens. Zero session state.

---

## OPFS Vault Structure

```
Origin Private File System (navigator.storage.getDirectory())
└── satnam/
    └── vault/
        ├── master.key          ← AES-256-GCM key, encrypted under wrapping key
        ├── webauthn.cred       ← Public credential ID (not secret)
        ├── passphrase.salt     ← argon2id salt (not secret)
        ├── identities/
        │   ├── {npub}.nsec     ← Encrypted nsec (XChaCha20-Poly1305)
        │   └── {npub}.meta    ← Role, group memberships, NIP-05 binding
        ├── frost/
        │   ├── {group_npub}.bfprofile  ← FROSTR v2 group profile
        │   └── {group_npub}.bfshare    ← Individual FROST share
        ├── nwc/
        │   └── {connection_id}.uri     ← Encrypted NWC URI
        ├── nfc/
        │   ├── {card_uid}.k1           ← NTAG424 AES-128 key (SUN/SDM)
        │   └── {card_uid}.k2           ← NTAG424 AES-128 key (secondary)
        ├── nip46/
        │   └── {session_id}.pairing    ← Encrypted NIP-46 pairing state
        ├── agents/
        │   ├── {agent_npub}.nsec       ← Agent nsec (runner-local agents)
        │   └── {agent_npub}.llm_keys  ← Encrypted LLM provider API keys
        └── cashu/
            └── {mint_url_hash}.proofs  ← Encrypted Cashu proofs
```

The vault master key exists in JavaScript heap only while the vault is unlocked. On lock (tab close, explicit lock, or 15-minute idle timeout), the master key is zeroed from memory.

---

## Protocol Boundary Map

Each major feature in Satnam maps to a specific Nostr NIP and event kind range:

| Feature | Protocol | Event Kinds |
|---|---|---|
| Identity | Nostr keypairs (nsec/npub) | — |
| Authentication | NIP-98 HTTP Auth | kind:27235 |
| Relay authentication | NIP-42 AUTH | kind:22242 |
| Authorization / roles | NIP-26 Delegation | embedded delegation tag |
| Relay list | NIP-65 Outbox | kind:10002 |
| Direct messages | NIP-17 Gift-wrap | kinds:1059, 13 |
| Group threshold signing | FROST via @frostr/bifrost | — |
| Lightning payments | NIP-47 NWC | kinds:23194, 23195 |
| NIP-05 identity | NIP-05 | `/.well-known/nostr.json` |
| Agent profiles | NIP-SA | kinds:39200–39203 |
| Agent scheduling | NIP-SA | kind:39202 |
| Agent trajectories | NIP-SA (Probe) | kinds:39230, 39231 |
| Agent credit lifecycle | NIP-AC | kinds:39240–39245 |
| Skill registry | NIP-SKL | kinds:33400, 33401 |
| Skill attestation | NIP-32 Labels | kind:1985 |
| DVM marketplace | NIP-90 | kinds:5xxx, 6xxx, 7000, 31990 |
| Proof of Life | NIP-78 App Data | kind:30078 |
| Presence (SpacetimeDB bridge) | Custom | kind:10003 |

---

## Technology Stack

### Frontend

| Technology | Version / Notes | Purpose |
|---|---|---|
| React | 18 | UI component framework |
| Vite | Latest | Build tooling and dev server |
| TypeScript | Strict mode | Type safety across all modules |
| Tailwind CSS | v3 | Utility-first styling |
| PWA | `manifest.webmanifest` + `sw.js` | Installable app with offline support |

### Core Libraries (22 production dependencies — hard ceiling)

| Package | Purpose | Axiom |
|---|---|---|
| `nostr-tools` | Nostr event construction and relay communication | 2 |
| `@frostr/bifrost` | FROST threshold signatures (FROSTR v2) | 3, 5 |
| `@noble/curves` | secp256k1 Schnorr signing and verification | 3, 4 |
| `@noble/hashes` | SHA-256, HMAC, and hashing utilities | 3, 4 |
| `@noble/ciphers` | AES-GCM, XChaCha20-Poly1305, AES-128-CMAC | 3, 4 |
| `@scure/bip32` | HD key derivation | 3 |
| `@scure/bip39` | Mnemonic generation/recovery | 3 |
| `@cashu/cashu-ts` | Cashu eCash client | 1, 2 |
| `@getalby/sdk` | NWC connection management | 1, 2 |
| `@getalby/lightning-tools` | Lightning address utilities | 1, 2 |
| `bolt11` | BOLT-11 invoice parsing | 1, 2 |
| `@supabase/supabase-js` | NIP-05 registry and rate-limiting queries | 6 |
| `react-router-dom` | SPA routing | UI |
| `react-helmet-async` | Document head management | UI |
| `tailwind-merge` | Class merging utility | UI |
| `clsx` | Conditional class composition | UI |
| `lucide-react` | Icon set | UI |
| `qrcode-generator` | QR code generation for invoices | UI |
| `date-fns` | Date formatting | UI |
| `websocket-polyfill` | WebSocket compatibility | 2 |

> **Note:** The 22-dependency ceiling is Security Invariant S8. Every new dependency requires a mandate axiom justification and Principal sign-off.

### Serverless Infrastructure

| Service | Role | Data Handled |
|---|---|---|
| Netlify Functions | 8 public edge functions | Public data + encrypted pass-through |
| Supabase | 4-table minimal database | NIP-05 names, Lightning addresses, rate limits |
| Nostr relays | Event storage and transport | Signed Nostr events |
| Pylon | OpenAgents authenticated relay | Agent coordination events (NIP-42 authenticated) |

---

## 20 Library Modules

The client logic layer is organized into 20 focused library modules:

| Module | Purpose |
|---|---|
| `vault` | OPFS Vault lifecycle and operations |
| `nip98` | NIP-98 auth event construction |
| `nip26` | Delegation event construction and verification |
| `frost` | FROST DKG ceremony and threshold signing |
| `nwc` | NWC connection management |
| `cashu` | Cashu token operations |
| `nfc` | NTAG424 and TapSigner operations |
| `nip-sa` | Sovereign Agent profile events |
| `nip-ac` | Agent Credit lifecycle events |
| `nip-skl` | Skill Registry events |
| `nip90` | DVM job request/result/feedback |
| `nip17` | NIP-17 gift-wrapped messaging |
| `ceps` | Central Event Publishing Service |
| `probe` | Probe session subscription and display |
| `pylon` | Pylon relay connection with NIP-42 AUTH |
| `bridge` | SpacetimeDB bridge via Pylon |
| `agent/delegation` | Agent delegation graph management |
| `agent/wallet` | Agent spend policy enforcement |
| `agent/session` | Agent session state management |
| `errors` | Typed error enum library |

---

## Related Pages

- [What is Satnam?](./what-is-satnam.md) — Core concepts and mandate axioms
- [Glossary](./glossary.md) — Definitions for all technical terms
- [Getting Started](../user-guides/getting-started/README.md) — First steps with the PWA
