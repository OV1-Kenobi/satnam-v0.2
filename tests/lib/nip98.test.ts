/**
 * @file nip98.test.ts
 * @description Unit tests for NIP-98 HTTP Authentication verification and construction.
 *
 * Tests use real @noble/curves Schnorr signing through nostr-tools, producing
 * cryptographically valid auth events that are fed into verifyNip98().
 *
 * Test cases:
 * 1. TC-01: Valid GET auth event is accepted
 * 2. TC-02: Valid POST auth event with payload hash is accepted
 * 3. TC-03: Missing Authorization header returns missing_header
 * 4. TC-04: Non-Nostr Authorization scheme returns invalid_scheme
 * 5. TC-05: Expired event (created_at > 60s ago) returns expired
 * 6. TC-06: Future event (created_at > 60s in future) returns expired
 * 7. TC-07: Wrong URL in u tag returns url_mismatch
 * 8. TC-08: Wrong method in method tag returns method_mismatch
 * 9. TC-09: Payload hash mismatch returns payload_mismatch
 * 10. TC-10: Invalid signature returns invalid_signature
 * 11. TC-11: NIP-26 delegation present and valid returns delegatedBy
 * 12. TC-12: NIP-26 delegation with invalid signature returns delegation_invalid
 * 13. TC-13: buildNip98AuthHeader produces valid header for round-trip
 * 14. TC-14: constructNip98Event produces a correctly-structured event
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import { verifyNip98 } from '../../src/lib/nip98/verify.js';
import { constructNip98Event, buildNip98AuthHeader, computePayloadHash } from '../../src/lib/nip98/construct.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const TARGET_URL = 'https://satnam.pub/.netlify/functions/register-identity';
const METHOD_POST = 'POST';
const METHOD_GET = 'GET';
const NIP98_KIND = 27235;

/** Build a valid base64-encoded NIP-98 auth event for testing. */
function buildValidAuthEvent(
  secretKey: Uint8Array,
  url: string,
  method: string,
  body?: Uint8Array,
  createdAtOffset = 0,
): string {
  const tags: string[][] = [
    ['u', url],
    ['method', method],
  ];

  if (body && body.length > 0 && ['POST', 'PUT', 'PATCH'].includes(method)) {
    tags.push(['payload', bytesToHex(sha256(body))]);
  }

  const event = finalizeEvent(
    {
      kind: NIP98_KIND,
      created_at: Math.floor(Date.now() / 1000) + createdAtOffset,
      tags,
      content: '',
    },
    secretKey,
  );

  const eventJson = JSON.stringify(event);
  const eventBytes = new TextEncoder().encode(eventJson);
  let binary = '';
  for (let i = 0; i < eventBytes.length; i++) {
    binary += String.fromCharCode(eventBytes[i] ?? 0);
  }
  return btoa(binary);
}

