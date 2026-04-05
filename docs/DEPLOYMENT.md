# Satnam v2 — Deployment Guide

## Overview

Satnam v2 is a Nostr-native PWA deployed on Netlify. It uses:
- **Netlify** — static hosting, serverless functions (≤8), CSP headers
- **Supabase** — 4 tables for public data (NIP-05, Lightning, rate limits, reservations)
- **Pylon** — OpenAgents authenticated Nostr relay (`wss://pylon.openagents.com`)
- **OPFS Vault** — client-side encrypted private key storage (no server-side key material)

---

## Prerequisites

- Node.js 20+
- A Netlify account
- A Supabase project (free tier sufficient for initial deployment)
- Access to `wss://pylon.openagents.com` (OpenAgents relay)

---

## 1. Local Development

```sh
# Install dependencies
npm install

# Copy environment file
cp .env.example .env.local

# Fill in required values (see Environment Variables section below)
# Then start dev server
npm run dev

# Test Netlify functions locally
npx netlify dev
```

---

## 2. Environment Variables

### Required (Netlify Dashboard → Site Settings → Environment Variables)

| Variable | Description | Example |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | `https://abcdef.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only, never expose) | `eyJ...` |
| `NIP05_DOMAIN` | Domain for NIP-05 identifiers | `satnam.pub` |

### Optional / Feature Flags

| Variable | Description | Default |
|---|---|---|
| `SUPABASE_ANON_KEY` | Anon key for client-side Supabase (if used) | — |
| `COORDINATION_RELAY_URL` | Primary relay for agent discovery | `wss://pylon.openagents.com` |
| `VITE_PYLON_RELAY` | Pylon relay URL (client-side) | `wss://pylon.openagents.com` |
| `VITE_SUPABASE_URL` | Supabase URL for client-side reads | Same as `SUPABASE_URL` |
| `VITE_NIP05_DOMAIN` | NIP-05 domain (client-side) | `satnam.pub` |
| `VITE_FX_ENABLED` | Enable FX rate features | `false` |
| `VITE_BIFROST_ENABLED` | Enable FROST/bifrost signing | `false` |
| `VITE_NFC_ENABLED` | Enable NFC card verification | `true` |
| `VITE_CASHU_ENABLED` | Enable Cashu eCash features | `false` |
| `VITE_NIP90_ENABLED` | Enable NIP-90 DVM marketplace | `false` |
| `VITE_PROBE_ENABLED` | Enable Probe session monitoring | `false` |
| `MIGRATION_DRY_RUN` | Dry-run mode for migration script | `false` |
| `V1_SUPABASE_URL` | v1 Supabase URL (migration only) | — |
| `V1_SUPABASE_SERVICE_KEY` | v1 service key (migration only) | — |

### Security Note

`SUPABASE_SERVICE_ROLE_KEY` bypasses Supabase RLS. It is only used in Netlify functions (server-side). Never set it in `VITE_*` variables or expose it to the client bundle.

---

## 3. Supabase Setup

### 3.1 Create the Project

