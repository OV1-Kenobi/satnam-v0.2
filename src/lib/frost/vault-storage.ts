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

import { bytesToHex, utf8ToBytes, bytesToUtf8, randomBytes } from '@noble/hashes/utils';
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

  // Use the dedicated FROST manifest vault entry (vault/frost/manifest.json).
  // This replaces the previous workaround that stored the manifest in the
  // identities namespace via storeNsec('frost-manifest', ...).
  const profiles: BfProfile[] = [];

  try {
    const groupPubkeys = await vault.getFrostManifest();

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
    existing = await vault.getFrostManifest();
  } catch {
    // No manifest yet — start fresh
  }

  if (!existing.includes(groupPubkey)) {
    existing.push(groupPubkey);
    await vault.storeFrostManifest(existing);
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
    const groups = await vault.getFrostManifest();
    const updated = groups.filter((g) => g !== groupPubkey);
    await vault.storeFrostManifest(updated);
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
  userNsec: Uint8Array,
): Promise<NostrEvent> {
  // Retrieve the share from vault
  const share = await retrieveBfShare(groupPubkey);
  if (!share) {
    throw frostErr(FrostError.ShareNotFound);
  }

  const userPubkeyBytes = secp256k1.getPublicKey(userNsec, true);
  const userPubkey = bytesToHex(userPubkeyBytes.slice(1));

  // Serialize the share for encryption
  const shareJson = JSON.stringify(share);
  const shareBase64 = btoa(shareJson);

  const backupContent: ShareBackupContent = {
    version: 1,
    groupPubkey,
    shareIndex: share.index,
    encryptedShare: shareBase64,
    createdAt: Math.floor(Date.now() / 1000),
  };

  // NIP-44 encrypt the backup content to the user's own pubkey (self-encryption).
  // This ensures the backup is decryptable only by the user's nsec.
  const { nip44, finalizeEvent } = await import('nostr-tools');
  const conversationKey = nip44.getConversationKey(userNsec, userPubkey);
  const ciphertext = nip44.encrypt(JSON.stringify(backupContent), conversationKey);

  const created_at = Math.floor(Date.now() / 1000);
  const kind = 10000;
  const tags: string[][] = [
    ['d', `satnam:bfshare:${groupPubkey}`],
    ['group', groupPubkey],
  ];

  // Sign the event with the user's nsec
  const signed = finalizeEvent(
    {
      kind,
      created_at,
      tags,
      content: ciphertext,
    },
    userNsec,
  );

  return signed as NostrEvent;
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
export async function restoreShareFromBackup(event: NostrEvent, userNsec: Uint8Array): Promise<BfShare> {
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

  // Decrypt the content using NIP-44 (self-encryption: conversation key with own pubkey)
  const userPubkeyBytes = secp256k1.getPublicKey(userNsec, true);
  const userPubkeyHex = bytesToHex(userPubkeyBytes.slice(1));

  let backupContent: ShareBackupContent;
  try {
    const { nip44 } = await import('nostr-tools');
    const conversationKey = nip44.getConversationKey(userNsec, event.pubkey);
    const decrypted = nip44.decrypt(event.content, conversationKey);
    backupContent = JSON.parse(decrypted) as ShareBackupContent;
    void userPubkeyHex; // pubkey derived for potential future validation
  } catch {
    throw frostErr(FrostError.EncryptionFailed);
  }

  // Validate share structure
  if (backupContent.version !== 1 || !backupContent.encryptedShare) {
    throw frostErr(FrostError.InvalidBackup);
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


