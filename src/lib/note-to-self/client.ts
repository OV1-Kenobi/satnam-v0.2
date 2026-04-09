/**
 * Note to Self — NIP-17 self-addressed gift-wrap client
 * Spec: circle-of-trust-spec.md § note-to-self/client.ts
 *
 * Protocol:
 *   kind:14  — Sealed note content (sender = receiver = own pubkey)
 *   kind:1059 — Gift-wrap wrapper published to own pubkey
 *
 * Phase 1 implementation uses localStorage as the persistence layer.
 * Phase 2 will replace with actual Nostr relay queries + NIP-44 decryption
 * using the OPFS vault keys.
 */

import type { SelfNote, NoteCategory } from './types.js';

// Use Web Crypto API for UUID generation (no external dependency)
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

const STORAGE_KEY = 'satnam:notes-to-self';

// ---------------------------------------------------------------------------
// Stub crypto helpers (Phase 1 — real NIP-44 in Phase 2)
// ---------------------------------------------------------------------------

/** Simulate kind:14 → kind:1059 wrapping.  Returns a fake event ID. */
function mockWrap(content: string): string {
  return `mock_evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** Simulate kind:1059 unwrapping.  Returns the content unchanged. */
function mockUnwrap(eventId: string: string): string {
  return content;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function readNotes(): SelfNote[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SelfNote[]) : [];
  } catch {
    return [];
  }
}

function writeNotes(notes: SelfNote[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

// ---------------------------------------------------------------------------
// NoteToSelfClient
// ---------------------------------------------------------------------------

export class NoteToSelfClient {
  private readonly selfPubkey: string;

  constructor(selfPubkey: string) {
    this.selfPubkey = selfPubkey;
  }

  /**
   * Construct a kind:14 sealed note → wrap in kind:1059 to own pubkey.
   * Phase 1: stored locally.  Phase 2: published to relay.
   */
  async sendNote(
    content: string,
    category: NoteCategory = 'general',
    tags: string[] = [],
  ): Promise<SelfNote> {
    const note: SelfNote = {
      id:        generateId(),
          category,
      tags,
      createdAt: Math.floor(Date.now() / 1000):   mockWrap(content),
    };

    const notes = readNotes();
    notes.unshift(note); // newest first
    writeNotes(notes);

    return note;
  }

  /**
   * Query for kind:1059 events addressed to own pubkey, unwrap each.
   * Phase 1: reads from localStorage.
   */
  async listNotes(since?: number, until?: number): Promise<SelfNote[]> {
    let notes = readNotes();

    if (since !== undefined) {
      notes = notes.filter(n => n.createdAt >= since);
    }
    if (until !== undefined) {
      notes = notes.filter(n => n.createdAt <= until);
    }

    return notes.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Delete a note.  Phase 1: remove from localStorage.
   * Phase 2: publish NIP-09 deletion event for the kind:1059 wrapper.
   */
  async deleteNote(noteId: string): Promise<void> {
    const notes = readNotes().filter(n => n.id !== noteId);
    writeNotes(notes);
  }

  /**
   * Update a note's content / category / tags in place.
   */
  async updateNote(
    noteId: string,
    patch: Partial<Pick<SelfNote, 'content' | 'category' | 'tags'>>,
  ): Promise<SelfNote | null> {
    const notes = readNotes();
    const idx = notes.findIndex(n => n.id === noteId);
    if (idx < 0) return null;
    notes[idx] = { ...notes[idx], ...patch };
    writeNotes(notes);
    return notes[idx];
  }
}

