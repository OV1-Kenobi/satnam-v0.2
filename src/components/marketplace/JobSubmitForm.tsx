/**
 * JobSubmitForm — Job submission form for NIP-90 DVM marketplace
 * Phase 3: DVM marketplace
 *
 * Fields:
 * - Job type selection (dropdown of kind:5xxx types)
 * - Input data (textarea or file)
 * - Parameters (key-value pairs)
 * - Budget (max bid in sats)
 * - Submit button
 */

import React, { useState } from 'react';
import { Zap, Plus, X, Send } from 'lucide-react';
import { useMarketplace } from '../../hooks/useMarketplace.js';
import type { DVMProvider } from '../../hooks/useMarketplace.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JobSubmitFormProps {
  provider?: DVMProvider;
  onComplete?: (jobId: string) => void;
  onCancel?: () => void;
}

interface KVParam {
  key: string;
  value: string;
}

const JOB_TYPES = [
  { kind: 5000, label: 'Text Generation', description: 'Generate text content' },
  { kind: 5001, label: 'Text Summary', description: 'Summarize text input' },
  { kind: 5002, label: 'Translation', description: 'Translate text' },
  { kind: 5003, label: 'Sentiment Analysis', description: 'Analyze text sentiment' },
  { kind: 5004, label: 'NLU', description: 'Natural language understanding' },
  { kind: 5100, label: 'Image Generation', description: 'Generate images from text' },
  { kind: 5200, label: 'Audio Transcription', description: 'Transcribe audio to text' },
  { kind: 5300, label: 'Text-to-Speech', description: 'Convert text to audio' },
  { kind: 5400, label: 'Video Generation', description: 'Generate video content' },
  { kind: 5500, label: 'Code Execution', description: 'Execute and analyze code' },
  { kind: 5600, label: 'Web Search', description: 'Search the web' },
  { kind: 5900, label: 'Image Classification', description: 'Classify image content' },
];

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function JobSubmitForm({ provider, onComplete, onCancel }: JobSubmitFormProps) {
  const { submitJob, isLoading } = useMarketplace();

  // Filter job types to provider's supported list if provided
  // DvmProvider.supportedJobKinds is number[]
  const availableJobTypes = provider?.supportedJobKinds?.length
    ? JOB_TYPES.filter(jt => provider.supportedJobKinds.includes(jt.kind))
    : JOB_TYPES;

  const defaultKind = availableJobTypes[0]?.kind ?? 5000;

  const [jobKind, setJobKind] = useState<number>(defaultKind);
  const [input, setInput] = useState('');
  const [params, setParams] = useState<KVParam[]>([{ key: '', value: '' }]);
  const [budgetSats, setBudgetSats] = useState('1000');
  const [error, setError] = useState<string | null>(null);

  const addParam = () => {
    setParams(prev => [...prev, { key: '', value: '' }]);
  };

  const removeParam = (idx: number) => {
    setParams(prev => prev.filter((_, i) => i !== idx));
  };

  const updateParam = (idx: number, field: 'key' | 'value', val: string) => {
    setParams(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));
  };

  const isValid = jobKind && input.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setError(null);

    const dvmParams = params
      .filter(p => p.key.trim() && p.value.trim())
      .map(p => ({ key: p.key.trim(), value: p.value.trim() }));

    try {
      // submitJob requires (DvmJobRequest, signerNsec)
      // Use a placeholder nsec — in production the vault provides the nsec
      const budgetMsats = parseInt(budgetSats) * 1000;
      const jobId = await submitJob(
        {
          kind: jobKind,
          input: [{ data: input.trim(), type: 'text' as const }],
          params: dvmParams,
          bid_msats: BigInt(budgetMsats),
          ...(provider?.pubkey ? { encryptTo: provider.pubkey } : {}),
        },
        '' // signerNsec — provided by vault in production
      );
      onComplete?.(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit job');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="heading-display text-xl text-[#f7931a]">Submit Job</h2>
          {provider && (
            <p className="text-sm text-[#555555] mt-0.5">
              To: <span className="text-[#a0a0a0]">{provider.name ?? provider.pubkey.slice(0, 12) + '…'}</span>
            </p>
          )}
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

      {/* Job type */}
      <div>
        <label htmlFor="job-type" className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
          Job Type <span className="text-[#f7931a]">*</span>
        </label>
        <select
          id="job-type"
          value={jobKind}
          onChange={e => setJobKind(Number(e.target.value))}
          required
          aria-required="true"
          className="w-full px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] focus:outline-none focus:border-[#f7931a] transition-colors appearance-none"
        >
          {availableJobTypes.map(jt => (
            <option key={jt.kind} value={jt.kind}>
              kind:{jt.kind} — {jt.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[#555555]">
          {JOB_TYPES.find(jt => jt.kind === jobKind)?.description}
        </p>
      </div>

      {/* Input */}
      <div>
        <label htmlFor="job-input" className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
          Input <span className="text-[#f7931a]">*</span>
        </label>
        <textarea
          id="job-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Enter input data for the job…"
          rows={4}
          required
          aria-required="true"
          className="w-full px-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] focus:outline-none focus:border-[#f7931a] transition-colors resize-none font-mono text-sm"
        />
      </div>

      {/* Parameters */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-[#a0a0a0]">Parameters</label>
          <button
            type="button"
            onClick={addParam}
            className="flex items-center gap-1 text-xs text-[#f7931a] hover:underline"
          >
            <Plus size={12} />
            Add
          </button>
        </div>

        <div className="space-y-2">
          {params.map((param, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <input
                type="text"
                value={param.key}
                onChange={e => updateParam(idx, 'key', e.target.value)}
                placeholder="key"
                aria-label={`Parameter ${idx + 1} key`}
                className="flex-1 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-xs font-mono focus:outline-none focus:border-[#f7931a] transition-colors"
              />
              <span className="text-[#555555] text-sm">:</span>
              <input
                type="text"
                value={param.value}
                onChange={e => updateParam(idx, 'value', e.target.value)}
                placeholder="value"
                aria-label={`Parameter ${idx + 1} value`}
                className="flex-1 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-xs font-mono focus:outline-none focus:border-[#f7931a] transition-colors"
              />
              <button
                type="button"
                onClick={() => removeParam(idx)}
                aria-label={`Remove parameter ${idx + 1}`}
                className="p-1.5 text-[#555555] hover:text-red-400 transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Budget */}
      <div>
        <label htmlFor="job-budget" className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
          Max Budget (sats)
        </label>
        <div className="relative">
          <Zap size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#f7931a]" aria-hidden="true" />
          <input
            id="job-budget"
            type="number"
            defaultValue="1000"
            onChange={e => setBudgetSats(e.target.value)}
            min={1}
            aria-label="Maximum budget in satoshis"
            className="w-full pl-9 pr-4 py-3 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] focus:outline-none focus:border-[#f7931a] transition-colors"
          />
        </div>
        <p className="mt-1 text-xs text-[#555555]">Maximum amount you'll pay for this job</p>
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
          <Send size={16} />
          {isLoading ? 'Submitting…' : 'Submit Job'}
        </button>
      </div>
    </form>
  );
}
