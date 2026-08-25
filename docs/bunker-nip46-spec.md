# Bunker NIP-46 Spec — Satnam v2 (WP 005)

**Status:** Spec only — no heap `nsec` code in this commit.
**Owner:** Engineering-Lead (spec), Implementation-Agent (future wiring)
**Relays:** Immortal relay on SHC — `wss://relay.satnam.pub`
**Encryption:** NIP-44 (v2) — relay sees only ciphertext
**Vault:** Phone bunker holds `nsec` in OPFS (`vault/identities/{npub}.nsec` — XChaCha20-Poly1305 under master key)

## 1. Objective

Provide **remote signing without `nsec` copy**: phone holds the master `nsec` in OPFS, laptop acts as NIP-46 client over the Immortal relay on SHC. Every `sign_event` requires an explicit approval tap on the phone. Revocation is via `kind:10003` (or presence removal). No `nsec` ever lands on the laptop heap in this commit.

## 2. Roles

- **Bunker (phone):** NIP-46 signer. Holds `nsec` in OPFS vault; publishes NIP-46 response events (`kind:24133`). Shows approval sheet per `sign_event` request.
- **Client (laptop):** NIP-46 client. Never holds `nsec`. Sends NIP-46 request events (`kind:24133`) over Immortal relay, waits for bunker response, then publishes the signed event itself.
- **Relay (Immortal):** `wss://relay.satnam.pub` on SHC. Forwards `kind:24133` events; never learns plaintext (NIP-44 encrypted).

## 3. Protocol — NIP-46 over NIP-44 on Immortal

### 3.1 Event kinds

- Request: `kind:24133` — client → bunker
- Response: `kind:24133` — bunker → client
- **Revocation:** `kind:10003` — bunker removes client `npub` from its `kind:10003` presence list (NIP-46 § “revoke”). Client MUST treat missing presence as revoked.

### 3.2 Wire format (NIP-46 + NIP-44)

Both directions use NIP-44 encryption with the bunker and client ephemeral keys. Relay sees:

```
kind:24133
tags: [[ "p", <counterparty_pubkey> ]]
content: nip44_encrypt(JSON({ id, method, params }), shared_secret)
```

Inner plaintext `content` (before NIP-44) is:

```json
{
  "id": "<uuid>",
  "method": "sign_event",
  "params": [ "<unsigned_event_json>" ]
}
```

Response from bunker (approval tap passed):

```json
{
  "id": "<uuid>",
  "result": "<signed_event_json>",
  "error": null
}
```

Or rejection:

```json
{
  "id": "<uuid>",
  "result": null,
  "error": "user_rejected"
}
```

### 3.3 Encryption — NIP-44

- Use NIP-44 v2 (`nip44.v2.encrypt` / `decrypt` from `nostr-tools`).
- Conversation key is ECDH between bunker `nsec` and client ephemeral pubkey (or the paired NIP-46 session keys stored in `vault/nip46/{session_id}.pairing`).
- **Invariant:** Relay operator (even SHC) cannot read `method` or `params` — only `kind` and `p` tag are plaintext.

### 3.4 Flow — `sign_event`

```
1. Laptop (client) constructs unsigned event e { kind, tags, content, created_at, pubkey }
2. Client NIP-44-encrypts { id, method: "sign_event", params: [e] } with bunker pubkey
3. Client publishes kind:24133 to wss://relay.satnam.pub
4. Immortal relay forwards to bunker (phone) subscription
5. Phone bunker NIP-44-decrypts request
6. Phone shows approval sheet:
     - Requesting client npub (from NIP-46 pairing)
     - Event kind + summary (never full nsec)
     - [Approve tap] [Reject]
7. User taps Approve (biometric or PIN-gated per SettingsVault preference — default None)
8. Phone loads nsec from OPFS vault (vault must be unlocked — else prompt passphrase)
9. Phone signs: signed = signEvent(e, nsec); then nsec fill(0) in transient buffer
10. Phone NIP-44-encrypts { id, result: signed, error: null } to client
11. Phone publishes kind:24133 response to relay
12. Relay forwards to client
13. Client NIP-44-decrypts response, validates signed event, publishes to its own relay set
```

### 3.5 Approval UX — tap per request

