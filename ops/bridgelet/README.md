# Bridgelet Dry-Run — bridge.satnam.pub

Phase 0 pure CLINK dry-run. No LND/LDK invoice. Returns synthetic lnbc1dry.

VPS: `docker compose up -d` in this dir, Caddy `caddy reload --config Caddyfile`.
Test: `curl https://bridge.satnam.pub/.well-known/lnurlp/alice`
