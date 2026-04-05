# Messaging Library

**Path:** `src/lib/messaging/`

The messaging library provides all backend logic for Satnam's messaging infrastructure: NIP-17 group and direct chat, ephemeral message management, push notifications, and the MLS protocol bridge for forward compatibility with the Marmot ecosystem.

---

## Types (`src/lib/messaging/types.ts`)

All shared types for both DM and group messaging.

```typescript
// Thread types
type ThreadType = 'direct' | 'group' | 'self';

// Message delivery lifecycle
type MessageStatus =
  | 'sending'    // optimistic send, not yet relayed
  | 'sent'       // published to relay
  | 'delivered'  // received by recipient relay
  | 'read'       // read receipt received
  | 'expired'    // NIP-40 TTL elapsed
  | 'deleted';   // kind:5 deletion event published

// Ephemeral message configuration
interface EphemeralConfig {
  ttl: number | null;       // TTL in seconds (null = no time limit)
  burnAfterRead: boolean;   // delete on recipient read receipt
}

// Individual message
interface Message {
  id: string;
  threadId: string;
  senderPubkey: string;
  content: string;
  timestamp: number;          // unix seconds
  status: MessageStatus;
  ephemeral?: EphemeralConfig;
  expiresAt?: number;         // unix timestamp (NIP-40 expiration)
  readBy?: string[];          // pubkeys that have read this message
  protocol: 'nip17' | 'mls';
}

// Thread participant
interface Participant {
  pubkey: string;
  displayName?: string;
  npub?: string;
  avatarUrl?: string;
  polTrustScore?: number;     // Circle of Trust score 0–100
  isAdmin?: boolean;
}

// Group configuration (kind:30078 d:satnam:group:{groupId})
interface GroupConfig {
  name: string;
  members: string[];          // pubkeys
  admins: string[];           // pubkeys (subset of members)
  relayUrls: string[];
  avatar?: string;
}

// Message thread (DM, group, or self)
interface MessageThread {
  id: string;
  type: ThreadType;
  name: string;
  participants: Participant[];
  lastMessage?: Pick<Message, 'content' | 'timestamp' | 'senderPubkey'>;
  unreadCount: number;
  hasEphemeral: boolean;
  avatarUrl?: string;
  protocol: 'nip17' | 'mls';
  groupId?: string;
  notificationPreference: NotificationPreference;
}

type NotificationPreference = 'all' | 'mentions' | 'none';
```

---

## GroupChatManager (`src/lib/messaging/group-chat.ts`)

Manages NIP-17 multi-party group messaging. Each message is gift-wrapped individually to each group member — there is no shared group key.

### `createGroup(name, memberPubkeys, config?)`

```typescript
createGroup(
  name: string,
  memberPubkeys: string[],
  config?: Partial<GroupConfig>
): Promise<string>
```

Creates a new group and sends welcome invites to all members.

**Returns:** `groupId` — the `d-tag` value for the group's `kind:30078` state event.

**Process:**
1. Generates a random `groupId`
2. Creates `kind:30078` group state event (encrypted, stored locally)
3. For each member, publishes a NIP-17 gift-wrapped welcome message containing the group config
4. Returns `groupId`

### `sendGroupMessage(groupId, content, ephemeralConfig?)`

```typescript
sendGroupMessage(
  groupId: string,
  content: string,
  ephemeralConfig?: EphemeralConfig
): Promise<void>
```

Sends a message to all group members. Creates N gift-wrap events (one per member).

If `ephemeralConfig.ttl` is set, the inner seal includes a NIP-40 `expiration` tag.

### `addMember(groupId, pubkey)`

```typescript
addMember(groupId: string, pubkey: string): Promise<void>
```

Adds a new member to the group and sends them a gift-wrapped welcome with the group config.

**Admin only:** Throws `PermissionError` if the calling pubkey is not in `admins[]`.

### `removeMember(groupId, pubkey)`

```typescript
removeMember(groupId: string, pubkey: string): Promise<void>
```

Removes a member from the group and notifies remaining members.

**Admin only.**

### `updateGroupConfig(groupId, updates)`

```typescript
updateGroupConfig(
  groupId: string,
  updates: Partial<Pick<GroupConfig, 'name' | 'avatar' | 'relayUrls'>>
): Promise<void>
```

