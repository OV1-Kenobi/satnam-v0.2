# Deployment Guide

This guide covers deploying Satnam v2 to production on Netlify with Supabase for the 4-table backend and Pylon as the primary relay.

---

## Prerequisites

- **Node.js 20+** (specified in `netlify.toml`)
- **npm** (workspace uses `--prefer-offline`)
- **Netlify account** with CLI installed (`npm install -g netlify-cli`)
- **Supabase project** (free tier sufficient for NIP-05 resolution)
- Access to a **Pylon relay** deployment or `wss://pylon.openagents.com`

---

## Step 1: Clone and Install

```bash
git clone https://github.com/your-org/satnam-v2.git
cd satnam-v2
npm install
```

Verify the dependency count is ≤22:
```bash
npm run check:deps
```

Verify security invariants:
```bash
npm run check:invariants
```

---

## Step 2: Supabase Setup

Satnam uses exactly 4 Supabase tables. Run the following migration in your Supabase SQL editor:

```sql
-- NIP-05 identifier resolution
CREATE TABLE nip05_identifiers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username    text UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9_\-\.]{3,32}$'),
  npub        text NOT NULL,              -- hex-encoded 32-byte pubkey
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Lightning address routing
CREATE TABLE lightning_addresses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username    text UNIQUE NOT NULL,
  npub        text NOT NULL,
  lud16       text NOT NULL,             -- e.g. alice@satnam.pub
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Rate limiting (per-IP and per-pubkey)
CREATE TABLE rate_limits (
  key          text NOT NULL,
  endpoint     text NOT NULL,
  count        integer NOT NULL DEFAULT 1,
  window_start bigint NOT NULL,          -- Unix timestamp (seconds)
  PRIMARY KEY (key, endpoint)
);

-- Short-lived registration reservations (prevent TOCTOU races)
CREATE TABLE username_reservations (
  username   text PRIMARY KEY,
  npub       text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);

-- Auto-expire reservations
CREATE INDEX ON username_reservations (expires_at);
```

**Row Level Security:**
```sql
-- nip05_identifiers is public read
ALTER TABLE nip05_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON nip05_identifiers FOR SELECT USING (true);
CREATE POLICY "service_write" ON nip05_identifiers FOR INSERT
  USING (auth.role() = 'service_role');

-- lightning_addresses is public read
ALTER TABLE lightning_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON lightning_addresses FOR SELECT USING (true);

-- rate_limits is service-only
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- username_reservations is service-only
ALTER TABLE username_reservations ENABLE ROW LEVEL SECURITY;
```

Copy your Supabase project URL and anon key from the Supabase dashboard (Settings → API).

---

## Step 3: Netlify Deployment

### Option A: Deploy via Netlify CLI

```bash
# Authenticate
netlify login

# Initialize (links to Netlify site)
netlify init

# Set environment variables
netlify env:set VITE_SUPABASE_URL "https://your-project.supabase.co"
netlify env:set VITE_SUPABASE_ANON_KEY "your-anon-key"
netlify env:set VITE_PYLON_RELAY "wss://pylon.openagents.com"
netlify env:set VITE_FALLBACK_RELAYS "wss://relay.damus.io,wss://relay.nostr.band"

# Server-side only (not VITE_ prefixed — not exposed to client)
netlify env:set SUPABASE_SERVICE_ROLE_KEY "your-service-role-key"

# Feature flags (enable as needed)
netlify env:set VITE_ENABLE_NFC "true"
netlify env:set VITE_ENABLE_FROST "true"

# Deploy
netlify deploy --prod
```

### Option B: Deploy via Netlify Dashboard

1. Connect your GitHub repository to Netlify.
2. Set build command: `npm run build`
3. Set publish directory: `dist`
4. Set functions directory: `netlify/functions`
5. Add all environment variables in Site Settings → Environment Variables.
6. Deploy.

### Verify Deployment

After deploy, verify the well-known endpoints:

```bash
# NIP-05 resolution
curl "https://satnam.pub/.well-known/nostr.json?name=_"
# Expected: {"names":{"_":"<server_pubkey>"},...}

# Agent discovery
curl "https://satnam.pub/.well-known/agent.json?name=test"
# Expected: 404 or agent profile JSON
```

---

## Step 4: Pylon Configuration

Pylon is the OpenAgents authenticated relay. Configure it as follows:

### Using the Public Pylon

Set `VITE_PYLON_RELAY=wss://pylon.openagents.com`. No server-side Pylon configuration is needed — Satnam handles NIP-42 AUTH client-side using the Principal's nsec.

### Self-Hosted Pylon

If running your own Pylon instance:

