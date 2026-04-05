# Note to Self Library

**Module path:** `src/lib/note-to-self/`
**Import alias:** `@lib/note-to-self`
**Protocol:** NIP-17 gift-wrap (kind:1059), self-addressed

---

## Overview

The Note to Self library implements encrypted self-messages using the NIP-17 gift-wrap protocol. The sender and recipient are both the user's own public key — only their nsec can unwrap and decrypt the note. Notes are stored on Nostr relays as `kind:1059` events, giving them the same privacy properties as DMs.

---

## Types

### `SelfNote`

```typescript
interface SelfNote {
  id: string;             // Event ID of the kind:1059 gift-wrap
  content: string;        // Decrypted note content (markdown)
  category: NoteCategory;
  tags: string[];         // Free-form text labels
  createdAt: number;      // Unix timestamp (from inner kind:14 event)
  updatedAt?: number;     // Unix timestamp of last edit (if replaced)
}

type NoteCategory =
  | 'journal'
  | 'todo'
  | 'reference'
  | 'contact'
  | 'financial'
  | 'general';
```

### `NoteFilter`

```typescript
interface NoteFilter {
  category?: NoteCategory;
  tags?: string[];          // Notes must have ALL listed tags
  search?: string;          // Full-text search (client-side)
  since?: number;           // Unix timestamp lower bound
  until?: number;           // Unix timestamp upper bound
}
```

---

## NIP-17 Self-Addressing Pattern

Standard NIP-17 (gift-wrapped DMs) is designed for Alice → Bob. Note to Self uses the same mechanism with Alice → Alice:

```
kind:14 (sealed note)
  pubkey:    Alice's pubkey
  p tag:     Alice's pubkey   ← sender = recipient
  content:   NIP-44 encrypted(Alice's note content)

wrapped in kind:1059 (gift-wrap)
  pubkey:    ephemeral key     ← hides the sender identity
  p tag:     Alice's pubkey   ← addressed to Alice
  content:   NIP-44 encrypted(kind:14 event)
```

The relay sees only a `kind:1059` addressed to Alice's pubkey — the same shape as any incoming DM. Alice's app unwraps it using her nsec and recognizes it as a self-note (sender pubkey in the decrypted inner event matches her own pubkey).

---

## NoteToSelfClient Class

**File:** `src/lib/note-to-self/client.ts`

```typescript
class NoteToSelfClient {
  constructor(
    signer: NostrSigner,     // Access to the user's nsec (vault-backed)
    ceps: CepsClient,        // Central Event Publishing Service
    relays: string[]         // Relay URLs to publish to / query from
  );

  /**
   * Construct and publish a gift-wrapped self-note.
   * Returns the event ID of the published kind:1059 gift-wrap.
   *
   * @param content - Markdown note content
   * @param opts    - Category, tags, and optional metadata
   */
  send(
    content: string,
    opts?: {
      category?: NoteCategory;
      tags?: string[];
    }
  ): Promise<string>;

  /**
   * Fetch and decrypt all self-notes from the configured relays.
   * Filters kind:1059 events where sender = recipient = self pubkey.
   *
   * @param filter - Optional filter for category, tags, date range, search
   */
  list(filter?: NoteFilter): Promise<SelfNote[]>;

  /**
   * Decrypt a single note by its gift-wrap event ID.
   * Returns null if the event is not found or not decryptable.
   */
  get(eventId: string): Promise<SelfNote | null>;

  /**
   * Delete a note by publishing a kind:5 deletion event.
   * Note: deletion is relay-honored, not cryptographically enforced.
   * The original encrypted gift-wrap may persist on some relays.
   */
  delete(eventId: string): Promise<void>;
}
```

---

## Quick Start

```typescript
import { NoteToSelfClient } from '@lib/note-to-self';

const client = new NoteToSelfClient(signer, ceps, relays);

// Write a note
const eventId = await client.send('Meeting with Alice at Bitcoin conf', {
  category: 'contact',
  tags: ['alice', 'bitcoin-conf-2025'],
});
console.log('Note published:', eventId);

// List all notes
const notes = await client.list();
notes.forEach(note => {
  console.log(`[${note.category}] ${note.content.slice(0, 50)}`);
});

// Filter by category and tag
const todos = await client.list({
  category: 'todo',
  tags: ['urgent'],
});

// Delete a note
await client.delete(eventId);
```

---

## Inner Event Format (`kind:14`)

The inner sealed event follows the NIP-17 specification:

```json
{
  "kind": 14,
  "pubkey": "<user_pubkey>",
  "created_at": <unix_timestamp>,
  "tags": [
    ["p", "<user_pubkey>"],
    ["category", "journal"],
    ["t", "bitcoin"],
    ["t", "savings"]
  ],
  "content": "<note_content_plaintext>"
}
```

The `category` tag and `t` (topic/tag) tags are stored inside the encrypted inner event and are never exposed in plaintext.

---

## Relay Queries

To list self-notes, the client subscribes to:

```json
{
  "kinds": [1059],
  "#p": ["<user_pubkey>"]
}
```

This returns all gift-wraps addressed to the user's pubkey — including both incoming DMs and self-notes. The client distinguishes self-notes by decrypting the inner event and checking whether the inner `pubkey` matches the user's own pubkey.

---

## Related

- [useNoteToSelf hook](../hooks/use-note-to-self.md)
- [Note to Self user guide](../../user-guides/note-to-self.md)
- [NIP-17 in the Glossary](../../overview/glossary.md#n)
