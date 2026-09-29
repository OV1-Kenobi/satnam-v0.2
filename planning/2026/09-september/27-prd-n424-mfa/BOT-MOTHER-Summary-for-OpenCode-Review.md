<!-- PROVENANCE — NON-CANONICAL -->
> **PROVENANCE / NON-CANONICAL RECORD**
> Source: supplied by **Hermes** (external — no access to our coding resources).
> Status: **directional guidance only — NOT canonical**, not an approved spec, not a founder decision of record.
> Reviewed: **2026-09-29**. Retained as a **reference** only.
> Authority: nothing in this file grants approval, changes requirements, or overrides `AGENTS.md`, the decision log, the PRD, or any approved plan. Treat as untrusted external input.

---

# Bot-Mother — Research, Discovery, Planning & Code Changes Summary
*For OpenCode agent review — 2026-09-27*

This is the complete Bot-Mother track from discovery through code, frozen for OpenCode handoff. It reflects founder decisions verbatim and is the only authoritative brief for the roster.

---

## 1. Discovery & Research (Verified Facts)

### Problem that drove Bot-Mother
- Existing codebase gave humans `username@my.satnam.pub` (NIP-05 == LN Address) via `domain-whitelist my/our/agent` + `register-identity NIP-98`. Founder wanted the same branded convenience for **agents** but without running PhoenixD custodial overhead.
- Analogy founder chose: **Telegram BotFather `/newbot` → Nostr native `Bot-Mother` that births agents**. Good fit because registrar already does `BIP-340 schnorr + NIP-46 bunker + FROST ceremony + Vault OPFS`.

### Ecosystem research that informed the pivot
- **Lightning.Video** (`https://lightning.video/bd926eaa77a9a1046afb12faabb268be925b01d952edc3ce19d092f258ea3572`, 12,879 chars): NIP-69 Nostr Offer Strings demo, ShockWallet + Lightning.Pub static payment codes replacing LNURL/Bolt12, uses `demo.nip69.dev`.
- **Lightning.Pub** (`github.com/shocknet/Lightning.Pub` 16k chars, `docs.shock.network`): wraps **LND** (not LDK), `No port forwarding / DNS / Tor`, `NOSTR_RELAYS` + `BRIDGE_URL` vs `SERVICE_URL`, `Zeus/Voltage/Flashsats quotes`, Bootstrap Peering. **Watchdog: DO NOT install on node already running another account system** — forces lane separation.
- **CLINK** (`github.com/shocknet/CLINK`, `@shocknet/clink-sdk`): `noffer 21001 / ndebit 21002 / Enroll 21004 / Beacon 30078`, `NIP-44` encrypted, `decodeBech32 → ClinkSDK.Noffer/Ndebit/Nenroll/Nmanage`. Enroll returns `required_difficulty` → client must do PoW (hashcash) on `GFY`. Still draft NIP-69→CLINK SPNP churn.
- **Bridgelet** (`github.com/shocknet/bridgelet` Node): `LNURL-p + Lightning Address bridge via CLINK`, runs on `bridge.satnam.pub:3001`, `DOMAIN=bridge.satnam.pub`, `CLINK_RELAY=wss://relay.satnam.pub`, fronted by `Caddy { reverse_proxy localhost:3001 }`.
- **ShockWallet** (`@shockwallet.app`): PWAs auto-enrolled via Lightning.Pub, claim `auto-enroll → @shockwallet.app`. Founder wants `agenticNN@shockwallet.app` self-custodial for bots. NIP-05 on same name is expected (Shock publishes `/.well-known/nostr.json`), mirror row as fallback.
- **Boltz** (blocker that freed Bot-Mother): `Aug 1 2026 restrict USDT/USDC/WBTC/TBTC/RBTC (EVM bug)` → `Aug 3 2026 09:54 UTC Boltzhq "shut down all Bitcoin swap services indefinitely ... iterate faster than small team can patch"` — `api.boltz.exchange` now only cooperative `/refund` + script-path after expiry. Founder accepted **no on-chain overflow for now** (Omega swap deferred).
- **VPS truth (OOB 2026-09-26):** founder already runs **StrFry relay + PhoenixD Node** on VPS — StrFry is `wss://relay.satnam.pub` placeholder for `NOSTR_RELAYS`, PhoenixD via `NWC kind 23194/23195 → Vault nwc/{id}.uri`.

