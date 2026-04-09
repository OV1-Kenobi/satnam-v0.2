/**
 * ExecutionResultPanel — Execution result display
 *
 * Features:
 * - stdout/stderr blocks (monospace, dark bg)
 * - File change summary (added/modified/deleted with line counts)
 * - Test result table (pass/fail with duration)
 * - Exit code badge
 *
 * Spec §8.2
 */

import { useState, useCallback } from 'react';
import clsx from 'clsx';
import {
  Terminal,
  CheckCircle2,
  XCircle,
  FileText,
  Plus,
  Minus,
  Edit2,
  Copy,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Clock,
  BarChart2,
  Zap,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions?: number;
  deletions?: number;
  oldPath?: string;
}

export interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending';
  duration_ms?: number;
  error_message?: string;
  file?: string;
}

export interface ExecutionResult {
  exit_code: number;
  stdout?: string;
  stderr?: string;
  file_changes?: FileChange[];
  test_results?: TestResult[];
  duration_ms?: number;
  sats_cost?: number;
  timestamp?: string;
}

// ---------------------------------------------------------------------------
// ExitCodeBadge
// ---------------------------------------------------------------------------

function ExitCodeBadge({ code }: { code: number }) {
  const success = code === 0;
  return (
    <div
      className={clsx(
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-mono font-bold',
        success
          ? 'bg-green-500/15 text-green-400 border border-green-500/25'
          : 'bg-red-500/15 text-red-400 border border-red-500/25',
      )}
      role="status"
      aria-label={`Exit code ${code} — ${success ? 'success' : 'failure'}`}
    >
      {success
        ? <CheckCircle2 size={14} aria-hidden="true" />
        : <XCircle size={14} aria-hidden="true" />
      }
      Exit {code}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OutputBlock — stdout or stderr
// ---------------------------------------------------------------------------

function OutputBlock({
  label,
  content,
  variant,
}: {
  label: string;
  content: string;
  variant: 'stdout' | 'stderr';
}) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const lines = content.split('\n');
  const lineCount = lines.length;
  const visibleContent = !expanded ? lines.slice(0, 30).join('\n') + '\n…' : content;

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const isStderr = variant === 'stderr';

  return (
    <div
      className={clsx(
        'rounded-xl border overflow-hidden',
        isStderr ? 'border-red-500/20' : 'border-slate-800',
      )}
      role="region"
      aria-label={label}
    >
      {/* Header */}
      <div
        className={clsx(
          'flex items-center gap-2 px-3 py-2 border-b',
          isStderr
            ? 'bg-red-500/10 border-red-500/20'
            : 'bg-slate-800/60 border-slate-800',
        )}
      >
        <Terminal size={13} className={isStderr ? 'text-red-400' : 'text-slate-400'} aria-hidden="true" />
        <span className={clsx('text-xs font-medium font-mono', isStderr ? 'text-red-400' : 'text-slate-300')}>
          {label}
        </span>
        <span className="text-[10px] text-slate-600 ml-1">
          {lineCount} line{lineCount !== 1 ? 's' : ''}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            aria-label={`Copy ${label}`}
            className="p-1 text-slate-600 hover:text-slate-400 transition-colors"
          >
            {copied ? <CheckCheck size={12} className="text-green-400" /> : <Copy size={12} />}
          </button>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
            aria-expanded={expanded}
            className="p-1 text-slate-600 hover:text-slate-400 transition-colors"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* Content */}
      {expanded ? (
        <div className="bg-[#070b10] p-3 overflow-x-auto max-h-64">
          <pre className={clsx(
            'font-mono text-[11px] leading-5 whitespace-pre',
            isStderr ? 'text-red-300' : 'text-slate-300',
          )}>
            {visibleContent}
          </pre>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full py-2 text-xs text-slate-600 hover:text-slate-400 transition-colors bg-slate-900"
        >
          Show {lineCount} lines
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileChangeStatus icon
// ---------------------------------------------------------------------------

function FileStatusIcon({ status }: { status: FileChange['status'] }) {
  switch (status) {
    case 'added':    return <Plus size={11} className="text-green-400" aria-hidden="true" />;
    case 'deleted':  return <Minus size={11} className="text-red-400" aria-hidden="true" />;
    case 'modified': return <Edit2 size={11} className="text-blue-400" aria-hidden="true" />;
    case 'renamed':  return <Edit2 size={11} className="text-purple-400" aria-hidden="true" />;
    default:         return <FileText size={11} className="text-slate-400" aria-hidden="true" />;
  }
}

function fileStatusLabel(status: FileChange['status']): string {
  switch (status) {
    case 'added':    return 'A';
    case 'deleted':  return 'D';
    case 'modified': return 'M';
    case 'renamed':  return 'R';
    default:         return '?';
  }
}

function fileStatusColor(status: FileChange['status']): string {
  switch (status) {
    case 'added':    return 'text-green-400 bg-green-500/10';
    case 'deleted':  return 'text-red-400 bg-red-500/10';
    case 'modified': return 'text-blue-400 bg-blue-500/10';
    case 'renamed':  return 'text-purple-400 bg-purple-500/10';
    default:         return 'text-slate-400 bg-slate-500/10';
  }
}

// ---------------------------------------------------------------------------
// FileChangeSummary
// ---------------------------------------------------------------------------

function FileChangeSummary({ changes }: { changes: FileChange[] }) {
  const added    = changes.filter(c => c.status === 'added').length;
  const modified = changes.filter(c => c.status === 'modified').length;
  const deleted  = changes.filter(c => c.status === 'deleted').length;
  const renamed  = changes.filter(c => c.status === 'renamed').length;

  return (
    <div
      className="rounded-xl border border-slate-800 overflow-hidden"
      role="region"
      aria-label="File changes"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/60 border-b border-slate-800">
        <FileText size={13} className="text-slate-400" aria-hidden="true" />
        <h3 className="text-sm font-medium text-slate-300">File Changes</h3>
        <span className="text-[10px] text-slate-600">
          {changes.length} file{changes.length !== 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex items-center gap-2 text-[10px]">
          {added > 0    && <span className="text-green-400">+{added}</span>}
          {modified > 0 && <span className="text-blue-400">~{modified}</span>}
          {deleted > 0  && <span className="text-red-400">-{deleted}</span>}
          {renamed > 0  && <span className="text-purple-400">⟶{renamed}</span>}
        </div>
      </div>

      {/* File list */}
      <div className="divide-y divide-slate-800/50" role="list">
        {changes.map((change, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-800/30 transition-colors group"
            role="listitem"
          >
            {/* Status badge */}
            <span
              className={clsx(
                'w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center flex-shrink-0',
                fileStatusColor(change.status),
              )}
              aria-label={change.status}
            >
              {fileStatusLabel(change.status)}
            </span>

            {/* Path */}
            <div className="flex-1 min-w-0">
              {change.status === 'renamed' && change.oldPath ? (
                <p className="font-mono text-[11px] text-slate-400 truncate">
                  <span className="text-red-400">{change.oldPath}</span>
                  <span className="text-slate-600 mx-1">→</span>
                  <span className="text-slate-300">{change.path}</span>
                </p>
              ) : (
                <p className="font-mono text-[11px] text-slate-300 truncate">{change.path}</p>
              )}
            </div>

            {/* Line counts */}
            <div className="flex items-center gap-1.5 flex-shrink-0 text-[10px]">
              {change.additions != null && change.additions > 0 && (
                <span className="text-green-400 font-mono">+{change.additions}</span>
              )}
              {change.deletions != null && change.deletions > 0 && (
                <span className="text-red-400 font-mono">-{change.deletions}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TestResultTable
// ---------------------------------------------------------------------------

function TestStatusIcon({ status }: { status: TestResult['status'] }) {
  switch (status) {
    case 'passed':  return <CheckCircle2 size={13} className="text-green-400" aria-hidden="true" />;
    case 'failed':  return <XCircle size={13} className="text-red-400" aria-hidden="true" />;
    case 'skipped': return <Clock size={13} className="text-yellow-400" aria-hidden="true" />;
    case 'pending': return <Clock size={13} className="text-slate-500" aria-hidden="true" />;
    default:        return null;
  }
}

function TestResultTable({ results }: { results: TestResult[] }) {
  const passed  = results.filter(r => r.status === 'passed').length;
  const failed  = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const total   = results.length;

  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  return (
    <div
      className="rounded-xl border border-slate-800 overflow-hidden"
      role="region"
      aria-label="Test results"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-slate-800/60 border-b border-slate-800">
        <div className="flex items-center gap-2 mb-2">
          <BarChart2 size={13} className="text-slate-400" aria-hidden="true" />
          <h3 className="text-sm font-medium text-slate-300">Test Results</h3>
          <span className={clsx(
            'ml-auto text-xs font-bold',
            failed > 0 ? 'text-red-400' : 'text-green-400',
          )}>
            {passed}/{total} passed
          </span>
        </div>

        {/* Progress bar */}
        <div
          className="h-1.5 bg-slate-700 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={passRate}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${passRate}% tests passing`}
        >
          <div
            className={clsx('h-full rounded-full transition-all', failed > 0 ? 'bg-red-500' : 'bg-green-500')}
            style={{ width: `${passRate}%` }}
          />
        </div>

        {/* Summary pills */}
        <div className="flex items-center gap-2 mt-2 text-[10px]">
          {passed > 0  && <span className="text-green-400">{passed} passed</span>}
          {failed > 0  && <span className="text-red-400">{failed} failed</span>}
          {skipped > 0 && <span className="text-yellow-400">{skipped} skipped</span>}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full" aria-label="Test results table">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left text-[10px] font-medium text-slate-600 uppercase tracking-wider px-4 py-2">
                Test
              </th>
              <th className="text-center text-[10px] font-medium text-slate-600 uppercase tracking-wider px-3 py-2 w-20">
                Status
              </th>
              <th className="text-right text-[10px] font-medium text-slate-600 uppercase tracking-wider px-4 py-2 w-20">
                Duration
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {results.map((test, idx) => (
              <tr
                key={idx}
                className="hover:bg-slate-800/20 transition-colors"
              >
                <td className="px-4 py-2.5">
                  <div>
                    <p className="text-xs text-slate-300 font-mono leading-tight">{test.name}</p>
                    {test.file && (
                      <p className="text-[10px] text-slate-600 truncate mt-0.5">{test.file}</p>
                    )}
                    {test.status === 'failed' && test.error_message && (
                      <p className="text-[10px] text-red-400 mt-1 truncate">{test.error_message}</p>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-center">
                    <TestStatusIcon status={test.status} />
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {test.duration_ms != null ? (
                    <span className="text-[11px] text-slate-500 font-mono">
                      {test.duration_ms < 1000
                        ? `${test.duration_ms}ms`
                        : `${(test.duration_ms / 1000).toFixed(1)}s`}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-700">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExecutionResultPanel — main export
// ---------------------------------------------------------------------------

export interface ExecutionResultPanelProps {
  result: ExecutionResult;
  title?: string;
  className?: string;
}

export default function ExecutionResultPanel({
  result,
  title,
  className,
}: ExecutionResultPanelProps) {
  const success = result.exit_code === 0;
  const hasStdout = !!(result.stdout && result.stdout.trim());
  const hasStderr = !!(result.stderr && result.stderr.trim());
  const hasFiles  = !!(result.file_changes && result.file_changes.length > 0);
  const hasTests  = !!(result.test_results && result.test_results.length > 0);

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-[#f7931a]" aria-hidden="true" />
          <h2 className="heading-display text-base text-[#f7931a]">
            {title ?? 'Execution Result'}
          </h2>
        </div>
        <ExitCodeBadge code={result.exit_code} />
      </div>

      {/* Summary bar */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 px-4 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Status */}
          <div className="flex items-center gap-1.5">
            {success
              ? <CheckCircle2 size={14} className="text-green-400" aria-hidden="true" />
              : <XCircle size={14} className="text-red-400" aria-hidden="true" />
            }
            <span className={clsx('text-sm font-medium', success ? 'text-green-400' : 'text-red-400')}>
              {success ? 'Completed' : 'Failed'}
            </span>
          </div>

          {/* Duration */}
          {result.duration_ms != null && (
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Clock size={12} aria-hidden="true" />
              {result.duration_ms < 1000
                ? `${result.duration_ms}ms`
                : `${(result.duration_ms / 1000).toFixed(2)}s`}
            </div>
          )}

          {/* Sats cost */}
          {result.sats_cost != null && (
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Zap size={12} aria-hidden="true" />
              {result.sats_cost} sats
            </div>
          )}

          {/* Timestamp */}
          {result.timestamp && (
            <span className="text-[10px] text-slate-600 ml-auto">
              {new Date(result.timestamp).toLocaleString('en-US', { hour12: false })}
            </span>
          )}
        </div>
      </div>

      {/* stdout */}
      {hasStdout && (
        <OutputBlock
          label="stdout"
          content={result.stdout!}
          variant="stdout"
        />
      )}

      {/* stderr */}
      {hasStderr && (
        <OutputBlock
          label="stderr"
          content={result.stderr!}
          variant="stderr"
        />
      )}

      {/* File changes */}
      {hasFiles && (
        <FileChangeSummary changes={result.file_changes!} />
      )}

      {/* Test results */}
      {hasTests && (
        <TestResultTable results={result.test_results!} />
      )}

      {/* Empty state */}
      {!hasStdout && !hasStderr && !hasFiles && !hasTests && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-8 text-center">
          <Terminal size={28} className="mx-auto text-slate-700 mb-3" aria-hidden="true" />
          <p className="text-sm text-slate-500">No output captured</p>
          <p className="text-xs text-slate-600 mt-1">
            Exit code {result.exit_code} — {success ? 'process completed cleanly' : 'process failed without output'}
          </p>
        </div>
      )}
    </div>
  );
}

