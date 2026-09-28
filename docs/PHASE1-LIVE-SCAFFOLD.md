# Phase 1 Live Scaffold (no deploy — placeholder)

Blocked on: [VPS_HOST], [RELAY_PLACEHOLDER] live.

## Switches

- `VITE_DRY_RUN=false` + `VITE_BOT_MOTHER_RELAY=wss://relay.shock.network`
- `ops/bridgelet`: replace `server.js` stub with `shocknet/bridgelet` image, `docker-compose.yml` `image: shocknet/bridgelet:latest` + `BRIDGE_URL=https://bridge.satnam.pub` not SERVICE_URL.
- `src/lib/clink/sdk.ts:getLiveSdk()` — `await import('@shocknet/clink-sdk')` then `new ClinkSDK(relay)` → `Nenroll` live, respect `required_difficulty` PoW via `hashcashPow`.
- `src/lib/ldk/mock.ts` → `src/lib/ldk/native.ts` — build `ldk-node` bindings, swap `getLdkAdapter()` to native when `VITE_LDK_ENABLED && native exists`.

## Verification (when you supply VPS_HOST)

1. `curl https://[VPS_HOST]/.well-known/lnurlp/alice` → `payRequest` (Caddy)
2. `POST /bot-mother/birth?dryRun=0 {label:"agentic01"}` → real `agentic01@shockwallet.app` + `noffer1...`
3. `lightning-cli` LDK `openchannel` with `stableChannel:true` on human lane.

No code changes block Phase 0 — this doc is the runbook for flip.
