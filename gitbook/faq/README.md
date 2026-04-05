# Frequently Asked Questions

---

## General

### What is Satnam?

Satnam is a Peer and Trust Relationship Manager (PTRM) — a Progressive Web App that combines Nostr identity, Bitcoin Lightning payments, eCash micropayments, and threshold cryptography. It is designed for individuals, families, groups, and AI agent operators who need sovereign digital identity and self-custody financial operations without trusting a centralized server.

### How is Satnam different from other Nostr clients?

Most Nostr clients focus on social media (notes and profiles). Satnam focuses on trust relationships and financial operations: group key management via FROST threshold signatures, Lightning and Cashu payments, AI agent deployment, and an NFC-based physical verification system. It uses Nostr's cryptographic identity layer but extends it with the NIP Triumvirate (NIP-SA, NIP-AC, NIP-SKL) for autonomous agent economics.

### Why Nostr instead of a traditional API?

Nostr events are cryptographically signed, relay-distributed, and owned by the user. There is no company between you and your data — if Satnam disappears tomorrow, your identity, delegation events, and agent profiles still exist on Nostr relays. A traditional API means the company owns your data and can delete, modify, or monetize it. Nostr gives you permanent, self-sovereign data.

### Is Satnam only for Bitcoin users?

Yes. Satnam denominates all value in satoshis (Bitcoin). There are no fiat shims, no altcoin rails, and no currency conversion in storage. This is Mandate Axiom 1 — a non-negotiable design decision. FX conversion for display purposes is available as a feature-flag-gated option, but no fiat values are stored anywhere.

### What does "sovereignty-first" mean in practice?

It means you hold your private keys — the server never does. Your nsec is generated in your browser, encrypted under a key that only your device can derive, and stored in the browser's Origin Private File System (OPFS). The Satnam servers handle only public data (username-to-pubkey mappings) and pass-through operations (NWC proxying, encrypted message relaying). They cannot impersonate you, access your wallet, or see your messages.

---

## Identity

### What is the difference between npub and nsec?

Your **npub** is your public identity — it is like your username on Nostr. You can share it freely. Your **nsec** is your private key — it is like your password, but it cannot be changed or reset. Anyone who has your nsec can sign events as you, access your wallet, and read your encrypted messages. Satnam stores your nsec encrypted in your OPFS Vault and never transmits it to any server.

### What is NIP-05 and why do I need it?

NIP-05 maps a human-readable identifier (`you@satnam.pub`) to your Nostr public key (`npub1...`). It makes you discoverable by name instead of a 63-character string. It also provides a form of verification — anyone can confirm that `you@satnam.pub` corresponds to your npub by fetching the `/.well-known/nostr.json` file. In Satnam, NIP-05 registration also creates your Lightning address (`you@satnam.pub`) for receiving Bitcoin payments.

### What happens if I lose my nsec?

Your nsec is stored encrypted in your OPFS Vault. If you lose access to your device without a backup, your identity is unrecoverable — there is no server-side password reset. This is intentional. Mitigation options: export an encrypted vault backup to a secure location, write down your nsec as a BIP-39 mnemonic, or use WebAuthn (biometric) vault locking which provides hardware-backed recovery on the same device. See [Key Custody Model](../security/key-custody.md) for recovery paths.

### Can I use Satnam with my existing Nostr identity?

Yes. You can import your existing nsec during onboarding. Satnam will encrypt it under your device key and store it in the OPFS Vault. Your existing NIP-05 identifier (if from another provider) can coexist with a `user@satnam.pub` identifier — Nostr supports multiple identifiers per key.

### Can I have multiple identities?

Yes. The OPFS Vault stores multiple nsec files under different npubs. You can switch between identities from the profile selector. Each identity has its own delegations, group memberships, and wallet connections.

---

## Wallet

### What is NWC (Nostr Wallet Connect)?

NWC (NIP-47) is a protocol that lets you connect your self-custody Lightning wallet to applications like Satnam without giving the app custody of your funds. You connect via a `nostr+walletconnect://` URI, which is stored encrypted in your OPFS Vault. Satnam sends payment requests to your wallet via this connection; your wallet signs and executes them. Compatible wallets: Alby Hub, Phoenix, Mutiny, LND via NWC bridge, CLN via NWC bridge.

### What is Cashu eCash and when is it used?

Cashu is a Bitcoin-backed eCash protocol that provides privacy-preserving micropayments. Unlike Lightning (where payment routing leaves a trail), Cashu tokens are blind-signed — the mint cannot link the token to its creation. Satnam uses Cashu for: sub-1-sat micropayments (where Lightning routing would be uneconomical), agent-to-agent payments, and Sig4Sats performance bonds. All Cashu proofs are stored encrypted in your OPFS Vault.

