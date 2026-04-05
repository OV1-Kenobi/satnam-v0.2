/**
 * ToolCallApproval — Per-tool-call approval UI
 *
 * Features:
 * - Tool name + parameters display (JSON, CSS-only syntax highlighting)
 * - Approve / Reject / Modify buttons
 * - Parameter editor for modifications
 * - Auto-approve toggle for trusted tools
 * - Approval history
 *
 * Spec §8.2
 */

import React, { useState, useCallback, useRef } from 'react';
import clsx from 'clsx';
import {
  Wrench,
  Check,
  X,
  Edit3,
  RotateCcw,
  Shield,
  ShieldCheck,
  Clock,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Info,
  Zap,
  Copy,
  CheckCheck,
} from 'lucide-react';

import { useProbeSession } from '../../hooks/useProbeSession.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalDecision = 'approved' | 'rejected' | 'modified';

export interface ToolCallRequest {
  id: string;
  session_id: string;
  tool_name: string;
  parameters: Record<string, unknown>;
  description?: string;
  estimated_cost_sats?: number;
  risk_level?: 'low' | 'medium' | 'high';
  timestamp: string;
}

export interface ApprovalRecord {
  id: string;
  tool_name: string;
  decision: ApprovalDecision;
  timestamp: string;
  modified_parameters?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers — CSS-only JSON syntax highlighting
// ---------------------------------------------------------------------------

/** Tokenizes a JSON string into spans with CSS classes — NO external lib */
function highlightJSON(json: string): React.ReactNode[] {
  const lines = json.split('\n');
  return lines.map((line, lineIdx) => {
    // Tokenize: strings, numbers, booleans, null, punctuation, keys
    const tokens: React.ReactNode[] = [];
    let remaining = line;
    let tokenIdx = 0;

    while (remaining.length > 0) {
      // String (key or value)
      const strMatch = remaining.match(/^("(?:[^"\\]|\\.)*")/);
      if (strMatch) {
        const s = strMatch[1];
        // Check if it's a key (followed by colon)
        const afterStr = remaining.slice(s.length).trimStart();
        const isKey = afterStr.startsWith(':');
        tokens.push(
          <span key={tokenIdx++} className={isKey ? 'text-blue-300' : 'text-green-400'}>
            {s}
          </span>
        );
        remaining = remaining.slice(s.length);
        continue;
      }

      // Number
      const numMatch = remaining.match(/^(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/);
      if (numMatch) {
        tokens.push(
          <span key={tokenIdx++} className="text-yellow-400">{numMatch[1]}</span>
        );
        remaining = remaining.slice(numMatch[1].length);
        continue;
      }

      // Boolean / null
      const boolMatch = remaining.match(/^(true|false|null)/);
      if (boolMatch) {
        tokens.push(
          <span key={tokenIdx++} className="text-purple-400">{boolMatch[1]}</span>
        );
        remaining = remaining.slice(boolMatch[1].length);
        continue;
      }

      // Punctuation { } [ ] , :
      const punctMatch = remaining.match(/^([{}\[\],:])/);
      if (punctMatch) {
        tokens.push(
          <span key={tokenIdx++} className="text-slate-400">{punctMatch[1]}</span>
        );
        remaining = remaining.slice(1);
        continue;
      }

      // Whitespace
      const wsMatch = remaining.match(/^(\s+)/);
      if (wsMatch) {
        tokens.push(<span key={tokenIdx++}>{wsMatch[1]}</span>);
        remaining = remaining.slice(wsMatch[1].length);
        continue;
      }

      // Fallback — consume one character
      tokens.push(<span key={tokenIdx++} className="text-slate-300">{remaining[0]}</span>);
      remaining = remaining.slice(1);
    }

    return (
      <div key={lineIdx} className="whitespace-pre">
        {tokens}
        {'\n'}
      </div>
    );
  });
}

// ---------------------------------------------------------------------------
// Risk badge
// ---------------------------------------------------------------------------

function RiskBadge({ level }: { level: 'low' | 'medium' | 'high' }) {
  const cfg = {
    low:    { label: 'Low Risk',    cls: 'bg-green-500/10 text-green-400 border-green-500/20',  Icon: Shield },
    medium: { label: 'Medium Risk', cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', Icon: AlertTriangle },
    high:   { label: 'High Risk',   cls: 'bg-red-500/10 text-red-400 border-red-500/20',          Icon: AlertTriangle },
  }[level];

  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border', cfg.cls)}>
      <cfg.Icon size={10} aria-hidden="true" />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ParameterEditor
// ---------------------------------------------------------------------------

function ParameterEditor({
  initialParams,
  onChange,
}: {
  initialParams: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const [raw, setRaw] = useState(() => JSON.stringify(initialParams, null, 2));
  const [error, setError] = useState<string | null>(null);

  const handleChange = useCallback((value: string) => {
    setRaw(value);
    try {
      const parsed = JSON.parse(value);
      setError(null);
      onChange(parsed);
    } catch {
      setError('Invalid JSON');
    }
  }, [onChange]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-slate-400">
          Modified Parameters
        </label>
        {error && (
          <span className="text-[10px] text-red-400 flex items-center gap-1">
            <AlertTriangle size={10} aria-hidden="true" />
            {error}
          </span>
        )}
      </div>
      <textarea
        value={raw}
        onChange={e => handleChange(e.target.value)}
        aria-label="Modified tool call parameters (JSON)"
        spellCheck={false}
        className={clsx(
          'w-full font-mono text-xs bg-[#0a0a0a] border rounded-lg p-3 text-slate-300 resize-none',
          'focus:outline-none focus:border-[#f7931a] transition-colors min-h-[120px]',
          error ? 'border-red-500/50' : 'border-slate-700',
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApprovalHistoryItem
// ---------------------------------------------------------------------------

function ApprovalHistoryItem({ record }: { record: ApprovalRecord }) {
  const cfg = {
    approved: { Icon: Check,   cls: 'text-green-400', bg: 'bg-green-400/10' },
    rejected: { Icon: X,       cls: 'text-red-400',   bg: 'bg-red-400/10'   },
    modified: { Icon: Edit3,   cls: 'text-blue-400',  bg: 'bg-blue-400/10'  },
  }[record.decision];

  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-800 last:border-0">
      <div className={clsx('w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0', cfg.bg)}>
        <cfg.Icon size={12} className={cfg.cls} aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-300 font-mono truncate">{record.tool_name}</p>
        <p className="text-[10px] text-slate-600">
          {new Date(record.timestamp).toLocaleTimeString('en-US', { hour12: false })}
        </p>
      </div>
      <span className={clsx(
        'text-[10px] font-medium uppercase tracking-wider',
        cfg.cls,
      )}>
        {record.decision}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolCallCard — single pending approval
// ---------------------------------------------------------------------------

function ToolCallCard({
  request,
  autoApproved,
  onDecide,
}: {
  request: ToolCallRequest;
  autoApproved: boolean;
  onDecide: (id: string, decision: ApprovalDecision, params?: Record<string, unknown>) => void;
}) {
  const { respondToToolCall } = useProbeSession();
  const [mode, setMode] = useState<'view' | 'modify'>('view');
  const [modifiedParams, setModifiedParams] = useState<Record<string, unknown>>(request.parameters);
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const [deciding, setDeciding] = useState(false);

  const prettyJson = JSON.stringify(request.parameters, null, 2);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(prettyJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [prettyJson]);

  const handleDecide = useCallback(async (decision: ApprovalDecision) => {
    setDeciding(true);
    try {
      const params = decision === 'modified' ? modifiedParams : request.parameters;
      await respondToToolCall(request.id, decision, params);
      onDecide(request.id, decision, params);
    } finally {
      setDeciding(false);
    }
  }, [request, modifiedParams, respondToToolCall, onDecide]);

  return (
    <div
      className={clsx(
        'rounded-xl border overflow-hidden',
        autoApproved ? 'border-green-500/20 bg-green-500/5' : 'border-[#f7931a]/30 bg-[#f7931a]/5',
      )}
      role="article"
      aria-label={`Tool call approval: ${request.tool_name}`}
    >
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/60">
        <div className="flex items-center gap-2 min-w-0">
          <Wrench size={14} className="text-[#f7931a] flex-shrink-0" aria-hidden="true" />
          <span className="font-mono font-medium text-sm text-slate-200 truncate">
            {request.tool_name}
          </span>
          {request.risk_level && <RiskBadge level={request.risk_level} />}
          {autoApproved && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-green-500/15 text-green-400 border border-green-500/20">
              <ShieldCheck size={10} aria-hidden="true" />
              Auto
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {request.estimated_cost_sats !== undefined && (
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <Zap size={10} aria-hidden="true" />
              {request.estimated_cost_sats} sats
            </span>
          )}
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-label={expanded ? 'Collapse parameters' : 'Expand parameters'}
            aria-expanded={expanded}
            className="p-1 text-slate-600 hover:text-slate-400 transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Description */}
      {request.description && (
        <div className="px-4 py-2 flex items-start gap-2 bg-blue-500/5 border-b border-blue-500/10">
          <Info size={12} className="text-blue-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p className="text-xs text-blue-300">{request.description}</p>
        </div>
      )}

      {/* Parameters */}
      {expanded && (
        <div className="px-4 pt-3 pb-2">
          {mode === 'view' ? (
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Parameters</span>
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label="Copy parameters JSON"
                  className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
                >
                  {copied ? <CheckCheck size={11} className="text-green-400" /> : <Copy size={11} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div
                className="font-mono text-[11px] leading-relaxed bg-[#0a0a0a] rounded-lg p-3 border border-slate-800 overflow-x-auto"
                aria-label="Tool call parameters"
              >
                {highlightJSON(prettyJson)}
              </div>
            </div>
          ) : (
            <ParameterEditor
              initialParams={request.parameters}
              onChange={setModifiedParams}
            />
          )}
        </div>
      )}

      {/* Actions */}
      {!autoApproved && (
        <div className="px-4 py-3 border-t border-slate-800 flex items-center gap-2 flex-wrap">
          {/* Approve */}
          <button
            type="button"
            onClick={() => handleDecide('approved')}
            disabled={deciding}
            aria-label="Approve tool call"
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
              'bg-green-600 hover:bg-green-500 text-white disabled:opacity-50',
            )}
          >
            <Check size={13} aria-hidden="true" />
            Approve
          </button>

          {/* Reject */}
          <button
            type="button"
            onClick={() => handleDecide('rejected')}
            disabled={deciding}
            aria-label="Reject tool call"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-all disabled:opacity-50"
          >
            <X size={13} aria-hidden="true" />
            Reject
          </button>

          {/* Modify toggle */}
          <button
            type="button"
            onClick={() => setMode(m => m === 'modify' ? 'view' : 'modify')}
            aria-label={mode === 'modify' ? 'Cancel parameter edit' : 'Modify parameters'}
            aria-pressed={mode === 'modify'}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
              mode === 'modify'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700',
            )}
          >
            <Edit3 size={13} aria-hidden="true" />
            {mode === 'modify' ? 'Cancel' : 'Modify'}
          </button>

          {/* Submit modified */}
          {mode === 'modify' && (
            <button
              type="button"
              onClick={() => handleDecide('modified')}
              disabled={deciding}
              aria-label="Submit modified parameters"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-all disabled:opacity-50 ml-auto"
            >
              <Check size={13} aria-hidden="true" />
              Submit Modified
            </button>
          )}

          {/* Timestamp */}
          <span className="text-[10px] text-slate-600 flex items-center gap-1 ml-auto">
            <Clock size={10} aria-hidden="true" />
            {new Date(request.timestamp).toLocaleTimeString('en-US', { hour12: false })}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolCallApproval — main export
// ---------------------------------------------------------------------------

export interface ToolCallApprovalProps {
  sessionId?: string;
  /** Pre-fed pending requests (optional; hook provides live data) */
  pendingRequests?: ToolCallRequest[];
  /** Show the auto-approve toggle */
  showAutoApprove?: boolean;
  className?: string;
}

export default function ToolCallApproval({
  sessionId,
  pendingRequests: externalRequests,
  showAutoApprove = true,
  className,
}: ToolCallApprovalProps) {
  const [pending, setPending] = useState<ToolCallRequest[]>(externalRequests ?? []);
  const [autoApproveList, setAutoApproveList] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<ApprovalRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Merge external requests if provided
  React.useEffect(() => {
    if (externalRequests) setPending(externalRequests);
  }, [externalRequests]);

  const toggleAutoApprove = useCallback((toolName: string) => {
    setAutoApproveList(prev => {
      const next = new Set(prev);
      if (next.has(toolName)) next.delete(toolName);
      else next.add(toolName);
      return next;
    });
  }, []);

  const handleDecide = useCallback((
    id: string,
    decision: ApprovalDecision,
    params?: Record<string, unknown>,
  ) => {
    const req = pending.find(r => r.id === id);
    if (!req) return;

    const record: ApprovalRecord = {
      id,
      tool_name: req.tool_name,
      decision,
      timestamp: new Date().toISOString(),
      modified_parameters: decision === 'modified' ? params : undefined,
    };

    setHistory(prev => [record, ...prev]);
    setPending(prev => prev.filter(r => r.id !== id));
  }, [pending]);

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-[#f7931a]" aria-hidden="true" />
          <h2 className="heading-display text-base text-[#f7931a]">Tool Approvals</h2>
        </div>
        <div className="flex items-center gap-2">
          {pending.length > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#f7931a] text-black animate-pulse">
              {pending.length} pending
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowHistory(h => !h)}
            aria-label="Toggle approval history"
            aria-pressed={showHistory}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
          >
            <Clock size={12} aria-hidden="true" />
            History ({history.length})
          </button>
        </div>
      </div>

      {/* Auto-approve trusted tools */}
      {showAutoApprove && autoApproveList.size > 0 && (
        <div className="rounded-xl bg-green-500/5 border border-green-500/20 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck size={13} className="text-green-400" aria-hidden="true" />
            <span className="text-xs font-medium text-green-400">Auto-approved tools</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...autoApproveList].map(tool => (
              <button
                key={tool}
                type="button"
                onClick={() => toggleAutoApprove(tool)}
                aria-label={`Remove ${tool} from auto-approve list`}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-[10px] hover:bg-red-500/15 hover:text-red-400 transition-colors"
              >
                <ShieldCheck size={9} aria-hidden="true" />
                {tool}
                <X size={9} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pending approvals */}
      {pending.length === 0 && !showHistory && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-8 text-center">
          <ShieldCheck size={28} className="mx-auto text-slate-700 mb-3" aria-hidden="true" />
          <p className="text-sm text-slate-500">No pending tool calls</p>
          <p className="text-xs text-slate-600 mt-1">Approval requests will appear here when agents need authorization.</p>
        </div>
      )}

      <div className="space-y-3" role="list" aria-label="Pending tool call approvals">
        {pending.map(req => (
          <div key={req.id} role="listitem">
            <ToolCallCard
              request={req}
              autoApproved={autoApproveList.has(req.tool_name)}
              onDecide={handleDecide}
            />
            {showAutoApprove && (
              <div className="mt-1.5 px-1">
                <label className="flex items-center gap-2 cursor-pointer w-fit">
                  <input
                    type="checkbox"
                    checked={autoApproveList.has(req.tool_name)}
                    onChange={() => toggleAutoApprove(req.tool_name)}
                    aria-label={`Auto-approve future calls to ${req.tool_name}`}
                    className="w-3.5 h-3.5 rounded accent-[#f7931a]"
                  />
                  <span className="text-[11px] text-slate-600">
                    Auto-approve future <span className="font-mono text-slate-500">{req.tool_name}</span> calls
                  </span>
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Approval history */}
      {showHistory && history.length > 0 && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
            <Clock size={13} className="text-slate-400" aria-hidden="true" />
            <h3 className="text-sm font-medium text-slate-300">Approval History</h3>
          </div>
          <div className="px-4 divide-y divide-slate-800" role="list" aria-label="Approval history">
            {history.map(record => (
              <div key={record.id} role="listitem">
                <ApprovalHistoryItem record={record} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
