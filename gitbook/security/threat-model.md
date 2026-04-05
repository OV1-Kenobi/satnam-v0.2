# Threat Model

This document defines the threat categories Satnam v2 is designed to resist, the mitigation for each, and the residual risks that remain. Understanding what the system protects against — and what it does not — is essential for deploying it appropriately.

---

## Threat Categories

### T1: Supabase Compromise → Key Exfiltration

**v1 severity:** CRITICAL — the v1 system stored `encrypted_nsec` and `user_salt` in Supabase. A database dump would expose all user private keys.

**v2 mitigation:** Zero key material in Supabase. The database contains only NIP-05 name mappings (public), Lightning address routing (public), rate limits (operational), and username reservations (short-lived, no secrets). A complete Supabase compromise reveals usernames and pubkeys — both already public on the Nostr network.

**v2 residual risk:** LOW. Attacker gets usernames and pubkeys. No signing capability, no wallet access.

---

### T2: Netlify Function Compromise → Auth Bypass

**v1 severity:** CRITICAL — the v1 system used `JWT_SECRET` stored in Netlify environment variables. Exposing the secret allowed arbitrary session forgery.

**v2 mitigation:** No JWT, no `JWT_SECRET`. Authentication is NIP-98 (secp256k1 Schnorr signatures). A compromised Netlify function cannot forge Nostr signatures without access to user nsec keys, which are stored only in user devices' OPFS Vaults. The attacker can read public data and DoS the service, but cannot impersonate any user.

**v2 residual risk:** LOW. Attacker can disrupt service availability but cannot steal identities or access wallets.

---

### T3: XSS → Key Extraction

**v1 severity:** HIGH — the v1 system stored nsec in `localStorage` and NIP-46 pairing data in `localStorage`. Both are accessible to any JavaScript in the origin, including XSS payloads.

**v2 mitigation:**
- Keys are in OPFS, not localStorage. OPFS requires explicit async API calls — a simple `document.cookie` dump or `localStorage` exfiltration script does not work.
- Content Security Policy: `script-src 'self'` — inline scripts are blocked, external scripts are blocked.
- No `'unsafe-eval'` — eval-based XSS payload execution is blocked.
- Self-hosted fonts — no external CDN that could be a CSP bypass vector.

**v2 residual risk:** MEDIUM. A sophisticated XSS attack that calls the OPFS API asynchronously could potentially read vault contents if the vault is unlocked. The vault auto-locks after configurable idle timeout (default 15 minutes). WebAuthn-based vault unlocking (preferred) requires physical user presence for re-unlock.

---

### T4: Supply Chain Attack (Malicious npm Package)

**v1 severity:** HIGH — v1 had numerous dependencies with broad capabilities, including packages that were not actively maintained.

**v2 mitigation:**
- Production dependency count capped at ≤22 (security invariant S8)
- No `eval()` in the runtime (S12 — no `'unsafe-eval'` in CSP)
- CSP blocks inline scripts from executing
- npm lockfile (`package-lock.json`) integrity checks in CI
- Subresource Integrity (SRI) hashes on any externally loaded resources

**v2 residual risk:** MEDIUM. Supply chain risk is inherent to any npm-based project. The mitigation is minimization (fewer packages = smaller attack surface) and the CSP that limits what injected code can do.

---

### T5: Sentry Data Exfiltration

**v1 severity:** CRITICAL — the v1 system used `@sentry/react` and `@sentry/node`. Sentry captures stack traces and variable values at error time, potentially including private keys and secrets.

**v2 mitigation:** Sentry removed entirely (security invariant S3). No third-party error reporting service. Error handling uses typed error enums with no data payloads (`VaultLocked`, `IdentityNotFound`, `DecryptionFailed`).

**v2 residual risk:** NONE.

---

### T6: CMAC Replay Attack

**v1 severity:** CRITICAL — the v1 system routed CMAC values through the server. A captured CMAC value could be replayed to forge card presence.

**v2 mitigation:**
- CMAC verification is entirely client-side (security invariant S6)
- The NTAG424 read counter is tracked in OPFS — replaying an old CMAC fails because the counter value is not monotonically increasing
- PIN gate adds a second factor — even a replayed CMAC cannot complete an operation without the correct PIN

**v2 residual risk:** LOW. An attacker needs physical device access (to steal the OPFS vault and the PIN) in addition to having captured a CMAC value.

