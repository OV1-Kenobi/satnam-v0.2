# Netlify Functions Reference

Satnam v2 operates exactly **8 serverless Netlify functions** (security invariant S9: ≤8). All authenticated functions call `verifyNip98()` before executing any business logic (invariant S10). No function has access to OPFS, nsec, FROST shares, or any key material.

---

## Function Index

| # | Function | Endpoint | Method | Auth | Purpose |
|---|---|---|---|---|---|
| 1 | `nip05-resolver` | `/.well-known/nostr.json` | GET | None | NIP-05 identifier resolution |
| 2 | `well-known-agent` | `/.well-known/agent.json` | GET | None | NIP-SA agent discovery |
| 3 | `check-username` | `/.netlify/functions/check-username` | GET | None | Username availability check |
| 4 | `register-identity` | `/.netlify/functions/register-identity` | POST | NIP-98 | NIP-05 + Lightning address registration |
| 5 | `nwc-proxy` | `/.netlify/functions/nwc-proxy` | POST | NIP-98 | NWC relay connection proxy |
| 6 | `simpleproof-anchor` | `/.netlify/functions/simpleproof-anchor` | POST | NIP-98 | OpenTimestamps Bitcoin anchoring |
| 7 | `issuer-registry` | `/.netlify/functions/issuer-registry` | GET / POST | GET: None, POST: NIP-98 | NIP-CA issuer discovery |
| 8 | `unified-comms` | `/.netlify/functions/unified-comms` | POST | NIP-98 | NIP-17 gift-wrapped message relay |

---

## Detailed Reference

### 1. `nip05-resolver`

**Endpoint:** `GET /.well-known/nostr.json?name=<username>`

**Auth:** None (public endpoint)

**Purpose:** Implements the NIP-05 identifier verification protocol. Resolves `username@satnam.pub` to the corresponding Nostr pubkey.

**Request:**
```
GET /.well-known/nostr.json?name=alice
```

**Response (200):**
```json
{
  "names": {
    "alice": "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
  },
  "relays": {
    "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d": [
      "wss://pylon.openagents.com",
      "wss://relay.satnam.pub"
    ]
  }
}
```

**Database query:** `SELECT npub FROM nip05_identifiers WHERE username = $1`

**Error responses:**
```json
{ "error": "name_not_found", "status": 404 }
```

---

### 2. `well-known-agent`

**Endpoint:** `GET /.well-known/agent.json?name=<agentUsername>`

**Auth:** None (public endpoint)

**Purpose:** Implements NIP-SA agent discovery. Reads the agent's kind:39200 profile from Pylon relay (cached with 5-minute TTL in memory) and serves it in the OpenAgents standard discovery format.

**Request:**
```
GET /.well-known/agent.json?name=research-bot-7
```

**Response (200):**
```json
{
  "name": "ResearchBot-7",
  "pubkey": "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  "about": "Researches market data and produces summaries",
  "capabilities": ["research", "summarization", "nip90-provider"],
  "autonomy_level": "bounded",
  "version": "2.0.0",
  "nip05": "research-bot-7@satnam.pub",
  "lud16": "research-bot-7@satnam.pub"
}
```

**Cache:** In-memory TTL cache (5 min). Relay fetch on cache miss.

---

### 3. `check-username`

**Endpoint:** `GET /.netlify/functions/check-username?username=<name>`

**Auth:** None (public endpoint)

**Purpose:** Checks whether a NIP-05 username is available for registration.

**Request:**
```
GET /.netlify/functions/check-username?username=alice
```

**Response (200):**
```json
{
  "username": "alice",
  "available": true
}
```

**Rate limiting:** 10 requests per IP per minute (via `rate_limits` table).

**Validation:** Username must match `/^[a-z0-9_\-\.]{3,32}$/`.

---

### 4. `register-identity`

**Endpoint:** `POST /.netlify/functions/register-identity`

**Auth:** NIP-98 required

**Purpose:** Registers a NIP-05 identifier and optional Lightning address for the authenticated pubkey.

**Request headers:**
```
Authorization: Nostr <base64-encoded-nip98-event>
Content-Type: application/json
```

**Request body:**
```json
{
  "username": "alice",
  "lud16": "alice@satnam.pub"
}
```

**Processing:**
1. `verifyNip98(authHeader, requestUrl, 'POST', sha256(body))` — validates signature, URL, method, payload hash
2. Extract `pubkey` from verified NIP-98 event
3. Validate username format and availability
4. Check reservation table (prevents TOCTOU race)
5. Insert into `nip05_identifiers` (username → pubkey)
6. Insert into `lightning_addresses` (lud16 → pubkey) if lud16 provided
7. Return success

**Response (201):**
```json
{
  "username": "alice",
  "npub": "npub1...",
  "nip05": "alice@satnam.pub",
  "lud16": "alice@satnam.pub"
}
```

**Error responses:**

| Status | Code | Reason |
|---|---|---|
| 401 | `unauthorized` | NIP-98 verification failed |
| 409 | `username_taken` | Username already registered |
| 422 | `invalid_username` | Format validation failed |
| 429 | `rate_limited` | Too many registration attempts |

---

### 5. `nwc-proxy`

**Endpoint:** `POST /.netlify/functions/nwc-proxy`

**Auth:** NIP-98 required

