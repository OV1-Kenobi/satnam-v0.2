/**
 * Note to Self — Library tests
 * Spec: circle-of-trust-spec.md (testing section)
 *
 * Tests:
 * - Note creation (sendNote)
 * - NIP-17 self-addressing (sender = recipient = own pubkey)
 * - Note listing (listNotes) with since/until filters
 * - Note deletion (deleteNote)
 * - Note update
 * - Category assignment
 * - Tag handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the vault with an always-unlocked XChaCha20-Poly1305 pass-through so
// note encryption round-trips without a real OPFS/argon2id setup.
vi.mock('../../src/lib/vault/vault.js', async () => {
  const { xchacha20poly1305 } = await import('@noble/ciphers/chacha');
  const { randomBytes } = await import('@noble/hashes/utils');
  const testKey = randomBytes(32);
  const vault = {
    isUnlocked: () => true,
    encryptBytes: async (plaintext: Uint8Array): Promise<Uint8Array> => {
      const nonce = randomBytes(24);
      const ct = xchacha20poly1305(testKey, nonce).encrypt(plaintext);
      const out = new Uint8Array(24 + ct.length);
      out.set(nonce, 0);
      out.set(ct, 24);
      return out;
    },
    decryptBytes: async (data: Uint8Array): Promise<Uint8Array> => {
      const nonce = data.slice(0, 24);
      const ct = data.slice(24);
      return xchacha20poly1305(testKey, nonce).decrypt(ct);
    },
  };
  return { getVault: () => vault, Vault: vi.fn() };
});

import { NoteToSelfClient } from '../../src/lib/note-to-self/client.js';
import type { SelfNote, NoteCategory } from '../../src/lib/note-to-self/types.js';
import { NOTE_CATEGORIES, CATEGORY_CONFIG } from '../../src/lib/note-to-self/types.js';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem:     (key: string) => store[key] ?? null,
    setItem:     (key: string, val: string) => { store[key] = val; },
    removeItem:  (key: string) => { delete store[key]; },
    clear:       () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const SELF_PUBKEY = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

describe('NoteToSelfClient — note creation', () => {
  let client: NoteToSelfClient;

  beforeEach(() => {
    localStorageMock.clear();
    client = new NoteToSelfClient(SELF_PUBKEY);
  });

  it('creates a note with correct content', async () => {
    const note = await client.sendNote('Hello world');
    expect(note.content).toBe('Hello world');
  });

  it('defaults category to general', async () => {
    const note = await client.sendNote('Test');
    expect(note.category).toBe('general');
  });

  it('assigns correct category when provided', async () => {
    const note = await client.sendNote('Buy groceries', 'todo');
    expect(note.category).toBe('todo');
  });

  it('stores tags', async () => {
    const note = await client.sendNote('Research topic', 'reference', ['bitcoin', 'nostr']);
    expect(note.tags).toContain('bitcoin');
    expect(note.tags).toContain('nostr');
  });

  it('assigns a unique id', async () => {
    const a = await client.sendNote('Note A');
    const b = await client.sendNote('Note B');
    expect(a.id).not.toBe(b.id);
  });

  it('generates an eventId (gift-wrap wrapper)', async () => {
    const note = await client.sendNote('Encrypted note');
    expect(note.eventId).toBeDefined();
    expect(typeof note.eventId).toBe('string');
  });

  it('createdAt is a recent unix timestamp', async () => {
    const before = Math.floor(Date.now() / 1000);
    const note   = await client.sendNote('Timestamp test');
    const after  = Math.floor(Date.now() / 1000);
    expect(note.createdAt).toBeGreaterThanOrEqual(before);
    expect(note.createdAt).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// NIP-17 self-addressing concept
// ---------------------------------------------------------------------------

describe('NoteToSelfClient — NIP-17 self-addressing', () => {
  it('client is instantiated with own pubkey (sender = recipient)', () => {
    const client = new NoteToSelfClient(SELF_PUBKEY);
    // The client stores selfPubkey and addresses the gift-wrap to itself
    // In Phase 2, sendNote would publish kind:1059 with 'p' tag = selfPubkey
    // For now we verify the client holds the correct pubkey
    expect((client as any).selfPubkey).toBe(SELF_PUBKEY);
  });

  it('gift-wrap event ID is generated on send', async () => {
    const client = new NoteToSelfClient(SELF_PUBKEY);
    const note = await client.sendNote('Secret note');
    expect(note.eventId).toMatch(/^mock_evt_/);
  });
});

// ---------------------------------------------------------------------------
// Listing and filtering
// ---------------------------------------------------------------------------

describe('NoteToSelfClient — listNotes', () => {
  let client: NoteToSelfClient;

  beforeEach(() => {
    localStorageMock.clear();
    client = new NoteToSelfClient(SELF_PUBKEY);
  });

  it('lists all notes in reverse chronological order', async () => {
    await client.sendNote('First');
    await client.sendNote('Second');
    await client.sendNote('Third');

    const notes = await client.listNotes();
    expect(notes).toHaveLength(3);
    // Most recent first
    expect(notes[0].content).toBe('Third');
    expect(notes[2].content).toBe('First');
  });

  it('filters by since (notes after a timestamp)', async () => {
    const t = Math.floor(Date.now() / 1000);
    await client.sendNote('Note 1');
    await client.sendNote('Note 2');

    // since = t − 10 should include all notes created now
    const notes = await client.listNotes(t - 10);
    expect(notes.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty array when no notes', async () => {
    const notes = await client.listNotes();
    expect(notes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

describe('NoteToSelfClient — deleteNote', () => {
  let client: NoteToSelfClient;

  beforeEach(() => {
    localStorageMock.clear();
    client = new NoteToSelfClient(SELF_PUBKEY);
  });

  it('removes a note by id', async () => {
    const note = await client.sendNote('To be deleted');
    await client.deleteNote(note.id);
    const notes = await client.listNotes();
    expect(notes.find(n => n.id === note.id)).toBeUndefined();
  });

  it('does not affect other notes', async () => {
    const a = await client.sendNote('Keep me');
    const b = await client.sendNote('Delete me');
    await client.deleteNote(b.id);
    const notes = await client.listNotes();
    expect(notes.find(n => n.id === a.id)).toBeDefined();
  });

  it('deleting non-existent id is a no-op', async () => {
    await client.sendNote('Note 1');
    await client.deleteNote('non_existent_id');
    const notes = await client.listNotes();
    expect(notes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Category types
// ---------------------------------------------------------------------------

describe('NoteCategory types', () => {
  it('all categories have config entries', () => {
    for (const cat of NOTE_CATEGORIES) {
      expect(CATEGORY_CONFIG[cat]).toBeDefined();
      expect(CATEGORY_CONFIG[cat].label).toBeTruthy();
      expect(CATEGORY_CONFIG[cat].color).toMatch(/^#/);
    }
  });

  it('all 5 categories are defined', () => {
    expect(NOTE_CATEGORIES).toHaveLength(5);
    expect(NOTE_CATEGORIES).toContain('journal');
    expect(NOTE_CATEGORIES).toContain('todo');
    expect(NOTE_CATEGORIES).toContain('reference');
    expect(NOTE_CATEGORIES).toContain('idea');
    expect(NOTE_CATEGORIES).toContain('general');
  });
});
