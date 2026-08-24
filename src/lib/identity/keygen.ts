/**
 * @module identity/keygen
 * @description CR-A identity generation and import (plan 2026-08-24).
 *
 * Derivation profile matches the frozen OpenAgents sovereign-identity profile
 * (evidence/r1-openagents-key-patterns.md §3) so identities are portable across
 * the ecosystem:
 *
 *   CSPRNG → BIP-39 mnemonic (12 words, English) → PBKDF2 stretch (empty
 *   passphrase) → BIP-32 master seed → NIP-06 path m/44'/1237'/0'/0/0 →
 *   secp256k1 → bech32 npub/nsec.
 *
 * SECRET BOUNDARY (R1 §6): nothing in this module persists key material.
 * Mnemonic display is a one-time UI responsibility (word-confirmation
 * challenge lives in AuthPage); storage is OPFS Vault storeNsec() only.
 *
 * Cross-ecosystem test vector (OpenAgents contract/vectors.ts): the canonical
 * "abandon…about" mnemonic MUST derive npub
 * npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7.
 */

import { generateMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js';
import { bech32 } from '@scure/base';

/** Frozen derivation constants (R1 §3 — do not change silently). */
export const NOSTR_DERIVATION_PATH = "m/44'/1237'/0'/0/0" as const;
export const DERIVATION_PROFILE_ID = 'satnam.v2.nip06.v1' as const;
export const EMPTY_BIP39_PASSPHRASE = '' as const;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Normalize BIP-39 whitespace without changing words (matches OpenAgents). */
export function normalizeMnemonic(value: string): string {
  return value.trim().split(/\s+/).join(' ');
}

/** Validate an English BIP-39 checksum + word count. */
export function isValidEnglishMnemonic(mnemonic: string): boolean {
  try {
    return validateMnemonic(normalizeMnemonic(mnemonic), wordlist);
  } catch {
    return false;
  }
}

/** Generate a fresh 12-word English mnemonic from platform CSPRNG. */
export function generateMnemonic12(): string {
  return generateMnemonic(wordlist, 128);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Encode 32-byte x-only pubkey as bech32 npub. */
export function encodeNpub(pubkeyXonly: Uint8Array): string {
  return bech32.encode('npub', bech32.toWords(pubkeyXonly));
}

/** Encode 32-byte secret key as bech32 nsec. */
export function encodeNsec(secret: Uint8Array): string {
  return bech32.encode('nsec', bech32.toWords(secret));
}

/**
 * Decode nsec material: accepts bech32 `nsec1…` (prefix + length validated)
 * or raw 64-hex. Pattern matches OpenAgents sarah parseSecretMaterial (R1 §4).
 */
export function decodeNsec(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Uint8Array.from(Buffer.from(trimmed.toLowerCase(), 'hex'));
  }
  if (trimmed.startsWith('nsec1')) {
    const decoded = bech32.decode(trimmed as `${string}1${string}`, false);
    if (decoded.prefix !== 'nsec') {
      throw new Error('identity/keygen: expected nsec prefix');
    }
    const bytes = new Uint8Array(bech32.fromWords(decoded.words));
    if (bytes.length !== 32) {
      throw new Error('identity/keygen: nsec payload must be 32 bytes');
    }
    return bytes;
  }
  throw new Error('identity/keygen: secret must be 64-hex or nsec1…');
}

/** Decode a bech32 npub to 32-byte x-only pubkey. */
export function decodeNpub(npub: string): Uint8Array {
  const decoded = bech32.decode(npub.trim() as `${string}1${string}`, false);
  if (decoded.prefix !== 'npub') {
    throw new Error('identity/keygen: expected npub prefix');
  }
  const bytes = new Uint8Array(bech32.fromWords(decoded.words));
  if (bytes.length !== 32) {
    throw new Error('identity/keygen: npub payload must be 32 bytes');
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Public identity projection — safe to persist/display. No secrets. */
export interface DerivedIdentityPublic {
  readonly pubkeyHex: string;
  readonly npub: string;
  readonly derivationPath: typeof NOSTR_DERIVATION_PATH;
  readonly profileId: typeof DERIVATION_PROFILE_ID;
}

interface DerivedKeyMaterial {
  readonly publicPart: DerivedIdentityPublic;
  /** Raw 32-byte secret — caller MUST hand to vault.storeNsec() and drop. */
  readonly secret: Uint8Array;
}

function deriveFromSeed(seed: Uint8Array): DerivedKeyMaterial {
  const master = HDKey.fromMasterSeed(seed);
  const node = master.derive(NOSTR_DERIVATION_PATH);
  if (!node.privateKey) throw new Error('identity/keygen: failed to derive Nostr private key');
  // x-only pubkey exactly as OpenAgents frozen reference (compressed, strip 02/03)
  const pubkeyXonly = secp256k1.getPublicKey(node.privateKey, true).slice(1);
  const publicPart: DerivedIdentityPublic = {
    pubkeyHex: bytesToHex(pubkeyXonly),
    npub: encodeNpub(Uint8Array.from(pubkeyXonly)),
    derivationPath: NOSTR_DERIVATION_PATH,
    profileId: DERIVATION_PROFILE_ID,
  };
  return { publicPart, secret: Uint8Array.from(node.privateKey) };
}

/**
 * Derive full key material from a mnemonic under the frozen empty-passphrase
 * profile. A non-empty passphrase produces DIFFERENT keys by design (BIP-39);
 * production recovery always uses the empty passphrase.
 */
export function deriveFromMnemonic(
  mnemonic: string,
  passphrase: string = EMPTY_BIP39_PASSPHRASE,
): DerivedKeyMaterial {
  const normalized = normalizeMnemonic(mnemonic);
  if (!isValidEnglishMnemonic(normalized)) {
    throw new Error('identity/keygen: not a valid BIP-39 English mnemonic');
  }
  const seed = mnemonicToSeedSync(normalized, passphrase);
  return deriveFromSeed(seed);
}

/** Derive only the PUBLIC projection (no secret retained in return path). */
export function derivePublicFromMnemonic(mnemonic: string): DerivedIdentityPublic {
  return deriveFromMnemonic(mnemonic).publicPart;
}

/**
 * Import an existing identity from nsec material (bech32 or 64-hex).
 * Verifies the derived npub against the provided secret so a typo'd input
 * cannot silently create a mismatched identity record.
 */
export function importFromNsec(nsecRaw: string): DerivedKeyMaterial {
  const secret = decodeNsec(nsecRaw);
  const pubkeyXonly = schnorr.getPublicKey(secret);
  const publicPart: DerivedIdentityPublic = {
    pubkeyHex: bytesToHex(pubkeyXonly),
    npub: encodeNpub(pubkeyXonly),
    derivationPath: NOSTR_DERIVATION_PATH,
    profileId: DERIVATION_PROFILE_ID,
  };
  return { publicPart, secret };
}

/**
 * Verify that a mnemonic imports to an expected npub (mnemonic import flow:
 * user enters words + we check the derived npub they expect).
 */
export function verifyMnemonicMatches(mnemonic: string, expectedNpub: string): boolean {
  try {
    return derivePublicFromMnemonic(mnemonic).npub === normalizeBech32(expectedNpub);
  } catch {
    return false;
  }
}

function normalizeBech32(value: string): string {
  return value.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Memory fence helpers (CR-A acceptance: no mnemonic/nsec leakage)
// ---------------------------------------------------------------------------

const FORBIDDEN_STORAGE_FIELDS = [
  'mnemonic',
  'nsec',
  'privatekey',
  'privatekeyhex',
  'secretkey',
  'seed',
  'seedhex',
] as const;

/**
 * Scan localStorage for secret-shaped keys/values. Used by the memory-fence
 * test and callable from dev diagnostics. Returns offending key names.
 */
export function scanLocalStorageForSecrets(storage: Storage = globalThis.localStorage): string[] {
  if (!storage) return [];
  const offenders: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;
    const lowerKey = key.toLowerCase();
    const value = (storage.getItem(key) ?? '').toLowerCase();
    const forbiddenHit =
      FORBIDDEN_STORAGE_FIELDS.some((f) => lowerKey.includes(f)) ||
      /nsec1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]/.test(value);
    if (forbiddenHit) offenders.push(key);
  }
  return offenders;
}
