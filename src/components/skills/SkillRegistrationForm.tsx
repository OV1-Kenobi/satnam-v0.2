/**
 * SkillRegistrationForm — Register a new skill
 * Phase 3: NIP-SKL skill management
 *
 * Fields:
 * - Scope ID, name, version, description
 * - Capability tags (multi-select)
 * - Category tags
 * - Expiry date (optional)
 * - Publish action
 */

import React, { useState } from 'react';
import clsx from 'clsx';
import { Plus, X, BookOpen, Tag } from 'lucide-react';
import { useSkillManager } from '../../hooks/useSkillManager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillRegistrationFormProps {
  onComplete?: (skillId: string) => void;
  onCancel?: () => void;
}

interface FormState {
  scopeId: string;
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  categoryTags: string[];
  expiresAt?: number;
}

const PRESET_CAPABILITIES = [
  'text-generation',
  'image-analysis',
  'web-search',
  'summarization',
  'translation',
  'code-analysis',
  'data-extraction',
  'sentiment-analysis',
  'classification',
  'question-answering',
  'nip90-provider',
  'nip90-consumer',
];

const PRESET_CATEGORIES = [
  'nlp',
  'vision',
  'research',
  'coding',
  'data',
  'media',
  'finance',
  'security',
];

// ---------------------------------------------------------------------------
// Tag input component
// ---------------------------------------------------------------------------