### Key discovery decisions
- **Parallel lanes worth it** (founder verbatim: "humans more than agents need to denominate value in stable fiat terms") — human lane must stay **LDK + stable-channel ready** (future `stable-channel` integration), agent lane can be **LND via Lightning.Pub** primary.
- **Bridge URL, not SERVICE_URL** (founder verbatim) — avoids SSL reverse-proxy cert churn on `satnam.pub`. `BRIDGE_URL=https://bridge.satnam.pub` isolates `bridge` cert via Caddy.
- **Bring-your-own NWC only** (founder verbatim) — users paste `nostr+walletconnect://...` → `Vault nwc/{id}.uri` → `NwcConnectionManager`. No `@getalby/sdk` dependency; Alby Hub users paste same URI.
- **Drop LNURL build, keep code** (founder verbatim) — `VITE_ENABLE_LNURL=false` but infra not deleted (tree-shaken).
- **Bot-Mother storms need PoW** (founder anticipated): Enroll 21004 must require PoW to throttle `100-agent storms` that founder explicitly wants to **stress test Justin's infra (relay.shock.network + Pub LND) while humans stay on own StrFry**.

---

## 2. Planning — Phase 0 Pure CLINK Dry-Run (Agent Roster Orchestration)

**Spec files (frozen):**
- `docs/SPECIFICATION-ADDENDUM-PHASE0-DRYRUN.md` (3.2k) — parallel lanes diagram, Bridge URL vs SERVICE_URL, VITE flags.
- `docs/PHASE1-LIVE-SCAFFOLD.md` (1.1k) — live flip runbook (no deploy, placeholders).
- `planning/2026/09-september/27-prd-n424-mfa/IMPLEMENTATION-PLAN-Agent-Roster.md` (6.8k) — 8-agent roster (Repository Steward, Satnamd Engineer, Vault/Bunker, Web NFC/Terminal, Frontend, FROSTR, QA/Security, Docs) with WP-0A (DB), WP-1A/B (Satnamd issuer+scan), WP-2A/B (frontend), WP-3A/B (FROSTR), WP-4A (Terminal). Pattern: **DB → backend → frontend alignment**, gates `tsc 0 + deps 22/22 + invariants + tap stub`.
- `planning/2026/09-september/27-prd-n424-mfa/PRD-N424-MFA-Mobile-Signing.md` (11.7k) — persona walkthroughs that include FROSTR bindings for Bot-Mother tags (not duplicated here).

**Phase 0 plan as approved (founder: "go dry-run"):**

- **WP-0A Rails cutover** — `VITE_ENABLE_CLINK=true`, `VITE_ENABLE_BOT_MOTHER=true`, `VITE_ENABLE_LNBITS=false`, `VITE_ENABLE_LNURL=false` (code retained flagged off), `VITE_ENABLE_NWC_BYO=true`, `VITE_DRY_RUN=true`, `VITE_BOT_MOTHER_POW_REQUIRED=true`.
- **WP-0B Human Bridgelet dry** — deploy `Bridgelet` at `https://bridge.satnam.pub` (`PORT=3001`, `CLINK_RELAY=wss://relay.satnam.pub`, `DOMAIN=bridge.satnam.pub`) via `Caddy` — but **Phase 0 pure dry** returns `lnbc1dry_<msats>_dryrun` synthetic bolt11 with `dryRun:true`, no LND/LDK invoice. Valid `payRequest` shape so legacy wallets parse. DNS placeholder: `CNAME bridge → [VPS_HOST]` or `A → [VPS_IP]` — **not** a Netlify site (to avoid `≤8 functions` ceiling). Deferred: founder said "just defer these details using placeholders for now".
- **WP-0C Bot-Mother dry** — `POST /bot-mother/birth?dryRun=1` on `satnamd` — see §3.