**Purpose:** Proxies NWC relay connections. The encrypted NWC request/response payloads pass through without decryption. The function validates the NIP-98 signature and forwards the NIP-44-encrypted event to the wallet relay.

**Design note:** This function never decrypts the NWC payload. The connection secret remains in the client's OPFS Vault. This proxy exists for clients behind restrictive firewalls that block direct WebSocket connections to wallet relays.

**Request body:**
```json
{
  "relayUrl": "wss://relay.getalby.com/v1",
  "event": { "...NIP-47 encrypted request event..." }
}
```

**Response (200):**
```json
{
  "event": { "...NIP-47 encrypted response event..." }
}
```

---

### 6. `simpleproof-anchor`

**Endpoint:** `POST /.netlify/functions/simpleproof-anchor`

**Auth:** NIP-98 required

**Purpose:** Anchors a Nostr event ID to the Bitcoin blockchain via OpenTimestamps (NIP-CA). The function constructs an OTS timestamp proof and returns the proof data.

**Request body:**
```json
{
  "eventId": "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
}
```

**Response (200):**
```json
{
  "eventId": "3bf0c63f...",
  "otsProof": "<base64-encoded OTS proof bytes>",
  "pendingAttestation": true,
  "bitcoinBlockEstimate": 875000
}
```

**Response (200 — confirmed):**
```json
{
  "eventId": "3bf0c63f...",
  "otsProof": "<base64-encoded OTS proof bytes>",
  "pendingAttestation": false,
  "bitcoinBlock": 874521,
  "bitcoinTxId": "abc123..."
}
```

---

### 7. `issuer-registry`

**Endpoints:**
- `GET /.netlify/functions/issuer-registry?issuerPubkey=<hex>` — public
- `POST /.netlify/functions/issuer-registry` — NIP-98 required

**Purpose:** NIP-CA issuer discovery. GET returns public issuer metadata. POST registers or updates an issuer record.

**GET Response (200):**
```json
{
  "pubkey": "3bf0c63f...",
  "name": "Satnam Certificate Authority",
  "domain": "satnam.pub",
  "registeredAt": 1700000000
}
```

**POST Request body:**
```json
{
  "name": "My Certificate Authority",
  "domain": "example.com",
  "description": "Issues attestations for verified skills"
}
```

---

### 8. `unified-comms`

**Endpoint:** `POST /.netlify/functions/unified-comms`

**Auth:** NIP-98 required

**Purpose:** Relays NIP-17 gift-wrapped encrypted messages. The function forwards the already-encrypted message event to configured relays. It never decrypts the content — the gift wrapping is opaque to the server.

**Request body:**
```json
{
  "giftWrappedEvent": { "kind": 1059, "...": "..." },
  "targetRelays": ["wss://relay.satnam.pub"]
}
```

**Response (200):**
```json
{
  "published": ["wss://relay.satnam.pub"],
  "failed": []
}
```

---

## NIP-98 Verification Flow

All authenticated functions use the shared `verifyNip98()` middleware from `netlify/lib/nip98-verify.ts`:

```typescript
// Called at the start of every authenticated function handler
const authResult = verifyNip98(
  event.headers['authorization'] ?? '',
  event.rawUrl,
  event.httpMethod,
  event.body ? Buffer.from(event.body) : undefined
);

if (!authResult.authenticated) {
  return {
    statusCode: 401,
    body: JSON.stringify({ error: authResult.reason }),
  };
}

// authResult.pubkey — the authenticated identity (hex pubkey)
const pubkey = authResult.pubkey;
```

The verification steps:
1. Extract and base64-decode the `Nostr <...>` Authorization header
2. Verify `kind === 27235`
3. Verify `created_at` is within ±60 seconds of server time
4. Verify the `u` tag matches the request URL exactly
5. Verify the `method` tag matches the HTTP method
6. Verify the `payload` tag (SHA-256 of body) if present
7. Verify the Schnorr signature with `@noble/curves/secp256k1`

---

## Rate Limiting

All functions enforce rate limits via the `rate_limits` Supabase table:

```typescript
interface RateLimit {
  key: string;       // IP address or pubkey
  endpoint: string;  // Function name
  count: number;     // Request count in current window
  windowStart: number; // Unix timestamp
}
```

Default limits:
| Endpoint | Limit | Window |
|---|---|---|
| `check-username` | 10 req | 1 minute per IP |
| `register-identity` | 5 req | 1 hour per pubkey |
| `nwc-proxy` | 100 req | 1 minute per pubkey |
| `simpleproof-anchor` | 10 req | 1 hour per pubkey |
| `unified-comms` | 60 req | 1 minute per pubkey |

Rate limit exceeded response:
```json
{
  "error": "rate_limited",
  "retryAfter": 47,
  "status": 429
}
```

---

## Standard Error Response Format

All functions return errors in this format:

```typescript
interface ErrorResponse {
  error: string;   // Machine-readable code
  message?: string; // Human-readable description (optional)
  status: number;  // HTTP status code (also in response.status)
  retryAfter?: number; // Seconds to wait (rate limiting only)
}
```

Common error codes:
- `unauthorized` — NIP-98 missing or invalid
- `rate_limited` — too many requests
- `not_found` — requested resource does not exist
- `invalid_input` — request body validation failed
- `internal_error` — unexpected server error (no details exposed)
