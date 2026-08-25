/**
 * @module vault/vault
 * @description OPFS Vault — the sole permitted storage location for all secret
 * key material in Satnam v2. Implements the VaultOps interface from
 * SPECIFICATION.md §2.
 *
 * ## Architecture
 *
 * ```
 * OPFS satnam/vault/
 *   master.key          — AES-256-GCM ciphertext of 256-bit master key
 *   passphrase.salt     — 32-byte random salt (not secret)
 *   wrapping.meta       — JSON WrappingKeyMeta (not secret)
 *   identities/
 *     {npub}.nsec       — XChaCha20-Poly1305(masterKey, nsecBytes)
 *   frost/
 *     {group_npub}.bfprofile
 *     {group_npub}.bfshare
 *   nwc/
 *     {connection_id}.uri
 *   nfc/
 *     {card_uid}.k1
 *     {card_uid}.k2
 *   nip46/
 *     {session_id}.pairing
 *   agents/
 *     {agent_npub}.nsec
 *     {agent_npub}.llm_keys
 *   cashu/
 *     {mint_url_hash}.proofs
 * ```
 *
 * ## Key Derivation
 *
 * Passphrase path: argon2id(passphrase, salt, { m: 65536, t: 3, p: 4 }) → 32-byte wrapping key
 * WebAuthn path:   PRF extension output is the wrapping key directly (stub in non-browser env)
 *
 * All vault entries are encrypted with XChaCha20-Poly1305 using a fresh random
 * 24-byte nonce prepended to each ciphertext.
 *
 * @see SPECIFICATION.md §2 — OPFS Vault
 */

import { gcm } from '@noble/ciphers/aes';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { argon2id } from '@noble/hashes/argon2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8, randomBytes } from '@noble/hashes/utils';

import type {
  VaultOps,
  VaultConfig,
  VaultMethod,
  VaultSecondFactor,
  VaultSettings,
  Nip46PairingState,
  EncryptedLlmKeys,
  CashuProof,
  WrappingKeyMeta,
} from './types.js';
import { VaultError, DEFAULT_VAULT_CONFIG, DEFAULT_VAULT_SETTINGS } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** AES-256-GCM nonce length (bytes). */
const AES_GCM_NONCE_LEN = 12;

/** XChaCha20-Poly1305 nonce length (bytes). */
const XCHACHA_NONCE_LEN = 24;

/** argon2id parameters per SPECIFICATION.md §2.2. */
const ARGON2_PARAMS = { m: 65536, t: 3, p: 4 } as const;

/** Master key size (bytes). */
const MASTER_KEY_LEN = 32;

/** Minimum passphrase length enforced client-side per spec §2.2. */
const MIN_PASSPHRASE_LEN = 12;

// ---------------------------------------------------------------------------
// Typed Vault Errors
// ---------------------------------------------------------------------------

/**
 * Create a typed vault error. The message is the enum variant name only —
 * no additional data that could leak internal state.
 *
 * @internal
 */
function vaultErr(variant: VaultError): Error {
  return Object.assign(new Error(variant), { vaultError: variant });
}

// ---------------------------------------------------------------------------
// Storage Backend Abstraction
// ---------------------------------------------------------------------------

/**
 * Minimal file-system-like interface that abstracts over OPFS and the
 * IndexedDB fallback.
 * @internal
 */
interface StorageBackend {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// OPFS Storage Backend
// ---------------------------------------------------------------------------

/**
 * StorageBackend backed by the Origin Private File System (OPFS).
 * Paths are relative to the navigator.storage.getDirectory() root.
 * @internal
 */
class OpfsBackend implements StorageBackend {
  /** Resolve a dot-separated path to the containing directory and filename. */
  private splitPath(path: string): { dir: string[]; file: string } {
    const parts = path.split('/');
    const file = parts[parts.length - 1] ?? '';
    return { dir: parts.slice(0, -1), file };
  }

  /** Navigate to a directory handle, creating intermediate directories. */
  private async resolveDir(
    root: FileSystemDirectoryHandle,
    dirParts: string[],
  ): Promise<FileSystemDirectoryHandle> {
    let current = root;
    for (const part of dirParts) {
      if (part === '') continue;
      current = await current.getDirectoryHandle(part, { create: true });
    }
    return current;
  }

