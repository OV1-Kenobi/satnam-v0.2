# Messaging Protocols

Satnam v2 implements a two-phase messaging protocol strategy:

1. **Phase 1 (current):** NIP-17 gift-wrapped DMs for all messaging — fully battle-tested
2. **Phase 2 (future):** MLS (Marmot Protocol) for group chats — superior forward secrecy and scalability

Both phases are designed with forward and backward compatibility as first-class concerns.

---

## NIP-17: Gift-Wrapped Direct Messages (Current)

NIP-17 provides metadata-protected private messaging over Nostr. It is the current default for all Satnam messaging.

### How NIP-17 Works

A NIP-17 message goes through three layers:

#### Layer 1: Plaintext Message (kind:14)

The actual message content in a Nostr event:

```json
{
  "kind": 14,
  "content": "Hello from Alice",
  "tags": [["p", "<recipient_pubkey>"]],
  "created_at": 1700000000
}
```

#### Layer 2: Inner Seal (kind:13)

The plaintext event is encrypted using NIP-44 (ChaCha20-Poly1305 + HKDF) to the recipient's pubkey. The seal is signed by a **random one-time key** (not the sender's actual key) to prevent linking the sealed event back to the sender:

```json
{
  "kind": 13,
  "content": "<NIP-44 encrypted kind:14 event>",
  "tags": [],
  "pubkey": "<random_sender_key>",
  "created_at": "<randomized_timestamp>"
}
```

The inner seal hides the actual sender's public key — the relay sees the random key, not Alice's key.

#### Layer 3: Gift Wrap (kind:1059)

The inner seal is wrapped in a gift-wrap event:

```json
{
  "kind": 1059,
  "content": "<NIP-44 encrypted kind:13 seal>",
  "tags": [["p", "<recipient_pubkey>"]],
  "pubkey": "<another_random_key>"
}
```

The gift wrap is encrypted to the recipient's pubkey. The relay can only see:
- The gift-wrap kind (1059)
- The recipient's pubkey (to route to the right subscription)
- Nothing about the sender or content

### NIP-17 Encryption Details

| Layer | Algorithm | Purpose |
|---|---|---|
| Kind 14 → Kind 13 | NIP-44 v2 (ChaCha20-Poly1305) | Content encryption; sender key hidden |
| Kind 13 → Kind 1059 | NIP-44 v2 (ChaCha20-Poly1305) | Outer wrapping; metadata protection |
| Key derivation | HKDF-SHA256 | Shared secret from Diffie-Hellman |

### NIP-17 for Group Messages

For group chats, Satnam sends one gift-wrap per member:

```
sendGroupMessage("Hello") →
  kind:1059 addressed to Alice
  kind:1059 addressed to Bob
  kind:1059 addressed to Carol
  (each independently encrypted)
```

**Overhead:** O(n) events per message, where n = group member count.

### NIP-17 Limitations

| Limitation | Impact |
|---|---|
| No forward secrecy | If your nsec is compromised, all past messages are decryptable |
| O(n) group messages | Performance degrades for large groups (100+ members) |
| No sender unlinkability across conversations | Correlation attacks possible with relay-level traffic analysis |
| No post-compromise security | Once compromised, no automatic recovery |

---

## NIP-40: Ephemeral Message Expiration

NIP-40 adds an `expiration` tag to Nostr events, instructing relays to delete the event after the timestamp:

```json
{
  "kind": 13,
  "tags": [
    ["expiration", "1700086400"]
  ],
  "content": "<encrypted>",
  "created_at": 1700000000
}
```

In Satnam, the expiration tag is applied to the **inner seal** (kind:13) before gift-wrapping. The outer gift-wrap does not expose the expiration, so relay operators cannot see the TTL.

**Relay compliance:** Relays implementing NIP-40 (including Pylon) automatically refuse to serve expired events and garbage-collect them from storage.

---

## Marmot/MLS: Message Layer Security (Future Phase)

### Overview

**Marmot** is the Nostr implementation of the IETF **Message Layer Security (MLS)** protocol, defined in a series of Marmot Improvement Proposals (MIPs). MLS provides:

- **Full forward secrecy:** Past messages cannot be decrypted if current keys are compromised
- **Post-compromise security:** After a compromise, the group can self-heal through key rotation
- **Efficient group key management:** O(log n) key operations per message vs O(n) for NIP-17
- **Sender unlinkability:** MLS group messages cannot be linked to individual senders by relay operators

**Reference client:** White Noise (WN) — the primary MLS-over-Nostr client.

### MLS Architecture

MLS uses a **ratchet tree** (binary left-balanced tree) to manage group encryption keys:

```
              Root Key
            /          \
       Left-2          Right-2
      /      \          /    \
  Alice     Bob      Carol   Dave
```

Each group message advances the epoch, rotating all keys. Only the direct path from the sender's leaf to the root needs to be updated — O(log n) operations.

### Marmot Improvement Proposals (MIPs)

#### MIP-00: KeyPackage (kind:443)

A KeyPackage is a pre-published Nostr event containing an MLS KeyPackage bundle. Other clients use it to add you to MLS groups.

```json
{
  "kind": 443,
  "content": "<base64 MLS KeyPackage TLS bytes>",
  "tags": [
    ["cipher_suite", "1"],
    ["init_key", "<hex>"]
  ]
}
```

**Satnam action:** Always publish `kind:443` KeyPackages so MLS clients can invite Satnam users (forward compat).

