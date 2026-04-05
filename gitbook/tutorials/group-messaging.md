# Tutorial: Setting Up Your First Group Chat

This tutorial walks you through creating a private encrypted group chat in Satnam, adding members, sending your first messages, configuring ephemeral settings, and managing group notifications.

**Time:** ~10 minutes  
**Prerequisites:** Satnam installed and vault unlocked; at least two Nostr contacts' npubs

---

## Step 1: Open Messages

From the Satnam main navigation, tap **Messages** (or navigate to `/messages`).

You will see the Messages page with a thread list on the left (empty if this is your first time) and an empty state on the right: "Select a Conversation."

---

## Step 2: Create a New Group

1. Tap the **+** button in the top-right of the Messages header
2. Select **New Group** from the menu

A "Create Group" dialog appears.

---

## Step 3: Name Your Group

Enter a name for your group. This name is stored privately in your `kind:30078` group config event and is never published to any relay. Choose something descriptive:

- ✓ "Satnam Dev Team"
- ✓ "Family Coordination"
- ✓ "Project Alpha"

Tap **Next**.

---

## Step 4: Add Members

Add each member by their `npub` or NIP-05 identifier (`user@satnam.pub`):

1. Type or paste the npub/NIP-05 of the first member
2. Tap the **+** (add) button
3. The member appears in the list with their display name (if resolvable)
4. Repeat for each additional member

**Tip:** You can add up to 50 members comfortably. For groups over 50, message delivery is still reliable but may be slower as Satnam generates one gift-wrap event per member per message.

When you have added all members, tap **Create Group**.

---

## Step 5: Wait for the Group to be Created

Satnam:
1. Generates a unique `groupId`
2. Creates the encrypted `kind:30078` group state event in your vault
3. For each member, publishes a NIP-17 gift-wrapped welcome message with the group config

A spinner appears briefly. When the group is created, you are taken directly to the new group chat view.

---

## Step 6: Send Your First Message

The group chat view opens with an empty message area and the group header showing:
- Group name
- Stacked member avatars
- Member count
- NIP-17 protocol badge (blue)

In the compose bar at the bottom:
1. Type your first message (e.g., "Hey everyone, this is our new secure group!")
2. Press **Enter** or tap the **Send** (arrow) button

Your message appears in the chat as a sent bubble (right-aligned, bitcoin-orange/20 background). After ~0.5s, the status indicator shows:
- ✓ (sent to relay)
- ✓✓ (delivered, when recipient acknowledges)
- ✓✓ orange (read, when recipient marks read)

---

## Step 7: Configure Ephemeral Settings (Optional)

To send a self-destructing message:

1. In the compose bar, tap the **🔥 flame icon** (left of the text area)
2. The Ephemeral panel opens showing TTL options
3. Select a duration: **5 minutes**, **1 hour**, **24 hours**, **7 days**, or **Custom**
4. Optionally toggle **Burn After Read** — message deletes the moment the recipient reads it
5. The compose bar now shows a yellow ephemeral indicator
6. Type your message and send

Ephemeral messages display with a **dashed border** and a **countdown timer** in yellow text. When fewer than 60 seconds remain, the timer turns red and pulses urgently.

To turn off ephemeral for the next message, reopen the flame panel and select **Off**.

---

## Step 8: Manage Group Notifications

To set your notification preference for this group:

1. In the group header, tap the **⚙ settings gear** icon
2. Scroll to **Notifications**
3. Choose:
   - **All messages** — notify for every group message
   - **Mentions only** — notify only when your npub is @-mentioned
   - **Muted** — no notifications (you still receive messages)

Changes take effect immediately.

---

## Step 9: Add or Remove Members (Admin Only)

If you are the group admin:

### Add a New Member

1. **Settings** → **Members** section → type the npub in the input field
2. Tap the **+** button
3. The new member receives a gift-wrapped welcome message with the group config

### Remove a Member

1. **Settings** → **Members** → find the member
2. Tap the **remove (UserMinus)** icon next to their name
3. Confirm the removal

The removed member receives a NIP-17 notification. Remaining members see a removal notice.

---

## Step 10: Verify Encryption (Optional)

To verify what the relay can and cannot see:

1. Tap the **NIP-17** badge in the group header
2. The protocol details popover shows:
   - **Forward Secrecy:** "Per-session NIP-44 ChaCha20-Poly1305..."
   - **Peer Protocol Support:** "Peer has not published a MLS KeyPackage" (or MLS if supported)
3. Relay operators see only anonymous `kind:1059` gift-wrap events — no sender, no recipient list, no content

---

## What Happens Next

Your group is live. Here's what to expect:

| Scenario | What happens |
|---|---|
| You close the app | Messages are stored on the relay, delivered when you reconnect |
| A member goes offline | Their messages arrive when they reconnect |
| Push enabled | New messages notify your device even when app is closed |
| You tap a new message notification | Opens the app directly to the relevant group |

---

## Leaving the Group

If you want to leave:

1. **Settings** → scroll to **Danger Zone**
2. Tap **Leave Group**
3. Confirm

You stop receiving messages. Other members are notified.

---

## Troubleshooting

**Members are not receiving the welcome message:**
- Confirm their npub is correct
- Check that your relay is reachable (Pylon connection indicator in app)
- Members may need to reconnect to their relay to pick up the welcome

**Messages show "sending" indefinitely:**
- Check your relay connection
- Try disabling/enabling your network connection
- CEPS will retry publishing with exponential backoff

**Group chat feels slow for large groups (50+ members):**
- This is expected: NIP-17 creates one gift-wrap per member per message
- For groups over 50, consider whether MLS upgrade (Phase 2) would be beneficial

---

## Related Pages

- [Group Messaging User Guide](../user-guides/messaging/group-messaging.md)
- [Ephemeral Messages Guide](../user-guides/messaging/ephemeral-messages.md)
- [Notifications Guide](../user-guides/messaging/notifications.md)
- [Protocol Reference: NIP-17](../protocol-reference/messaging-protocols.md)
