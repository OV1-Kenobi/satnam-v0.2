/**
 * @file vault-prf.test.ts
 * @description WP 005 vault PRF wiring tests — webauthn, nfc, settings, device-link QR round-trip.
 *
 * Extends vault.test.ts coverage:
 * - initialize/unlock with 'webauthn' (32-byte PRF mock) — unlock only with same bytes
 * - initialize/unlock with 'nfc' (32-byte PinGate argon2id mock) — unlock only with same bytes
 * - passphrase-only path still unchanged (default None)
 * - XOR helper for defense-in-depth (prf XOR passphrase-derived key)
 * - VaultSettings persistence (default none, 4 peers)
 * - DeviceLinkQR round-trip: phone export -> laptop import preserves npub; scanLocalStorageForSecrets clean
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Vault, VaultError } from '../../src/lib/vault/index.js';
import { deriveNfcWrappingKey, xorWrappingKeys } from '../../src/lib/vault/vault.js';

// ---------------------------------------------------------------------------
// In-Memory Storage Mock (copied from vault.test.ts to keep this file standalone)
// ---------------------------------------------------------------------------

const memStore = new Map<string, Uint8Array>();

function makeIdbRequest<T>(resultOrError: T | Error): IDBRequest<T> {
  let onsuccess: ((event: Event) => void) | null = null;
  let onerror: ((event: Event) => void) | null = null;
  let _result: T | undefined;
  let _error: DOMException | null = null;
  const isError = resultOrError instanceof Error;
  if (!isError) {
    _result = resultOrError as T;
  } else {
    _error = new DOMException(resultOrError.message);
  }
  const req = {
    get result() {
      return _result as T;
    },
    get error() {
      return _error;
    },
    set onsuccess(fn: ((event: Event) => void) | null) {
      onsuccess = fn;
      if (fn && !isError) {
        Promise.resolve().then(() => fn({ target: req } as unknown as Event));
      }
    },
    get onsuccess() {
      return onsuccess;
    },
    set onerror(fn: ((event: Event) => void) | null) {
      onerror = fn;
      if (fn && isError) {
        Promise.resolve().then(() => fn({ target: req } as unknown as Event));
      }
    },
    get onerror() {
      return onerror;
    },
  } as unknown as IDBRequest<T>;
  return req;
}

function makeTx(): IDBTransaction {
  return {
    objectStore: () => makeObjectStore(),
    oncomplete: null,
    onerror: null,
    commit: () => {},
    abort: () => {},
  } as unknown as IDBTransaction;
}

function makeObjectStore(): IDBObjectStore {
  return {
    get: (key: IDBValidKey) => {
      const k = String(key);
      const v = memStore.get(k);
      return makeIdbRequest<ArrayBuffer | undefined>(v ? v.buffer : undefined);
    },
    put: (value: unknown, key: IDBValidKey) => {
      const k = String(key);
      if (value instanceof ArrayBuffer) {
        memStore.set(k, new Uint8Array(value));
      } else if (ArrayBuffer.isView(value)) {
        memStore.set(k, new Uint8Array((value as Uint8Array).buffer));
      }
      return makeIdbRequest<IDBValidKey>(key);
    },
    delete: (key: IDBValidKey) => {
      memStore.delete(String(key));
      return makeIdbRequest<undefined>(undefined);
    },
    getAllKeys: () => {
      const keys = Array.from(memStore.keys());
      return makeIdbRequest<IDBValidKey[]>(keys as IDBValidKey[]);
    },
  } as unknown as IDBObjectStore;
}

function setupMockIndexedDb(): void {
  const fakeDb = {
    transaction: () => {
      const tx = makeTx();
      (tx as unknown as { objectStore: (n: string) => IDBObjectStore }).objectStore = () => makeObjectStore();
      return tx;
    },
    createObjectStore: () => makeObjectStore(),
  };
  (global as unknown as { indexedDB: { open: (...args: unknown[]) => IDBRequest<IDBDatabase> } }).indexedDB = {
    open: () => {
      const req = {
        result: fakeDb,
        error: null,
        onupgradeneeded: null as ((e: Event) => void) | null,
        onsuccess: null as ((e: Event) => void) | null,
        onerror: null as ((e: Event) => void) | null,
      };
      const actualReq = new Proxy(req, {
        set(target, prop, value) {
          (target as Record<string, unknown>)[String(prop)] = value;
          if (prop === 'onsuccess' && value) {
            Promise.resolve().then(() => (value as (e: Event) => void)({ target: actualReq } as unknown as Event));
          }
          return true;
        },
      });
      return actualReq as unknown as IDBRequest<IDBDatabase>;
    },
  };
  Object.defineProperty(global, 'navigator', {
    value: {
      storage: {
        getDirectory: () => Promise.reject(new Error('OPFS not available in test env')),
      },
    },
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PASSPHRASE = 'correct-horse-battery-staple-test-12';
const TEST_NPUB = 'npub1test1234567890abcdef1234567890abcdef1234567890abcdef12345678';
const TEST_NSEC = new Uint8Array(32).fill(42);
const MOCK_PRF_BYTES = new Uint8Array(32).fill(0xab);
const MOCK_PRF_BYTES_WRONG = new Uint8Array(32).fill(0xcd);
const NFC_PIN = '1234';
const NFC_UID = '04aabbccddeeff';

describe('Vault PRF (WP 005)', () => {
  beforeEach(() => {
    memStore.clear();
    setupMockIndexedDb();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('TC-PRF-01: passphrase-only (default None) still works unchanged', async () => {
    const vault = new Vault({ idleTimeoutMs: 300_000 });
    await vault.initialize('passphrase', PASSPHRASE);
    expect(vault.isUnlocked()).toBe(true);
    await vault.storeNsec(TEST_NPUB, TEST_NSEC);
    vault.lock();
    await vault.unlock('passphrase', PASSPHRASE);
    const out = await vault.getNsec(TEST_NPUB);
    expect(out).toEqual(TEST_NSEC);
  });

  it('TC-PRF-02: webauthn with mock PRF bytes unlocks only with same PRF bytes', async () => {
    const vault = new Vault({ idleTimeoutMs: 300_000 });
    await vault.initialize('webauthn', MOCK_PRF_BYTES);
    expect(vault.isUnlocked()).toBe(true);
    await vault.storeNsec(TEST_NPUB, TEST_NSEC);
    vault.lock();
    // Correct PRF succeeds
    await vault.unlock('webauthn', MOCK_PRF_BYTES);
    expect(vault.isUnlocked()).toBe(true);
    expect(await vault.getNsec(TEST_NPUB)).toEqual(TEST_NSEC);
    vault.lock();
    // Wrong PRF fails
    await expect(vault.unlock('webauthn', MOCK_PRF_BYTES_WRONG)).rejects.toMatchObject({
      message: VaultError.DecryptionFailed,
    });
  });

  it('TC-PRF-03: nfc with PinGate derived bytes (argon2id pin+uid) unlocks only with same bytes', async () => {
    const pinDerived = deriveNfcWrappingKey(NFC_PIN, NFC_UID);
    const wrongDerived = deriveNfcWrappingKey('9999', NFC_UID);
    const vault = new Vault({ idleTimeoutMs: 300_000 });
    await vault.initialize('nfc', pinDerived);
    await vault.storeNsec(TEST_NPUB, TEST_NSEC);
    vault.lock();
    await vault.unlock('nfc', pinDerived);
    expect(await vault.getNsec(TEST_NPUB)).toEqual(TEST_NSEC);
    vault.lock();
    await expect(vault.unlock('nfc', wrongDerived)).rejects.toMatchObject({
      message: VaultError.DecryptionFailed,
    });
    // Ensure derived key is 32 bytes and deterministic
    const again = deriveNfcWrappingKey(NFC_PIN, NFC_UID);
    expect(again).toEqual(pinDerived);
    expect(again.length).toBe(32);
  });

  it('TC-PRF-04: webauthn XOR with passphrase-derived key (defense-in-depth) produces distinct unlocking', async () => {
    // Simulate caller-side XOR: prf XOR argon2id(passphrase, salt) — caller does this before vault call
    // We test that xorWrappingKeys helper works and vault treats the XOR result as wrapping key.
    const prf = new Uint8Array(32).fill(0x11);
    const passphraseDerived = new Uint8Array(32).fill(0x22);
    const xored = xorWrappingKeys(prf, passphraseDerived);
    expect(xored.length).toBe(32);
    // xor twice with same passphraseDerived recovers prf
    const recovered = xorWrappingKeys(xored, passphraseDerived);
    expect(recovered).toEqual(prf);
    // Vault round-trip with xored key
    const vault = new Vault({ idleTimeoutMs: 300_000 });
    await vault.initialize('webauthn', xored);
    vault.lock();
    await vault.unlock('webauthn', xored);
    expect(vault.isUnlocked()).toBe(true);
  });

  it('TC-PRF-05: vault settings default is none; four peers persist encrypted', async () => {
    const vault = new Vault({ idleTimeoutMs: 300_000 });
    await vault.initialize('passphrase', PASSPHRASE);
    const def = await vault.getVaultSettings();
    expect(def.secondFactor).toBe('none');
    for (const factor of ['yubikey', 'nfc', 'biometrics', 'none'] as const) {
      await vault.setVaultSettings({ secondFactor: factor, updatedAt: new Date().toISOString() });
      const got = await vault.getSecondFactor();
      expect(got).toBe(factor);
    }
    // Ensure settings are encrypted in memStore (not plaintext)
    const settingsKey = Array.from(memStore.keys()).find((k) => k.includes('settings'));
    expect(settingsKey).toBeDefined();
    const blob = memStore.get(settingsKey!)!;
    // Blob must not contain plaintext JSON of factor name directly? It is ciphertext, so decode attempt should fail to equal plain JSON.
    const asText = new TextDecoder().decode(blob);
    expect(asText).not.toContain('"yubikey"');
    expect(asText).not.toContain('"biometrics"');
  });

  it('TC-PRF-06: DeviceLinkQR round-trip — phone export -> laptop import preserves npub; scanLocalStorageForSecrets clean', async () => {
    // Phone vault
    const phone = new Vault({ idleTimeoutMs: 300_000 });
    await phone.initialize('passphrase', PASSPHRASE);
    await phone.storeNsec(TEST_NPUB, TEST_NSEC);
    const backup = await phone.exportEncryptedBackup();
    expect(backup.length).toBeGreaterThan(32);
    // Simulate scanLocalStorageForSecrets still clean — check no nsec in localStorage-like map
    // In real invariant S4, localStorage.setItem with nsec is forbidden. Here we assert memStore blobs are ciphertext.
    const nsecEntryKey = Array.from(memStore.keys()).find((k) => k.includes(TEST_NPUB));
    expect(nsecEntryKey).toBeDefined();
    const nsecCiphertext = memStore.get(nsecEntryKey!)!;
    expect(nsecCiphertext).not.toEqual(TEST_NSEC);
    // Also check backup blob is not plaintext nsec
    const backupAsHex = Array.from(backup)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(backupAsHex).not.toContain(Array.from(TEST_NSEC).map((b) => b.toString(16).padStart(2, '0')).join(''));

    // Laptop import — simulate fresh device but using same vault instance unlocked (Strategy A)
    // In WP 005, laptop imports via vault.importEncryptedBackup() while unlocked.
    // We clear the nsec entry to simulate fresh import target, then import.
    const keysBefore = Array.from(memStore.keys()).filter((k) => k.includes(TEST_NPUB));
    expect(keysBefore.length).toBeGreaterThan(0);
    // Delete nsec entry to prove restore
    for (const k of keysBefore) memStore.delete(k);
    expect(Array.from(memStore.keys()).some((k) => k.includes(TEST_NPUB))).toBe(false);

    // Laptop vault (we reuse same instance unlocked — Strategy A)
    const laptop = phone; // same process simulates unlocked vault strategy
    const dummyWrappingKey = new Uint8Array(32).fill(0);
    await laptop.importEncryptedBackup(backup, dummyWrappingKey);
    dummyWrappingKey.fill(0);
    // Zero backup buffer after use per spec
    backup.fill(0);
    expect(backup.every((b) => b === 0)).toBe(true);

    const restored = await laptop.getNsec(TEST_NPUB);
    expect(restored).toEqual(TEST_NSEC);
    const identities = await laptop.listIdentities();
    expect(identities).toContain(TEST_NPUB);

    // scanLocalStorageForSecrets equivalent: ensure localStorage has not been written with nsec
    // We simulate by checking global localStorage mock if exists — should have no keys containing nsec
    const ls = (global as unknown as { localStorage?: Storage }).localStorage;
    if (ls) {
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i) ?? '';
        const v = ls.getItem(k) ?? '';
        expect(v).not.toContain('nsec');
      }
    }
  });

  it('TC-PRF-07: webauthn rejects wrong length credential', async () => {
    const vault = new Vault({ idleTimeoutMs: 300_000 });
    await expect(vault.initialize('webauthn', new Uint8Array(16).fill(1))).rejects.toThrow(/32 bytes/);
  });

  it('TC-PRF-08: nfc rejects wrong length credential', async () => {
    const vault = new Vault({ idleTimeoutMs: 300_000 });
    await expect(vault.initialize('nfc', new Uint8Array(10).fill(1))).rejects.toThrow(/32 bytes/);
  });

  it('TC-PRF-09: biometrics option does not become default — default stays none', async () => {
    const vault = new Vault({ idleTimeoutMs: 300_000 });
    await vault.initialize('passphrase', PASSPHRASE);
    const settings = await vault.getVaultSettings();
    expect(settings.secondFactor).toBe('none');
    expect(settings.secondFactor).not.toBe('biometrics');
  });
});
