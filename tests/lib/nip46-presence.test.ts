/**
 * @file nip46-presence.test.ts
 * @description Unit tests for the WP-2 kind:10003 presence helpers
 * (src/lib/nip46/presence.ts) — bunker add/remove/republish semantics, the
 * one-p-tag-per-client replaceable-list encoding (founder decision 3a), the
 * client absence-as-revoked contract with the 30 s configurable timeout
 * (founder decision Q4), and the encrypted presence.json vault round-trip.
 *
 * All tests run against local fakes only — no relay connection, no CEPS, no
 * production activation (design note §7; WP-2 non-negotiable 8).
 *
 * Test groups:
 * 1. Presence.json vault round-trip (encrypted-entry seam composition)
 * 2. Bunker add/remove semantics (idempotent, authoritative vault list)
 * 3. kind:10003 projection (one p tag per client, replaceable newest-wins)
 * 4. Republish derives from the authoritative vault list
 * 5. Fail-closed format gates and malformed-entry handling
 * 6. Client absence-as-revoked: conditions (a)/(b)/(c), 30 s default pinned,
 *    configurable window, subscription cleanup
 */

import { describe, it, expect } from 'vitest';

import {
  addPresenceClient,
  removePresenceClient,
  readPresenceList,
  republishPresence,
  buildPresenceEvent,
  buildPresenceEventTags,
  classifyPresence,
  awaitPresenceVerdict,
  presenceClientsFromTags,
  Nip46PresenceError,
  NIP46_PRESENCE_KIND,
  DEFAULT_PRESENCE_TIMEOUT_MS,
  type Nip46PresenceCrypto,
  type Nip46PresenceStore,
  type Nip46PresenceObservation,
} from '../../src/lib/nip46/presence.js';

// ---------------------------------------------------------------------------
// Test Fixtures (synthetic — 64-char lowercase hex, no real keys)
// ---------------------------------------------------------------------------

const CLIENT_A = 'a'.repeat(64);
const CLIENT_B = 'b'.repeat(64);
const CLIENT_C = 'c'.repeat(64);
const BUNKER = 'd'.repeat(64);

/**
 * Fake crypto seam: a real (weak) involution cipher — XOR with a fixed key —
 * so the at-rest blob genuinely does not contain the plaintext, and a
 * decrypt of data that never passed through encrypt cannot recover it. This
 * proves the round-trip really composes encrypt -> save -> load -> decrypt.
 */
const XOR_KEY = Uint8Array.from({ length: 32 }, (_, i) => (0x5a ^ i) & 0xff);

function xorBytes(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    out[i] = data[i] ^ XOR_KEY[i % XOR_KEY.length];
  }
  return out;
}

function fakeCrypto(): Nip46PresenceCrypto & { encryptCalls: number; decryptCalls: number } {
  return {
    encryptCalls: 0,
    decryptCalls: 0,
    async encryptBytes(plaintext: Uint8Array): Promise<Uint8Array> {
      this.encryptCalls += 1;
      return xorBytes(plaintext);
    },
    async decryptBytes(data: Uint8Array): Promise<Uint8Array> {
      this.decryptCalls += 1;
      return xorBytes(data);
    },
  };
}

/** Fake persistence seam for the single encrypted presence.json entry. */
function fakeStore(initial: Uint8Array | null = null) {
  const state = { blob: initial, loads: 0, saves: 0 };
  return {
    get blob() {
      return state.blob;
    },
    get loads() {
      return state.loads;
    },
    get saves() {
      return state.saves;
    },
    async loadEncrypted(): Promise<Uint8Array | null> {
      state.loads += 1;
      return state.blob;
    },
    async saveEncrypted(data: Uint8Array): Promise<void> {
      state.saves += 1;
      state.blob = data;
    },
  };
}

function observationFromClients(clients: string[]): Nip46PresenceObservation {
  return { tags: clients.map((pubkey) => ['p', pubkey]) };
}

function expectPresenceError(fn: () => unknown, code: 'invalid-client-pubkey' | 'malformed-presence-entry'): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Nip46PresenceError);
  expect((thrown as Nip46PresenceError).code).toBe(code);
}

