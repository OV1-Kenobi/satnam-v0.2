# Project Configuration

This page covers all configuration files in Satnam v2 — environment variables, Vite, Tailwind, TypeScript, Netlify, and the PWA manifest.

---

## Environment Variables

All environment variables are accessed through `src/config/env.ts`. **Never** read `import.meta.env` directly from feature code.

### `.env.example`

```bash
# ── Required ──────────────────────────────────────────────────────────────────

# Supabase project URL (https://your-project.supabase.co)
VITE_SUPABASE_URL=

# Supabase anonymous/public key (safe to expose — no service_role key)
VITE_SUPABASE_ANON_KEY=

# Primary Pylon relay WebSocket URL (NIP-42 authenticated)
VITE_PYLON_RELAY=wss://pylon.openagents.com

# ── Optional ──────────────────────────────────────────────────────────────────

# Comma-separated fallback relay URLs (used when Pylon is unavailable)
VITE_FALLBACK_RELAYS=wss://relay.damus.io,wss://relay.nostr.band

# Application environment (development | staging | production)
# Defaults to the Vite MODE value
VITE_APP_ENV=production

# ── Feature flags ─────────────────────────────────────────────────────────────

# NFC NTAG424 client-side CMAC verification (Android Chrome only)
VITE_ENABLE_NFC=false

# Cashu eCash client (mint management, token operations)
VITE_ENABLE_CASHU=false

# NIP-90 DVM marketplace (job requests, results, payments)
VITE_ENABLE_NIP90=false

# FROST group key management via @frostr/bifrost
VITE_ENABLE_FROST=false

```

### Config Module API (`src/config/env.ts`)

| Export | Returns | Description |
|---|---|---|
| `getSupabaseUrl()` | `string` | Supabase project HTTPS URL |
| `getSupabaseAnonKey()` | `string` | Supabase anon key |
| `getPylonRelay()` | `string` | Primary Pylon WSS URL |
| `getFallbackRelays()` | `string[]` | Parsed fallback relay URLs |
| `getAllRelays()` | `string[]` | Pylon + fallbacks combined |
| `getAppEnv()` | `'development' \| 'staging' \| 'production'` | Current environment |
| `isDev()` | `boolean` | True in development mode |
| `isNfcEnabled()` | `boolean` | NFC feature flag |
| `isCashuEnabled()` | `boolean` | Cashu feature flag |
| `isNip90Enabled()` | `boolean` | NIP-90 feature flag |
| `isFrostEnabled()` | `boolean` | FROST feature flag |


```typescript
// Usage
import { getPylonRelay, isFrostEnabled } from '@config/env';

const relay = getPylonRelay(); // 'wss://pylon.openagents.com'
const frostOn = isFrostEnabled(); // false (unless flag set)
```

---

## Vite Configuration

**File:** `vite.config.ts`

