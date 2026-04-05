# Messaging

Satnam v2 provides a complete private messaging system built on Nostr's NIP-17 gift-wrap protocol. All messages are end-to-end encrypted — relay operators, Satnam servers, and anyone intercepting network traffic cannot read your message content, or determine who messaged whom.

---

## Overview

Satnam supports four types of messaging threads:

| Thread type | Protocol | Use case |
|---|---|---|
| **Direct Message (DM)** | NIP-17 gift-wrap | One-to-one private conversation with any Nostr contact |
| **Group Chat** | NIP-17 multi-party | Private group conversations (gift-wrapped to each member individually) |
| **Note to Self** | NIP-17 self-addressed | Encrypted private notebook addressed to your own npub |
| **Ephemeral** | NIP-17 + NIP-40 | Self-destructing messages with countdown timers |

All messaging is accessible at **Settings → Messages** in the navigation, or directly at `/messages`.

---

## Encryption Guarantees

### What NIP-17 Encrypts

Every message passes through two layers:

1. **Inner seal (kind:13):** The message content is encrypted with NIP-44 (ChaCha20-Poly1305 + HKDF) using a shared secret derived from the sender's private key and the recipient's public key. The seal hides the actual sender pubkey.

2. **Gift-wrap outer (kind:1059):** The inner seal is wrapped in a gift-wrap event signed by a random one-time key. This hides both the sender and recipient pubkeys from relay operators — a relay sees only that *someone* is sending *something* to *someone*.

**What NIP-17 protects:**
- Message content (fully encrypted)
- Sender identity (hidden by inner seal)
- Recipient identity (hidden by gift-wrap)
- Relationship graph (relay operators cannot see who talks to whom)

**What NIP-17 does not protect:**
- IP address metadata (use Tor if needed)
- Message timing patterns at the relay level
- Full forward secrecy (past messages are decryptable if your nsec is compromised)

For full forward secrecy, Satnam plans MLS protocol support in a future phase. See [Protocol Reference: Messaging Protocols](../../protocol-reference/messaging-protocols.md).

---

## PoL-Gated Sending

For contacts in your [Circle of Trust](../circle-of-trust/README.md) with a Proof of Life ceremony, outgoing messages require NFC + PIN verification before they are sent. This means:

- You must tap your NFC Name Tag card
- Enter your PIN
- The message is then signed and sent

This prevents an attacker who gains access to your unlocked device from impersonating you to your trusted contacts. Non-PoL contacts (regular Nostr users) do not require NFC + PIN.

---

## Thread Types

### Direct Messages (DM)

A one-to-one private conversation with any Nostr contact. To start a DM:

1. Open **Messages** → tap **+** (new message)
2. Enter the recipient's `npub` or NIP-05 identifier
3. Type your message and press **Send**

Messages are gift-wrapped (kind:1059) and relayed through the `unified-comms` Netlify function, which cannot read content.

### Group Chat

A multi-party private conversation. Each message is individually gift-wrapped to every group member — there is no shared group encryption key that could be compromised. Group state (name, members, admins) is stored locally using a `kind:30078` app-specific data event with d-tag `satnam:group:{groupId}`.

Admins can add/remove members and change the group name. See [Group Messaging](./group-messaging.md) for the full guide.

### Note to Self

An encrypted private notebook. Notes use the standard NIP-17 gift-wrap mechanism with `sender = recipient = your own public key`. Only your nsec can decrypt them. Notes support categories and free-form tags. See [Note to Self](../note-to-self.md).

### Ephemeral Messages

Messages with a time-to-live (TTL) that auto-delete after the configured period. You can also enable **Burn After Read**, which deletes the message as soon as the recipient reads it. See [Ephemeral Messages](./ephemeral-messages.md) for full details.

---

## Protocol Indicator

Each thread displays a small badge indicating the active messaging protocol:

- **NIP-17** (blue badge): Standard gift-wrap DMs. Current default for all threads.
- **MLS** (green badge): Marmot/MLS group encryption. Future phase — provides full forward secrecy for group chats.

Tap the badge to see forward secrecy status, peer protocol support, and key rotation information.

---

## Navigation

The Messages page (`/messages`) uses a split-panel layout:

- **Left panel:** Thread list — all DM, group, and self threads sorted by last activity, with unread count badges and ephemeral flame indicators.
- **Right panel:** Full chat view for the selected thread.
- **Mobile:** Full-screen thread list; tap a thread to open the full-screen chat view with a back button.

---

## Related Pages

- [Group Messaging](./group-messaging.md)
- [Ephemeral Messages](./ephemeral-messages.md)
- [Notifications](./notifications.md)
- [Note to Self](../note-to-self.md)
- [Protocol Reference: Messaging Protocols](../../protocol-reference/messaging-protocols.md)
- [Developer Reference: Messaging Library](../../developer-reference/libraries/messaging.md)