// ---------------------------------------------------------------------------
// 1. presence.json vault round-trip
// ---------------------------------------------------------------------------

describe('presence.json vault round-trip', () => {
  it('stores the entry encrypted and reads back the exact list', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();

    const afterAdd = await addPresenceClient(crypto, store, CLIENT_A);
    expect(afterAdd.clients).toEqual([CLIENT_A]);
    expect(crypto.encryptCalls).toBe(1);
    expect(store.saves).toBe(1);
    // The at-rest blob must NOT contain the plaintext JSON.
    const storedText = new TextDecoder().decode(store.blob as Uint8Array);
    expect(storedText).not.toContain(CLIENT_A);
    expect(storedText).not.toContain('clients');

    const readBack = await readPresenceList(crypto, store);
    expect(readBack).not.toBeNull();
    expect(readBack?.clients).toEqual([CLIENT_A]);
    expect(readBack?.updatedAt).toBe(afterAdd.updatedAt);
    expect(crypto.decryptCalls).toBe(1);
  });

  it('round-trips multiple clients and a removal through the same entry', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();

    await addPresenceClient(crypto, store, CLIENT_A);
    await addPresenceClient(crypto, store, CLIENT_B);
    await addPresenceClient(crypto, store, CLIENT_C);
    await removePresenceClient(crypto, store, CLIENT_B);

    const readBack = await readPresenceList(crypto, store);
    expect(readBack?.clients).toEqual([CLIENT_A, CLIENT_C]);
  });

  it('returns null for a bunker that never stored a presence entry', async () => {
    const readBack = await readPresenceList(fakeCrypto(), fakeStore());
    expect(readBack).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Bunker add/remove semantics (authoritative vault list)
// ---------------------------------------------------------------------------

describe('bunker add/remove semantics', () => {
  it('add on a never-stored store writes the first client', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();
    const list = await addPresenceClient(crypto, store, CLIENT_A);
    expect(list.clients).toEqual([CLIENT_A]);
    expect(new Date(list.updatedAt).toISOString()).toBe(list.updatedAt);
  });

  it('add is idempotent — no rewrite, no updatedAt bump', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();
    const first = await addPresenceClient(crypto, store, CLIENT_A);
    const savesAfterFirst = 1;

    const second = await addPresenceClient(crypto, store, CLIENT_A);
    expect(second).toEqual(first);
    expect(store.saves).toBe(savesAfterFirst);
  });

  it('remove deletes only the named client and refreshes updatedAt', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();
    await addPresenceClient(crypto, store, CLIENT_A);
    await addPresenceClient(crypto, store, CLIENT_B);

    const afterRemove = await removePresenceClient(crypto, store, CLIENT_A);
    expect(afterRemove.clients).toEqual([CLIENT_B]);
  });

  it('remove is idempotent — removing an absent client is a no-op', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();
    await addPresenceClient(crypto, store, CLIENT_A);
    const before = await readPresenceList(crypto, store);
    const savesBefore = 1;

    const after = await removePresenceClient(crypto, store, CLIENT_B);
    expect(after).toEqual(before);
    expect(store.saves).toBe(savesBefore);
  });

  it('remove on a never-stored store writes an empty list', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();
    const list = await removePresenceClient(crypto, store, CLIENT_A);
    expect(list.clients).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. kind:10003 projection — one p tag per client, replaceable newest-wins
// ---------------------------------------------------------------------------

describe('kind:10003 projection (founder decision 3a)', () => {
  it('emits exactly one p tag per permitted client and empty content', () => {
    const event = buildPresenceEvent([CLIENT_A, CLIENT_B, CLIENT_C], BUNKER);
    expect(event.kind).toBe(NIP46_PRESENCE_KIND);
    expect(NIP46_PRESENCE_KIND).toBe(10003);
    expect(event.pubkey).toBe(BUNKER);
    expect(event.content).toBe('');
    expect(event.tags).toEqual([
      ['p', CLIENT_A],
      ['p', CLIENT_B],
      ['p', CLIENT_C],
    ]);
  });

  it('collapses duplicate clients to a single p tag (one tag per client)', () => {
    const tags = buildPresenceEventTags([CLIENT_A, CLIENT_B, CLIENT_A, CLIENT_B]);
    expect(tags).toEqual([
      ['p', CLIENT_A],
      ['p', CLIENT_B],
    ]);
  });

  it('a later republish wins: same kind and publisher, later created_at', () => {
    const earlier = buildPresenceEvent([CLIENT_A], BUNKER, 1_000);
    const later = buildPresenceEvent([CLIENT_A, CLIENT_B], BUNKER, 2_000);
    // Replaceable identity: same kind + same publisher pubkey.
    expect(later.kind).toBe(earlier.kind);
    expect(later.pubkey).toBe(earlier.pubkey);
    expect(later.created_at).toBeGreaterThan(earlier.created_at);
    // The newer list is the one the projection now carries.
    expect(presenceClientsFromTags(later.tags)).toEqual([CLIENT_A, CLIENT_B]);
  });

  it('defaults created_at to now so each republish replaces the previous', () => {
    const before = Math.floor(Date.now() / 1000) - 1;
    const event = buildPresenceEvent([CLIENT_A], BUNKER);
    const after = Math.floor(Date.now() / 1000) + 1;
    expect(event.created_at).toBeGreaterThanOrEqual(before);
    expect(event.created_at).toBeLessThanOrEqual(after);
  });

  it('an empty permitted list yields a presence event with no p tags', () => {
    const event = buildPresenceEvent([], BUNKER);
    expect(event.tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Republish derives from the authoritative vault list
// ---------------------------------------------------------------------------

describe('republishPresence derives the projection from presence.json', () => {
  it('publishes the vault list as the kind:10003 p-tag projection', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();
    await addPresenceClient(crypto, store, CLIENT_A);
    await addPresenceClient(crypto, store, CLIENT_B);

    const published: unknown[] = [];
    const { list, event } = await republishPresence(crypto, store, async (template) => {
      published.push(template);
    }, BUNKER);

    expect(published).toHaveLength(1);
    expect(event.kind).toBe(10003);
    expect(event.pubkey).toBe(BUNKER);
    expect(presenceClientsFromTags(event.tags)).toEqual([CLIENT_A, CLIENT_B]);
    expect(list?.clients).toEqual([CLIENT_A, CLIENT_B]);
  });

  it('republishing after a removal drops the revoked client from the projection', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();
    await addPresenceClient(crypto, store, CLIENT_A);
    await addPresenceClient(crypto, store, CLIENT_B);
    await removePresenceClient(crypto, store, CLIENT_A);

    let projectedClients: string[] | null = null;
    await republishPresence(crypto, store, async (template) => {
      projectedClients = presenceClientsFromTags(template.tags);
    }, BUNKER);

    expect(projectedClients).toEqual([CLIENT_B]);
  });

  it('republish with no stored entry publishes an empty projection', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();
    const { list, event } = await republishPresence(crypto, store, async () => undefined, BUNKER);
    expect(list).toBeNull();
    expect(event.tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Fail-closed gates and malformed entries
// ---------------------------------------------------------------------------

describe('fail-closed format gates', () => {
  it('rejects invalid client pubkeys on add/remove with a typed error', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();

    const invalid = ['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), `g${'a'.repeat(63)}`, ''];
    for (const pubkey of invalid) {
      await expect(addPresenceClient(crypto, store, pubkey)).rejects.toBeInstanceOf(Nip46PresenceError);
      await expect(removePresenceClient(crypto, store, pubkey)).rejects.toBeInstanceOf(Nip46PresenceError);
    }
    expect(store.saves).toBe(0);
  });

  it('names the field in the error message without echoing the value', async () => {
    try {
      await addPresenceClient(fakeCrypto(), fakeStore(), 'nothex');
      expect.fail('expected Nip46PresenceError');
    } catch (error) {
      expect((error as Nip46PresenceError).message).toContain('clientPubkey');
      expect((error as Nip46PresenceError).message).not.toContain('nothex');
    }
  });

  it('rejects an invalid bunker pubkey when building the event', () => {
    expectPresenceError(() => buildPresenceEvent([CLIENT_A], 'short'), 'invalid-client-pubkey');
  });

  it('rejects a malformed decrypted entry instead of silently reading empty', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();
    await store.saveEncrypted(await crypto.encryptBytes(new TextEncoder().encode('{not json')));
    await expect(readPresenceList(crypto, store)).rejects.toMatchObject({
      code: 'malformed-presence-entry',
    });

    const notAnObject = await crypto.encryptBytes(new TextEncoder().encode('"just a string"'));
    const store2 = fakeStore(notAnObject);
    await expect(readPresenceList(crypto, store2)).rejects.toMatchObject({
      code: 'malformed-presence-entry',
    });
  });

  it('rejects a decrypted entry with a wrong-shaped clients array', async () => {
    const crypto = fakeCrypto();
    const badClients = await crypto.encryptBytes(
      new TextEncoder().encode(JSON.stringify({ clients: [42], updatedAt: '2026-09-03T00:00:00.000Z' })),
    );
    await expect(readPresenceList(crypto, fakeStore(badClients))).rejects.toMatchObject({
      code: 'malformed-presence-entry',
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Client absence-as-revoked (design §5 conditions a/b/c)
// ---------------------------------------------------------------------------

describe('classifyPresence (pure)', () => {
  it('condition (a): latest list without the client is revoked', () => {
    const result = classifyPresence(observationFromClients([CLIENT_A, CLIENT_B]), CLIENT_C);
    expect(result).toEqual({ permitted: false, reason: 'absent-from-latest-list', clients: null });
  });

  it('latest list containing the client is permitted', () => {
    const result = classifyPresence(observationFromClients([CLIENT_A, CLIENT_C]), CLIENT_C);
    expect(result).toEqual({ permitted: true, clients: [CLIENT_A, CLIENT_C] });
  });

  it('condition (b): no observation at all is revoked (unobservable)', () => {
    expect(classifyPresence(null, CLIENT_A)).toEqual({
      permitted: false,
      reason: 'unobservable',
      clients: null,
    });
    expect(classifyPresence(undefined, CLIENT_A)).toEqual({
      permitted: false,
      reason: 'unobservable',
      clients: null,
    });
  });
});

describe('awaitPresenceVerdict (absence-as-revoked window)', () => {
  it('permitted when the initial query returns a list containing the client', async () => {
    const result = await awaitPresenceVerdict({
      clientPubkey: CLIENT_A,
      fetchLatestPresence: async () => observationFromClients([CLIENT_A]),
    });
    expect(result.permitted).toBe(true);
  });

  it('condition (a): revoked immediately when the queried list lacks the client', async () => {
    const result = await awaitPresenceVerdict({
      clientPubkey: CLIENT_C,
      timeoutMs: 5_000,
      fetchLatestPresence: async () => observationFromClients([CLIENT_A, CLIENT_B]),
    });
    expect(result).toEqual({ permitted: false, reason: 'absent-from-latest-list', clients: null });
  });

  it('condition (b): a failing query channel revokes immediately as unobservable', async () => {
    const result = await awaitPresenceVerdict({
      clientPubkey: CLIENT_A,
      timeoutMs: 5_000,
      fetchLatestPresence: async () => {
        throw new Error('relay unreachable');
      },
    });
    expect(result).toEqual({ permitted: false, reason: 'unobservable', clients: null });
  });

  it('condition (c): subscription-only silence within the window revokes as timeout', async () => {
    const result = await awaitPresenceVerdict({
      clientPubkey: CLIENT_A,
      timeoutMs: 40,
      subscribe: () => () => undefined,
    });
    expect(result).toEqual({ permitted: false, reason: 'timeout', clients: null });
  });

  it('condition (b): a definitive null list observed, then a silent window, ends as unobservable', async () => {
    const result = await awaitPresenceVerdict({
      clientPubkey: CLIENT_A,
      timeoutMs: 40,
      fetchLatestPresence: async () => null,
    });
    expect(result).toEqual({ permitted: false, reason: 'unobservable', clients: null });
  });

  it('a subscription event arriving within the window decides the verdict (permitted)', async () => {
    const result = await awaitPresenceVerdict({
      clientPubkey: CLIENT_A,
      timeoutMs: 5_000,
      subscribe: (onEvent) => {
        onEvent(observationFromClients([CLIENT_A]));
        return () => undefined;
      },
    });
    expect(result).toEqual({ permitted: true, clients: [CLIENT_A] });
  });

  it('a subscription event within the window can also revoke (absent)', async () => {
    const result = await awaitPresenceVerdict({
      clientPubkey: CLIENT_C,
      timeoutMs: 5_000,
      subscribe: (onEvent) => {
        onEvent(observationFromClients([CLIENT_A]));
        return () => undefined;
      },
    });
    expect(result).toEqual({ permitted: false, reason: 'absent-from-latest-list', clients: null });
  });

  it('a pending query that never resolves still ends as timeout at window expiry', async () => {
    const result = await awaitPresenceVerdict({
      clientPubkey: CLIENT_A,
      timeoutMs: 40,
      fetchLatestPresence: () => new Promise(() => undefined),
    });
    expect(result).toEqual({ permitted: false, reason: 'timeout', clients: null });
  });

  it('two-sided removal: the client verdict flips to revoked after the bunker removes and republishes', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();
    await addPresenceClient(crypto, store, CLIENT_A);

    // Client query seam bound to the authoritative vault list (the bunker
    // slice wires CEPS here in production; the fake mirrors the shape).
    const queryLatest = async (): Promise<Nip46PresenceObservation | null> => {
      const list = await readPresenceList(crypto, store);
      if (list === null) {
        return null;
      }
      return observationFromClients(list.clients);
    };

    const before = await awaitPresenceVerdict({
      clientPubkey: CLIENT_A,
      timeoutMs: 5_000,
      fetchLatestPresence: queryLatest,
    });
    expect(before).toEqual({ permitted: true, clients: [CLIENT_A] });

    // Bunker removes the client and republishes — the projection no longer
    // shows it (an empty permitted list still republishes a p-tag-less event).
    await removePresenceClient(crypto, store, CLIENT_A);
    await republishPresence(crypto, store, async () => undefined, BUNKER);

    const after = await awaitPresenceVerdict({
      clientPubkey: CLIENT_A,
      timeoutMs: 5_000,
      fetchLatestPresence: queryLatest,
    });
    expect(after).toEqual({ permitted: false, reason: 'absent-from-latest-list', clients: null });
  });

  it('cleans up the subscription on the timeout exit path', async () => {
    let unsubscribed = 0;
    await awaitPresenceVerdict({
      clientPubkey: CLIENT_A,
      timeoutMs: 30,
      subscribe: () => () => {
        unsubscribed += 1;
      },
    });
    expect(unsubscribed).toBe(1);
  });

  it('cleans up the subscription on the positive (event) exit path', async () => {
    let unsubscribed = 0;
    await awaitPresenceVerdict({
      clientPubkey: CLIENT_A,
      timeoutMs: 5_000,
      subscribe: (onEvent) => {
        onEvent(observationFromClients([CLIENT_A]));
        return () => {
          unsubscribed += 1;
        };
      },
    });
    expect(unsubscribed).toBe(1);
  });

  it('Q4: the default window is 30 000 ms and is configurable (test-pinned)', async () => {
    expect(DEFAULT_PRESENCE_TIMEOUT_MS).toBe(30_000);

    // Configurability: a custom shorter window governs the verdict instead.
    const started = Date.now();
    const result = await awaitPresenceVerdict({
      clientPubkey: CLIENT_A,
      timeoutMs: 30,
    });
    expect(result).toEqual({ permitted: false, reason: 'timeout', clients: null });
    expect(Date.now() - started).toBeLessThan(30_000);
  });
});
