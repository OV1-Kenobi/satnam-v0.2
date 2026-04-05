/**
 * useNoteToSelf — React hook for encrypted notes to self
 * Spec: circle-of-trust-spec.md § useNoteToSelf.tsx
 *
 * Provides:
 *   notes       — all notes (reverse chronological)
 *   sendNote    — create a new note
 *   deleteNote  — delete by id
 *   search      — filter notes by query string
 *   isLoading
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { NoteToSelfClient } from '../lib/note-to-self/client.js';
import type { SelfNote, NoteCategory } from '../lib/note-to-self/types.js';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNoteToSelf(selfPubkey?: string) {
  const [notes, setNotes]         = useState<SelfNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Stable client reference
  const clientRef = useRef<NoteToSelfClient | null>(null);

  useEffect(() => {
    if (!selfPubkey) return;
    clientRef.current = new NoteToSelfClient(selfPubkey);
    refresh();
  }, [selfPubkey]);

  // Load all notes
  const refresh = useCallback(async () => {
    if (!clientRef.current) return;
    setIsLoading(true);
    try {
      const loaded = await clientRef.current.listNotes();
      setNotes(loaded);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Send a new note
  const sendNote = useCallback(
    async (content: string, category?: NoteCategory, tags?: string[]) => {
      if (!clientRef.current) {
        // Fallback: create client on-the-fly if pubkey not yet available
        clientRef.current = new NoteToSelfClient(selfPubkey ?? 'anonymous');
      }
      const note = await clientRef.current.sendNote(content, category, tags);
      setNotes(prev => [note, ...prev]);
      return note;
    },
    [selfPubkey],
  );

  // Delete a note
  const deleteNote = useCallback(async (id: string) => {
    if (!clientRef.current) return;
    await clientRef.current.deleteNote(id);
    setNotes(prev => prev.filter(n => n.id !== id));
  }, []);

  // Client-side search helper
  const search = useCallback(
    (query: string): SelfNote[] => {
      if (!query.trim()) return notes;
      const q = query.toLowerCase();
      return notes.filter(
        n =>
          n.content.toLowerCase().includes(q) ||
          n.tags.some(t => t.toLowerCase().includes(q)) ||
          n.category.toLowerCase().includes(q),
      );
    },
    [notes],
  );

  return {
    notes,
    sendNote,
    deleteNote,
    search,
    isLoading,
    refresh,
  };
}

export default useNoteToSelf;
