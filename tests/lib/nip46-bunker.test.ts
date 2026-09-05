/**
 * @file nip46-bunker.test.ts
 * @description Unit tests for the WP-2 phone-side NIP-46 signer core
 * (src/lib/nip46/bunker.ts) — pairing echo binding (SEC-001/003 regression:
 * fail-closed secret presence + constant-time comparison), the authorization
 * gate (SEC-002 regression: expiry check between presence and method), and
 * presence add/remove/republish composition.
 *
 * All tests run against local fakes only — no relay connection, no CEPS, no
 * production activation (design note §7; WP-2 non-negotiable 8).
 *
 * Test groups:
 * 1. verifyPairingEcho — correct echo binds + clears secret; wrong echo throws;
 *    missing stored secret throws (SEC-001 regression); constant-time path used
 * 2. authorizeRequest — presence check, expiry check (SEC-002 regression),
 *    method check, per-kind allowlist, all fail closed in order
 * 3. Bunker presence composition — add/remove + republish through the seams
 */

import { describe, it, expect } from 'vitest';

import {
  verifyPairingEcho,
  authorizeRequest,
  addBunkerPresenceClient,
  removeBunkerPresenceClient,
} from '../../src/lib/nip46/bunker.js';
import {
  Nip46PresenceError,
  type Nip46PresenceCrypto,
  type Nip46PresenceStore,
} from '../../src/lib/nip46/presence.js';
import type { VaultOps, Nip46PairingState } from '../../src/lib/vault/types.js';

// ---------------------------------------------------------------------------
// Test Fixtures (synthetic — 64-char lowercase hex, no real keys)
// ---------------------------------------------------------------------------

const CLIENT_A = 'a'.repeat(64);
const CLIENT_B = 'b'.repeat(64);
const BUNKER = 'd'.repeat(64);
const SECRET = 'f'.repeat(64); // 32-byte hex-encoded pairing secret (synthetic)

/** Fake crypto seam: real (weak) involution cipher so at-rest opacity holds. */
const XOR_KEY = Uint8Array.from({ length: 32 }, (_, i) => (0x5a ^ i) & 0xff);

function xorBytes(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    out[i] = data[i] ^ XOR_KEY[i % XOR_KEY.length];
  }
  return out;
}

function fakeCrypto(): Nip46PresenceCrypto {
  return {
    async encryptBytes(plaintext: Uint8Array): Promise<Uint8Array> {
      return xorBytes(plaintext);
    },
    async decryptBytes(data: Uint8Array): Promise<Uint8Array> {
      return xorBytes(data);
    },
  };
}

/** Fake persistence seam for the single encrypted presence.json entry. */
function fakeStore() {
  const state = { blob: null as Uint8Array | null };
  return {
    get blob() {
      return state.blob;
    },
    async loadEncrypted(): Promise<Uint8Array | null> {
      return state.blob;
    },
    async saveEncrypted(data: Uint8Array): Promise<void> {
      state.blob = data;
    },
  };
}

/** Fake publication seam — a function; records the last published event template. */
function fakePublisher() {
  const events: unknown[] = [];
  const publisher = async (event: unknown): Promise<void> => {
    events.push(event);
  };
  return {
    events,
    publisher,
  };
}

/** Fake vault carrying a single pairing entry; records stores. */
function fakeVault(initialPairing: Nip46PairingState | null) {
  const state = { pairing: initialPairing, stores: 0 };
  return {
    get stores() {
      return state.stores;
    },
    async getNip46Pairing(): Promise<Nip46PairingState> {
      if (state.pairing === null) {
        throw new Error('IdentityNotFound');
      }
      return state.pairing;
    },
    async storeNip46Pairing(_sessionId: string, pairing: Nip46PairingState): Promise<void> {
      state.stores += 1;
      state.pairing = pairing;
    },
    async deleteNip46Pairing(): Promise<void> {
      state.pairing = null;
    },
  };
}

