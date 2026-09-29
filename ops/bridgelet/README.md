# Bridgelet Dry-Run — bridge.satnam.pub

Phase 0 pure CLINK dry-run. No LND/LDK invoice. Returns synthetic lnbc1dry.

VPS: `docker compose up -d` in this dir, Caddy `caddy reload --config Caddyfile`.
Test: `curl https://bridge.satnam.pub/.well-known/lnurlp/alice`

## Live switch (Phase 1, no VPS deploy now)

Dry (`DRY_RUN=true`): `server.js` returns `lnbc1dry` + `dryRun:true`.
Live: `DRY_RUN=false CLINK_RELAY=wss://relay.satnam.pub DOMAIN=bridge.satnam.pub` —
`docker-compose.yml` already sets these; just flip `DRY_RUN` env and `docker compose up -d` on VPS.
Real bridgelet uses `@shocknet/bridgelet` image; this stub validates `/.well-known/lnurlp/:name` shape + Caddy TLS.
