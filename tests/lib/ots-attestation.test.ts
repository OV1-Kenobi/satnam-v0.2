/**
 * CR-F — OTS anchoring loop + NIP-03 kind:1040 attestation tests.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';

import { otsDigestForEvent, buildKind1040, verifyAttestationBinding } from '../../src/lib/ots/nip03';

const EVENT_ID = 'a'.repeat(63) + 'b';
const ALICE_SECRET = generateSecretKey();
const aliceHex = getPublicKey(ALICE_SECRET);

describe('CR-F NIP-03 kind:1040 attestations', () => {
  it('computes the OTS digest as sha256 over the 32-byte event id', () => {
    const digest = otsDigestForEvent(EVENT_ID);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // deterministic
    expect(otsDigestForEvent(EVENT_ID)).toBe(digest);
    // different id → different digest
    expect(otsDigestForEvent('b'.repeat(64))).not.toBe(digest);
  });

  it('rejects malformed event ids', () => {
    expect(() => otsDigestForEvent('zz')).toThrow(/64 hex/);
  });

  it('builds a signed kind:1040 with e/p/alt tags and proof content', () => {
    const event = buildKind1040({
      anchoredEventId: EVENT_ID,
      proofBase64: 'AAAA',
      relayHint: 'wss://relay.example',
      anchoredAuthorPubkeyHex: aliceHex,
      secret: ALICE_SECRET,
    });
    expect(event.kind).toBe(1040);
    expect(verifyEvent(event)).toBe(true);
    const eTag = event.tags.find((t) => t[0] === 'e')!;
    expect(eTag[1]).toBe(EVENT_ID);
    expect(eTag[2]).toBe('wss://relay.example');
    expect(event.tags).toContainEqual(['p', aliceHex]);
    expect(event.tags).toContainEqual(['alt', 'OpenTimestamps attestation']);
    expect(event.content).toBe('AAAA');
  });

  it('refuses to build an attestation without a proof (honest-state rule)', () => {
    expect(() =>
      buildKind1040({
        anchoredEventId: EVENT_ID,
        proofBase64: '',
        secret: ALICE_SECRET,
      }),
    ).toThrow(/proof required/);
  });

  it('verifyAttestationBinding accepts well-formed and rejects broken ones', () => {
    const good = buildKind1040({
      anchoredEventId: EVENT_ID,
      proofBase64: 'AAAA',
      secret: ALICE_SECRET,
    });
    expect(verifyAttestationBinding(good)).toBe(true);

    // wrong kind
    expect(
      verifyAttestationBinding({ ...good, kind: 1 }),
    ).toBe(false);
    // missing e tag
    expect(
      verifyAttestationBinding({ ...good, tags: [] }),
    ).toBe(false);
    // invalid event id in e tag
    expect(
      verifyAttestationBinding({ ...good, tags: [['e', 'not-hex']] }),
    ).toBe(false);
    // empty content
    expect(
      verifyAttestationBinding({ ...good, content: '' }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Vault receipt slots (store/get round-trip through an in-memory vault)
// ---------------------------------------------------------------------------
import { Vault } from '../../src/lib/vault/vault';
import type { OtsReceipt } from '../../src/lib/ots/client';

const memStore = new Map<string, Uint8Array>();

/** Minimal synchronous IndexedDB mock over a Map (same pattern as vault.test.ts). */
function setupMockIndexedDb(): void {
  const fakeDb = {
    transaction: () => ({
      objectStore: () => ({
        get: (key: IDBValidKey) => {
          const v = memStore.get(String(key));
          const req = {
            result: v ? v.buffer : undefined,
            error: null,
            onsuccess: null as ((e: unknown) => void) | null,
          };
          return new Proxy(req, {
            set(t, prop, val) {
              t[String(prop)] = val;
              if (prop === 'onsuccess' && val)
                Promise.resolve().then(() => val({ target: req }));
              return true;
            },
          });
        },
        put: (value: unknown, key: IDBValidKey) => {
          memStore.set(String(key), value instanceof ArrayBuffer ? new Uint8Array(value) : value);
          const req = { result: key, error: null, onsuccess: null };
          return new Proxy(req, {
            set(t, prop, val) {
              t[prop] = val;
              if (prop === 'onsuccess' && val) Promise.resolve().then(() => val({ target: req }));
              return true;
            },
          });
        },
        delete: (key: IDBValidKey) => {
          memStore.delete(String(key));
          return { onsuccess: null };
        },
        getAllKeys: () => ({ result: Array.from(memStore.keys()), onsuccess: null }),
      }),
      oncomplete: null,
      onerror: null,
      commit: () => {},
      abort: () => {},
    }),
    createObjectStore: () => ({}),
  };

  (global as unknown as { indexedDB: unknown }).indexedDB = {
    open: (_name: string, _version?: number) => {
      const actualReq = {
        result: fakeDb,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      return new Proxy(actualReq, {
        set(target, prop, value) {
          target[String(prop)] = value;
          if (prop === 'onsuccess' && value)
            Promise.resolve().then(() =>
              (value as (e: unknown) => void)({ target: actualReq }),
            );
          return true;
        },
      });
    },
  };

  Object.defineProperty(global, 'navigator', {
    value: { storage: { getDirectory: () => Promise.reject(new Error('no OPFS in tests')) } },
    writable: true,
    configurable: true,
  });
}

describe('CR-F vault OTS receipts', () => {
  beforeEach(() => {
    memStore.clear();
    setupMockIndexedDb();
  });

  it('round-trips an encrypted receipt through storeOtsReceipt/getOtsReceipt', async () => {
    const vault = new Vault({ idleTimeoutMs: 300_000 });
    await vault.initialize('passphrase', 'test-passphrase-123456');
    try {
      const receipt: OtsReceipt = {
        eventId: EVENT_ID,
        submittedAt: new Date().toISOString(),
        calendarUrls: ['https://calendar.example'],
      };
      await vault.storeOtsReceipt(EVENT_ID, receipt);
      const loaded = (await vault.getOtsReceipt(EVENT_ID)) as OtsReceipt;
      expect(loaded.eventId).toBe(EVENT_ID);
      expect(loaded.calendarUrls).toEqual(['https://calendar.example']);

      // unknown event → null
      expect(await vault.getOtsReceipt('c'.repeat(64))).toBeNull();

      // invalid id refused at write time
      await expect(vault.storeOtsReceipt('bad-id', {})).rejects.toThrow(/invalid event id/);
    } finally {
      vault.lock();
    }
  });

  it('refuses reads/writes while locked (S-invariant support)', async () => {
    const vault = new Vault({ idleTimeoutMs: 300_000 });
    await expect(vault.storeOtsReceipt(EVENT_ID, {})).rejects.toThrow();
    await expect(vault.getOtsReceipt(EVENT_ID)).rejects.toThrow();
  });
});