function TagInput({
  id,
  label,
  tags,
  onAdd,
  onRemove,
  presets,
  placeholder,
}: {
  id: string;
  label: string;
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  presets?: string[];
  placeholder?: string;
}) {
  const [input, setInput] = useState('');

  const handleAdd = (value: string) => {
    const tag = value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!tag || tags.includes(tag)) return;
    onAdd(tag);
    setInput('');
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-[#a0a0a0]">
        {label}
      </label>

      {/* Preset chips */}
      {presets && (
        <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-[#111111] border border-[#2a2a2a]" aria-label={`${label} presets`}>
          {presets.map(preset => {
            const selected = tags.includes(preset);
            return (
              <button
                key={preset}
                type="button"
                onClick={() => selected ? onRemove(preset) : handleAdd(preset)}
                aria-pressed={selected}
                className={clsx(
                  'px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
                  selected
                    ? 'bg-[#f7931a] text-black'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700',
                )}
              >
                {preset}
              </button>
            );
          })}
        </div>
      )}

      {/* Custom input */}
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); handleAdd(input); }
            if (e.key === ',') { e.preventDefault(); handleAdd(input); }
          }}
          placeholder={placeholder ?? 'Add tag and press Enter'}
          className="flex-1 px-3 py-1.5 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-sm focus:outline-none focus:border-[#f7931a] transition-colors"
          aria-label={`Add ${label} tag`}
        />
        <button
          type="button"
          onClick={() => handleAdd(input)}
          aria-label={`Add ${label} tag`}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Active tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="list" aria-label={`Selected ${label}`}>
          {tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#f7931a]/20 border border-[#f7931a]/30 text-[#f7931a] text-xs"
              role="listitem"
            >
              <Tag size={10} />
              {tag}
              <button
                type="button"
                onClick={() => onRemove(tag)}
                aria-label={`Remove ${tag}`}
                className="hover:text-red-400 transition-colors"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function SkillRegistrationForm({ onComplete, onCancel }: SkillRegistrationFormProps) {
  const { registerSkill, isLoading } = useSkillManager();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    scopeId: '',
    name: '',
    version: '1.0.0',
    description: '',
    capabilities: [],
    categoryTags: [],
  });

  const update = (partial: Partial<FormState>) => {
    setForm(prev => ({ ...prev, ...partial }));
  };

  const addCapability = (cap: string) => {
    if (!form.capabilities.includes(cap)) {
      update({ capabilities: [...form.capabilities, cap] });
    }
  };

  const removeCapability = (cap: string) => {
    update({ capabilities: form.capabilities.filter(c => c !== cap) });
  };

  const addCategory = (cat: string) => {
    if (!form.categoryTags.includes(cat)) {
      update({ categoryTags: [...form.categoryTags, cat] });
    }
  };

  const removeCategory = (cat: string) => {
    update({ categoryTags: form.categoryTags.filter(c => c !== cat) });
  };

  const isValid = form.scopeId.trim() && form.name.trim() && form.version.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setError(null);

    try {
      const skillId = await registerSkill({
        scopeId: form.scopeId.trim(),
        name: form.name.trim(),
        version: form.version.trim(),
        description: form.description.trim() || undefined,
        capabilities: form.capabilities,
        categoryTags: form.categoryTags,
        expiresAt: form.expiresAt,
      });
      onComplete?.(skillId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register skill');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="heading-display text-xl text-[#f7931a]">Register Skill</h2>
          <p className="text-sm text-[#555555] mt-0.5">Publish a new NIP-SKL skill to the network.</p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="p-2 rounded-lg text-[#555555] hover:text-[#a0a0a0] hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Scope ID */}
      <div>
        <label htmlFor="skill-scope-id" className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
          Scope ID <span className="text-[#f7931a]">*</span>
        </label>
        <input
          id="skill-scope-id"
          type="text"
          value={form.scopeId}
          onChange={e => update({ scopeId: e.target.value })}
          placeholder="com.example.research"
          required
          aria-required="true"
          className="w-full px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] font-mono text-sm focus:outline-none focus:border-[#f7931a] transition-colors"
        />
        <p className="mt-1 text-xs text-[#555555]">Reverse-domain namespaced identifier (e.g. com.example.skill-name)</p>
      </div>

      {/* Name */}
      <div>
        <label htmlFor="skill-name" className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
          Name <span className="text-[#f7931a]">*</span>
        </label>
        <input
          id="skill-name"
          type="text"
          value={form.name}
          onChange={e => update({ name: e.target.value })}
          placeholder="Web Research Skill"
          required
          aria-required="true"
          maxLength={64}
          className="w-full px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] focus:outline-none focus:border-[#f7931a] transition-colors"
        />
      </div>

      {/* Version */}
      <div>
        <label htmlFor="skill-version" className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
          Version <span className="text-[#f7931a]">*</span>
        </label>
        <input
          id="skill-version"
          type="text"
          value={form.version}
          onChange={e => update({ version: e.target.value })}
          placeholder="1.0.0"
          required
          aria-required="true"
          pattern="\d+\.\d+\.\d+"
          className="w-full px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] font-mono text-sm focus:outline-none focus:border-[#f7931a] transition-colors"
        />
        <p className="mt-1 text-xs text-[#555555]">Semver format: major.minor.patch</p>
      </div>

      {/* Description */}
      <div>
        <label htmlFor="skill-description" className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
          Description
        </label>
        <textarea
          id="skill-description"
          value={form.description}
          onChange={e => update({ description: e.target.value })}
          placeholder="Describe what this skill does…"
          rows={3}
          maxLength={512}
          className="w-full px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] focus:outline-none focus:border-[#f7931a] transition-colors resize-none"
        />
        <p className="mt-1 text-xs text-[#555555]">{form.description.length}/512</p>
      </div>

      {/* Capability tags */}
      <TagInput
        id="skill-capabilities"
        label="Capabilities"
        tags={form.capabilities}
        onAdd={addCapability}
        onRemove={removeCapability}
        presets={PRESET_CAPABILITIES}
        placeholder="Add capability tag"
      />

      {/* Category tags */}
      <TagInput
        id="skill-categories"
        label="Categories"
        tags={form.categoryTags}
        onAdd={addCategory}
        onRemove={removeCategory}
        presets={PRESET_CATEGORIES}
        placeholder="Add category tag"
      />

      {/* Expiry date */}
      <div>
        <label htmlFor="skill-expiry" className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
          Expiry Date <span className="text-[#555555]">(optional)</span>
        </label>
        <input
          id="skill-expiry"
          type="date"
          value={form.expiresAt ? new Date(form.expiresAt * 1000).toISOString().split('T')[0] : ''}
          onChange={e => {
            const val = e.target.value;
            update({ expiresAt: val ? Math.floor(new Date(val).getTime() / 1000) : undefined });
          }}
          min={new Date().toISOString().split('T')[0]}
          className="w-full px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] focus:outline-none focus:border-[#f7931a] transition-colors"
        />
        <p className="mt-1 text-xs text-[#555555]">Skill will be marked expired after this date.</p>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-600/10 border border-red-600/30 text-red-400 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!isValid || isLoading}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#f7931a] hover:bg-[#e8841a] text-white font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <BookOpen size={16} />
          {isLoading ? 'Publishing…' : 'Publish Skill'}
        </button>
      </div>
    </form>
  );
}
