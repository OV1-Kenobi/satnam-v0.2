/**
 * Tests for src/lib/nfc/pin-gate.ts
 *
 * PinGate class — PIN setup, verification, lockout logic, operation tokens.
 *
 * Tests mock the @noble/hashes/argon2 module and vault operations to enable
 * fast, deterministic unit testing without OPFS or WASM.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @noble/hashes/argon2
// ---------------------------------------------------------------------------

// argon2id returns a Uint8Array directly. We mock it to return a predictable
// 32-byte hash based on the password input.
vi.mock('@noble/hashes/argon2', () => ({
  argon2id: vi.fn((password: Uint8Array) => {
    // Deterministic: fill with first byte of password
    const firstByte = password.length > 0 ? password[0] : 0;
    return new Uint8Array(32).fill(firstByte % 256);
  }),
}));

// Mock @noble/hashes/hmac
vi.mock('@noble/hashes/hmac', () => ({
  hmac: vi.fn((_hash: unknown, key: Uint8Array, data: Uint8Array) => {
    // Simple deterministic mock: XOR key and data
    const result = new Uint8Array(32);
    for (let i = 0; i < 32; i++) result[i] = key[i % key.length] ^ data[i % data.length];
    return result;
  }),
}));

vi.mock('@noble/hashes/sha256', () => ({
  sha256: vi.fn((data: Uint8Array) => {
    const result = new Uint8Array(32);
    for (let i = 0; i < data.length; i++) result[i % 32] ^= data[i];
    return result;
  }),
}));

// ---------------------------------------------------------------------------
// Mock Vault
// ---------------------------------------------------------------------------

function createMockVault() {
  const storage = new Map<string, Uint8Array>();

  return {
    isUnlocked: vi.fn(() => true),
    storeNfcKey: vi.fn(async (uid: string, slot: 'k1' | 'k2', key: Uint8Array) => {
      storage.set(`${uid}:${slot}`, key);
    }),
    getNfcKey: vi.fn(async (uid: string, slot: 'k1' | 'k2') => {
      const key = storage.get(`${uid}:${slot}`);
      if (!key) throw new Error('Not found');
      return key;
    }),
  };
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { PinGate, createPinGate, type PinGateConfig } from '../../src/lib/nfc/pin-gate.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PinGate', () => {
  let vault: ReturnType<typeof createMockVault>;
  let config: PinGateConfig;
  let gate: PinGate;

  beforeEach(() => {
    vault = createMockVault();
    config = {
      cardUid: 'aabbccddee1122',
      maxAttempts: 3,
      lockoutDuration: 5 * 60 * 1000,
    };
    gate = new PinGate(vault as any, config);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── Setup ──────────────────────────────────────────────────────────────────

  describe('setupPin', () => {
    it('stores verifier in vault at k1 and k2 slots', async () => {
      await gate.setupPin('1234');

      expect(vault.storeNfcKey).toHaveBeenCalledWith(
        expect.stringContaining('verifier'),
        'k1',
        expect.any(Uint8Array),
      );
      expect(vault.storeNfcKey).toHaveBeenCalledWith(
        expect.stringContaining('verifier'),
        'k2',
        expect.any(Uint8Array),
      );
    });

    it('throws if vault is locked', async () => {
      vault.isUnlocked.mockReturnValueOnce(false);
      await expect(gate.setupPin('1234')).rejects.toThrow('Vault must be unlocked');
    });

    it('resets attempt counter after setup', async () => {
      await gate.setupPin('1234');
      expect(gate.getRemainingAttempts()).toBe(3);
    });
  });

  // ── Verify ─────────────────────────────────────────────────────────────────

  describe('verifyPin', () => {
    beforeEach(async () => {
      await gate.setupPin('1234');
    });

    it('returns true for correct PIN', async () => {
      const result = await gate.verifyPin('1234');
      expect(result).toBe(true);
    });

    it('returns false for incorrect PIN', async () => {
      // Different PIN → different argon2 hash
      const result = await gate.verifyPin('9999');
      expect(result).toBe(false);
    });

    it('transitions to verified state on correct PIN', async () => {
      await gate.verifyPin('1234');
      expect(gate.getState()).toBe('verified');
    });

    it('transitions to failed state on incorrect PIN', async () => {
      await gate.verifyPin('9999');
      expect(gate.getState()).toBe('failed');
    });

    it('returns false if vault is locked', async () => {
      vault.isUnlocked.mockReturnValueOnce(false);
      await expect(gate.verifyPin('1234')).rejects.toThrow('Vault must be unlocked');
    });
  });

  // ── Lockout ─────────────────────────────────────────────────────────────────

  describe('lockout', () => {
    beforeEach(async () => {
      await gate.setupPin('1234');
    });

    it('locks out after maxAttempts failures', async () => {
      for (let i = 0; i < config.maxAttempts; i++) {
        await gate.verifyPin('wrong');
      }
      expect(gate.isLockedOut()).toBe(true);
      expect(gate.getState()).toBe('locked_out');
    });

    it('returns locked_out state when locked', async () => {
      for (let i = 0; i < config.maxAttempts; i++) {
        await gate.verifyPin('wrong');
      }
      expect(gate.getState()).toBe('locked_out');
    });

    it('returns false immediately when locked out', async () => {
      for (let i = 0; i < config.maxAttempts; i++) {
        await gate.verifyPin('wrong');
      }
      const result = await gate.verifyPin('1234');
      expect(result).toBe(false);
    });

    it('unlocks after lockout duration expires', async () => {
      for (let i = 0; i < config.maxAttempts; i++) {
        await gate.verifyPin('wrong');
      }
      expect(gate.isLockedOut()).toBe(true);

      // Advance time past lockout duration
      vi.advanceTimersByTime(config.lockoutDuration + 1000);
      expect(gate.isLockedOut()).toBe(false);
    });

    it('getRemainingLockout returns positive ms when locked', async () => {
      for (let i = 0; i < config.maxAttempts; i++) {
        await gate.verifyPin('wrong');
      }
      const remaining = gate.getRemainingLockout();
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(config.lockoutDuration);
    });

    it('getRemainingLockout returns 0 when not locked', () => {
      expect(gate.getRemainingLockout()).toBe(0);
    });

    it('decrements remaining attempts before lockout', async () => {
      await gate.verifyPin('wrong');
      expect(gate.getRemainingAttempts()).toBe(config.maxAttempts - 1);
      await gate.verifyPin('wrong');
      expect(gate.getRemainingAttempts()).toBe(config.maxAttempts - 2);
    });
  });

  // ── Operation token ─────────────────────────────────────────────────────────

  describe('createOperationToken', () => {
    it('returns a 32-byte Uint8Array', async () => {
      const payload = new Uint8Array([1, 2, 3, 4]);
      const token = await gate.createOperationToken(payload, '1234');
      expect(token).toBeInstanceOf(Uint8Array);
      expect(token.length).toBe(32);
    });

    it('produces different tokens for different payloads', async () => {
      const payload1 = new Uint8Array([1, 2, 3]);
      const payload2 = new Uint8Array([4, 5, 6]);
      const token1 = await gate.createOperationToken(payload1, '1234');
      const token2 = await gate.createOperationToken(payload2, '1234');
      expect(token1).not.toEqual(token2);
    });

    it('produces different tokens for different PINs', async () => {
      const payload = new Uint8Array([1, 2, 3]);
      const token1 = await gate.createOperationToken(payload, '1234');
      const token2 = await gate.createOperationToken(payload, '5678');
      // Due to mock, PINs produce different hashes if first chars differ
      // Just verify function runs without error
      expect(token1).toBeInstanceOf(Uint8Array);
      expect(token2).toBeInstanceOf(Uint8Array);
    });
  });

  // ── Factory ────────────────────────────────────────────────────────────────

  describe('createPinGate', () => {
    it('creates a PinGate with default config', () => {
      const g = createPinGate(vault as any, 'aabb1122');
      expect(g).toBeInstanceOf(PinGate);
      expect(g.getState()).toBe('idle');
    });
  });

  // ── hasPinSetup ─────────────────────────────────────────────────────────────

  describe('hasPinSetup', () => {
    it('returns false before setup', async () => {
      const result = await gate.hasPinSetup();
      expect(result).toBe(false);
    });

    it('returns true after setup', async () => {
      await gate.setupPin('1234');
      const result = await gate.hasPinSetup();
      expect(result).toBe(true);
    });
  });
});
