/**
 * @module messaging/mls-types
 * @description MLS / Marmot forward-compatibility type definitions.
 *
 * These are typed stubs for when the marmot-ts library reaches production
 * stability. The White Noise client (reference MLS implementation on Nostr)
 * is the interoperability target.
 *
 * MIPs referenced:
 *   MIP-00 — KeyPackage (kind:443)
 *   MIP-01 — Marmot Group Data Extension (kind:30078 d-tag satnam:mls:group:*)
 *   MIP-02 — WelcomeEvent (kind:1059 gift-wrapped)
 *   MIP-03 — GroupEvent (ChaCha20-Poly1305 encrypted group messages)
 *   MIP-04 — MLS Media Attachment
 *   MIP-05 — MLS Push Notification metadata
 *
 * NO marmot-ts dependency is added. These types are defined from the Marmot
 * protocol specifications for forward compatibility only.
 *
 * @see https://github.com/marmot-protocol/mips
 * @see https://github.com/parres-hk/white-noise (reference client)
 */

// ============================================================================
// MIP-00 — KeyPackage (kind:443)
// ============================================================================

/**
 * Supported MLS ciphersuites.
 * Values follow the IANA MLS Ciphersuites registry.
 */
export type MlsCiphersuite =
  | 0x0001  // MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519
  | 0x0002  // MLS_128_DHKEMP256_AES128GCM_SHA256_P256
  | 0x0007  // MLS_256_DHKEMX448_CHACHA20POLY1305_SHA512_Ed448
  | number; // Future ciphersuites

/**
 * MLS KeyPackage as published in a Nostr kind:443 event.
 *
 * Event structure (MIP-00):
 *   kind: 443
 *   content: <base64-encoded MLS KeyPackage TLV>
 *   tags:
 *     ["protocol", "mls-1.0"]
 *     ["cipher_suite", "<decimal ciphersuite id>"]
 *     ["client", "<client name>"]
 *
 * The KeyPackage contains:
 *   - The signer's public identity key (linked to Nostr pubkey)
 *   - An ephemeral init key for HPKE key encapsulation
 *   - Lifetime (notBefore / notAfter unix timestamps)
 *   - Extensions (capabilities, etc.)
 *   - Signature over the above
 */
export interface KeyPackage {
  /** Nostr event id of the kind:443 event */
  eventId: string;
  /** hex pubkey of the key package author */
  authorPubkey: string;
  /** Base64-encoded MLS KeyPackage TLV (raw bytes from marmot-ts) */
  keyPackageTlv: string;
  /** MLS ciphersuite used */
  ciphersuite: MlsCiphersuite;
  /** Protocol version tag — always "mls-1.0" for Marmot */
  protocol: 'mls-1.0';
  /** Client implementation name */
  client: string;
  /** Unix timestamp: not valid before */
  notBefore: number;
  /** Unix timestamp: not valid after */
  notAfter: number;
  /** Relay URLs where this key package was published */
  relayUrls?: string[];
}

/** Minimal kind:443 Nostr event structure for KeyPackage queries */
export interface KeyPackageEvent {
  id: string;
  pubkey: string;
  kind: 443;
  created_at: number;
  content: string; // base64 MLS KeyPackage TLV
  tags: string[][];
  sig: string;
}

// ============================================================================
// MIP-01 — MLS Group Configuration
// ============================================================================

/**
 * MLS group configuration stored as a kind:30078 parameterized replaceable event.
 * d-tag: `mls:group:{groupId}`
 *
 * Extends the NIP-17 GroupConfig with MLS-specific fields.
 */
export interface MlsGroupConfig {
  /** Unique group identifier (also the MLS group id, base64url encoded) */
  groupId: string;
  /** Human-readable group name */
  name: string;
  /** Group description */
  description?: string;
  /** MLS ciphersuite for this group */
  ciphersuite: MlsCiphersuite;
  /** hex pubkeys of all group members */
  members: string[];
  /** hex pubkeys of group admins */
  admins: string[];
  /** Relay URLs for group message distribution */
  relayUrls: string[];
  /** Optional group avatar (URL or NIP-94 event id) */
  avatar?: string;
  /** MLS epoch number (incremented on each membership change) */
  epoch: number;
  /** MLS tree hash (base64url encoded) */
  treeHash?: string;
  /** Unix timestamp of group creation */
  createdAt: number;
  /** Unix timestamp of last config update */
  updatedAt: number;
}

// ============================================================================
// MIP-02 — Welcome Event
// ============================================================================

/**
 * MLS Welcome event structure.
 *
 * Published as a NIP-59 gift-wrap (kind:1059) to a new group member.
 * The inner rumor (kind:443?) contains the MLS Welcome message TLV
 * that allows the new member to join the MLS group.
 *
 * Per MIP-02, the Welcome is encrypted using the recipient's KeyPackage
 * init key (HPKE) — not NIP-44.
 */
export interface WelcomeEvent {
  /** Nostr event id of the kind:1059 wrapper */
  wrapperEventId: string;
  /** hex pubkey of the recipient */
  recipientPubkey: string;
  /** Base64-encoded MLS Welcome TLV */
  welcomeTlv: string;
  /** MLS group id (base64url) */
  groupId: string;
  /** MLS ciphersuite */
  ciphersuite: MlsCiphersuite;
  /** Unix timestamp */
  createdAt: number;
}

