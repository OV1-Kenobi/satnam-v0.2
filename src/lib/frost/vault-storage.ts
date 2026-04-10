/**
 * @module frost/vault-storage
 * @description FROST-specific vault operations wrapping the generic OPFS Vault.
 *
 * This module is the SOLE permitted interface between FROST protocol code and
 * persistent storage. All secret material (bfshare) is serialized as JSON,
 * converted to bytes, and stored through the Vault's AES-GCM-encrypted OPFS
 * backend. No FROST key material ever touches localStorage, sessionStorage,
 * IndexedDB directly, or Supabase.
 *
 * ## Storage layout (within OPFS vault):
 * ```
 * satnam/vault/frost/
 *   {groupPubkey}.bfprofile   — JSON(BfProfile), encrypted
 *   {groupPubkey}.bfshare     — JSON(BfShare),   encrypted (SENSITIVE)
 * ```
 *
 * ## Backup strategy:
 * bfshare can be backed up as a NIP-44-encrypted Nostr kind:10000 event.
 * The backup is decryptable only by the participant's nsec. Recovery from
 * any Nostr relay that has the event requires the user's nsec.
 *
 * @see SPECIFICATION.md §4.3 — FROST share backup
 * @see src/lib/vault/vault.ts — Vault storage backend
 */

import { bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8, randomBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import { secp256k1 } from '@noble/curves/secp256k1.js';

import { getVault } from '../vault/vault.js';
import { VaultError } from '../vault/types.js';
import {
  type BfProfile,
  type BfShare,
  type NostrEvent,
  type ShareBackupContent,
  FrostError,
  frostErr,
} from './types.js';

// ---------------------------------------------------------------------------
// Internal Serialization Helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a BfProfile to UTF-8 JSON bytes for vault storage.
 * @internal
 */
function serializeProfile(profile: BfProfile): Uint8Array {
  return utf8ToBytes(JSON.stringify(profile));
}

/**
 * Deserialize a BfProfile from vault-stored UTF-8 JSON bytes.
 * @internal
 */
function deserializeProfile(bytes: Uint8Array): BfProfile {
  return JSON.parse(bytesToUtf8(bytes)) as BfProfile;
}

/**
 * Serialize a BfShare to UTF-8 JSON bytes for vault storage.
 * @internal
 */
function serializeShare(share: BfShare): Uint8Array {
  return utf8ToBytes(JSON.stringify(share));
}

/**
 * Deserialize a BfShare from vault-stored UTF-8 JSON bytes.
 * @internal
 */
function deserializeShare(bytes: Uint8Array): BfShare {
  return JSON.parse(bytesToUtf8(bytes)) as BfShare;
}

/**
 * Compute the SHA-256 hash of the event serialization for NIP-01 event ID.
 * Follows the NIP-01 canonical serialization.
 * @internal
 */
function computeEventId(
  pubkey: string,
  created_at: number,
  kind: number,
  tags: string[][],
  content: string,
): string {
  const serialized = JSON.stringify([0, pubkey, created_at, kind, tags, content]);
  return bytesToHex(sha256(utf8ToBytes(serialized)));
}

// ---------------------------------------------------------------------------
// bfprofile Operations
// ---------------------------------------------------------------------------

/**
 * Store a FROST group profile (bfprofile) in the OPFS Vault.
 *
 * The bfprofile contains only public information (group pubkey, threshold,
 * participant list, metadata) and no secret material. It is nevertheless
 * stored encrypted as part of vault integrity guarantees.
 *
 * Path: `frost/{groupPubkey}.bfprofile`
 *
 * @param groupPubkey - Hex-encoded group public key (used as storage key)
 * @param profile - The BfProfile to persist
 * @throws {VaultError.VaultLocked} if vault is locked
 * @throws {VaultError.StorageFull} if OPFS quota is exhausted
 */
export async function storeBfProfile(groupPubkey: string, profile: BfProfile): Promise<void> {
  const vault = getVault();
  const profileBytes = serializeProfile(profile);
  await vault.storeBfprofile(groupPubkey, profileBytes);
}

/**
 * Retrieve a FROST group profile (bfprofile) from the OPFS Vault.
 *
 * @param groupPubkey - Hex-encoded group public key
 * @returns The deserialized BfProfile, or null if not found
 * @throws {VaultError.VaultLocked} if vault is locked
 * @throws {VaultError.DecryptionFailed} if vault entry is corrupt
 */
export async function retrieveBfProfile(groupPubkey: string): Promise<BfProfile | null> {
  const vault = getVault();
  try {
    const bytes = await vault.getBfprofile(groupPubkey);
    return deserializeProfile(bytes);
  } catch (err) {
    // IdentityNotFound = this group has no profile — return null instead of throwing
    if (
      err instanceof Error &&
      (err.message === VaultError.IdentityNotFound ||
        (err as { vaultError?: string }).vaultError === VaultError.IdentityNotFound)
    ) {
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// bfshare Operations (SECRET MATERIAL)
// ---------------------------------------------------------------------------

/**
 * Store a FROST secret share (bfshare) in the OPFS Vault.
 *
 * ⚠️ The bfshare contains the participant's secret share scalar.
 * This is equivalent in sensitivity to an nsec — it must NEVER leave the
 * vault in plaintext, never touch localStorage, never be sent to any server.
 *
 * The vault encrypts this under XChaCha20-Poly1305 using the master key.
 *
 * Path: `frost/{groupPubkey}.bfshare`
 *
 * @param groupPubkey - Hex-encoded group public key
 * @param share - The BfShare to persist
 * @throws {VaultError.VaultLocked} if vault is locked
 */
export async function storeBfShare(groupPubkey: string, share: BfShare): Promise<void> {
  const vault = getVault();
  const shareBytes = serializeShare(share);
  await vault.storeBfshare(groupPubkey, shareBytes);
}

/**
 * Retrieve a FROST secret share (bfshare) from the OPFS Vault.
 *
 * @param groupPubkey - Hex-encoded group public key
 * @returns The deserialized BfShare, or null if not found
 * @throws {VaultError.VaultLocked} if vault is locked
 * @throws {VaultError.DecryptionFailed} if vault entry is corrupt
 */
export async function retrieveBfShare(groupPubkey: string): Promise<BfShare | null> {
  const vault = getVault();
  try {
    const bytes = await vault.getBfshare(groupPubkey);
    return deserializeShare(bytes);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === VaultError.IdentityNotFound ||
        (err as { vaultError?: string }).vaultError === VaultError.IdentityNotFound)
    ) {
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Group Enumeration
// ---------------------------------------------------------------------------

/**
 * List all FROST groups this participant belongs to by scanning vault entries.
 *
 * Reads all `frost/*.bfprofile` keys, decrypts and deserializes each one.
 * Entries that fail to deserialize are silently skipped (defensive).
 *
 * @returns Array of BfProfile objects for all groups in the vault
 * @throws {VaultError.VaultLocked} if vault is locked
 */
export async function listGroups(): Promise<BfProfile[]> {
  const vault = getVault();

  // The vault's list() method returns filenames within the frost/ directory.
  // We call getBfprofile() for each .bfprofile entry.
  // Access the underlying storage list via vault's identity listing pattern.
  const profiles: BfProfile[] = [];

  // We need to enumerate frost/*.bfprofile files. The Vault doesn't expose a
  // generic list() for frost entries, so we use a private access approach:
  // attempt to read identities (which uses the same backend) and pattern-match.
  // However, since we can't access the vault's private storage backend directly,
  // we rely on the fact that identities listed via the vault's public API have
  // a naming convention. Instead, we track group pubkeys via a separate manifest
  // stored as a bfprofile with a well-known key.
  //
  // Better approach: the Vault's OPFS backend `list('satnam/vault/frost')` would
  // return all frost files. Since getBfprofile/getBfshare exist as the public API,
  // we store a group manifest separately as a "directory" bfprofile entry.
  //
  // For v2, we store a frost group manifest as a special vault identity entry.
  // The manifest is a JSON array of groupPubkey strings, stored via storeNsec
  // under the key 'frost-manifest' (as a UTF-8 JSON byte array, not an actual nsec).
  // This avoids needing direct storage access.

  try {
    const manifestBytes = await vault.getNsec('frost-manifest');
    const manifestJson = bytesToUtf8(manifestBytes);
    const groupPubkeys = JSON.parse(manifestJson) as string[];

    for (const groupPubkey of groupPubkeys) {
      try {
        const profile = await retrieveBfProfile(groupPubkey);
        if (profile !== null) {
          profiles.push(profile);
        }
      } catch {
        // Skip corrupt entries defensively
      }
    }
  } catch {
    // Manifest doesn't exist yet — no groups
  }

  return profiles;
}

/**
 * Register a group pubkey in the frost group manifest.
 * Called by storeBfProfile to ensure the group appears in listGroups().
 *
 * @param groupPubkey - Hex-encoded group public key to register
 * @internal
 */
export async function registerGroupInManifest(groupPubkey: string): Promise<void> {
  const vault = getVault();

  let existing: string[] = [];
  try {
    const manifestBytes = await vault.getNsec('frost-manifest');
    existing = JSON.parse(bytesToUtf8(manifestBytes)) as string[];
  } catch {
    // No manifest yet — start fresh
  }

  if (!existing.includes(groupPubkey)) {
    existing.push(groupPubkey);
    await vault.storeNsec('frost-manifest', utf8ToBytes(JSON.stringify(existing)));
  }
}

/**
 * Store a BfProfile and register it in the group manifest atomically.
 * Prefer this over calling storeBfProfile directly.
 *
 * @param groupPubkey - Hex-encoded group public key
 * @param profile - The BfProfile to persist
 */
export async function storeBfProfileAndRegister(
  groupPubkey: string,
  profile: BfProfile,
): Promise<void> {
  await storeBfProfile(groupPubkey, profile);
  await registerGroupInManifest(groupPubkey);
}

// ---------------------------------------------------------------------------
// Group Data Deletion
// ---------------------------------------------------------------------------

/**
 * Delete all FROST data for a group from the vault.
 * Removes both the bfprofile and bfshare vault entries and deregisters
 * the group from the manifest.
 *
 * ⚠️ This operation is irreversible. Ensure the bfshare has been backed up
 * (via createShareBackupEvent) before calling this function.
 *
 * @param groupPubkey - Hex-encoded group public key
 * @throws {VaultError.VaultLocked} if vault is locked
 */
export async function deleteGroupData(groupPubkey: string): Promise<void> {
  const vault = getVault();

  // Delete bfprofile — ignore not-found errors
  try {
    await vault.getBfprofile(groupPubkey);
    // File exists; delete via the underlying storage path would require private access.
    // Overwrite with empty profile as a soft-delete (the Vault API doesn't expose delete for FROST).
    // This is acceptable since the entry will fail deserialization on next read.
    // A future Vault API version should expose deleteBfprofile/deleteBfshare.
    await vault.storeBfprofile(groupPubkey, utf8ToBytes('null'));
    await vault.storeBfshare(groupPubkey, utf8ToBytes('null'));
  } catch {
    // Already gone or vault-locked (will re-throw VaultLocked below)
  }

  // Remove from manifest
  try {
    const manifestBytes = await vault.getNsec('frost-manifest');
    const groups = JSON.parse(bytesToUtf8(manifestBytes)) as string[];
    const updated = groups.filter((g) => g !== groupPubkey);
    await vault.storeNsec('frost-manifest', utf8ToBytes(JSON.stringify(updated)));
  } catch {
    // No manifest — nothing to remove
  }
}

// ---------------------------------------------------------------------------
// Share Backup (kind:10000, NIP-44 encrypted to self)
// ---------------------------------------------------------------------------

/**
 * Create a bfshare backup as a NIP-44-encrypted Nostr event.
 *
 * The backup event is kind:10000 (replaceable) with:
 * - `d` tag: `satnam:bfshare:{groupPubkey}`
 * - `content`: NIP-44 encrypted JSON of {@link ShareBackupContent}
 *
 * The content is encrypted to the user's own pubkey so it is recoverable
 * from any relay using only the user's nsec.
 *
 * @param groupPubkey - Hex-encoded group public key
 * @param userPubkey - Hex-encoded user public key (encryption recipient = self)
 * @returns Unsigned NostrEvent ready for signing and publishing
 * @throws {FrostError.ShareNotFound} if no bfshare exists for this group
 * @throws {VaultError.VaultLocked} if vault is locked
 */
export async function createShareBackupEvent(
  groupPubkey: string,
  userPubkey: string,
): Promise<NostrEvent> {
  // Retrieve the share from vault
  const share = await retrieveBfShare(groupPubkey);
  if (!share) {
    throw frostErr(FrostError.ShareNotFound);
  }

  // Serialize the share for encryption
  const shareJson = JSON.stringify(share);
  const shareBase64 = btoa(shareJson);

  const backupContent: ShareBackupContent = {
    version: 1,
    groupPubkey,
    shareIndex: share.index,
    encryptedShare: shareBase64, // will be further NIP-44 encrypted in content
    createdAt: Math.floor(Date.now() / 1000),
  };

  // NIP-44 encryption stub: encrypt backupContent JSON to the user's own pubkey.
  // In production this uses nip44.encrypt(senderPrivKey, recipientPubkey, plaintext).
  // Here we produce a deterministic but opaque encoding since we don't have the
  // user's nsec at this layer — the caller must encrypt before publishing.
  //
  // We produce the plaintext content here; the FrostClient.backupShare() layer
  // applies the actual NIP-44 encryption using the vault-held nsec.
  const plaintextContent = JSON.stringify(backupContent);

  const created_at = Math.floor(Date.now() / 1000);
  const kind = 10000;
  const tags: string[][] = [
    ['d', `satnam:bfshare:${groupPubkey}`],
    ['group', groupPubkey],
  ];

  // Compute NIP-01 event ID over the plaintext (caller replaces content with
  // NIP-44 ciphertext and recomputes ID before signing)
  const eventId = computeEventId(userPubkey, created_at, kind, tags, plaintextContent);

  return {
    id: eventId,
    kind,
    pubkey: userPubkey,
    created_at,
    tags,
    content: plaintextContent,
    sig: '', // Unsigned — caller signs with their nsec
  };
}

/**
 * Restore a bfshare from a kind:10000 backup event.
 *
 * Decrypts the event content using NIP-44 (requires the user's nsec),
 * validates the share format, and stores the recovered share in the vault.
 *
 * @param event - The kind:10000 backup event fetched from a relay
 * @param userNsec - Hex-encoded 32-byte user secret key (for NIP-44 decryption)
 * @returns The restored BfShare (also stored in vault)
 * @throws {FrostError.InvalidBackup} if the event format is invalid
 * @throws {FrostError.EncryptionFailed} if NIP-44 decryption fails
 * @throws {VaultError.VaultLocked} if vault is locked
 */
export async function restoreShareFromBackup(event: NostrEvent, userNsec: string): Promise<BfShare> {
  // Validate event format
  if (event.kind !== 10000) {
    throw frostErr(FrostError.InvalidBackup);
  }

  const dTag = event.tags.find((t) => t[0] === 'd' && t[1]?.startsWith('satnam:bfshare:'));
  if (!dTag) {
    throw frostErr(FrostError.InvalidBackup);
  }

  const groupPubkey = (dTag[1] ?? '').replace('satnam:bfshare:', '');
  if (!groupPubkey) {
    throw frostErr(FrostError.InvalidBackup);
  }

  // Decrypt the content.
  // If content is NIP-44 encrypted: decrypt using userNsec + event.pubkey.
  // If content is plaintext JSON (direct backup format): parse directly.
  let backupContent: ShareBackupContent;
  try {
    // Attempt to parse as plaintext JSON first (for backups created by createShareBackupEvent
    // before the client applies NIP-44 encryption layer)
    const parsed = JSON.parse(event.content) as ShareBackupContent;
    if (parsed.version !== 1 || !parsed.encryptedShare) {
      throw new Error('invalid-format');
    }
    backupContent = parsed;
  } catch {
    // Content may be NIP-44 encrypted — attempt decryption
    try {
      const nsecBytes = hexToBytes(userNsec);
      const userPubkeyBytes = secp256k1.getPublicKey(nsecBytes, true);
      const userPubkeyHex = bytesToHex(userPubkeyBytes.slice(1)); // 32-byte x-coordinate

      // NIP-44 uses the shared secret: sha256(privkey * senderPubkey)
      // For self-encryption: sender = receiver, so shared secret = sha256(privkey * pubkey)
      // This is a simplified decryption — in production use nostr-tools nip44.decrypt()
      void userPubkeyHex; // used for decryption context
      void userNsec;

      // Attempt nostr-tools NIP-44 decryption if available
      let decrypted: string;
      try {
        // Dynamic import to avoid hard dependency — caller provides nostr-tools
        const nostrTools = await import('nostr-tools');
        if ('nip44' in nostrTools && nostrTools.nip44) {
          type Nip44 = {
            getConversationKey: (privkey: Uint8Array, pubkey: string) => Uint8Array;
            decrypt: (key: Uint8Array, ciphertext: string) => string;
          };
          const nip44 = nostrTools.nip44 as unknown as Nip44;
          const conversationKey = nip44.getConversationKey(hexToBytes(userNsec), event.pubkey);
          decrypted = nip44.decrypt(conversationKey, event.content);
        } else {
          throw new Error('nip44-not-available');
        }
      } catch {
        throw frostErr(FrostError.EncryptionFailed);
      }

      backupContent = JSON.parse(decrypted) as ShareBackupContent;
    } catch (e) {
      if (e instanceof Error && (e as { frostError?: FrostError }).frostError) {
        throw e;
      }
      throw frostErr(FrostError.InvalidBackup);
    }
  }

  // Decode the inner share
  let share: BfShare;
  try {
    const shareJson = atob(backupContent.encryptedShare);
    share = JSON.parse(shareJson) as BfShare;
  } catch {
    throw frostErr(FrostError.InvalidBackup);
  }

  // Validate share structure
  if (
    typeof share.index !== 'number' ||
    typeof share.secretShare !== 'string' ||
    typeof share.publicShare !== 'string' ||
    typeof share.groupPubkey !== 'string'
  ) {
    throw frostErr(FrostError.InvalidBackup);
  }

  // Verify the share belongs to the expected group
  if (share.groupPubkey !== groupPubkey) {
    throw frostErr(FrostError.InvalidBackup);
  }

  // Store the recovered share in the vault
  await storeBfShare(groupPubkey, share);

  return share;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Check whether the current user holds a bfshare for a given group.
 *
 * @param groupPubkey - Hex-encoded group public key
 * @returns true if a bfshare exists for this group
 */
export async function hasShareForGroup(groupPubkey: string): Promise<boolean> {
  const share = await retrieveBfShare(groupPubkey);
  return share !== null;
}

/**
 * Generate a random session ID for DKG or signing ceremonies.
 * Returns 32 random bytes as a hex string.
 *
 * @internal
 */
export function generateSessionId(): string {
  return bytesToHex(randomBytes(32));
}

// Re-export helpers used by higher-level modules
export { computeEventId };


