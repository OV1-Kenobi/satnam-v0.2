# Glossary

All terms used in the Satnam documentation, alphabetically organized. Terms that appear in the specification are marked with their source section.

---

## A

**Adult**
A Mature Beneficiary in a Satnam group. Adults have spending authority within policy limits and can create agents within their span of control. Both human members and autonomous (NIP-SA) agents can hold the Adult role. See [Role Hierarchy](../user-guides/groups/README.md#role-hierarchy).

**Agent**
An autonomous Nostr keypair operating under the NIP-SA (Sovereign Agents) protocol. Agents hold their own nsec in a runner vault, participate in the NIP-90 DVM marketplace, and execute skills under the supervision of their Governor (a Guardian or Steward). See [Agent Management](../user-guides/agents/README.md).

**Agent Credit (NIP-AC)**
The credit lifecycle protocol for machine-to-machine commerce in the OpenAgents ecosystem. Governs the flow from Intent (kind:39240) through Offer (39241), Envelope (39242), Spend Authorization (39243), and Settlement (39244) to Default Notice (39245). See [Credit Envelopes](../user-guides/marketplace/credit-envelopes.md).

**Autopilot**
The OpenAgents NIP-90 DVM marketplace. Satnam Principals and Agents are consumers and providers of compute jobs through Autopilot. See [DVM Marketplace](../user-guides/marketplace/README.md).

**argon2id**
A memory-hard password hashing algorithm used in Satnam to derive vault wrapping keys from passphrases. Parameters: m=65536, t=3, p=4. Used as the fallback when WebAuthn PRF is unavailable.

---

## B

**bfprofile**
A FROSTR v2 data structure containing the group public key, threshold metadata, and participant list — but no secret material. Each participant in a FROST group stores the bfprofile in their OPFS Vault and it is published as a kind:39200 event to Pylon.

**bfshare**
A FROSTR v2 data structure containing an individual participant's FROST secret share. Each participant stores only their own bfshare. The bfshare in isolation is insufficient to reconstruct the group signing key — that requires threshold-many participants to cooperate.

**bfonboard**
A FROSTR v2 data structure used to deliver a new participant's bfshare during the DKG (Distributed Key Generation) ceremony. It is an encrypted onboarding payload sent from the ceremony initiator to the new participant.

**BOLT-11**
The Lightning Network invoice format. A base-58 encoded string beginning with `lnbc` that specifies a payment amount, description hash, expiry, and routing hints. Used for all Lightning send operations in Satnam. See [Lightning Payments](../user-guides/wallet/lightning-payments.md).

---

## C

**Cashu**
An eCash protocol using blind Chaumian signatures. Tokens are bearer instruments denominated in sats, issued by Cashu mints. Tokens are private by design — the mint cannot link issuance to redemption. See [Cashu eCash](../user-guides/wallet/cashu-ecash.md).

**CEPS (Central Event Publishing Service)**
The relay abstraction layer responsible for constructing, signing, and publishing all Nostr events in Satnam. CEPS handles NIP-42 AUTH on Pylon automatically, implements exponential backoff retry, and falls back to public relays when Pylon is unreachable.

**CMAC (Cipher-based Message Authentication Code)**
AES-128-CMAC, used by NTAG424 DNA cards for SUN (Secure Unique NFC) authentication. In Satnam v2, CMAC verification is performed entirely client-side. The server never sees a CMAC value. See [NFC Operations](../user-guides/nfc/README.md).

**Content Security Policy (CSP)**
The HTTP security header that controls what the browser is permitted to load. Satnam's CSP includes `'wasm-unsafe-eval'` (required for FROST's WASM bridge), `font-src 'self'` (no external font CDNs), and explicitly disallows `'unsafe-eval'` (Security Invariant S12).

**Credit Envelope (kind:39242)**
The accepted-offer state in the NIP-AC lifecycle. An Envelope is the authority state machine that governs how much an agent can spend and against which task. See [Credit Envelopes](../user-guides/marketplace/credit-envelopes.md).

---

## D

**Default Notice (kind:39245)**
A NIP-AC event published when a Credit Envelope expires without settlement. Triggers a reputation penalty on the Nostr relay for the party responsible for the default.

**DKG (Distributed Key Generation)**
The cryptographic ceremony in which FROST participants collectively generate a shared group keypair without any single party ever possessing the full secret key. In Satnam, the Guardian initiates the DKG ceremony; Stewards (and optionally additional Guardians) participate. See [Creating a Group](../user-guides/groups/creating-a-group.md).

**DVM (Data Vending Machine)**
A NIP-90 compute provider that accepts job requests (kind:5xxx), performs work, and returns results (kind:6xxx). DVMs advertise capabilities via kind:31990 provider profiles. See [DVM Marketplace](../user-guides/marketplace/README.md).

---

## E

