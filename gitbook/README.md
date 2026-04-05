# Welcome to Satnam

**Version:** v2.0.0 — 187 files · 22 production dependencies · 8 serverless functions

---

Satnam is a **Peer and Trust Relationship Manager (PTRM)** — a Progressive Web App that puts sovereignty first. It combines Nostr identity, Lightning Network payments, Cashu eCash, and threshold cryptography into a single, unified platform for managing digital trust relationships, group finances, and autonomous AI agents.

Every design decision in Satnam traces back to a single guiding principle: **your keys, your sats, your sovereignty.** There is no email address, no password, no custodial wallet, and no third-party holding your private key material. Your identity is a Nostr keypair. Your funds live in wallets you control. Your credentials never leave your device.

Satnam sits at the **user management vertex** of the Sovereignty Tetrahedron — a four-application architecture that together provides identity, knowledge, communications, and governance. It works as a standalone application and integrates natively with [OpenAgents Autopilot](https://openagents.com) for AI agent deployment and the Pylon authenticated relay for real-time coordination.

---

## Who Is Satnam For?

- **Individuals** who want a sovereign Nostr identity with a self-custody Bitcoin wallet — no bank, no custodian, no third party
- **Families and households** who need shared control over digital assets with granular, role-based permissions
- **Businesses and organizations** that require multi-signature authorization and auditable delegation chains
- **AI agent operators** who deploy autonomous agents on the OpenAgents marketplace and need spend-policy enforcement and skill attestation
- **Developers** building on the Nostr + Lightning + eCash stack who need a reference implementation and integration surface

---

## Quick Links

### Getting Started
- [What is Satnam?](./overview/what-is-satnam.md) — Core concepts, principles, and how it differs from v1
- [System Architecture](./overview/architecture.md) — Layer diagram, trust boundaries, and technology stack
- [Glossary](./overview/glossary.md) — Definitions for all Satnam and protocol-specific terms

### User Guides
- [Getting Started](./user-guides/getting-started/README.md) — Install the PWA, create your identity, register a NIP-05 name
- [Connecting a Wallet](./user-guides/getting-started/connecting-wallet.md) — NWC setup with Alby Hub, PhoenixD, LND, and more
- [Wallet: Overview](./user-guides/wallet/README.md) — Lightning and eCash payment overview
- [Lightning Payments](./user-guides/wallet/lightning-payments.md) — Send and receive via BOLT-11
- [Cashu eCash](./user-guides/wallet/cashu-ecash.md) — Mint, send, receive, and melt blind tokens
- [Groups](./user-guides/groups/README.md) — FROST-managed federations with role hierarchy
- [Creating a Group](./user-guides/groups/creating-a-group.md) — Guardian flow and DKG ceremony
- [Managing Roles](./user-guides/groups/managing-roles.md) — NIP-26 delegation and the capability matrix
- [Agents](./user-guides/agents/README.md) — Sovereign Agents and the NIP Triumvirate
- [Creating an Agent](./user-guides/agents/creating-an-agent.md) — 7-step wizard, spend policies, skills
- [Monitoring Agents](./user-guides/agents/monitoring-agents.md) — Dashboard, heartbeat, session management
- [DVM Marketplace](./user-guides/marketplace/README.md) — NIP-90 Data Vending Machines
- [Submitting Jobs](./user-guides/marketplace/submitting-jobs.md) — Create requests, set budgets, track progress
- [Credit Envelopes](./user-guides/marketplace/credit-envelopes.md) — NIP-AC lifecycle and Sig4Sats bonds
- [NFC Operations](./user-guides/nfc/README.md) — NTAG424 and TapSigner support
- [Proof of Life](./user-guides/nfc/proof-of-life.md) — Physical presence ceremony and PIN gate

---

## Current Release

| Property | Value |
|---|---|
| Version | v2.0.0 |
| Source files | 187 |
| Production dependencies | 22 (hard ceiling) |
| Serverless functions | 8 (hard ceiling) |
| Library modules | 20 |
| React hooks | 13 |
| React components | 35 |
| Application pages | 7 |

> **Note:** Satnam v2 is a complete greenfield rebuild. v1 was a research and development prototype with only test accounts — no user data, credentials, or configuration carries over from v1.
