# useNotifications

**File:** `src/hooks/useNotifications.tsx`

Provides in-app notification state and push device registration. Follows the **0xchat push model** (`kind:22456`). Must be used within a `NotificationsProvider`.

---

## Setup

```tsx
import { NotificationsProvider } from '../hooks/useNotifications';

export default function MessagesPage() {
  return (
    <NotificationsProvider>
      <MessagesContent />
    </NotificationsProvider>
  );
}
```

---

## Hook Signature

```typescript
function useNotifications(): NotificationsContextValue
```

### Throws

`Error: useNotifications must be used within a NotificationsProvider`

---

## Return Value

### State

| Property | Type | Description |
|---|---|---|
| `notifications` | `InAppNotification[]` | All notifications, newest first |
| `unreadCount` | `number` | Total unread count across all threads |
| `unreadByThread` | `Record<string, number>` | Unread count per `threadId` |
| `pushRegistration` | `PushRegistrationState` | Current push device registration state |

### Actions

#### `markAllRead()`

```typescript
markAllRead: () => void
```

Sets `isRead: true` on all notifications. Resets `unreadCount` to 0.

#### `markThreadRead(threadId)`

```typescript
markThreadRead: (threadId: string) => void
```

Sets `isRead: true` on all notifications for the given thread. Decrements `unreadCount` accordingly.

#### `registerPushDevice(deviceToken, relays)`

```typescript
registerPushDevice: (deviceToken: string, relays: string[]) => Promise<void>
```

Registers the device for push notifications. Publishes a `kind:22456` event encrypted to the push server's pubkey containing:
- `deviceToken`: Platform push token (APNs / FCM)
- `relays`: Relay URLs to monitor for new gift-wraps
- `notifyKinds`: `[1059]` (gift-wrap events)

**Requires:** Push notification permission granted by user (Web Push API).

#### `unregisterDevice()`

```typescript
unregisterDevice: () => Promise<void>
```

Clears push registration on logout. Publishes a `kind:22456` with empty config to signal deregistration to the push server.

#### `setOnlineStatus(online)`

```typescript
setOnlineStatus: (online: boolean) => void
```

Updates the online status. Called by the app's heartbeat scheduler:
- `true` → heartbeat sending; push server does not forward messages
- `false` → going offline; push server begins forwarding

---

## PushRegistrationState

```typescript
interface PushRegistrationState {
  isRegistered: boolean;
  deviceToken?: string;
  pushServerPubkey?: string;
  relays?: string[];
  isOnline: boolean;
}
```

---

## InAppNotification

```typescript
interface InAppNotification {
  id: string;
  threadId: string;
  threadName: string;
  senderName: string;
  senderPubkey: string;
  preview: string;       // Truncated message content (safe for display)
  timestamp: number;     // Unix seconds
  isRead: boolean;
  isGroup: boolean;
}
```

---

## Usage Example: Bell Badge

```tsx
import { useNotifications } from '../hooks/useNotifications';
import { Bell } from 'lucide-react';

function NavBell() {
  const { unreadCount } = useNotifications();

  return (
    <div className="relative">
      <Bell size={20} />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[#f7931a] text-black text-[9px] font-bold flex items-center justify-center">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </div>
  );
}
```

---

## Usage Example: Push Registration

```tsx
import { useNotifications } from '../hooks/useNotifications';

function PushSettingsPanel() {
  const { pushRegistration, registerPushDevice, unregisterDevice } = useNotifications();

  async function handleEnable() {
    // Request Web Push permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Get device token (platform-specific)
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true });
    const token = JSON.stringify(sub);

    await registerPushDevice(token, ['wss://relay.satnam.pub']);
  }

  return (
    <div>
      {pushRegistration.isRegistered ? (
        <button onClick={unregisterDevice}>Disable Push</button>
      ) : (
        <button onClick={handleEnable}>Enable Push</button>
      )}
    </div>
  );
}
```

---

## Integration with `useMessaging`

`useNotifications` and `useMessaging` are separate contexts but work together:

- When `useMessaging.selectThread(id)` is called, it triggers `useNotifications.markThreadRead(id)` to clear the thread's unread count
- New messages arriving via relay subscription update both `useMessaging` (add to messages) and `useNotifications` (increment unread count + add notification)

In `MessagesPage`, both providers are wrapped together:

```tsx
<NotificationsProvider>
  <MessagingProvider>
    <MessagesContent />
  </MessagingProvider>
</NotificationsProvider>
```

---

## Related

- [`useMessaging`](./use-messaging.md)
- [NotificationCenter component](../components/README.md#messaging-7-components)
- [Notifications user guide](../../user-guides/messaging/notifications.md)
- [Developer Reference: NotificationManager](../libraries/messaging.md#notificationmanager)
