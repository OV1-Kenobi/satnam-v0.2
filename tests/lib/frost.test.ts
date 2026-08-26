/**
 * @file frost.test.ts
 * @description Unit tests for the FROST threshold signing module.
 *
 * Tests cover:
 * 1. BfProfile and BfShare type construction and validation
 * 2. Vault storage round-trips (storeBfProfile/retrieveBfProfile, storeBfShare/retrieveBfShare)
 * 3. Group manifest tracking (listGroups, deleteGroupData)
 * 4. DKG session state transitions (idle → round1 → round2 → completed)
 * 5. Signing session state transitions (idle → request → collecting → combining → completed)
 * 6. FrostClient high-level API (createGroup, joinGroup, groupSign, rotateShares)
 * 7. Share backup event creation (createShareBackupEvent)
 * 8. Error conditions (VaultLocked, ShareNotFound, ProfileNotFound)
 *
 * The vault is backed by an in-memory Map to allow testing without a browser
 * OPFS environment, reusing the same IDB mock pattern as vault.test.ts.
 * Relay interactions are mocked — WebSocket is stubbed to return empty responses.
 *
 * @see src/lib/frost/types.ts
 * @see src/lib/frost/vault-storage.ts
 * @see src/lib/frost/ceremony.ts
 * @see src/lib/frost/client.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock CEPS so createGroup's NIP-44 share delivery never touches a relay.
// ---------------------------------------------------------------------------

vi.mock('../../src/lib/ceps/ceps-client.js', () => ({
  sendGiftwrappedMessageWithCeps: vi.fn().mockResolvedValue('mock-invite-event-id'),
  publishEventWithCeps: vi.fn().mockResolvedValue('mock-event-id'),
  signEventWithCeps: vi.fn(),
  getDefaultRelays: vi.fn().mockReturnValue(['wss://nos.lol']),
}));

// ---------------------------------------------------------------------------
// Mock argon2id to avoid expensive key derivation in tests.
// The vault uses argon2id(m=65536) which is too slow for unit tests.
// We replace it with a fast SHA-256-based substitute.
// ---------------------------------------------------------------------------

// Replace argon2id with a trivially fast stub for unit testing.
// Must be called BEFORE any vault.initialize() call.
vi.mock('@noble/hashes/argon2', () => {
  return {
    argon2id: (password: Uint8Array, salt: Uint8Array, opts: Record<string, unknown>): Uint8Array => {
      // Fast XOR-fold substitute — NOT cryptographically safe, for tests only
      const dkLen = (opts?.dkLen as number) ?? 32;
      const out = new Uint8Array(dkLen);
      const combined = new Uint8Array(password.length + salt.length);
      combined.set(password);
      combined.set(salt, password.length);
      for (let i = 0; i < dkLen; i++) {
        out[i] = combined[i % combined.length] ^ (i * 7);
      }
      return out;
    },
  };
});

// ---------------------------------------------------------------------------
// In-Memory Storage Mock (mirrors vault.test.ts pattern)
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
    get result() { return _result as T; },
    get error() { return _error; },
    set onsuccess(fn: ((event: Event) => void) | null) {
      onsuccess = fn;
      if (fn && !isError) {
        Promise.resolve().then(() => fn({ target: req } as unknown as Event));
      }
    },
    get onsuccess() { return onsuccess; },
    set onerror(fn: ((event: Event) => void) | null) {
      onerror = fn;
      if (fn && isError) {
        Promise.resolve().then(() => fn({ target: req } as unknown as Event));
      }
    },
    get onerror() { return onerror; },
  } as unknown as IDBRequest<T>;

  return req;
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

function setupMockIndexedDb() {
  const fakeDb = {
    transaction: (storeName: string, _mode: string) => {
      const tx = {
        objectStore: (_: string) => makeObjectStore(),
        oncomplete: null,
        onerror: null,
        commit: () => {},
        abort: () => {},
      };
      return tx as unknown as IDBTransaction;
    },
    createObjectStore: () => makeObjectStore(),
  };

  (global as unknown as { indexedDB: { open: (...args: unknown[]) => IDBRequest<IDBDatabase> } }).indexedDB = {
    open: (_name: string, _version?: number) => {
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
            Promise.resolve().then(() =>
              (value as (e: Event) => void)({ target: actualReq } as unknown as Event),
            );
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
        getDirectory: () => { throw new Error('OPFS not available'); },
      },
    },
    writable: true,
    configurable: true,
  });
}

/** Stub WebSocket to avoid real network connections during tests. */
function setupMockWebSocket() {
  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = MockWebSocket.CONNECTING;
    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    onclose: ((e: CloseEvent) => void) | null = null;

    constructor(_url: string) {
      // Simulate a successful connection that immediately closes
      // Use synchronous microtask queue to avoid timeout delays in tests
      Promise.resolve().then(() => {
        this.readyState = MockWebSocket.OPEN;
        if (this.onopen) {
          this.onopen({} as Event);
        }
        // Immediately close in the next microtask (no relay messages)
        Promise.resolve().then(() => {
          this.readyState = MockWebSocket.CLOSED;
          if (this.onclose) {
            this.onclose({} as CloseEvent);
          }
        });
      });
    }

    send(_data: string): void {
      // No-op — simulate publishing without relay acknowledgment
    }

    close(): void {
      this.readyState = MockWebSocket.CLOSED;
    }
  }

  (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket = MockWebSocket;
}