Updates the group configuration and publishes the updated `kind:30078` event.

### `leaveGroup(groupId)`

```typescript
leaveGroup(groupId: string): Promise<void>
```

Removes the current user from the group. Notifies remaining members.

---

## DirectChatManager (`src/lib/messaging/direct-chat.ts`)

Enhanced NIP-17 DM client wrapping the existing `privacy-first-service`.

### `sendDirectMessage(recipientPubkey, content, ephemeralConfig?)`

```typescript
sendDirectMessage(
  recipientPubkey: string,
  content: string,
  ephemeralConfig?: EphemeralConfig
): Promise<void>
```

Sends a gift-wrapped NIP-17 DM to the recipient.

**PoL gate:** If the recipient is in your Circle of Trust (PoL-verified), this function triggers a `PinGatedOperation('message_send')` requiring NFC tap + PIN before publishing.

### `getDirectMessages(contactPubkey, since?, until?)`

```typescript
getDirectMessages(
  contactPubkey: string,
  since?: number,
  until?: number
): Promise<Message[]>
```

Fetches and decrypts all DMs with a contact from the relay subscription. Filters by timestamp range if provided.

### `markAsRead(messageId)`

```typescript
markAsRead(messageId: string): Promise<void>
```

Publishes a read receipt (ephemeral event). Triggers burn-after-read deletion if applicable.

### `deleteMessage(messageId)`

```typescript
deleteMessage(messageId: string): Promise<void>
```

Publishes a `kind:5` deletion event for the message. Removes from local store.

---

## EphemeralManager (`src/lib/messaging/ephemeral.ts`)

Manages ephemeral message lifecycle.

### `setMessageTtl(message, ttlSeconds)`

```typescript
setMessageTtl(message: Message, ttlSeconds: number): Message
```

Adds a NIP-40 `expiration` tag to the message's inner seal. Returns the modified message.

The expiration timestamp = `Math.floor(Date.now() / 1000) + ttlSeconds`.

### `setBurnAfterRead(message)`

```typescript
setBurnAfterRead(message: Message): Message
```

Marks the message with the `burnAfterRead` flag. When the recipient's read receipt arrives, `handleReadReceipt()` publishes a `kind:5` deletion.

### `processExpiredMessages()`

```typescript
processExpiredMessages(): Promise<{ deleted: number }>
```

Scans all locally stored messages for NIP-40 expiration timestamps in the past. Removes expired messages from the local store, updates thread UI, and publishes `kind:5` deletion events for expired ephemeral messages.

**Called:** On app startup, and every 30 seconds while the app is active.

### `handleReadReceipt(messageId, readerPubkey)`

```typescript
handleReadReceipt(messageId: string, readerPubkey: string): Promise<void>
```

Processes an incoming read receipt. If the message has `burnAfterRead: true`, publishes `kind:5` deletion and removes from local store.

---

## NotificationManager (`src/lib/messaging/notifications.ts`)

Push notification registration and in-app notification state management.

### `registerPushDevice(pushServerPubkey, deviceToken, relays, notifyKinds)`

```typescript
registerPushDevice(
  pushServerPubkey: string,
  deviceToken: string,
  relays: string[],
  notifyKinds: number[]
): Promise<void>
```

Publishes a `kind:22456` event encrypted to `pushServerPubkey` containing the push configuration.

**kind:22456 structure:**
```json
{
  "kind": 22456,
  "tags": [["p", "<push_server_pubkey>"]],
  "content": "<NIP-44 encrypted: { deviceToken, relays, notifyKinds }>"
}
```

### `sendHeartbeat()`

```typescript
sendHeartbeat(): Promise<void>
```

Publishes an ephemeral event signalling to the push server that the client is online. Push server holds forwarding while heartbeats arrive.

**Called:** Every 30 seconds while the app is active.

### `setOffline()`

```typescript
setOffline(): Promise<void>
```

Signals going offline. Push server begins forwarding new messages to the device.

**Called:** On `window` `beforeunload` and `visibilitychange` events.

### `unregisterDevice()`

```typescript
unregisterDevice(): Promise<void>
```

Clears push registration on logout. Publishes a `kind:22456` with empty config to deregister.

### `InAppNotificationCenter`