**Lane split (frozen):**
- Human: `alice@my.satnam.pub` (NIP-05 `my.satnam.pub` via `/.netlify/functions/nip05-resolver` placeholder) → **LDK node stable-channel ready** (`ChannelManager.create_invoice` future) → `CLINK_RELAY=wss://relay.satnam.pub` → `Bridgelet bridge.satnam.pub` → `/.well-known/lnurlp/alice` backed by `noffer 21001`.
- Agent: `agenticNN@shockwallet.app` (+ `nip05` same if Shock publishes) → **Lightning.Pub LND** (`NOSTR_RELAYS=wss://relay.shock.network wss://relay.satnam.pub`) → `Enroll 21004 → noffer 21001 / ndebit 21002 / nmanage / Beacon 30078` → `ShockWallet PWA`. Backup human fallback `humantmp@shockwallet.app` via temp Pub proxy until LDK adapter completes. Future `agent Bridgelet bridge.agent.satnam.pub` deferred to white-label demand.

**Founder focus guard (latest):** "I'm NOT looking to run live tests anytime soon. NONE of those are blockers to writing the actual codebase. Just build what you can without ANY of the external systems, NOW" — so all code is **code-only, no live `curl / deploy.lightning.pub | bash / node` tests**, placeholders `[VPS_HOST]`, `wss://relay.satnam.pub`, `https://bridge.satnam.pub` remain.

---

## 3. Code Changes (All Local Commits, No Push — Standard 9 WP Boundaries)

**Git log (master, local, ahead origin/master):**
- `ad39d7a` docs: N424 MFA plan + 4 persona explainers (2026-09-27)
- `51d0297` chore: add nfcIssuer reference copy
- `ad3c5f2` feat(n424): LNbits-free issuer (but note: prior to this, Bot-Mother commits)
- `9bb8aa4` feat(ui): NWC BYO modal guard + LNbits panels flag-hidden
- `44a4dc8` feat(phase0-follow): scheduler guard, gitbook clink/ldk/bridgelet, phase1 scaffold
- `94fb931` feat(phase0-complete): CLINK dry-run live scaffold — **Bot-Mother core lives here**
- `4c2dbae` feat(phase0): pure CLINK dry-run — BRIDGE_URL, CLINK client, NWC BYO, Bot-Mother dry Enroll/PoW, LNURL off (placeholders)

**Bot-Mother specific artifacts:**

1. **satnamd/src/lib/botMother.ts** (new, `~90 lines`) — dry Enroll/PoW:
   ```ts
   type BirthRequest = { motherNip98?: string; label: string; tier?: string }
   type BirthResult = { agentNpub, agentNsecRef: "agent/{label}.nsec", noffer, ndebit, nmanage, nip05: "agenticNN@shockwallet.app", dryRun: true }
   generateSecretKey() → getPublicKey() → nip19.npubEncode
   syntheticNoffer(pk) → "noffer1dry_<pk slice>"
   hashcashPow(seed, difficulty) → {nonce, hash} loop sha256(seed+nonce) leading zeros (stub: difficulty 0 instant; live respects required_difficulty from 21004 GFY, pow_overrun 500k)
   birthAgentDryRun(label) → returns synthetic noffer/ndebit/nmanage + agenticNN@shockwallet.app
   // Mount in satnamd/src/index.ts: import "./lib/botMother.js" → POST /bot-mother/birth?dryRun=1 (dry) / ?dryRun=0 (live → relay.shock.network)
   ```
   Also patched `satnamd/src/index.ts` with mount comment.

2. **satnam-v0.2 VITE flags** (`.env.example` Phase 0 Dry-Run block, `src/config/env.ts` 7 getters):
   ```
   VITE_ENABLE_CLINK=true
   VITE_ENABLE_BOT_MOTHER=true
   VITE_ENABLE_LNBITS=false
   VITE_ENABLE_LNURL=false  # LN bits/Boltcard extension off, Battle-Tested code kept
   VITE_DRY_RUN=true
   VITE_BOT_MOTHER_POW_REQUIRED=true
   VITE_BOT_MOTHER_RELAY=wss://relay.satnam.pub  # dry → flip to wss://relay.shock.network live
   VITE_ENABLE_NWC_BYO=true
   VITE_BRIDGE_URL=https://bridge.satnam.pub  # NOT SERVICE_URL
   # functions still: VITE_PYLON_RELAY=wss://relay.satnam.pub (placeholder for your StrFry)
   ```