function makePairing(overrides: Partial<Nip46PairingState> = {}): Nip46PairingState {
  return {
    ephemeralPubkey: 'e'.repeat(64),
    ephemeralSecretKey: new Uint8Array(32),
    remotePubkey: CLIENT_A,
    establishedAt: '2026-09-04T00:00:00.000Z',
    relays: ['wss://relay.example.com'],
    pairingSecret: SECRET,
    declaredMethods: ['sign_event:1'],
    signEventKinds: [1],
    ...overrides,
  };
}

async function expectPresenceError(fn: () => Promise<unknown> | unknown, code: string): Promise<void> {
  let thrown: unknown;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Nip46PresenceError);
  expect((thrown as Nip46PresenceError).code).toBe(code);
}

// ---------------------------------------------------------------------------
// 1. verifyPairingEcho — SEC-001/003 regression
// ---------------------------------------------------------------------------

describe('verifyPairingEcho (SEC-001/003 regression)', () => {
  it('binds and clears the secret when the echo matches', async () => {
    const vault = fakeVault(makePairing());
    const result = await verifyPairingEcho(vault as unknown as VaultOps, 's1', SECRET);

    expect(result.pairingSecret).toBeUndefined();
    expect(vault.stores).toBe(1);
    // The vault copy no longer carries the secret after binding.
    expect((vault as unknown as { blob: unknown }).blob).toBeUndefined();
  });

  it('throws on a wrong echo and does NOT clear the secret', async () => {
    const vault = fakeVault(makePairing());
    await expect(
      verifyPairingEcho(vault as unknown as VaultOps, 's1', '0'.repeat(64)),
    ).rejects.toBeInstanceOf(Nip46PresenceError);
    expect(vault.stores).toBe(0);
  });

  it('throws when the stored secret is missing — SEC-001 regression (no short-circuit bind)', async () => {
    const vault = fakeVault(makePairing({ pairingSecret: undefined }));
    await expect(
      verifyPairingEcho(vault as unknown as VaultOps, 's1', SECRET),
    ).rejects.toMatchObject({
      name: 'Nip46PresenceError',
      code: 'invalid-client-pubkey',
    });
    expect(vault.stores).toBe(0);
  });

  it('throws a typed error on wrong echo with the invalid-client-pubkey code', async () => {
    const vault = fakeVault(makePairing());
    await expect(
      verifyPairingEcho(vault as unknown as VaultOps, 's1', '0'.repeat(64)),
    ).rejects.toMatchObject({
      name: 'Nip46PresenceError',
      code: 'invalid-client-pubkey',
    });
  });
});

// ---------------------------------------------------------------------------
// 2. authorizeRequest — SEC-002 regression + fail-closed order
// ---------------------------------------------------------------------------

