# Satnam v2 — Security Documentation

## Overview

Satnam v2 is built on a security-first architecture. The fundamental design decision is that **no private key material ever leaves the user's device or enters any server**. This document describes the security invariants, threat model, key material policy, and incident response procedure.

---

## 1. Security Invariants (S1–S12)

These are boolean properties that must be true in every deployment. CI/CD checks enforce them automatically.

### S1 — No Key Material in Database

**Invariant:** No `encrypted_nsec`, `nsec`, `secret_key`, or `private_key` column exists in any Supabase table.

**Enforcement:** Schema linter in CI (`npm run check:invariants`).

**Why:** In v1, encrypted nsec values were stored in Supabase. A Supabase compromise or a Supabase employee with database access could access encrypted private keys. In v2, private keys are stored exclusively in the user's OPFS Vault on their device. Supabase contains only public data: NIP-05 usernames, Lightning addresses, and rate limit counters.

**Verification:**
```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('encrypted_nsec', 'nsec', 'user_salt', 'private_key', 'secret_key');
-- Expected: 0 rows
```

---

### S2 — No JWT

**Invariant:** No `jsonwebtoken`, `jose`, `JWT_SECRET`, or `jwt` import exists in any source file.

**Enforcement:** `grep -r "jsonwebtoken\|jose\|JWT_SECRET" src/ netlify/` in CI.

**Why:** JWT introduces a server-side secret (`JWT_SECRET`) that, if compromised, allows an attacker to forge tokens for any user. v2 uses NIP-98 HTTP Authentication instead: each request is authenticated by a Nostr signature bound to the exact URL and HTTP method. A server compromise cannot forge Nostr signatures without the user's private key.

---

### S3 — No Sentry

**Invariant:** No `@sentry/*` package exists in `package.json`.

**Enforcement:** `cat package.json | grep sentry` returns 0 matches.

**Why:** Sentry captures stack traces, breadcrumbs, and potentially sensitive application state, then transmits it to Sentry's servers. Even with PII scrubbing, there is a risk of inadvertently capturing key material or user behavior patterns. Error reporting in v2 is console-only, with no external transmission.

---

### S4 — No nsec in localStorage

**Invariant:** No `localStorage.setItem` call stores any value matching `/nsec|priv|secret|key|pairing/i`.

**Enforcement:** AST lint rule (custom ESLint plugin).

**Why:** `localStorage` is accessible to any JavaScript on the page, including injected XSS payloads and browser extensions. Private keys stored in `localStorage` are trivially extractable. v2 stores all key material exclusively in OPFS (Origin Private File System), which requires async API calls and is not accessible via the synchronous `localStorage` API.

---

### S5 — No OPFS Access in Functions

**Invariant:** No Netlify function reads from or writes to OPFS.

**Enforcement:** Architecture constraint (functions run server-side in Node.js runtime, which has no OPFS access).

**Why:** OPFS is a browser-only API. Netlify functions run in Node.js. This invariant is structurally enforced by the runtime environment — it cannot be violated without fundamentally changing the architecture.

---

### S6 — No CMAC in Server-Side Code

**Invariant:** No CMAC value (`cmacHex`, `piccDataHex`) appears in any server-side function body.

**Enforcement:** `grep -r "cmacHex\|piccDataHex" netlify/` in CI.

**Why:** CMAC values are NFC card authentication codes used for NTAG424 verification. They are verified client-side only. If CMAC values reached server-side code, a server compromise could log them, enabling replay attacks against NFC cards. The client verifies CMAC, then discards it — no CMAC value ever reaches a Netlify function.

---

### S7 — Self-Hosted Fonts

**Invariant:** All fonts are served from `/public/fonts/` — no external font CDN `<link>` tags.

**Enforcement:** HTML linter in CI.

**Why:** External font CDN requests (e.g., `fonts.googleapis.com`) leak user IP addresses and browsing patterns to Google. Self-hosted fonts eliminate this tracking vector entirely. The CSP `font-src 'self'` directive also blocks any inadvertent external font loading.

---

### S8 — Dependency Count ≤ 22

**Invariant:** `package.json` production dependencies count ≤ 22.

**Enforcement:** `npm run check:deps` counts production deps.

**Why:** Each production dependency is a supply chain attack vector. Minimizing dependencies reduces the attack surface. The 22-dep ceiling forces deliberate evaluation of every new dependency.

