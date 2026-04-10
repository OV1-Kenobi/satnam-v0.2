/**
 * ActiveJobsList — Active and recent jobs list
 * Phase 3: NIP-90 DVM marketplace
 *
 * Displays:
 * - Job type, status, provider
 * - Submitted timestamp
 * - Payment amount
 * - Result preview
 */

import { useState } from 'react';
import clsx from 'clsx';
import {
  Briefcase,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Zap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useMarketplace } from '../../hooks/useMarketplace.js';
import type { Job, JobStatus, ActiveJob } from '../../hooks/useMarketplace.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveJobsListProps {
  onSelectJob?: (job: Job) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const JOB_TYPE_LABELS: Record<string, string> = {
  '5000': 'Text Generation',
  '5001': 'Text Summary',
  '5002': 'Translation',
  '5003': 'Sentiment',
  '5100': 'Image Gen',
  '5200': 'Transcription',
  '5300': 'TTS',
  '5400': 'Video Gen',
  '5500': 'Code Exec',
  '5600': 'Web Search',
  '5900': 'Classification',
};

function jobTypeLabel(jobType: number): string {
  return JOB_TYPE_LABELS[String(jobType)] ?? `kind:${jobType}`;
}

// ---------------------------------------------------------------------------
// Map ActiveJob → Job (UI-ready shape)
// ---------------------------------------------------------------------------

