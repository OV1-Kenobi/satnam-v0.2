# useNoteToSelf

**File:** `src/hooks/useNoteToSelf.tsx`
**Provider:** `NoteToSelfProvider` (requires `VaultProvider`, relay connection)

---

## Purpose

`useNoteToSelf` provides a React interface for writing, listing, and deleting encrypted self-notes. Notes are NIP-17 gift-wrapped to the user's own pubkey — only they can read them. The hook manages relay queries, decryption, and local state.

---

## Return Value Shape

```typescript
interface UseNoteToSelfReturn {
  // Note list
  notes: SelfNote[];
  isLoading: boolean;
  error: string | null;

  // Mutations
  sendNote: (content: string, opts?: SendNoteOptions) => Promise<string>;
  deleteNote: (eventId: string) => Promise<void>;

  // Queries
  listNotes: (filter?: NoteFilter) => SelfNote[];

  // Refresh (re-fetch and decrypt from relay)
  refresh: () => Promise<void>;
}

interface SendNoteOptions {
  category?: NoteCategory;
  tags?: string[];
}
```

---

## Methods

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `sendNote` | `content: string`, `opts?: SendNoteOptions` | `Promise<string>` | Encrypt and publish a new self-note. Returns the gift-wrap event ID. |
| `deleteNote` | `eventId: string` | `Promise<void>` | Publish a kind:5 deletion event for the note. |
| `listNotes` | `filter?: NoteFilter` | `SelfNote[]` | Return notes matching the filter (client-side, from cached decrypted notes). |
| `refresh` | — | `Promise<void>` | Re-fetch kind:1059 events from relays and decrypt. |

---

## Example Usage

### Note Composer Component

```tsx
import { useNoteToSelf } from '@hooks/useNoteToSelf';
import { useState } from 'react';

function NoteComposer() {
  const { sendNote } = useNoteToSelf();
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<NoteCategory>('general');
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const tags = tagInput.split(',').map(t => t.trim()).filter(Boolean);
      await sendNote(content, { category, tags });
      setContent('');
      setTagInput('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="composer">
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Write a note... (markdown supported)"
        className="w-full bg-zinc-900 border border-zinc-800 rounded p-3 text-white"
        rows={6}
      />
      <div className="flex gap-2 mt-2">
        <select
          value={category}
          onChange={e => setCategory(e.target.value as NoteCategory)}
          className="bg-zinc-800 text-white rounded px-2 py-1"
        >
          <option value="general">General</option>
          <option value="journal">Journal</option>
          <option value="todo">Todo</option>
          <option value="reference">Reference</option>
          <option value="contact">Contact</option>
          <option value="financial">Financial</option>
        </select>
        <input
          value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          placeholder="tags, comma-separated"
          className="flex-1 bg-zinc-800 text-white rounded px-2 py-1"
        />
        <button
          onClick={handleSave}
          disabled={saving || !content.trim()}
          className="bg-bitcoin-orange text-black px-4 py-1 rounded font-semibold disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

### Notes List with Filtering

```tsx
import { useNoteToSelf } from '@hooks/useNoteToSelf';
import { useState } from 'react';

function NotesList() {
  const { notes, listNotes, deleteNote, isLoading, refresh } = useNoteToSelf();
  const [selectedCategory, setSelectedCategory] = useState<NoteCategory | undefined>();
  const [search, setSearch] = useState('');

  const filtered = listNotes({
    category: selectedCategory,
    search: search || undefined,
  });

  return (
    <div>
      <div className="filters flex gap-2 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search notes..."
          className="flex-1 bg-zinc-800 text-white rounded px-3 py-1"
        />
        <button onClick={refresh} className="text-zinc-400 hover:text-white">
          Refresh
        </button>
      </div>

      {isLoading && <Spinner />}

      <div className="notes-list space-y-3">
        {filtered.map(note => (
          <div key={note.id} className="note-card rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs text-zinc-400 uppercase">{note.category}</span>
              <button
                onClick={() => deleteNote(note.id)}
                className="text-zinc-600 hover:text-red-400 text-xs"
              >
                Delete
              </button>
            </div>
            <p className="text-white whitespace-pre-wrap">{note.content}</p>
            {note.tags.length > 0 && (
              <div className="flex gap-1 mt-2 flex-wrap">
                {note.tags.map(tag => (
                  <span key={tag} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-zinc-600 mt-2">
              {new Date(note.createdAt * 1000).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Privacy Behavior

The hook fetches all `kind:1059` events addressed to the user's pubkey (which includes incoming DMs as well). It decrypts each event and filters for self-notes by checking whether the inner event's pubkey matches the user's own pubkey. Non-self-notes are ignored and not stored in `notes`.

---

## Related

- [NoteToSelf library](../libraries/note-to-self.md) — NoteToSelfClient and types
- [Note to Self user guide](../../user-guides/note-to-self.md)