  async read(path: string): Promise<Uint8Array | null> {
    try {
      const root = await navigator.storage.getDirectory();
      const { dir, file } = this.splitPath(path);
      const dirHandle = await this.resolveDir(root, dir);
      const fileHandle = await dirHandle.getFileHandle(file);
      const f = await fileHandle.getFile();
      return new Uint8Array(await f.arrayBuffer());
    } catch {
      return null;
    }
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      const { dir, file } = this.splitPath(path);
      const dirHandle = await this.resolveDir(root, dir);
      const fileHandle = await dirHandle.getFileHandle(file, { create: true });
      const writable = await (fileHandle as FileSystemFileHandle & {
        createWritable(): Promise<FileSystemWritableFileStream>;
      }).createWritable();
      await writable.write(data as unknown as FileSystemWriteChunkType);
      await writable.close();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('quota')) {
        throw vaultErr(VaultError.StorageFull);
      }
      throw err;
    }
  }

  async delete(path: string): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory();
      const { dir, file } = this.splitPath(path);
      const dirHandle = await this.resolveDir(root, dir);
      await dirHandle.removeEntry(file);
    } catch {
      // ignore — not found is acceptable for delete
    }
  }

  async list(prefix: string): Promise<string[]> {
    try {
      const root = await navigator.storage.getDirectory();
      const parts = prefix.split('/');
      let dirHandle = root;
      for (const part of parts) {
        if (part === '') continue;
        dirHandle = await dirHandle.getDirectoryHandle(part);
      }
      const names: string[] = [];
      // @ts-expect-error — entries() is available in OPFS
      for await (const [name] of dirHandle.entries()) {
        names.push(name as string);
      }
      return names;
    } catch {
      return [];
    }
  }

  async exists(path: string): Promise<boolean> {
    const data = await this.read(path);
    return data !== null;
  }
}

// ---------------------------------------------------------------------------
// IndexedDB Fallback Storage Backend
// ---------------------------------------------------------------------------

/**
 * StorageBackend backed by IndexedDB, used when OPFS is not available.
 * Applies identical encryption scheme — only the persistence layer differs.
 * @internal
 */
class IndexedDbBackend implements StorageBackend {
  private readonly dbName = 'satnam-vault';
  private readonly storeName = 'files';

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(this.storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async read(path: string): Promise<Uint8Array | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).get(path);
      req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result as ArrayBuffer) : null);
      req.onerror = () => reject(req.error);
    });
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).put(data.buffer, path);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async delete(path: string): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).delete(path);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async list(prefix: string): Promise<string[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).getAllKeys();
      req.onsuccess = () => {
        const keys = (req.result as IDBValidKey[])
          .map((k) => String(k))
          .filter((k) => {
            const dirPart = prefix.endsWith('/') ? prefix : prefix + '/';
            return k.startsWith(dirPart);
          })
          .map((k) => {
            const dirPart = prefix.endsWith('/') ? prefix : prefix + '/';
            return k.slice(dirPart.length);
          });
        resolve(keys);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async exists(path: string): Promise<boolean> {
    const data = await this.read(path);
    return data !== null;
  }
}

// ---------------------------------------------------------------------------
// Storage Factory
// ---------------------------------------------------------------------------

/**
 * Returns the best available StorageBackend for this environment.
 * Prefers OPFS; falls back to IndexedDB.
 * @internal
 */
async function createStorageBackend(): Promise<StorageBackend> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
      await navigator.storage.getDirectory();
      return new OpfsBackend();
    }
  } catch {
    // OPFS not available — fall through to IndexedDB
  }
  return new IndexedDbBackend();
}

// ---------------------------------------------------------------------------
// Crypto Helpers
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext bytes using XChaCha20-Poly1305 under the provided key.
 * A fresh random 24-byte nonce is prepended to the ciphertext.
 *
 * Wire format: [ nonce (24 bytes) | ciphertext+tag ]
 *
 * @param key - 32-byte encryption key (master key)
 * @param plaintext - Bytes to encrypt
 * @returns nonce || ciphertext
 * @internal
 */
function encryptEntry(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const nonce = randomBytes(XCHACHA_NONCE_LEN);
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(plaintext);
  const result = new Uint8Array(XCHACHA_NONCE_LEN + ciphertext.length);
  result.set(nonce, 0);
  result.set(ciphertext, XCHACHA_NONCE_LEN);
  return result;
}

/**
 * Decrypt a vault entry that was encrypted with encryptEntry().
 *
 * @param key - 32-byte master key
 * @param data - nonce || ciphertext blob
 * @throws {VaultError.DecryptionFailed} if authentication tag is invalid
 * @internal
 */
function decryptEntry(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < XCHACHA_NONCE_LEN) {
    throw vaultErr(VaultError.DecryptionFailed);
  }
  const nonce = data.slice(0, XCHACHA_NONCE_LEN);
  const ciphertext = data.slice(XCHACHA_NONCE_LEN);
  try {
    const cipher = xchacha20poly1305(key, nonce);
    return cipher.decrypt(ciphertext);
  } catch {
    throw vaultErr(VaultError.DecryptionFailed);
  }
}

/**
 * Encrypt a master key (32 bytes) under a wrapping key using AES-256-GCM.
 * Wire format: [ nonce (12 bytes) | ciphertext+tag ]
 *
 * @param wrappingKey - 32-byte wrapping key
 * @param masterKey - 32-byte master key to encrypt
 * @internal
 */
