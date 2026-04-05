# Protocol Reference

Satnam v2 is built entirely on open, cryptographically verifiable protocols. There are no proprietary APIs, no opaque session tokens, and no server-side secrets. This section documents every protocol layer, event kind, and cryptographic primitive used by the system.

---

## Protocol Stack Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 8 — Integration                                           │
│  SpacetimeDB bridge via Pylon relay (no SDK dependency)         │
├─────────────────────────────────────────────────────────────────┤
│  Layer 7 — Marketplace                                           │
│  NIP-90 DVM  ·  Job Request (5xxx)  ·  Job Result (6xxx)        │
│  Provider Discovery (31990)  ·  Feedback (7000)                 │
├─────────────────────────────────────────────────────────────────┤
│  Layer 6 — Agent Economy                                         │
│  NIP-SA Sovereign Agents (39200–39231)                          │
│  NIP-AC Agent Credit (39240–39245)                              │
│  NIP-SKL Skill Registry (33400–33401)                           │
├─────────────────────────────────────────────────────────────────┤
│  Layer 5 — Physical Verification                                 │
│  NTAG424 NFC cards  ·  AES-128-CMAC  ·  Client-side only       │
├─────────────────────────────────────────────────────────────────┤
│  Layer 4 — Payments                                              │
│  NWC / NIP-47 (Lightning)  ·  Cashu eCash (blind tokens)       │
├─────────────────────────────────────────────────────────────────┤
│  Layer 3 — Threshold Signing                                     │
│  FROST via @frostr/bifrost  ·  DKG  ·  Group Pubkey             │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2 — Authorization                                         │
│  NIP-26 Delegation events  ·  Role hierarchy enforcement        │
├─────────────────────────────────────────────────────────────────┤
│  Layer 1 — Authentication                                        │
│  NIP-98 HTTP Auth  ·  kind:27235  ·  Replaces JWT entirely      │
├─────────────────────────────────────────────────────────────────┤
│  Layer 0 — Identity                                              │
│  Nostr keypairs (nsec/npub)  ·  No email, no password           │
└─────────────────────────────────────────────────────────────────┘
```

---

## How NIPs Work Together

Each NIP solves a specific problem. Together they form a complete, trustless system:

| Problem | Protocol | Replaces |
|---|---|---|
| "Who is making this request?" | NIP-98 (kind:27235 HTTP auth) | JWT + PBKDF2 |
| "Are they allowed to do this?" | NIP-26 (delegation events) | Database RBAC tables |
| "How does a group sign?" | FROST threshold signatures | Shamir Secret Sharing |
| "How do agents identify themselves?" | NIP-SA (kind:39200 profiles) | Custom server-side agent DB |
| "How do agents get paid?" | NIP-AC (credit lifecycle) | Off-chain IOUs |
| "What can an agent do?" | NIP-SKL (skill manifests + attestations) | Capability flags in DB |
| "How do I buy/sell compute?" | NIP-90 DVM (5xxx/6xxx events) | REST marketplace APIs |
| "How does Lightning work?" | NWC / NIP-47 (wallet connect) | Direct daemon APIs |

**Request flow for an authenticated action:**

1. Client fetches nsec from OPFS Vault (device-only storage)
2. Client constructs and signs a `kind:27235` NIP-98 event for the target URL
3. Request arrives at Netlify function with `Authorization: Nostr <base64_event>`
4. `verifyNip98()` checks signature, URL match, timestamp, method match
5. If NIP-26 delegation is present, delegation chain is verified
6. Business logic executes; no server ever touches a private key

---

## Custom vs Standard NIPs

### Standard NIPs Implemented

| NIP | Kind(s) | Usage |
|---|---|---|
| NIP-01 | 0, 1, 5 | Core protocol, profiles, text notes, deletion |
| NIP-05 | — | Internet identifier (`user@satnam.pub`) |
| NIP-17 | — | Gift-wrapped DMs (metadata protection) |
| NIP-26 | — | Delegation events (role authorization) |
| NIP-32 | 1985 | Label events (skill attestation) |
| NIP-42 | 22242 | Relay authentication (Pylon access) |
| NIP-44 | — | Encrypted content (NIP-44 v2 ChaCha20-Poly1305) |
| NIP-47 | — | Nostr Wallet Connect (Lightning operations) |
| NIP-65 | 10002 | Relay list metadata (outbox model) |
| NIP-78 | 30078 | App-specific data (Proof of Life bilateral contact attestation) |
| NIP-90 | 5xxx, 6xxx, 7000, 31990 | Data Vending Machine marketplace |
| NIP-98 | 27235 | HTTP authentication |

### Custom NIPs (Satnam / OpenAgents Extensions)

| NIP | Kind(s) | Usage |
|---|---|---|
| NIP-SA | 39200–39231 | Sovereign Agents — identity, state, schedule, trajectory |
| NIP-AC | 39240–39245 | Agent Credit — intent, offer, envelope, spend auth, settlement |
| NIP-SKL | 33400, 33401 | Skill Registry — manifests, attestations, version logs |
| NIP-CA | — | Certificate Authority issuer registry (via `issuer-registry` function) |

---

## Event Kind Registry

All event kinds used in Satnam v2, organized by range:

| Kind | Name | NIP | Notes |
|---|---|---|---|
| 0 | Metadata | NIP-01 | User profile (name, about, picture, lud16, nip05) |
| 1 | Short Text Note | NIP-01 | Also used as wrapper for NIP-26 delegation events |
| 5 | Event Deletion | NIP-09 | Deletion requests (relay-honored, not cryptographic) |
| 13 | Proof of Work | NIP-13 | Not implemented in v2 |
| 22242 | Relay Auth | NIP-42 | Pylon NIP-42 authentication challenge response |
| 27235 | HTTP Auth | NIP-98 | Per-request HTTP authentication (replaces JWT) |
| 30078 | App-Specific Data | NIP-78 | Bilateral contact attestation events (`d: satnam:proof-of-life`). Published by each participant in a Proof of Life ceremony, with a `p` tag pointing to the other participant's pubkey and an `nfc-card-hash` tag containing the SHA-256 of the other participant's NFC card UID. |
| 1059 | Gift Wrap | NIP-17 | Outer wrapper for DMs (metadata protection) |
| 1985 | Label | NIP-32 | Skill attestations (tier1–tier4) |
| 5000–5999 | Job Request | NIP-90 | DVM job requests (5100 = text gen, etc.) |
| 6000–6999 | Job Result | NIP-90 | DVM job results (6xxx = 5xxx + 1000) |
| 7000 | Job Feedback | NIP-90 | Consumer feedback after job completion |
| 10000 | Mute List | NIP-51 | Used for encrypted FROST share backup (encrypted to self) |
| 10002 | Relay List | NIP-65 | Outbox model relay configuration |
| 10003 | Bookmark List | NIP-51 | Custom: presence sync events for SpacetimeDB bridge |
| 31990 | Handler Information | NIP-89 | DVM provider capability advertisements |
| 33400 | Skill Manifest | NIP-SKL | Skill definition, capabilities, hash |
| 33401 | Skill Version Log | NIP-SKL | Version history with `previousVersion`, `changeType` |
| 39200 | Agent Profile | NIP-SA | Agent identity, capabilities, spend policy |
| 39201 | Agent State | NIP-SA | NIP-44 encrypted current state |
| 39202 | Agent Schedule | NIP-SA | Heartbeat/tick interval configuration |
| 39203 | Agent Goals | NIP-SA | Transparency goals (optional) |
| 39210 | Tick Request | NIP-SA | Ephemeral agent heartbeat request |
| 39211 | Tick Result | NIP-SA | Ephemeral agent heartbeat result |
| 39220 | Skill License | NIP-SA | Marketplace-issued skill access grant |
| 39221 | Skill Delivery | NIP-SA | Gift-wrapped skill content delivery |
| 39230 | Trajectory Session | NIP-SA | Probe session metadata |
| 39231 | Trajectory Event | NIP-SA | Individual step in a Probe agent session |
| 39240 | Credit Intent | NIP-AC | Published need/request for compute |
| 39241 | Credit Offer | NIP-AC | Provider response to Credit Intent |
| 39242 | Credit Envelope | NIP-AC | Accepted offer — authority state machine |
| 39243 | Spend Authorization | NIP-AC | Signed spend within envelope limits |
| 39244 | Settlement Receipt | NIP-AC | Completion proof, Cashu bond redemption |
| 39245 | Default Notice | NIP-AC | Envelope expired without settlement |

---

## Protocol Reference Pages

- [NIP-98: HTTP Authentication](nip-98/README.md)
- [NIP-26: Delegation](nip-26/README.md)
- [FROST: Threshold Signatures](frost/README.md)
- [NIP-SA: Sovereign Agents](nip-sa/README.md)
- [NIP-AC: Agent Credit](nip-ac/README.md)
- [NIP-SKL: Skill Registry](nip-skl/README.md)
- [NIP-90: DVM Marketplace](nip-90/README.md)
