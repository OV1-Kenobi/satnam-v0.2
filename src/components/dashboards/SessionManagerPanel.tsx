/**
 * SessionManagerPanel — Agent session manager dashboard
 *
 * Features:
 * - Active session list with status
 * - Session timeline (events plotted on horizontal timeline)
 * - Pause/Resume/Terminate controls
 * - Session event log (filterable by event type)
 * - Channel indicator (nostr/web_ui/api)
 *
 * Data from Nostr kind:39230/39231 events via hooks.
 */

import { useState, useCallback } from 'react';
import clsx from 'clsx';
import {
  Layers,
  Play,
  Pause,
  StopCircle,
  Clock,
  Zap,
  MessageSquare,
  Wrench,
  Activity,
  ChevronDown,
  ChevronUp,
  Radio,
  Wifi,
  Globe,
  Terminal,
} from 'lucide-react';

import type {
  ActiveSessionSummary,
  SessionEventTimeline,
  SessionChannel,
  SessionEventType,
  SessionStatus,
} from '../../lib/agent/session/types.js';
import { useProbeSession } from '../../hooks/useProbeSession.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatRelative(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

const CHANNEL_CONFIG: Record<SessionChannel, { Icon: typeof Radio; label: string; cls: string }> = {
  nostr:    { Icon: Radio,    label: 'Nostr',   cls: 'text-purple-400' },
  telegram: { Icon: MessageSquare, label: 'Telegram', cls: 'text-blue-400' },
  web_ui:   { Icon: Globe,    label: 'Web UI',  cls: 'text-green-400' },
  api:      { Icon: Wifi,     label: 'API',     cls: 'text-[#f7931a]' },
  cli:      { Icon: Terminal, label: 'CLI',     cls: 'text-slate-400' },
};

const STATUS_CONFIG: Record<SessionStatus, { dot: string; cls: string }> = {
  ACTIVE:     { dot: 'bg-green-400 animate-pulse', cls: 'text-green-400' },
  PAUSED:     { dot: 'bg-yellow-400',              cls: 'text-yellow-400' },
  HIBERNATED: { dot: 'bg-blue-400',                cls: 'text-blue-400' },
  TERMINATED: { dot: 'bg-slate-600',               cls: 'text-slate-500' },
};

const EVENT_COLORS: Partial<Record<SessionEventType, string>> = {
  MESSAGE:          'bg-slate-400',
  TOOL_CALL:        'bg-blue-400',
  TASK_COMPLETION:  'bg-green-400',
  TASK_FAILURE:     'bg-red-400',
  ERROR:            'bg-red-500',
  WARNING:          'bg-yellow-400',
  DELEGATION:       'bg-purple-400',
  SESSION_PAUSED:   'bg-yellow-500',
  SESSION_RESUMED:  'bg-green-500',
  SESSION_TERMINATED:'bg-slate-500',
  INTERRUPTION:     'bg-orange-400',
  CONTEXT_REFRESH:  'bg-teal-400',
};

const EVENT_TYPE_LABELS: Partial<Record<SessionEventType, string>> = {
  MESSAGE:           'Message',
  TOOL_CALL:         'Tool Call',
  CONTEXT_REFRESH:   'Refresh',
  INTERRUPTION:      'Interrupt',
  DELEGATION:        'Delegation',
  TASK_ASSIGNMENT:   'Assigned',
  TASK_COMPLETION:   'Complete',
  TASK_FAILURE:      'Failed',
  STATE_SNAPSHOT:    'Snapshot',
  CHANNEL_SWITCH:    'Switch',
  SESSION_PAUSED:    'Paused',
  SESSION_RESUMED:   'Resumed',
  SESSION_TERMINATED:'Terminated',
  ERROR:             'Error',
  WARNING:           'Warning',
  INFO:              'Info',
  CONFLICT_DETECTED: 'Conflict',
};

const FILTERABLE_EVENT_TYPES: SessionEventType[] = [
  'MESSAGE', 'TOOL_CALL', 'TASK_COMPLETION', 'TASK_FAILURE',
  'ERROR', 'WARNING', 'DELEGATION', 'CONTEXT_REFRESH', 'SESSION_PAUSED',
];

// ---------------------------------------------------------------------------
// HorizontalTimeline — CSS-only horizontal event timeline
// ---------------------------------------------------------------------------

