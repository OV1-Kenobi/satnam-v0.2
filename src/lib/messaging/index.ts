/**
 * @module messaging
 * @description Barrel exports for the Satnam v2 messaging infrastructure.
 *
 * Includes:
 * - types.ts       — All messaging types
 * - group-chat.ts  — GroupChatManager (NIP-17 multi-party)
 * - direct-chat.ts — DirectChatManager (enhanced NIP-17 DM)
 * - ephemeral.ts   — EphemeralManager + TTL utilities
 * - notifications.ts — NotificationManager + InAppNotificationCenter
 * - protocol-bridge.ts — ProtocolBridge (NIP-17 / MLS negotiation)
 * - mls-types.ts   — MLS/Marmot forward-compat types
 */

// ============================================================================
// Types
// ============================================================================

export type {
  ThreadType,
  NotificationPreference,
  MessageStatus,
  GroupConfig,
  EphemeralConfig,
  TtlPreset,
  MessageAttachment,
  ReadReceipt,
  Message,
  DirectThread,
  GroupThread,
  SelfThread,
  MessageThread,
  PushRegistration,
  ThreadNotificationPreference,
  InAppNotification,
  MessagingProtocol,
  ProtocolNegotiationResult,
  ProtocolStatus,
} from './types.js';

export { TTL_PRESETS } from './types.js';

// ============================================================================
// Group Chat
// ============================================================================

export { GroupChatManager } from './group-chat.js';

// ============================================================================
// Direct Chat
// ============================================================================

export { DirectChatManager } from './direct-chat.js';
export type { PinGateCallback } from './direct-chat.js';

// ============================================================================
// Ephemeral
// ============================================================================

export {
  // Manager
  EphemeralManager,
  ephemeralManager,
  // Pure helpers
  setMessageTtl,
  setBurnAfterRead,
  isExpired,
  secondsUntilExpiry,
  formatCountdown,
  buildExpirationTag,
  parseExpirationTag,
  // Config factories
  ttl5m,
  ttl1h,
  ttl24h,
  ttl7d,
  ttlCustom,
} from './ephemeral.js';

export type { GcResult } from './ephemeral.js';

// ============================================================================
// Notifications
// ============================================================================

export {
  NotificationManager,
  InAppNotificationCenter,
  inAppNotificationCenter,
} from './notifications.js';

// ============================================================================
// Protocol Bridge
// ============================================================================

export { ProtocolBridge } from './protocol-bridge.js';

// ============================================================================
// MLS Types (forward-compat stubs — no marmot-ts dependency)
// ============================================================================

export type {
  MlsCiphersuite,
  KeyPackage,
  KeyPackageEvent,
  MlsGroupConfig,
  WelcomeEvent,
  GroupEvent,
  GroupEventDecrypted,
  MlsMediaAttachment,
  MlsPushNotification,
} from './mls-types.js';

export {
  KIND_MLS_KEY_PACKAGE,
  KIND_MLS_PUSH,
  MARMOT_PROTOCOL_VERSION,
  isKeyPackageEvent,
  extractCiphersuite,
  extractClientName,
} from './mls-types.js';
