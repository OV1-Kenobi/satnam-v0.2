/**
 * Note to Self — Types
 * Spec: circle-of-trust-spec.md § Note to Self
 *
 * Notes are NIP-17 gift-wrapped (kind:1059) to self (sender = recipient = own pubkey).
 * The inner kind:14 carries the note content.
 */

export type NoteCategory = 'journal' | 'todo' | 'reference' | 'idea' | 'general';

export interface SelfNote {
  /** Local UUID (generated client-side on first decode) */
  id: string;
  /** Plaintext note content (after unwrapping) */
  content: string;
  /** Category tag */
  category: NoteCategory;
  /** User-defined tags */
  tags: string[];
  /** Unix timestamp (seconds) */
  createdAt: number;
  /** The NIP-1059 wrapper event ID from the relay */
  eventId?: string;
}

/** Category display config */
export const CATEGORY_CONFIG: Record<
  NoteCategory,
  { label: string; color: string; emoji: string }
> = {
  journal:   { label: 'Journal',   color: '#f7931a', emoji: '📓' },
  todo:      { label: 'To-Do',     color: '#22c55e', emoji: '✅' },
  reference: { label: 'Reference', color: '#3b82f6', emoji: '📚' },
  idea:      { label: 'Idea',      color: '#ffd700', emoji: '💡' },
  general:   { label: 'General',   color: '#a0a0a0', emoji: '📝' },
};

export const NOTE_CATEGORIES: NoteCategory[] = [
  'general',
  'journal',
  'todo',
  'reference',
  'idea',
];
