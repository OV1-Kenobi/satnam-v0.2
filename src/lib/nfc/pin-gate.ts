/**
 * @module nfc/pin-gate
 * @description PIN gate state machine for NFC-triggered identity operations.
 *
 * Every NFC-triggered operation that modifies identity state requires PIN
 * confirmation before execution.
 *
 * PIN verification flow (from spec §5.3):
 * 1. User taps card → CMAC verified client-side.
 * 2. UI presents PIN entry dialog.
 * 3. User enters PIN (4–8 digits).
 * 4. Client derives verifier: argon2id(pin, card_uid_as_salt, { m: 65536, t: 3, p: 4 }) → 32 bytes.
 * 5. Client compares verifier against stored verifier in OPFS Vault at nfc/{card_uid}.pin_verifier.
 * 6. If PIN is correct: construct a PIN-bound operation token: HMAC-SHA256(payload, pin_derived_key).
 *
 * Uses argon2-browser (WASM) for PIN key derivation — NOT @noble/hashes/argon2
 * (which lacks the parallelism parameter in the browser build).
 *
 * @see SPECIFICATION.md §5.3 — PIN Gate
 */

import argon2 from 'argon2-browser';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

import type { VaultOps } from '../vault/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PinGateConfig {
  /** Card UID — used as argon2id salt for PIN derivation. */
  cardUid: string;
  /** Maximum PIN attempts before lockout. Default: 5 */
  maxAttempts: number;
  /** Lockout duration in milliseconds. Default: 300_000 (5 min) */
  lockoutDuration: number;
}

export type PinGateState =
  | 'idle'
  | 'awaiting_pin'
  | 'verifying'
  | 'verified'
  | 'locked_out'
  | 'failed';

/** PIN-gated operations per spec §5.3 */
export type PinGatedOperation =
  | 'contact_add'
  | 'contact_remove'
  | 'proof_of_life'
  | 'payment_above_threshold'
  | 'group_membership_change'
  | 'agent_delegation_change'
  /** NIP-17 DM to a PoL-verified contact requires NFC card tap + PIN */
  | 'message_send'
  /** Zap payment to a PoL-verified contact requires NFC card tap + PIN */
  | 'zap_send';

/** argon2id parameters per spec §5.3 */
const ARGON2_PARAMS = { m: 65536, t: 3, p: 4 } as const;

/** Derived key length (bytes) */
const KEY_LEN = 32;

/** Vault path for the PIN verifier: nfc/{card_uid}.pin_verifier */
function pinVerifierPath(cardUid: string): string {
  return `nfc/${cardUid}.pin_verifier`;
}

/** Vault path for attempt counter: nfc/{card_uid}.pin_attempts */
function pinAttemptsPath(cardUid: string): string {
  return `nfc/${cardUid}.pin_attempts`;
}

// ---------------------------------------------------------------------------
// Attempt state persistence helpers
// ---------------------------------------------------------------------------

interface AttemptState {
  count: number;
  lockedUntil: number; // unix ms, 0 = not locked
}

// ---------------------------------------------------------------------------
// PinGate Class
// ---------------------------------------------------------------------------

export class PinGate {
  private state: PinGateState = 'idle';
  private attemptState: AttemptState = { count: 0, lockedUntil: 0 };