1. Go to [app.supabase.com](https://app.supabase.com) → New Project
2. Note the project URL and service role key

### 3.2 Run the Schema Migration

Apply this SQL in the Supabase SQL editor:

```sql
-- ============================================================
-- Satnam v2 Schema — 4 retained tables
-- No key material. No auth tokens. No session state. (S1)
-- ============================================================

-- NIP-05 name → pubkey mapping
CREATE TABLE IF NOT EXISTS public.nip05_identifiers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL,
  pubkey        text NOT NULL,
  domain        text NOT NULL DEFAULT 'satnam.pub',
  is_active     boolean NOT NULL DEFAULT true,
  migrated_from_v1 boolean DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username, pubkey),
  UNIQUE (username)
);

-- Lightning address routing
CREATE TABLE IF NOT EXISTS public.lightning_addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pubkey        text NOT NULL UNIQUE,
  lud16         text NOT NULL,
  username      text,
  domain        text NOT NULL DEFAULT 'satnam.pub',
  migrated_from_v1 boolean DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Per-IP and per-pubkey rate limiting
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pubkey        text,
  ip_address    text,
  action        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Short-lived registration reservations
CREATE TABLE IF NOT EXISTS public.username_reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL,
  pubkey        text NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username)
);

-- NIP-CA Issuer Registry
CREATE TABLE IF NOT EXISTS public.issuer_registry (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pubkey           text NOT NULL UNIQUE,
  name             text NOT NULL,
  about            text,
  capabilities     text[] NOT NULL DEFAULT '{}',
  credential_types text[] NOT NULL DEFAULT '{}',
  metadata         jsonb DEFAULT '{}',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_nip05_username ON public.nip05_identifiers(username);
CREATE INDEX IF NOT EXISTS idx_nip05_pubkey ON public.nip05_identifiers(pubkey);
CREATE INDEX IF NOT EXISTS idx_lightning_pubkey ON public.lightning_addresses(pubkey);
CREATE INDEX IF NOT EXISTS idx_rate_limits_pubkey ON public.rate_limits(pubkey, action, created_at);
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip ON public.rate_limits(ip_address, action, created_at);
CREATE INDEX IF NOT EXISTS idx_reservations_username ON public.username_reservations(username, expires_at);
CREATE INDEX IF NOT EXISTS idx_issuer_pubkey ON public.issuer_registry(pubkey);

-- ── Row Level Security ──
-- Tables are readable publicly (NIP-05, Lightning, Issuer are public data)
-- Service role key bypasses RLS for function writes

ALTER TABLE public.nip05_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON public.nip05_identifiers FOR SELECT USING (true);

ALTER TABLE public.lightning_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON public.lightning_addresses FOR SELECT USING (true);

ALTER TABLE public.issuer_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON public.issuer_registry FOR SELECT USING (true);

-- rate_limits and username_reservations: no public read (operational tables)
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.username_reservations ENABLE ROW LEVEL SECURITY;

-- ── Cleanup job: purge expired rate limit entries and reservations ──
-- Run via Supabase pg_cron (enable pg_cron extension first)
-- SELECT cron.schedule('purge-rate-limits', '0 * * * *',
--   'DELETE FROM public.rate_limits WHERE created_at < NOW() - INTERVAL ''2 hours''');
-- SELECT cron.schedule('purge-reservations', '*/5 * * * *',
--   'DELETE FROM public.username_reservations WHERE expires_at < NOW()');
```

### 3.3 Verify Schema

```sql
-- S1 invariant check: no key material columns
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('encrypted_nsec', 'nsec', 'user_salt', 'private_key', 'secret_key');
-- Expected: 0 rows
```

---

## 4. Netlify Deployment

### 4.1 Connect Repository

1. Go to [app.netlify.com](https://app.netlify.com) → New Site
2. Connect your Git repository
3. Build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`

### 4.2 Set Environment Variables

In Netlify Dashboard → Site Settings → Environment Variables, add all required variables from Section 2.

### 4.3 Deploy

```sh
# Via CLI
npm install -g netlify-cli
netlify login
netlify deploy --prod

# Or push to your main branch (auto-deploy if connected)
git push origin main
```

### 4.4 Configure Domain

1. Netlify Dashboard → Domain Management → Add custom domain
2. Point your DNS `A` record to Netlify's IP
3. HTTPS is automatically provisioned via Let's Encrypt

### 4.5 Verify Function Count

```sh
ls netlify/functions/ | grep -c '\.ts$'
# Must output: 8 (S9 invariant)
```

---

## 5. Pylon Relay Configuration

Pylon (`wss://pylon.openagents.com`) is the OpenAgents authenticated relay.

### 5.1 NIP-42 Authentication

The client performs NIP-42 AUTH on connection:

```typescript
// CEPS (Central Event Publishing Service) handles this automatically
// See: src/lib/ceps/ceps.ts
```

### 5.2 Relay List (NIP-65)

Publish a kind:10002 event with your relay preferences:

```json
{
  "kind": 10002,
  "tags": [
    ["r", "wss://pylon.openagents.com", "write"],
    ["r", "wss://relay.damus.io", "read"],
    ["r", "wss://nos.lol", "read"]
  ],
  "content": ""
}
```

---

## 6. PWA Installation

### 6.1 Android (Chrome)

1. Open `https://satnam.pub` in Chrome
2. Tap the browser menu → "Add to Home Screen"
3. Tap "Install"

### 6.2 iOS (Safari)

1. Open `https://satnam.pub` in Safari
2. Tap the Share button → "Add to Home Screen"
3. Tap "Add"

### 6.3 Desktop (Chrome/Edge)

1. Open `https://satnam.pub`
2. Click the install icon in the address bar
3. Click "Install"

### 6.4 PWA Features

- **Offline support**: Static assets cached via service worker
- **Background sync**: Queued Nostr events delivered when connectivity returns
- **Home screen icon**: 192px and 512px icons in `/public/icons/`
- **Standalone mode**: No browser chrome (full-screen app)

---

## 7. Security Verification

After deployment, verify all security invariants:

```sh
# Run invariant checks
npm run check:invariants

# Verify CSP header is set correctly
curl -I https://satnam.pub | grep Content-Security-Policy
# Must include: default-src 'self'; ... no 'unsafe-eval'

# Verify function count
ls netlify/functions/ | wc -l
# Must be: 8

# Verify no Sentry dependency
cat package.json | grep -c sentry
# Must be: 0

# Verify no JWT dependency
grep -r "jsonwebtoken\|jose\|JWT_SECRET" src/ netlify/
# Must return: 0 results
```

---

## 8. Monitoring

### Netlify Analytics

Enable Netlify Analytics in the dashboard for function invocation counts and error rates.

### Function Logs

```sh
netlify functions:log --name register-identity --tail
netlify functions:log --name nip05-resolver --tail
```

### Supabase Dashboard

Monitor table sizes and query performance in the Supabase dashboard.

---

## 9. Troubleshooting

### NIP-07 Extension Not Detected

Some browser extensions inject `window.nostr` asynchronously. The auth page checks again after 500ms. If still not detected, instruct users to refresh the page after the extension loads.

### Function Timeout

Netlify functions have a 10-second default timeout. The `simpleproof-anchor` and `unified-comms` functions may approach this limit during relay operations. If timeouts occur:
1. Upgrade to Netlify Pro (60s timeout)
2. Or reduce `WS_TIMEOUT_MS` in the affected functions

### Supabase Rate Limits

The free tier has row-level limits. If `rate_limits` table grows large, configure the pg_cron cleanup job from Section 3.2.

### CSP Violations

Check browser console for CSP violations. If a legitimate resource is blocked, update `netlify.toml` → `Content-Security-Policy` header. Do NOT add `'unsafe-eval'` (S12 invariant).