#### MIP-01: Group Data Extension

MLS group configuration metadata. Stored as a kind:30078 event with MLS-specific extensions for the group's ratchet tree state.

#### MIP-02: Welcome Event

When a new member is added to an MLS group, they receive a NIP-59 gift-wrapped Welcome event containing their leaf secret and the current group state. This is the MLS equivalent of the NIP-17 group welcome message.

#### MIP-03: Group Message

Each group message is an MLS `MLSCiphertext` published as a Nostr event. The ciphertext includes:
- Epoch number
- Sender's leaf index (encrypted in ciphertext, hidden from relay)
- ChaCha20-Poly1305 encrypted content

```json
{
  "kind": "<MLS group message kind>",
  "content": "<base64 MLSCiphertext>",
  "tags": [["g", "<group_id>"]]
}
```

#### MIP-04: Media Attachments

Encrypted media attachments for MLS group messages. The media is uploaded to a server with client-side encryption; the decryption key is distributed via MLS group message.

#### MIP-05: Push Notifications

MLS-compatible push notification configuration, analogous to kind:22456 but for MLS group subscriptions.

---

## Compatibility Matrix

Which protocols can communicate with which clients:

| Client | NIP-17 DM | NIP-17 Group | MLS Group |
|---|---|---|---|
| **Satnam v2 (Phase 1)** | ✓ Send + Receive | ✓ Send + Receive | Receive only (kind:443 published) |
| **Satnam v2 (Phase 2)** | ✓ Send + Receive | ✓ Send + Receive | ✓ Send + Receive |
| **White Noise (WN)** | ✓ Receive | — | ✓ Send + Receive |
| **0xchat** | ✓ Send + Receive | Limited | — |
| **Damus** | ✓ NIP-04 (legacy) | — | — |
| **Amethyst** | ✓ NIP-17 | — | — |

---

## Protocol Comparison: NIP-17 vs MLS

| Feature | NIP-17 (current) | MLS (Marmot, future) |
|---|---|---|
| **Forward secrecy** | No (NSec compromise = all history exposed) | Yes (per-epoch key rotation) |
| **Post-compromise security** | No | Yes (ratchet tree heals after compromise) |
| **Sender unlinkability** | Partial (random wrapping keys) | Full (sender leaf index encrypted) |
| **Group size scalability** | O(n) per message | O(log n) per message |
| **1:1 DMs** | Excellent | Equivalent to NIP-17 via MLS group of 2 |
| **Spec maturity** | Stable (NIP-17 merged) | Alpha (White Noise is reference impl) |
| **Relay support** | Ubiquitous | Pylon only (currently) |
| **Max recommended group** | ~50 members | 10,000+ members |
| **Client compatibility** | All NIP-17 clients | White Noise + future MLS clients |
| **Implementation complexity** | Low | High (MLS state machine, ratchet tree) |

---

## Forward Compatibility: kind:443 KeyPackage Publishing

To allow MLS-capable clients (White Noise) to invite Satnam users into MLS groups **today**, Satnam Phase 1 publishes a `kind:443` KeyPackage even though it cannot fully participate in MLS conversations yet.

**Effect:**
- White Noise users can see that a Satnam user has published a KeyPackage
- White Noise can invite the Satnam user to an MLS group
- Satnam receives the Welcome event (kind:1059-wrapped MIP-02) but displays it as "MLS group invite — upgrade required"
- When Phase 2 ships, Satnam will process the pending Welcome and join the group retroactively

**Satnam action on startup:** `protocolBridge.publishKeyPackage()` — checks if a valid KeyPackage exists and publishes a fresh one if not (or if the existing one has expired).

---

## Backward Compatibility: Always Accept NIP-17

Satnam's protocol bridge maintains backward compatibility with NIP-17 indefinitely:

1. **Incoming messages:** `unwrapMessage()` detects the event kind. kind:1059 = NIP-17, handled immediately. MLS MLSCiphertext = requires Phase 2 MLS state machine.
2. **Protocol negotiation:** If a peer sends a NIP-17 message, Satnam always replies in NIP-17, even if the peer also supports MLS. The rule: **respond in the same protocol the message arrived in**.
3. **Mixed groups:** A group where some members support MLS and some only support NIP-17 uses NIP-17 for all members until all members have published valid kind:443 KeyPackages.

---

## Migration Path: NIP-17 → MLS Upgrade

When Phase 2 is implemented, the upgrade path for an existing NIP-17 group to MLS:

1. **Detection:** `detectPeerProtocol()` checks kind:443 for all group members
2. **Readiness check:** All members must have valid non-expired KeyPackages
3. **Admin initiates:** Admin's client creates an MLS group, uses all members' KeyPackages to generate their leaf secrets
4. **Welcome events:** Admin publishes a NIP-59 gift-wrapped Welcome (MIP-02) to each member
5. **Transition message:** Admin sends a final NIP-17 message: "This group has upgraded to MLS encryption"
6. **Future messages:** All new messages sent via MLS (MIP-03). NIP-17 subscription remains active for backward compat window (7 days)

---

## Related Pages

- [Messaging Overview](../user-guides/messaging/README.md)
- [Group Messaging](../user-guides/messaging/group-messaging.md)
- [Developer Reference: ProtocolBridge](../developer-reference/libraries/messaging.md#protocolbridge)
- [Developer Reference: MLS Types](../developer-reference/libraries/messaging.md#mls-types)