**eCash**
See **Cashu**.

---

## F

**FROST (Flexible Round-Optimized Schnorr Threshold Signatures)**
The threshold signing scheme used in Satnam for group operations. FROST allows t-of-n participants to collaboratively sign a message, with the group's Schnorr signature being indistinguishable from a single-signer signature. Satnam uses `@frostr/bifrost@2.0.2`. Replaces Shamir Secret Sharing from v1. See [Architecture](./architecture.md).

---

## G

**Governor**
The human Principal (Guardian or Steward) who is responsible for an Agent. The Governor sets the agent's spend policy and can revoke the agent's delegation.

**Group**
A federation of Principals, Agents, or a mix of both, governed by a FROST-managed group keypair. Groups replace all "family" naming from v1. Group identity is Nostr-native — the group's public key is the output of a FROST DKG ceremony, and no party holds the full group private key. See [Group Management](../user-guides/groups/README.md).

**Guardian**
The Trust Protector — the highest-authority role in a Satnam group. The Guardian holds FROST share #1, can initiate key ceremonies, signs NIP-26 delegation events for all other roles, and is the only role that can publish NIP-CA attestations. See [Role Hierarchy](../user-guides/groups/README.md#role-hierarchy).

---

## H

**Heartbeat**
A periodic status event (kind:39202, NIP-SA agent schedule) published by an agent to indicate it is alive and operating normally. Satnam's monitoring dashboard tracks heartbeat intervals and alerts when an agent misses its expected heartbeat. See [Monitoring Agents](../user-guides/agents/monitoring-agents.md).

---

## I

**Intent (kind:39240)**
The opening event in the NIP-AC credit lifecycle. A Principal or Agent publishes an Intent to describe a compute need and budget. See [Credit Envelopes](../user-guides/marketplace/credit-envelopes.md).

---

## K

**kind**
A Nostr event type number. All Nostr events have a `kind` field that identifies their purpose. Satnam uses kinds across a wide range — from standard Nostr kinds (1, 1985, 10002) through NIP-47 (23194/23195) to the custom NIP-SA/AC/SKL range (33400–39245).

---

## L

**Lightning Address**
An internet-style identifier (`user@satnam.pub`) that resolves to a LNURL-pay endpoint. Satnam registers Lightning Addresses in its Supabase `lightning_addresses` table and routes incoming payments through NWC.

**LN (Lightning Network)**
The Bitcoin Layer 2 payment network. Satnam uses Lightning exclusively via the NWC (NIP-47) abstraction — no direct daemon API calls. See [Lightning Payments](../user-guides/wallet/lightning-payments.md).

**LNURL**
A protocol for encoding Lightning payment flows as bech32-encoded URLs. LNURL-pay is the standard for Lightning Addresses.

---

## M

**Melt**
The Cashu operation that converts eCash tokens back to Lightning sats by paying a BOLT-11 invoice. See [Cashu eCash](../user-guides/wallet/cashu-ecash.md).

**Mint**
A Cashu server that issues and redeems blind-signed tokens. Satnam allows Guardians to configure which mints are permitted for a group's Cashu operations.

**Mint (tokens)**
The Cashu operation that converts Lightning sats to eCash tokens. See [Cashu eCash](../user-guides/wallet/cashu-ecash.md).

---

## N

**NIP (Nostr Implementation Possibilities)**
The specification documents that define Nostr protocol extensions. Satnam implements NIP-05, NIP-17, NIP-26, NIP-32, NIP-42, NIP-44, NIP-47, NIP-65, NIP-78, NIP-90, and the three custom NIPs (NIP-SA, NIP-AC, NIP-SKL).

**NIP-05**
The Nostr protocol for mapping a human-readable identifier (`user@satnam.pub`) to a Nostr public key via a `.well-known/nostr.json` endpoint. Satnam provides NIP-05 registration at `satnam.pub`. See [Getting Started](../user-guides/getting-started/README.md).

**NIP-17**
Gift-wrapped direct messages. NIP-17 uses NIP-44 encryption inside a gift-wrap (kind:1059) to protect both message content and metadata (who messaged whom). The `unified-comms` Netlify function relays gift-wrapped messages without seeing their content.

**NIP-26**
The Nostr delegation specification. Principals sign delegation events that grant scoped authority to other pubkeys, with optional time bounds and kind restrictions. In Satnam, all role assignments are NIP-26 delegation events — there is no database RBAC. See [Managing Roles](../user-guides/groups/managing-roles.md).

**NIP-32**
Nostr Label events (kind:1985). Used in Satnam for skill attestations issued by Guardians. See [Skill Registry](../user-guides/agents/creating-an-agent.md).

**NIP-42**
Relay authentication. Pylon requires NIP-42 AUTH — clients sign a kind:22242 event with a relay-provided challenge. CEPS handles this automatically.

