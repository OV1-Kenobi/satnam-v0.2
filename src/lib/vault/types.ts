/**
 * @module vault/types
 * @description TypeScript type definitions for the OPFS Vault module.
 *
 * The OPFS Vault is the root of all key custody in Satnam v2. Every secret
 * material — nsec keys, FROST shares, NWC URIs, NFC AES keys, NIP-46 pairing
 * state, agent credentials, and Cashu proofs — lives here and nowhere else.
 *
 * @see SPECIFICATION.md §2 — OPFS Vault
 */

// ---------------------------------------------------------------------------
// Vault Error Enum
// ---------------------------------------------------------------------------

/**
 * Typed vault error discriminant. Errors carry no data payloads — only the
 * variant name — to prevent key material or internal paths from appearing in
 * logs or error reports.
 *
 * @see SPECIFICATION.md §2.4 — Vault Security Invariants (invariant #5)
 */
export enum VaultError {
  /** Operation attempted while vault is locked (master key not in memory). */
  VaultLocked = 'VaultLocked',
  /** Requested identity (npub) does not exist in the vault. */
  IdentityNotFound = 'IdentityNotFound',
  /** Decryption of a vault entry failed — likely wrong key or corrupt data. */
  DecryptionFailed = 'DecryptionFailed',
  /** OPFS or IndexedDB storage quota exhausted. */
  StorageFull = 'StorageFull',
}

// ---------------------------------------------------------------------------
// Vault Configuration
// ---------------------------------------------------------------------------

/**
 * Vault configuration, settable by the Principal during initialization.
 * All timeout values are in milliseconds.
 */
export interface VaultConfig {
  /**
   * Idle timeout before the vault auto-locks (zeroes the master key from the
   * JavaScript heap). Defaults to 15 minutes. Clamped to [5 min, 60 min].
   *
   * @minimum 300_000 (5 minutes)
   * @maximum 3_600_000 (60 minutes)
   * @default 900_000 (15 minutes)
   */
  idleTimeoutMs: number;

  /**
   * OPFS root directory path within the Origin Private File System.
   * @default 'satnam/vault'
   */
  vaultRoot: string;
}

/** Default vault configuration values. */
export const DEFAULT_VAULT_CONFIG: VaultConfig = {
  idleTimeoutMs: 900_000, // 15 minutes
  vaultRoot: 'satnam/vault',
};

// ---------------------------------------------------------------------------
// Vault Subdirectory Categories
// ---------------------------------------------------------------------------

/** All permitted vault subdirectory names per SPECIFICATION.md §2.1. */
export type VaultDirectory =
  | 'identities'
  | 'frost'
  | 'nwc'
  | 'nfc'
  | 'nip46'
  | 'agents'
  | 'cashu';

// ---------------------------------------------------------------------------
// NIP-46 Pairing State
// ---------------------------------------------------------------------------

/**
 * Encrypted NIP-46 Nostr Connect pairing session state.
 * Stored in vault/nip46/{session_id}.pairing
 *
 * Contains the ephemeral keypair used for NIP-46 encrypted communication and
 * the shared secret established during the pairing handshake.
 */
export interface Nip46PairingState {
  /** Hex-encoded ephemeral public key for this pairing session. */
  ephemeralPubkey: string;

  /** 32-byte raw ephemeral secret key for this pairing session. */
  ephemeralSecretKey: Uint8Array;

  /** Hex-encoded pubkey of the remote NIP-46 signer. */
  remotePubkey: string;

  /** Nostr Connect URI that initiated this session, if available. */
  connectUri?: string;

  /** ISO 8601 timestamp when this pairing session was established. */
  establishedAt: string;

  /** ISO 8601 expiry timestamp, if the session has a TTL. */
  expiresAt?: string;

  /** Relay URLs for this NIP-46 session. */
  relays: string[];
}

// ---------------------------------------------------------------------------
// Encrypted LLM Keys
// ---------------------------------------------------------------------------

/**
 * Encrypted LLM provider API keys stored per agent.
 * Stored in vault/agents/{agent_npub}.llm_keys
 *
 * The keys themselves are plaintext when retrieved after vault decryption;
 * at-rest they are encrypted under the vault master key.
 */