---

### S9 — Function Count ≤ 8

**Invariant:** Netlify function count ≤ 8.

**Enforcement:** `ls netlify/functions/ | wc -l` in CI.

**Why:** Each Netlify function is an additional attack surface. Fewer functions means fewer potential vulnerabilities and a simpler security review surface. The ≤8 ceiling reflects exactly the functions needed for the application's core functionality.

---

### S10 — NIP-98 Before Business Logic

**Invariant:** Every Netlify function that requires auth calls `verifyNip98()` before any business logic.

**Enforcement:** Code review requirement + static analysis.

**Why:** If business logic executes before authentication, an attacker can bypass auth by triggering side effects in the business logic path. `verifyNip98()` must be the first meaningful call in every authenticated function — if it returns `{ authenticated: false }`, the function returns 401 immediately, executing no further code.

**Authenticated functions:**
- `register-identity.ts` — calls `verifyNip98()` before username check
- `nwc-proxy.ts` — calls `verifyNip98()` before relay forwarding
- `simpleproof-anchor.ts` — calls `verifyNip98()` before OTS submission
- `issuer-registry.ts` (POST) — calls `verifyNip98()` before database write
- `unified-comms.ts` — calls `verifyNip98()` before relay delivery

**Public functions (no auth required):**
- `nip05-resolver.ts` — "NIP-98 not required" comment
- `well-known-agent.ts` — "NIP-98 not required" comment
- `check-username.ts` — "NIP-98 not required" comment
- `issuer-registry.ts` (GET) — "NIP-98 not required" comment

---

### S11 — No Key Material in Logs

**Invariant:** No `console.log` or `console.error` call includes a variable matching `/nsec|key|secret|share|proof/i`.

**Enforcement:** AST lint rule.

**Why:** Server logs are often retained and may be accessible to operations personnel, log aggregation services, or attackers who gain log access. Even if key material is only transiently in a variable name matching this pattern, logging it creates a persistent record of sensitive data.

---

### S12 — No `unsafe-eval` in CSP

**Invariant:** CSP header does not include `'unsafe-eval'`.

**Enforcement:** Header check in deployment pipeline.

**Why:** `'unsafe-eval'` permits `eval()`, `new Function()`, and similar dynamic code execution. These are common XSS escalation vectors — an attacker who injects a script can use `eval()` to execute arbitrary code. The CSP includes `'wasm-unsafe-eval'` (for FROSTR WASM) but explicitly excludes `'unsafe-eval'`. All v2 JavaScript is statically compiled — no runtime `eval()` is used anywhere.

---

## 2. Threat Model

### T1 — Supabase Compromise → nsec Extraction

| | |
|---|---|
| **v1 Severity** | CRITICAL |
| **v2 Mitigation** | nsec not in Supabase. NIP-05 names are public data. |
| **v2 Residual Risk** | LOW — attacker gets usernames and pubkeys (already public on Nostr) |

**Detail:** An attacker who gains full access to the v2 Supabase database obtains: NIP-05 username→pubkey mappings, Lightning addresses, rate limit counters. All of this data is publicly observable on the Nostr network anyway. There are no private keys, no session tokens, no personally identifying information beyond what users voluntarily make public.

---

### T2 — Netlify Function Compromise → Auth Bypass

| | |
|---|---|
| **v1 Severity** | CRITICAL (JWT_SECRET leak) |
| **v2 Mitigation** | No JWT. NIP-98 auth requires valid Nostr signature. |
| **v2 Residual Risk** | LOW — attacker can DoS or read public data, cannot impersonate users |

**Detail:** In v1, leaking `JWT_SECRET` allowed an attacker to forge authentication tokens for any user. In v2, NIP-98 authentication is cryptographically bound to the user's Nostr keypair. A Netlify function compromise cannot forge Nostr signatures — the attacker would need the user's private key, which is only in the user's OPFS Vault.

---

### T3 — XSS → Key Extraction

| | |
|---|---|
| **v1 Severity** | HIGH (localStorage nsec, NIP-46 keys) |
| **v2 Mitigation** | Keys in OPFS (not accessible via document.cookie or window.localStorage). OPFS requires async API calls. |
| **v2 Residual Risk** | MEDIUM — sophisticated XSS with async OPFS access is theoretically possible. CSP `script-src 'self'` mitigates. |

