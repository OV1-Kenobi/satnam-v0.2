/**
 * @module nip46/client
 * @description Laptop-side NIP-46 client (WP-2).
 *
 * Responsibilities per spec §3.4 / design note §1:
 * - Construct unsigned events e {kind, tags, content, created_at, pubkey} (in memory only)
 * - NIP-44 v2-encrypt {id, method: "sign_event", params: [e]} with conversation key
 *   and publish kind:24133 request
 * - Await response (with configurable timeout, default 30s per founder decision Q4)
 * - Validate response: id binding, author binding, shape (spec §3)
 * - NIP-44 v2-decrypt response and return signed event for caller to publish
 * - Client never touches secret keys: NO key-import or key-store call (spec §6)
 *
 * Client contract (absence-as-revoked): the client treats its permission as
 * revoked when any of:
 *   (a) latest observed presence event exists and does not include client pubkey;
 *   (b) presence event cannot be observed at all (no list or query channel fails);
 *   (c) subscription times out before any list arrives.
 * All three collapse to `permitted: false` — spec §3.1/§4 and design note §5.
 *
 * Secret hygiene: transient signing-key buffer is never accessed by this module.
 */

import type { VaultOps, Nip46PairingState } from '../vault/types.js';
import type { UnsignedEvent } from '../nip-ac/client.js';
import { nip44 } from 'nostr-tools';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default client-side absence-as-revoked window (founder decision Q4: 30 s). */
export const DEFAULT_PRESENCE_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Request/response handling
// ---------------------------------------------------------------------------

/**
 * Process a sign_event request through the full NIP-46 client pipeline:
 * encrypt request, publish, await response, validate, decrypt, return signed event.
 *
 * @param unsignedEvent - The event to sign (kind, tags, content, created_at, pubkey)
 * @param pairingState - The session's pairing state from the vault (caller provides)
 * @param vault - Retained for the future pairing-lookup/parent-integration flow; NOT used by this module's crypto (the conversation key comes from `pairingState`)
 * @param publisher - CEPS publish seam for kind:24133 requests
 * @param fetcher - Optional initial query seam for presence (caller binds CEPS list query)
 * @param subscriber - Optional subscription seam for kind:10003 presence (caller binds CEPS subscribe); the real CEPS binding is async — see Item 3
 * @param bunkerPubkey - The bunker's hex pubkey (expected author of response)
 * @param timeoutMs - Optional presence timeout override (default 30s)
 * @returns The signed event {id, sig, pubkey, kind, tags, content} for caller to publish
 */
export async function processSignEvent(
  unsignedEvent: UnsignedEvent,
  pairingState: Nip46PairingState,
  vault: VaultOps,
  publisher: (event: unknown) => Promise<unknown>,
  fetcher: (() => Promise<unknown>) | undefined,
  subscriber: ((onEvent: (event: unknown) => void) => Promise<(() => void)> | (() => void)) | undefined,
  bunkerPubkey: string,
  timeoutMs: number = DEFAULT_PRESENCE_TIMEOUT_MS,
): Promise<UnsignedEvent> {
  // 1. Construct unsigned request: {id, method, params}
  const requestId = generateRequestId();
  const unsignedRequest = {
    id: requestId,
    method: 'sign_event',
    params: [unsignedEvent],
  };

  // 2. NIP-44 v2-encrypt request with the conversation key (real cipher —
  // SEC-006 standing condition; placeholder involution removed).
  const ciphertext = await encryptRequest(unsignedRequest, pairingState);

  // 3. Publish kind:24133 request with the NIP-44 ciphertext in content
  const requestEvent = {
    id: requestId,
    pubkey: pairingState.ephemeralPubkey, // the client's OWN ephemeral pubkey (author — F-1 semantics)
    created_at: Math.floor(Date.now() / 1000),
    kind: 24133,
    tags: [['p', bunkerPubkey]], // bunker's pubkey as p tag
    content: ciphertext,
  };
  await publisher(requestEvent);

  // 4. Await response with presence-based absence-as-revoked semantics
  const response = await awaitResponse(
    requestId,
    pairingState,
    vault,
    fetcher,
    subscriber,
    bunkerPubkey,
    timeoutMs,
  );

  // 5. Validate response: id binding, author binding, shape
  validateResponse(response, requestId, bunkerPubkey);

  // 6. NIP-44 v2-decrypt response and return the validated envelope
  const responseEnvelope = await decryptResponse(response, pairingState);
  return responseEnvelope as unknown as UnsignedEvent;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Generate a short random hex string for use as a request id. */
function generateRequestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * NIP-44 v2-encrypt a request with the pairing's conversation key (SEC-006
 * standing condition: real cipher — the placeholder involution is removed).
 * Conversation key = ECDH of the paired session keys: the client's ephemeral
 * secret with the remote signer's pubkey (design note §1 step 4, §6).
 * Returns the ciphertext STRING placed in the kind:24133 event content.
 */
