---
title: Implementation Plan — N424 MFA Mobile Signing (Agent Roster)
type: plan
date: 2026-09-27
prd: PRD-N424-MFA-Mobile-Signing.md
status: draft
tags: [n424, roster, implementation]
---

# Implementation Plan — N424 Physical MFA (Agent Roster Orchestration)

> Pattern: **DB schemas → backend working → frontend alignment.** No frontend before backend verifies. Gates: `tsc 0 + deps 22/22 + invariants 11/12 + manual tap (stub p/c)`.

## Roster & Ownership

| Agent | Owns | Source of Truth |
|-------|------|-----------------|
| **Repository Steward** | migrations, gates, `tsc/dep/invariant` | `database/migrations/`, `config.yaml` |
| **Satnamd Engineer** | IssuerKey Vault, `/nfc/*` + `/api/nfc/scan`, CMAC | `satnamd/src/lib/nfcIssuer.ts` |
| **Vault/Bunker Engineer** | OPFS `nfc/*`, `pin-gate.ts`, NIP-46 tap gate | `src/lib/nfc/`, `src/lib/vault/` |
| **Web NFC / Terminal Engineer** | `webNfc.ts` + PN532 ESP32-P4 writer | `src/lib/nfc/webNfc.ts`, `ops/bridgelet/` |
| **Frontend Engineer** | `Settings → Security → Physical MFA` + walkthroughs | `src/components/wallet/`, `src/pages/Help/` |
| **FROSTR Engineer** | `frost_mfa_bindings` + Bifrost k-of-n tap collect | `src/lib/frost/` |
| **QA / Security** | SUN replay, counter monotonic, backup decrypt, S1/S5 | `tests/lib/nfc*` |
| **Docs Engineer** | `docs/nfc-walkthrough.md` + gitbook `libraries/nfc` | `gitbook/` |

All consequential writes require founder explicit instruction; drafts + review tasks route to human.

---

## Phase 0 — Foundation (DB Schemas) — 1 day — **Do now**

**WP-0A DB Migrations (Repository Steward)**

- `001` already exists — add:
  - `database/migrations/0xx_nfc_issuer_and_counters.sql` — `nfc_issuer(id, pubkey, created_at)`, `nfc_cards(id, uid, version, state, owner_pubkey, group_id, last_ctr)`, `nfc_backups(id, enc_blob)` — no key material, `CHECK state`, `UNIQUE(uid,version)`.
  - `database/migrations/0xx_frost_mfa_bindings.sql` — `frost_mfa_bindings(share_id, nfc_card_id FK, threshold, participants)`.
- Seed: none. Apply via `supabase migration up` locally, verify `psql \d`.
- Gate: `check-invariants S1 (no key columns) + S5 (no OPFS in functions)` pass.
- Handoff: schemas reviewed → Satnamd Engineer starts.

**WP-0B Spec Lock**

- `docs/SPEC-N424-LNBITS-FREE.md` (done) + `docs/SPECIFICATION-ADDENDUM-PHASE0-DRYRUN.md` Bridge URL. Freeze IssuerKey flow.

---

## Phase 1 — Backend Working (No Frontend) — 3 days

**WP-1A Satnamd Issuer + Provision (Satnamd Engineer)**

- `satnamd/src/lib/nfcIssuer.ts` — `generateIssuerKey()` → `Vault nfc/issuer.key`, `deriveCardKeys(issuer, uid, version)` → `K0..K4, ID` via `prfCmac(@noble/ciphers AES-CMAC)` — replace `sha256` stub with real `cmac.ts`.
- Endpoints: `POST /nfc/issuer/init` (409 if exists, NIP-98 guardian), `POST /nfc/provision {uid, version?}` (NIP-98), `POST /nfc/wipe/{id}`, `POST /nfc/backup/{id}`.
- Vault: `nfc/issuer.key` (16B hex), `nfc/cards/{id}.json`, `nfc/counters/{id}.json`.
- Test: `vitest satnamd` stub `p/c` lengths, version bump.
- Gate: `satnamd tsc 0`.

**WP-1B Scan Verify (Satnamd Engineer)**

- `GET /api/nfc/scan?p=32hex&c=16hex` — decrypt `p` with K1 `AES`, check `0xc7`, CMAC `c` with K2, `ctr > lastCtr` else `reason: replay`, atomic `UPDATE nfc_cards SET last_ctr = ctr WHERE id=$1 AND last_ctr < $2 RETURNING`.
- Rate limit per ID 10/min (reuse `rate-limit.ts`).
- Gate: manual `curl /api/nfc/scan?p=..&c=..` stub passes, replay fails.

