# Notifications

Satnam provides in-app notifications and push notifications for new messages, mentions, and group activity. The notification system follows the **0xchat push model** using `kind:22456` encrypted push configuration events, so a push server can forward messages to your device when you are offline.

---

## In-App Notification Center

The notification center is accessible from the bell icon in the Messages page header. It shows:

- **Unread count badge** (orange pill) on the bell icon
- **Thread-grouped notification list** — multiple messages from the same thread are collapsed
- **Mark all read** button (double checkmark)
- **Per-thread read** — tap the checkmark next to a thread to mark it as read

### Notification Grouping

If you receive 5 messages from the same group while the app is in the background, they appear as a single grouped entry showing the sender name and the most recent message preview. The unread count badge shows the total (5).

---

## Per-Thread Notification Settings

Each thread has its own notification preference, settable in:
- **Messages → Thread → Settings** (group chats)
- **Notification Center → thread settings icon** (all thread types, coming soon)

| Preference | Behavior |
|---|---|
| **All messages** | In-app notification + push for every message |
| **Mentions only** | Notify only when your npub is explicitly @-mentioned in a group |
| **Muted** | No in-app or push notifications; messages are still delivered and stored |

---

## Push Notifications (0xchat Model)

Satnam implements the same push notification model as 0xchat, using `kind:22456` device registration events.

### How Push Works

When you go offline, messages keep arriving at the relay. Without a push mechanism, you would only see them the next time you open the app. Push notifications solve this by:

1. **Registration:** Your device registers with a push server by publishing a `kind:22456` event containing your encrypted push configuration (device token, relays to monitor, kinds to forward)
2. **Online mode:** While you are online, you send periodic heartbeat signals. The push server sees you are active and does not forward messages (you are receiving them directly)
3. **Offline detection:** When heartbeats stop, the push server assumes you are offline and starts forwarding new gift-wrapped messages to your device's push service (Apple APNs / Google FCM)
4. **Re-connection:** When you open the app, you mark yourself online again. The push server stops forwarding and you receive messages directly from the relay

### Setting Up Push Notifications

1. Open **Messages** → **Settings** → **Push Notifications**
2. Tap **Enable Push Notifications**
3. Allow the browser notification permission request
4. Satnam publishes your `kind:22456` registration event to your selected relays

The push server never sees your message content — it only forwards encrypted gift-wrap events (kind:1059) that it cannot decrypt.

### Push Notification Privacy

The `kind:22456` registration event is encrypted to the push server's pubkey:

```json
{
  "kind": 22456,
  "tags": [
    ["p", "<push_server_pubkey>"]
  ],
  "content": "<NIP-44 encrypted push config>"
}
```

The encrypted content contains:
- Your device push token (APNs/FCM token)
- List of relay URLs to monitor
- List of event kinds to forward (typically `[1059]` for gift-wraps)
- Your notification preferences

The push server knows your public key (so it can decrypt your config) but cannot read your messages (gift-wraps are encrypted to your pubkey, not the push server's).

---

## Web Push API

On desktop browsers (Chrome/Edge/Firefox), Satnam uses the Web Push API for browser-native push notifications. When push is enabled:

1. A service worker push event fires when a new notification arrives
2. The notification shows the sender name and a preview ("New encrypted message")
3. Clicking the notification opens the Messages page with the relevant thread selected

**Note:** Message content is never included in the push notification payload — the preview says "New encrypted message" to prevent content exposure through the notification system. The full message is decrypted client-side when you open the app.

### iOS (Safari PWA)

iOS Safari supports Web Push for PWA home screen apps as of iOS 16.4. Install Satnam via Safari's "Add to Home Screen," then enable push notifications from the PWA. Web Push is not available in Safari's in-browser tab mode.

---

## Notification Badge Count

The orange badge on the navigation bell icon shows the total unread message count across all non-muted threads. The count:

- Increments when a new gift-wrap arrives for your pubkey
- Decrements when you open and read the thread
- Resets to 0 when you tap "Mark all read"

The badge is updated in real-time as messages arrive via the relay WebSocket subscription.

---

## Relay Notifications

For relay-based notification delivery (no push server required), Satnam subscribes to `kind:1059` gift-wrap events addressed to your pubkey. This works while the app is open. For background delivery, push notifications (above) are required.

---

## Related Pages

- [Messaging Overview](./README.md)
- [Developer Reference: useNotifications](../../developer-reference/hooks/use-notifications.md)
- [Developer Reference: NotificationManager](../../developer-reference/libraries/messaging.md#notificationmanager)
