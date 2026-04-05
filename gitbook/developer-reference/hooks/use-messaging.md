# useMessaging

**File:** `src/hooks/useMessaging.tsx`

Provides all messaging state and actions for the messaging UI. Wraps `GroupChatManager`, `DirectChatManager`, and `EphemeralManager` from the messaging library. Must be used within a `MessagingProvider`.

---

## Setup

Wrap the Messages page (or a subtree) with `MessagingProvider`:

```tsx
import { MessagingProvider } from '../hooks/useMessaging';

export default function MessagesPage() {
  return (
    <MessagingProvider>
      <MessagesContent />
    </MessagingProvider>
  );
}
```

---

## Hook Signature

```typescript
function useMessaging(): MessagingContextValue
```

### Throws

`Error: useMessaging must be used within a MessagingProvider` — if called outside the provider.

---

## Return Value

### State

| Property | Type | Description |
|---|---|---|
| `threads` | `MessageThread[]` | All threads sorted by last activity (descending) |
| `selectedThreadId` | `string \| null` | Currently selected thread ID |
| `messages` | `Message[]` | Messages for the selected thread |
| `isLoading` | `boolean` | True during initial data load |
| `isSending` | `boolean` | True while a message is being published |

### Actions

#### `selectThread(threadId)`

```typescript
selectThread: (threadId: string | null) => void
```

Sets the active thread. Automatically clears the unread count for the selected thread. Pass `null` to deselect.

#### `sendMessage(content, ephemeralConfig?)`

```typescript
sendMessage: (content: string, ephemeralConfig?: EphemeralConfig) => Promise<void>
```

Sends a message in the currently selected thread. Optimistically appends the message with `status: 'sending'`, then updates to `'sent'` on relay acknowledgement.

If `ephemeralConfig.ttl` is provided, adds a NIP-40 `expiration` tag to the inner seal. If `ephemeralConfig.burnAfterRead` is true, the message is flagged for deletion on read receipt.

**Throws:** If no thread is selected or content is empty.

#### `createGroup(name, memberPubkeys)`

```typescript
createGroup: (name: string, memberPubkeys: string[]) => Promise<string>
```

Creates a new group thread. Returns the `groupId`. Gift-wraps welcome messages to all members.

**Returns:** `groupId` string used as the `kind:30078` d-tag.

#### `addMember(groupId, pubkey)`

```typescript
addMember: (groupId: string, pubkey: string) => Promise<void>
```

Adds a member to a group. Admin only — throws `PermissionError` otherwise.

#### `removeMember(groupId, pubkey)`

```typescript
removeMember: (groupId: string, pubkey: string) => Promise<void>
```

Removes a member from a group. Admin only.

#### `leaveGroup(groupId)`

```typescript
leaveGroup: (groupId: string) => Promise<void>
```

Removes the current user from the group and removes the thread from state.

#### `updateGroupConfig(groupId, updates)`

```typescript
updateGroupConfig: (
  groupId: string,
  updates: Partial<Pick<MessageThread, 'name' | 'avatarUrl'>>
) => Promise<void>
```

Updates group name or avatar. Publishes updated `kind:30078` event.

#### `markRead(threadId)`

```typescript
markRead: (threadId: string) => void
```

Sets `unreadCount` to 0 for the given thread. Also triggers a read receipt for the latest message.

#### `deleteMessage(messageId)`

```typescript
deleteMessage: (messageId: string) => Promise<void>
```

Publishes a `kind:5` deletion event for the message and removes it from local state.

#### `setNotificationPreference(threadId, pref)`

```typescript
setNotificationPreference: (
  threadId: string,
  pref: 'all' | 'mentions' | 'none'
) => void
```

Updates the notification preference for a thread. Persisted to local storage.

---

## Usage Example

```tsx
import { useMessaging } from '../hooks/useMessaging';
import type { EphemeralConfig } from '../hooks/useMessaging';

function ComposeBar() {
  const { sendMessage, isSending, selectedThreadId } = useMessaging();
  const [text, setText] = useState('');
  const [ephemeral, setEphemeral] = useState<EphemeralConfig | null>(null);

  async function handleSend() {
    if (!text.trim() || isSending) return;
    await sendMessage(text.trim(), ephemeral ?? undefined);
    setText('');
  }

  return (
    <div>
      <textarea value={text} onChange={e => setText(e.target.value)} />
      <button onClick={handleSend} disabled={isSending || !selectedThreadId}>
        {isSending ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}
```

---

## ThreadList Usage Example

```tsx
import { useMessaging } from '../hooks/useMessaging';
import ThreadList from '../components/messaging/ThreadList';

function MessagesSidebar() {
  const { threads, selectedThreadId, selectThread } = useMessaging();

  return (
    <ThreadList
      threads={threads}
      selectedThreadId={selectedThreadId}
      onSelect={selectThread}
    />
  );
}
```

---

## Types

See [Messaging Library Types](../libraries/messaging.md) for full type definitions:
- `MessageThread`
- `Message`
- `EphemeralConfig`
- `MessageStatus`
- `ThreadType`
- `Participant`

---

## Related

- [`useNotifications`](./use-notifications.md)
- [Messaging Library](../libraries/messaging.md)
- [MessagesPage](../components/README.md#messaging-7-components)
