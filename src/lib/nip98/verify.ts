/**
 * @module nip98/verify
 * @description NIP-98 HTTP Authentication verification middleware.
 *
 * NIP-98 replaces JWT for all authenticated requests to Netlify functions in
 * Satnam v2. There is no JWT in v2 — NIP-98 is per-request authentication
 * bound to the exact URL and HTTP method.
 *
 * ## Verification Steps (per SPECIFICATION.md §3.2)
 *
 * 1. Extract `Authorization` header — must be `Nostr <base64>` scheme.
 * 2. Base64-decode the event JSON.
 * 3. Validate structural requirements:
 *    - `kind === 27235`
 *    - `created_at` within ±60 seconds of server time
 *    - `u` tag matches the request URL exactly
 *    - `method` tag matches the HTTP method (case-insensitive)
 *    - `payload` tag (for POST/PUT/PATCH) matches SHA-256 of request body
 * 4. Verify Schnorr signature using @noble/curves secp256k1.
 * 5. Check for NIP-26 delegation tag and verify if present.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/98.md
 * @see SPECIFICATION.md §3 — Auth System
 */

import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { getEventHash } from 'nostr-tools';

// ---------------------------------------------------------------------------
// Auth Result Types
// ---------------------------------------------------------------------------

/**
 * Successful authentication outcome. The Principal is authenticated as `pubkey`.
 * If NIP-26 delegation is present and valid, `delegatedBy` contains the
 * delegator's pubkey and the `delegationConditions` string.
 */
export interface AuthResult {
  readonly authenticated: true;
  /** Hex-encoded secp256k1 pubkey of the event signer. */
  readonly pubkey: string;
  /**
   * Hex-encoded pubkey of the delegator, if the event includes a valid
   * NIP-26 delegation tag and the delegation is verified.
   */
  readonly delegatedBy?: string;
  /**
   * NIP-26 conditions string from the delegation tag, if delegation is present.
   * Format: `kind=<n>&kind=<m>&created_at<timestamp`
   */
  readonly delegationConditions?: string;
}

/**
 * Failed authentication outcome with a typed reason code.
 * No key material or internal paths are included in the reason.
 */
export interface AuthError {
  readonly authenticated: false;
  readonly reason:
    | 'missing_header'
    | 'invalid_scheme'
    | 'decode_failed'
    | 'wrong_kind'
    | 'expired'
    | 'url_mismatch'
    | 'method_mismatch'
    | 'payload_mismatch'
    | 'invalid_signature'
    | 'delegation_invalid';
}

/** Discriminated union of authentication outcomes. */
export type AuthOutcome = AuthResult | AuthError;

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/**
 * A Nostr event as parsed from the base64-encoded Authorization header.
 * @internal
 */
interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** NIP-98 auth event kind. */
const NIP98_KIND = 27235;

/** Maximum clock skew tolerance in seconds (±60s). */
const CLOCK_SKEW_TOLERANCE_S = 60;

/** NIP-26 delegation tag name. */
const DELEGATION_TAG = 'delegation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely decode a base64 string to a Uint8Array without throwing.
 * Returns null on failure.
 * @internal
 */
