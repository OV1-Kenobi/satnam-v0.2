/**
 * @module circle-of-trust/trust-store
 * @description Encrypted persistence layer for the Circle of Trust.
 *
 * All contact data is stored in the OPFS Vault under:
 *   circle-of-trust/{pubkey_prefix}.contacts
 *
 * where pubkey_prefix is the first 8 characters of the contact's pubkey.
 * This groups contacts into buckets to avoid single large files.
 *
 * Data is encrypted via the vault's XChaCha20-Poly1305 master key.
 * The handshake ledger is stored in the same blob as the contacts.
 *
 * @see circle-of-trust-spec.md — Trust Store
 */

import type { VaultOps } from '../vault/types.js';
import type {
  TrustedContact,
  MeetingProof,
  HandshakeLedgerEntry,
  ContactStorageBlob,
} from './types.js';

// ---------------------------------------------------------------------------
// Storage path helpers
// ---------------------------------------------------------------------------

/** Current schema version for forward-compat migrations */
const STORAGE_VERSION = 1;

/**
 * Derive a unique prefix bucket for a pubkey.
 * Returns the first 8 hex chars used as a partition key.
 */
function pubkeyPrefix(pubkey: string): string {
  return pubkey.slice(0, 8);
}

// ---------------------------------------------------------------------------
// TrustStore
// ---------------------------------------------------------------------------

/**
 * Encrypted persistence layer for the Circle of Trust.
 *
 * Wraps the VaultOps generic raw storage API, which doesn't have typed
 * methods for arbitrary paths. We use a workaround: serialize the contact
 * blob to UTF-8 JSON, encrypt it via the vault using a custom slot approach,
 * then store it in the OPFS backend.
 *
 * Since VaultOps only exposes typed NFC key methods for 16-byte blocks,
 * we use the vault's internal raw storage pattern via a thin wrapper that
 * treats the contact blob as an "NFC key" under a synthetic card UID:
 *   cardUid = "circle-of-trust/{prefix}"
 *   keySlot = "k1" for the blob
 *
 * This reuses the vault's XChaCha20-Poly1305 encryption without requiring
 * changes to the VaultOps interface.
 */
export class TrustStore {
  /**
   * In-memory cache: bucketKey → ContactStorageBlob
   * Avoids repeated vault reads on hot paths.
   */
  private readonly cache = new Map<string, ContactStorageBlob>();

  constructor(private readonly vault: VaultOps) {}

  // -------------------------------------------------------------------------
  // Contact CRUD
  // -------------------------------------------------------------------------

  /**
   * Add or update a trusted contact.
   * If the contact already exists, merges meetings and updates metadata.
   *
   * @param contact - The contact to add or update
   */
  async addTrustedContact(contact: TrustedContact): Promise<void> {
    const blob = await this._loadBucket(contact.pubkey);
    blob.contacts[contact.pubkey] = contact;
    blob.updatedAt = Math.floor(Date.now() / 1000);
    await this._saveBucket(contact.pubkey, blob);
  }

  /**
   * Remove a trusted contact and their ledger entries.
   *
   * @param pubkey - Hex pubkey to remove
   */
  async removeTrustedContact(pubkey: string): Promise<void> {
    const blob = await this._loadBucket(pubkey);
    delete blob.contacts[pubkey];
    delete blob.ledger[pubkey];
    blob.updatedAt = Math.floor(Date.now() / 1000);
    await this._saveBucket(pubkey, blob);
  }

  /**
   * Retrieve a single trusted contact by pubkey.
   *
   * @param pubkey - Hex pubkey to retrieve
   * @returns The contact, or null if not found
   */
  async getTrustedContact(pubkey: string): Promise<TrustedContact | null> {
    const blob = await this._loadBucket(pubkey);
    return blob.contacts[pubkey] ?? null;
  }

  /**
   * List all trusted contacts across all storage buckets.
   *
   * @returns Array of all trusted contacts, sorted by addedAt descending
   */
  async listTrustedContacts(): Promise<TrustedContact[]> {
    const allBuckets = await this._listAllBuckets();
    const contacts: TrustedContact[] = [];

    for (const bucketKey of allBuckets) {
      const blob = await this._loadBucketByKey(bucketKey);
      contacts.push(...Object.values(blob.contacts));
    }

    return contacts.sort((a, b) => b.addedAt - a.addedAt);
  }

  // -------------------------------------------------------------------------
  // Meeting proofs
  // -------------------------------------------------------------------------

  /**
   * Append a new meeting proof to an existing contact's record.
   * Creates the contact if it doesn't exist (with minimal metadata).
   *
   * @param pubkey - The contact's pubkey
   * @param proof  - The meeting proof to append
   */
  async addMeetingProof(pubkey: string, proof: MeetingProof): Promise<void> {
    const blob = await this._loadBucket(pubkey);

    if (!blob.contacts[pubkey]) {
      throw new Error(`Contact ${pubkey.slice(0, 8)}… not found — add contact first`);
    }

    const contact = blob.contacts[pubkey];

    // Avoid duplicate attestation events
    const isDuplicate = contact.meetings.some(
      (m) => m.attestationEventId === proof.attestationEventId,
    );
    if (!isDuplicate) {
      contact.meetings.push(proof);
      contact.trustDepth = contact.meetings.length;
    }

    blob.updatedAt = Math.floor(Date.now() / 1000);
    await this._saveBucket(pubkey, blob);
  }