function activeJobToJob(aj: ActiveJob): Job {
  const hasResult = !!aj.result;
  const isPaid = !!aj.paymentResult;
  const status: JobStatus = (hasResult || isPaid) ? 'completed' : 'pending';

  return {
    id: aj.requestEventId,
    jobType: aj.request.kind,
    status,
    submittedAt: aj.submittedAt,
    result: aj.result ? aj.result.content : null,
    paid: isPaid,
  };
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<JobStatus, {
  label: string;
  Icon: typeof Loader2;
  className: string;
  badgeClass: string;
}> = {
  pending: {
    label: 'Pending',
    Icon: Clock,
    className: 'text-slate-400',
    badgeClass: 'bg-slate-600 text-slate-200',
  },
  processing: {
    label: 'Processing',
    Icon: Loader2,
    className: 'text-blue-400',
    badgeClass: 'bg-blue-600 text-white',
  },
  completed: {
    label: 'Complete',
    Icon: CheckCircle,
    className: 'text-green-400',
    badgeClass: 'bg-green-600 text-white',
  },
  failed: {
    label: 'Failed',
    Icon: XCircle,
    className: 'text-red-400',
    badgeClass: 'bg-red-600 text-white',
  },
  error: {
    label: 'Error',
    Icon: XCircle,
    className: 'text-red-400',
    badgeClass: 'bg-red-600 text-white',
  },
};

// ---------------------------------------------------------------------------
// Job row
// ---------------------------------------------------------------------------

function JobRow({
  job,
  onSelect,
}: {
  job: Job;
  onSelect?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[job.status];
  const { Icon } = config;

  return (
    <div className="rounded-xl border border-[#2a2a2a] overflow-hidden">
      {/* Main row */}
      <div
        className={clsx(
          'flex items-center gap-3 px-4 py-3 bg-[#1a1a1a]',
          onSelect && 'cursor-pointer hover:bg-[#222222]',
        )}
        onClick={onSelect}
        role={onSelect ? 'button' : undefined}
        tabIndex={onSelect ? 0 : undefined}
        onKeyDown={e => e.key === 'Enter' && onSelect?.()}
        aria-label={`Job ${jobTypeLabel(job.jobType)}, status: ${config.label}`}
      >
        {/* Status icon */}
        <Icon
          size={16}
          className={clsx(
            config.className,
            job.status === 'processing' && 'animate-spin',
          )}
          aria-hidden="true"
        />

        {/* Job info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[#f5f5f5]">
              {jobTypeLabel(job.jobType)}
            </span>
            <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-bold', config.badgeClass)}>
              {config.label}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-[#555555]">
              {formatTimestamp(job.submittedAt)}
            </span>
          </div>
        </div>

        {/* Paid indicator */}
        <div className="text-right flex-shrink-0">
          {job.paid && (
            <div className="flex items-center gap-1 justify-end">
              <Zap size={11} className="text-[#f7931a]" />
              <span className="font-mono text-xs font-bold text-[#f7931a]">Paid</span>
            </div>
          )}
        </div>

        {/* Expand toggle */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); setExpanded(o => !o); }}
          aria-label={expanded ? 'Collapse job details' : 'Expand job details'}
          aria-expanded={expanded}
          className="p-1 text-[#555555] hover:text-[#a0a0a0] transition-colors flex-shrink-0"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 py-3 bg-[#111111] border-t border-[#2a2a2a] space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-[#555555]">Job ID</span>
            <code className="font-mono text-[#a0a0a0]">{job.id.slice(0, 20)}…</code>
          </div>
          {/* Result preview */}
          {job.result && (
            <div>
              <p className="text-xs text-[#555555] mb-1">Result Preview</p>
              <p className="text-xs text-[#a0a0a0] line-clamp-2 font-mono bg-[#1a1a1a] rounded px-2 py-1">
                {job.result.slice(0, 120)}{job.result.length > 120 ? '…' : ''}
              </p>
            </div>
          )}
          {onSelect && (
            <button
              type="button"
              onClick={onSelect}
              className="text-xs text-[#f7931a] hover:underline"
            >
              View full result →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

type FilterStatus = 'all' | JobStatus;

function FilterBar({
  active,
  onChange,
  counts,
}: {
  active: FilterStatus;
  onChange: (f: FilterStatus) => void;
  counts: Partial<Record<FilterStatus, number>>;
}) {
  const filters: Array<{ id: FilterStatus; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'processing', label: 'Processing' },
    { id: 'completed', label: 'Complete' },
    { id: 'error', label: 'Error' },
  ];

  return (
    <div className="flex gap-1 overflow-x-auto pb-1" role="group" aria-label="Filter jobs by status">
      {filters.map(f => (
        <button
          key={f.id}
          type="button"
          onClick={() => onChange(f.id)}
          aria-pressed={active === f.id}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0',
            active === f.id
              ? 'bg-[#f7931a] text-black'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700',
          )}
        >
          {f.label}
          {counts[f.id] !== undefined && (
            <span className={clsx(
              'px-1.5 py-0.5 rounded-full text-[10px]',
              active === f.id ? 'bg-black/20' : 'bg-slate-700',
            )}>
              {counts[f.id]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function ActiveJobsList({ onSelectJob }: ActiveJobsListProps) {
  const { activeJobs, isLoading } = useMarketplace();
  const [filter, setFilter] = useState<FilterStatus>('all');

  // Map ActiveJob[] → Job[]
  const jobs: Job[] = activeJobs.map(activeJobToJob);

  const filteredJobs = filter === 'all'
    ? jobs
    : jobs.filter(j => j.status === filter);

  // Compute counts
  const counts: Partial<Record<FilterStatus, number>> = { all: jobs.length };
  for (const job of jobs) {
    counts[job.status] = (counts[job.status] ?? 0) + 1;
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <FilterBar active={filter} onChange={setFilter} counts={counts} />

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={24} className="animate-spin text-[#555555]" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && filteredJobs.length === 0 && (
        <div className="text-center py-10">
          <Briefcase size={32} className="mx-auto text-[#555555] mb-3" />
          <p className="text-sm text-[#555555]">
            {filter === 'all' ? 'No jobs yet' : `No ${filter} jobs`}
          </p>
          <p className="text-xs text-[#555555] mt-1">Submit a job to get started</p>
        </div>
      )}

      {/* Job list */}
      {!isLoading && filteredJobs.length > 0 && (
        <div className="space-y-2" role="list" aria-label="Jobs list">
          {filteredJobs.map(job => (
            <div key={job.id} role="listitem">
              <JobRow
                job={job}
                onSelect={onSelectJob ? () => onSelectJob(job) : undefined}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
