---
title: PRD — N424 Physical MFA Mobile Signing Devices (LNbits-free)
type: prd
date: 2026-09-27
status: draft
tags: [n424, nfc, mfa, frost, vault, satnamd, ux]
---

# PRD — N424 Physical MFA Mobile Signing Devices
### LNbits-free Deterministic Provisioning + FROSTR Multisig

> Stack: NTAG424 DNA (N424) == Boltcard chip, SUN (Secure Unique NFC), CMAC, IssuerKey deterministic K0-K4, Web NFC + PN532 (ESP32-P4 Terminal), Vault OPFS + PIN (argon2id + xorWrappingKeys), satnamd Issuer + `/api/nfc/scan` + `/nfc/provision`, NIP-46 bunker, FROSTR (Bifrost) k-of-n.

---

## 1. Objective

Give every Satnam user a **physical MFA tag** (phone-tappable N424 card/sticker) that gates **Nostr event signing** (NIP-46 bunker) with **tap + PIN**, works for **solo self-custody** and **group FROSTR multisig** (k-of-n mitigates single-source rug pull), and is **fully LNbits-free**. The flow must be non-technical: written walkthroughs for **loading (provision), redeeming (tap to sign), backing up**, and **FROSTR setup** that a non-dev can follow with a phone or $18 Terminal.

**Success in one line:** A guardian provisions 3 tags for a 2-of-3 family vault in <10 min, each member backs up offline, and a tap+PIN signs a `kind:1` without touching LNbits.

Non-goals (Phase 1): No LNbits Boltcard extension, no per-card DB of keys (deterministic), no new custody server, no TapLinX license.

---

## 2. Personas

- **Solo Sovereign (Alice)** — one tag for her `my.satnam.pub` ID, wants backup she can hide in a drawer.
- **Family Guardian (Bob)** — provisions 3 tags for 2-of-3 household FROSTR, wants rug-pull resistance.
- **Group Steward (Carol, 3-of-5 DAO)** — issues 5 tags, revokes one, re-provisions same UID with Version+1.
- **Counter Staff (Dan, Terminal)** — $18 ESP32-P4 Terminal at shop, taps customer tag to redeem.

---

## 3. Development Pattern (founder-mandated)

**DB schemas → backend working → frontend alignment.** No frontend before DB+backend verify. Each phase gates on `tsc 0 + deps 22/22 + invariants + manual tap test` (stub `p/c` + counter monotonic).

---

## 4. Database Schemas

### 4.1 satnamd Vault (OPFS, device-local, never Supabase)

```
nfc/issuer.key          — 16B AES IssuerKey (hex, vault-encrypted). One per registrar. Generated once via POST /nfc/issuer/init.
nfc/cards/{id}.json     — { uid: "04..", version: 0, id: "abcd..", k0..k4: hex, createdAt }
nfc/counters/{id}.json  — { lastCtr: number }  # monotonic SUN counter per ID
nfc/backups/{id}.json   — encrypted backup blob (see §7)
vault/agent/{id}.nsec   — existing NIP-06 nsec, gated by PIN+tap
```

### 4.2 Supabase (shared truth, no key material)

```sql
-- mirrors for NIP-05 / discovery, no keys
create table nfc_issuer (
  id uuid primary key default gen_random_uuid(),
  pubkey text not null,          -- registrar pubkey that owns IssuerKey (Vault holds secret)
  created_at timestamptz default now()
);

create table nfc_cards (
  id text primary key,           -- ID = PRF(IssuerKey, 0x2d003f7b || UID)[:16 hex]
  uid text not null,             -- 7B hex
  version int not null default 0,
  state text not null check (state in ('configured','reset')),
  owner_pubkey text,             -- which member owns this tag (for FROSTR mapping)
  group_id text,                 -- optional family/DAO group
  last_ctr int default 0,
  created_at timestamptz default now(),
  unique(uid, version)
);

create table nfc_backups (
  id text primary key references nfc_cards(id),
  enc_blob text not null,        -- AES-GCM with PIN-derived key, stored for user download, NOT server-decryptable
  created_at timestamptz default now()
);

-- FROSTR linkage (existing frost tables extend)
create table frost_mfa_bindings (
  share_id text primary key,
  nfc_card_id text references nfc_cards(id),
  threshold int not null,
  participants int not null,
  created_at timestamptz default now()
);
```

Migrations: `database/migrations/0xx_nfc_issuer_and_counters.sql` + `0xx_frost_mfa_bindings.sql`.

Invariants: No `k0..k4` in Supabase (S1), no OPFS in Netlify functions (S5), counter update atomic (SELECT FOR UPDATE).