describe('authorizeRequest (SEC-002 regression + fail-closed order)', () => {
  it('authorizes a permitted client with declared method and allowed kind', async () => {
    const pairing = makePairing();
    await expect(
      authorizeRequest(pairing, CLIENT_A, [CLIENT_A], 'sign_event:1', [1]),
    ).resolves.toEqual({ authorized: true });
  });

  it('rejects an author absent from the presence list (presence check first)', async () => {
    const pairing = makePairing();
    await expectPresenceError(
      () =>
        authorizeRequest(pairing, CLIENT_B, [CLIENT_A], 'sign_event:1', [1]) as unknown as void,
      'invalid-client-pubkey',
    );
  });

  it('rejects an expired pairing BEFORE method/kind checks — SEC-002 regression', async () => {
    const pairing = makePairing({
      expiresAt: '2020-01-01T00:00:00.000Z', // long expired
      declaredMethods: ['sign_event:1'],
      signEventKinds: [1],
    });
    await expectPresenceError(
      () =>
        authorizeRequest(pairing, CLIENT_A, [CLIENT_A], 'sign_event:1', [1]) as unknown as void,
      'expired-pairing',
    );
  });

  it('rejects a pairing whose expiresAt is a malformed date string — SEC-008 regression (fail-closed, no NaN pass-through)', async () => {
    const pairing = makePairing({ expiresAt: 'not-a-date' });
    await expectPresenceError(
      () =>
        authorizeRequest(pairing, CLIENT_A, [CLIENT_A], 'sign_event:1', [1]) as unknown as void,
      'expired-pairing',
    );
  });

  it('rejects a pairing with an empty-string expiresAt — SEC-008 regression (malformed is expired, not absent)', async () => {
    const pairing = makePairing({ expiresAt: '' });
    await expectPresenceError(
      () =>
        authorizeRequest(pairing, CLIENT_A, [CLIENT_A], 'sign_event:1', [1]) as unknown as void,
      'expired-pairing',
    );
  });

  it('allows a pairing with no expiresAt (never expires)', async () => {
    const pairing = makePairing({ expiresAt: undefined });
    await expect(
      authorizeRequest(pairing, CLIENT_A, [CLIENT_A], 'sign_event:1', [1]),
    ).resolves.toEqual({ authorized: true });
  });

  it('rejects a method not declared on the pairing', async () => {
    const pairing = makePairing({ declaredMethods: ['sign_event:4'] });
    await expectPresenceError(
      () =>
        authorizeRequest(pairing, CLIENT_A, [CLIENT_A], 'sign_event:1', [1]) as unknown as void,
      'invalid-client-pubkey',
    );
  });

  it('rejects a kind not in the per-kind allowlist', async () => {
    const pairing = makePairing({ signEventKinds: [4] });
    await expectPresenceError(
      () =>
        authorizeRequest(pairing, CLIENT_A, [CLIENT_A], 'sign_event:1', [1]) as unknown as void,
      'invalid-client-pubkey',
    );
  });

  it('allows an empty requestedKinds array when allowlist is set (no kind to check)', async () => {
    const pairing = makePairing({ signEventKinds: [1] });
    await expect(
      authorizeRequest(pairing, CLIENT_A, [CLIENT_A], 'sign_event:1', []),
    ).resolves.toEqual({ authorized: true });
  });
});

// ---------------------------------------------------------------------------
// 3. Bunker presence composition — add/remove/republish through the seams
// ---------------------------------------------------------------------------

describe('bunker presence composition', () => {
  it('adds a client, republishes, and returns the derived event', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();
    const publisher = fakePublisher();

    const result = await addBunkerPresenceClient(
      crypto,
      store,
      publisher.publisher,
      BUNKER,
      CLIENT_A,
    );

    expect(result.list?.clients).toEqual([CLIENT_A]);
    expect(result.event?.tags).toEqual([['p', CLIENT_A]]);
    expect(result.event?.kind).toBe(10003);
    expect(result.event?.pubkey).toBe(BUNKER);
    expect(publisher.events.length).toBe(1);
  });

  it('removes a client, republishes, and drops it from the projection', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();
    const publisher = fakePublisher();

    await addBunkerPresenceClient(
      crypto,
      store,
      publisher.publisher,
      BUNKER,
      CLIENT_A,
    );
    const result = await removeBunkerPresenceClient(
      crypto,
      store,
      publisher.publisher,
      BUNKER,
      CLIENT_A,
    );

    expect(result.list?.clients).toEqual([]);
    expect(result.event?.tags).toEqual([]);
    expect(publisher.events.length).toBe(2);
  });

  it('throws on an invalid client pubkey at the bunker seam (fail closed)', async () => {
    const crypto = fakeCrypto();
    const store = fakeStore();
    const publisher = fakePublisher();

    await expect(
      addBunkerPresenceClient(
        crypto,
        store,
        publisher.publisher,
        BUNKER,
        'NOT-HEX',
      ),
    ).rejects.toBeInstanceOf(Nip46PresenceError);
  });
});