function encryptMasterKey(wrappingKey: Uint8Array, masterKey: Uint8Array): Uint8Array {
  const nonce = randomBytes(AES_GCM_NONCE_LEN);
  const cipher = gcm(wrappingKey, nonce);
  const ciphertext = cipher.encrypt(masterKey);
  const result = new Uint8Array(AES_GCM_NONCE_LEN + ciphertext.length);
  result.set(nonce, 0);
  result.set(ciphertext, AES_GCM_NONCE_LEN);
  return result;
}

/**
 * Decrypt the master key from its AES-256-GCM ciphertext blob.
 *
 * @param wrappingKey - 32-byte wrapping key
 * @param data - nonce || ciphertext blob
 * @throws {VaultError.DecryptionFailed} if authentication tag is invalid
 * @internal
 */
function decryptMasterKey(wrappingKey: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < AES_GCM_NONCE_LEN) {
    throw vaultErr(VaultError.DecryptionFailed);
  }
  const nonce = data.slice(0, AES_GCM_NONCE_LEN);
  const ciphertext = data.slice(AES_GCM_NONCE_LEN);
  try {
    const cipher = gcm(wrappingKey, nonce);
    return cipher.decrypt(ciphertext);
  } catch {
    throw vaultErr(VaultError.DecryptionFailed);
  }
}

/**
 * Derive a 32-byte wrapping key from a passphrase using argon2id.
 * Parameters per SPECIFICATION.md §2.2: m=65536, t=3, p=4.
 *
 * @param passphrase - UTF-8 passphrase string
 * @param salt - 32-byte random salt
 * @internal
 */
function derivePassphraseWrappingKey(passphrase: string, salt: Uint8Array): Uint8Array {
  return argon2id(utf8ToBytes(passphrase), salt, {
    ...ARGON2_PARAMS,
    dkLen: MASTER_KEY_LEN,
  }) as Uint8Array;
}

/**
 * Derive NFC wrapping key via PinGate: argon2id(pin, uid, m:65536,t:3,p:4) → 32 bytes.
 * The UID is the NTAG424 SUN uid (hex string); PIN is 4-8 digits.
 * @internal exported for tests
 */
export function deriveNfcWrappingKey(pin: string, uid: string): Uint8Array {
  return argon2id(utf8ToBytes(pin), utf8ToBytes(uid), {
    ...ARGON2_PARAMS,
    dkLen: MASTER_KEY_LEN,
  }) as Uint8Array;
}

/**
 * XOR two 32-byte arrays to produce a combined wrapping key.
 * Used for WebAuthn PRF defense-in-depth: finalKey = PRF bytes XOR passphrase-derived key.
 * Both inputs must be 32 bytes.
 * @internal exported for tests
 */
export function xorWrappingKeys(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length !== 32 || b.length !== 32) throw new Error('xorWrappingKeys requires 32-byte inputs');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  return out;
}

/**
 * Zero a Uint8Array in-place using cryptographically-motivated overwriting.
 * Prevents sensitive key material from lingering in GC-reachable memory.
 *
 * @internal
 */
function zeroBytes(buf: Uint8Array): void {
  buf.fill(0);
}

// ---------------------------------------------------------------------------
// Vault Implementation
// ---------------------------------------------------------------------------

/**
 * Full implementation of the OPFS Vault.
 *
 * @example
 * ```ts
 * const vault = new Vault();
 * await vault.initialize('passphrase', 'correct-horse-battery-staple-x');
 * vault.lock();
 * await vault.unlock('passphrase', 'correct-horse-battery-staple-x');
 * await vault.storeNsec('npub1...', secretKeyBytes);
 * const nsec = await vault.getNsec('npub1...');
 * vault.lock();
 * ```
 */
export class Vault implements VaultOps {
  private config: VaultConfig;
  private storage: StorageBackend | null = null;

  /** The master key held in memory while unlocked. Zeroed on lock(). */
  private masterKey: Uint8Array | null = null;

  /** Idle timeout handle — cleared on activity, fires lock(). */
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param config - Optional vault configuration. Uses DEFAULT_VAULT_CONFIG if omitted.
   */
  constructor(config?: Partial<VaultConfig>) {
    this.config = {
      ...DEFAULT_VAULT_CONFIG,
      ...config,
      idleTimeoutMs: Math.min(
        3_600_000,
        Math.max(300_000, config?.idleTimeoutMs ?? DEFAULT_VAULT_CONFIG.idleTimeoutMs),
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Ensure storage backend is initialized. */
  private async getStorage(): Promise<StorageBackend> {
    if (!this.storage) {
      this.storage = await createStorageBackend();
    }
    return this.storage;
  }

  /**
   * Build the full storage path for a vault entry.
   * @param dir - Subdirectory within vault root
   * @param filename - Filename (may include extension)
   */
  private path(dir: string, filename: string): string {
    return `${this.config.vaultRoot}/${dir}/${filename}`;
  }

  /** Throw if vault is locked. */
  private requireUnlocked(): Uint8Array {
    if (!this.masterKey) throw vaultErr(VaultError.VaultLocked);
    return this.masterKey;
  }

  /** Reset the idle timer. Must be called on every vault operation. */
  private resetIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.lock();
    }, this.config.idleTimeoutMs);
  }