/** Helper to build the Authorization header string. */
function buildHeader(base64Event: string): string {
  return `Nostr ${base64Event}`;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('NIP-98 verifyNip98()', () => {
  let sk: Uint8Array;
  let pk: string;
  let delegatorSk: Uint8Array;
  let delegatorPk: string;

  beforeAll(() => {
    sk = generateSecretKey();
    pk = getPublicKey(sk);
    delegatorSk = generateSecretKey();
    delegatorPk = getPublicKey(delegatorSk);
  });

  // -------------------------------------------------------------------------
  // TC-01: Valid GET request
  // -------------------------------------------------------------------------
  it('TC-01: valid GET auth event is accepted', () => {
    const base64 = buildValidAuthEvent(sk, TARGET_URL, METHOD_GET);
    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(true);
    if (outcome.authenticated) {
      expect(outcome.pubkey).toBe(pk);
      expect(outcome.delegatedBy).toBeUndefined();
    }
  });

  // -------------------------------------------------------------------------
  // TC-02: Valid POST request with payload hash
  // -------------------------------------------------------------------------
  it('TC-02: valid POST auth event with payload hash is accepted', () => {
    const body = new TextEncoder().encode(JSON.stringify({ username: 'alice' }));
    const base64 = buildValidAuthEvent(sk, TARGET_URL, METHOD_POST, body);
    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_POST, body);
    expect(outcome.authenticated).toBe(true);
    if (outcome.authenticated) {
      expect(outcome.pubkey).toBe(pk);
    }
  });

  // -------------------------------------------------------------------------
  // TC-03: Missing Authorization header
  // -------------------------------------------------------------------------
  it('TC-03: missing Authorization header returns missing_header', () => {
    const outcome = verifyNip98(undefined, TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('missing_header');
    }
  });

  it('TC-03b: empty string Authorization header returns missing_header', () => {
    const outcome = verifyNip98('', TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('missing_header');
    }
  });

  // -------------------------------------------------------------------------
  // TC-04: Non-Nostr scheme
  // -------------------------------------------------------------------------
  it('TC-04: Bearer token scheme returns invalid_scheme', () => {
    const outcome = verifyNip98('Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig', TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('invalid_scheme');
    }
  });

  it('TC-04b: Basic auth scheme returns invalid_scheme', () => {
    const outcome = verifyNip98('Basic dXNlcjpwYXNz', TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('invalid_scheme');
    }
  });

  // -------------------------------------------------------------------------
  // TC-05: Expired event (too old)
  // -------------------------------------------------------------------------
  it('TC-05: event created 90 seconds ago returns expired', () => {
    const base64 = buildValidAuthEvent(sk, TARGET_URL, METHOD_GET, undefined, -90);
    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('expired');
    }
  });

  // -------------------------------------------------------------------------
  // TC-06: Future event (too far in future)
  // -------------------------------------------------------------------------
  it('TC-06: event created 90 seconds in the future returns expired', () => {
    const base64 = buildValidAuthEvent(sk, TARGET_URL, METHOD_GET, undefined, +90);
    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('expired');
    }
  });

  // -------------------------------------------------------------------------
  // TC-07: URL mismatch
  // -------------------------------------------------------------------------
  it('TC-07: u tag URL different from requestUrl returns url_mismatch', () => {
    const base64 = buildValidAuthEvent(sk, 'https://other.example.com/api', METHOD_GET);
    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('url_mismatch');
    }
  });

  it('TC-07b: URL with different query string returns url_mismatch', () => {
    const base64 = buildValidAuthEvent(sk, TARGET_URL + '?foo=bar', METHOD_GET);
    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('url_mismatch');
    }
  });

  // -------------------------------------------------------------------------
  // TC-08: Method mismatch
  // -------------------------------------------------------------------------
  it('TC-08: method tag GET but request is POST returns method_mismatch', () => {
    const base64 = buildValidAuthEvent(sk, TARGET_URL, METHOD_GET);
    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_POST);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('method_mismatch');
    }
  });

  it('TC-08b: method comparison is case-insensitive (post vs POST both pass)', () => {
    const base64 = buildValidAuthEvent(sk, TARGET_URL, 'post');
    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, 'POST');
    // finalizeEvent preserves the tag value; our verifier uppercases both sides
    // This will pass if the method tag value is 'POST' (we uppercase in buildValidAuthEvent)
    // Let's verify: buildValidAuthEvent passes method directly; verifier uppercases both
    // The event has ['method', 'post'] but we compare .toUpperCase() on both sides
    expect(outcome.authenticated).toBe(true);
  });

  // -------------------------------------------------------------------------
  // TC-09: Payload hash mismatch
  // -------------------------------------------------------------------------
  it('TC-09: payload tag mismatch returns payload_mismatch', () => {
    const body = new TextEncoder().encode('{"username":"alice"}');
    const tamperedBody = new TextEncoder().encode('{"username":"mallory"}');
    const base64 = buildValidAuthEvent(sk, TARGET_URL, METHOD_POST, body);
    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_POST, tamperedBody);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('payload_mismatch');
    }
  });

  // -------------------------------------------------------------------------
  // TC-10: Invalid signature
  // -------------------------------------------------------------------------
  it('TC-10: tampered event ID causes invalid_signature', () => {
    const base64 = buildValidAuthEvent(sk, TARGET_URL, METHOD_GET);
    const eventBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const eventJson = new TextDecoder().decode(eventBytes);
    const event = JSON.parse(eventJson) as { id: string; [k: string]: unknown };

    // Tamper the event ID
    event.id = 'deadbeef'.repeat(8);

    const tamperedJson = JSON.stringify(event);
    const tamperedBytes = new TextEncoder().encode(tamperedJson);
    let binary = '';
    for (let i = 0; i < tamperedBytes.length; i++) {
      binary += String.fromCharCode(tamperedBytes[i] ?? 0);
    }
    const tamperedBase64 = btoa(binary);

    const outcome = verifyNip98(buildHeader(tamperedBase64), TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('invalid_signature');
    }
  });

  it('TC-10b: wrong_kind for kind != 27235', () => {
    // Build a kind:1 event with NIP-98 tags
    const event = finalizeEvent(
      {
        kind: 1,  // wrong kind
        created_at: Math.floor(Date.now() / 1000),
        tags: [['u', TARGET_URL], ['method', METHOD_GET]],
        content: '',
      },
      sk,
    );
    const eventJson = JSON.stringify(event);
    const eventBytes = new TextEncoder().encode(eventJson);
    let binary = '';
    for (let i = 0; i < eventBytes.length; i++) {
      binary += String.fromCharCode(eventBytes[i] ?? 0);
    }
    const base64 = btoa(binary);

    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('wrong_kind');
    }
  });

  // -------------------------------------------------------------------------
  // TC-11: NIP-26 delegation — valid
  // -------------------------------------------------------------------------
  it('TC-11: valid NIP-26 delegation tag produces delegatedBy result', () => {
    // Create a delegation from delegatorSk → sk (pk is the delegatee)
    const conditions = `kind=${NIP98_KIND}&created_at<${Math.floor(Date.now() / 1000) + 3600}`;
    const token = `nostr:delegation:${pk}:${conditions}`;
    const tokenHash = sha256(utf8ToBytes(token));
    const delegationSig = schnorr.sign(tokenHash, delegatorSk);
    const delegationSigHex = bytesToHex(delegationSig);

    const event = finalizeEvent(
      {
        kind: NIP98_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['u', TARGET_URL],
          ['method', METHOD_GET],
          ['delegation', delegatorPk, conditions, delegationSigHex],
        ],
        content: '',
      },
      sk,
    );

    const eventJson = JSON.stringify(event);
    const eventBytes = new TextEncoder().encode(eventJson);
    let binary = '';
    for (let i = 0; i < eventBytes.length; i++) {
      binary += String.fromCharCode(eventBytes[i] ?? 0);
    }
    const base64 = btoa(binary);

    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(true);
    if (outcome.authenticated) {
      expect(outcome.pubkey).toBe(pk);
      expect(outcome.delegatedBy).toBe(delegatorPk);
      expect(outcome.delegationConditions).toBe(conditions);
    }
  });

  // -------------------------------------------------------------------------
  // TC-12: NIP-26 delegation — invalid signature
  // -------------------------------------------------------------------------
  it('TC-12: NIP-26 delegation with tampered signature returns delegation_invalid', () => {
    const conditions = `kind=${NIP98_KIND}&created_at<${Math.floor(Date.now() / 1000) + 3600}`;
    const fakeSignature = 'ff'.repeat(64); // Invalid 64-byte signature

    const event = finalizeEvent(
      {
        kind: NIP98_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['u', TARGET_URL],
          ['method', METHOD_GET],
          ['delegation', delegatorPk, conditions, fakeSignature],
        ],
        content: '',
      },
      sk,
    );

    const eventJson = JSON.stringify(event);
    const eventBytes = new TextEncoder().encode(eventJson);
    let binary = '';
    for (let i = 0; i < eventBytes.length; i++) {
      binary += String.fromCharCode(eventBytes[i] ?? 0);
    }
    const base64 = btoa(binary);

    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('delegation_invalid');
    }
  });

  // -------------------------------------------------------------------------
  // TC-13: buildNip98AuthHeader round-trip
  // -------------------------------------------------------------------------
  it('TC-13: buildNip98AuthHeader produces a header that verifyNip98 accepts', () => {
    const authHeader = buildNip98AuthHeader(sk, TARGET_URL, METHOD_GET);
    expect(authHeader).toMatch(/^Nostr /);
    const outcome = verifyNip98(authHeader, TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(true);
    if (outcome.authenticated) {
      expect(outcome.pubkey).toBe(pk);
    }
  });

  it('TC-13b: buildNip98AuthHeader with POST body round-trip', () => {
    const body = new TextEncoder().encode('{"foo":"bar"}');
    const authHeader = buildNip98AuthHeader(sk, TARGET_URL, METHOD_POST, body);
    const outcome = verifyNip98(authHeader, TARGET_URL, METHOD_POST, body);
    expect(outcome.authenticated).toBe(true);
  });

  // -------------------------------------------------------------------------
  // TC-14: constructNip98Event structure validation
  // -------------------------------------------------------------------------
  it('TC-14: constructNip98Event includes correct tags', () => {
    const base64 = constructNip98Event(sk, TARGET_URL, METHOD_GET);
    const eventBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const event = JSON.parse(new TextDecoder().decode(eventBytes)) as {
      kind: number;
      tags: string[][];
      content: string;
      created_at: number;
    };

    expect(event.kind).toBe(NIP98_KIND);
    expect(event.content).toBe('');

    const uTag = event.tags.find((t) => t[0] === 'u');
    const methodTag = event.tags.find((t) => t[0] === 'method');
    expect(uTag?.[1]).toBe(TARGET_URL);
    expect(methodTag?.[1]).toBe('GET');
  });

  it('TC-14b: constructNip98Event for POST includes payload tag', () => {
    const body = new TextEncoder().encode('hello world');
    const expectedHash = computePayloadHash(body);

    const base64 = constructNip98Event(sk, TARGET_URL, METHOD_POST, body);
    const eventBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const event = JSON.parse(new TextDecoder().decode(eventBytes)) as {
      tags: string[][];
    };

    const payloadTag = event.tags.find((t) => t[0] === 'payload');
    expect(payloadTag?.[1]).toBe(expectedHash);
  });

  // -------------------------------------------------------------------------
  // TC-15: decode_failed for malformed base64
  // -------------------------------------------------------------------------
  it('TC-15: malformed base64 returns decode_failed', () => {
    const outcome = verifyNip98('Nostr not-valid-base64!!!', TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('decode_failed');
    }
  });

  // -------------------------------------------------------------------------
  // TC-16: NIP-26 expired delegation returns delegation_invalid
  // -------------------------------------------------------------------------
  it('TC-16: NIP-26 delegation with expired created_at condition returns delegation_invalid', () => {
    // Delegation expired 1 hour ago
    const pastExpiry = Math.floor(Date.now() / 1000) - 3600;
    const conditions = `kind=${NIP98_KIND}&created_at<${pastExpiry}`;
    const token = `nostr:delegation:${pk}:${conditions}`;
    const tokenHash = sha256(utf8ToBytes(token));
    const delegationSig = schnorr.sign(tokenHash, delegatorSk);
    const delegationSigHex = bytesToHex(delegationSig);

    const event = finalizeEvent(
      {
        kind: NIP98_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['u', TARGET_URL],
          ['method', METHOD_GET],
          ['delegation', delegatorPk, conditions, delegationSigHex],
        ],
        content: '',
      },
      sk,
    );

    const eventJson = JSON.stringify(event);
    const eventBytes = new TextEncoder().encode(eventJson);
    let binary = '';
    for (let i = 0; i < eventBytes.length; i++) {
      binary += String.fromCharCode(eventBytes[i] ?? 0);
    }
    const base64 = btoa(binary);

    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('delegation_invalid');
    }
  });

  // -------------------------------------------------------------------------
  // A-3 fix: payload tag REQUIRED for methods that carry bodies
  // -------------------------------------------------------------------------

  /** Build a valid bodied POST auth event WITHOUT a payload tag. */
  function buildBodiedPostWithoutPayloadTag(body: Uint8Array): string {
    const event = finalizeEvent(
      {
        kind: NIP98_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['u', TARGET_URL],
          ['method', METHOD_POST],
          // deliberately no ['payload', ...] tag
        ],
        content: '',
      },
      sk,
    );
    void body;
    const eventJson = JSON.stringify(event);
    const eventBytes = new TextEncoder().encode(eventJson);
    let binary = '';
    for (let i = 0; i < eventBytes.length; i++) {
      binary += String.fromCharCode(eventBytes[i] ?? 0);
    }
    return btoa(binary);
  }

  it('A-3: POST with a body but NO payload tag is REJECTED (payload_mismatch)', () => {
    const body = new TextEncoder().encode('{"username":"alice"}');
    const base64 = buildBodiedPostWithoutPayloadTag(body);
    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_POST, body);
    expect(outcome.authenticated).toBe(false);
    if (!outcome.authenticated) {
      expect(outcome.reason).toBe('payload_mismatch');
    }
  });

  it('A-3: GET without a body and without a payload tag is still accepted', () => {
    const base64 = buildValidAuthEvent(sk, TARGET_URL, METHOD_GET);
    const outcome = verifyNip98(buildHeader(base64), TARGET_URL, METHOD_GET);
    expect(outcome.authenticated).toBe(true);
  });

  it("A-3: Satnam's own builder still round-trips (construct sets payload for POST)", () => {
    const body = new TextEncoder().encode('{"foo":"bar"}');
    const authHeader = buildNip98AuthHeader(sk, TARGET_URL, METHOD_POST, body);
    const outcome = verifyNip98(authHeader, TARGET_URL, METHOD_POST, body);
    expect(outcome.authenticated).toBe(true);
  });
});
