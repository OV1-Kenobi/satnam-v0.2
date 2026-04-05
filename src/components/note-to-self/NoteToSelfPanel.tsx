/**
 * NoteToSelfPanel — Encrypted self-notes UI
 * Spec: circle-of-trust-spec.md § NoteToSelfPanel
 *
 * - Compose area at top (text input + category selector + send button)
 * - Notes list below (reverse chronological)
 * - Category filter chips
 * - Search bar
 * - Each note: content, category badge, timestamp, delete action
 */

import React, { useState, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import {
  Send,
  Search,
  Trash2,
  PenLine,
  Tag,
  Lock,
  X,
} from 'lucide-react';
import { useNoteToSelf } from '../../hooks/useNoteToSelf.js';
import {
  NOTE_CATEGORIES,
  CATEGORY_CONFIG,
  type NoteCategory,
  type SelfNote,
} from '../../lib/note-to-self/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NoteToSelfPanelProps {
  selfPubkey?: string;
  compact?: boolean;
}

// ---------------------------------------------------------------------------
// Note card
// ---------------------------------------------------------------------------

function NoteCard({
  note,
  onDelete,
}: {
  note: SelfNote;
  onDelete: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cfg = CATEGORY_CONFIG[note.category];

  const date = new Date(note.createdAt * 1000);
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <article
      className="p-4 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] space-y-3 group"
      aria-label={`Note: ${note.content.slice(0, 50)}`}
    >
      {/* Header: category + time + delete */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Category badge */}
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={{ backgroundColor: `${cfg.color}20`, color: cfg.color, border: `1px solid ${cfg.color}35` }}
          >
            <span aria-hidden="true">{cfg.emoji}</span>
            {cfg.label}
          </span>

          {/* User tags */}
          {note.tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-[#2a2a2a] text-[#555555] border border-[#3a3a3a]"
            >
              <Tag size={9} aria-hidden="true" />
              {tag}
            </span>
          ))}
        </div>

        {/* Delete */}
        {confirmDelete ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onDelete(note.id)}
              className="text-xs px-2 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              aria-label="Confirm delete"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="text-xs px-2 py-1 rounded-lg bg-[#2a2a2a] text-[#555555] hover:bg-[#3a3a3a] transition-colors"
              aria-label="Cancel delete"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-[#555555] hover:text-red-400 hover:bg-red-400/10 transition-all duration-150"
            aria-label="Delete note"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Content */}
      <p className="text-sm text-[#f5f5f5] leading-relaxed whitespace-pre-wrap break-words">
        {note.content}
      </p>

      {/* Footer: timestamp + encrypted indicator */}
      <div className="flex items-center justify-between text-[11px] text-[#555555]">
        <span>{dateStr} at {timeStr}</span>
        <div className="flex items-center gap-1.5">
          <Lock size={10} aria-hidden="true" />
          <span>E2E encrypted to self</span>
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function Composer({
  onSend,
  isSending,
}: {
  onSend: (content: string, category: NoteCategory, tags: string[]) => Promise<void>;
  isSending: boolean;
}) {
  const [content, setContent]     = useState('');
  const [category, setCategory]   = useState<NoteCategory>('general');
  const [tagInput, setTagInput]   = useState('');
  const [tags, setTags]           = useState<string[]>([]);

  const handleSend = async () => {
    if (!content.trim()) return;
    await onSend(content.trim(), category, tags);
    setContent('');
    setTagInput('');
    setTags([]);
    setCategory('general');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSend();
    }
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
    if (t && !tags.includes(t)) {
      setTags(prev => [...prev, t]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setTags(prev => prev.filter(t => t !== tag));
  };

  return (
    <div className="p-4 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] space-y-3">
      {/* Text input */}
      <div className="relative">
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a note to yourself… (Ctrl+Enter to send)"
          aria-label="Note content"
          rows={3}
          className="w-full resize-none rounded-lg bg-[#111111] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-sm p-3 focus:outline-none focus:border-[#ffd700] transition-colors"
        />
      </div>

      {/* Category selector */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5" role="group" aria-label="Note category">
        {NOTE_CATEGORIES.map(cat => {
          const cfg = CATEGORY_CONFIG[cat];
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              aria-pressed={category === cat}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-150 border',
                category === cat
                  ? `text-[${cfg.color}] border-[${cfg.color}]/40`
                  : 'text-[#555555] border-[#2a2a2a] hover:text-[#a0a0a0]',
              )}
              style={category === cat
                ? { backgroundColor: `${cfg.color}20`, borderColor: `${cfg.color}40`, color: cfg.color }
                : {}}
            >
              <span aria-hidden="true">{cfg.emoji}</span>
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Tag input */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Tag size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555555]" aria-hidden="true" />
          <input
            type="text"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="Add tag… (Enter)"
            aria-label="Add tag"
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#111111] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-xs focus:outline-none focus:border-[#ffd700] transition-colors"
          />
        </div>
        <button
          type="button"
          onClick={handleSend}
          disabled={!content.trim() || isSending}
          aria-label="Send note"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ffd700] hover:bg-[#e8c000] text-black font-medium text-sm transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={15} aria-hidden="true" />
          Send
        </button>
      </div>

      {/* Active tags */}
      {tags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[#ffd700]/15 text-[#ffd700] border border-[#ffd700]/30"
            >
              #{tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`Remove tag ${tag}`}
                className="ml-0.5 text-[#ffd700]/60 hover:text-[#ffd700]"
              >
                <X size={10} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function NoteToSelfPanel({
  selfPubkey,
  compact = false,
}: NoteToSelfPanelProps) {
  const { notes, sendNote, deleteNote, search, isLoading } = useNoteToSelf(selfPubkey);
  const [isSending, setIsSending]           = useState(false);
  const [searchQuery, setSearchQuery]       = useState('');
  const [categoryFilter, setCategoryFilter] = useState<NoteCategory | 'all'>('all');

  const handleSend = async (content: string, category: NoteCategory, tags: string[]) => {
    setIsSending(true);
    try {
      await sendNote(content, category, tags);
    } finally {
      setIsSending(false);
    }
  };

  // Apply search + category filter
  const filtered: SelfNote[] = useMemo(() => {
    let result = searchQuery ? search(searchQuery) : notes;
    if (categoryFilter !== 'all') {
      result = result.filter(n => n.category === categoryFilter);
    }
    return result;
  }, [notes, searchQuery, categoryFilter, search]);

  return (
    <section className="space-y-4" aria-label="Note to Self">
      {/* Header */}
      {!compact && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="heading-display text-lg text-[#ffd700]">Note to Self</h2>
            <p className="text-xs text-[#555555] mt-0.5">NIP-17 gift-wrapped · sender = recipient = you</p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md" style={{ backgroundColor: '#ffd70010', border: '1px solid #ffd70020' }}>
            <Lock size={10} className="text-[#ffd700]" aria-hidden="true" />
            <span className="text-[#ffd700]">E2E encrypted</span>
          </div>
        </div>
      )}

      {/* Composer */}
      <Composer onSend={handleSend} isSending={isSending} />

      {/* Search bar */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555555]" aria-hidden="true" />
        <input
          type="search"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search notes…"
          aria-label="Search notes"
          className="w-full pl-9 pr-4 py-2.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-sm focus:outline-none focus:border-[#ffd700] transition-colors"
        />
      </div>

      {/* Category filter chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1" role="group" aria-label="Category filter">
        <button
          type="button"
          onClick={() => setCategoryFilter('all')}
          aria-pressed={categoryFilter === 'all'}
          className={clsx(
            'px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-150 border',
            categoryFilter === 'all'
              ? 'bg-[#ffd700]/20 border-[#ffd700]/50 text-[#ffd700]'
              : 'bg-slate-800 border-[#2a2a2a] text-[#555555] hover:text-[#a0a0a0]',
          )}
        >
          All
        </button>
        {NOTE_CATEGORIES.map(cat => {
          const cfg = CATEGORY_CONFIG[cat];
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              aria-pressed={categoryFilter === cat}
              className={clsx(
                'flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-150 border',
              )}
              style={
                categoryFilter === cat
                  ? { backgroundColor: `${cfg.color}20`, borderColor: `${cfg.color}40`, color: cfg.color }
                  : { backgroundColor: '#1e293b', borderColor: '#2a2a2a', color: '#555555' }
              }
            >
              <span aria-hidden="true">{cfg.emoji}</span>
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Notes list */}
      {isLoading ? (
        <div className="space-y-3" aria-hidden="true">
          {[1, 2, 3].map(i => <div key={i} className="h-24 skeleton rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 space-y-2">
          <PenLine size={28} className="mx-auto text-[#555555]" aria-hidden="true" />
          <p className="text-sm text-[#555555]">
            {notes.length === 0
              ? 'No notes yet — write your first note above'
              : 'No notes match your filter'}
          </p>
        </div>
      ) : (
        <div className="space-y-3" role="list" aria-label={`${filtered.length} notes`}>
          {filtered.map(note => (
            <NoteCard key={note.id} note={note} onDelete={deleteNote} />
          ))}
        </div>
      )}
    </section>
  );
}