### Why are all amounts in millisatoshis (msats)?

Satoshis are the smallest Bitcoin unit (1 BTC = 100,000,000 sats). Millisatoshis (1 msat = 0.001 sats) allow for sub-satoshi precision in payment channels, which is important for accurate micropayment accounting. Satnam stores all balances as `BigInt` msats internally, converting to sats for display.

### What wallets are compatible?

Any NIP-47 compliant wallet. Tested and recommended: Alby Hub (self-hosted or Alby.host cloud), Phoenix (via NWC bridge), LND/CLN (via Alby or LNbits NWC extension). The NWC connection is wallet-agnostic — Satnam does not hardcode any specific wallet backend.

### Are there fees for using Satnam?

Satnam itself charges no application fees. You pay:
- Lightning network routing fees (charged by Lightning nodes, typically <1% for small amounts)
- Cashu mint fees (typically 0–0.5%)
- Bitcoin transaction fees when opening/closing Lightning channels (if using self-hosted node)
- NIP-90 provider fees (set by individual DVM providers in their offers)

---

## Groups

### What is FROST and why do you use it?

FROST (Flexible Round-Optimized Schnorr Threshold) is a cryptographic protocol for threshold signatures. In a 2-of-3 FROST group, any two of the three members can co-sign an event, but no single member can sign alone. Critically, the full group private key never exists anywhere — not in memory, not on any server. This is fundamentally more secure than the previous Shamir Secret Sharing approach, which required reconstructing the full key on a server for every signing operation.

### How is a "2-of-3" group different from a "3-of-3" group?

In a **2-of-3** group, any two of the three keyholder can produce a valid group signature. This provides resilience — if one member is unavailable, the other two can still act. In a **3-of-3** group, all three must sign. This is maximally secure but requires unanimous availability. Choose based on your risk model: 2-of-3 is recommended for family trusts; 3-of-3 for high-security institutional arrangements.

### What happens if a Guardian leaves?

The Guardian's departure requires a FROST share rotation ceremony. The departing Guardian's share is invalidated, a new participant is added (or the group is reduced to n-1), and new shares are generated for all remaining participants. The group's Nostr pubkey remains the same — all previous events signed by the group remain valid.

### How are roles assigned — is there a database?

No database. Roles are assigned via NIP-26 delegation events: cryptographically signed Nostr events that grant specific capabilities to specific pubkeys for specific time periods. These events live on Nostr relays, are verifiable by anyone, and expire at the time set when the delegation was created. The Guardian signs delegations for Stewards; Stewards can issue sub-delegations for Adults and Offspring within the bounds of their own delegation.

### Can an agent be a group member?

Yes. NIP-SA autonomous agents (`kind:39200` profile, Adult autonomy level) can be group members. They receive NIP-26 delegations just like human members. The agent's nsec is stored in the OPFS Vault on the Principal's device (for locally-run agents) or in the agent runner's vault (for deployed agents).

---

## Agents

### What is a NIP-SA agent?

A NIP-SA (Sovereign Agent) is an autonomous Nostr identity that operates under a spend policy and skill set defined by its Governor (Guardian or Steward). It has its own nsec, publishes its own events, receives its own Lightning payments, and executes work in the NIP-90 DVM marketplace. Unlike traditional API agents, it is not controlled by a central server — it operates through signed Nostr events.

### What is a spend policy?

A spend policy is a set of constraints on how much an agent can spend autonomously. It includes: maximum per-transaction amount, rolling daily limit, and an approval threshold above which the Governor must co-sign. Spend policies are declared in the agent's `kind:39200` profile and enforced client-side by the NIP-AC credit lifecycle — the agent cannot construct a valid Spend Authorization event (kind:39243) above its policy limits without the Governor's signature.

### What is the NIP-SKL skill registry?

NIP-SKL (Skill Registry) is a protocol for formally declaring and attesting agent capabilities. A skill manifest (`kind:33400`) defines what an agent can do, what inputs it accepts, and what resource limits apply. Attestations (`kind:1985`) from Guardians or oracles vouch for the skill. Before executing any skill, the NIP-SKL runtime gate runs five checks: manifest exists, guardian attestation valid, not revoked, version matches, constraints satisfied.

### Can my agent run without my laptop being open?

