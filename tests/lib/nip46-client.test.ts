/**
 * @file nip46-client.test.ts
 * @description REAL NIP-44 v2 cipher tests for the laptop-side NIP-46 client
 * (src/lib/nip46/client.ts) — SEC-006 standing-condition migration. These are
 * REAL crypto tests: real generated keys, the real nip44.v2 primitives from
 * nostr-tools (verified in-repo pattern: tests/messaging/gift-wrap.test.ts).
 * No mocks for the cipher. No relay connection (WP-2 non-negotiable 8).
 */

import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';

import {
  processSignEvent,
  encryptRequest,
  decryptResponse,
  DEFAULT_PRESENCE_TIMEOUT_MS,
} from '../../src/lib/nip46/client.js';
import type { Nip46PairingState } from '../../src/lib/vault/types.js';

// Real keys (CSPRNG): the client's ephemeral keypair + the bunker's identity.
const CLIENT_SECRET = generateSecretKey();
const BUNKER_SECRET = generateSecretKey();
const CLIENT_PUB = getPublicKey(CLIENT_SECRET);
const BUNKER_PUB = getPublicKey(BUNKER_SECRET);

function makePairing(overrides: Partial<Nip46PairingState> = {}): Nip46PairingState {
  return {
    ephemeralPubkey: CLIENT_PUB,
    ephemeralSecretKey: CLIENT_SECRET,
    remotePubkey: BUNKER_PUB,
    establishedAt: '2026-09-05T00:00:00.000Z',
    relays: ['wss://relay.example.com'],
    ...overrides,
  };
}

const REQUEST = { id: 'req-1', method: 'sign_event', params: [{ kind: 1, tags: [], content: 'x', created_at: 1 }] };

describe('real NIP-44 v2 cipher (SEC-006 migration)', () => {
  it('encryptRequest produces real NIP-44 ciphertext that round-trips with the conversation key', async () => {
    const pairing = makePairing();
    const ciphertext = await encryptRequest(REQUEST, pairing);

    // Ciphertext, not plaintext: the wire content must not leak the request.
    expect(ciphertext).not.toContain('sign_event');
    expect(ciphertext).not.toContain(JSON.stringify(REQUEST));

    // Round-trip with the REAL conversation key (ECDH of the paired session keys).
    const conversationKey = nip44.v2.utils.getConversationKey(CLIENT_SECRET, BUNKER_PUB);
    const plaintext = nip44.v2.decrypt(ciphertext, conversationKey);
    expect(JSON.parse(plaintext)).toEqual(REQUEST);
  });

  it('decryptResponse round-trips a response encrypted under the conversation key', async () => {
    const pairing = makePairing();
    const conversationKey = nip44.v2.utils.getConversationKey(CLIENT_SECRET, BUNKER_PUB);
    const envelope = { id: 'req-1', result: JSON.stringify({ kind: 1, tags: [], content: 'y', created_at: 2, pubkey: CLIENT_PUB, id: 'evt', sig: 'sig' }), error: null };
    const response = { id: 'req-1', pubkey: BUNKER_PUB, kind: 24133, tags: [['p', CLIENT_PUB]], content: nip44.v2.encrypt(JSON.stringify(envelope), conversationKey) };

    const decrypted = await decryptResponse(response, pairing);
    expect(decrypted.id).toBe('req-1');
    expect(decrypted.error).toBeNull();
    expect(JSON.parse(decrypted.result as string).kind).toBe(1);
  });

  it('wrong conversation key FAILS to decrypt (real cipher authentication) — SEC-006', async () => {
    const pairing = makePairing();
    const ciphertext = await encryptRequest(REQUEST, pairing);

    // A DIFFERENT client ephemeral secret (different pairing) must not decrypt.
    const otherSecret = generateSecretKey();
    const otherPairing = makePairing({ ephemeralSecretKey: otherSecret });
    await expect(decryptResponse({ content: ciphertext }, otherPairing)).rejects.toThrow();
  });

  it('processSignEvent publishes the REAL ciphertext in the request event content (no discard)', async () => {
    const pairing = makePairing();
    const captured: unknown[] = [];
    const publisher = async (event: unknown): Promise<unknown> => {
      captured.push(event);
      return event;
    };

    // The awaitResponse stub (parent-integration boundary) returns content:'' —
    // real NIP-44 decryption rejects it, so processSignEvent REJECTS at the
    // decrypt boundary. The publish capture is verified BEFORE that rejection:
    // this test pins both the real ciphertext wiring AND the documented gap.
    await expect(
      processSignEvent(
        { kind: 1, tags: [], content: 'z', created_at: 3, pubkey: CLIENT_PUB },
        pairing,
        {} as never, // vault: retained-but-unused (docblock)
        publisher,
        undefined,
        undefined,
        BUNKER_PUB,
      ),
    ).rejects.toThrow();

    expect(captured).toHaveLength(1);
    const published = captured[0] as { pubkey: string; content: string; kind: number; tags: string[][] };
    // Author is the client's OWN ephemeral pubkey (F-1 recommended semantics).
    expect(published.pubkey).toBe(CLIENT_PUB);
    expect(published.kind).toBe(24133);
    expect(published.tags).toEqual([['p', BUNKER_PUB]]);
    // The content is REAL ciphertext that decrypts to the request under the
    // conversation key — no placeholder, no empty content.
    const conversationKey = nip44.v2.utils.getConversationKey(CLIENT_SECRET, BUNKER_PUB);
    const decrypted = JSON.parse(nip44.v2.decrypt(published.content, conversationKey)) as { id: string; method: string };
    expect(decrypted.id).toBeTypeOf('string');
    expect(decrypted.method).toBe('sign_event');
  });
});