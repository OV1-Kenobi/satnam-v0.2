# Satnam v2 — Phase 0 Addendum: Pure CLINK Dry-Run

**Document ID:** SATNAM-V2-ADDENDUM-PHASE0-001
**Date:** 2026-09-27
**Prerequisite:** SPECIFICATION.md SATNAM-V2-SPEC-001
**Status:** DRAFT — principal approved `go dry-run`
**Constraint:** Founder directives 2026-09-27 — pure CLINK dry-run, Bridge URL not SERVICE_URL, bring-your-own NWC only (no Alby SDK), LNURL off but code retained, LDK stub deferred to Phase 1, Bot-Mother dry Enroll/PoW now.

## 0. Phase 0 Goal

Validate `NIP-05 == LN Address` via `CLINK` on `bridge.satnam.pub` and `Bot-Mother` `Enroll` without moving sats or requiring `LND/LDK` invoice settlement. `LDK stable-channel` lane remains architected but not executed.

## 1. Routing — Pure Dry-Run

```
PWA (VITE_ENABLE_CLINK=true, LNURL false)
  ├─ NIP-05 register: NIP-98 → register-identity → nip05_identifiers (my/our/agent) [real]
  ├─ Bridgelet dry: https://bridge.satnam.pub/.well-known/lnurlp/:name → {callback, tag: payRequest, minSendable, maxSendable, comment: DRY_RUN_no-settle}
  │     └─ backing CLINK noffer (synthetic, not minted via LND): noffer1dry… → 21001 stub on wss://relay.satnam.pub returns bolt11: DRY_RUN_<msats>
  ├─ NWC BYO: user pastes nostr+walletconnect:// URI → Vault nwc/{id}.uri → NwcConnectionManager (no @getalby/sdk import)
  └─ Bot-Mother dry: POST /bot-mother/birth?dryRun=1 → Vault agent/{id}.nsec → NIP-26 delegation → CLINK Nenroll stub (wss://relay.satnam.pub) → {noffer1dry, ndebit1dry, nip05: agenticNN@shockwallet.app} → mirror row nip05_identifiers(domain=shockwallet.app)
```

Live flip = `BOT_MOTHER_RELAY=wss://relay.shock.network` + removal of `?dryRun=1` + Bridgelet switch from synthetic bolt11 to real LDK/Pub invoice.

## 2. Feature Flags (env.ts addendum)

```
VITE_ENABLE_CLINK=true   // Phase 0 primary
VITE_ENABLE_BOT_MOTHER=true
VITE_ENABLE_LNBITS=false // code retained, not deleted
VITE_ENABLE_LNURL=false  // LNURL infra off but Bridgelet still serves LNURL-p for legacy payers via CLINK
VITE_BRIDGE_URL=https://bridge.satnam.pub
VITE_BOT_MOTHER_POW_REQUIRED=true
VITE_DRY_RUN=true        // Phase 0 only: synthetic bolt11 / synthetic Enroll
```

## 3. DNS — Bridge URL (guidance)

`bridge.satnam.pub` is NOT a Netlify site. It is a VPS Bridgelet.

- If Netlify DNS (managed): Create `CNAME bridge` → `YOUR_VPS_HOSTNAME` OR `A bridge → YOUR_VPS_IP`. Do NOT add `bridge` as Netlify site. Caddy on VPS terminates `bridge.satnam.pub` cert.
- If external DNS (Cloudflare etc.): Same `CNAME/A` — not a Netlify site.
- DO NOT set `SERVICE_URL=https://satnam.pub` (requires reverse_proxy + cert churn on PWA) — use `BRIDGE_URL` only.

Caddyfile (VPS):
```
bridge.satnam.pub {
  reverse_proxy localhost:3001
}
```

## 4. Acceptance

- `alice@my.satnam.pub` registers via NIP-98, resolves via `/.well-known/nostr.json?name=alice`
- `curl https://bridge.satnam.pub/.well-known/lnurlp/alice` returns valid LNURL-p JSON (dry tag)
- `POST /bot-mother/birth?dryRun=1` with mother NIP-98 returns `agentic01@shockwallet.app` synthetic noffer + NIP-05 mirror row
- `ShockWallet → alice@my.satnam.pub` via CLINK 21001 returns DRY_RUN bolt11 without LND
- `VITE_ENABLE_LNURL=false` hides LNbits `createLUD16` UI, but Bridgelet still serves legacy LNURL-p
```