Key features: path aliases, WASM support, manual chunk splitting, top-level await.

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    wasm(),           // Required for @frostr/bifrost WASM
    topLevelAwait(),  // Required for @frostr/bifrost top-level await
  ],

  resolve: {
    alias: {
      '@lib':        path.resolve(__dirname, 'src/lib'),
      '@hooks':      path.resolve(__dirname, 'src/hooks'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@pages':      path.resolve(__dirname, 'src/pages'),
      '@providers':  path.resolve(__dirname, 'src/providers'),
      '@config':     path.resolve(__dirname, 'src/config'),
      '@assets':     path.resolve(__dirname, 'src/assets'),
    },
  },

  build: {
    target: 'es2022',
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor splitting — keeps initial bundle small
          'vendor-react':  ['react', 'react-dom', 'react-router-dom'],
          'vendor-nostr':  ['nostr-tools', '@frostr/bifrost'],
          'vendor-crypto': ['@noble/curves', '@noble/hashes', '@noble/ciphers'],
          'vendor-cashu':  ['@cashu/cashu-ts'],
          'vendor-ui':     ['lucide-react', 'clsx', 'tailwind-merge'],
        },
      },
    },
  },
});
```

### Path Aliases Summary

| Alias | Resolves To | Contents |
|---|---|---|
| `@lib` | `src/lib/` | Library modules (vault, frost, nwc, etc.) |
| `@hooks` | `src/hooks/` | React hooks |
| `@components` | `src/components/` | React components |
| `@pages` | `src/pages/` | Page-level components |
| `@providers` | `src/providers/` | React context providers |
| `@config` | `src/config/` | env.ts and other config |
| `@assets` | `src/assets/` | Static assets (fonts, icons) |

---

## TypeScript Configuration

**File:** `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@lib/*":        ["./src/lib/*"],
      "@hooks/*":      ["./src/hooks/*"],
      "@components/*": ["./src/components/*"],
      "@pages/*":      ["./src/pages/*"],
      "@providers/*":  ["./src/providers/*"],
      "@config/*":     ["./src/config/*"],
      "@assets/*":     ["./src/assets/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Key settings:
- `strict: true` — full TypeScript strictness
- `exactOptionalPropertyTypes: true` — catches optional property bugs
- `noEmit: true` — TypeScript used for type checking only; Vite handles transpilation

---

## Tailwind Configuration

**File:** `tailwind.config.ts`

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bitcoin-orange': '#f7931a',
        'bitcoin-orange-dim': '#c4760e',
      },
      fontFamily: {
        cinzel: ['Cinzel', 'serif'],  // Self-hosted (invariant S7 — no external CDN)
        sans: ['system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      animation: {
        'spin-slow': 'spin 3s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
```

Self-hosted fonts are loaded from `/public/fonts/` via `@font-face` declarations in `src/index.css`. No external CDN calls (invariant S7).

---

## Netlify Configuration

**File:** `netlify.toml`

### Build Settings

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "20"
  NPM_FLAGS = "--prefer-offline"
```

### Content Security Policy

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline';
  connect-src 'self'
    wss://pylon.openagents.com
    wss://*.nostr.com
    wss://*.relay.*
    https://*.supabase.co;
  img-src 'self' data: blob: https:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none'
```

**CSP notes:**
- `'wasm-unsafe-eval'` is required for `@frostr/bifrost` WASM (invariant S12 — no `'unsafe-eval'`)
- `font-src 'self'` enforces self-hosted font requirement (invariant S7)
- `frame-ancestors 'none'` prevents clickjacking

### Security Headers

```toml
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    X-XSS-Protection = "1; mode=block"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(), geolocation=(), payment=()"
    Strict-Transport-Security = "max-age=31536000; includeSubDomains; preload"
```

### URL Routing

```toml
# NIP-05 well-known
[[redirects]]
  from = "/.well-known/nostr.json"
  to = "/.netlify/functions/nip05-resolver"
  status = 200
  force = true

# NIP-SA agent discovery
[[redirects]]
  from = "/.well-known/agent.json"
  to = "/.netlify/functions/well-known-agent"
  status = 200
  force = true

# SPA fallback — all other routes serve index.html
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Production Feature Flags

```toml
[context.production.environment]
  VITE_PYLON_RELAY      = "wss://pylon.openagents.com"
  VITE_FX_ENABLED       = "false"
  VITE_BIFROST_ENABLED  = "false"
  VITE_NFC_ENABLED      = "true"
  VITE_CASHU_ENABLED    = "false"
  VITE_NIP90_ENABLED    = "false"
  VITE_PROBE_ENABLED    = "false"
```

---

## PWA Manifest

**File:** `public/manifest.webmanifest`

```json
{
  "name": "Satnam",
  "short_name": "Satnam",
  "description": "Sovereign identity and agent economy platform",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#f7931a",
  "icons": [
    {
      "src": "/icons/192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "/icons/maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

The PWA service worker (`/sw.js`) has `Cache-Control: no-cache` to ensure updates propagate immediately. Assets under `/fonts/` have a 1-year immutable cache.

---

## Production Dependencies (≤22)

Per Axiom 4. All 22 production dependencies are listed with their mandate mapping:

| Package | Version | Mandate |
|---|---|---|
| `@cashu/cashu-ts` | ^2.5.0 | Axiom 2 — eCash rail |
| `@frostr/bifrost` | ^2.0.2 | Axiom 3/5 — FROST threshold signing |
| `@getalby/lightning-tools` | ^6.0.0 | Axiom 2 — Lightning utilities |
| `@getalby/sdk` | ^6.0.1 | Axiom 2 — NWC SDK |
| `@noble/ciphers` | ^1.3.0 | Axiom 3 — XChaCha20-Poly1305 for vault |
| `@noble/curves` | ^2.0.0 | Axiom 3 — Schnorr signatures |
| `@noble/hashes` | ^1.8.0 | Axiom 3 — SHA-256, HMAC |
| `@scure/bip32` | ^1.1.5 | Axiom 3/5 — HD key derivation |
| `@scure/bip39` | ^1.1.1 | Axiom 3/5 — mnemonic support |
| `@supabase/supabase-js` | ^2.50.2 | Infrastructure — 4-table NIP-05 DB |
| `bolt11` | ^1.4.1 | Axiom 2 — BOLT-11 invoice parsing |
| `clsx` | ^2.1.1 | UI utility |
| `date-fns` | ^4.1.0 | UI utility |
| `lucide-react` | ^0.263.1 | UI icons |
| `nostr-tools` | ^2.15.0 | Axiom 1/2 — Nostr protocol |
| `qrcode-generator` | ^2.0.4 | UI — invoice QR codes |
| `react` | ^18.2.0 | UI framework |
| `react-dom` | ^18.2.0 | UI framework |
| `react-helmet-async` | ^2.0.5 | PWA head management |
| `react-router-dom` | ^6.30.1 | SPA routing |
| `tailwind-merge` | ^3.3.1 | UI utility |
| `websocket-polyfill` | ^1.0.0 | Axiom 2 — WebSocket for relay connections |

Total: **22** — at the exact invariant limit (S8).