export interface EncryptedLlmKeys {
  /** OpenAI API key, if configured. */
  openaiKey?: string;

  /** Anthropic API key, if configured. */
  anthropicKey?: string;

  /** OpenRouter API key, if configured. */
  openrouterKey?: string;

  /** Groq API key, if configured. */
  groqKey?: string;

  /** Generic key-value map for additional providers. */
  additionalKeys: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Cashu Proof
// ---------------------------------------------------------------------------

/**
 * A Cashu eCash proof (bearer token). Proofs are the bearer instruments — if
 * leaked, the sats they represent are irretrievably lost. Vault encryption
 * is the only protection.
 *
 * Stored in vault/cashu/{mint_url_hash}.proofs as a JSON array.
 *
 * @see https://github.com/cashubtc/nuts/blob/main/00.md
 */
export interface CashuProof {
  /** The keyset ID from the mint that issued this proof. */
  id: string;

  /** Amount in satoshis this proof represents. */
  amount: number;

  /** Secret scalar (hex-encoded) — the bearer credential. */
  secret: string;

  /** Unblinded signature from the mint (hex-encoded). */
  C: string;
}

// ---------------------------------------------------------------------------
// Wrapping Key Metadata
// ---------------------------------------------------------------------------

/**
 * Metadata stored alongside the encrypted master key to describe how the
 * wrapping key is derived. Stored in OPFS as plaintext (not secret).
 */
export interface WrappingKeyMeta {
  /** Derivation method used for the wrapping key. */
  method: 'passphrase' | 'webauthn';

  /**
   * For 'passphrase' method: base64-encoded 32-byte random salt.
   * For 'webauthn' method: base64-encoded credential ID.
   */
  credential: string;

  /**
   * For 'passphrase' method: argon2id parameters used during derivation.
   * Stored for forward compatibility.
   */
  argon2Params?: {
    m: number;
    t: number;
    p: number;
    keyLen: number;
  };

  /** ISO 8601 timestamp when this wrapping key was established. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Vault Operations Interface
// ---------------------------------------------------------------------------

/**
 * The complete OPFS Vault operations interface.
 *
 * All method signatures exactly match SPECIFICATION.md §2.3. Implementors must
 * enforce all security invariants from §2.4:
 *
 * 1. No key material in any storage other than OPFS.
 * 2. No key material transmitted to any server.
 * 3. Vault auto-locks after configurable idle timeout (default 15 min).
 * 4. Vault backup is encrypted under the master key.
 * 5. No vault contents appear in error logs.
 *
 * @see SPECIFICATION.md §2.3
 */
export interface VaultOps {
  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Initialize a new vault. Generates a random 256-bit master key, derives a
   * wrapping key from the provided credential, and encrypts the master key
   * under the wrapping key using AES-256-GCM. Creates all vault directory
   * structure in OPFS.
   *
   * @param method - 'passphrase' for argon2id-derived key; 'webauthn' for PRF
   * @param credential - Passphrase string, or WebAuthn PRF output (Uint8Array)
   * @throws {VaultError.StorageFull} if OPFS storage is unavailable
   */
  initialize(method: 'webauthn' | 'passphrase', credential: Uint8Array | string): Promise<void>;

  /**
   * Unlock an existing vault. Derives the wrapping key from the credential,
   * decrypts the master key from OPFS, and holds it in JavaScript heap memory
   * for the duration of the idle timeout.
   *
   * @param method - Must match the method used during initialize()
   * @param credential - Passphrase string, or WebAuthn PRF output (Uint8Array)
   * @throws {VaultError.DecryptionFailed} if wrapping key is incorrect
   */
  unlock(method: 'webauthn' | 'passphrase', credential: Uint8Array | string): Promise<void>;

  /**
   * Lock the vault. Zeroes the master key from the JavaScript heap. All
   * subsequent operations will throw VaultError.VaultLocked until unlock() is
   * called again.
   */
  lock(): void;