export async function encryptRequest(
  request: {
    id: string;
    method: string;
    params: unknown[];
  },
  pairing: Nip46PairingState,
): Promise<string> {
  const conversationKey = nip44.v2.utils.getConversationKey(
    pairing.ephemeralSecretKey,
    pairing.remotePubkey,
  );
  return nip44.v2.encrypt(JSON.stringify(request), conversationKey);
}

/**
 * Await NIP-44 v2 response with absence-as-revoked semantics.
 * Combines initial query, subscription window, and timeout handling.
 *
 * SEC-006/CEPS scope note: the kind:24133 response-wait is the
 * parent-integration milestone (fix-plan 08, Item 3 scope boundary); this
 * stub is replaced there, not here.
 */
async function awaitResponse(
  requestId: string,
  pairing: Nip46PairingState,
  _vault: VaultOps,
  _fetcher: (() => Promise<unknown>) | undefined,
  _subscriber: ((onEvent: (event: unknown) => void) => Promise<(() => void)> | (() => void)) | undefined,
  bunkerPubkey: string,
  _timeoutMs: number,
): Promise<unknown> {
  // For testability: this is a stub. Real impl would:
  // 1. Optionally perform initial presence query (fetcher)
  // 2. Start subscription (subscriber) with timeout guard
  // 3. Wait for response event matching requestId and author=bunkerPubkey
  // 4. Apply absence-as-revoked logic: no observation -> unobservable;
  //    list without client -> absent-from-latest-list;
  //    subscription timeout -> timeout
  // 5. Every exit path cleans up timer and subscription
  //
  // For now, return a mock response that tests can override.
  return {
    id: requestId,
    pubkey: bunkerPubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 24133,
    tags: [['p', pairing.remotePubkey]], // client's ephemeral pubkey as p tag
    content: '',
  };
}

/**
 * Validate NIP-46 response: id binding, author binding, shape.
 * Spec §3: response must have matching id, correct author (bunker pubkey),
 * and shape {id, result: signed_event_json, error: null}.
 */
function validateResponse(
  response: unknown,
  expectedId: string,
  expectedAuthor: string,
): void {
  const resp = response as {
    id: string;
    pubkey: string;
    kind: number;
    tags: string[][];
    content: string;
  };

  if (!resp || typeof resp !== 'object') {
    throw new Error('Invalid response: not an object');
  }
  if (resp.kind !== 24133) {
    throw new Error(`Expected kind:24133, got kind:${resp.kind}`);
  }
  if (resp.id !== expectedId) {
    throw new Error(`Response id mismatch: expected ${expectedId}, got ${resp.id}`);
  }
  if (resp.pubkey !== expectedAuthor) {
    throw new Error(
      `Response author mismatch: expected ${expectedAuthor}, got ${resp.pubkey}`,
    );
  }
}

/**
 * NIP-44 v2-decrypt a response with the pairing's conversation key and
 * validate the decrypted envelope shape {id, result, error} (spec §3).
 * The wire content is ciphertext and can NEVER be JSON-parsed before
 * decryption — the shape check moved here from validateResponse (the real
 * cipher makes the old pre-decryption parse impossible).
 */
export async function decryptResponse(
  response: unknown,
  pairing: Nip46PairingState,
): Promise<{ id: string; result: string | null; error: string | null }> {
  const resp = response as { content: string };
  const conversationKey = nip44.v2.utils.getConversationKey(
    pairing.ephemeralSecretKey,
    pairing.remotePubkey,
  );
  const plaintext = nip44.v2.decrypt(resp.content, conversationKey);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error('Response content is not valid JSON after decryption');
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    typeof (parsed as { id?: unknown }).id !== 'string' ||
    ((parsed as { result?: unknown }).result !== null &&
      typeof (parsed as { result?: unknown }).result !== 'string') ||
    ((parsed as { error?: unknown }).error !== null &&
      typeof (parsed as { error?: unknown }).error !== 'string')
  ) {
    throw new Error('Response content has invalid shape');
  }
  const envelope = parsed as { id: string; result: string | null; error: string | null };
  return envelope;
}