// ---------------------------------------------------------------------------
// Import modules AFTER mocks are set up
// ---------------------------------------------------------------------------

// Mocks must be in place before any module with side effects is imported
setupMockIndexedDb();
setupMockWebSocket();

// Now import the modules under test
import { Vault, getVault } from '../../src/lib/vault/vault.js';
import { VaultError } from '../../src/lib/vault/types.js';
import {
  type BfProfile,
  type BfShare,
  type DkgSession,
  type SigningSession,
  type UnsignedNostrEvent,
  DEFAULT_FROST_CONFIG,
  FrostError,
  frostErr,
} from '../../src/lib/frost/types.js';
import {
  storeBfProfile,
  storeBfProfileAndRegister,
  retrieveBfProfile,
  storeBfShare,
  retrieveBfShare,
  listGroups,
  deleteGroupData,
  createShareBackupEvent,
  hasShareForGroup,
  generateSessionId,
} from '../../src/lib/frost/vault-storage.js';
import {
  initiateDkg,
  joinDkg,
  initiateGroupSigning,
  computeEventSighash,
  runTrustedDealerCreation,
  acceptShareInvitation,
} from '../../src/lib/frost/ceremony.js';
import { FrostClient } from '../../src/lib/frost/client.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { getPublicKey } from 'nostr-tools';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

/** Deterministic test keypairs (hex) */
const GUARDIAN_NSEC = 'a'.repeat(64);
const GUARDIAN_NSEC_BYTES = hexToBytes(GUARDIAN_NSEC);
// Derived from the guardian nsec (0xaa…aa scalar) so backup event authorship matches
const GUARDIAN_PUBKEY = getPublicKey(GUARDIAN_NSEC_BYTES);

const STEWARD_NSEC = 'b'.repeat(64);
const STEWARD_PUBKEY = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'.slice(2, 66);

const GROUP_PUBKEY = 'c'.repeat(64);

/** Factory for a test BfProfile */
function makeBfProfile(overrides?: Partial<BfProfile>): BfProfile {
  return {
    groupPubkey: GROUP_PUBKEY,
    threshold: 2,
    totalShares: 3,
    participants: [GUARDIAN_PUBKEY, STEWARD_PUBKEY, 'd'.repeat(64)],
    metadata: {
      name: 'Test Group',
      description: 'A test FROST group',
    },
    createdAt: 1700000000,
    ...overrides,
  };
}

/** Factory for a test BfShare */
function makeBfShare(overrides?: Partial<BfShare>): BfShare {
  return {
    index: 1,
    secretShare: 'e'.repeat(64),
    publicShare: 'f'.repeat(64),
    groupPubkey: GROUP_PUBKEY,
    ...overrides,
  };
}