function HorizontalTimeline({
  events,
  sessionStarted,
}: {
  events: SessionEventTimeline[];
  sessionStarted: string;
}) {
  if (events.length === 0) {
    return (
      <div className="h-12 flex items-center justify-center text-xs text-slate-600">
        No events yet
      </div>
    );
  }

  const startMs = new Date(sessionStarted).getTime();
  const endMs   = Math.max(Date.now(), new Date(events[events.length - 1].created_at).getTime());
  const spanMs  = endMs - startMs || 1;

  return (
    <div
      className="relative h-8 mx-4"
      role="img"
      aria-label="Session event timeline"
    >
      {/* Timeline bar */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-slate-800" aria-hidden="true" />

      {/* Event dots */}
      {events.map((event) => {
        const eventMs = new Date(event.created_at).getTime();
        const leftPct = Math.min(98, Math.max(1, ((eventMs - startMs) / spanMs) * 100));
        const dotCls  = EVENT_COLORS[event.event_type] ?? 'bg-slate-500';

        return (
          <div
            key={event.event_id}
            className="absolute top-1/2 -translate-y-1/2 group"
            style={{ left: `${leftPct}%` }}
          >
            <div
              className={clsx('w-2 h-2 rounded-full -translate-x-1/2 cursor-default', dotCls)}
              aria-label={`${EVENT_TYPE_LABELS[event.event_type] ?? event.event_type} at ${event.minutes_ago}m ago`}
            />
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              {EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}
              <br />
              {event.minutes_ago}m ago
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionCard — single session with controls
// ---------------------------------------------------------------------------

function SessionCard({
  session,
  events,
  onAction,
}: {
  session: ActiveSessionSummary;
  events: SessionEventTimeline[];
  onAction: (sessionId: string, action: 'pause' | 'resume' | 'terminate') => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const statusCfg = STATUS_CONFIG[session.status];
  const channelCfg = CHANNEL_CONFIG[session.channel ?? session.primary_channel ?? 'nostr'];

  const handleAction = useCallback(async (action: 'pause' | 'resume' | 'terminate') => {
    setActing(action);
    try {
      await onAction(session.session_id);
    } finally {
      setActing(null);
    }
  }, [session.session_id, onAction]);

  return (
    <div
      className={clsx(
        'rounded-xl border overflow-hidden transition-all',
        session.status === 'ACTIVE' ? 'border-[#f7931a]/20' : 'border-slate-800',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-slate-900">
        <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', statusCfg.dot)} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-slate-400 truncate">{session.session_id}</p>
          <p className="text-[10px] text-slate-600">{session.agent_name}</p>
        </div>

        {/* Channel */}
        <div className={clsx('flex items-center gap-1 text-[10px]', channelCfg.cls)}>
          <channelCfg.Icon size={11} aria-hidden="true" />
          <span className="hidden sm:inline">{channelCfg.label}</span>
        </div>

        {/* Status */}
        <span className={clsx('text-[10px] font-medium uppercase tracking-wider px-1.5', statusCfg.cls)}>
          {session.status}
        </span>

        {/* Expand */}
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-label={expanded ? 'Collapse session' : 'Expand session'}
          aria-expanded={expanded}
          className="p-1 text-slate-600 hover:text-slate-400 transition-colors"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-4 gap-0 border-t border-slate-800">
        {[
          { label: 'Duration', value: formatDuration(session.duration_minutes), Icon: Clock },
          { label: 'Messages', value: session.total_messages, Icon: MessageSquare },
          { label: 'Tools', value: session.total_tool_calls, Icon: Wrench },
          { label: 'Sats', value: session.total_sats_cost, Icon: Zap },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="text-center py-2 border-r border-slate-800 last:border-0">
            <Icon size={11} className="mx-auto text-slate-600 mb-0.5" aria-hidden="true" />
            <p className="text-xs font-mono text-slate-300">{value}</p>
            <p className="text-[9px] text-slate-700">{label}</p>
          </div>
        ))}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-slate-800">
          {/* Horizontal timeline */}
          <div className="py-3 border-b border-slate-800">
            <p className="text-[10px] text-slate-600 px-4 mb-1">Timeline</p>
            <HorizontalTimeline
              events={events}
              sessionStarted={session.started_at}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 px-4 py-3">
            {session.status === 'ACTIVE' ? (
              <button
                type="button"
                onClick={() => handleAction('pause')}
                disabled={acting !== null}
                aria-label={`Pause session ${session.session_id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
              >
                <Pause size={12} aria-hidden="true" />
                {acting === 'pause' ? 'Pausing…' : 'Pause'}
              </button>
            ) : session.status === 'PAUSED' ? (
              <button
                type="button"
                onClick={() => handleAction('resume')}
                disabled={acting !== null}
                aria-label={`Resume session ${session.session_id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20 transition-colors disabled:opacity-50"
              >
                <Play size={12} aria-hidden="true" />
                {acting === 'resume' ? 'Resuming…' : 'Resume'}
              </button>
            ) : null}

            {session.status !== 'TERMINATED' && (
              <button
                type="button"
                onClick={() => handleAction('terminate')}
                disabled={acting !== null}
                aria-label={`Terminate session ${session.session_id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                <StopCircle size={12} aria-hidden="true" />
                {acting === 'terminate' ? 'Terminating…' : 'Terminate'}
              </button>
            )}

            {/* Load indicator */}
            <div className="ml-auto flex items-center gap-1 text-[10px] text-slate-600">
              <Activity size={11} aria-hidden="true" />
              {session.current_compute_load_percent}% CPU
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EventLogRow
// ---------------------------------------------------------------------------

function EventLogRow({ event }: { event: SessionEventTimeline }) {
  const dotCls = EVENT_COLORS[event.event_type] ?? 'bg-slate-500';
  const label = EVENT_TYPE_LABELS[event.event_type] ?? event.event_type;

  return (
    <div className="flex items-start gap-2 py-2 border-b border-slate-800/50 last:border-0 group">
      <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5', dotCls)} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-300">{label}</span>
          {event.tool_name && (
            <span className="text-[10px] font-mono text-slate-500">{event.tool_name}</span>
          )}
          {event.sats_cost > 0 && (
            <span className="text-[10px] text-[#f7931a] flex items-center gap-0.5">
              <Zap size={9} aria-hidden="true" />
              {event.sats_cost}
            </span>
          )}
        </div>
        {event.event_data_summary && (
          <p className="text-[10px] text-slate-600 truncate mt-0.5">{event.event_data_summary}</p>
        )}
      </div>
      <span className="text-[10px] text-slate-700 flex-shrink-0">
        {event.minutes_ago}m ago
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionManagerPanel — main export
// ---------------------------------------------------------------------------

export interface SessionManagerPanelProps {
  agentId?: string;
  className?: string;
}

export default function SessionManagerPanel({
  className,
}: SessionManagerPanelProps) {
  const { sessions, trajectory, subscribeSession } = useProbeSession();
  const [filterType, setFilterType] = useState<SessionEventType | 'ALL'>('ALL');
  const [showLog, setShowLog] = useState(false);

  // Cast sessions to ActiveSessionSummary for display (hook returns AgentSession)
  const activeSessions = sessions;

  const allEvents: SessionEventTimeline[] = trajectory.map(e => ({
    event_id: e.id,
    session_id: e.session_id,
    agent_id: '',
    agent_name: '',
    creator_id: null,
    session_status: 'ACTIVE' as const,
    channel: 'nostr' as const,
    event_type: e.event_type,
    event_data_summary: JSON.stringify(e.event_data).slice(0, 60),
    sats_cost: e.sats_cost,
    input_tokens: e.input_tokens,
    output_tokens: e.output_tokens,
    total_tokens: e.input_tokens + e.output_tokens,
    tool_name: e.tool_name,
    tool_parameters: e.tool_parameters,
    created_at: e.timestamp,
    minutes_ago: Math.floor((Date.now() - new Date(e.timestamp).getTime()) / 60000),
  }));

  const filteredEvents = filterType === 'ALL'
    ? allEvents
    : allEvents.filter(e => e.event_type === filterType);

  const handleAction = useCallback(async (
    sessionId: string,
    _action: 'pause' | 'resume' | 'terminate',
  ) => {
    // In production, dispatch NIP-17 encrypted DM to agent with action
    // For now: subscribe to get latest state
    subscribeSession(sessionId);
  }, [subscribeSession]);

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-[#f7931a]" aria-hidden="true" />
          <h2 className="heading-display text-base text-[#f7931a]">Session Manager</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{activeSessions.length} sessions</span>
          <button
            type="button"
            onClick={() => setShowLog(s => !s)}
            aria-label={showLog ? 'Hide event log' : 'Show event log'}
            aria-pressed={showLog}
            className={clsx(
              'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-colors',
              showLog
                ? 'bg-[#f7931a]/20 text-[#f7931a]'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800',
            )}
          >
            <Activity size={12} aria-hidden="true" />
            Events
          </button>
        </div>
      </div>

      {/* Empty state */}
      {activeSessions.length === 0 && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-8 text-center">
          <Layers size={28} className="mx-auto text-slate-700 mb-3" aria-hidden="true" />
          <p className="text-sm text-slate-500">No active sessions</p>
          <p className="text-xs text-slate-600 mt-1">Sessions appear here when agents start executing tasks.</p>
        </div>
      )}

      {/* Session list */}
      <div className="space-y-3" role="list" aria-label="Active sessions">
        {activeSessions.map(session => (
          <div key={session.session_id} role="listitem">
            <SessionCard
              session={{
                session_id: session.session_id,
                agent_id: session.agent_id,
                agent_name: session.agent_id.slice(0, 8),
                creator_id: session.human_creator_id,
                status: session.status,
                channel: session.primary_channel,
                primary_channel: session.primary_channel,
                session_type: session.session_type,
                total_messages: session.total_messages,
                total_tool_calls: session.total_tool_calls,
                total_tokens: session.tokens_consumed,
                total_sats_cost: session.sats_spent,
                started_at: session.started_at,
                last_activity_at: session.last_activity_at,
                duration_minutes: Math.floor(
                  (Date.now() - new Date(session.started_at).getTime()) / 60000,
                ),
                last_activity_ago_minutes: Math.floor(
                  (Date.now() - new Date(session.last_activity_at).getTime()) / 60000,
                ),
                auto_hibernate_remaining_minutes: null,
                avg_response_time_ms: 0,
                error_count: 0,
                warning_count: 0,
                current_compute_load_percent: 0,
                active_task_count: 0,
                available_budget_sats: 0,
                accepts_new_tasks: session.status === 'ACTIVE',
              }}
              events={allEvents.filter(e => e.session_id === session.session_id)}
              onAction={handleAction}
            />
          </div>
        ))}
      </div>

      {/* Event log */}
      {showLog && (
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 flex-wrap gap-y-2">
            <Activity size={13} className="text-[#f7931a]" aria-hidden="true" />
            <h3 className="text-sm font-medium text-slate-300">Event Log</h3>
            <span className="text-[10px] text-slate-600">
              {filteredEvents.length} events
            </span>

            {/* Filter */}
            <div className="ml-auto flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setFilterType('ALL')}
                aria-pressed={filterType === 'ALL'}
                className={clsx(
                  'px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors',
                  filterType === 'ALL'
                    ? 'bg-[#f7931a] text-black border-[#f7931a]'
                    : 'border-slate-700 text-slate-500 hover:border-slate-500',
                )}
              >
                All
              </button>
              {FILTERABLE_EVENT_TYPES.map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFilterType(type)}
                  aria-pressed={filterType === type}
                  className={clsx(
                    'px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors',
                    filterType === type
                      ? 'bg-[#f7931a] text-black border-[#f7931a]'
                      : 'border-slate-700 text-slate-500 hover:border-slate-500',
                  )}
                >
                  {EVENT_TYPE_LABELS[type] ?? type}
                </button>
              ))}
            </div>
          </div>

          <div
            className="divide-y divide-slate-800/50 px-4 max-h-80 overflow-y-auto"
            role="log"
            aria-label="Session event log"
            aria-live="polite"
          >
            {filteredEvents.length > 0 ? (
              filteredEvents.map(event => (
                <EventLogRow key={event.event_id} event={event} />
              ))
            ) : (
              <div className="py-8 text-center">
                <Activity size={20} className="mx-auto text-slate-700 mb-2" aria-hidden="true" />
                <p className="text-xs text-slate-600">
                  {filterType === 'ALL' ? 'No events recorded' : `No ${EVENT_TYPE_LABELS[filterType as SessionEventType] ?? filterType} events`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