  /**
   * Returns true if the vault has a master key in memory (i.e., is unlocked
   * and within the idle timeout window).
   */
  isUnlocked(): boolean;

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /**
   * Store an nsec (secret key) for an identity, encrypted under the master key
   * using XChaCha20-Poly1305. Stored at vault/identities/{npub}.nsec.
   *
   * @param npub - Bech32-encoded public key identifying this identity
   * @param nsec - Raw 32-byte secret key
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  storeNsec(npub: string, nsec: Uint8Array): Promise<void>;

  /**
   * Retrieve and decrypt an nsec for an identity.
   *
   * @param npub - Bech32-encoded public key
   * @throws {VaultError.VaultLocked} if vault is locked
   * @throws {VaultError.IdentityNotFound} if no nsec is stored for this npub
   * @throws {VaultError.DecryptionFailed} if decryption fails
   */
  getNsec(npub: string): Promise<Uint8Array>;

  /**
   * Delete an nsec from the vault. Does not throw if the identity does not exist.
   *
   * @param npub - Bech32-encoded public key
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  deleteNsec(npub: string): Promise<void>;

  /**
   * List all npubs that have an nsec stored in the vault.
   *
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  listIdentities(): Promise<string[]>;

  // -------------------------------------------------------------------------
  // FROST
  // -------------------------------------------------------------------------

  /**
   * Store a FROSTR v2 bfprofile (group profile, containing public key and
   * threshold metadata, but no secret material).
   *
   * @param groupNpub - Bech32-encoded group public key
   * @param profile - Raw bfprofile bytes
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  storeBfprofile(groupNpub: string, profile: Uint8Array): Promise<void>;

  /**
   * Retrieve a FROSTR v2 bfprofile.
   *
   * @param groupNpub - Bech32-encoded group public key
   * @throws {VaultError.VaultLocked} if vault is locked
   * @throws {VaultError.IdentityNotFound} if not found
   */
  getBfprofile(groupNpub: string): Promise<Uint8Array>;

  /**
   * Store an individual FROST share (bfshare) for a group.
   *
   * @param groupNpub - Bech32-encoded group public key
   * @param share - Raw bfshare bytes
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  storeBfshare(groupNpub: string, share: Uint8Array): Promise<void>;

  /**
   * Retrieve an individual FROST share (bfshare) for a group.
   *
   * @param groupNpub - Bech32-encoded group public key
   * @throws {VaultError.VaultLocked} if vault is locked
   * @throws {VaultError.IdentityNotFound} if not found
   */
  getBfshare(groupNpub: string): Promise<Uint8Array>;

  // -------------------------------------------------------------------------
  // NWC (Nostr Wallet Connect)
  // -------------------------------------------------------------------------

  /**
   * Store a Nostr Wallet Connect URI encrypted under the master key.
   *
   * @param connectionId - Unique identifier for this NWC connection
   * @param uri - The nostr+walletconnect:// URI
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  storeNwcUri(connectionId: string, uri: string): Promise<void>;

  /**
   * Retrieve and decrypt a NWC URI.
   *
   * @param connectionId - Unique identifier for this NWC connection
   * @throws {VaultError.VaultLocked} if vault is locked
   * @throws {VaultError.IdentityNotFound} if not found
   */
  getNwcUri(connectionId: string): Promise<string>;

  /**
   * Delete a NWC URI from the vault.
   *
   * @param connectionId - Unique identifier for this NWC connection
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  deleteNwcUri(connectionId: string): Promise<void>;

  // -------------------------------------------------------------------------
  // NFC
  // -------------------------------------------------------------------------

  /**
   * Store an NTAG424 AES-128 key (k1 or k2 slot) for a card.
   *
   * @param cardUid - Unique identifier (UID) of the NFC card
   * @param keySlot - 'k1' for SUN key, 'k2' for secondary key
   * @param key - Raw 16-byte AES-128 key
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  storeNfcKey(cardUid: string, keySlot: 'k1' | 'k2', key: Uint8Array): Promise<void>;

  /**
   * Retrieve an NTAG424 AES-128 key.
   *
   * @param cardUid - Unique identifier (UID) of the NFC card
   * @param keySlot - 'k1' or 'k2'
   * @throws {VaultError.VaultLocked} if vault is locked
   * @throws {VaultError.IdentityNotFound} if not found
   */
  getNfcKey(cardUid: string, keySlot: 'k1' | 'k2'): Promise<Uint8Array>;