**NIP-44**
Nostr encrypted content. Versioned encryption (currently ChaCha20-Poly1305 with HKDF) for message content. Used in DM gift-wraps and optionally for DVM job encryption.

**NIP-47 (NWC)**
See **NWC**.

**NIP-65**
The relay list specification. kind:10002 events declare a Principal's preferred read/write relays. Satnam uses NIP-65 for relay discovery and fallback routing via CEPS.

**NIP-78**
Application-specific data (kind:30078). Used for Satnam's Proof of Life ceremony events tagged with `d: satnam:proof-of-life`. See [Proof of Life](../user-guides/nfc/proof-of-life.md).

**NIP-90**
Data Vending Machine specification. Defines job request (kinds 5000–5999), job result (kinds 6000–6999), job feedback (kind:7000), and provider announcement (kind:31990) events. See [DVM Marketplace](../user-guides/marketplace/README.md).

**NIP-98**
HTTP authentication using signed Nostr events. A kind:27235 event is constructed with the target URL, HTTP method, and (for POST/PUT) the SHA-256 of the request body, then signed and Base64-encoded into the `Authorization` header. All authenticated Netlify functions in Satnam use NIP-98. Replaces JWT entirely.

**NIP-AC**
See **Agent Credit (NIP-AC)**.

**NIP-SA**
See **Sovereign Agent (NIP-SA)**.

**NIP-SKL**
See **Skill Registry (NIP-SKL)**.

**NIP Triumvirate**
The three custom NIPs that define the agent economic layer: NIP-SA (Sovereign Agents) + NIP-AC (Agent Credit) + NIP-SKL (Skill Registry). Their canonical definitions live in the OpenAgents monorepo; Satnam implements the TypeScript client equivalents.

**npub**
A bech32-encoded Nostr public key. The public, shareable half of a Nostr keypair. Satnam displays npubs in the standard `npub1...` format.

**nsec**
A bech32-encoded Nostr private key. Never leaves the OPFS Vault. Never transmitted to any server. Generated entirely client-side.

**NTAG424**
An NFC chip (NTAG424 DNA TT) that supports SUN (Secure Unique NFC) authentication using AES-128-CMAC. Used in Satnam for physical presence verification and as identity/ceremony cards. See [NFC Operations](../user-guides/nfc/README.md).

**NWC (Nostr Wallet Connect)**
NIP-47. A protocol for controlling a Lightning wallet via Nostr events. The wallet owner generates a NWC URI that includes the relay, wallet pubkey, and connection secret. Satnam stores NWC URIs in the OPFS Vault and uses them for all Lightning operations. See [Connecting a Wallet](../user-guides/getting-started/connecting-wallet.md).

---

## O

**Offer (kind:39241)**
A NIP-AC event published by a DVM provider in response to an Intent. Offers specify the price, estimated time, and capabilities. Principals review Offers in the Satnam marketplace UI. See [Credit Envelopes](../user-guides/marketplace/credit-envelopes.md).

**Offspring**
An Immature Beneficiary in a Satnam group. Offspring have restricted capabilities and require Guardian or Steward approval for most operations (spending, DVM job submission, group membership changes). Both human members and supervised (NIP-SA) agents can hold the Offspring role.

**OpenAgents**
The platform that operates Pylon relay, Probe coding agent, and the Autopilot DVM marketplace. Satnam integrates natively with OpenAgents infrastructure.

**OPFS (Origin Private File System)**
A browser storage API (`navigator.storage.getDirectory()`) that provides a sandboxed, origin-isolated file system. Unlike `localStorage`, OPFS is not accessible to JavaScript running in other origins or browser extensions. Satnam's vault is built on OPFS.

