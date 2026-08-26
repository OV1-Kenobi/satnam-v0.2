/**
 * @file notifications.test.ts
 * @description Tests for the A-5 fix: in-app notification stores are
 * vault-encrypted (hex ciphertext, never plaintext), held IN MEMORY while
 * the vault is locked (capped, never persisted as plaintext) and flushed on
 * unlock; message previews are pruned after the 7-day TTL.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { InAppNotification } from '../../src/lib/messaging/types.js';
import { NotificationManager, InAppNotificationCenter } from '../../src/lib/messaging/notifications.js';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('../../src/lib/ceps/ceps-client.js', () => ({
  publishEventWithCeps: vi.fn().mockResolvedValue('mock-event-id'),
  signEventWithCeps: vi.fn().mockImplementation(async (e: any) => ({
    ...e,
    id: 'mock-signed-id',
    sig: 'mock-sig',
  })),
  getDefaultRelays: vi.fn().mockReturnValue(['wss://nos.lol']),
}));

const storage: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => storage[k] ?? null,
  setItem: (k: string, v: string) => { storage[k] = v; },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
  key: (i: number) => Object.keys(storage)[i] ?? null,
  get length() { return Object.keys(storage).length; },
};
vi.stubGlobal('localStorage', localStorageMock);

// Vault mock — same pass-through XChaCha layer as messaging.test.ts.
const { xchacha20poly1305 } = await import('@noble/ciphers/chacha');
const { randomBytes, bytesToHex, utf8ToBytes, bytesToUtf8, hexToBytes } = await import('@noble/hashes/utils');
const testVaultKey = randomBytes(32);

let vaultUnlocked = true;

vi.mock('../../src/lib/vault/vault.js', async () => {
  const vault = {
    isUnlocked: () => vaultUnlocked,
    encryptBytes: async (plaintext: Uint8Array): Promise<Uint8Array> => {
      const nonce = randomBytes(24);
      const ct = xchacha20poly1305(testVaultKey, nonce).encrypt(plaintext);
      const out = new Uint8Array(24 + ct.length);
      out.set(nonce, 0);
      out.set(ct, 24);
      return out;
    },
    decryptBytes: async (data: Uint8Array): Promise<Uint8Array> => {
      const nonce = data.slice(0, 24);
      const ct = data.slice(24);
      return xchacha20poly1305(testVaultKey, nonce).decrypt(ct);
    },
  };
  return { getVault: () => vault, Vault: vi.fn() };
});

// Fresh module instance per test so the module-level hold buffer resets.
async function freshCenter(): Promise<{ center: InAppNotificationCenter; manager: NotificationManager }> {
  vi.resetModules();
  vaultUnlocked = true;
  const mod = await import('../../src/lib/messaging/notifications.js');
  return { center: new mod.InAppNotificationCenter(), manager: new mod.NotificationManager('aa'.repeat(32)) };
}

function makeNotification(overrides: Partial<InAppNotification> = {}): InAppNotification {
  return {
    id: 'n-1',
    threadId: 'thread-a',
    threadType: 'direct',
    senderPubkey: 'bb'.repeat(32),
    messagePreview: 'secret preview content',
    receivedAt: Math.floor(Date.now() / 1000),
    read: false,
    ...overrides,
  };
}

beforeEach(() => {
  localStorageMock.clear();
});

describe('A-5: encrypted notification stores', () => {
  it('persists notifications as hex ciphertext, never plaintext JSON', async () => {
    const { center } = await freshCenter();
    await center.addNotification('t1', 'direct', 'cc'.repeat(32), 'hello secret');

    const raw = storage['satnam:notifications:v2'];
    expect(raw).toBeDefined();
    expect(raw).toMatch(/^[0-9a-f]+$/); // hex ciphertext
    expect(raw).not.toContain('hello secret');

    // Round-trips through the vault key
    const bytes = hexToBytes(raw);
    const plain = bytesToUtf8(
      xchacha20poly1305(testVaultKey, bytes.slice(0, 24)).decrypt(bytes.slice(24)),
    );
    expect(JSON.parse(plain)[0].messagePreview).toBe('hello secret');
  });

  it('unread counts and thread prefs are also encrypted at rest', async () => {
    const { center, manager } = await freshCenter();
    await manager.setThreadPreference('t9', 'mentions');
    await center.addNotification('t1', 'direct', 'cc'.repeat(32), 'x');

    for (const key of [
      'satnam:notifications:unread:v2',
      'satnam:notifications:thread_prefs:v2',
    ]) {
      const raw = storage[key];
      if (raw !== undefined) {
        expect(raw).toMatch(/^[0-9a-f]+$/);
        expect(raw).not.toContain('{');
      }
    }
  });

  it('push registration store is encrypted at rest', async () => {
    const { manager } = await freshCenter();
    await manager.registerPushDevice('dd'.repeat(32), 'https://push.example/token', ['wss://nos.lol']);
    const raw = storage['satnam:push:registration:v2'];
    expect(raw).toMatch(/^[0-9a-f]+$/);
    expect(raw).not.toContain('push.example');
  });
});

describe('A-5: locked-vault hold semantics', () => {
  it('holds incoming notifications in memory while locked and never writes plaintext', async () => {
    vaultUnlocked = false;
    const mods = await freshCenter();
    vaultUnlocked = false;

    const n = await mods.center.addNotification('t1', 'direct', 'cc'.repeat(32), 'while locked');
    expect(n.id).toBeDefined();

    // Nothing may be persisted while locked
    expect(storage['satnam:notifications:v2']).toBeUndefined();

    // Readable from memory overlay
    const all = await mods.center.getAll();
    expect(all.some((x) => x.id === n.id)).toBe(true);
  });

  it('flushes held notifications to ciphertext after unlock', async () => {
    vaultUnlocked = false;
    const mods = await freshCenter();
    vaultUnlocked = false;

    const held = await mods.center.addNotification('t2', 'direct', 'cc'.repeat(32), 'held one');
    expect(storage['satnam:notifications:v2']).toBeUndefined();

    // Unlock — next operation flushes the hold buffer into ciphertext
    vaultUnlocked = true;
    await mods.center.markAllRead();

    const raw = storage['satnam:notifications:v2'];
    expect(raw).toMatch(/^[0-9a-f]+$/);
    const bytes = hexToBytes(raw);
    const plain = JSON.parse(
      bytesToUtf8(xchacha20poly1305(testVaultKey, bytes.slice(0, 24)).decrypt(bytes.slice(24))),
    ) as InAppNotification[];
    expect(plain.some((x) => x.id === held.id && x.read === true)).toBe(true);

    // Hold buffer drained
    expect(await mods.center.getAll()).toHaveLength(1);
  });
});

describe('A-5: preview retention TTL', () => {
  it('prunes notifications older than 7 days on load/add', async () => {
    const { center } = await freshCenter();

    // Seed an old notification directly through the writer path
    const old = makeNotification({ id: 'old-1', receivedAt: Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60 });
    const fresh = makeNotification({ id: 'fresh-1' });

    // Re-seed the store with [old, fresh] encrypted via the same scheme
    const seeds = [old, fresh];
    const nonce = randomBytes(24);
    const ct = xchacha20poly1305(testVaultKey, nonce).encrypt(utf8ToBytes(JSON.stringify(seeds)));
    const out = new Uint8Array(24 + ct.length);
    out.set(nonce, 0);
    out.set(ct, 24);
    storage['satnam:notifications:v2'] = bytesToHex(out);

    // Next add prunes the expired entry
    await center.addNotification('t3', 'direct', 'ee'.repeat(32), 'trigger prune');
    const all = await center.getAll();
    expect(all.some((n) => n.id === 'old-1')).toBe(false);
    expect(all.some((n) => n.id === 'fresh-1')).toBe(true);
    expect(all.some((n) => n.messagePreview === 'trigger prune')).toBe(true);
  });
});