---

## 5. Backend (satnamd)

| Endpoint | Auth | Body/Query | Returns | Notes |
|----------|------|------------|---------|-------|
| `POST /nfc/issuer/init` | NIP-98 guardian | `{}` | `{ id, pubkey }` | generates `IssuerKey` → `nfc/issuer.key` Vault, once. Fail if exists. |
| `POST /nfc/provision` | NIP-98 | `{ uid: "04..", version?: number }` | `{ id, uid, version, k0..k4 (hex), uri: "lnurlw://bridge.satnam.pub/api/nfc/scan?p=..&c=..", state }` | derive `CardKey→K0..K4, ID`, write `nfc/cards/{id}.json` + `nfc_cards` row. Client then writes NDEF via Web NFC/PN532. |
| `GET /api/nfc/scan?p=<32hex>&c=<16hex>` | none (SUN) | — | `{ ok, uid, id, ctr, lastCtr }` or `{ ok:false, reason }` | decrypt `p` with K1 (AES), check `0xc7`, verify `c` CMAC(K2), enforce `ctr > lastCtr`, update `nfc_counters` + `nfc_cards.last_ctr`. |
| `POST /nfc/backup/{id}` | NIP-98 + tap+PIN | `{ encBlob }` | `{ ok }` | stores `nfc_backups.enc_blob` (client-side AES-GCM). |
| `POST /nfc/wipe/{id}` | NIP-98 + tap | `{}` | `{ ok, newVersion }` | `ResetCard` + increment version, set `state=reset`, new `K0..K4` on next provision same UID. |

Crypto: `prfCmac(key, msg)` = `AES-CMAC (NIST 800-38B)` via `@noble/ciphers` (`cmac.ts` already in repo). Stub `sha256` for tests, real CMAC for prod. Keys 16B, `IssuerKey` never leaves Vault.

---

## 6. Frontend / UI/UX

### 6.1 Navigation

`Settings → Security → Physical MFA` (existing Vault settings). Cards: `+ Add tag`, `Back up`, `FROSTR Setup`. Empty state: illustration + “Tap a blank N424 — 60s”.

### 6.2 Loading (Provision) — Walkthrough

**Prereqs:** blank `NTAG424 DNA` ($1 sticker), phone with NFC (Chrome Android) or Terminal + USB. `Bridge URL` already set (`bridge.satnam.pub`).

Steps (in-app, numbered, with “Check” buttons):

1. **Check tag blank** — Tap blank tag → app reads UID → shows `UID 04:... Ready`. If not blank → offer `Wipe` then retry.
2. **Derive & write** — `POST /nfc/provision {uid}` → receive `uri` → `NDEFReader.write({recordType:"url", data: uri})` (or PN532 `SetupBoltcard`). App shows progress ring (lawalletio style) → `ChangeKey K0..K4` → verify `Read NDEF` `p/c` non-zero and change on second read → ✅.
3. **Set PIN** — `Enter 4-8 digit PIN` → `Confirm` → `argon2id(PIN, salt) → xorWrappingKeys` bound to tag `ID`. Explain: “PIN never leaves phone — it unlocks the wrapping key that lets this tag sign.”
4. **Test tap** — `Tap + PIN → Sign test kind:1` → shows `✓ SUN  ctr 1 > 0, CMAC ok`.
5. **Back up now** — auto-prompt §6.4.

Tail call: tag now appears as `● Configured — CTR 1 — Owner: Alice`.

### 6.3 Redeeming (Tap to Sign)

Any NIP-46 `authorizeAgentSigningRequest` (bunker) triggers `Tap + PIN` sheet:

1. **Tap tag** — reads `p/c` via NFC → `GET /api/nfc/scan?p=&c=` → verifies SUN+counter.
2. **Enter PIN** — `pin-gate.ts` unlocks wrapping → `Vault` releases `nsec` share for this `kind`/`max_sats`/`providerAllowlist` gate.
3. **Sign** — `schnorr.sign` or `FROSTR` partial sign → bunker returns. Counter increments; replay (`ctr <= lastCtr`) fails with “Tag already used — tap again for fresh counter”.

Edge: counter gap >10 → warn “Tag out of sync — re-tap”.

### 6.4 Backing Up — Walkthrough

**Why:** Tags are physical — lose it, lose MFA. Backup is **encrypted blob**, not raw keys.

Steps:

