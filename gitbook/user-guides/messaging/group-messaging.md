# Group Messaging

Satnam group chats allow multiple Nostr contacts to communicate privately in a shared thread. Unlike many group chat systems, Satnam does not use a shared group encryption key. Instead, each message is individually gift-wrapped (NIP-17 kind:1059) to every group member — compromising one member's keys does not expose messages to other members.

---

## How Group Messages Work

When you send a message in a group:

1. Your message content is prepared
2. For each group member, Satnam creates a separate NIP-17 inner seal (kind:13) encrypted to that member's pubkey
3. Each inner seal is wrapped in its own gift-wrap event (kind:1059) signed by a one-time random key
4. All gift-wraps are published to the relay simultaneously

The result: relay operators see N gift-wrap events but cannot determine they are part of the same group message, who sent them, or who the recipients are. Group membership is private.

**Group state storage:** The group configuration (name, member pubkeys, admin list, relay list, avatar) is stored locally in a `kind:30078` app-specific data event with d-tag `satnam:group:{groupId}`. This event is encrypted and stored in your OPFS Vault — group membership is not published to any relay.

---

## Creating a Group

1. Open **Messages** → tap **+** (new message)
2. Select **New Group**
3. Enter a group name
4. Add members by entering their `npub` or NIP-05 identifiers, one at a time
5. Tap **Create Group**

Satnam sends each member a NIP-17 gift-wrapped welcome message containing the group configuration. Members do not need to be online to receive it — the welcome message is stored on the relay until they connect.

---

## Group Roles

Groups have two role levels:

| Role | Permissions |
|---|---|
| **Admin** | Add members, remove members, change group name/avatar, transfer admin |
| **Member** | Send and receive messages |

The group creator is automatically the first admin. Admins can transfer admin status to any member. A group must always have at least one admin.

---

## Adding Members

Admins only.

1. Open the group chat
2. Tap the **⚙ Settings** gear icon
3. In the **Members** section, enter the new member's `npub` or hex pubkey
4. Tap the **+** button

The new member receives a gift-wrapped group invite message. Optionally, you can send them a summary of recent group history (configurable — off by default to protect existing members' privacy).

---

## Removing Members

Admins only.

1. Open the group chat → **⚙ Settings**
2. Find the member in the list
3. Tap the **remove** (UserMinus) icon next to their name

The removed member receives a NIP-17 notification that they have been removed. Remaining members receive a notification that the member was removed (their messages remain in history, but no new messages are sent to them).

**Important:** Message history already delivered to the removed member's device cannot be retroactively deleted. If you require this, enable [ephemeral messages](./ephemeral-messages.md) for the group before the session.

---

## Admin Controls

### Change Group Name

Admins only. Settings → **Group Name** → tap the pencil icon, enter a new name, press **Save**.

### Change Group Avatar

Settings → tap the avatar to upload a new image. The image URL is stored in the group config event.

### Transfer Admin

Settings → **Members** → tap the crown icon next to a member's name to grant them admin status. You retain your own admin status.

---

## Message Delivery

Group messages are delivered via NIP-17 gift-wrap. Each member's client:

1. Subscribes to `kind:1059` (gift-wrap) events addressed to their pubkey
2. Decrypts the inner seal
3. Reads the plaintext message and sender identity

**Delivery guarantees:** NIP-17 does not provide delivery receipts by default. Read receipts (✓✓ indicators) are based on NIP-17 read acknowledgements and relay persistence — they are best-effort, not cryptographically guaranteed.

---

## Group Notifications

Each group member can set their notification preference independently:

| Preference | Description |
|---|---|
| **All messages** | Notify for every message |
| **Mentions only** | Notify only when your npub is @-mentioned |
| **Muted** | No in-app notifications; messages still stored |

Change notification preference in **Settings → Notifications** within the group, or globally in the notification center. See [Notifications](./notifications.md).

---

## Leaving a Group

Settings → scroll to **Danger Zone** → **Leave Group**.

You will stop receiving messages from the group. The remaining members are notified. Your past messages remain in history for other members.

---

## Group Size Recommendations

| Group size | NIP-17 performance |
|---|---|
| 2–10 members | Excellent — minimal relay overhead |
| 10–50 members | Good — each message creates 10–50 gift-wrap events |
| 50–100 members | Adequate — relay may rate-limit rapid sends |
| 100+ members | Consider MLS upgrade (Phase 2) for logarithmic key scaling |

For large groups, Satnam's planned MLS (Marmot Protocol) upgrade will reduce encryption overhead from O(n) per message to O(log n). See [Protocol Reference: Messaging Protocols](../../protocol-reference/messaging-protocols.md).

---

## Tutorial

See [Tutorial: Setting Up Your First Group Chat](../../tutorials/group-messaging.md) for a step-by-step walkthrough.
