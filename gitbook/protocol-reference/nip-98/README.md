# NIP-98: HTTP Authentication

NIP-98 is the sole authentication mechanism for all server-side functions in Satnam v2. There is no JWT, no `JWT_SECRET`, no `jsonwebtoken` package, and no session token of any kind. Every authenticated request carries a cryptographically signed proof of identity.

---

## How NIP-98 Replaces JWT

| Concern | JWT Approach | NIP-98 Approach |
|---|---|---|
| Identity proof | Server-issued token signed by `JWT_SECRET` | Client-signed Nostr event (secp256k1 Schnorr) |
| Credential storage | Token in `localStorage` or cookie | nsec in OPFS Vault — device-only |
| Replay protection | Expiry timestamp, refresh rotation | URL + method bound into each event; ±60s window |
| Token theft | Stolen token impersonates user | No token to steal — each request is independently signed |
| Server secret | `JWT_SECRET` must be guarded, rotated | No server secret — public-key cryptography |
| Delegation | Custom middleware or role claims in token | NIP-26 delegation tag on the auth event |

If the server is compromised, an attacker gains the ability to read public data and DoS the service — but cannot forge Nostr signatures or impersonate any user.

---

## Client-Side Auth Flow

For every request to an authenticated Netlify function:

**Step 1 — Construct the kind:27235 event**

```typescript
const authEvent = {
  kind: 27235,
  created_at: Math.floor(Date.now() / 1000),
  tags: [
    ["u", "https://satnam.pub/.netlify/functions/register-identity"],
    ["method", "POST"],
    // Only include "payload" for POST/PUT/PATCH requests:
    ["payload", bytesToHex(sha256(new TextEncoder().encode(requestBodyJson)))]
  ],
  content: ""
};
```

**Step 2 — Sign with the Principal's nsec**

The nsec is fetched from OPFS Vault (requires vault to be unlocked):

```typescript
import { finalizeEvent } from 'nostr-tools';
import { vault } from '../vault';

const nsec = await vault.getNsec(currentNpub);
const signedEvent = finalizeEvent(authEvent, nsec);
```

**Step 3 — Base64-encode and attach as Authorization header**

```typescript
const encoded = btoa(JSON.stringify(signedEvent));

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Nostr ${encoded}`
  },
  body: requestBodyJson
});
```

---

## Server-Side Verification

Every authenticated Netlify function calls `verifyNip98()` as its first action, before any business logic:

```typescript
// lib/auth/nip98-verify.ts — runs in Netlify function context
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

interface AuthResult {
  authenticated: true;
  pubkey: string;          // hex-encoded pubkey of the signer
  delegatedBy?: string;    // hex-encoded pubkey of the delegator (if NIP-26)
  delegationConditions?: string;
}

interface AuthError {
  authenticated: false;
  reason: 'missing_header' | 'invalid_scheme' | 'decode_failed' |
          'wrong_kind' | 'expired' | 'url_mismatch' | 'method_mismatch' |
          'payload_mismatch' | 'invalid_signature' | 'delegation_invalid';
}

export function verifyNip98(
  authHeader: string,
  requestUrl: string,
  httpMethod: string,
  requestBody?: Uint8Array
): AuthResult | AuthError { /* ... */ }
```

**Verification steps (in order):**

1. **Header format** — must start with `Nostr `. Returns `missing_header` or `invalid_scheme` otherwise.
2. **Base64 decode** — decodes the event JSON. Returns `decode_failed` on malformed input.
3. **Kind check** — `event.kind` must equal `27235`. Returns `wrong_kind` otherwise.
4. **Timestamp check** — `event.created_at` must be within ±60 seconds of server time. Returns `expired` otherwise.
5. **URL match** — the `u` tag must match the exact request URL. Returns `url_mismatch` otherwise.
6. **Method match** — the `method` tag must match the HTTP method. Returns `method_mismatch` otherwise.
7. **Payload hash** — if a `payload` tag is present, SHA-256 of the request body must match. Returns `payload_mismatch` otherwise.
8. **Signature** — `schnorr.verify(event.sig, eventHash, event.pubkey)` must return `true`. Returns `invalid_signature` otherwise.
9. **NIP-26 delegation** — if the event has a `delegation` tag, the full delegation chain is verified (see [NIP-26 Delegation](../nip-26/README.md)).

---

## Replay Protection

NIP-98 provides multi-layer replay protection:

| Protection | Mechanism |
|---|---|
| Time window | `created_at` must be within ±60 seconds — stale auth events are rejected |
| URL binding | The `u` tag ties the auth event to a specific endpoint — an auth event for `/register` cannot be replayed against `/nwc-proxy` |
| Method binding | The `method` tag ties auth to a specific HTTP method — cannot promote GET to POST |
| Payload binding | For mutating requests, the `payload` tag ties auth to a specific request body — cannot change the payload after signing |

The combination of URL + method + payload binding means a captured NIP-98 auth header is useless outside its original request context and expires within 60 seconds.

---

## Code Examples

### Full authenticated POST (client side)

```typescript
import { finalizeEvent, getEventHash } from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { vault } from '../lib/vault';

async function authenticatedPost(
  url: string,
  body: object,
  npub: string
): Promise<Response> {
  const bodyJson = JSON.stringify(body);
  const bodyBytes = new TextEncoder().encode(bodyJson);
  const payloadHash = bytesToHex(sha256(bodyBytes));

  const authEvent = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", url],
      ["method", "POST"],
      ["payload", payloadHash]
    ],
    content: ""
  };

  const nsec = await vault.getNsec(npub);
  const signedEvent = finalizeEvent(authEvent, nsec);
  const encoded = btoa(JSON.stringify(signedEvent));

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Nostr ${encoded}`
    },
    body: bodyJson
  });
}
```

### Server verification (Netlify function)

```typescript
// netlify/functions/register-identity.ts
import type { Handler } from '@netlify/functions';
import { verifyNip98 } from '../../lib/auth/nip98-verify';

export const handler: Handler = async (event) => {
  const auth = verifyNip98(
    event.headers['authorization'] ?? '',
    `https://satnam.pub/.netlify/functions/register-identity`,
    event.httpMethod,
    event.body ? new TextEncoder().encode(event.body) : undefined
  );

  if (!auth.authenticated) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: auth.reason })
    };
  }

  // auth.pubkey is now the verified, authenticated identity
  const pubkey = auth.pubkey;

  // ... business logic ...
};
```

---

## Which Functions Use NIP-98

| Function | Auth Required | Notes |
|---|---|---|
| `nip05-resolver` | No | Public — reads NIP-05 mappings |
| `well-known-agent` | No | Public — reads agent profiles |
| `check-username` | No | Public — username availability |
| `register-identity` | **Yes** | Registers NIP-05 name + Lightning address |
| `nwc-proxy` | **Yes** | Proxies NWC relay connections |
| `simpleproof-anchor` | **Yes** | Anchors events via OpenTimestamps |
| `issuer-registry` | **Yes** (POST only) | Registers NIP-CA issuers; GET is public |
| `unified-comms` | **Yes** | Relays NIP-17 gift-wrapped messages |

Security invariant **S10** requires that every NIP-98-gated function calls `verifyNip98()` before executing any business logic. This is enforced in code review.
