# Note to Self

**Note to Self** is Satnam's encrypted personal notebook. Notes are sent to yourself using the same NIP-17 gift-wrap mechanism used for private DMs — meaning they are sealed, gift-wrapped, and addressed to your own npub. Only you can read them.

---

## What Is Note to Self?

Note to Self uses the **NIP-17 gift-wrap protocol** (kind:1059) with a special self-addressing pattern: the sender and recipient are both your own public key. The note is:

1. **Sealed** — wrapped in a NIP-44 encrypted inner event (`kind:14`) so the content is never in plaintext
2. **Gift-wrapped** — enclosed in a `kind:1059` outer event with a random ephemeral key, so even your relay operator cannot tell that you sent it to yourself
3. **Addressed to you** — only your private key can unwrap and decrypt the note

The result: a private, encrypted, relay-stored notebook that no one — not Satnam, not your relay — can read.

---

## How to Write a Note

1. Navigate to **Note to Self** from the main navigation (or press `N` on desktop).
2. Click **New Note** or tap the compose button.
3. Write your note in the compose area. Markdown formatting is supported.
4. Optionally add a **category** and **tags** (see below).
5. Press **Save** or `Ctrl+Enter`.

Satnam encrypts the note client-side, wraps it as a NIP-17 gift-wrap, and publishes it to your configured relays. The note appears in your notes list immediately.

---

## Categories and Tags

You can organize notes using categories and tags. Both are stored inside the encrypted note content — they are not published in plaintext.

**Categories** (choose one per note):

| Category | Use Case |
|---|---|
| `journal` | Personal reflections, daily notes |
| `todo` | Task lists, action items |
| `reference` | Reference material, credentials, instructions |
| `contact` | Notes about a person or meeting |
| `financial` | Bitcoin-related notes, wallet seeds, addresses |
| `general` | Uncategorized |

**Tags** are free-form text labels. Examples: `#bitcoin`, `#work`, `#private`, `#idea`. Filter your notes list by tag using the filter bar.

---

## Privacy Guarantees

| Property | Detail |
|---|---|
| **Content encryption** | NIP-44 v2 (ChaCha20-Poly1305 + HKDF) |
| **Metadata protection** | Gift-wrap with ephemeral key — relay cannot link sender to recipient |
| **Server visibility** | Satnam servers see only an encrypted `kind:1059` event addressed to your pubkey |
| **Relay visibility** | Relay sees only that some gift-wrap event exists addressed to your pubkey — same as a DM |
| **Read access** | Only your nsec (in your OPFS Vault) can decrypt |
| **Deletion** | Publish a `kind:5` deletion event; relay-honored (note: deletion is not cryptographically enforced) |

**No server-side storage:** Notes are stored on Nostr relays as encrypted events, not in Satnam's database. If you change relays, publish your notes to the new relay to migrate them.

---

## Use Cases

### Journal

Write daily reflections, thoughts, or observations. Because notes are timestamped and relay-stored, they form a persistent private journal that follows your npub.

### Todo Lists

Use the `todo` category for task lists. Format them as markdown checkboxes:

```markdown
- [x] Provision new NFC Name Tag
- [ ] Schedule PoL ceremony with Alice
- [ ] Review Sig4Sats settlement history
```

### Secure Reference Storage

Store sensitive reference material that you need across devices but do not want in your phone's notes app (which may sync to iCloud or Google):

- Recovery instructions for your OPFS Vault
- Relay configurations
- Multisig coordinator notes
- Contact npubs for people not yet in your Circle of Trust

### Contact Meeting Notes

Use the `contact` category to log notes after a Proof of Life ceremony — context about where you met, what you discussed, follow-up actions. These notes are local to you and never appear in the public Handshake Ledger.

---

## Finding Notes

- **Search:** Full-text search across all decrypted notes (client-side — search index is never sent to any server).
- **Filter by category:** Click a category in the left sidebar to show only notes in that category.
- **Filter by tag:** Click any tag in the tag cloud to filter by tag.
- **Date range:** Use the date picker to show notes from a specific period.

Notes appear in reverse chronological order by default.

---

## Related Pages

- [Circle of Trust](./circle-of-trust/README.md) — Your encrypted Web of Trust
- [NoteToSelf Library](../developer-reference/libraries/note-to-self.md) — Developer reference
- [useNoteToSelf hook](../developer-reference/hooks/use-note-to-self.md)