// ============================================================================
// MIP-03 — Group Event (encrypted group message)
// ============================================================================

/**
 * MLS application message (group event).
 *
 * Published as a Nostr event (kind TBD per Marmot spec) where content
 * is a ChaCha20-Poly1305 encrypted MLS ApplicationMessage TLV.
 *
 * ChaCha20-Poly1305 is the AEAD used by MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519
 * and related ciphersuites for application data.
 *
 * The event is NOT gift-wrapped — MLS provides sender unlinkability via
 * the group ratchet. The encrypted content reveals nothing about the sender.
 */
export interface GroupEvent {
  /** Nostr event id */
  eventId: string;
  /** hex pubkey of the sender's ephemeral identity (for relay delivery only) */
  senderEphemeralPubkey: string;
  /** MLS group id (base64url) */
  groupId: string;
  /** MLS epoch this message was sent in */
  epoch: number;
  /** ChaCha20-Poly1305 encrypted MLS ApplicationMessage TLV (base64) */
  encryptedContent: string;
  /** Unix timestamp */
  createdAt: number;
  /** Optional NIP-40 expiration timestamp */
  expiresAt?: number;
}

/** Decrypted payload from a GroupEvent */
export interface GroupEventDecrypted {
  /** Client-generated message UUID */
  messageId: string;
  /** Content type — text, media, reaction, etc. */
  contentType: 'text' | 'media' | 'reaction' | 'control';
  /** Plaintext content (for text messages) */
  text?: string;
  /** Media attachment (for media messages) */
  attachment?: MlsMediaAttachment;
  /** Ephemeral config (if burnAfterRead or TTL set) */
  ephemeral?: {
    ttl?: number;
    burnAfterRead?: boolean;
  };
  /** Reply-to message id */
  replyTo?: string;
}

// ============================================================================
// MIP-04 — MLS Media Attachment
// ============================================================================

/**
 * Media attachment in an MLS group message.
 *
 * Per MIP-04, media is encrypted with a per-file symmetric key (stored in the
 * MLS application message) before upload. The relay/CDN sees only ciphertext.
 */
export interface MlsMediaAttachment {
  /** Encrypted file URL (HTTPS) */
  url: string;
  /** MIME type of the decrypted file */
  mimeType: string;
  /** File size in bytes (of the encrypted file) */
  size: number;
  /** SHA-256 hash (hex) of the encrypted file for integrity verification */
  sha256: string;
  /** Per-file symmetric key (base64url) — stored in the MLS application message */
  encryptionKey: string;
  /** IV / nonce for the file encryption (base64url) */
  encryptionIv: string;
  /** Encryption algorithm — always "chacha20-poly1305" for MIP-04 */
  encryptionAlgorithm: 'chacha20-poly1305';
  /** Blurhash for image preview (before decryption) */
  blurhash?: string;
  /** Image / video dimensions */
  dimensions?: { width: number; height: number };
  /** Duration in seconds (for audio/video) */
  durationSeconds?: number;
  /** Original filename */
  filename?: string;
}

// ============================================================================
// MIP-05 — MLS Push Notification
// ============================================================================

/**
 * Push notification metadata for MLS group messages.
 *
 * Per MIP-05, push notifications for MLS messages must NOT reveal:
 * - The sender's identity
 * - The message content
 * - Group membership
 *
 * Only a delivery hint is sent. The client fetches and decrypts the actual
 * message after waking up from the push notification.
 */
export interface MlsPushNotification {
  /** Notification type — always "mls:new_message" */
  type: 'mls:new_message';
  /** MLS group id (base64url) — client uses this to filter relay queries */
  groupId: string;
  /** Approximate message epoch (for ordering) */
  epoch: number;
  /** Relay URL where the message can be fetched */
  relayHint: string;
  /** Nostr event id of the group event to fetch */
  eventId: string;
}

// ============================================================================
// Protocol version marker
// ============================================================================

/** Marmot protocol version string used in kind:443 tags */
export const MARMOT_PROTOCOL_VERSION = 'mls-1.0' as const;

/** kind number for MLS KeyPackage events */
export const KIND_MLS_KEY_PACKAGE = 443 as const;

/** kind number for MLS push registration (MIP-05 placeholder) */
export const KIND_MLS_PUSH = 22457 as const;

/**
 * Utility: Check if a Nostr event is a MLS KeyPackage (kind:443).
 */
export function isKeyPackageEvent(event: { kind: number }): boolean {
  return event.kind === KIND_MLS_KEY_PACKAGE;
}

/**
 * Utility: Extract cipher suite from a kind:443 event's tags.
 */
export function extractCiphersuite(
  tags: string[][],
): MlsCiphersuite | undefined {
  const tag = tags.find((t) => t[0] === 'cipher_suite');
  if (!tag || !tag[1]) return undefined;
  const val = parseInt(tag[1], 10);
  return isNaN(val) ? undefined : (val as MlsCiphersuite);
}

/**
 * Utility: Extract client name from a kind:443 event's tags.
 */
export function extractClientName(tags: string[][]): string | undefined {
  const tag = tags.find((t) => t[0] === 'client');
  return tag?.[1];
}
