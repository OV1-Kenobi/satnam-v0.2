/**
 * JobResultDisplay — Job result display panel
 * Phase 3: NIP-90 DVM marketplace
 *
 * Displays:
 * - Result content (text, structured data)
 * - Job status indicator
 * - Feedback form
 */

import React, { useState } from 'react';
import clsx from 'clsx';
import {
  CheckCircle,
  XCircle,
  Copy,
  CheckCheck,
  MessageSquare,
  Star,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import type { Job } from '../../hooks/useMarketplace.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JobResultDisplayProps {
  job: Job;
  onAccepted?: (jobId: string) => void;
  onRejected?: (jobId: string) => void;
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className="p-1.5 rounded text-[#555555] hover:text-[#f7931a] transition-colors"
    >
      {copied ? <CheckCheck size={13} className="text-green-500" /> : <Copy size={13} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Star rating input
// ---------------------------------------------------------------------------

function StarInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (rating: number) => void;
}) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex gap-1" role="group" aria-label="Rating">
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(0)}
          aria-label={`Rate ${i} star${i !== 1 ? 's' : ''}`}
          aria-pressed={value === i}
          className="focus:outline-none"
        >
          <Star
            size={18}
            className={clsx(
              'transition-colors',
              (hover > 0 ? i <= hover : i <= value)
                ? 'text-[#ffd700] fill-[#ffd700]'
                : 'text-[#2a2a2a]',
            )}
          />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback form
// ---------------------------------------------------------------------------

function FeedbackForm({ onSubmit }: { onSubmit: (rating: number, comment: string) => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) return;
    onSubmit(rating, comment);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-900/10 border border-green-900/30 text-green-400 text-sm">
        <CheckCircle size={14} />
        Feedback submitted. Thank you!
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-[#555555] uppercase tracking-widest">Rate this result</p>
      <StarInput value={rating} onChange={setRating} />
      <textarea
        value={comment}
        onChange={e => setComment(e.target.value)}
        placeholder="Optional comment…"
        rows={2}
        maxLength={256}
        className="w-full px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-[#f5f5f5] placeholder-[#555555] text-sm focus:outline-none focus:border-[#f7931a] transition-colors resize-none"
        aria-label="Feedback comment"
      />
      <button
        type="submit"
        disabled={rating === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs disabled:opacity-50 transition-colors"
      >
        <MessageSquare size={12} />
        Submit Feedback
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function JobResultDisplay({
  job,
  onAccepted,
  onRejected,
}: JobResultDisplayProps) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [accepted, setAccepted] = useState(false);

  if (!job.result) {
    return (
      <div className="card text-center py-8">
        <Loader2 size={24} className="mx-auto text-[#555555] mb-2 animate-spin" />
        <p className="text-sm text-[#555555]">Waiting for result…</p>
      </div>
    );
  }

  const resultText = job.result;
  const isCompleted = job.status === 'completed';
  const isError = job.status === 'error' || job.status === 'failed';

  const handleAccept = () => {
    setAccepted(true);
    onAccepted?.(job.id);
  };

  const handleReject = () => {
    onRejected?.(job.id);
  };

  const handleFeedback = (_rating: number, _comment: string) => {
    // In production: publish NIP-90 feedback event
  };

  return (
    <div className="space-y-4">
      {/* Result header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-[#555555] uppercase tracking-widest">Job Result</h3>
        <div className="flex items-center gap-1.5">
          <span className={clsx(
            'w-2 h-2 rounded-full',
            isCompleted ? 'bg-green-500' : isError ? 'bg-red-500' : 'bg-yellow-500',
          )} aria-hidden="true" />
          <span className="text-xs text-[#a0a0a0] capitalize">{job.status}</span>
        </div>
      </div>

      {/* Result content */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-[#555555] uppercase tracking-widest">Result</p>
          <CopyButton text={resultText} label="Copy result content" />
        </div>
        <pre className="whitespace-pre-wrap text-sm text-[#f5f5f5] font-mono leading-relaxed overflow-x-auto max-h-64 overflow-y-auto">
          {resultText}
        </pre>
      </div>

      {/* Payment status */}
      {job.paid && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-900/10 border border-green-900/30 text-green-400">
          <CheckCircle size={16} />
          <span className="text-sm font-medium">Payment confirmed</span>
        </div>
      )}

      {/* Error info */}
      {isError && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-900/10 border border-red-900/30">
          <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">Job failed. No payment required.</p>
        </div>
      )}

      {/* Actions */}
      {!accepted && !job.paid && isCompleted && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleReject}
            aria-label="Reject result"
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors"
          >
            <XCircle size={15} />
            Reject
          </button>
          <button
            type="button"
            onClick={handleAccept}
            aria-label="Accept result"
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#f7931a] hover:bg-[#e8841a] text-white text-sm font-medium transition-colors"
          >
            <CheckCircle size={15} />
            Accept
          </button>
        </div>
      )}

      {/* Accepted state */}
      {(accepted || job.paid) && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-900/10 border border-green-900/30 text-green-400">
          <CheckCircle size={16} />
          <span className="text-sm font-medium">Result accepted</span>
        </div>
      )}

      {/* Feedback */}
      {(accepted || job.paid) && (
        <div className="card">
          {!showFeedback ? (
            <button
              type="button"
              onClick={() => setShowFeedback(true)}
              className="flex items-center gap-2 text-sm text-[#555555] hover:text-[#a0a0a0] transition-colors"
            >
              <MessageSquare size={14} />
              Leave feedback for provider
            </button>
          ) : (
            <FeedbackForm onSubmit={handleFeedback} />
          )}
        </div>
      )}
    </div>
  );
}