**OPFS Vault**
The encrypted key storage module in Satnam. All sensitive material (nsec, FROST shares, NWC URIs, NFC AES keys, Cashu proofs) lives only in the OPFS Vault, encrypted under a device-bound key. See [Architecture](./architecture.md#opfs-vault-structure).

---

## P

**PIN Gate**
Every NFC-triggered operation that modifies identity state requires PIN confirmation before execution. The PIN is verified against an argon2id-derived verifier stored in the OPFS Vault. See [Proof of Life](../user-guides/nfc/proof-of-life.md#pin-gate).

**Pylon**
The OpenAgents authenticated Nostr relay. Requires NIP-42 AUTH. Serves as the primary relay for all agent coordination events (kinds 39200–39245), Probe session events, and SpacetimeDB bridge events. CEPS connects to Pylon automatically.

**Principal**
A human user who holds a root Nostr keypair. The sovereign entity in the Satnam system. A Principal can be a Guardian, Steward, Adult, or Offspring depending on their role within a given group.

**Probe**
The OpenAgents coding agent. Satnam provides session monitoring, tool call approval UI, and execution result display for Probe sessions via trajectory event subscriptions (kinds 39230/39231). See [Monitoring Agents](../user-guides/agents/monitoring-agents.md).

**Proof of Life**
A NIP-78 ceremony that proves physical presence of an NFC card holder. The ceremony runs through seven states: IDLE → INITIATED → CARD_TAPPED → PIN_VERIFIED → SIGNED → PUBLISHED → CONFIRMED. See [Proof of Life](../user-guides/nfc/proof-of-life.md).

---

## R

**Relay**
A Nostr server that stores and serves signed events. Satnam publishes to and subscribes from multiple relays, with Pylon as the primary authenticated relay and public relays as fallback.

**Reputation**
A trust score associated with a Nostr pubkey in the OpenAgents marketplace. Affected by Sig4Sats bond completion (bonus) and Default Notices (penalty). Calculated from `task_completion_score * weight + sig4sats_bonus`.

---

## S

**Schnorr**
The signature scheme used by Nostr and Bitcoin. secp256k1 Schnorr signatures are produced by `@noble/curves`. FROST produces FROST-Schnorr threshold signatures that are indistinguishable from single-signer Schnorr signatures.

**Security Invariants (S1–S12)**
The 12 concrete technical rules that enforce the mandate axioms. See [What is Satnam?](./what-is-satnam.md#the-12-security-invariants).

**Settlement Receipt (kind:39244)**
The NIP-AC event published after task completion. Includes Cashu token redemption proof for Sig4Sats performance bonds. See [Credit Envelopes](../user-guides/marketplace/credit-envelopes.md).

**Sig4Sats**
A performance bond mechanism where DVM providers post Cashu tokens as collateral before work begins. On successful settlement, the bond is returned plus a 15% reputation bonus. On default, the bond is forfeited. See [Credit Envelopes](../user-guides/marketplace/credit-envelopes.md).

**Skill**
A capability that an Agent can execute, registered via NIP-SKL (kind:33400) and attested by Guardians. Skills have attestation tiers: tier1 (self-declared), tier2 (peer-reviewed), tier3 (guardian-attested), tier4 (oracle-verified). See [Creating an Agent](../user-guides/agents/creating-an-agent.md#assigning-skills).

**Skill Registry (NIP-SKL)**
The skill registry protocol. kind:33400 events define skill manifests; kind:33401 tracks version history. A 5-check runtime gate (`verifySkillExecution()`) guards every agent skill execution. See [Creating an Agent](../user-guides/agents/creating-an-agent.md).

**Sovereign Agent (NIP-SA)**
The agent protocol. kind:39200 defines the agent profile (capabilities, autonomy level, wallet policy, coordination relays). Satnam implements the full NIP-SA client stack for creating, monitoring, and delegating to agents.

**SpacetimeDB**
The real-time coordination database used by OpenAgents for presence, session sync, and compute assignment. Satnam bridges to SpacetimeDB via Pylon relay events, without adding the SpacetimeDB SDK as a direct dependency.

**Steward**
The Trustee role — the operational authority level in a Satnam group. Stewards hold FROST share #2, co-sign group transactions above threshold, can add/remove members up to the Adult level, and can delegate authority to Adults and Offspring.

**SUN (Secure Unique NFC)**
The NTAG424 feature that generates a cryptographically authenticated URL on every tap. The URL includes an encrypted UID+counter (`piccDataHex`) and a CMAC value (`cmacHex`). Satnam verifies SUN messages client-side.

---

## T

**TapSigner**
A hardware NFC signer using the CKTAP protocol. In Satnam, TapSigner acts as a Nostr signer adapter — it signs Nostr events on-card without exposing the private key to the host device.

**Threshold**
The minimum number of FROST participants required to produce a valid group signature. In a 2-of-3 setup, any 2 of the 3 keyholders can sign on behalf of the group.

**Trust Estate**
The legal/organizational framing behind Satnam's role hierarchy: Guardian = Trust Protector, Steward = Trustee, Adult = Mature Beneficiary, Offspring = Immature Beneficiary. This framing reflects real-world trust structures (family trusts, business succession) that Satnam models digitally.

---

## V

**Vault**
See **OPFS Vault**.

---

## W

**WebAuthn PRF**
A WebAuthn extension that derives a deterministic 32-byte secret from the user's hardware authenticator (passkey). Satnam uses the PRF output as the vault wrapping key when available (preferred over passphrase derivation because it requires physical hardware presence).

**Wrapping Key**
The key that encrypts/decrypts the vault master key. Derived from either a WebAuthn PRF credential or argon2id(passphrase). The wrapping key is never stored — it is re-derived on each vault unlock.

---

## Related Pages

- [What is Satnam?](./what-is-satnam.md)
- [System Architecture](./architecture.md)
- [Getting Started](../user-guides/getting-started/README.md)