function safeBase64Decode(encoded: string): Uint8Array | null {
  try {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Find the value(s) of a named tag within a Nostr event's tags array.
 *
 * @param tags - Event tags array
 * @param name - Tag name to search for (e.g. 'u', 'method', 'payload')
 * @returns The first tag array matching the name, or null
 * @internal
 */
function findTag(tags: string[][], name: string): string[] | null {
  return tags.find((t) => t[0] === name) ?? null;
}

/**
 * Compute the SHA-256 hash of a request body as a lowercase hex string.
 *
 * @param body - Request body bytes
 * @returns Hex-encoded SHA-256 digest
 * @internal
 */
function hashBody(body: Uint8Array): string {
  return bytesToHex(sha256(body));
}

/**
 * Verify a NIP-26 delegation tag within an auth event.
 *
 * NIP-26 delegation tag format:
 * ```
 * ["delegation", "<delegator_pubkey>", "<conditions>", "<sig_over_token>"]
 * ```
 *
 * The signature covers the delegation token string:
 * `nostr:delegation:<delegatee_pubkey>:<conditions>`
 *
 * @param event - The auth event containing the delegation tag
 * @param delegationTag - The full delegation tag array
 * @returns Object with delegator pubkey and conditions, or null if invalid
 * @internal
 */
function verifyDelegationTag(
  event: NostrEvent,
  delegationTag: string[],
): { delegatorPubkey: string; conditions: string } | null {
  // Tag structure: ["delegation", delegatorPubkey, conditions, sig]
  if (delegationTag.length < 4) return null;

  const delegatorPubkey = delegationTag[1];
  const conditions = delegationTag[2];
  const delegationSig = delegationTag[3];

  if (!delegatorPubkey || !conditions || !delegationSig) return null;

  // The token is: nostr:delegation:<delegatee_pubkey>:<conditions>
  const token = `nostr:delegation:${event.pubkey}:${conditions}`;
  const tokenHash = sha256(utf8ToBytes(token));

  // Verify the delegation signature
  try {
    const sigBytes = hexToBytes(delegationSig);
    const delegatorPubkeyBytes = hexToBytes(delegatorPubkey);
    const isValid = schnorr.verify(sigBytes, tokenHash, delegatorPubkeyBytes);
    if (!isValid) return null;
  } catch {
    return null;
  }

  // Verify that the event satisfies the delegation conditions
  if (!verifyEventSatisfiesConditions(event, conditions)) {
    return null;
  }

  return { delegatorPubkey, conditions };
}

/**
 * Verify that a Nostr event satisfies a NIP-26 conditions string.
 *
 * Conditions string format: `kind=N&kind=M&created_at<T&created_at>T2`
 *
 * Supported condition types:
 * - `kind=N` — event.kind must equal N
 * - `created_at<T` — event.created_at must be less than T
 * - `created_at>T` — event.created_at must be greater than T
 *
 * @param event - The event to check
 * @param conditions - NIP-26 conditions string
 * @internal
 */
function verifyEventSatisfiesConditions(event: NostrEvent, conditions: string): boolean {
  if (!conditions || conditions.trim() === '') return true;

  const parts = conditions.split('&');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('kind=')) {
      const allowedKind = parseInt(trimmed.slice('kind='.length), 10);
      if (isNaN(allowedKind) || event.kind !== allowedKind) return false;
    } else if (trimmed.startsWith('created_at<')) {
      const maxTs = parseInt(trimmed.slice('created_at<'.length), 10);
      if (isNaN(maxTs) || event.created_at >= maxTs) return false;
    } else if (trimmed.startsWith('created_at>')) {
      const minTs = parseInt(trimmed.slice('created_at>'.length), 10);
      if (isNaN(minTs) || event.created_at <= minTs) return false;
    }
    // Unknown condition types are treated as unsatisfied (strict mode)
    else {
      return false;
    }
  }

  return true;
}

/**
 * Verify the Schnorr signature on a Nostr event.
 *
 * Recomputes the event ID from the canonical serialization and verifies the
 * 64-byte Schnorr signature against the event's pubkey.
 *
 * @param event - The event to verify
 * @returns true if signature is valid
 * @internal
 */