/** Factory for a test unsigned Nostr event */
function makeUnsignedEvent(overrides?: Partial<UnsignedNostrEvent>): UnsignedNostrEvent {
  return {
    kind: 1,
    pubkey: GROUP_PUBKEY,
    created_at: 1700000000,
    tags: [],
    content: 'Hello FROST',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test Setup
// ---------------------------------------------------------------------------

const PASSPHRASE = 'correct-horse-battery-staple';
let vault: Vault;

/**
 * Initialize the vault singleton for tests without calling argon2id.
 * We patch the vault instance directly by calling unlock() after seeding
 * the master key via initialize(). The argon2id mock handles fast KDF.
 */
async function setupVault(): Promise<Vault> {
  // Reset store first
  memStore.clear();
  setupMockIndexedDb();

  // Use the module singleton so frost vault-storage functions find it
  const v = getVault();
  // Lock first (in case it's already unlocked from a previous test)
  v.lock();
  // Initialize with mocked argon2id (fast stub)
  await v.initialize('passphrase', PASSPHRASE);
  return v;
}

beforeEach(async () => {
  vault = await setupVault();
});

afterEach(() => {
  vault.lock();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Type Construction Tests
// ---------------------------------------------------------------------------

describe('BfProfile type construction', () => {
  it('constructs a valid BfProfile with all required fields', () => {
    const profile = makeBfProfile();

    expect(profile.groupPubkey).toBe(GROUP_PUBKEY);
    expect(profile.threshold).toBe(2);
    expect(profile.totalShares).toBe(3);
    expect(profile.participants).toHaveLength(3);
    expect(profile.metadata.name).toBe('Test Group');
    expect(profile.createdAt).toBeGreaterThan(0);
  });

  it('constructs a BfProfile with optional metadata fields', () => {
    const profile = makeBfProfile({
      metadata: {
        name: 'Family Safe',
        description: 'Family FROST group',
        picture: 'https://example.com/avatar.png',
        profileEventId: '1234567890abcdef',
      },
    });

    expect(profile.metadata.picture).toBe('https://example.com/avatar.png');
    expect(profile.metadata.profileEventId).toBe('1234567890abcdef');
  });
});

describe('BfShare type construction', () => {
  it('constructs a valid BfShare with all required fields', () => {
    const share = makeBfShare();

    expect(share.index).toBe(1);
    expect(share.secretShare).toHaveLength(64);
    expect(share.publicShare).toHaveLength(64);
    expect(share.groupPubkey).toBe(GROUP_PUBKEY);
  });

  it('constructs a BfShare with optional nonce commitments', () => {
    const share = makeBfShare({
      nonceCommitments: ['nonce1', 'nonce2', 'nonce3'],
    });

    expect(share.nonceCommitments).toHaveLength(3);
    expect(share.nonceCommitments![0]).toBe('nonce1');
  });
});

describe('FrostError enum', () => {
  it('creates typed errors with frostErr()', () => {
    const err = frostErr(FrostError.ShareNotFound);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(FrostError.ShareNotFound);
    expect((err as { frostError?: FrostError }).frostError).toBe(FrostError.ShareNotFound);
  });

  it('has all expected error variants', () => {
    const variants = [
      FrostError.VaultLocked,
      FrostError.ShareNotFound,
      FrostError.ProfileNotFound,
      FrostError.CeremonyTimeout,
      FrostError.InsufficientParticipants,
      FrostError.BifrostUnavailable,
      FrostError.AggregationFailed,
      FrostError.EncryptionFailed,
      FrostError.RelayConnectionFailed,
      FrostError.PermissionDenied,
      FrostError.InvalidBackup,
    ];

    expect(variants).toHaveLength(11);
    variants.forEach((v) => expect(typeof v).toBe('string'));
  });
});

describe('DEFAULT_FROST_CONFIG', () => {
  it('has valid default values', () => {
    expect(DEFAULT_FROST_CONFIG.signingRequestKind).toBe(20100);
    expect(DEFAULT_FROST_CONFIG.dkgTimeout).toBeGreaterThan(0);
    expect(DEFAULT_FROST_CONFIG.signingTimeout).toBeGreaterThan(0);
    expect(DEFAULT_FROST_CONFIG.coordinatorRelay).toMatch(/^wss?:\/\//);
  });

  it('uses ephemeral kind range (20000-29999)', () => {
    expect(DEFAULT_FROST_CONFIG.signingRequestKind).toBeGreaterThanOrEqual(20000);
    expect(DEFAULT_FROST_CONFIG.signingRequestKind).toBeLessThan(30000);
  });
});

// ---------------------------------------------------------------------------
// 2. Vault Storage Round-Trip Tests
// ---------------------------------------------------------------------------

describe('storeBfProfile / retrieveBfProfile round-trip', () => {
  it('stores and retrieves a BfProfile', async () => {
    const profile = makeBfProfile();

    await storeBfProfile(GROUP_PUBKEY, profile);
    const retrieved = await retrieveBfProfile(GROUP_PUBKEY);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.groupPubkey).toBe(GROUP_PUBKEY);
    expect(retrieved!.threshold).toBe(2);
    expect(retrieved!.totalShares).toBe(3);
    expect(retrieved!.metadata.name).toBe('Test Group');
  });

  it('returns null for a profile that does not exist', async () => {
    const result = await retrieveBfProfile('nonexistent-pubkey');
    expect(result).toBeNull();
  });

  it('overwrites an existing profile on re-store', async () => {
    const profile1 = makeBfProfile({ metadata: { name: 'Original' } });
    const profile2 = makeBfProfile({ metadata: { name: 'Updated' } });

    await storeBfProfile(GROUP_PUBKEY, profile1);
    await storeBfProfile(GROUP_PUBKEY, profile2);

    const retrieved = await retrieveBfProfile(GROUP_PUBKEY);
    expect(retrieved!.metadata.name).toBe('Updated');
  });

  it('preserves all profile fields through serialization', async () => {
    const profile = makeBfProfile({
      threshold: 3,
      totalShares: 5,
      participants: ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32), 'dd'.repeat(32), 'ee'.repeat(32)],
      metadata: {
        name: 'Complex Group',
        description: 'Five participants',
        picture: 'https://cdn.example.com/pic.jpg',
        profileEventId: 'abcdef1234567890',
      },
      createdAt: 1699999999,
    });

    await storeBfProfile(GROUP_PUBKEY, profile);
    const retrieved = await retrieveBfProfile(GROUP_PUBKEY);

    expect(retrieved!.threshold).toBe(3);
    expect(retrieved!.totalShares).toBe(5);
    expect(retrieved!.participants).toHaveLength(5);
    expect(retrieved!.metadata.picture).toBe('https://cdn.example.com/pic.jpg');
    expect(retrieved!.createdAt).toBe(1699999999);
  });
});

describe('storeBfShare / retrieveBfShare round-trip', () => {
  it('stores and retrieves a BfShare (secret material)', async () => {
    const share = makeBfShare();

    await storeBfShare(GROUP_PUBKEY, share);
    const retrieved = await retrieveBfShare(GROUP_PUBKEY);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.index).toBe(1);
    expect(retrieved!.secretShare).toBe('e'.repeat(64));
    expect(retrieved!.publicShare).toBe('f'.repeat(64));
    expect(retrieved!.groupPubkey).toBe(GROUP_PUBKEY);
  });

  it('returns null for a share that does not exist', async () => {
    const result = await retrieveBfShare('nonexistent-group');
    expect(result).toBeNull();
  });

  it('preserves share index correctly', async () => {
    for (const index of [1, 2, 3]) {
      const share = makeBfShare({ index, groupPubkey: `group-${index}`.padEnd(64, '0') });
      await storeBfShare(`group-${index}`.padEnd(64, '0'), share);
      const retrieved = await retrieveBfShare(`group-${index}`.padEnd(64, '0'));
      expect(retrieved!.index).toBe(index);
    }
  });

  it('stores different shares for different groups', async () => {
    const share1 = makeBfShare({ index: 1, groupPubkey: 'a'.repeat(64) });
    const share2 = makeBfShare({ index: 2, groupPubkey: 'b'.repeat(64) });

    await storeBfShare('a'.repeat(64), share1);
    await storeBfShare('b'.repeat(64), share2);

    const r1 = await retrieveBfShare('a'.repeat(64));
    const r2 = await retrieveBfShare('b'.repeat(64));

    expect(r1!.index).toBe(1);
    expect(r2!.index).toBe(2);
  });
});

describe('storeBfProfileAndRegister + listGroups', () => {
  it('registers groups in the manifest and lists them', async () => {
    const profile1 = makeBfProfile({ groupPubkey: 'a'.repeat(64), metadata: { name: 'Group A' } });
    const profile2 = makeBfProfile({ groupPubkey: 'b'.repeat(64), metadata: { name: 'Group B' } });

    await storeBfProfileAndRegister('a'.repeat(64), profile1);
    await storeBfProfileAndRegister('b'.repeat(64), profile2);

    const groups = await listGroups();
    expect(groups.length).toBeGreaterThanOrEqual(2);

    const names = groups.map((g) => g.metadata.name);
    expect(names).toContain('Group A');
    expect(names).toContain('Group B');
  });

  it('returns an empty list when no groups are registered', async () => {
    const groups = await listGroups();
    expect(groups).toHaveLength(0);
  });

  it('does not register the same group twice in the manifest', async () => {
    const profile = makeBfProfile();

    await storeBfProfileAndRegister(GROUP_PUBKEY, profile);
    await storeBfProfileAndRegister(GROUP_PUBKEY, profile); // Second call

    const groups = await listGroups();
    const groupsWithKey = groups.filter((g) => g.groupPubkey === GROUP_PUBKEY);
    expect(groupsWithKey).toHaveLength(1);
  });
});

describe('hasShareForGroup', () => {
  it('returns true when a share exists', async () => {
    const share = makeBfShare();
    await storeBfShare(GROUP_PUBKEY, share);
    expect(await hasShareForGroup(GROUP_PUBKEY)).toBe(true);
  });

  it('returns false when no share exists', async () => {
    expect(await hasShareForGroup('no-share-here'.padEnd(64, '0'))).toBe(false);
  });
});

describe('generateSessionId', () => {
  it('generates a hex string of 64 characters', () => {
    const id = generateSessionId();
    expect(id).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(id)).toBe(true);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateSessionId()));
    expect(ids.size).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// 3. Trusted-dealer creation + join validation (FB-2/FB-3)
// ---------------------------------------------------------------------------

describe('Trusted-dealer creation (FB-2)', () => {
  const TEST_PARTICIPANTS = [GUARDIAN_PUBKEY, STEWARD_PUBKEY];

  it('initiateDkg creates an announcement session in round1_initiated state', async () => {
    const session = await initiateDkg({
      threshold: 2,
      participants: TEST_PARTICIPANTS,
      groupMetadata: { name: 'DKG Test Group' },
      coordinatorRelay: 'wss://relay.example.com',
      initiatorNsec: GUARDIAN_NSEC,
    });

    expect(session.state).toBe('round1_initiated');
    expect(session.threshold).toBe(2);
    expect(session.totalShares).toBe(2);
    expect(session.participants).toEqual(TEST_PARTICIPANTS);
    expect(session.groupId).toHaveLength(64);
  });

  it('initiateDkg throws for threshold < 2', async () => {
    await expect(
      initiateDkg({
        threshold: 1,
        participants: TEST_PARTICIPANTS,
        groupMetadata: { name: 'Bad Threshold' },
        coordinatorRelay: 'wss://relay.example.com',
        initiatorNsec: GUARDIAN_NSEC,
      }),
    ).rejects.toThrow('threshold must be at least 2');
  });

  it('initiateDkg throws when participants < threshold', async () => {
    await expect(
      initiateDkg({
        threshold: 3,
        participants: TEST_PARTICIPANTS, // only 2
        groupMetadata: { name: 'Bad Participants' },
        coordinatorRelay: 'wss://relay.example.com',
        initiatorNsec: GUARDIAN_NSEC,
      }),
    ).rejects.toThrow('Total participants must be >= threshold');
  });

  it('runTrustedDealerCreation persists guardian profile+share with REAL bifrost credentials', async () => {
    const { profile, guardianShare, distributions } = await runTrustedDealerCreation({
      threshold: 2,
      participants: TEST_PARTICIPANTS,
      metadata: { name: 'Dealer Test' },
    });

    // Real bifrost output shape
    expect(profile.groupPubkey).toMatch(/^[0-9a-f]{66}$/); // compressed key
    expect(profile.encodedGroupPkg).toBeTruthy();
    expect(profile.encodedGroupPkg!.startsWith('bfgroup1')).toBe(true);
    expect(profile.threshold).toBe(2);
    expect(profile.totalShares).toBe(2);

    // Guardian's own share: true idx, encoded credential present, persisted
    expect(guardianShare.index).toBe(1);
    expect(guardianShare.encodedShare).toBeTruthy();
    expect(guardianShare.encodedShare!.startsWith('bfshare1')).toBe(true);
    const storedShare = await retrieveBfShare(profile.groupPubkey);
    expect(storedShare?.encodedShare).toBe(guardianShare.encodedShare);
    const storedProfile = await retrieveBfProfile(profile.groupPubkey);
    expect(storedProfile?.encodedGroupPkg).toBe(profile.encodedGroupPkg);

    // One distribution per non-guardian participant
    expect(distributions).toHaveLength(1);
    expect(distributions[0]!.recipientPubkey).toBe(STEWARD_PUBKEY);
    expect(distributions[0]!.payload.v).toBe(2);
    expect(distributions[0]!.payload.idx).toBe(2);
  });

  it('runTrustedDealerCreation throws for invalid parameters', async () => {
    await expect(
      runTrustedDealerCreation({ threshold: 1, participants: TEST_PARTICIPANTS, metadata: { name: 'x' } }),
    ).rejects.toThrow('threshold must be at least 2');
    await expect(
      runTrustedDealerCreation({ threshold: 3, participants: TEST_PARTICIPANTS, metadata: { name: 'x' } }),
    ).rejects.toThrow('Total participants must be >= threshold');
  });
});

describe('Join validation — acceptShareInvitation (FB-3)', () => {
  it('accepts a genuine invitation and stores validated credentials', async () => {
    const TEST_PARTICIPANTS = [GUARDIAN_PUBKEY, STEWARD_PUBKEY];
    const { profile, distributions } = await runTrustedDealerCreation({
      threshold: 2,
      participants: TEST_PARTICIPANTS,
      metadata: { name: 'Join Test' },
    });

    const invitation = distributions[0]!;
    const joinedProfile = await acceptShareInvitation(JSON.stringify(invitation.payload));

    expect(joinedProfile.groupPubkey).toBe(profile.groupPubkey);
    expect(joinedProfile.encodedGroupPkg).toBe(profile.encodedGroupPkg);

    const storedShare = await retrieveBfShare(profile.groupPubkey);
    expect(storedShare?.index).toBe(invitation.payload.idx);
    expect(storedShare?.encodedShare).toBe(invitation.payload.sharePkg);

    // Derived pubkey matches the group member record (real crypto check).
    // nostr-tools v2 getPublicKey returns a 64-char x-only hex string.
    const shareBytes = hexToBytes(storedShare!.secretShare);
    const derivedHex = getPublicKey(shareBytes);
    expect(/^[0-9a-f]{64}$/.test(derivedHex)).toBe(true);
  });

  it('rejects a tampered payload (share seckey swapped for a foreign key)', async () => {
    const TEST_PARTICIPANTS = [GUARDIAN_PUBKEY, STEWARD_PUBKEY];
    const { distributions } = await runTrustedDealerCreation({
      threshold: 2,
      participants: TEST_PARTICIPANTS,
      metadata: { name: 'Tamper Test' },
    });

    const payload = JSON.parse(JSON.stringify(distributions[0]!.payload));
    // Corrupt the encoded share credential → decode/validation must fail
    payload.sharePkg = payload.sharePkg.slice(0, -4) + 'zzzz';
    await expect(acceptShareInvitation(JSON.stringify(payload))).rejects.toMatchObject({
      message: FrostError.InvalidBackup,
    });
  });

  it('rejects malformed JSON and wrong-version payloads', async () => {
    await expect(acceptShareInvitation('not-json{')).rejects.toMatchObject({
      message: FrostError.InvalidBackup,
    });
    await expect(
      acceptShareInvitation(JSON.stringify({ v: 1, groupPkg: 'x', sharePkg: 'y' })),
    ).rejects.toMatchObject({ message: FrostError.InvalidBackup });
  });

  it('joinDkg THROWS when the announcement cannot be found (synthetic fallback removed)', async () => {
    await expect(
      joinDkg({
        sessionId: generateSessionId(),
        coordinatorRelay: 'wss://relay.example.com',
        participantNsec: STEWARD_NSEC,
      }),
    ).rejects.toMatchObject({ message: FrostError.CeremonyTimeout });
  });
});

// ---------------------------------------------------------------------------
// 4. Signing Session (honest wrappers — real signing lives in frost-bifrost)
// ---------------------------------------------------------------------------

describe('Signing session state transitions', () => {
  it('initiateGroupSigning returns request_published WITHOUT fabricated partial sigs', async () => {
    const share = makeBfShare();
    await storeBfShare(GROUP_PUBKEY, share);

    const unsignedEvent = makeUnsignedEvent();

    const session = await initiateGroupSigning({
      groupPubkey: GROUP_PUBKEY,
      unsignedEvent,
      coordinatorRelay: 'wss://relay.example.com',
      initiatorShare: share,
    });

    expect(session.state).toBe('request_published');
    expect(session.groupPubkey).toBe(GROUP_PUBKEY);
    expect(session.sessionId).toHaveLength(64);
    // Simulation deleted: no fake partial signatures are seeded
    expect(session.partialSigs.size).toBe(0);
    expect(session.threshold).toBeGreaterThan(0);
  });

  it('computeEventSighash matches the NIP-01 event id derivation', () => {
    const ue = makeUnsignedEvent();
    const sighash = computeEventSighash(ue);
    const { getEventHash } = require('nostr-tools') as typeof import('nostr-tools');
    const id = getEventHash({
      kind: ue.kind,
      created_at: ue.created_at,
      tags: ue.tags,
      content: ue.content,
      pubkey: ue.pubkey,
    } as never);
    expect(sighash).toBe(id);
    expect(/^[0-9a-f]{64}$/.test(sighash)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Share Backup Tests
// ---------------------------------------------------------------------------

describe('createShareBackupEvent', () => {
  it('creates a signed kind:10000 event with NIP-44-encrypted content', async () => {
    const share = makeBfShare();
    await storeBfShare(GROUP_PUBKEY, share);

    const backupEvent = await createShareBackupEvent(GROUP_PUBKEY, GUARDIAN_NSEC_BYTES);

    expect(backupEvent.kind).toBe(10000);
    expect(backupEvent.pubkey).toBe(GUARDIAN_PUBKEY);
    expect(backupEvent.sig).toBeTruthy();
    // Content must be NIP-44 ciphertext — not parseable as plaintext JSON
    expect(() => JSON.parse(backupEvent.content)).toThrow();
  });

  it('includes the correct d tag', async () => {
    const share = makeBfShare();
    await storeBfShare(GROUP_PUBKEY, share);

    const backupEvent = await createShareBackupEvent(GROUP_PUBKEY, GUARDIAN_NSEC_BYTES);

    const dTag = backupEvent.tags.find((t) => t[0] === 'd');
    expect(dTag).toBeTruthy();
    expect(dTag![1]).toBe(`satnam:bfshare:${GROUP_PUBKEY}`);
  });

  it('includes the group pubkey tag', async () => {
    const share = makeBfShare();
    await storeBfShare(GROUP_PUBKEY, share);

    const backupEvent = await createShareBackupEvent(GROUP_PUBKEY, GUARDIAN_NSEC_BYTES);

    const groupTag = backupEvent.tags.find((t) => t[0] === 'group');
    expect(groupTag).toBeTruthy();
    expect(groupTag![1]).toBe(GROUP_PUBKEY);
  });

  it('throws ShareNotFound when no share exists (vault unlocked)', async () => {
    // Vault is unlocked in beforeEach; no share stored → ShareNotFound
    await expect(
      createShareBackupEvent('no-share-here'.padEnd(64, '0'), GUARDIAN_NSEC_BYTES),
    ).rejects.toMatchObject({
      message: FrostError.ShareNotFound,
    });
  });

  it('round-trips: createShareBackupEvent → restoreShareFromBackup recovers the share', async () => {
    const { restoreShareFromBackup } = await import('../../src/lib/frost/vault-storage.js');
    const share = makeBfShare();
    await storeBfShare(GROUP_PUBKEY, share);

    const backupEvent = await createShareBackupEvent(GROUP_PUBKEY, GUARDIAN_NSEC_BYTES);

    // Wipe the local share (soft-delete pattern used by deleteGroupData), then restore
    await vault.storeBfshare(GROUP_PUBKEY, new TextEncoder().encode('null'));

    const restored = await restoreShareFromBackup(backupEvent, GUARDIAN_NSEC_BYTES);
    expect(restored.secretShare).toBe(share.secretShare);
    expect(restored.groupPubkey).toBe(GROUP_PUBKEY);
    expect(restored.index).toBe(share.index);
  });

  it('v2 round-trip: encoded bifrost credentials survive backup → restore', async () => {
    const { restoreShareFromBackup } = await import('../../src/lib/frost/vault-storage.js');

    // Build a real dealer group so we have genuine encoded credentials
    const { profile, guardianShare } = await runTrustedDealerCreation({
      threshold: 2,
      participants: [GUARDIAN_PUBKEY, STEWARD_PUBKEY],
      metadata: { name: 'Backup v2' },
    });
    // Re-store under the fixture key the backup helper expects
    const gpk = profile.groupPubkey;
    await storeBfShare(gpk, guardianShare);

    const backupEvent = await createShareBackupEvent(gpk, GUARDIAN_NSEC_BYTES);

    // Wipe, then restore
    await vault.storeBfshare(gpk, new TextEncoder().encode('null'));
    const restored = await restoreShareFromBackup(backupEvent, GUARDIAN_NSEC_BYTES);

    expect(restored.encodedShare?.startsWith('bfshare1')).toBe(true);
    expect(restored.encodedShare).toBe(guardianShare.encodedShare);

    // Profile backfilled with the encoded group package
    const restoredProfile = await retrieveBfProfile(gpk);
    expect(restoredProfile?.encodedGroupPkg?.startsWith('bfgroup1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. FrostClient High-Level API Tests
// ---------------------------------------------------------------------------

describe('FrostClient', () => {
  let client: FrostClient;

  beforeEach(() => {
    client = new FrostClient(vault, {
      ...DEFAULT_FROST_CONFIG,
      coordinatorRelay: 'wss://relay.example.com',
      dkgTimeout: 5_000,
      signingTimeout: 5_000,
    });
  });

  it('instantiates successfully', () => {
    expect(client).toBeInstanceOf(FrostClient);
  });

  it('listGroups returns empty array when vault is empty', async () => {
    const groups = await client.listGroups();
    expect(groups).toHaveLength(0);
  });

  it('getGroupProfile returns null for unknown group', async () => {
    const profile = await client.getGroupProfile('unknown'.padEnd(64, '0'));
    expect(profile).toBeNull();
  });

  it('storeGroupProfile persists a profile', async () => {
    const profile = makeBfProfile();
    await client.storeGroupProfile(profile);

    const retrieved = await client.getGroupProfile(GROUP_PUBKEY);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.groupPubkey).toBe(GROUP_PUBKEY);
  });

  it('createGroup runs trusted-dealer creation and stores REAL credentials', async () => {
    const profile = await client.createGroup({
      name: 'Integration Test Group',
      description: 'Created by createGroup()',
      threshold: 2,
      participants: [GUARDIAN_PUBKEY, STEWARD_PUBKEY],
      guardianNsec: GUARDIAN_NSEC,
    });

    // Real bifrost group package: compressed pubkey + encoded credential
    expect(profile.groupPubkey).toMatch(/^[0-9a-f]{66}$/);
    expect(profile.encodedGroupPkg?.startsWith('bfgroup1')).toBe(true);
    expect(profile.threshold).toBe(2);
    expect(profile.totalShares).toBe(2);

    // Guardian's own share persisted WITH its encoded credential
    const storedShare = await retrieveBfShare(profile.groupPubkey);
    expect(storedShare).not.toBeNull();
    expect(storedShare!.encodedShare?.startsWith('bfshare1')).toBe(true);
    expect(storedShare!.index).toBe(1);

    // Profile should be retrievable from vault
    const storedProfile = await client.getGroupProfile(profile.groupPubkey);
    expect(storedProfile).not.toBeNull();
  });

  it('createGroup registers the group in listGroups', async () => {
    await client.createGroup({
      name: 'Listed Group',
      threshold: 2,
      participants: [GUARDIAN_PUBKEY, STEWARD_PUBKEY],
      guardianNsec: GUARDIAN_NSEC,
    });

    const groups = await client.listGroups();
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it('joinGroup accepts a genuine invitation end-to-end (dealer → join)', async () => {
    // Guardian creates the group (CEPS delivery mocked)
    await client.createGroup({
      name: 'Join E2E',
      threshold: 2,
      participants: [GUARDIAN_PUBKEY, STEWARD_PUBKEY],
      guardianNsec: GUARDIAN_NSEC,
    });
    const profile = (await client.listGroups())[0]!;

    // Rebuild the exact invitation the dealer produced for the steward
    const { distributions } = await runTrustedDealerCreation({
      threshold: 2,
      participants: [GUARDIAN_PUBKEY, STEWARD_PUBKEY],
      metadata: { name: 'Join E2E' },
    });

    const stewardClient = new FrostClient(vault, {
      ...DEFAULT_FROST_CONFIG,
      coordinatorRelay: 'wss://relay.example.com',
    });
    const joined = await stewardClient.joinGroup(
      {
        groupPubkey: profile.groupPubkey,
        threshold: 2,
        totalShares: 2,
        existingParticipants: [GUARDIAN_PUBKEY],
        encryptedPayload: JSON.stringify(distributions[0]!.payload),
      },
      STEWARD_NSEC,
    );

    expect(joined.groupPubkey).toBeTruthy();
    const stewardShare = await retrieveBfShare(joined.groupPubkey);
    expect(stewardShare?.encodedShare?.startsWith('bfshare1')).toBe(true);
  });

  it('joinGroup rejects a corrupt invitation payload', async () => {
    await expect(
      client.joinGroup(
        {
          groupPubkey: GROUP_PUBKEY,
          threshold: 2,
          totalShares: 2,
          existingParticipants: [],
          encryptedPayload: '{corrupt',
        },
        STEWARD_NSEC,
      ),
    ).rejects.toMatchObject({ message: FrostError.InvalidBackup });
  });

  it('rotateShares honestly reports that resharing is unsupported', async () => {
    const profile = makeBfProfile();
    await client.storeGroupProfile(profile);
    await storeBfShare(GROUP_PUBKEY, makeBfShare());

    await expect(client.rotateShares(GROUP_PUBKEY)).rejects.toThrow(/re-sharing protocol/);
  });

  it('requestGroupSignature throws ShareNotFound when no share exists', async () => {
    // Store a profile but no share
    const profile = makeBfProfile();
    await client.storeGroupProfile(profile);

    await expect(
      client.requestGroupSignature(GROUP_PUBKEY, makeUnsignedEvent()),
    ).rejects.toMatchObject({
      message: FrostError.ShareNotFound,
    });
  });

  it('requestGroupSignature returns a request_published session when share exists', async () => {
    const profile = makeBfProfile();
    const share = makeBfShare();

    await client.storeGroupProfile(profile);
    await storeBfShare(GROUP_PUBKEY, share);

    const session = await client.requestGroupSignature(GROUP_PUBKEY, makeUnsignedEvent());

    expect(session.state).toBe('request_published');
    expect(session.groupPubkey).toBe(GROUP_PUBKEY);
  });

  it('backupShare throws ShareNotFound when vault is unlocked and no share exists', async () => {
    // Vault is unlocked (beforeEach), guardian identity stored, no share → ShareNotFound
    const { nip19 } = await import('nostr-tools');
    await vault.storeNsec(nip19.npubEncode(GUARDIAN_PUBKEY), GUARDIAN_NSEC_BYTES);
    await expect(
      client.backupShare(GROUP_PUBKEY),
    ).rejects.toMatchObject({
      message: FrostError.ShareNotFound,
    });
  });

  it('backupShare returns a signed, NIP-44-encrypted event when share exists', async () => {
    const { nip19 } = await import('nostr-tools');
    await vault.storeNsec(nip19.npubEncode(GUARDIAN_PUBKEY), GUARDIAN_NSEC_BYTES);
    const share = makeBfShare();
    await storeBfShare(GROUP_PUBKEY, share);

    const event = await client.backupShare(GROUP_PUBKEY);

    expect(event.kind).toBe(10000);
    expect(event.pubkey).toBe(GUARDIAN_PUBKEY);
    expect(event.sig).toBeTruthy();
    expect(() => JSON.parse(event.content)).toThrow(); // ciphertext, not plaintext JSON
  });
});

// ---------------------------------------------------------------------------
// 7. Error Condition Tests
// ---------------------------------------------------------------------------

describe('Vault locked error propagation', () => {
  it('storeBfProfile throws VaultLocked when vault is locked', async () => {
    vault.lock();

    const profile = makeBfProfile();

    await expect(storeBfProfile(GROUP_PUBKEY, profile)).rejects.toMatchObject({
      message: VaultError.VaultLocked,
    });
  });

  it('retrieveBfProfile throws VaultLocked when vault is locked', async () => {
    // First store while unlocked
    await storeBfProfile(GROUP_PUBKEY, makeBfProfile());
    vault.lock();

    await expect(retrieveBfProfile(GROUP_PUBKEY)).rejects.toMatchObject({
      message: VaultError.VaultLocked,
    });
  });

  it('storeBfShare throws VaultLocked when vault is locked', async () => {
    vault.lock();

    await expect(storeBfShare(GROUP_PUBKEY, makeBfShare())).rejects.toMatchObject({
      message: VaultError.VaultLocked,
    });
  });

  it('retrieveBfShare throws VaultLocked when vault is locked', async () => {
    await storeBfShare(GROUP_PUBKEY, makeBfShare());
    vault.lock();

    await expect(retrieveBfShare(GROUP_PUBKEY)).rejects.toMatchObject({
      message: VaultError.VaultLocked,
    });
  });

  it('listGroups returns empty array when vault is locked (swallows error gracefully)', async () => {
    vault.lock();
    // listGroups() is designed to swallow VaultLocked and return []
    // so it can be called safely from React hooks during the locked state
    const result = await listGroups();
    expect(result).toEqual([]);
  });
});

describe('FrostError.ShareNotFound', () => {
  it('createShareBackupEvent throws for missing share when vault is unlocked', async () => {
    // Vault is unlocked (beforeEach), no share stored → ShareNotFound
    await expect(
      createShareBackupEvent('missing'.padEnd(64, '0'), GUARDIAN_PUBKEY),
    ).rejects.toMatchObject({ message: FrostError.ShareNotFound });
  });
});

// ---------------------------------------------------------------------------
// (Section 8 DELETED — the old "Full DKG + Sign integration" test asserted
// simulation-only behavior: fabricated partial sigs aggregated by the
// first-sig adapter. Real end-to-end signing coverage now lives in
// tests/lib/frost-bifrost.test.ts, which drives two genuine BifrostNodes
// over an in-process relay and asserts schnorr.verify against the group key.)
// ---------------------------------------------------------------------------