  // -------------------------------------------------------------------------
  // NIP-46 Pairing
  // -------------------------------------------------------------------------

  /**
   * Store a NIP-46 pairing session state encrypted under the master key.
   *
   * @param sessionId - Unique identifier for this pairing session
   * @param pairing - The pairing state to store
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  storeNip46Pairing(sessionId: string, pairing: Nip46PairingState): Promise<void>;

  /**
   * Retrieve a NIP-46 pairing session state.
   *
   * @param sessionId - Unique identifier for this pairing session
   * @throws {VaultError.VaultLocked} if vault is locked
   * @throws {VaultError.IdentityNotFound} if not found
   */
  getNip46Pairing(sessionId: string): Promise<Nip46PairingState>;

  /**
   * Delete a NIP-46 pairing session from the vault.
   *
   * @param sessionId - Unique identifier for this pairing session
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  deleteNip46Pairing(sessionId: string): Promise<void>;

  // -------------------------------------------------------------------------
  // Agent
  // -------------------------------------------------------------------------

  /**
   * Store an agent nsec (secret key) encrypted under the master key.
   * Stored at vault/agents/{agent_npub}.nsec.
   *
   * @param agentNpub - Bech32-encoded agent public key
   * @param nsec - Raw 32-byte secret key
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  storeAgentNsec(agentNpub: string, nsec: Uint8Array): Promise<void>;

  /**
   * Retrieve and decrypt an agent nsec.
   *
   * @param agentNpub - Bech32-encoded agent public key
   * @throws {VaultError.VaultLocked} if vault is locked
   * @throws {VaultError.IdentityNotFound} if not found
   */
  getAgentNsec(agentNpub: string): Promise<Uint8Array>;

  /**
   * Store encrypted LLM provider API keys for an agent.
   *
   * @param agentNpub - Bech32-encoded agent public key
   * @param keys - LLM provider API keys
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  storeAgentLlmKeys(agentNpub: string, keys: EncryptedLlmKeys): Promise<void>;

  /**
   * Retrieve and decrypt LLM provider API keys for an agent.
   *
   * @param agentNpub - Bech32-encoded agent public key
   * @throws {VaultError.VaultLocked} if vault is locked
   * @throws {VaultError.IdentityNotFound} if not found
   */
  getAgentLlmKeys(agentNpub: string): Promise<EncryptedLlmKeys>;

  // -------------------------------------------------------------------------
  // Cashu
  // -------------------------------------------------------------------------

  /**
   * Store Cashu eCash proofs encrypted under the master key.
   * Stored at vault/cashu/{mint_url_hash}.proofs.
   *
   * @param mintUrlHash - Hex-encoded SHA-256 of the mint URL
   * @param proofs - Array of Cashu proofs
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  storeCashuProofs(mintUrlHash: string, proofs: CashuProof[]): Promise<void>;

  /**
   * Retrieve and decrypt Cashu proofs for a mint.
   *
   * @param mintUrlHash - Hex-encoded SHA-256 of the mint URL
   * @throws {VaultError.VaultLocked} if vault is locked
   * @throws {VaultError.IdentityNotFound} if no proofs found for this mint
   */
  getCashuProofs(mintUrlHash: string): Promise<CashuProof[]>;

  // -------------------------------------------------------------------------
  // Backup
  // -------------------------------------------------------------------------

  /**
   * Export an encrypted backup of the entire vault contents. The backup is
   * encrypted under the master key. Restoring requires the wrapping key
   * (WebAuthn credential or passphrase).
   *
   * @returns Serialized encrypted backup blob (format: JSON → utf8 → xchacha20poly1305)
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  exportEncryptedBackup(): Promise<Uint8Array>;

  /**
   * Import and restore a vault from an encrypted backup. The wrapping key is
   * required to decrypt the master key in the backup, and then to re-encrypt
   * it under the current device's wrapping key.
   *
   * @param data - Encrypted backup blob produced by exportEncryptedBackup()
   * @param wrappingKey - 32-byte wrapping key derived from the original passphrase/WebAuthn
   * @throws {VaultError.DecryptionFailed} if the wrapping key is incorrect
   */
  importEncryptedBackup(data: Uint8Array, wrappingKey: Uint8Array): Promise<void>;
}