1. **After provision or anytime:** `Security → Physical MFA → ● tag → Back up` → `Enter PIN` → app derives `backupKey = argon2id(PIN, backupSalt)` → `AES-GCM(encBlob = JSON.stringify({k0..k4, version, uid}))` → `POST /nfc/backup/{id} {encBlob}` + offer download `satnam-mfa-{id}.bak.json` + printable QR (offline).
2. **Verify backup** — `Tap backup file → Enter PIN → decrypt → show “✓ Restorable”` without writing tag.
3. **Store offline** — guidance: “Print QR, put in envelope, drawer. Delete download from phone after printing. We cannot recover PIN — write it down separately.”

Restore: `Add tag → Restore from backup → pick .bak.json or scan QR → Enter PIN → choose blank tag UID → POST /nfc/provision {uid, version: backup.version}` → writes same keys to new tag (Version preserves ID).

### 6.5 FROSTR Multisig with MFA Tags

**Solo hardening:** Alice does 2-of-2 — `Share A` on phone Vault, `Share B` gated by tag tap+PIN. Lose phone still needs tag+PIN.

**Group (2-of-3 family, 3-of-5 DAO):**

Setup walkthrough (`Security → Physical MFA → FROSTR Setup`):

1. **Create FROSTR group** — picks `k/n` (e.g., 2/3) → `Bifrost` `ceremony` → `n` shares.
2. **Bind shares to tags** — for each participant: `Assign tag → Tap tag → Bind share_id ↔ nfc_card_id` writes `frost_mfa_bindings`. Each share’s `nsec` sub-key is wrapped with that tag’s `xorWrappingKeys` (so signing that share requires that tag+PIN).
3. **Threshold signing** — to sign, collect `k` taps (each participant taps own tag+PIN on their phone, or guardian collects sequential taps) → `k` partial signatures → combine → final Nostr event.

Written guide section: “Why this mitigates rug pull: No single tag or phone can sign alone — `k` distinct physical taps required. Removing a member = `wipe` their tag + `newVersion` + re-share.” Includes revoke walkthrough: `Security → FROSTR → Member → Revoke → Wipe tag → state=reset → increment version → re-provision spare`.

---

## 7. Security & Backup Model

- **PIN:** `argon2id` (browser `argon2-browser`), salt per tag, `xorWrappingKeys` — never sent, never in Supabase. Brute-force rate limit 10 tries then 60s lock.
- **SUN:** `ctr` monotonic per `ID`, `c` CMAC(K2) checked — replay fails.
- **Backup:** client-side `AES-GCM`, `nfc_backups.enc_blob` opaque to server. Test restore path in onboarding.
- **Threats:** stolen tag without PIN → cannot sign; stolen phone without tag → cannot sign; backup file without PIN → useless; `IssuerKey` compromise → rotate Issuer (new `IssuerKey`) + re-provision all UIDs version 0 new ID.

---

## 8. Acceptance Criteria

- [ ] DB migrations apply, S1/S5 pass, no `k*` in Supabase.
- [ ] `POST /nfc/issuer/init` once → Vault holds 16B; second call 409.
- [ ] Blank `NTAG424` provision writes `p/c` non-zero and `c` changes on second read (via Web NFC mock + real PN532 path).
- [ ] `GET /api/nfc/scan` verifies `p/c`, rejects replay (`ctr <= last`), increments `lastCtr`.
- [ ] Tap+PIN signs `kind:1` via bunker; wrong PIN fails.
- [ ] Backup create → download → restore to new tag with same UID+version succeeds; backup file decrypt requires PIN.
- [ ] 2-of-3 FROSTR: 2 distinct tag taps sign, 1 tap alone fails; revoke flow works.
- [ ] Written walkthroughs render in app (`/help/mfa/*`) and in `docs/` MD, non-technical readability.
- [ ] `tsc 0`, `deps 22/22`, `invariants 11/12` (S10 _lib false positive) + `satnamd tsc 0`.

---

## 9. Rollout

1. **DB → Backend** — migrations + `nfcIssuer.ts` + `/api/nfc/scan` verify (this PRD).
2. **Frontend Provision/Scan/Backup UI** — `Physical MFA` page + walkthrough MD.
3. **FROSTR binding** — `frost_mfa_bindings` + threshold tap flow.
4. **Terminal PN532** — ESP32-P4 `Bitcoin Terminal` firmware note for shop use.
5. **Docs** — `docs/nfc-walkthrough.md` + `gitbook` `libraries/nfc` + printable backup sheet.

---

## 10. Open Questions

- Web NFC iOS fallback: `ios-fallback.ts` already stubbed — need native `PN532` reader app if iOS Web NFC unavailable.
- Pricing: tags $1 each, Terminal $18 — document where to buy (AliExpress links from Terminal POS).