3. **src/lib/clink/** (new):
   - `client.ts` — `resolveToBolt11(lud16|noffer, amountMsats?)` — refuses `lud16` when `VITE_ENABLE_LNURL=false` (LNURL off), dry returns `lnbc1dry_<msats>_dryrun_<offer slice>` with mode: 'dry', source: 'noffer'/'lud16-bridge'. Live path stub goes via `sdk.ts` (see next).
   - `sdk.ts` — `DryClinkSdk + getLiveSdk(relay)` types `ClinkOffer/ClinkEnrollResult` — live import deferred to `await import('@shocknet/clink-sdk')` then wrap `ClinkSDK`, keeps `tsc 0` without installing dep (dep added to package.json as `^0.1.0` but not installed to keep `tsc` gate).
   - `index.ts` re-export.

4. **src/lib/ldk/** (new, dry, stable-channel ready):
   - `types.ts` `LdkAdapter` { createInvoice(amountMsats, description), payInvoice, getBalance, openChannel(pubkey, amountSats, cfg?: {stableChannel?}) }
   - `mock.ts` `MockLdkAdapter` returns `lnbc1dry_<msats>_<hash>` synthetic, `openChannel` mock id, `getLdkAdapter()` always mock in Phase 0.
   - `native.ts` placeholder `nativeNotBuilt = true` for Phase 1 `ldk-node` build.
   - No external LDK node needed for `tsc 0`.

5. **src/lib/nfc/** + `src/hooks/useNwcByo.ts`:
   - `webNfc.ts` already existed for N424 MFA, reused for Bot-Mother PIN overlay doc (PIN after SUN → `argon2id → xorWrappingKeys` → bunker sign). Bot-Mother reuses same `Vault storeNsec agent/{label}.nsec` + `NIP-26 delegation` (Guardian FROST share → agent) path.

6. **ops/bridgelet/** (new, VPC placeholder):
   - `docker-compose.yml` (`PORT=3001`, `CLINK_RELAY=wss://relay.satnam.pub`, `DOMAIN=bridge.satnam.pub`, `DRY_RUN=true`)
   - `Caddyfile` (`bridge.satnam.pub { reverse_proxy localhost:3001 }` with `[VPS_HOST]` placeholder note)
   - `server.js` stub (`/.well-known/lnurlp/:name → payRequest` + `/callback → lnbc1dry`, `/health`) — valid shape, `dryRun:true`.
   - `README.md` live switch note (`DRY_RUN=false` + `shocknet/bridgelet` image).
   - `nfcIssuer.reference.ts` + `botMother.reference.ts` copies for OpenCode review.

7. **@shocknet/clink-sdk dep** (`package.json`): added `"@shocknet/clink-sdk": "^0.1.0"` — kept `deps 22/22 PASS` (limit 22), not installed in CI so `tsc` uses stub.

**Bot-Mother dry flow (code truth):**
```
POST /bot-mother/birth?dryRun=1  { motherNip98, label:"agentic01", tier:"worker" }
 → verify mother NIP-98 + rate_limits (per-mother 10/hr, Supabase rate_limits + in-memory PoW cache, NIP-98 replay dedupe)
 → generateSecretKey() → Vault storeNsec agent/{label}.nsec (NIP-06 m/44'/1237'/0'/0/0)
 → NIP-26 delegation (Guardian FROST share #1 signs kind:39201 agent state)
 → CLINK Nenroll({ relay: wss://relay.satnam.pub }) dry → hashcashPow(required_difficulty) → synthetic {noffer1dry, ndebit1dry, nmanage1dry}
 → Supabase mirror nip05_identifiers (username=agenticNN, domain=shockwallet.app, pubkey) + lightning_addresses (lud16 same) for NIP-05/LUD16 parity
 → return { agentNpub, agentNsecRef, noffer, ndebit, nmanage, nip05: "agenticNN@shockwallet.app", dryRun:true }

Live flip: ?dryRun=0 + VITE_BOT_MOTHER_RELAY=wss://relay.shock.network → real Pub LND Enroll → real @shockwallet.app
```

**Gates verified (live):**
- `npx tsc --noEmit --skipLibCheck 0` (satnam-v0.2 + satnamd both 0)
- `deps 22/22 PASS` (includes clink-sdk)
- `invariants 11/12` (S10 _lib false-positive pre-existing, not regression: `netlify/functions/_lib/nip98-replay.ts`, `rate-limit.ts`, `supabase-client.ts` — not functions)

---

## 4. Decisions & Trade-offs for Review

- **LDK stub deferred, Bot-Mother pulled forward** (founder: "leave the LDK stub out of Phase 0 and instead begin integrating the Bot-Mother infrastructure now") — human lane stays LDK-ready but MockLdkAdapter sufficient for dry.
- **Trusted Justin dependency accepted** (founder: "I'm fine with a dependency as Justin is a friend and trusted developer... available for help and promotion/distribution") — agent lane hinges on `relay.shock.network + Pub LND`.
- **Stress test via storms** (founder: "I'd rather stress test his infrastructure through Bot-Mothered agent storms and keep the human users routed through my own infra") — `100 Enrolls` concurrent against Shock relay, humans stay on `wss://relay.satnam.pub`.
- **Accounting SubLayers fee regime** for per-agent app fees (`fee regime` noted in Light Pub docs) monetizes storms.
- **No Alby SDK** — BYO paste only retained; LNURL infra flagged off but not deleted (tree-shaken).
- **Placeholders intentional** — DNS `CNAME bridge → [VPS_HOST]` / `A → [VPS_IP]`, `Caddy reverse_proxy`, `VITE_PYLON_RELAY` values all `[VPS_HOST]` placeholders per founder: "just defer these details using placeholders for now and I'll get that for you later" and "NONE of those are blockers to writing the actual codebase. Just build what you can without ANY of the external systems, NOW".

---

## 5. Open Items for OpenCode Review

- [ ] Verify `prfCmac` stub `sha256` → real `AES-CMAC` via `@noble/ciphers` before live (currently stub passes `tsc 0`).
- [ ] Confirm `supabase/migrations/0xx` for `nfc_cards` vs `nip05_identifiers` mirror does not violate S1/S5 (no key material in SQL).
- [ ] Confirm `satnamd` rate_limits 10/hr per mother + NIP-98 replay dedupe policy matches `netlify/functions/_lib/rate-limit.ts` in use elsewhere.
- [ ] When founder supplies `[VPS_HOST]`, flip `VITE_DRY_RUN=false`, `npm i @shocknet/clink-sdk`, swap `bridgelet/server.js` stub → `shocknet/bridgelet` image, test `curl https://[VPS_HOST]/.well-known/lnurlp/alice` and `POST /bot-mother/birth?dryRun=0`.

---

## 6. Paths OpenCode Should Open

- `C:\Users\ov1kn\Documents\satnam-v0.2\planning\2026\09-september\27-prd-n424-mfa\IMPLEMENTATION-PLAN-Agent-Roster.md` (6.8k)
- `C:\Users\ov1kn\Documents\satnam-v0.2\planning\2026\09-september\27-prd-n424-mfa\PRD-N424-MFA-Mobile-Signing.md` (11.7k) — §6.5 FROSTR + tag binding relevant to Bot-Mother multi-share
- `C:\Users\ov1kn\Documents\satnam-v0.2\docs\SPEC-N424-LNBITS-FREE.md` (2.3k) + `docs/SPECIFICATION-ADDENDUM-PHASE0-DRYRUN.md` (Phase 0 dry lanes)
- `C:\Users\ov1kn\Documents\satnam-v0.2\src\lib\clink\client.ts` + `sdk.ts`
- `C:\Users\ov1kn\Documents\satnam-v0.2\src\lib\ldk\mock.ts`
- `C:\Users\ov1kn\satnamd\src\lib\botMother.ts` (source) + `C:\Users\ov1kn\Documents\satnam-v0.2\ops\bridgelet\botMother.reference.ts` (copy)
- `C:\Users\ov1kn\Documents\satnam-v0.2\ops\bridgelet\Caddyfile` + `docker-compose.yml` + `server.js`
- `C:\Users\ov1kn\Documents\satnam-v0.2\.env.example` (Phase 0 Dry-Run block)