- No auto-approve. Every `sign_event` requires explicit tap.
- Optional: show rate-limit (max N approvals per minute) and display request origin (client relay URL).
- Revoke button on bunker instantly stops responding and removes client from `kind:10003`.

### 3.6 Pairing & discovery

- Pairing uses NIP-46 `connect` flow: bunker generates `nostrconnect://` URI (ephemeral pubkey + relay `wss://relay.satnam.pub` + secret). Client scans QR (reuse DeviceLinkQR pattern but **not** the same backup blob — pairing secret is separate).
- Pairing state stored encrypted in OPFS at `vault/nip46/{session_id}.pairing` as `Nip46PairingState` (already present in `src/lib/vault/types.ts`).
- Pairing secret is 32-byte random — relay never learns it.

## 4. Security properties

- **No heap `nsec` on client:** Laptop never holds `nsec` in JS heap in this commit (spec only). Future wiring will enforce `scanLocalStorageForSecrets`-style invariants for any `nsec` variable.
- **Relay is ciphertext-only:** Immortal relay on SHC sees `kind:24133` and `p` tag only; content is NIP-44 ciphertext.
- **Approval per request:** Stolen client cannot silently sign; each request needs phone tap + vault unlock (passphrase/PRF/PIN per SettingsVault).
- **Revoke is immediate:** Removing client npub from bunker `kind:10003` causes client requests to be ignored (no response). Client must poll `kind:10003` or treat timeout as revoke.
- **No `nsec` copy via DeviceLinkQR:** DeviceLinkQR clones the vault master key (encrypted backup); Bunker does NOT use DeviceLinkQR. The two flows are disjoint — QR clone is for same-npub laptop that *will* hold `nsec`; bunker is for no-copy remote signing. This commit keeps them separate.

## 5. Out of scope for this commit

- Heap `nsec` wiring on laptop heap (no `vault.getNsec` call from client heap in this diff).
- Relay deployment to SHC (Immortal relay infra not yet provisioned — relay URL is reserved, not live).
- Blossom 64TB blob store for `.satnam-backup` file (optional encrypted blob store — future work).
- Push notifications for approval sheet when app is backgrounded (future — Web Push or NIP-46 `ping`).
- FROST share bunker mode (future — `bfshare` signing via same approval flow).

## 6. Storage & code boundary (this commit)

- **This commit:** `docs/bunker-nip46-spec.md` (this file) only. No `src/lib/nip46/bunker.ts`, no `src/hooks/useNip46Bunker.tsx`, no heap `nsec` variable.
- **Next commit (authorized separately):** `src/lib/nip46/bunker.ts` (phone) + `src/lib/nip46/client.ts` (laptop) + `src/components/nip46/ApprovalSheet.tsx`, gated behind `getVaultSettings().secondFactor` preference.
- **Lint invariant:** `grep -rn "nsec" src/lib/nip46` must be empty in this commit. The bunker spec explicitly forbids adding heap `nsec` code here.

## 7. Verification

- `docs/bunker-nip46-spec.md` exists and describes the flow above with Immortal relay host `wss://relay.satnam.pub`, NIP-44, phone approval tap, and `kind:10003` revocation.
- `npm run lint` (tsc --noEmit) clean — spec is markdown, no TS.
- `npm run check:invariants` still green — no `nsec` handling in this commit touches S1 (no `encrypted_nsec` column), S4 (no localStorage nsec), S11 (no console logging of nsec).
- No heap `nsec` code: `grep -R "getNsec\|storeNsec" docs/bunker-nip46-spec.md` returns only this spec reference, not implementation.

## 8. References

- NIP-46: https://github.com/nostr-protocol/nips/blob/master/46.md
- NIP-44: https://github.com/nostr-protocol/nips/blob/master/44.md
- NIP-05 (satnam.pub / subdomain whitelist): `src/lib/identity/domain-whitelist.ts`
- OPFS Vault: `src/lib/vault/vault.ts` + `src/lib/vault/types.ts` (this commit extends `method` to `passphrase | webauthn | nfc`)
- DeviceLinkQR (A — Done Now): `src/components/vault/DeviceLinkQR.tsx`
- SettingsVault (second factor slot): `src/pages/SettingsVault.tsx`
