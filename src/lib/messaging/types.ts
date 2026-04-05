/**
 * @module messaging/types
 * @description All shared types for Satnam v2 messaging infrastructure.
 *
 * Covers group threads, direct threads, messages, ephemeral config,
 * notification preferences, push registrations, and message status.
 */

// ============================================================================
// Thread Types
// ============================================================================

/** Discriminated union for thread kind */
export type ThreadType = 'direct' | 'group' | 'self';

/** Notification preference per thread */
export type NotificationPreference = 'all' | 'mentions' | 'none';

/** Delivery / lifecycle status for a message */
export type MessageStatus =
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'expired'
  | 'deleted';

// ============================================================================
// Group Configuration
// ============================================================================

export interface GroupConfig {
  /** Human-readable group name */
  name: string;
  /** bech32 npub (or hex pubkey) of each member */
  members: string[];
  /** Subset of members with admin privileges */
  admins: string[];
  /** Preferred relay URLs for this group */
  relayUrls: string[];
  /** Optional group avatar URL or NIP-94 event id */
  avatar?: string;
  /** Optional short description */
  description?: string;
  /** Unix timestamp of group creation */
  createdAt: number;
  /** Unix timestamp of last config update */
  updatedAt: number;
}

// ============================================================================
// Ephemeral Configuration
// ============================================================================

export interface EphemeralConfig {
  /**
   * TTL in seconds. Added to current unix timestamp → NIP-40 `expiration` tag.
   * Preset values: 300 (5m), 3600 (1h), 86400 (24h), 604800 (7d).
   * Set to 0 to disable TTL.
   */
  ttl: number;
  /**
   * When true, the sender publishes a NIP-09 kind:5 deletion event after
   * receiving a read receipt from the recipient.
   */
  burnAfterRead: boolean;
}

/** Standard TTL presets in seconds */
export const TTL_PRESETS = {
  FIVE_MINUTES: 300,
  ONE_HOUR: 3600,
  ONE_DAY: 86400,
  SEVEN_DAYS: 604800,
} as const;

export type TtlPreset = (typeof TTL_PRESETS)[keyof typeof TTL_PRESETS];

// ============================================================================
// Message
// ============================================================================

/** Read receipt from a specific recipient */
export interface ReadReceipt {
  recipientPubkey: string;
  readAt: number; // unix timestamp
}

/** A single message within a thread */
export interface Message {
  /** Client-generated UUID (not a Nostr event id) */
  id: string;
  /** Nostr event id of the kind:14 rumor (unwrapped) */
  eventId?: string;
  /** Nostr event id of the kind:1059 gift-wrap wrapper */
  wrapperEventId?: string;
  /** hex pubkey of the sender */
  senderPubkey: string;
  /** Thread this message belongs to */
  threadId: string;
  /** Plaintext content after decryption */
  content: string;
  /** Unix timestamp (from the rumor's created_at) */
  createdAt: number;
  /** Delivery / lifecycle status (local optimistic state) */
  status: MessageStatus;
  /** Ephemeral config if this message is ephemeral */
  ephemeral?: EphemeralConfig;
  /**
   * NIP-40 expiration unix timestamp. Set when ephemeral.ttl > 0.
   * Equals createdAt + ephemeral.ttl.
   */
  expiresAt?: number;
  /** Populated once recipients send read receipts */
  readReceipts: ReadReceipt[];
  /** True if the message has been deleted via NIP-09 */
  deleted: boolean;
  /** Optional NIP-40 expiration tag value (mirrors expiresAt) */
  expirationTag?: number;
  /** Optional reply-to event id for threading */
  replyTo?: string;
  /** Optional media / file attachments (NIP-94 compatible) */
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  url: string;
  mimeType: string;
  size?: number;
  hash?: string; // sha256 hex
  /** blurhash for images */
  blurhash?: string;
  /** width × height for images/video */
  dimensions?: { width: number; height: number };
}

// ============================================================================
// Threads
// ============================================================================

/** Base fields shared by all thread types */
interface ThreadBase {
  id: string;
  type: ThreadType;
  /** Unix timestamp of the most recent message */
  lastActivity: number;
  /** Last message preview (truncated plaintext) */
  lastMessagePreview?: string;
  /** Number of unread messages */
  unreadCount: number;
  /** Per-thread notification preference */
  notificationPreference: NotificationPreference;
  /** True if this thread has any ephemeral messages */
  hasEphemeral: boolean;
  /** True if the thread is muted */
  muted: boolean;
}

/** A 1:1 direct message thread */
export interface DirectThread extends ThreadBase {
  type: 'direct';
  /** hex pubkey of the remote contact */
  recipientPubkey: string;
  /** Display name (from kind:0 profile or contact list) */
  recipientDisplayName?: string;
  /** True if this contact is PoL-verified (requires NFC+PIN for sends) */
  polVerified: boolean;
  /** hex pubkey of self (for self-addressed note-to-self threads) */
  selfPubkey?: string;
}

/** A group message thread */
export interface GroupThread extends ThreadBase {
  type: 'group';
  /** Unique group id (used in d-tag: satnam:group:{groupId}) */
  groupId: string;
  /** Group configuration */
  config: GroupConfig;
  /** hex pubkey of the local user (to check admin status) */
  localPubkey: string;
}

/** Self-addressed note-to-self thread */
export interface SelfThread extends ThreadBase {
  type: 'self';
  selfPubkey: string;
}

export type MessageThread = DirectThread | GroupThread | SelfThread;

// ============================================================================
// Push Notifications
// ============================================================================

/**
 * Push device registration.
 * Follows 0xchat push notification model (kind:22456).
 */
export interface PushRegistration {
  /** Device / browser push token (from Web Push API subscription) */
  deviceToken: string;
  /** Nostr pubkey of the push notification server */
  pushServerPubkey: string;
  /** Relay URLs the push server should monitor */
  relays: string[];
  /** Event kinds the push server should notify about */
  notifyKinds: number[];
  /** True if the device is currently registered */
  active: boolean;
  /** Unix timestamp when the registration expires (optional) */
  expiresAt?: number;
}

/** Per-thread notification preference record */
export interface ThreadNotificationPreference {
  threadId: string;
  preference: NotificationPreference;
  /** Optional list of pubkeys whose mentions should always notify */
  watchedPubkeys?: string[];
}

/** In-app notification entry */
export interface InAppNotification {
  id: string;
  threadId: string;
  threadType: ThreadType;
  senderPubkey: string;
  senderDisplayName?: string;
  messagePreview: string;
  receivedAt: number; // unix timestamp
  read: boolean;
}

// ============================================================================
// Protocol
// ============================================================================

/** Currently supported messaging protocols */
export type MessagingProtocol = 'nip17' | 'mls';

/** Result of protocol negotiation */
export interface ProtocolNegotiationResult {
  protocol: MessagingProtocol;
  /** True when falling back from MLS to NIP-17 */
  isFallback: boolean;
  /** MLS key package event id if MLS was detected */
  mlsKeyPackageEventId?: string;
  reason: string;
}

/** Current protocol capability report */
export interface ProtocolStatus {
  localProtocol: MessagingProtocol;
  hasPublishedKeyPackage: boolean;
  keyPackageEventId?: string;
  supportedProtocols: MessagingProtocol[];
}
