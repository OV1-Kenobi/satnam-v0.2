# Satnam v2

**Satnam** is a Nostr-native sovereign identity platform. Users hold their own keys in an OPFS Vault on-device — no server ever sees a private key. The platform provides NIP-05 identity registration, FROST threshold group keys, NWC-powered Lightning payments, and a NIP-90 DVM agent marketplace, all running as a Progressive Web App.

Full specification: [`docs/SPECIFICATION.md`](./docs/SPECIFICATION.md)

---

## Setup

```bash
# 1. Clone
git clone https://github.com/your-org/satnam-v2
cd satnam-v2

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env.local
# Edit .env.local — at minimum set:
#   VITE_SUPABASE_URL
#   VITE_SUPABASE_ANON_KEY
#   VITE_PYLON_RELAY

# 4. Add self-hosted fonts
# Download Cinzel woff2 files into public/fonts/
# See public/fonts/.gitkeep for instructions

# 5. Run dev server
npm run dev
```

Other commands:

```bash
npm run build          # Production build → dist/
npm run typecheck      # TypeScript type check (no emit)
npm test               # Vitest unit tests
npm run check          # Run all S1–S12 security invariant checks locally
```

---

## Architecture

Satnam v2 is a Vite + React 18 PWA deployed to Netlify. All cryptographic operations (key generation, signing, vault encryption) run entirely client-side using the WebCrypto API; keys are stored in the Origin Private File System (OPFS), not `localStorage` or Supabase. Supabase holds only public data: NIP-05 username → pubkey mappings and Lightning address LNURL callbacks. Server-side logic is limited to eight Netlify Functions which use NIP-98 HTTP Auth (Nostr event signatures) instead of JWTs. The Pylon relay (`wss://pylon.openagents.com`) is the primary Nostr transport with NIP-42 authenticated channels. FROST threshold signatures (via `@frostr/bifrost`) enable multi-device group keys without any single point of compromise.

---

## Security Invariants

Twelve invariants are enforced on every push and pull request by the [CI pipeline](./.github/workflows/ci.yml):

| ID  | Invariant |
|-----|-----------|
| S1  | No `encrypted_nsec`, `nsec`, `secret_key`, or `private_key` column in any SQL file |
| S2  | No `jsonwebtoken`, `jose`, `JWT_SECRET`, or `jwt` import in any source file |
| S3  | No `@sentry/*` in `package.json` |
| S4  | No `localStorage.setItem` storing `nsec/priv/secret/key/pairing` |
| S5  | No OPFS reference in `netlify/functions/` |
| S6  | No `cmacHex` or `piccDataHex` in `netlify/functions/` |
| S7  | No external font CDN `<link>` tags in `index.html` |
| S8  | Production dependency count ≤ 22 |
| S9  | Netlify function count ≤ 8 |
| S10 | Every NIP-98 function calls `verifyNip98()` |
| S11 | No `console.log/error` with `nsec/key/secret/share/proof` variable names |
| S12 | CSP header does not include `'unsafe-eval'` |

Run locally: `node scripts/check-invariants.mjs`

---

## Phase Status

**Phase 1 — Foundation** *(Weeks 1–4)* — **In Progress**

- [x] Week 1: Repo scaffold, PWA shell, service worker, self-hosted fonts, CI pipeline
- [ ] Week 2: OPFS Vault (argon2id + WebAuthn wrapping key)
- [ ] Week 3: NIP-98 auth, NIP-05 registration flow, Netlify functions
- [ ] Week 4: CEPS port, relay management, kind:0 profile UI, v1 migration ceremony

See [`docs/SPECIFICATION.md § 13`](./docs/SPECIFICATION.md) for the full phase plan (Phases 1–4, Weeks 1–16).
