/**
 * @file ceps-auth-handler.test.ts
 * @description NIP-42 AUTH handler unit tests (fix-plan 10, Item A). The
 * handler is a PURE factory (createCepsAuthHandler) with an INJECTED
 * key-getter — the ceps-bindings DI pattern (plan 08 Amendment 2.0 F-3:
 * no vi.mock, no module-boundary mocks). REAL crypto
 * (generateSecretKey/getPublicKey/finalizeEvent/verifyEvent) per the
 * gift-wrap.test.ts pattern. NO relay connection of any kind: the pool
 * wiring (automaticallyAuth) is exercised only by the REAL-RELAY
 * integration run (nip46-ceps-bindings.integration.test.ts); this file
 * pins the signer behavior the wiring depends on.
 */

import { describe, it, expect } from 'vitest';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from 'nostr-tools';

import { createCepsAuthHandler } from '../../src/lib/ceps/central-event-publishing-service.js';

const RELAY_URL = 'wss://relay.example.com';
const CHALLENGE = 'challenge-1';

// Build the exact kind:22242 template nostr-tools' makeAuthEvent produces
// (verified in the installed package: lib/esm/abstract-relay.js, nip42.ts —
// kind 22242, relay + challenge tags, content "").
function makeAuthTemplate(): {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
} {
  return {
    kind: 22242,
    created_at: Math.floor(Date.now() / 1e3),
    tags: [
      ['relay', RELAY_URL],
      ['challenge', CHALLENGE],
    ],
    content: '',
  };
}

describe('createCepsAuthHandler (NIP-42 AUTH, fix-plan 10)', () => {
  it('returns null when there is no active session key (fail-closed: no signer attached)', () => {
    const handler = createCepsAuthHandler(() => null);
    expect(handler(RELAY_URL)).toBeNull();
  });

  it('returns a signer when a session key is active; the signed event is a VERIFIED kind:22242 auth event for that identity', async () => {
    const secret = generateSecretKey();
    const pubkey = getPublicKey(secret);
    const handler = createCepsAuthHandler(() => secret);

    const signer = handler(RELAY_URL);
    expect(signer).not.toBeNull();

    const authEvent = await signer!(makeAuthTemplate());
    expect(verifyEvent(authEvent)).toBe(true);
    expect(authEvent.kind).toBe(22242);
    expect(authEvent.content).toBe('');
    expect(authEvent.pubkey).toBe(pubkey);
    expect(authEvent.tags).toEqual([
      ['relay', RELAY_URL],
      ['challenge', CHALLENGE],
    ]);
  });

  it('signs with the CURRENT key at sign time (a re-initialized session signs with the new identity)', async () => {
    const first = generateSecretKey();
    const second = generateSecretKey();
    let current: Uint8Array | null = first;
    const handler = createCepsAuthHandler(() => current);

    const signer = handler(RELAY_URL);
    expect(signer).not.toBeNull();

    const firstEvent = await signer!(makeAuthTemplate());
    expect(firstEvent.pubkey).toBe(getPublicKey(first));

    // Simulate a re-initialized session: the SAME attached signer now signs
    // with the new session key (activeNsecBytes is read at sign time).
    current = second;
    const secondEvent = await signer!(makeAuthTemplate());
    expect(secondEvent.pubkey).toBe(getPublicKey(second));
  });

  it('a destroyed session (key getter returns null at sign time) makes the signer reject fail-closed', async () => {
    const secret = generateSecretKey();
    let current: Uint8Array | null = secret;
    const handler = createCepsAuthHandler(() => current);

    const signer = handler(RELAY_URL);
    expect(signer).not.toBeNull();

    current = null; // destroySession zeroed and cleared the key
    await expect(signer!(makeAuthTemplate())).rejects.toThrow(
      '[CEPS] NIP-42 AUTH: no active session key',
    );
  });
});