**Detail:** OPFS access requires calling `navigator.storage.getDirectory()` and performing async file operations. A basic XSS payload cannot synchronously extract OPFS contents. However, a sophisticated persistent XSS attack could potentially use these async APIs. The primary mitigation is the strict `script-src 'self'` CSP — inline scripts and scripts from external domains cannot execute.

---

### T4 — Supply Chain (Malicious npm Package)

| | |
|---|---|
| **v1 Severity** | HIGH |
| **v2 Mitigation** | Reduced to 22 deps. No eval(). CSP blocks inline scripts. Lockfile integrity checks. |
| **v2 Residual Risk** | MEDIUM — supply chain risk is inherent to npm. Mitigation is minimization + SRI. |

**Detail:** The 22-dependency ceiling is a key defense. Every dependency that isn't present cannot be compromised. The remaining 22 dependencies are reviewed and have their versions pinned in `package-lock.json`. SRI (Subresource Integrity) would additionally verify bundled assets — consider enabling for production.

---

### T5 — Sentry Data Exfiltration

| | |
|---|---|
| **v1 Severity** | CRITICAL |
| **v2 Mitigation** | Sentry removed entirely. |
| **v2 Residual Risk** | NONE |

**Detail:** v1 used Sentry for error reporting. Sentry captured stack traces that could include key material, and transmitted them to Sentry's servers. v2 has no Sentry dependency (S3 invariant). Error reporting is console-only.

---

### T6 — CMAC Replay

| | |
|---|---|
| **v1 Severity** | CRITICAL |
| **v2 Mitigation** | CMAC verified client-side. Server never sees CMAC. |
| **v2 Residual Risk** | LOW — attacker would need physical device access |

**Detail:** NTAG424 NFC cards produce CMAC authentication codes that are verified client-side using the stored key (in OPFS Vault). The server never receives CMAC values (S6 invariant). An attacker cannot replay a captured CMAC because the counter in the tag's secure element advances with each tap.

---

### T7 — Google Fonts Tracking

| | |
|---|---|
| **v1 Severity** | MEDIUM |
| **v2 Mitigation** | Fonts self-hosted. |
| **v2 Residual Risk** | NONE |

**Detail:** Every Google Fonts request reveals user IP, browser, and the URL of the page they were viewing. v2 self-hosts all fonts in `/public/fonts/` (S7 invariant).

---

### T8 — Relay Metadata Analysis

| | |
|---|---|
| **v1 Severity** | MEDIUM |
| **v2 Mitigation** | NIP-17 gift-wrapping for DMs. NIP-42 AUTH on Pylon. |
| **v2 Residual Risk** | MEDIUM — relay operator sees event metadata (pubkey, kind, timestamp). |

**Detail:** Nostr relay operators see event metadata even for encrypted events. NIP-17 gift-wrapping hides the sender, recipient, and content from relays — only the recipient can identify the actual communication. NIP-42 AUTH on Pylon limits relay access to authenticated users.

---

### T9 — FROST Share Compromise (Single Device)

| | |
|---|---|
| **v1 Severity** | N/A (new in v2) |
| **v2 Mitigation** | Threshold: 2-of-n. Single share compromise does not yield signing capability. |
| **v2 Residual Risk** | LOW — attacker needs 2+ devices |

**Detail:** FROST (Flexible Round-Optimized Schnorr Threshold) distributes signing authority across multiple devices. A single compromised device reveals only one share. The threshold (e.g., 2-of-3) ensures signing requires participation from multiple devices.

---

### T10 — OPFS Vault Brute-Force

| | |
|---|---|
| **v1 Severity** | N/A (new in v2) |
| **v2 Mitigation** | argon2id with m=65536, t=3, p=4. 12-char minimum passphrase. |
| **v2 Residual Risk** | MEDIUM — depends on passphrase entropy. WebAuthn preferred. |

**Detail:** argon2id with the configured parameters requires significant memory and compute per guess, making brute-force impractical for strong passphrases. WebAuthn (hardware security key or device biometrics) is preferred over passphrase-based unlocking for maximum security.

---

## 3. Key Material Policy

### Principles

1. **Private keys never leave the device.** The nsec is generated client-side, stored in OPFS, and only decrypted in-memory during signing operations.

2. **No server-side private keys.** Netlify functions do not hold, process, or transmit private keys. NIP-98 authentication extracts only the public key from the verified event.

