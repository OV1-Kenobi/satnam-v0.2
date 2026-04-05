# Security Overview

Satnam v2 is built with security weighted at **2x** relative to other design concerns. This is encoded directly in the mandate axioms: Axiom 3 ("Security and sovereignty over convenience, always") carries twice the weight of the other axioms. When any design decision forces a trade-off between security and convenience, security wins.

The v1 audit scored the system at **3.2/10** against the mandate axioms. The critical failures were:
- Encrypted nsec stored in Supabase (custody violation)
- JWT as primary auth mechanism (sovereignty violation)
- Sentry SDK exfiltrating data to a third-party server
- CMAC verification handled server-side (physical verification violation)
- Shamir shares reconstructed on the server (threshold signing violation)

Every one of these failures is corrected in v2. The security architecture is not incremental improvement — it is a ground-up rebuild against explicit security invariants.

---

## Security-First Design Philosophy

The key insight driving v2's security architecture: **the server is not trusted**. This is a deliberate architectural inversion from conventional web applications.

In a conventional app:
- Server authenticates users (holds JWT_SECRET)
- Server stores sensitive data (encrypted in DB)
- Server enforces access control (database roles)

In Satnam v2:
- **Client authenticates itself** cryptographically (holds nsec, signs each request)
- **Client stores sensitive data** (OPFS Vault, device-only)
- **Cryptography enforces access control** (NIP-26 delegation signatures)

The server (Netlify functions + Supabase) handles only public data: NIP-05 name mappings, Lightning address routing, rate limiting, and username reservations. None of this data is sensitive. A complete Supabase compromise reveals: usernames and their associated pubkeys — both of which are already publicly visible on the Nostr network.

---

## The 12 Security Invariants

These are boolean properties enforced by CI/CD checks on every commit. Violation of any invariant blocks deployment.

### S1: No Key Material in Database

**What:** No column named `encrypted_nsec`, `nsec`, `secret_key`, or `private_key` may exist in any Supabase table.

**Why:** The v1 system stored user private keys in Supabase, even encrypted. This creates a single point of failure — if Supabase is compromised or the decryption key is leaked, all users' identities are exposed simultaneously. Moving key material out of the database eliminates this attack surface entirely. The database becomes meaningless to an attacker.

**Enforcement:** Schema linter in CI scans migration files and the live schema for forbidden column names.

### S2: No JWT Anywhere

**What:** No `jsonwebtoken`, `jose`, `JWT_SECRET`, or `jwt` import may exist in any source file.

**Why:** JWT authentication centralizes trust in a server-held secret (`JWT_SECRET`). If that secret is leaked (via environment variable exposure, logs, or server compromise), every user's session can be forged. NIP-98 uses asymmetric cryptography — the "secret" is the user's nsec, which the server never sees.

**Enforcement:** Grep check in CI against all TypeScript and JavaScript source files.

### S3: No Sentry

**What:** No `@sentry/*` package may exist in `package.json`.

**Why:** Sentry (and similar error reporting services) capture stack traces, request data, and variable values at the time of errors. In a key-handling application, this creates a high probability of accidentally exfiltrating private keys, wallet seeds, or cryptographic secrets to a third-party server. The v1 audit found `@sentry/react`, `@sentry/node`, and `@sentry/vite-plugin` all present. All are removed in v2.

**Enforcement:** Dependency audit in CI. No exceptions.

### S4: No localStorage for Key Material

**What:** No `localStorage.setItem` call may store any value matching the pattern `/nsec|priv|secret|key|pairing/i`.

**Why:** `localStorage` is accessible from any JavaScript executing in the same origin — including injected scripts (XSS) and browser extensions. OPFS is not accessible via `window.localStorage` or `document.cookie`; it requires explicit async API calls. Keys in OPFS are significantly harder to exfiltrate than keys in localStorage.

**Enforcement:** AST lint rule that inspects all `localStorage.setItem` calls.

### S5: No OPFS Access in Serverless Functions

**What:** No Netlify function may read from or write to OPFS.

**Why:** OPFS is a browser API — it does not exist in the Node.js serverless environment. This invariant exists to document the architectural constraint and catch any future attempt to create a server-side "vault proxy" that would violate the client-only key custody model.

**Enforcement:** Architecture constraint enforced by the Node.js runtime (OPFS API is undefined in Node.js).

### S6: No CMAC Values Server-Side

**What:** No CMAC value (`cmacHex`, `piccDataHex`) may appear in any server-side function body.