function verifyEventSignature(event: NostrEvent): boolean {
  try {
    // Compute expected event ID from canonical serialization
    const expectedId = getEventHash(event);
    if (expectedId !== event.id) return false;

    // Verify Schnorr signature
    const sigBytes = hexToBytes(event.sig);
    const idBytes = hexToBytes(event.id);
    const pubkeyBytes = hexToBytes(event.pubkey);

    return schnorr.verify(sigBytes, idBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main Verification Function
// ---------------------------------------------------------------------------

/**
 * Verify a NIP-98 HTTP Authorization header.
 *
 * This function is designed for use in Netlify function context — it is
 * synchronous-compatible and makes no external network calls.
 *
 * @param authHeader - The full `Authorization` header value (e.g. `Nostr <base64>`)
 * @param requestUrl - The full request URL (must match the `u` tag exactly)
 * @param httpMethod - The HTTP method (e.g. `GET`, `POST`)
 * @param requestBody - Optional request body bytes (required for POST/PUT/PATCH with payload tag)
 * @returns AuthOutcome — either AuthResult (authenticated) or AuthError (rejected)
 *
 * @example
 * ```ts
 * const outcome = verifyNip98(
 *   req.headers.authorization,
 *   'https://satnam.pub/.netlify/functions/register-identity',
 *   'POST',
 *   new TextEncoder().encode(JSON.stringify(body))
 * );
 *
 * if (!outcome.authenticated) {
 *   return { statusCode: 401, body: JSON.stringify({ error: outcome.reason }) };
 * }
 *
 * // outcome.pubkey is the authenticated Principal's hex pubkey
 * ```
 *
 * @see SPECIFICATION.md §3.2 — Server-Side Verification
 * @see SPECIFICATION.md §3.3 — Auth Middleware Module
 */
export function verifyNip98(
  authHeader: string | undefined | null,
  requestUrl: string,
  httpMethod: string,
  requestBody?: Uint8Array,
): AuthOutcome {
  // Step 1: Validate header presence and scheme
  if (!authHeader || authHeader.trim() === '') {
    return { authenticated: false, reason: 'missing_header' };
  }

  const trimmed = authHeader.trim();
  if (!trimmed.startsWith('Nostr ')) {
    return { authenticated: false, reason: 'invalid_scheme' };
  }

  // Step 2: Base64-decode the event
  const base64Part = trimmed.slice('Nostr '.length).trim();
  const eventBytes = safeBase64Decode(base64Part);
  if (!eventBytes) {
    return { authenticated: false, reason: 'decode_failed' };
  }

  let event: NostrEvent;
  try {
    const eventJson = new TextDecoder().decode(eventBytes);
    event = JSON.parse(eventJson) as NostrEvent;
  } catch {
    return { authenticated: false, reason: 'decode_failed' };
  }

  // Step 3a: Validate kind
  if (event.kind !== NIP98_KIND) {
    return { authenticated: false, reason: 'wrong_kind' };
  }

  // Step 3b: Validate timestamp (±60 seconds)
  const now = Math.floor(Date.now() / 1000);
  const skew = Math.abs(event.created_at - now);
  if (skew > CLOCK_SKEW_TOLERANCE_S) {
    return { authenticated: false, reason: 'expired' };
  }

  // Step 3c: Validate URL tag
  const uTag = findTag(event.tags, 'u');
  if (!uTag || uTag[1] !== requestUrl) {
    return { authenticated: false, reason: 'url_mismatch' };
  }

  // Step 3d: Validate method tag
  const methodTag = findTag(event.tags, 'method');
  if (
    !methodTag ||
    methodTag[1]?.toUpperCase() !== httpMethod.toUpperCase()
  ) {
    return { authenticated: false, reason: 'method_mismatch' };
  }

  // Step 3e: Validate payload tag (only required/checked when body is provided and tag is present)
  const payloadTag = findTag(event.tags, 'payload');
  if (requestBody && requestBody.length > 0) {
    if (payloadTag) {
      const expectedHash = hashBody(requestBody);
      if (payloadTag[1] !== expectedHash) {
        return { authenticated: false, reason: 'payload_mismatch' };
      }
    }
    // If no payload tag but body is present, we allow it (tag is optional per NIP-98)
  } else if (payloadTag) {
    // Payload tag present but no body provided — validate against empty body
    const emptyHash = hashBody(new Uint8Array(0));
    if (payloadTag[1] !== emptyHash) {
      return { authenticated: false, reason: 'payload_mismatch' };
    }
  }

  // Step 4: Verify Schnorr signature
  if (!verifyEventSignature(event)) {
    return { authenticated: false, reason: 'invalid_signature' };
  }

  // Step 5: Check for NIP-26 delegation
  const delegationTag = findTag(event.tags, DELEGATION_TAG);
  if (delegationTag) {
    const delegationResult = verifyDelegationTag(event, delegationTag);
    if (!delegationResult) {
      return { authenticated: false, reason: 'delegation_invalid' };
    }
    return {
      authenticated: true,
      pubkey: event.pubkey,
      delegatedBy: delegationResult.delegatorPubkey,
      delegationConditions: delegationResult.conditions,
    };
  }

  // Successful authentication (no delegation)
  return {
    authenticated: true,
    pubkey: event.pubkey,
  };
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type { NostrEvent as Nip98Event };