3. **Minimal in-memory exposure.** After signing, private key bytes are zeroed from JavaScript memory as soon as possible. (Note: JavaScript garbage collection means full zeroing is best-effort — this is a known limitation of browser environments.)

4. **Vault locking.** The OPFS Vault should be locked (master key cleared from memory) when the app is not actively in use. The lock timer is configurable.

5. **FROST shares.** Each FROST share is stored separately in the OPFS Vault of the corresponding device. No single location holds all shares.

### Key Rotation

Key rotation requires generating a new keypair and re-publishing all identity data (kind:0 profile, NIP-05 registration, NIP-65 relay list, NIP-26 delegations). The `register-identity` function allows re-registering a NIP-05 name for a new pubkey by deactivating the old mapping.

### Lost Access

If a user loses access to their OPFS Vault passphrase AND their WebAuthn device, recovery requires the FROST threshold ceremony (if configured) — a quorum of other group members can co-sign recovery events.

---

## 4. Incident Response

### Severity Classification

| Level | Description | Response Time |
|---|---|---|
| P0 — Critical | Key material exposed or at risk; authentication bypass active | Immediate |
| P1 — High | Service unavailable; data integrity risk | Within 2 hours |
| P2 — Medium | Degraded performance; non-critical feature failure | Within 24 hours |
| P3 — Low | Minor UI bugs; non-security issues | Next release |

### P0 — Critical Incident Procedure

**Trigger:** Any confirmed or suspected exposure of private key material, authentication bypass, or compromise of the Supabase database.

**Steps:**

1. **Assess scope** — Determine which users/functions/tables are affected.

2. **Isolate** — If a Netlify function is compromised:
   - Disable the function in Netlify Dashboard (Settings → Functions → Disable)
   - Rotate `SUPABASE_SERVICE_ROLE_KEY` immediately in Netlify env vars
   - Rotate Supabase project keys

3. **Communicate** — Notify affected users via Nostr (publish a kind:1 note from the Satnam official pubkey).

4. **S1 check** — Verify no key material was exfiltrated from Supabase:
   ```sql
   SELECT COUNT(*) FROM audit_log WHERE action LIKE '%encrypted_nsec%';
   ```

5. **S2 check** — If a JWT secret was involved, rotate it and invalidate all sessions.

6. **Postmortem** — Document the incident, root cause, and remediation steps within 48 hours.

### P1 — Service Unavailable

**Trigger:** Netlify functions returning 5xx errors; Supabase connection failures.

**Steps:**

1. Check Netlify function logs: `netlify functions:log`
2. Check Supabase status: [status.supabase.com](https://status.supabase.com)
3. If Supabase is down: NIP-05 resolver will fail; inform users via Nostr
4. If Netlify is down: PWA continues to function offline (cached assets + OPFS vault)

### Recovery After Key Compromise

If a user's nsec is suspected to have been compromised:

1. Generate a new keypair on a clean device
2. Publish a kind:0 profile from the new pubkey
3. Re-register NIP-05 via `register-identity` with the new pubkey
4. Notify contacts via NIP-17 gift-wrapped message from the new pubkey
5. Deactivate the old NIP-05 entry (admin operation via Supabase dashboard)

---

## 5. Security Audit Checklist

Before each production release:

- [ ] `npm run check:invariants` passes (S1–S12)
- [ ] `npm audit --audit-level=high` returns no high/critical vulns
- [ ] CSP header verified: no `'unsafe-eval'` (S12)
- [ ] Function count: `ls netlify/functions/ | wc -l` = 8 (S9)
- [ ] Dep count: `cat package.json | jq '.dependencies | length'` ≤ 22 (S8)
- [ ] No Sentry: `grep -r sentry package.json` = empty (S3)
- [ ] No JWT: `grep -r jsonwebtoken src/ netlify/` = empty (S2)
- [ ] Self-hosted fonts: no external font CDN links in HTML (S7)
- [ ] `verifyNip98()` called first in all auth'd functions (S10)

---

## 6. Reporting Vulnerabilities

To report a security vulnerability:

1. Do **not** open a public GitHub issue for security vulnerabilities.
2. Send a NIP-17 gift-wrapped message to the Satnam official pubkey.
3. Include: vulnerability description, reproduction steps, affected components.
4. Response within 48 hours for P0/P1 issues.
