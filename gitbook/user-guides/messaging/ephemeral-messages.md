# Ephemeral Messages

Ephemeral messages self-destruct after a configured time period. They are implemented using **NIP-40** (`expiration` tag) for relay-side expiry combined with client-side auto-deletion. Satnam also supports **Burn After Read** — messages that delete the moment the recipient reads them.

Use ephemeral messages when:
- Sharing sensitive information that should not persist
- Having conversations you want to leave no digital trace of
- Discussing time-sensitive content (meeting locations, OTP codes)

---

## Time-to-Live (TTL) Options

| TTL | Use case |
|---|---|
| **5 minutes** | One-time codes, meeting coordinates |
| **1 hour** | Sensitive discussion sessions |
| **24 hours** | Daily operational messages |
| **7 days** | Short-term project coordination |
| **Custom** | Enter any duration in seconds |

If no TTL is set but Burn After Read is enabled, the message has no time limit — it deletes only upon the recipient reading it.

---

## Setting an Ephemeral TTL

1. In the compose bar, tap the **🔥 flame icon** (Ephemeral button)
2. Select a TTL from the dropdown: 5m, 1h, 24h, 7d, or Custom
3. Compose and send your message normally

Messages with an active TTL are displayed with a **dashed border** and a **countdown timer** showing the remaining time. When fewer than 60 seconds remain, the timer turns red and pulses.

---

## Burn After Read

Burn After Read deletes a message the moment the recipient's client marks it as read.

**How it works:**
1. Sender sends an ephemeral message with the `burnAfterRead` flag
2. When the recipient's client opens and displays the message, it publishes a read receipt
3. Sender's client receives the read receipt and publishes a `kind:5` event deletion request for the original message
4. Both sender's and recipient's clients delete the message from local storage and UI

**Limitations:**
- Relies on the recipient's client honouring the deletion request
- Relay deletion (`kind:5`) is a best-effort request — relays are not required to delete events
- A malicious recipient could capture the message content before deletion
- Screenshots are always possible

Burn After Read is a privacy-by-default tool, not an absolute security guarantee.

---

## How Expiration Works (NIP-40)

Every ephemeral message includes an `expiration` tag with a Unix timestamp:

```json
{
  "kind": 13,
  "tags": [
    ["expiration", "1700086400"]
  ],
  "content": "<NIP-44 encrypted content>"
}
```

The expiration is applied to the **inner seal** (kind:13) before it is gift-wrapped. The outer gift-wrap (kind:1059) does not expose the expiration tag — relay operators cannot see when messages expire.

**Relay-side enforcement:** Relays that implement NIP-40 automatically refuse to serve expired events and garbage-collect them from storage. Satnam's relay (Pylon) implements NIP-40.

**Client-side enforcement:** Satnam's `processExpiredMessages()` function runs on app startup and periodically during use. It:
1. Scans all locally stored messages for expired ones
2. Removes them from the local message store
3. Removes them from the thread UI
4. For burn-after-read messages: publishes `kind:5` deletion events

---

## Countdown Timer Display

Active ephemeral messages show a **flame icon** and a countdown timer in the message bubble:

| Time remaining | Display | Style |
|---|---|---|
| > 1 minute | `4m 32s` | Yellow text |
| < 60 seconds | `45s` | Red text, pulsing animation |
| 0 | `Expired` | Grayed out, message removed |

The timer updates every second in real-time. When a message expires, it fades out of the thread automatically without requiring a page refresh.

---

## Privacy Implications

### What Ephemeral Messages Protect Against

- **Relay-side persistence:** NIP-40 prevents relays from storing messages past expiry
- **Long-term data exposure:** Past messages don't accumulate on relays indefinitely
- **Casual device access:** If someone briefly accesses your device after expiry, messages are gone

### What Ephemeral Messages Do Not Protect Against

- **Active interception:** An attacker who can read your relay feed in real-time sees the message before it expires
- **Recipient screenshots:** The recipient can always screenshot or copy the message content
- **Log analysis:** If the recipient's device is compromised, past messages may be recoverable from memory
- **Metadata:** The fact that ephemeral messages were sent/received is still visible to relay operators (as anonymous gift-wraps)

---

## Ephemeral in Group Chats

Ephemeral settings apply per-message, not per-group. You can:
- Send individual ephemeral messages in an otherwise permanent group chat
- Consistently use ephemeral for all group messages (enable ephemeral before each send)

Future enhancement: Group-level default ephemeral policy (Phase 2).

---

## Combination: TTL + Burn After Read

You can combine both:
- **TTL**: Message auto-deletes after the timer runs out, whether read or not
- **Burn After Read**: Message also deletes the moment it is read

If the recipient reads the message before the TTL expires, burn-after-read triggers immediately. If they never read it, the TTL timer handles deletion.

---

## Related Pages

- [Messaging Overview](./README.md)
- [Protocol Reference: NIP-40 Ephemeral Messages](../../protocol-reference/messaging-protocols.md#nip-40-expiration)
- [Developer Reference: EphemeralManager](../../developer-reference/libraries/messaging.md#ephemeralmanager)