**Why:** The v1 NFC system routed CMAC values through the server for verification. This exposed physical card authentication data to the server, creating a relay attack vector. CMAC verification is entirely client-side in v2 — the server receives only the boolean result (valid/invalid) and the card UID hash.

**Enforcement:** Grep check in CI against `netlify/functions/` directory.

### S7: All Fonts Self-Hosted

**What:** No external font CDN `<link>` tags may exist in the HTML. All fonts must be served from `/public/fonts/`.

**Why:** External font CDNs (Google Fonts) make HTTP requests to third-party servers on every page load, leaking the user's IP address and browsing pattern to that third party. Self-hosting fonts eliminates this tracking vector. Also removes a CDN dependency that could be used for CSP bypass.

**Enforcement:** HTML linter in CI checks for `fonts.googleapis.com` or `fonts.gstatic.com` in link tags.

### S8: ≤22 Production Dependencies

**What:** The `package.json` production dependency count must not exceed 22.

**Why:** Every dependency is a potential supply chain attack vector. The npm ecosystem has a history of malicious package takeovers, typosquatting, and dependency confusion attacks. Minimizing the dependency count reduces the attack surface. The 22-package limit forces deliberate trade-offs — new functionality must justify its dependency cost.

**Enforcement:** Package audit script in CI counts production dependencies and fails the build if the limit is exceeded.

### S9: ≤8 Netlify Functions

**What:** The `netlify/functions/` directory must contain no more than 8 function files.

**Why:** Each serverless function is a potential entry point for server-side attacks. Fewer functions means fewer attack surfaces, easier auditing, and less complexity in the NIP-98 auth coverage requirement (S10). The 8-function limit forces scope discipline — features that do not require server-side logic must be implemented client-side.

**Enforcement:** Directory count check in CI.

### S10: All Auth'd Functions Call verifyNip98()

**What:** Every Netlify function that handles authenticated operations must call `verifyNip98()` before executing any business logic.

**Why:** A single function that skips NIP-98 verification is an unauthenticated endpoint that can be called by anyone. This invariant ensures there are no accidental authentication bypasses.

**Enforcement:** Code review requirement. The PR checklist includes explicit verification of NIP-98 calls in any new or modified Netlify function.

### S11: No Console Logging of Key Material

**What:** No `console.log` or `console.error` call may include a variable matching `/nsec|key|secret|share|proof/i`.

**Why:** Console logs in browser applications can be captured by browser extensions, dev tools automation, and monitoring tools. Logging key material — even accidentally during debugging — creates an exfiltration path.

**Enforcement:** AST lint rule that inspects all console call arguments.

### S12: No 'unsafe-eval' in CSP

**What:** The Content Security Policy header must not include `'unsafe-eval'`.

**Why:** `'unsafe-eval'` allows `eval()`, `new Function()`, and similar dynamic code execution. These functions are the primary targets for XSS payload execution. Banning `'unsafe-eval'` dramatically reduces the damage potential of an XSS injection. Note: `'wasm-unsafe-eval'` is permitted — this is distinct from `'unsafe-eval'` and is required by the FROSTR bifrost WASM module.

**Enforcement:** CSP header check in deployment pipeline.

---

## CI Enforcement via check-invariants.mjs

The `scripts/check-invariants.mjs` script runs all S1-S12 checks as part of the CI pipeline:

```javascript
// scripts/check-invariants.mjs
import { checkSchema } from './checks/s1-schema.mjs';
import { checkJwt } from './checks/s2-jwt.mjs';
import { checkSentry } from './checks/s3-sentry.mjs';
// ... etc.

const results = await Promise.all([
  checkSchema(),    // S1
  checkJwt(),       // S2
  checkSentry(),    // S3
  checkLocalStorage(), // S4
  checkOpfsInFunctions(), // S5
  checkCmacInFunctions(), // S6
  checkFonts(),     // S7
  checkDepsCount(), // S8
  checkFunctionCount(), // S9
  // S10 is manual review
  checkConsoleLogs(), // S11
  checkCsp(),       // S12
]);

const failures = results.filter(r => !r.passed);
if (failures.length > 0) {
  console.error('Security invariant violations:', failures);
  process.exit(1);
}
```

This script is run on every pull request and every deployment. A failing invariant blocks merging.

---

## Security Pages

- [Threat Model](threat-model.md)
- [Key Custody Model](key-custody.md)
- [Audit Trail and Compliance](audit-trail.md)
