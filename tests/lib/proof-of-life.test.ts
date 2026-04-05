/**
 * Tests for src/lib/nfc/proof-of-life.ts
 *
 * ProofOfLifeService — state machine transitions, CMAC verification, event signing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('argon2-browser', () => ({
  default: {
    hash: vi.fn(async ({ pass }: { pass: string }) => ({
      hash: new Uint8Array(32).fill(pass.charCodeAt(0) % 256),
    })),
    ArgonType: { Argon2id: 2 },
  },
}));

vi.mock('@noble/hashes/sha256', () => ({
  sha256: vi.fn((data: Uint8Array) => {
    const result = new Uint8Array(32);
    for (let i = 0; i < data.length; i++) result[i % 32] ^= data[i];
    return result;
  }),
}));

vi.mock('@noble/hashes/utils', () => ({
  bytesToHex: (bytes: Uint8Array) =>
    Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''),
  hexToBytes: (hex: string) => {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    return arr;
  },
  utf8ToBytes: (s: string) => new TextEncoder().encode(s),
}));

// Mock NTAG424 production manager
vi.mock('../../src/lib/nfc/ntag424.js', () => ({
  NTAG424ProductionManager: vi.fn().mockImplementation(() => ({
    verifySUNMessage: vi.fn(async (msg: string) => {
      // Return valid for non-empty CMAC
      if (msg.includes('validcmac')) {
        return { valid: true, counter: 42 };
      }
      return { valid: false, error: 'CMAC verification failed' };
    }),
  })),
}));

// Mock nostr-tools
vi.mock('nostr-tools', () => ({
  finalizeEvent: vi.fn((template: unknown, _secretKey: unknown) => ({
    ...(template as object),
    id: '00'.repeat(32),
    sig: '00'.repeat(64),
    pubkey: 'aa'.repeat(32),
  })),
  getPublicKey: vi.fn((_key: Uint8Array) => 'aa'.repeat(32)),
  nip19: {
    decode: vi.fn((nsec: string) => {
      if (nsec.startsWith('nsec1')) {
        return { type: 'nsec', data: new Uint8Array(32) };
      }
      throw new Error('Invalid nsec');
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock PinGate
// ---------------------------------------------------------------------------

function createMockPinGate(verifyResult = true, locked = false) {
  return {
    isLockedOut: vi.fn(() => locked),
    getRemainingLockout: vi.fn(() => locked ? 300000 : 0),
    getRemainingAttempts: vi.fn(() => locked ? 0 : 3),
    verifyPin: vi.fn(async (_pin: string) => verifyResult),
  };
}

// ---------------------------------------------------------------------------
// Mock Vault
// ---------------------------------------------------------------------------

function createMockVault() {
  const storage = new Map<string, Uint8Array>();
  return {
    isUnlocked: vi.fn(() => true),
    storeNfcKey: vi.fn(async (uid: string, slot: string, key: Uint8Array) => {
      storage.set(`${uid}:${slot}`, key);
    }),
    getNfcKey: vi.fn(async (uid: string, slot: string) => {
      const key = storage.get(`${uid}:${slot}`);
      if (!key) throw new Error(`Not found: ${uid}:${slot}`);
      return key;
    }),
  };
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  ProofOfLifeService,
  POL_EVENT_KIND,
  POL_D_TAG,
  hashCardUid,
  type PolCeremony,
} from '../../src/lib/nfc/proof-of-life.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProofOfLifeService', () => {
  let vault: ReturnType<typeof createMockVault>;
  let pinGate: ReturnType<typeof createMockPinGate>;
  let service: ProofOfLifeService;
  const GUARDIAN_PUBKEY = 'aa'.repeat(32);
  const CARD_UID = 'aabbccdd1122';

  beforeEach(() => {
    vault = createMockVault();
    pinGate = createMockPinGate();
    service = new ProofOfLifeService(vault as any, pinGate as any);
  });

  // ── initiate ──────────────────────────────────────────────────────────────

  describe('initiate', () => {
    it('creates a ceremony in INITIATED state', async () => {
      const ceremony = await service.initiate(GUARDIAN_PUBKEY);
      expect(ceremony.state).toBe('INITIATED');
      expect(ceremony.guardianPubkey).toBe(GUARDIAN_PUBKEY);
      expect(ceremony.timestamp).toBeGreaterThan(0);
    });

    it('generates valid timestamp in unix seconds', async () => {
      const before = Math.floor(Date.now() / 1000);
      const ceremony = await service.initiate(GUARDIAN_PUBKEY);
      const after = Math.floor(Date.now() / 1000);
      expect(ceremony.timestamp).toBeGreaterThanOrEqual(before);
      expect(ceremony.timestamp).toBeLessThanOrEqual(after);
    });
  });

  // ── processCardTap ─────────────────────────────────────────────────────────

  describe('processCardTap', () => {
    let initiated: PolCeremony;

    beforeEach(async () => {
      initiated = await service.initiate(GUARDIAN_PUBKEY);
    });

    it('returns FAILED if called in wrong state', async () => {
      const inBadState = { ...initiated, state: 'CARD_TAPPED' as const };
      const result = await service.processCardTap(inBadState, CARD_UID, 'validcmac');
      expect(result.state).toBe('FAILED');
    });

    it('returns FAILED if SUN key not found in vault', async () => {
      const result = await service.processCardTap(initiated, CARD_UID, 'validcmac');
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('SUN key not found');
    });

    it('returns CARD_TAPPED when SUN key available and CMAC valid', async () => {
      // Store a SUN key for the card
      await vault.storeNfcKey(CARD_UID.slice(0, 14), 'k2', new Uint8Array(16));
      // The piccData format: 14 char cardUid + rest
      const piccData = CARD_UID.slice(0, 14);
      const result = await service.processCardTap(initiated, piccData, 'validcmac');
      expect(result.state).toBe('CARD_TAPPED');
    });

    it('returns FAILED when CMAC is invalid', async () => {
      await vault.storeNfcKey(CARD_UID.slice(0, 14), 'k2', new Uint8Array(16));
      const piccData = CARD_UID.slice(0, 14);
      const result = await service.processCardTap(initiated, piccData, 'invalidcmac');
      expect(result.state).toBe('FAILED');
    });
  });

  // ── processPin ─────────────────────────────────────────────────────────────

  describe('processPin', () => {
    let cardTapped: PolCeremony;

    beforeEach(async () => {
      cardTapped = {
        state: 'CARD_TAPPED',
        cardUid: CARD_UID,
        cardUidHash: 'aabbcc',
        guardianPubkey: GUARDIAN_PUBKEY,
        timestamp: Math.floor(Date.now() / 1000),
        cmacCounter: 42,
      };
    });

    it('returns PIN_VERIFIED on correct PIN', async () => {
      const result = await service.processPin(cardTapped, '1234');
      expect(result.state).toBe('PIN_VERIFIED');
    });

    it('returns FAILED on incorrect PIN', async () => {
      pinGate.verifyPin.mockResolvedValueOnce(false);
      const result = await service.processPin(cardTapped, '9999');
      expect(result.state).toBe('FAILED');
    });

    it('returns FAILED if gate is locked out', async () => {
      pinGate.isLockedOut.mockReturnValueOnce(true);
      const result = await service.processPin(cardTapped, '1234');
      expect(result.state).toBe('FAILED');
      expect(result.error).toContain('locked out');
    });

    it('returns FAILED if called in wrong state', async () => {
      const wrongState = { ...cardTapped, state: 'INITIATED' as const };
      const result = await service.processPin(wrongState, '1234');
      expect(result.state).toBe('FAILED');
    });
  });

  // ── sign ───────────────────────────────────────────────────────────────────

  describe('sign', () => {
    const pinVerified: PolCeremony = {
      state: 'PIN_VERIFIED',
      cardUid: CARD_UID,
      cardUidHash: 'aabbcc',
      guardianPubkey: GUARDIAN_PUBKEY,
      timestamp: Math.floor(Date.now() / 1000),
      cmacCounter: 42,
    };

    it('transitions to SIGNED state', async () => {
      const result = await service.sign(pinVerified, '00'.repeat(32));
      expect(result.state).toBe('SIGNED');
    });

    it('attaches signed event to ceremony', async () => {
      const result = await service.sign(pinVerified, '00'.repeat(32));
      expect(result.signedEvent).toBeDefined();
    });

    it('creates kind:30078 event', async () => {
      const result = await service.sign(pinVerified, '00'.repeat(32));
      expect((result.signedEvent as any).kind).toBe(POL_EVENT_KIND);
    });

    it('includes d-tag with correct value', async () => {
      const result = await service.sign(pinVerified, '00'.repeat(32));
      const tags = (result.signedEvent as any).tags as string[][];
      const dTag = tags.find(t => t[0] === 'd');
      expect(dTag?.[1]).toBe(POL_D_TAG);
    });

    it('returns FAILED in wrong state', async () => {
      const wrong = { ...pinVerified, state: 'CARD_TAPPED' as const };
      const result = await service.sign(wrong, '00'.repeat(32));
      expect(result.state).toBe('FAILED');
    });

    it('accepts nsec bech32 format', async () => {
      // Mock nip19 handles nsec1 prefix
      const result = await service.sign(pinVerified, 'nsec1' + 'q'.repeat(59));
      expect(result.state).toBe('SIGNED');
    });
  });

  // ── hashCardUid ─────────────────────────────────────────────────────────────

  describe('hashCardUid', () => {
    it('returns a 64-char hex string', () => {
      const hash = hashCardUid(CARD_UID);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });

    it('produces consistent output for same input', () => {
      expect(hashCardUid(CARD_UID)).toBe(hashCardUid(CARD_UID));
    });

    it('produces different outputs for different UIDs', () => {
      const h1 = hashCardUid('aabbccdd1122');
      const h2 = hashCardUid('112233445566');
      expect(h1).not.toBe(h2);
    });
  });

  // ── constants ──────────────────────────────────────────────────────────────

  describe('constants', () => {
    it('POL_EVENT_KIND is 30078', () => {
      expect(POL_EVENT_KIND).toBe(30078);
    });

    it('POL_D_TAG is satnam:proof-of-life', () => {
      expect(POL_D_TAG).toBe('satnam:proof-of-life');
    });
  });
});