  /**
   * Encrypt arbitrary bytes under the master key, then persist to storage.
   */
  private async writeEncrypted(key: Uint8Array, path: string, plaintext: Uint8Array): Promise<void> {
    const storage = await this.getStorage();
    const ciphertext = encryptEntry(key, plaintext);
    await storage.write(path, ciphertext);
  }

  /**
   * Read from storage and decrypt under the master key.
   * Throws IdentityNotFound if the path doesn't exist.
   */
  private async readDecrypted(key: Uint8Array, path: string): Promise<Uint8Array> {
    const storage = await this.getStorage();
    const data = await storage.read(path);
    if (!data) throw vaultErr(VaultError.IdentityNotFound);
    return decryptEntry(key, data);
  }

  /**
   * Derive a wrapping key from the provided method and credential.
   *
   * - 'passphrase': argon2id(passphrase, salt) — salt is read/created at vault/passphrase.salt
   * - 'webauthn':   PRF output Uint8Array (32 bytes) from navigator.credentials.get PRF extension — used directly as wrapping key. For defense-in-depth the caller MAY XOR with a passphrase-derived key via xorWrappingKeys() before calling (see WP 005). The raw PRF bytes are treated as the wrapping key here; the XOR composition is a caller-side concern so the vault stays deterministic and testable.
   * - 'nfc':        PinGate derived bytes argon2id(pin, uid, m:65536,t:3,p:4) → 32 bytes. Caller derives via deriveNfcWrappingKey(pin, uid) and passes the result. Require tap + PIN at UI layer.
   */
  private async deriveWrappingKey(
    method: VaultMethod,
    credential: Uint8Array | string,
  ): Promise<{ wrappingKey: Uint8Array; salt: Uint8Array }> {
    if (method === 'webauthn') {
      if (!(credential instanceof Uint8Array)) {
        throw new Error('WebAuthn credential must be a Uint8Array (32-byte PRF output)');
      }
      if (credential.length !== 32) {
        throw new Error('WebAuthn PRF output must be 32 bytes');
      }
      // PRF output IS the wrapping key — no KDF step. For XOR defense-in-depth, the caller
      // is expected to have already performed xorWrappingKeys(prfBytes, passphraseDerivedKey)
      // before invoking initialize/unlock. See WP 005 and vault PRF wiring notes.
      const wrappingKey = new Uint8Array(credential);
      // Salt is not used for webauthn but we need to return one for signature compatibility.
      // Reuse or create a deterministic salt file for auditability; not used in derivation.
      const storage = await this.getStorage();
      const saltPath = `${this.config.vaultRoot}/webauthn.salt`;
      let salt = await storage.read(saltPath);
      if (!salt) {
        salt = randomBytes(32);
        await storage.write(saltPath, salt);
      }
      return { wrappingKey, salt };
    }

    if (method === 'nfc') {
      if (!(credential instanceof Uint8Array)) {
        throw new Error('NFC credential must be a Uint8Array (32-byte PinGate derived bytes)');
      }
      if (credential.length !== 32) {
        throw new Error('NFC PinGate derived bytes must be 32 bytes');
      }
      const wrappingKey = new Uint8Array(credential);
      const storage = await this.getStorage();
      const saltPath = `${this.config.vaultRoot}/nfc.salt`;
      let salt = await storage.read(saltPath);
      if (!salt) {
        salt = randomBytes(32);
        await storage.write(saltPath, salt);
      }
      return { wrappingKey, salt };
    }

    // Passphrase derivation
    if (typeof credential !== 'string') {
      throw new Error('Passphrase must be a string');
    }
    if (credential.length < MIN_PASSPHRASE_LEN) {
      throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LEN} characters`);
    }

    const storage = await this.getStorage();
    const saltPath = `${this.config.vaultRoot}/passphrase.salt`;
    let salt = await storage.read(saltPath);
    if (!salt) {
      salt = randomBytes(32);
      await storage.write(saltPath, salt);
    }

    const wrappingKey = derivePassphraseWrappingKey(credential, salt);
    return { wrappingKey, salt };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async initialize(
    method: VaultMethod,
    credential: Uint8Array | string,
  ): Promise<void> {
    const storage = await this.getStorage();

    // Create directory structure
    const dirs = ['identities', 'frost', 'nwc', 'nfc', 'nip46', 'agents', 'cashu', 'sig4sats', 'settings'];
    for (const dir of dirs) {
      // Write a sentinel file so the directory is created
      const sentinelPath = `${this.config.vaultRoot}/${dir}/.keep`;
      if (!(await storage.exists(sentinelPath))) {
        await storage.write(sentinelPath, new Uint8Array(0));
      }
    }

    const { wrappingKey } = await this.deriveWrappingKey(method, credential);

    try {
      // Generate master key
      const masterKey = randomBytes(MASTER_KEY_LEN);

      // Encrypt master key under wrapping key
      const encryptedMasterKey = encryptMasterKey(wrappingKey, masterKey);
      await storage.write(`${this.config.vaultRoot}/master.key`, encryptedMasterKey);

      // Store wrapping key metadata
      const meta: WrappingKeyMeta = {
        method,
        credential: method === 'passphrase' ? '' : bytesToHex(credential as Uint8Array),
        argon2Params:
          method === 'passphrase'
            ? { m: ARGON2_PARAMS.m, t: ARGON2_PARAMS.t, p: ARGON2_PARAMS.p, keyLen: MASTER_KEY_LEN }
            : undefined,
        createdAt: new Date().toISOString(),
      };
      await storage.write(
        `${this.config.vaultRoot}/wrapping.meta`,
        utf8ToBytes(JSON.stringify(meta)),
      );

      // Hold master key in memory and start idle timer
      this.masterKey = masterKey;
      this.resetIdleTimer();
    } finally {
      zeroBytes(wrappingKey);
    }
  }

  /** @inheritdoc */
  async unlock(
    method: VaultMethod,
    credential: Uint8Array | string,
  ): Promise<void> {
    const storage = await this.getStorage();

    const { wrappingKey } = await this.deriveWrappingKey(method, credential);

    try {
      const encryptedMasterKey = await storage.read(`${this.config.vaultRoot}/master.key`);
      if (!encryptedMasterKey) {
        throw vaultErr(VaultError.DecryptionFailed);
      }

      const masterKey = decryptMasterKey(wrappingKey, encryptedMasterKey);

      // Clear any existing master key before replacing
      if (this.masterKey) {
        zeroBytes(this.masterKey);
      }
      this.masterKey = masterKey;
      this.resetIdleTimer();
    } finally {
      zeroBytes(wrappingKey);
    }
  }

  /** @inheritdoc */
  lock(): void {
    if (this.masterKey) {
      zeroBytes(this.masterKey);
      this.masterKey = null;
    }
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** @inheritdoc */
  isUnlocked(): boolean {
    return this.masterKey !== null;
  }

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async storeNsec(npub: string, nsec: Uint8Array): Promise<void> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    await this.writeEncrypted(key, this.path('identities', `${npub}.nsec`), nsec);
  }

  /** @inheritdoc */
  async getNsec(npub: string): Promise<Uint8Array> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    return this.readDecrypted(key, this.path('identities', `${npub}.nsec`));
  }

  /** @inheritdoc */
  async deleteNsec(npub: string): Promise<void> {
    this.requireUnlocked();
    this.resetIdleTimer();
    const storage = await this.getStorage();
    await storage.delete(this.path('identities', `${npub}.nsec`));
  }

  /** @inheritdoc */
  async listIdentities(): Promise<string[]> {
    this.requireUnlocked();
    this.resetIdleTimer();
    const storage = await this.getStorage();
    const files = await storage.list(`${this.config.vaultRoot}/identities`);
    return files
      .filter((f) => f.endsWith('.nsec'))
      .map((f) => f.slice(0, -'.nsec'.length));
  }

  // -------------------------------------------------------------------------
  // FROST
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async storeBfprofile(groupNpub: string, profile: Uint8Array): Promise<void> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    await this.writeEncrypted(key, this.path('frost', `${groupNpub}.bfprofile`), profile);
  }

  /** @inheritdoc */
  async getBfprofile(groupNpub: string): Promise<Uint8Array> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    return this.readDecrypted(key, this.path('frost', `${groupNpub}.bfprofile`));
  }

  /** @inheritdoc */
  async storeBfshare(groupNpub: string, share: Uint8Array): Promise<void> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    await this.writeEncrypted(key, this.path('frost', `${groupNpub}.bfshare`), share);
  }

  /** @inheritdoc */
  async getBfshare(groupNpub: string): Promise<Uint8Array> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    return this.readDecrypted(key, this.path('frost', `${groupNpub}.bfshare`));
  }

  // -------------------------------------------------------------------------
  // NWC
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async storeNwcUri(connectionId: string, uri: string): Promise<void> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    await this.writeEncrypted(
      key,
      this.path('nwc', `${connectionId}.uri`),
      utf8ToBytes(uri),
    );
  }

  /** @inheritdoc */
  async getNwcUri(connectionId: string): Promise<string> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    const plaintext = await this.readDecrypted(key, this.path('nwc', `${connectionId}.uri`));
    return bytesToUtf8(plaintext);
  }

  /** @inheritdoc */
  async deleteNwcUri(connectionId: string): Promise<void> {
    this.requireUnlocked();
    this.resetIdleTimer();
    const storage = await this.getStorage();
    await storage.delete(this.path('nwc', `${connectionId}.uri`));
  }

  // -------------------------------------------------------------------------
  // NFC
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async storeNfcKey(cardUid: string, keySlot: 'k1' | 'k2', key: Uint8Array): Promise<void> {
    const masterKey = this.requireUnlocked();
    this.resetIdleTimer();
    await this.writeEncrypted(masterKey, this.path('nfc', `${cardUid}.${keySlot}`), key);
  }

  /** @inheritdoc */
  async getNfcKey(cardUid: string, keySlot: 'k1' | 'k2'): Promise<Uint8Array> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    return this.readDecrypted(key, this.path('nfc', `${cardUid}.${keySlot}`));
  }

  // -------------------------------------------------------------------------
  // NIP-46
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async storeNip46Pairing(sessionId: string, pairing: Nip46PairingState): Promise<void> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    // Serialize Uint8Array fields to hex for JSON storage
    const serializable = {
      ...pairing,
      ephemeralSecretKey: bytesToHex(pairing.ephemeralSecretKey),
    };
    await this.writeEncrypted(
      key,
      this.path('nip46', `${sessionId}.pairing`),
      utf8ToBytes(JSON.stringify(serializable)),
    );
  }

  /** @inheritdoc */
  async getNip46Pairing(sessionId: string): Promise<Nip46PairingState> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    const plaintext = await this.readDecrypted(key, this.path('nip46', `${sessionId}.pairing`));
    const raw = JSON.parse(bytesToUtf8(plaintext)) as unknown as {
      ephemeralPubkey: string;
      ephemeralSecretKey: string; // stored as hex
      remotePubkey: string;
      connectUri?: string;
      establishedAt: string;
      expiresAt?: string;
      relays: string[];
    };
    return {
      ephemeralPubkey: raw.ephemeralPubkey,
      ephemeralSecretKey: hexToBytes(raw.ephemeralSecretKey),
      remotePubkey: raw.remotePubkey,
      connectUri: raw.connectUri,
      establishedAt: raw.establishedAt,
      expiresAt: raw.expiresAt,
      relays: raw.relays,
    };
  }

  /** @inheritdoc */
  async deleteNip46Pairing(sessionId: string): Promise<void> {
    this.requireUnlocked();
    this.resetIdleTimer();
    const storage = await this.getStorage();
    await storage.delete(this.path('nip46', `${sessionId}.pairing`));
  }

  // -------------------------------------------------------------------------
  // Agent
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async storeAgentNsec(agentNpub: string, nsec: Uint8Array): Promise<void> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    await this.writeEncrypted(key, this.path('agents', `${agentNpub}.nsec`), nsec);
  }

  /** @inheritdoc */
  async getAgentNsec(agentNpub: string): Promise<Uint8Array> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    return this.readDecrypted(key, this.path('agents', `${agentNpub}.nsec`));
  }

  /** @inheritdoc */
  async storeAgentLlmKeys(agentNpub: string, keys: EncryptedLlmKeys): Promise<void> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    await this.writeEncrypted(
      key,
      this.path('agents', `${agentNpub}.llm_keys`),
      utf8ToBytes(JSON.stringify(keys)),
    );
  }

  /** @inheritdoc */
  async getAgentLlmKeys(agentNpub: string): Promise<EncryptedLlmKeys> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    const plaintext = await this.readDecrypted(
      key,
      this.path('agents', `${agentNpub}.llm_keys`),
    );
    return JSON.parse(bytesToUtf8(plaintext)) as EncryptedLlmKeys;
  }

  // -------------------------------------------------------------------------
  // Cashu
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async storeCashuProofs(mintUrlHash: string, proofs: CashuProof[]): Promise<void> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    await this.writeEncrypted(
      key,
      this.path('cashu', `${mintUrlHash}.proofs`),
      utf8ToBytes(JSON.stringify(proofs)),
    );
  }

  /** @inheritdoc */
  async getCashuProofs(mintUrlHash: string): Promise<CashuProof[]> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    const plaintext = await this.readDecrypted(
      key,
      this.path('cashu', `${mintUrlHash}.proofs`),
    );
    return JSON.parse(bytesToUtf8(plaintext)) as CashuProof[];
  }

  // -------------------------------------------------------------------------
  // Sig4Sats
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async storeSig4SatsBonds(bondsJson: string): Promise<void> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    await this.writeEncrypted(
      key,
      this.path('sig4sats', 'bonds.json'),
      utf8ToBytes(bondsJson),
    );
  }

  /** @inheritdoc */
  async getSig4SatsBonds(): Promise<string | null> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    try {
      const plaintext = await this.readDecrypted(key, this.path('sig4sats', 'bonds.json'));
      return bytesToUtf8(plaintext);
    } catch (err) {
      // VaultError.IdentityNotFound means no bonds stored yet — return null
      if (err instanceof Error && err.message === VaultError.IdentityNotFound) {
        return null;
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // OpenTimestamps receipts (CR-F)
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async storeOtsReceipt(eventId: string, receipt: unknown): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(eventId)) {
      throw new Error(`invalid event id: ${eventId}`);
    }
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    await this.writeEncrypted(
      key,
      this.path('ots', `${eventId}.json`),
      utf8ToBytes(JSON.stringify(receipt)),
    );
  }

  /** @inheritdoc */
  async getOtsReceipt(eventId: string): Promise<unknown> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    try {
      const plaintext = await this.readDecrypted(key, this.path('ots', `${eventId}.json`));
      return JSON.parse(bytesToUtf8(plaintext));
    } catch (err) {
      if (err instanceof Error && err.message === VaultError.IdentityNotFound) {
        return null;
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Backup
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async exportEncryptedBackup(): Promise<Uint8Array> {
    const masterKey = this.requireUnlocked();
    this.resetIdleTimer();

    const storage = await this.getStorage();

    // Collect all vault entries as plaintext (after decrypting with master key)
    // We re-encrypt them under the master key again in the backup for consistency.
    // The backup payload is encrypted under the MASTER KEY so the blob is opaque.
    // The encryptedMasterKey field (AES-GCM under wrapping key) is embedded so the
    // restore path can derive the master key from just the passphrase + salt.
    const encryptedMasterKeyBlob = await storage.read(`${this.config.vaultRoot}/master.key`);

    // Collect all vault entries (already-encrypted blobs stored as hex)
    const entries: Record<string, string> = {};

    const dirs = ['identities', 'frost', 'nwc', 'nfc', 'nip46', 'agents', 'cashu', 'sig4sats', 'settings'];
    for (const dir of dirs) {
      const files = await storage.list(`${this.config.vaultRoot}/${dir}`);
      for (const file of files) {
        if (file === '.keep') continue;
        const fullPath = this.path(dir, file);
        const data = await storage.read(fullPath);
        if (data) {
          // Decrypt the entry under master key, then re-encrypt under master key
          // (this ensures we always use a fresh nonce in the backup)
          const plain = decryptEntry(masterKey, data);
          entries[`${dir}/${file}`] = bytesToHex(encryptEntry(masterKey, plain));
        }
      }
    }

    const backupPayload = {
      version: 2,
      createdAt: new Date().toISOString(),
      // AES-GCM(wrappingKey, masterKey) — lets restore caller recover masterKey from passphrase
      encryptedMasterKey: encryptedMasterKeyBlob ? bytesToHex(encryptedMasterKeyBlob) : null,
      entries,
    };

    const backupJson = JSON.stringify(backupPayload);

    // Encrypt the outer backup envelope under the master key.
    // On restore, the caller derives the wrapping key from their passphrase,
    // uses it to decrypt encryptedMasterKey, and then decrypts this outer envelope.
    return encryptEntry(masterKey, utf8ToBytes(backupJson));
  }

  /** @inheritdoc */
  async importEncryptedBackup(data: Uint8Array, wrappingKey: Uint8Array): Promise<void> {
    // Backup restore protocol:
    //
    // The backup blob structure is:
    //   xchacha20poly1305(masterKey, JSON({
    //     version: 2,
    //     encryptedMasterKey: hex(AES-GCM(wrappingKey, masterKey)),
    //     entries: { '<dir/file>': hex(xchacha20poly1305(masterKey, plaintext)) }
    //   }))
    //
    // Restore sequence:
    // 1. The provided wrappingKey is argon2id(passphrase, originalSalt).
    //    We don't have the salt yet — but if the vault already exists on this device,
    //    we can read master.key from storage and decrypt it with wrappingKey to get masterKey.
    //
    // 2. If this is a fresh device (no existing vault), we need the masterKey from the backup.
    //    But the masterKey is INSIDE the backup (which is encrypted by masterKey) — catch-22.
    //
    // Resolution for fresh-device restore:
    // The backup blob has a 4-byte little-endian prefix indicating the length of the
    // encryptedMasterKey blob, followed by the encryptedMasterKey, followed by the
    // xchacha20poly1305(masterKey, payload) envelope.
    //
    // This allows the restore to:
    // 1. Read encryptedMasterKey prefix (without masterKey)
    // 2. Decrypt encryptedMasterKey using wrappingKey (AES-GCM)
    // 3. Use masterKey to decrypt the payload envelope
    //
    // Format: [4-byte LE encMKLen][encryptedMasterKeyBytes][xchacha(masterKey, JSON)]
    //
    // However, for compatibility with the simple exportEncryptedBackup() format,
    // we try two strategies:
    // Strategy A: current vault is unlocked — use this.masterKey directly.
    // Strategy B: derive masterKey using wrappingKey + master.key from storage.
    // Strategy C: no vault exists — fail with DecryptionFailed.

    let masterKey: Uint8Array | null = null;

    // Strategy A: vault is already unlocked
    if (this.masterKey) {
      masterKey = this.masterKey;
    } else {
      // Strategy B: use wrapping key to decrypt master.key from storage
      const storage0 = await this.getStorage();
      const storedEncMK = await storage0.read(`${this.config.vaultRoot}/master.key`);
      if (storedEncMK) {
        try {
          masterKey = decryptMasterKey(wrappingKey, storedEncMK);
        } catch {
          masterKey = null;
        }
      }
    }

    if (!masterKey) {
      throw vaultErr(VaultError.DecryptionFailed);
    }

    let backupJson: string;
    try {
      const plaintext = decryptEntry(masterKey, data);
      backupJson = bytesToUtf8(plaintext);
    } catch {
      throw vaultErr(VaultError.DecryptionFailed);
    }

    const backup = JSON.parse(backupJson) as {
      version: number;
      createdAt: string;
      encryptedMasterKey: string | null;
      entries: Record<string, string>;
    };

    if (backup.version !== 2) {
      throw new Error('Unsupported backup version');
    }

    const storage = await this.getStorage();

    // Restore the encrypted master key blob so the vault can be unlocked later
    if (backup.encryptedMasterKey) {
      await storage.write(
        `${this.config.vaultRoot}/master.key`,
        hexToBytes(backup.encryptedMasterKey),
      );
    }

    // Restore all entries (already-encrypted blobs under original master key)
    for (const [relativePath, hexData] of Object.entries(backup.entries)) {
      const fullPath = `${this.config.vaultRoot}/${relativePath}`;
      await storage.write(fullPath, hexToBytes(hexData));
    }

    // The vault is now populated. Call unlock(method, passphrase) to activate it.
  }

  // -------------------------------------------------------------------------
  // Settings (second factor) — encrypted under master key at vault/settings/settings.json
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  async getVaultSettings(): Promise<VaultSettings> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    try {
      const plaintext = await this.readDecrypted(key, this.path('settings', 'settings.json'));
      const parsed = JSON.parse(bytesToUtf8(plaintext)) as VaultSettings;
      // Validate secondFactor enum
      if (!['none', 'yubikey', 'nfc', 'biometrics'].includes(parsed.secondFactor)) {
        return { ...DEFAULT_VAULT_SETTINGS, updatedAt: new Date().toISOString() };
      }
      return parsed;
    } catch (err) {
      if (err instanceof Error && err.message === VaultError.IdentityNotFound) {
        return { ...DEFAULT_VAULT_SETTINGS, updatedAt: new Date().toISOString() };
      }
      throw err;
    }
  }

  /** @inheritdoc */
  async setVaultSettings(settings: VaultSettings): Promise<void> {
    const key = this.requireUnlocked();
    this.resetIdleTimer();
    if (!['none', 'yubikey', 'nfc', 'biometrics'].includes(settings.secondFactor)) {
      throw new Error(`Invalid secondFactor: ${settings.secondFactor}`);
    }
    const toStore: VaultSettings = {
      secondFactor: settings.secondFactor,
      updatedAt: new Date().toISOString(),
    };
    await this.writeEncrypted(key, this.path('settings', 'settings.json'), utf8ToBytes(JSON.stringify(toStore)));
  }

  /** @inheritdoc */
  async getSecondFactor(): Promise<VaultSecondFactor> {
    const s = await this.getVaultSettings();
    return s.secondFactor;
  }
}

// ---------------------------------------------------------------------------
// Singleton Helper
// ---------------------------------------------------------------------------

/** Module-level singleton vault instance. */
let _vaultInstance: Vault | null = null;

/**
 * Get or create the module-level Vault singleton.
 *
 * @param config - Optional configuration override (only applied on first call)
 */
export function getVault(config?: Partial<VaultConfig>): Vault {
  if (!_vaultInstance) {
    _vaultInstance = new Vault(config);
  }
  return _vaultInstance;
}

/**
 * Compute the SHA-256 hash of a URL string for use as a vault key
 * (e.g., mint URL hash for Cashu proof storage).
 *
 * @param url - URL string to hash
 * @returns Hex-encoded SHA-256 digest
 */
export function hashUrl(url: string): string {
  return bytesToHex(sha256(utf8ToBytes(url)));
}