An in-memory class that tracks unread counts per thread and notification history. Populated by the relay subscription for `kind:1059` gift-wrap events.

```typescript
class InAppNotificationCenter {
  getUnreadCount(): number;
  getUnreadByThread(): Record<string, number>;
  getNotifications(): InAppNotification[];
  markAllRead(): void;
  markThreadRead(threadId: string): void;
  addNotification(notification: InAppNotification): void;
}
```

---

## ProtocolBridge (`src/lib/messaging/protocol-bridge.ts`)

Handles protocol detection and negotiation between NIP-17 and MLS (Marmot).

### `detectPeerProtocol(pubkey)`

```typescript
detectPeerProtocol(pubkey: string): Promise<'nip17' | 'mls' | 'both'>
```

Checks if the peer has published a `kind:443` MLS KeyPackage event. Returns `'mls'` if present, `'nip17'` if not, or `'both'` if they have both.

### `negotiateProtocol(pubkey)`

```typescript
negotiateProtocol(pubkey: string): Promise<'nip17' | 'mls'>
```

Determines the best protocol for a conversation. Returns `'mls'` only if both parties support it; otherwise `'nip17'`.

### `publishKeyPackage()`

```typescript
publishKeyPackage(): Promise<void>
```

Publishes a `kind:443` MLS KeyPackage event for forward compatibility with MLS-capable clients (White Noise, future Marmot clients). Satnam publishes this even while using NIP-17, so MLS clients can invite Satnam users.

### `wrapMessage(content, protocol, recipientPubkeys)`

```typescript
wrapMessage(
  content: string,
  protocol: 'nip17' | 'mls',
  recipientPubkeys: string[]
): Promise<NostrEvent[]>
```

Wraps a message in the appropriate protocol format. Returns one or more Nostr events ready to publish.

### `unwrapMessage(event)`

```typescript
unwrapMessage(event: NostrEvent): Promise<Message | null>
```

Detects the protocol of an incoming event (kind:1059 = NIP-17, kind:443-range = MLS) and decrypts it. Returns `null` if decryption fails or event is not addressed to the current user.

### `getProtocolStatus()`

```typescript
getProtocolStatus(): {
  nip17: boolean;
  mls: boolean;
  keyPackagePublished: boolean;
  lastKeyRotation?: number;
}
```

Returns the current client's protocol capability status.

---

## MLS Types (`src/lib/messaging/mls-types.ts`)

Forward-compatibility type definitions for the Marmot/MLS protocol. These are typed stubs for when `marmot-ts` is production-ready.

```typescript
// MIP-00: KeyPackage (kind:443)
interface KeyPackage {
  pubkey: string;
  keyPackageData: Uint8Array;  // MLS KeyPackage TLS-serialized
  cipherSuite: number;          // MLS cipher suite identifier
  extensions: MlsExtension[];
}

// MIP-01: MLS group configuration
interface MlsGroupConfig {
  groupId: string;
  cipherSuite: number;
  members: string[];            // pubkeys with KeyPackages
  epochNumber: number;
}

// MIP-02: Welcome event (NIP-59 gift-wrapped)
interface WelcomeEvent {
  groupId: string;
  welcome: Uint8Array;          // MLS Welcome TLS-serialized
  keyPackageRef: string;
}

// MIP-03: Group message (ChaCha20-Poly1305)
interface GroupEvent {
  groupId: string;
  epoch: number;
  ciphertext: Uint8Array;       // MLS MLSCiphertext
}

// MIP-04: Media attachment
interface MlsMediaAttachment {
  messageId: string;
  mimeType: string;
  encryptedUrl: string;
  decryptionKey: Uint8Array;
}

// MIP-05: Push notification config
interface MlsPushNotification {
  deviceToken: string;
  relays: string[];
  groupIds: string[];
}
```

---

## Barrel Exports (`src/lib/messaging/index.ts`)

```typescript
export { GroupChatManager } from './group-chat.js';
export { DirectChatManager } from './direct-chat.js';
export { EphemeralManager } from './ephemeral.js';
export { NotificationManager, InAppNotificationCenter } from './notifications.js';
export { ProtocolBridge } from './protocol-bridge.js';
export type * from './types.js';
export type * from './mls-types.js';
```