  constructor(
    private readonly vault: VaultOps,
    private readonly config: PinGateConfig,
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Set up a new PIN for a card.
   *
   * Derives verifier: argon2id(pin, card_uid_as_salt, {m:65536,t:3,p:4}) → 32 bytes.
   * Stores verifier in OPFS Vault at nfc/{card_uid}.pin_verifier.
   *
   * @param pin - PIN string (4–8 digits)
   */
  async setupPin(pin: string): Promise<void> {
    if (!this.vault.isUnlocked()) {
      throw new Error('Vault must be unlocked to set up PIN');
    }

    const verifier = await this._deriveVerifier(pin);
    await this._storeVerifier(verifier);
    this.attemptState = { count: 0, lockedUntil: 0 };
    await this._persistAttemptState();
    this.state = 'idle';
  }

  /**
   * Verify a PIN entry.
   *
   * Derives verifier from input, compares against stored verifier in constant
   * time. Tracks attempt count and enforces lockout after maxAttempts failures.
   *
   * @param pin - PIN string to verify
   * @returns true if PIN is correct, false otherwise
   */
  async verifyPin(pin: string): Promise<boolean> {
    if (!this.vault.isUnlocked()) {
      throw new Error('Vault must be unlocked to verify PIN');
    }

    // Enforce lockout
    if (this.isLockedOut()) {
      this.state = 'locked_out';
      return false;
    }

    this.state = 'verifying';
    await this._loadAttemptState();

    try {
      const storedVerifier = await this._loadVerifier();
      const inputVerifier = await this._deriveVerifier(pin);

      const match = timingSafeEqual(inputVerifier, storedVerifier);

      if (match) {
        this.resetAttempts();
        await this._persistAttemptState();
        this.state = 'verified';
        return true;
      } else {
        this.attemptState.count += 1;
        if (this.attemptState.count >= this.config.maxAttempts) {
          this.attemptState.lockedUntil = Date.now() + this.config.lockoutDuration;
          this.state = 'locked_out';
        } else {
          this.state = 'failed';
        }
        await this._persistAttemptState();
        return false;
      }
    } catch {
      this.state = 'failed';
      return false;
    }
  }

  /**
   * Create a PIN-bound operation token.
   * HMAC-SHA256(operation_payload, pin_derived_key)
   *
   * @param operationPayload - Raw bytes of the operation to authorize
   * @param pin - PIN string
   * @returns 32-byte HMAC-SHA256 token
   */
  async createOperationToken(
    operationPayload: Uint8Array,
    pin: string,
  ): Promise<Uint8Array> {
    const key = await this._deriveKey(pin);
    return hmac(sha256, key, operationPayload);
  }

  /**
   * Returns true if the gate is currently locked out.
   */
  isLockedOut(): boolean {
    if (this.attemptState.lockedUntil === 0) return false;
    if (Date.now() < this.attemptState.lockedUntil) return true;
    // Lockout expired — reset
    this.attemptState = { count: 0, lockedUntil: 0 };
    return false;
  }

  /**
   * Remaining lockout time in milliseconds (0 if not locked out).
   */
  getRemainingLockout(): number {
    if (!this.isLockedOut()) return 0;
    return Math.max(0, this.attemptState.lockedUntil - Date.now());
  }

  /**
   * Current state machine state.
   */
  getState(): PinGateState {
    if (this.isLockedOut()) return 'locked_out';
    return this.state;
  }

  /**
   * Number of remaining attempts before lockout.
   */
  getRemainingAttempts(): number {
    return Math.max(0, this.config.maxAttempts - this.attemptState.count);
  }

  /**
   * Returns true if a PIN verifier has been set up for this card.
   */
  async hasPinSetup(): Promise<boolean> {
    try {
      await this._loadVerifier();
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Derive the 32-byte PIN verifier via argon2id.
   * Salt = UTF-8 bytes of cardUid (hex string).
   */
  private async _deriveVerifier(pin: string): Promise<Uint8Array> {
    const result = await argon2.hash({
      pass: pin,
      salt: this.config.cardUid,
      time: ARGON2_PARAMS.t,
      mem: ARGON2_PARAMS.m,
      parallelism: ARGON2_PARAMS.p,
      hashLen: KEY_LEN,
      type: argon2.ArgonType.Argon2id,
    });
    return result.hash;
  }

  /**
   * Derive a 32-byte key from PIN (same as verifier — verifier IS the key).
   */
  private async _deriveKey(pin: string): Promise<Uint8Array> {
    return this._deriveVerifier(pin);
  }

  /**
   * Store verifier in OPFS Vault at a custom path via a small workaround.
   * The VaultOps interface doesn't have a raw put method — we use storeNfcKey
   * variant. Since pin_verifier is 32 bytes we store it as a synthetic key slot.
   */
  private async _storeVerifier(verifier: Uint8Array): Promise<void> {
    // We use a generic blob store pattern via the vault's raw storage.
    // Since VaultOps only exposes typed methods, we encode the verifier
    // as two 16-byte halves and store in k1/k2 equivalent slots on a
    // synthetic "pin_verifier" card UID.
    //
    // Convention: cardUid + "#verifier_lo" → first 16 bytes
    //             cardUid + "#verifier_hi" → last 16 bytes
    const lo = verifier.slice(0, 16);
    const hi = verifier.slice(16, 32);
    await this.vault.storeNfcKey(this.config.cardUid + '#verifier', 'k1', lo);
    await this.vault.storeNfcKey(this.config.cardUid + '#verifier', 'k2', hi);
  }

  private async _loadVerifier(): Promise<Uint8Array> {
    const lo = await this.vault.getNfcKey(this.config.cardUid + '#verifier', 'k1');
    const hi = await this.vault.getNfcKey(this.config.cardUid + '#verifier', 'k2');
    const verifier = new Uint8Array(32);
    verifier.set(lo, 0);
    verifier.set(hi, 16);
    return verifier;
  }

  private async _persistAttemptState(): Promise<void> {
    // Store attempt state as JSON encoded in a 16-byte slot.
    // We serialize into 16 bytes by storing count(2) + lockedUntil(8) + padding.
    const json = JSON.stringify(this.attemptState);
    const encoded = utf8ToBytes(json);
    // Pad to 16 bytes or store as multi-chunk via k1/k2
    // For simplicity: store hash of json as k1 and raw json as separate hash
    // Real impl: use vault's generic raw store. For now we store in a sentinel.
    const padded = new Uint8Array(16);
    padded.set(encoded.slice(0, 16));
    await this.vault.storeNfcKey(this.config.cardUid + '#attempts', 'k1', padded);
    // Store count as separate 16-byte block
    const countBuf = new Uint8Array(16);
    const view = new DataView(countBuf.buffer);
    view.setUint32(0, this.attemptState.count, true);
    view.setFloat64(4, this.attemptState.lockedUntil, true);
    await this.vault.storeNfcKey(this.config.cardUid + '#attempts', 'k2', countBuf);
  }

  private async _loadAttemptState(): Promise<void> {
    try {
      const countBuf = await this.vault.getNfcKey(this.config.cardUid + '#attempts', 'k2');
      const view = new DataView(countBuf.buffer);
      this.attemptState = {
        count: view.getUint32(0, true),
        lockedUntil: view.getFloat64(4, true),
      };
    } catch {
      // No attempt state stored yet — use defaults
      this.attemptState = { count: 0, lockedUntil: 0 };
    }
  }

  private resetAttempts(): void {
    this.attemptState = { count: 0, lockedUntil: 0 };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Constant-time comparison of two Uint8Arrays.
 * Prevents timing attacks that could reveal the verifier value.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPinGate(vault: VaultOps, cardUid: string): PinGate {
  return new PinGate(vault, {
    cardUid,
    maxAttempts: 5,
    lockoutDuration: 5 * 60 * 1000, // 5 minutes
  });
}

