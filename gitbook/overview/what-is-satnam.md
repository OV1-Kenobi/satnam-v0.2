# What is Satnam?

Satnam is a **Peer and Trust Relationship Manager (PTRM)** — a Progressive Web App that combines sovereign digital identity, threshold cryptography, Lightning Network payments, and eCash micropayments into a single platform. It is designed for individuals, groups, and AI agent operators who require genuine self-custody: no third party holds your keys, your funds, or your identity.

---

## The Sovereignty Tetrahedron

Satnam occupies the **user management vertex** of the Sovereignty Tetrahedron — a four-application architecture in which each vertex handles a distinct dimension of digital sovereignty:

```
                    Satnam
                 (Identity &
                Trust Mgmt)
                     /\
                    /  \
                   /    \
                  /      \
    Citadel ----/----------\ Dynastic /
    Academy    /            \ GatherTheCircle
  (Knowledge) /              \ (Communications)
             /________________\
                Rebuilding
                 Camelot
               (Governance)
```

Together, these four applications form a complete sovereign digital infrastructure. Satnam's role is specifically the management of **principals** (people and agents), **trust relationships** (roles and delegations), and **value flows** (Lightning and eCash payments).

---

## Satnam as a PTRM

The term "Peer and Trust Relationship Manager" describes what Satnam actually does:

- **Peer management** — Track contacts, verify identities via NIP-05, and manage Nostr social graph connections.
- **Trust management** — Define role hierarchies (Guardian → Steward → Adult → Offspring) within groups, enforce capabilities via NIP-26 delegation events, and use FROST threshold signatures for group operations that no single party can authorize alone.
- **Relationship management** — Maintain shared group wallets, coordinate AI agents with spend policies, and issue NIP-CA attestations for credential-verified relationships.

Unlike a traditional identity manager, Satnam has no central authority. There is no Satnam server that "holds" your account. Your identity is a Nostr keypair stored on your device. Your roles are signed delegation events stored on Nostr relays. Your funds are in wallets you control, accessed via the open NWC protocol.

---

## Core Principles

Satnam v2 is governed by seven mandate axioms. These are non-negotiable — every design decision traces back to at least one of them.

### The 6 Mandate Axioms

| # | Axiom | What It Means in Practice |
|---|---|---|
| 1 | **Sats only** | All value is denominated in millisatoshis. No fiat storage, no altcoins. FX display rates are optional and feature-flag gated. |
| 2 | **LN / Nostr / eCash rails only** | Payments flow through NWC (Lightning) or Cashu (eCash). Identity and attestation flow through Nostr events. No REST payment APIs. |
| 3 | **Security and sovereignty over convenience** | Zero key material in any managed SaaS database. No third-party error reporting. Client-side CMAC verification. OPFS Vault for all secrets. Weight: 2× |
| 4 | **Minimize dependencies** | Hard ceiling of 22 production dependencies. Every dependency maps to a mandate axiom. No redundant crypto libraries. Weight: 2× |
| 5 | **Maximize self-custody** | NWC abstracts wallet backends without custodianship. FROST replaces Shamir secret sharing. No server-side nsec access, ever. |
| 6 | **Smooth OpenAgents integration** | Full NIP-90 DVM client stack. Probe session monitoring. Pylon NIP-42 AUTH. NIP-SA/NIP-AC/NIP-SKL as the agent economic layer. |
| 7 | **Nothing is sacred except the above** | Every other choice is subject to revision. Axiom violations require explicit Principal sign-off with written rationale. |

---

## Comparison to v1

The v1 codebase was audited and scored **3.2/10** against these axioms. The critical failures that triggered the v2 greenfield rebuild were:

| Failure | v1 Behavior | v2 Correction |
|---|---|---|
| Custody violation | `encrypted_nsec` stored in Supabase `user_identities` table | nsec lives only in OPFS Vault on device |
| Sovereignty violation | JWT as primary authentication | NIP-98 HTTP auth (kind:27235 signed events) — no JWT anywhere |
| Data exfiltration | Sentry error reporting included key-adjacent telemetry | Sentry removed entirely (Security Invariant S3) |
| CMAC server routing | CMAC values sent to server for verification | Client-side CMAC verification only; server never sees CMAC values |
| Shared secret exposure | Shamir Secret Sharing with server-side reconstruction | FROST threshold signatures — no single party ever holds the full group nsec |
| Missing agent economy | Zero NIP-90 DVM integration | Complete NIP-90 client stack + NIP-SA/NIP-AC/NIP-SKL implementation |

Nothing from v1 is imported by default. The [Salvage Manifest](../developer-reference/salvage-manifest.md) lists the 12 components that were isolated, decontaminated from JWT/Supabase coupling, and carried forward into v2.

---

## The 12 Security Invariants

In addition to the mandate axioms, Satnam v2 enforces 12 concrete security invariants checked during code review:

| ID | Invariant |
|---|---|
| S1 | No key-material columns in any database table |
| S2 | No JWT anywhere in the codebase |
| S3 | No Sentry or equivalent key-adjacent telemetry |
| S4 | No key material in `localStorage` |
| S5 | No OPFS access from serverless functions |
| S6 | No CMAC values sent to or processed server-side |
| S7 | No external font CDN — Cinzel is self-hosted |
| S8 | ≤22 production `npm` dependencies |
| S9 | ≤8 Netlify serverless functions |
| S10 | Every authenticated serverless function calls `verifyNip98()` |
| S11 | No `console.log` of key material |
| S12 | No `'unsafe-eval'` in the Content Security Policy |

---

## What Satnam Is Not

- **Not a wallet.** Satnam is a wallet *interface*. Your funds live in Lightning wallets you own (Alby Hub, PhoenixD, your LND node). Satnam connects via NWC.
- **Not a relay.** Satnam publishes events to Nostr relays (primarily Pylon) but does not operate a relay itself.
- **Not a custodian.** Satnam never holds your sats, your private keys, or your FROST shares server-side.
- **Not a social network.** While Satnam manages Nostr identities and peer relationships, the social communication layer lives in a companion application (Dynastic/GatherTheCircle).

---

## Related Pages

- [System Architecture](./architecture.md) — How the layers fit together
- [Glossary](./glossary.md) — Definitions for FROST, NIP-26, NWC, OPFS Vault, and all other terms
- [Getting Started](../user-guides/getting-started/README.md) — Install the PWA and create your identity