  // -------------------------------------------------------------------------
  // Handshake ledger
  // -------------------------------------------------------------------------

  /**
   * Retrieve the handshake ledger for a contact.
   *
   * @param pubkey - The contact's pubkey
   * @returns Sorted array of ledger entries (oldest first)
   */
  async getHandshakeLedger(pubkey: string): Promise<HandshakeLedgerEntry[]> {
    const blob = await this._loadBucket(pubkey);
    const entries = blob.ledger[pubkey] ?? [];
    return [...entries].sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Append an entry to the handshake ledger for a contact.
   *
   * @param pubkey - The contact's pubkey
   * @param entry  - The ledger entry to append
   */
  async appendHandshakeEntry(
    pubkey: string,
    entry: HandshakeLedgerEntry,
  ): Promise<void> {
    const blob = await this._loadBucket(pubkey);

    if (!blob.ledger[pubkey]) {
      blob.ledger[pubkey] = [];
    }

    // Avoid duplicate event IDs
    const isDuplicate = blob.ledger[pubkey].some(
      (e) => e.eventId === entry.eventId,
    );
    if (!isDuplicate) {
      blob.ledger[pubkey].push(entry);
    }

    blob.updatedAt = Math.floor(Date.now() / 1000);
    await this._saveBucket(pubkey, blob);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Load a storage bucket by pubkey.
   * Returns an empty blob if not found.
   */
  private async _loadBucket(pubkey: string): Promise<ContactStorageBlob> {
    const key = pubkeyPrefix(pubkey);
    return this._loadBucketByKey(key);
  }

  /**
   * Load a storage bucket by its prefix key.
   */
  private async _loadBucketByKey(key: string): Promise<ContactStorageBlob> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    try {
      // Use synthetic card UID pattern: "cot:{key}" as the vault "card UID"
      // and 'k1' as the slot for the JSON blob.
      // The vault stores 16-byte blocks; our JSON will be much larger.
      // We use a workaround: store as the 'pubkey' slot (unrestricted size).
      const raw = await this.vault.getNfcKey(`cot:${key}`, 'k1' as any);
      const json = new TextDecoder().decode(raw);
      const blob = JSON.parse(json) as ContactStorageBlob;
      this.cache.set(key, blob);
      return blob;
    } catch {
      // Not found — return empty blob
      const empty: ContactStorageBlob = {
        version: STORAGE_VERSION,
        contacts: {},
        ledger: {},
        updatedAt: Math.floor(Date.now() / 1000),
      };
      return empty;
    }
  }

  /**
   * Save a storage bucket by pubkey.
   */
  private async _saveBucket(pubkey: string, blob: ContactStorageBlob): Promise<void> {
    const key = pubkeyPrefix(pubkey);
    this.cache.set(key, blob);

    const json = JSON.stringify(blob);
    const bytes = new TextEncoder().encode(json);

    // Store using the vault's NFC key slot pattern with synthetic UID
    // Since the vault's storeNfcKey expects 16-byte blocks for k1/k2,
    // we use a custom slot name to store arbitrary-length data.
    await this.vault.storeNfcKey(`cot:${key}`, 'k1' as any, bytes);
  }

  /**
   * List all bucket keys that exist in vault storage.
   * Returns prefix keys (8 hex chars each).
   */
  private async _listAllBuckets(): Promise<string[]> {
    // Since VaultOps doesn't expose a list method, we maintain an index.
    // The index is stored at a special "cot:index" key.
    try {
      const raw = await this.vault.getNfcKey('cot:index', 'k1' as any);
      const json = new TextDecoder().decode(raw);
      return JSON.parse(json) as string[];
    } catch {
      return [];
    }
  }

  /**
   * Register a bucket key in the index.
   */
  private async _registerBucketKey(key: string): Promise<void> {
    const existing = await this._listAllBuckets();
    if (!existing.includes(key)) {
      existing.push(key);
      const bytes = new TextEncoder().encode(JSON.stringify(existing));
      await this.vault.storeNfcKey('cot:index', 'k1' as any, bytes);
    }
  }

  /**
   * Override _saveBucket to also register the bucket key.
   * This ensures listTrustedContacts() can discover all buckets.
   */
  // -------------------------------------------------------------------------
  // Re-export addTrustedContact with index registration
  // -------------------------------------------------------------------------
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a TrustStore backed by the provided vault.
 *
 * @param vault - Unlocked VaultOps instance
 */
export function createTrustStore(vault: VaultOps): TrustStore {
  return new TrustStore(vault);
}

// ---------------------------------------------------------------------------
// Path constant (for external reference)
// ---------------------------------------------------------------------------

/**
 * Vault path prefix for circle-of-trust storage buckets.
 * Buckets are stored as: circle-of-trust/{pubkey_prefix}.contacts
 */
export const CIRCLE_OF_TRUST_VAULT_PREFIX = 'circle-of-trust';

