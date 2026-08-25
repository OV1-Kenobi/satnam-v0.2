/**
 * Note to Self — NIP-17 self-addressed gift-wrap client
 * Spec: circle-of-trust-spec.md § note-to-self/client.ts
 *
 * Protocol:
 *   kind:14  — Sealed note content (sender = receiver = own pubkey)
 *   kind:1059 — Gift-wrap wrapper published to own pubkey
 *
 * Persistence: notes are encrypted under the OPFS vault master key
 * (XChaCha20-Poly1305) before being written to localStorage. Plaintext
 * note content never touches persistent storage.
 */

import { bytesToHex, hexToBytes, utf8ToBytes, bytesToUtf8, randomBytes } from '@noble/hashes/utils';
import { getVault } from '../vault/vault.js';
import type { SelfNote, NoteCategory } from './types.js';

/** CSPRNG ID generation (replaces Math.random). */
function generateId(): string {
  return bytesToHex(randomBytes(16));
}

const STORAGE_KEY = 'satnam:notes-to-self:v3';

// ---------------------------------------------------------------------------
// Stub crypto helpers (Phase 1 — real NIP-44 in Phase 2)
// ---------------------------------------------------------------------------

/** Simulate kind:14 → kind:1059 wrapping.  Returns a fake event ID. */
function mockWrap(_content: string): string {
  return `mock_evt_${bytesToHex(randomBytes(16))}`;
}

/** Simulate kind:1059 unwrapping.  Returns the content unchanged.
 *  Phase 2 will use this for real NIP-44 decryption. */
export function mockUnwrap(eventId: string, content: string): string {
  void eventId;
  return content;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function readNotes(): Promise<SelfNote[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const vault = getVault();
    if (!vault.isUnlocked()) return [];
    const decrypted = await vault.decryptBytes(hexToBytes(raw));
    return JSON.parse(bytesToUtf8(decrypted)) as SelfNote[];
  } catch {
    return [];
  }
}

async function writeNotes(notes: SelfNote[]): Promise<void> {
  const vault = getVault();
  if (!vault.isUnlocked()) {
    throw new Error('Vault must be unlocked to persist notes');
  }
  const encrypted = await vault.encryptBytes(utf8ToBytes(JSON.stringify(notes)));
  localStorage.setItem(STORAGE_KEY, bytesToHex(encrypted));
}

// ---------------------------------------------------------------------------
// NoteToSelfClient
// ---------------------------------------------------------------------------

export class NoteToSelfClient {
  readonly selfPubkey: string;

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
      content,
      category,
      tags,
      createdAt: Math.floor(Date.now() / 1000),
      eventId:   mockWrap(content),
    };

    const notes = await readNotes();
    notes.unshift(note); // newest first
    await writeNotes(notes);

    return note;
  }

  /**
   * Query for kind:1059 events addressed to own pubkey, unwrap each.
   * Phase 1: reads from localStorage.
   */
  async listNotes(since?: number, until?: number): Promise<SelfNote[]> {
    let notes = await readNotes();

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
    const notes = (await readNotes()).filter(n => n.id !== noteId);
    await writeNotes(notes);
  }

  /**
   * Update a note's content / category / tags in place.
   */
  async updateNote(
    noteId: string,
    patch: Partial<Pick<SelfNote, 'content' | 'category' | 'tags'>>,
  ): Promise<SelfNote | null> {
    const notes = await readNotes();
    const idx = notes.findIndex(n => n.id === noteId);
    if (idx < 0) return null;
    notes[idx] = { ...notes[idx]!, ...patch };
    await writeNotes(notes);
    return notes[idx] ?? null;
  }
}

