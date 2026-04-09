/**
 * AgentCard — Individual agent display card
 * Phase 3: NIP-SA agent management
 *
 * Displays:
 * - Agent name, avatar, autonomy badge
 * - Status indicator (idle/active/paused/error)
 * - Enabled skills (as tags/chips)
 * - Wallet balance + daily spend
 * - Last heartbeat timestamp
 * - Quick actions: pause, edit, deactivate
 */

import React from 'react';
import clsx from 'clsx';
import {
  User,
  Pause,
  Play,
  Settings,
  AlertTriangle,
  Heart,
  Zap,
  BookOpen,
} from 'lucide-react';
import type { AgentViewModel } from '../../hooks/useAgentProfile.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentCardProps {
  agent: AgentViewModel;
  onSelect?: () => void;
  onPause?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDeactivate?: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSats(sats: number): string {
  return sats.toLocaleString();
}

function formatHeartbeat(timestamp?: number): string {
  if (!timestamp) return 'Never';
  const diff = Date.now() / 1000 - timestamp;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function statusBadgeClass(status: AgentViewModel['status']): string {
  switch (status) {
    case 'working': return 'bg-green-600 text-white';
    case 'idle': return 'bg-slate-600 text-slate-200';
    case 'paused': return 'bg-yellow-600 text-white';
    case 'error': return 'bg-red-600 text-white';
    case 'terminated': return 'bg-slate-800 text-slate-400';
  }
}

function statusDotClass(status: AgentViewModel['status']): string {
  switch (status) {
    case 'working': return 'bg-green-500';
    case 'idle': return 'bg-slate-500';
    case 'paused': return 'bg-yellow-500';
    case 'error': return 'bg-red-500';
    case 'terminated': return 'bg-slate-600';
  }
}

function autonomyBadgeClass(autonomy: AgentViewModel['autonomy']): string {
  switch (autonomy) {
    case 'autonomous': return 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30';
    case 'supervised': return 'bg-[#f7931a]/20 text-[#f7931a] border-[#f7931a]/30';
    default: return 'bg-blue-600/20 text-blue-400 border-blue-600/30';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AgentCard({
  agent,
  onSelect,
  onPause,
  onEdit,
  onDeactivate,
}: AgentCardProps) {
  const isPaused = agent.status === 'paused';
  const isTerminated = agent.status === 'terminated';

  const handlePauseResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    onPause?.(agent.id);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(agent.id);
  };

  const handleDeactivate = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDeactivate?.(agent.id);
  };

  return (
    <article
      className={clsx(
        'card transition-all duration-150',
        onSelect && !isTerminated && 'cursor-pointer hover:border-[#f7931a]/40 active:scale-[0.99]',
        isTerminated && 'opacity-60',
      )}
      onClick={onSelect && !isTerminated ? onSelect : undefined}
      aria-label={`Agent ${agent.name}, status ${agent.status}`}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 mb-4">
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          {agent.picture ? (
            <img
              src={agent.picture}
              alt={`${agent.name} avatar`}
              className="w-10 h-10 rounded-full object-cover border border-[#2a2a2a]"
              onError={e => {
                const el = e.target as HTMLImageElement;
                el.style.display = 'none';
                el.nextElementSibling?.classList.remove('hidden');
              }}
            />
          ) : null}
          <div
            className={clsx(
              'w-10 h-10 rounded-full bg-[#f7931a]/20 border border-[#f7931a]/30 flex items-center justify-center',
              agent.picture && 'hidden',
            )}
            aria-hidden="true"
          >
            <User size={18} className="text-[#f7931a]" />
          </div>
          {/* Status dot */}
          <span
            className={clsx(
              'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#111111]',
              statusDotClass(agent.status),
            )}
            aria-hidden="true"
          />
        </div>

        {/* Name + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-[#f7931a] tracking-wide truncate">{agent.name}</h3>
            <span
              className={clsx(
                'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border',
                autonomyBadgeClass(agent.autonomy),
              )}
            >
              {agent.autonomy}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={clsx(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
                statusBadgeClass(agent.status),
              )}
            >
              <span className={clsx('w-1.5 h-1.5 rounded-full', statusDotClass(agent.status))} aria-hidden="true" />
              {agent.status}
            </span>
          </div>
        </div>
      </div>

      {/* Skills chips */}
      {agent.skills.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mb-4" aria-label="Enabled skills">
          <BookOpen size={12} className="text-[#555555]" />
          {agent.skills.slice(0, 4).map((skill: string) => (
            <span
              key={skill}
              className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-medium"
            >
              {skill}
            </span>
          ))}
          {agent.skills.length > 4 && (
            <span className="text-[10px] text-[#555555]">+{agent.skills.length - 4} more</span>
          )}
        </div>
      )}

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2 mb-4 pt-3 border-t border-[#2a2a2a]">
        <div>
          <div className="flex items-center gap-1 mb-0.5">
            <Zap size={10} className="text-[#f7931a]" />
            <span className="text-[10px] text-[#555555] uppercase tracking-widest">Balance</span>
          </div>
          <p className="font-mono text-sm font-bold text-[#f5f5f5]">
            {formatSats(agent.balanceSats)} <span className="text-[10px] text-[#555555]">sats</span>
          </p>
        </div>
        <div>
          <div className="flex items-center gap-1 mb-0.5">
            <Zap size={10} className="text-yellow-500" />
            <span className="text-[10px] text-[#555555] uppercase tracking-widest">Today</span>
          </div>
          <p className="font-mono text-sm font-bold text-[#f5f5f5]">
            {formatSats(agent.dailySpendSats)} <span className="text-[10px] text-[#555555]">sats</span>
          </p>
        </div>
        <div>
          <div className="flex items-center gap-1 mb-0.5">
            <Heart size={10} className="text-green-500" />
            <span className="text-[10px] text-[#555555] uppercase tracking-widest">Heartbeat</span>
          </div>
          <p className="text-sm text-[#a0a0a0]">{formatHeartbeat(agent.lastHeartbeat)}</p>
        </div>
      </div>

      {/* Actions */}
      {!isTerminated && (
        <div className="flex gap-2" role="group" aria-label="Agent actions">
          <button
            type="button"
            onClick={handlePauseResume}
            aria-label={isPaused ? `Resume agent ${agent.name}` : `Pause agent ${agent.name}`}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition-colors"
          >
            {isPaused ? <Play size={13} /> : <Pause size={13} />}
            {isPaused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            onClick={handleEdit}
            aria-label={`Edit agent ${agent.name}`}
            className="flex items-center justify-center px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition-colors"
          >
            <Settings size={13} />
          </button>
          <button
            type="button"
            onClick={handleDeactivate}
            aria-label={`Deactivate agent ${agent.name}`}
            className="flex items-center justify-center px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-red-900/50 text-slate-400 hover:text-red-400 text-xs transition-colors"
          >
            <AlertTriangle size={13} />
          </button>
        </div>
      )}
    </article>
  );
}