---

### T7: Relay Manipulation

**Severity:** MEDIUM. A malicious or compromised Nostr relay can:
- Withhold events (censor)
- Replay old events (reorder)
- Inject events that the client would subscribe to

**v2 mitigation:**
- All events are signed — a relay cannot forge a user's events
- NIP-65 outbox model — clients publish to multiple relays and read from multiple relays
- Critical events (delegation, FROST, agent profiles) are published to Pylon + two public relays
- NIP-44 encryption protects message content — relay sees metadata (pubkey, kind, timestamp) but not content
- NIP-42 AUTH on Pylon — relay operator can verify the identity of connecting clients

**v2 residual risk:** MEDIUM. Relay operator sees event metadata even for NIP-44 encrypted events. Multi-relay publication provides censorship resistance. The system tolerates relay compromise but not relay forgery.

---

### T8: Physical Device Loss / Theft

**Severity:** MEDIUM. If a user's device is lost or stolen, the OPFS Vault is at risk.

**v2 mitigation:**
- OPFS Vault is encrypted under a device-bound wrapping key (WebAuthn PRF or argon2id passphrase)
- WebAuthn option requires biometric/PIN authentication on the device to unlock the vault
- Vault auto-locks after idle timeout
- argon2id with `m=65536, t=3, p=4` makes brute-force attacks on the passphrase extremely slow
- FROST threshold signing means losing one device does not compromise group keys — threshold must be met

**v2 residual risk:** MEDIUM. Depends on vault unlock method and passphrase quality. WebAuthn (preferred) provides hardware-bound protection. Passphrase-derived protection depends on entropy.

---

### T9: FROST Share Compromise (Single Device)

**Severity:** LOW (new threat, not present in v1).

**v2 mitigation:**
- FROST threshold is 2-of-n by default. A single compromised `bfshare` is useless for forging signatures — the attacker needs to compromise at least `t` participants simultaneously.
- Share rotation allows invalidating a compromised share without changing the group public key.
- Each share is encrypted in OPFS Vault, so physical device access alone is not sufficient — the vault must also be unlocked.

**v2 residual risk:** LOW. An attacker who compromises multiple participants' devices simultaneously could forge group signatures. This requires a coordinated, targeted attack against multiple physical devices.

---

### T10: Social Engineering

**Severity:** MEDIUM. An attacker can attempt to trick a Guardian into signing a delegation event, approving a DVM job, or sharing their vault passphrase.

**v2 mitigation:**
- NIP-26 delegation events are cryptographically scoped — a tricked delegation can only grant the specific kinds in the conditions string
- Agent spend policies cap the damage from a tricked auto-pay
- FROST threshold means a single tricked Guardian cannot sign alone — requires compromising the threshold count
- No recovery mechanisms that bypass the Principal's consent (no "forgot password" server reset)

**v2 residual risk:** MEDIUM. Social engineering is a human problem, not a technical one. The system minimizes blast radius through scoped delegation and spend policies.

---

## Trust Assumptions

Satnam v2 makes the following trust assumptions. If these are violated, the security properties do not hold:

| Assumption | Implication if Violated |
|---|---|
| User's device is not already compromised by malware | Malware with OS-level access can read OPFS without going through the Web API |
| secp256k1 Schnorr signatures are not broken | All Nostr-based authentication and event verification fails |
| The user does not share their passphrase or WebAuthn device | Vault can be unlocked by anyone with the credential |
| At least one relay is honest (for multi-relay publication) | Censorship is possible but not forgery |
| FROST threshold assumption holds | At least `t-1` participants are not simultaneously compromised |

---

## What Satnam v2 Does NOT Protect Against

| Threat | Reason Outside Scope |
|---|---|
| OS-level compromise | Below the browser trust boundary |
| Physical coercion ("$5 wrench attack") | Human threat, not technical |
| Malicious browser extension with full-page access | Browser extension model supersedes web origin isolation |
| NIP-05 username squatting before migration | Registration race condition — first-come, first-served |
| Lightning routing privacy leaks | Inherent to Lightning Network (not specific to Satnam) |
| Cashu mint insolvency | Mint operator risk — mitigated by `allowed_mints` policy and sweep automation |
| Quantum computing attacks on secp256k1 | Long-term theoretical risk — not addressed in v2 |
