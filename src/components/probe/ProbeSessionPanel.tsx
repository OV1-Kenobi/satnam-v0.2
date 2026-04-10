/**
 * ProbeSessionPanel — Main Probe session monitoring panel
 *
 * Displays:
 * - Session list (active/recent sessions)
 * - Selected session trajectory timeline
 * - Real-time event stream
 * - Session status indicator
 *
 * Data comes from useProbeSession hook (Nostr kind:39230/39231 subscriptions).
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import clsx from 'clsx';
import {
  Activity,
  Terminal,
  Clock,
  Zap,
  MessageSquare,
  Wrench,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Radio,
  Filter,
} from 'lucide-react';

import type { TrajectorySession, TrajectoryEvent, TrajectoryEventType } from '../../lib/probe/types.js';
import { useProbeSession } from '../../hooks/useProbeSession.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(startedAt: number): string {
  const ms = Date.now() - startedAt * 1000;
  const mins = Math.floor(ms / 60000);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m`;
  return '<1m';
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

type SessionStatus = TrajectorySession['status'];

function statusColor(status: SessionStatus): string {
  switch (status) {
    case 'active':     return 'text-green-400';
    case 'paused':     return 'text-yellow-400';
    case 'completed':  return 'text-blue-400';
    case 'failed':     return 'text-red-500';
    default:           return 'text-slate-500';
  }
}

function statusDot(status: SessionStatus): string {
  switch (status) {
    case 'active':     return 'bg-green-400 animate-pulse';
    case 'paused':     return 'bg-yellow-400';
    case 'completed':  return 'bg-blue-400';
    case 'failed':     return 'bg-red-500';
    default:           return 'bg-slate-600';
  }
}

function eventTypeIcon(type: TrajectoryEventType) {
  switch (type) {
    case 'tool_call':     return Wrench;
    case 'tool_approval': return CheckCircle2;
    case 'tool_result':   return CheckCircle2;
    case 'message':       return MessageSquare;
    case 'diff':          return Activity;
    case 'result':        return CheckCircle2;
    case 'error':         return AlertTriangle;
    default:              return Activity;
  }
}

function eventTypeColor(type: TrajectoryEventType): string {
  switch (type) {
    case 'tool_call':     return 'text-blue-400';
    case 'tool_approval': return 'text-green-400';
    case 'tool_result':   return 'text-green-300';
    case 'message':       return 'text-slate-300';
    case 'diff':          return 'text-purple-400';
    case 'result':        return 'text-green-400';
    case 'error':         return 'text-red-400';
    default:              return 'text-slate-400';
  }
}

function eventDotColor(type: TrajectoryEventType): string {
  switch (type) {
    case 'tool_call':     return 'bg-blue-400';
    case 'tool_approval': return 'bg-green-400';
    case 'tool_result':   return 'bg-green-300';
    case 'message':       return 'bg-slate-400';
    case 'diff':          return 'bg-purple-400';
    case 'result':        return 'bg-green-500';
    case 'error':         return 'bg-red-400';
    default:              return 'bg-slate-500';
  }
}

const EVENT_TYPE_LABELS: Record<TrajectoryEventType, string> = {
  message:       'Message',
  tool_call:     'Tool Call',
  tool_approval: 'Tool Approval',
  tool_result:   'Tool Result',
  diff:          'Diff',
  result:        'Result',
  error:         'Error',
};

const ALL_EVENT_TYPES: TrajectoryEventType[] = [
  'message', 'tool_call', 'tool_approval', 'tool_result', 'diff', 'result', 'error',
];

// ---------------------------------------------------------------------------
// SessionListItem
// ---------------------------------------------------------------------------

function SessionListItem({
  session,
  selected,
  onSelect,
}: {
  session: TrajectorySession;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-selected={selected}
      className={clsx(
        'w-full text-left p-3 rounded-xl border transition-all duration-150 group',
        selected
          ? 'bg-[#f7931a]/10 border-[#f7931a]/40'
          : 'bg-slate-900 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50',
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', statusDot(session.status))} aria-hidden="true" />
          <span className="text-xs font-mono text-slate-400 truncate max-w-[140px]">
            {session.sessionId}
          </span>
        </div>
        <span className={clsx('text-[10px] font-medium uppercase tracking-wider', statusColor(session.status))}>
          {session.status}
        </span>
      </div>

      <div className="flex items-center gap-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <Clock size={10} aria-hidden="true" />
          {formatDuration(session.startedAt)}
        </span>
        <span className="flex items-center gap-1">
          <Wrench size={10} aria-hidden="true" />
          {session.metadata['toolCalls'] ?? '—'} calls
        </span>
        <span className="flex items-center gap-1">
          <Zap size={10} aria-hidden="true" />
          {session.metadata['satsCost'] ?? '—'} sats
        </span>
      </div>

      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-slate-600 uppercase tracking-wider">
          {session.metadata['type'] ?? 'probe'}
        </span>
        <ChevronRight size={12} className="text-slate-700 group-hover:text-slate-500 transition-colors" aria-hidden="true" />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// TrajectoryTimeline — vertical dot timeline
// ---------------------------------------------------------------------------

function TrajectoryTimeline({
  events,
  filteredTypes,
}: {
  events: TrajectoryEvent[];
  filteredTypes: Set<TrajectoryEventType>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const visible = events.filter(e => filteredTypes.size === 0 || filteredTypes.has(e.eventType));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  if (visible.length === 0) {
    return (
      <div className="text-center py-8">
        <Activity size={24} className="mx-auto text-slate-700 mb-2" aria-hidden="true" />
        <p className="text-sm text-slate-600">No events to display</p>
      </div>
    );
  }

  return (
    <div
      className="relative pl-6"
      style={{ borderLeft: '2px solid #1e293b' }}
      role="log"
      aria-label="Session event timeline"
      aria-live="polite"
    >
      {visible.map((event, idx) => {
        const Icon = eventTypeIcon(event.eventType);
        const color = eventTypeColor(event.eventType);
        const dot = eventDotColor(event.eventType);
        const label = EVENT_TYPE_LABELS[event.eventType] ?? event.eventType;
        const isLast = idx === visible.length - 1;

        // Derive a unique key from sessionId + timestamp + index
        const key = `${event.sessionId}-${event.timestamp}-${idx}`;

        // Extract tool name from data if it's a tool_call
        let toolName: string | undefined;
        if (event.eventType === 'tool_call' && 'toolName' in event.data) {
          toolName = (event.data as { toolName?: string }).toolName;
        }

        return (
          <div key={key} className="relative mb-4 last:mb-0">
            {/* Dot on timeline */}
            <div
              className={clsx('absolute w-2.5 h-2.5 rounded-full -left-[22px] top-1', dot)}
              aria-hidden="true"
            />

            <div className={clsx(
              'rounded-lg p-2.5 border',
              isLast ? 'border-[#f7931a]/20 bg-[#f7931a]/5' : 'border-slate-800 bg-slate-900/50',
            )}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <Icon size={12} className={color} aria-hidden="true" />
                  <span className={clsx('text-xs font-medium', color)}>{label}</span>
                  {toolName && (
                    <span className="text-[10px] text-slate-500 font-mono">
                      {toolName}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-slate-600 font-mono">
                  {formatTimestamp(event.timestamp)}
                </span>
              </div>

              {/* Event details */}
              {event.data && Object.keys(event.data).length > 0 && (
                <p className="text-[11px] text-slate-500 truncate">
                  {JSON.stringify(event.data).slice(0, 80)}
                </p>
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionDetail — right/bottom panel when a session is selected
// ---------------------------------------------------------------------------

function SessionDetail({
  session,
  events,
}: {
  session: TrajectorySession;
  events: TrajectoryEvent[];
}) {
  const [filteredTypes, setFilteredTypes] = useState<Set<TrajectoryEventType>>(new Set());
  const [showFilter, setShowFilter] = useState(false);

  const toggleType = useCallback((type: TrajectoryEventType) => {
    setFilteredTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  return (
    <div className="space-y-4">
      {/* Session header */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={clsx('w-2.5 h-2.5 rounded-full', statusDot(session.status))} aria-hidden="true" />
              <span className={clsx('text-sm font-medium', statusColor(session.status))}>
                {session.status}
              </span>
            </div>
            <p className="font-mono text-xs text-slate-400 break-all">{session.sessionId}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">{session.metadata['type'] ?? 'probe'}</p>
            <p className="text-[10px] text-slate-600">{session.metadata['channel'] ?? 'nostr'}</p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Duration', value: formatDuration(session.startedAt), Icon: Clock },
            { label: 'Messages', value: session.metadata['messages'] ?? 0, Icon: MessageSquare },
            { label: 'Tool Calls', value: session.metadata['toolCalls'] ?? 0, Icon: Wrench },
            { label: 'Sats Spent', value: `${session.metadata['satsCost'] ?? 0}`, Icon: Zap },
          ].map(({ label, value, Icon }) => (
            <div key={label} className="text-center">
              <Icon size={12} className="mx-auto text-slate-600 mb-1" aria-hidden="true" />
              <p className="text-sm font-mono font-bold text-slate-200">{value}</p>
              <p className="text-[10px] text-slate-600">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Event stream */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Radio size={13} className="text-[#f7931a]" aria-hidden="true" />
            <h3 className="text-sm font-medium text-slate-300">Event Stream</h3>
            <span className="text-[10px] text-slate-600 bg-slate-800 px-1.5 py-0.5 rounded">
              {events.length} events
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowFilter(f => !f)}
            aria-label="Toggle event type filter"
            aria-expanded={showFilter}
            className={clsx(
              'flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors',
              showFilter
                ? 'bg-[#f7931a]/20 text-[#f7931a]'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800',
            )}
          >
            <Filter size={11} />
            Filter
            {filteredTypes.size > 0 && (
              <span className="bg-[#f7931a] text-black text-[9px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold">
                {filteredTypes.size}
              </span>
            )}
          </button>
        </div>

        {/* Filter chips */}
        {showFilter && (
          <div className="px-4 py-2.5 border-b border-slate-800 flex flex-wrap gap-1.5">
            {ALL_EVENT_TYPES.map(type => {
              const active = filteredTypes.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  aria-pressed={active}
                  className={clsx(
                    'px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors',
                    active
                      ? 'bg-[#f7931a] text-black border-[#f7931a]'
                      : 'border-slate-700 text-slate-500 hover:border-slate-500',
                  )}
                >
                  {EVENT_TYPE_LABELS[type] ?? type}
                </button>
              );
            })}
          </div>
        )}

        <div className="p-4 max-h-80 overflow-y-auto">
          <TrajectoryTimeline events={events} filteredTypes={filteredTypes} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProbeSessionPanel — main export
// ---------------------------------------------------------------------------

export interface ProbeSessionPanelProps {
  className?: string;
}

export default function ProbeSessionPanel({ className }: ProbeSessionPanelProps) {
  const { sessions, activeSession, trajectory, subscribeSession } = useProbeSession();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedSession = sessions.find(s => s.sessionId === selectedId) ?? null;
  const sessionEvents: TrajectoryEvent[] = selectedId === activeSession?.sessionId
    ? trajectory
    : [];

  const handleSelect = useCallback((sessionId: string) => {
    setSelectedId(sessionId);
    subscribeSession(sessionId);
  }, [subscribeSession]);

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-[#f7931a]" aria-hidden="true" />
          <h2 className="heading-display text-base text-[#f7931a]">Probe Sessions</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {activeSession && (
            <span className="flex items-center gap-1 text-[10px] text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" aria-hidden="true" />
              Live
            </span>
          )}
          <span className="text-xs text-slate-500">{sessions.length} sessions</span>
        </div>
      </div>

      {/* Empty state */}
      {sessions.length === 0 && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-8 text-center">
          <Terminal size={28} className="mx-auto text-slate-700 mb-3" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-400 mb-1">No Active Sessions</p>
          <p className="text-xs text-slate-600">Probe sessions will appear here when agents start executing tasks.</p>
        </div>
      )}

      {/* Two-pane layout: session list + detail */}
      {sessions.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Session list */}
          <div
            className="lg:col-span-2 space-y-2"
            role="listbox"
            aria-label="Session list"
          >
            {sessions.map(session => (
              <SessionListItem
                key={session.sessionId}
                session={session}
                selected={selectedId === session.sessionId}
                onSelect={() => handleSelect(session.sessionId)}
              />
            ))}
          </div>

          {/* Session detail */}
          <div className="lg:col-span-3">
            {selectedSession ? (
              <SessionDetail session={selectedSession} events={sessionEvents} />
            ) : (
              <div className="rounded-xl bg-slate-900 border border-slate-800 p-8 text-center h-full flex flex-col items-center justify-center">
                <ChevronRight size={24} className="text-slate-700 mb-2" aria-hidden="true" />
                <p className="text-sm text-slate-600">Select a session to inspect</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