**WP-1C PIN Gate Wiring (Vault/Bunker Engineer)**

- `src/lib/nfc/pin-gate.ts` already exists — wire `argon2id(PIN,salt) → xorWrappingKeys` to gate `vault/agent/{id}.nsec` release after `scan ok`. No Supabase PIN.
- Gate: wrong PIN fails, lockout after 10.

---

## Phase 2 — Frontend Alignment (After Backend Verifies) — 4 days

**WP-2A Physical MFA Page (Frontend Engineer)**

- Route `Settings → Security → Physical MFA` — list `nfc_cards` `● Configured / Reset — CTR — Owner`.
- `+ Add tag` → `NWCWalletSetupModal` style but for NFC: `Check blank (read UID) → Derive & Write (NDEFReader.write uri + ChangeKey K0..K4 + verify p/c) → Set PIN → Test tap → Back up now`. Progress ring (lawalletio bulk style).
- `Back up` → derives `backupKey argon2id(PIN)` → `AES-GCM encBlob` → `POST /nfc/backup/{id}` + download `.bak.json` + QR. `Restore from backup` → `Enter PIN → pick blank UID → POST /nfc/provision {uid, version: backup.version}`.
- **Uses:** `src/lib/nfc/webNfc.ts` `writeBoltcardNdef`, `src/hooks/useNwcByo` pattern, **no @getalby/sdk**.

**WP-2B Redeem Sheet (Frontend + Vault/Bunker)**

- NIP-46 `authorizeAgentSigningRequest` triggers `Tap + PIN` sheet: `Tap (read p/c → GET /scan) → Enter PIN → pin-gate unlock → bunker schnorr/FROSTR`.
- Edge: `ctr gap >10` warns re-tap.

**WP-2C Docs In-App (Docs Engineer)**

- `/help/mfa/{provision,redeem,backup,frostr}` — copy from PRD §6.2-6.5, non-technical, screenshots placeholders `[NEED PHOTO]`.

Gate Phase 2: `tsc 0 + deps 22/22 + manual tap+PIN signs kind:1`.

---

## Phase 3 — FROSTR Multisig with Tags — 2 days

**WP-3A Bindings (FROSTR Engineer)**

- Create `frost_mfa_bindings` on `ceremony` k/n: `for each share: Assign tag → Tap → Bind share_id ↔ nfc_card_id` writes row. Wrap each share sub-key with that tag's `xorWrappingKeys` (so that share requires that tag+PIN).

**WP-3B Threshold Collect (FROSTR + Frontend)**

- Signing: collect `k` taps sequential — each `Tap+PIN → partial sig` → `Bifrost combine` → final event. Solo 2-of-2: Share A phone Vault, Share B tag-gated.
- Revoke: `FROSTR → Member → Revoke → POST /nfc/wipe/{id} → state=reset → version+1 → re-provision spare`.

Gate: 2-of-3 two distinct tags sign, 1 alone fails; revoke works.

---

## Phase 4 — Terminal PN532 (Shop) — 1 day, parallel

**WP-4A Terminal Writer (Web NFC/Terminal Engineer)**

- Document `Bitcoin Terminal JC4880P443 + PN532` wiring (reuse `thebitcointerminal.com` BOM) — `ops/bridgelet/Caddyfile` already `[VPS_HOST]` placeholder.
- Firmware note: `pn532` ESP-IDF component `SetupBoltcard` same URI. No extra backend.

---

## Orchestration & Commits

- Local commits at WP boundaries per Work-Package Commit Rule (Standard 9) — `git commit -m "feat(n424): WP-1A issuer init"` — no push without founder instruction.
- Weekly `tsc + deps + invariants` via `OpenCodeLogRotation 05:30`.
- Founder gates: DB schema review, backend verify demo, frontend walkthrough review, FROSTR tap demo.

## Risks

- iOS Web NFC unavailable → fallback `ios-fallback.ts` + PN532 reader app (deferred).
- `IssuerKey` loss → all tags re-provision (document rotate).

## Next Action

Founder approval: **Yes/No** — approve DB migrations first (WP-0A) → then `satnamd` provision/scan start.