1. Deploy Pylon from the [OpenAgents repository](https://github.com/OpenAgentsInc/openagents)
2. Set `VITE_PYLON_RELAY=wss://your-pylon.example.com`
3. Configure Pylon's allowed pubkeys or open AUTH policy as needed

---

## Step 5: Environment Variables Summary

### Client-Side (VITE_ prefix — included in bundle)

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `VITE_PYLON_RELAY` | Yes | Primary relay WSS URL |
| `VITE_FALLBACK_RELAYS` | No | Comma-separated fallback relay URLs |
| `VITE_APP_ENV` | No | `development \| staging \| production` |
| `VITE_ENABLE_NFC` | No | Enable NFC feature (default: false) |
| `VITE_ENABLE_CASHU` | No | Enable Cashu feature (default: false) |
| `VITE_ENABLE_NIP90` | No | Enable DVM marketplace (default: false) |
| `VITE_ENABLE_FROST` | No | Enable FROST group keys (default: false) |
| `VITE_ENABLE_MIGRATION` | No | Enable v1→v2 migration UI (default: false) |

### Server-Side (Netlify Function env — never in client bundle)

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (for function writes) |

---

## CI/CD Pipeline

### GitHub Actions Example

```yaml
# .github/workflows/deploy.yml
name: Deploy to Netlify

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npm run lint

      - name: Check security invariants
        run: npm run check:invariants

      - name: Check dependency count
        run: npm run check:deps

      - name: Run tests
        run: npm run test:coverage

      - name: Build
        run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_PYLON_RELAY: ${{ secrets.VITE_PYLON_RELAY }}

      - name: Deploy to Netlify (preview)
        if: github.event_name == 'pull_request'
        run: netlify deploy --dir=dist --alias=pr-${{ github.event.pull_request.number }}
        env:
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}

      - name: Deploy to Netlify (production)
        if: github.ref == 'refs/heads/main'
        run: netlify deploy --dir=dist --prod
        env:
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}
```

### Required GitHub Secrets

| Secret | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_PYLON_RELAY` | Pylon relay URL |
| `NETLIFY_AUTH_TOKEN` | Netlify personal access token |
| `NETLIFY_SITE_ID` | Netlify site ID |

---

## Post-Deployment Verification Checklist

```bash
# 1. CSP header enforced (no unsafe-eval)
curl -I https://satnam.pub | grep -i "content-security"

# 2. HSTS header set
curl -I https://satnam.pub | grep -i "strict-transport"

# 3. Fonts served from same origin (not CDN)
curl -I "https://satnam.pub/fonts/cinzel.woff2"
# Expected: 200 with Cache-Control: public, max-age=31536000

# 4. NIP-05 resolution working
curl "https://satnam.pub/.well-known/nostr.json?name=_"

# 5. Service worker loads without cache
curl -I "https://satnam.pub/sw.js" | grep "cache-control"
# Expected: no-cache

# 6. Function count ≤ 8
ls netlify/functions/ | wc -l
# Expected: 8

# 7. Production dependency count ≤ 22
node -e "const p=require('./package.json'); console.log(Object.keys(p.dependencies).length)"
# Expected: 22
```

---

## Development Setup

```bash
# 1. Copy environment file
cp .env.example .env.local

# 2. Fill in required variables in .env.local
# VITE_SUPABASE_URL=...
# VITE_SUPABASE_ANON_KEY=...
# VITE_PYLON_RELAY=wss://pylon.openagents.com

# 3. Enable features for development
# VITE_ENABLE_FROST=true
# VITE_ENABLE_CASHU=true
# VITE_ENABLE_NIP90=true
# VITE_ENABLE_NFC=true
# VITE_APP_ENV=development

# 4. Run dev server
npm run dev

# 5. Run Netlify functions locally
netlify dev
# Serves at http://localhost:8888 with functions at /.netlify/functions/
```

---

## Troubleshooting

### Missing environment variable at startup

```
[Satnam Config] Missing required environment variable: VITE_SUPABASE_URL
  Add it to .env.local (development) or Netlify Environment Variables (production).
```

Solution: Add the variable to `.env.local` (dev) or Netlify dashboard (prod).

### Vault initialization fails on Safari

OPFS is supported in Safari 15.2+. The `navigator.storage.getDirectory()` API may throw if the browser is in private/incognito mode (OPFS is disabled). Show an `OfflineBanner` and prompt the user to use a non-private window.

### Pylon AUTH fails

If `PylonAuth.handleChallenge()` throws `EncryptionFailed`, the vault may be locked. Ensure the vault is unlocked before initiating any Pylon connection. The `CepsProvider` checks `vault.isUnlocked` before connecting.

### WASM build error

`@frostr/bifrost` requires the `vite-plugin-wasm` and `vite-plugin-top-level-await` plugins. Both are included in `vite.config.ts`. If WASM fails to load, verify the CSP header includes `'wasm-unsafe-eval'` in `script-src`.

### Function count exceeds 8

Run `npm run check:invariants` before deploying. If any new functions are added, they must replace an existing one to stay within the S9 invariant.
