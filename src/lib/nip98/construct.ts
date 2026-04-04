/**
 * @module nip98/construct
 * @description Client-side construction and signing of NIP-98 HTTP auth events.
 *
 * Constructs the kind:27235 auth event that the client sends in the
 * `Authorization: Nostr <base64>` header for every authenticated API request.
 *
 * The event structure per SPECIFICATION.md §3.1:
 * ```json
 * {
 *   "kind": 27235,
 *   "created_at": <unix_timestamp>,
 *   "tags": [
 *     ["u", "<target_url>"],
 *     ["method", "<HTTP_METHOD>"],
 *     ["payload", "<sha256_of_body>"]  // only for POST/PUT/PATCH with body
 *   ],
 *   "content": ""
 * }
 * ```
 *
 * The signed event is base64-encoded and prepended with "Nostr " to form
 * the Authorization header value.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/98.md
 * @see SPECIFICATION.md §3.1 — Client-Side Auth Flow
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import * as nt from 'nostr-tools';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** NIP-98 auth event kind. */
const NIP98_KIND = 27235;

/**
 * HTTP methods that require a payload tag (body hash) when a body is present.
 */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Encode bytes to standard base64 string (not URL-safe).
 * @internal
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary);
}

/**
 * Compute SHA-256 hash of a request body.
 * @internal
 */
function hashBody(body: Uint8Array): string {
  return bytesToHex(sha256(body));
}

/**
 * Decode an nsec (bech32 "nsec1..." string) or raw hex secret key to a
 * 32-byte Uint8Array. Also accepts a pre-decoded Uint8Array passthrough.
 *
 * For bech32 nsec strings, decoding is performed using nostr-tools nip19.
 *
 * @param nsecOrHex - nsec bech32 string, hex string, or raw bytes
 * @returns 32-byte secret key bytes
 * @internal
 */
function decodeSecretKey(nsecOrHex: string | Uint8Array): Uint8Array {
  if (nsecOrHex instanceof Uint8Array) return nsecOrHex;

  // Try hex decode first (64 hex chars = 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(nsecOrHex)) {
    return hexToBytes(nsecOrHex);
  }

  // Try bech32 nsec decode using nostr-tools nip19
  if (nsecOrHex.startsWith('nsec1')) {
    // Import is resolved at module level in ESM — nostr-tools is a CJS-compatible package
    // Inline bech32 decode via nostr-tools nip19 (imported at top of file)
    const { nip19 } = nt;
    const decoded = nip19.decode(nsecOrHex);
    if (decoded.type !== 'nsec') {
      throw new Error('Expected nsec bech32 string');
    }
    return decoded.data as Uint8Array;
  }

  throw new Error('Invalid secret key format: expected nsec bech32, 64-char hex, or Uint8Array');
}

// ---------------------------------------------------------------------------
// Main Construction Function
// ---------------------------------------------------------------------------

/**
 * Construct and sign a NIP-98 HTTP auth event, returning a base64-encoded
 * signed event ready for use in the `Authorization` header.
 *
 * @param nsec - The signer's secret key: nsec bech32 string, hex string, or raw bytes
 * @param targetUrl - The exact URL being requested (must match server-side verification)
 * @param httpMethod - The HTTP method (e.g. 'GET', 'POST', 'PUT')
 * @param requestBody - Optional request body bytes. If provided and method is
 *                      POST/PUT/PATCH, a `payload` tag with SHA-256 body hash is added.
 * @returns Base64-encoded signed event JSON (use as: `Authorization: Nostr <returned_value>`)
 *
 * @example
 * ```ts
 * const body = new TextEncoder().encode(JSON.stringify({ username: 'alice' }));
 * const token = constructNip98Event(myNsec, 'https://satnam.pub/.netlify/functions/register-identity', 'POST', body);
 * const response = await fetch(url, {
 *   method: 'POST',
 *   headers: {
 *     'Authorization': `Nostr ${token}`,
 *     'Content-Type': 'application/json',
 *   },
 *   body,
 * });
 * ```
 *
 * @see SPECIFICATION.md §3.1 — Client-Side Auth Flow
 */
export function constructNip98Event(
  nsec: string | Uint8Array,
  targetUrl: string,
  httpMethod: string,
  requestBody?: Uint8Array,
): string {
  const secretKey = decodeSecretKey(nsec);

  // Build tags
  const tags: string[][] = [
    ['u', targetUrl],
    ['method', httpMethod.toUpperCase()],
  ];

  // Add payload tag for body methods when body is present
  const upperMethod = httpMethod.toUpperCase();
  if (BODY_METHODS.has(upperMethod) && requestBody && requestBody.length > 0) {
    tags.push(['payload', hashBody(requestBody)]);
  }

  // Construct the unsigned event
  const unsignedEvent = {
    kind: NIP98_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  };

  // Sign the event using nostr-tools (which uses @noble/curves internally)
  const signedEvent = finalizeEvent(unsignedEvent, secretKey);

  // Serialize to JSON and base64-encode
  const eventJson = JSON.stringify(signedEvent);
  const eventBytes = new TextEncoder().encode(eventJson);
  return toBase64(eventBytes);
}

/**
 * Build the full Authorization header value for a NIP-98 request.
 * Convenience wrapper around constructNip98Event().
 *
 * @param nsec - The signer's secret key
 * @param targetUrl - The exact URL being requested
 * @param httpMethod - The HTTP method
 * @param requestBody - Optional request body bytes
 * @returns Full `Authorization` header value: `Nostr <base64>`
 *
 * @example
 * ```ts
 * const headers = {
 *   'Authorization': buildNip98AuthHeader(nsec, url, 'POST', body),
 *   'Content-Type': 'application/json',
 * };
 * ```
 */
export function buildNip98AuthHeader(
  nsec: string | Uint8Array,
  targetUrl: string,
  httpMethod: string,
  requestBody?: Uint8Array,
): string {
  const token = constructNip98Event(nsec, targetUrl, httpMethod, requestBody);
  return `Nostr ${token}`;
}

/**
 * Get the hex-encoded public key corresponding to a secret key.
 * Convenience wrapper for use in auth flows.
 *
 * @param nsec - The signer's secret key: nsec bech32, hex, or raw bytes
 * @returns Hex-encoded secp256k1 public key
 */
export function getHexPubkey(nsec: string | Uint8Array): string {
  const secretKey = decodeSecretKey(nsec);
  return getPublicKey(secretKey);
}

/**
 * Compute the SHA-256 hash of a request body for manual payload tag
 * construction or verification. Exported for use in test utilities.
 *
 * @param body - Request body bytes
 * @returns Hex-encoded SHA-256 digest
 */
export function computePayloadHash(body: Uint8Array): string {
  return bytesToHex(sha256(body));
}