Yes, if the agent is deployed on a remote runner with its own OPFS Vault (or equivalent server-side storage). Satnam v2 supports local agents (nsec in your browser's OPFS) and remote agents (nsec in a runner vault on a server you control). The Governor's laptop only needs to be open when approving spending above the approval threshold, participating in FROST signing ceremonies, or issuing new NIP-26 delegations.

---

## Security

### How is the vault encrypted?

The OPFS Vault uses two layers of encryption. The outer layer is your wrapping key — either derived from a WebAuthn hardware authenticator (biometric/security key) or from your passphrase via `argon2id(passphrase, salt, { m: 65536, t: 3, p: 4 })`. This wrapping key decrypts the vault master key. The master key (AES-256-GCM) then decrypts each individual file using XChaCha20-Poly1305. The master key exists only in JavaScript memory while the vault is unlocked and is zeroed on lock.

### Can Satnam employees see my private keys?

No. Your private keys (nsec, FROST shares, NWC URIs, NFC AES keys) never leave your device. Satnam's servers handle only public data (NIP-05 username mappings) and encrypted pass-throughs (NWC connection proxying, gift-wrapped message relaying). There is no technical mechanism by which Satnam staff could access your keys even if legally compelled to do so.

### Does Satnam work offline?

Partially. The PWA shell and all UI components are cached by the service worker and work offline. Vault operations (reading/writing keys) work offline. Signing events works offline. Publishing events to relays requires internet connectivity — queued events are sent when connectivity is restored via background sync. Real-time features (FROST signing ceremonies, DVM jobs, Probe session monitoring) require connectivity.

### What if I lose my device?

Immediately notify your Group Guardian to initiate FROST share rotation — this invalidates your old share so an attacker cannot use it. Your individual identity is protected by the vault encryption (argon2id or WebAuthn). Recovery paths depend on whether you have a vault backup and/or a paper nsec backup. See [Key Custody Model: What Happens If You Lose Your Device](../security/key-custody.md#what-happens-if-you-lose-your-device) for the full recovery playbook.

### How do I migrate my identity to a new device?

The recommended path: export an encrypted vault backup from your old device (vault settings → Export Backup), transfer the backup file to your new device via secure channel (USB, AirDrop), and import it on the new device. If using WebAuthn, you will need to re-register your biometric on the new device using your old passphrase as a fallback to re-wrap the master key. See [Key Custody: Recovery Paths](../security/key-custody.md#recovery-paths).

---

## Technical

### What browsers does Satnam support?

Full support: Chrome/Chromium 89+ on Android and desktop. NFC features require Android Chrome. Partial support: Firefox and Safari (no NFC write capability; NFC read works on iOS 15.4+ via Universal Links). The PWA installation experience is best on Chrome.

### Does Satnam work as a PWA on iOS?

Yes, with limitations. Install via Safari's "Add to Home Screen." Lightning and Cashu work fully. NFC tap-to-read works on iOS 15.4+ via Universal Link interception. NFC provisioning (writing keys to card) requires Android. FROST ceremonies work fully. Some background sync features may behave differently due to iOS PWA restrictions.

### What NFC cards are supported?

Primary: NTAG424 DNA TT (ISO 14443-4, AES-128-CMAC via SUN/SDM). Also supported: TapSigner (CKTAP protocol, used as a Nostr signer). The v1 BoltCard/LNbits integration is eliminated — NFC payment functionality routes through NWC, not directly through the card.

### Why does Satnam only have 22 production dependencies?

Every dependency is a potential supply chain attack vector. The dependency count limit (Mandate Axiom 4) forces deliberate trade-offs: every package must justify its presence against a specific axiom. The 22 packages cover cryptography (`@noble/*`, `@frostr/bifrost`), payments (`@getalby/sdk`, `@cashu/cashu-ts`, `bolt11`), Nostr (`nostr-tools`), UI (`react`, `tailwind-merge`, `lucide-react`), and infrastructure (`@supabase/supabase-js`). No bloat, no redundancy.

### What is the service worker caching strategy?

Static assets (HTML, CSS, JS, fonts, icons) use cache-first strategy — they load instantly from local cache and update in the background. API calls (Netlify functions) use network-first — live data is preferred, with cached responses as fallback. Queued Nostr events use background sync — if the publish fails due to connectivity loss, it is retried when the connection is restored.

---

## Migration

### Is there a migration from v1?

No. Satnam v1 was a research and development prototype with only test accounts. v2 is a complete greenfield rebuild — no user data, credentials, or configuration carries over from v1.

### What happened to v1?

v1 served its purpose as a testing ground and scored 3.2/10 in the security audit. Its codebase (2,182 files, 60 Netlify functions, 45 dependencies) proved that a greenfield rewrite was more economical than refactoring. Key architectural learnings from v1 informed v2’s design, and 10 salvageable modules were extracted and decontaminated for reuse.
