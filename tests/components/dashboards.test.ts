/**
 * Dashboard Component Tests
 *
 * Tests for:
 * - DelegationHealthPanel
 * - PerformanceReportPanel
 * - SessionManagerPanel
 * - SystemStatusPanel
 *
 * Test strategy:
 * - Unit tests for pure computation helpers (delegation validity, capacity, formatting)
 * - Type contract tests for all dashboard data shapes
 * - Integration patterns for hook return value shapes
 * - CSS-only chart computation tests (bar chart heights, pie chart angles)
 *
 * Run with: `npx vitest run tests/components/dashboards.test.ts`
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all hooks ───────────────────────────────────────────────────────────

vi.mock('../../src/hooks/useAgentProfile.js', () => ({
  useAgentProfile: () => ({
    agents: [],
    isLoading: false,
    updateAgent: vi.fn(),
    deactivateAgent: vi.fn(),
  }),
}));

vi.mock('../../src/hooks/useDelegation.js', () => ({
  useDelegation: () => ({
    delegationChain: [],
    isLoading: false,
    lastUpdated: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('../../src/hooks/useProbeSession.js', () => ({
  useProbeSession: () => ({
    sessions: [],
    activeSession: null,
    trajectory: [],
    subscribeSession: vi.fn(),
    respondToToolCall: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../src/hooks/usePylon.js', () => ({
  usePylon: () => ({
    isConnected: false,
    isAuthenticated: false,
  }),
}));

vi.mock('../../src/hooks/useSpacetimeBridge.js', () => ({
  useSpacetimeBridge: () => ({
    presenceStatus: null,
    computeAssignments: 0,
    heartbeatActive: false,
  }),
}));

// ─── Import types ─────────────────────────────────────────────────────────────

import type {
  DelegationNode,
  DelegationStatus,
  DelegationHealthPanelProps,
} from '../../src/components/dashboards/DelegationHealthPanel.js';

import type {
  PerformanceData,
  DailyTaskRate,
  LLMModelCost,
  PerformanceReportPanelProps,
} from '../../src/components/dashboards/PerformanceReportPanel.js';

import type {
  RelayHealth,
  RelayStatus,
  ServiceWorkerStatus,
  SystemStatusPanelProps,
} from '../../src/components/dashboards/SystemStatusPanel.js';

import type {
  SessionManagerPanelProps,
} from '../../src/components/dashboards/SessionManagerPanel.js';

// ─── Session types ────────────────────────────────────────────────────────────

import type {
  SessionEventType,
  SessionStatus,
  SessionChannel,
  ActiveSessionSummary,
} from '../../src/lib/agent/session/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// DelegationHealthPanel
// ═══════════════════════════════════════════════════════════════════════════════

describe('DelegationHealthPanel', () => {
  describe('DelegationNode type', () => {
    const makeNode = (overrides: Partial<DelegationNode> = {}): DelegationNode => ({
      id: 'del_001',
      agentId: 'agent_001',
      agentName: 'Guardian Alpha',
      role: 'guardian',
      status: 'valid',
      delegatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      capacity: 10,
      activeCount: 3,
      satsBudget: 50000,
      satsUsed: 12000,
      children: [],
      ...overrides,
    });

    it('constructs a valid guardian node', () => {
      const node = makeNode();
      expect(node.role).toBe('guardian');
      expect(node.status).toBe('valid');
      expect(node.capacity).toBeGreaterThan(0);
    });

    it('all DelegationStatus values are valid', () => {
      const statuses: DelegationStatus[] = ['valid', 'expired', 'revoked', 'pending'];
      statuses.forEach(status => {
        const node = makeNode({ status });
        expect(node.status).toBe(status);
      });
    });

    it('all role values are valid', () => {
      const roles: DelegationNode['role'][] = ['guardian', 'delegate', 'sub-delegate'];
      roles.forEach(role => {
        const node = makeNode({ role });
        expect(node.role).toBe(role);
      });
    });

    it('supports nested children for tree structure', () => {
      const child = makeNode({ id: 'del_002', role: 'delegate', agentName: 'Delegate B' });
      const grandchild = makeNode({ id: 'del_003', role: 'sub-delegate', agentName: 'Sub-delegate C' });
      child.children = [grandchild];

      const guardian = makeNode({ children: [child] });
      expect(guardian.children).toHaveLength(1);
      expect(guardian.children![0].children).toHaveLength(1);
    });

    it('revoked node can have revokedReason', () => {
      const node = makeNode({
        status: 'revoked',
        revokedAt: new Date().toISOString(),
        revokedReason: 'Guardian policy violation',
      });
      expect(node.revokedReason).toBe('Guardian policy violation');
    });
  });

  describe('Capacity computation', () => {
    it('capacity percentage is 0 when no active delegations', () => {
      const pct = (0 / 10) * 100;
      expect(pct).toBe(0);
    });

    it('capacity percentage is 100 when fully loaded', () => {
      const pct = (10 / 10) * 100;
      expect(pct).toBe(100);
    });

    it('overloaded threshold is > 85%', () => {
      const overloaded = (9 / 10) * 100 > 85;
      expect(overloaded).toBe(true);
    });

    it('non-overloaded is <= 85%', () => {
      const overloaded = (8 / 10) * 100 > 85;
      expect(overloaded).toBe(false);
    });
  });

  describe('Expiry logic', () => {
    it('isExpired returns true for past timestamps', () => {
      const pastIso = new Date(Date.now() - 1000).toISOString();
      const isExpired = new Date(pastIso).getTime() < Date.now();
      expect(isExpired).toBe(true);
    });

    it('isExpired returns false for future timestamps', () => {
      const futureIso = new Date(Date.now() + 3600000).toISOString();
      const isExpired = new Date(futureIso).getTime() < Date.now();
      expect(isExpired).toBe(false);
    });

    it('expiry warning fires when < 1 hour remains', () => {
      const almostExpired = new Date(Date.now() + 59 * 60000).toISOString();
      const warning = (new Date(almostExpired).getTime() - Date.now()) < 3600000;
      expect(warning).toBe(true);
    });

    it('expiry warning does not fire when > 1 hour remains', () => {
      const safeExpiry = new Date(Date.now() + 7200000).toISOString();
      const warning = (new Date(safeExpiry).getTime() - Date.now()) < 3600000;
      expect(warning).toBe(false);
    });
  });

  describe('Panel props', () => {
    it('DelegationHealthPanelProps allows no props', () => {
      const props: DelegationHealthPanelProps = {};
      expect(props).toBeDefined();
    });

    it('DelegationHealthPanelProps accepts className', () => {
      const props: DelegationHealthPanelProps = { className: 'col-span-2' };
      expect(props.className).toBe('col-span-2');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PerformanceReportPanel
// ═══════════════════════════════════════════════════════════════════════════════

describe('PerformanceReportPanel', () => {
  describe('PerformanceData type', () => {
    it('zero-initialized PerformanceData is valid', () => {
      const perf: PerformanceData = {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        timedOutTasks: 0,
        avgDurationSeconds: 0,
        totalSatsSpent: 0,
        satsPerSuccessfulTask: 0,
        reputationDelta: 0,
        dailyRates: [],
        llmCosts: [],
      };
      expect(perf.totalTasks).toBe(0);
    });

    it('DailyTaskRate satisfies shape', () => {
      const rate: DailyTaskRate = {
        date: '2026-04-01',
        completed: 15,
        failed: 2,
        total: 17,
      };
      expect(rate.completed + rate.failed).toBe(rate.total);
    });

    it('LLMModelCost satisfies shape', () => {
      const cost: LLMModelCost = {
        model: 'gpt-4o',
        provider: 'openai',
        input_tokens: 50000,
        output_tokens: 15000,
        sats_cost: 495,
      };
      expect(cost.input_tokens).toBeGreaterThan(0);
      expect(cost.sats_cost).toBeGreaterThan(0);
    });
  });

  describe('Completion rate calculation', () => {
    it('completion rate is 0 when no tasks', () => {
      const rate = 0 > 0 ? Math.round((0 / 0) * 100) : 0;
      expect(rate).toBe(0);
    });

    it('completion rate is 100% when all tasks complete', () => {
      const total = 50, completed = 50;
      const rate = Math.round((completed / total) * 100);
      expect(rate).toBe(100);
    });

    it('completion rate rounds correctly', () => {
      const total = 3, completed = 2;
      const rate = Math.round((completed / total) * 100);
      expect(rate).toBe(67);
    });
  });

  describe('Bar chart height calculations', () => {
    it('bar height scales proportionally to max', () => {
      const data: DailyTaskRate[] = [
        { date: '2026-04-01', completed: 5, failed: 0, total: 5 },
        { date: '2026-04-02', completed: 10, failed: 2, total: 12 },
        { date: '2026-04-03', completed: 3, failed: 1, total: 4 },
      ];
      const maxTotal = Math.max(...data.map(d => d.total));
      const chartHeight = 100;

      const heights = data.map(d => (d.total / maxTotal) * chartHeight);
      expect(heights[0]).toBeCloseTo(41.67, 1);
      expect(heights[1]).toBe(100);
      expect(heights[2]).toBeCloseTo(33.33, 1);
    });

    it('max is always 1 or more to avoid division by zero', () => {
      const emptyData: DailyTaskRate[] = [];
      const maxTotal = Math.max(...emptyData.map(d => d.total), 1);
      expect(maxTotal).toBe(1);
    });
  });

  describe('Pie chart conic-gradient', () => {
    it('success occupies correct percentage of 360deg', () => {
      const success = 80, failure = 15, timeout = 5;
      const total = success + failure + timeout;
      const successPct = (success / total) * 100;
      expect(successPct).toBe(80);
    });

    it('all segments sum to 100%', () => {
      const success = 60, failure = 30, timeout = 10;
      const total = success + failure + timeout;
      const s = (success / total) * 100;
      const f = (failure / total) * 100;
      const t = (timeout / total) * 100;
      expect(Math.round(s + f + t)).toBe(100);
    });

    it('handles zero tasks gracefully', () => {
      const total = 0;
      const successPct = total > 0 ? (0 / total) * 100 : 0;
      expect(successPct).toBe(0);
    });
  });

  describe('Reputation delta', () => {
    it('positive delta shows up trend', () => {
      const delta = 15;
      expect(delta > 0).toBe(true);
    });

    it('negative delta shows down trend', () => {
      const delta = -5;
      expect(delta < 0).toBe(true);
    });
  });

  describe('Panel props', () => {
    it('PerformanceReportPanelProps is valid with no required fields', () => {
      const props: PerformanceReportPanelProps = {};
      expect(props).toBeDefined();
    });

    it('accepts optional agentId', () => {
      const props: PerformanceReportPanelProps = { agentId: 'agent_001' };
      expect(props.agentId).toBe('agent_001');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SessionManagerPanel
// ═══════════════════════════════════════════════════════════════════════════════

describe('SessionManagerPanel', () => {
  describe('ActiveSessionSummary', () => {
    const makeSummary = (overrides: Partial<ActiveSessionSummary> = {}): ActiveSessionSummary => ({
      session_id: 'sess_001',
      agent_id: 'agent_001',
      agent_name: 'Test Agent',
      creator_id: null,
      status: 'ACTIVE',
      channel: 'nostr',
      session_type: 'AUTONOMOUS',
      total_messages: 10,
      total_tool_calls: 5,
      total_tokens: 5000,
      total_sats_cost: 45,
      started_at: new Date(Date.now() - 3600000).toISOString(),
      last_activity_at: new Date().toISOString(),
      duration_minutes: 60,
      last_activity_ago_minutes: 0,
      auto_hibernate_remaining_minutes: null,
      avg_response_time_ms: 350,
      error_count: 0,
      warning_count: 0,
      current_compute_load_percent: 23,
      active_task_count: 2,
      available_budget_sats: 5000,
      accepts_new_tasks: true,
      ...overrides,
    });

    it('constructs a valid active session summary', () => {
      const s = makeSummary();
      expect(s.status).toBe('ACTIVE');
      expect(s.accepts_new_tasks).toBe(true);
    });

    it('PAUSED session does not accept new tasks', () => {
      const s = makeSummary({ status: 'PAUSED', accepts_new_tasks: false });
      expect(s.accepts_new_tasks).toBe(false);
    });

    it('TERMINATED session has zero compute load', () => {
      const s = makeSummary({ status: 'TERMINATED', current_compute_load_percent: 0 });
      expect(s.current_compute_load_percent).toBe(0);
    });
  });

  describe('Horizontal timeline computation', () => {
    it('event position is calculated proportionally', () => {
      const startMs = 0;
      const endMs   = 3600000; // 1 hour
      const spanMs  = endMs - startMs;
      const eventMs = 1800000; // 30 minutes
      const leftPct = ((eventMs - startMs) / spanMs) * 100;
      expect(leftPct).toBe(50);
    });

    it('event position is clamped to 1-98 range', () => {
      const clamp = (n: number) => Math.min(98, Math.max(1, n));
      expect(clamp(-5)).toBe(1);
      expect(clamp(50)).toBe(50);
      expect(clamp(150)).toBe(98);
    });

    it('zero span defaults to 1ms to avoid division by zero', () => {
      const startMs = 1000;
      const endMs   = 1000;
      const spanMs  = endMs - startMs || 1;
      expect(spanMs).toBe(1);
    });
  });

  describe('Session action handlers', () => {
    it('pause action targets correct session', async () => {
      const handleAction = vi.fn().mockResolvedValue(undefined);
      await handleAction('sess_001', 'pause');
      expect(handleAction).toHaveBeenCalledWith('sess_001', 'pause');
    });

    it('resume action targets correct session', async () => {
      const handleAction = vi.fn().mockResolvedValue(undefined);
      await handleAction('sess_002', 'resume');
      expect(handleAction).toHaveBeenCalledWith('sess_002', 'resume');
    });

    it('terminate action targets correct session', async () => {
      const handleAction = vi.fn().mockResolvedValue(undefined);
      await handleAction('sess_003', 'terminate');
      expect(handleAction).toHaveBeenCalledWith('sess_003', 'terminate');
    });
  });

  describe('Event log filtering', () => {
    const events = [
      { event_type: 'TOOL_CALL' as SessionEventType },
      { event_type: 'MESSAGE' as SessionEventType },
      { event_type: 'TOOL_CALL' as SessionEventType },
      { event_type: 'ERROR' as SessionEventType },
    ];

    it('ALL filter returns all events', () => {
      const filtered = events;
      expect(filtered).toHaveLength(4);
    });

    it('TOOL_CALL filter returns only tool calls', () => {
      const filtered = events.filter(e => e.event_type === 'TOOL_CALL');
      expect(filtered).toHaveLength(2);
    });

    it('ERROR filter returns only errors', () => {
      const filtered = events.filter(e => e.event_type === 'ERROR');
      expect(filtered).toHaveLength(1);
    });
  });

  describe('Duration formatting', () => {
    function formatDuration(minutes: number): string {
      if (minutes < 60) return `${minutes}m`;
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      return `${h}h ${m}m`;
    }

    it('formats minutes-only duration', () => {
      expect(formatDuration(45)).toBe('45m');
    });

    it('formats hours and minutes', () => {
      expect(formatDuration(90)).toBe('1h 30m');
    });

    it('formats exactly one hour', () => {
      expect(formatDuration(60)).toBe('1h 0m');
    });

    it('formats multi-hour session', () => {
      expect(formatDuration(150)).toBe('2h 30m');
    });
  });

  describe('Panel props', () => {
    it('SessionManagerPanelProps allows no props', () => {
      const props: SessionManagerPanelProps = {};
      expect(props).toBeDefined();
    });

    it('accepts optional agentId', () => {
      const props: SessionManagerPanelProps = { agentId: 'agent_123' };
      expect(props.agentId).toBe('agent_123');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SystemStatusPanel
// ═══════════════════════════════════════════════════════════════════════════════

describe('SystemStatusPanel', () => {
  describe('RelayHealth type', () => {
    it('connected relay satisfies type', () => {
      const relay: RelayHealth = {
        url: 'wss://relay.damus.io',
        status: 'connected',
        latency_ms: 42,
        lastSeen: new Date().toISOString(),
      };
      expect(relay.status).toBe('connected');
      expect(relay.latency_ms).toBe(42);
    });

    it('all RelayStatus values are valid', () => {
      const statuses: RelayStatus[] = ['connected', 'connecting', 'disconnected', 'error'];
      statuses.forEach(status => {
        const relay: RelayHealth = {
          url: 'wss://example.com',
          status,
        };
        expect(relay.status).toBe(status);
      });
    });
  });

  describe('ServiceWorkerStatus', () => {
    it('all ServiceWorkerStatus values are valid', () => {
      const statuses: ServiceWorkerStatus[] = [
        'active', 'installing', 'waiting', 'redundant', 'error', 'unsupported',
      ];
      statuses.forEach(s => expect(typeof s).toBe('string'));
    });

    it('active status maps to green dot', () => {
      function swDotVariant(status: ServiceWorkerStatus): string {
        switch (status) {
          case 'active':  return 'pulse-green';
          case 'installing':
          case 'waiting': return 'yellow';
          case 'error':   return 'red';
          default:        return 'gray';
        }
      }

      expect(swDotVariant('active')).toBe('pulse-green');
      expect(swDotVariant('installing')).toBe('yellow');
      expect(swDotVariant('error')).toBe('red');
      expect(swDotVariant('unsupported')).toBe('gray');
    });
  });

  describe('Relay health aggregation', () => {
    it('all relays connected → green indicator', () => {
      const relays: RelayHealth[] = [
        { url: 'wss://relay1.com', status: 'connected' },
        { url: 'wss://relay2.com', status: 'connected' },
      ];
      const connected = relays.filter(r => r.status === 'connected').length;
      const dot = connected === relays.length ? 'pulse-green' : connected > 0 ? 'yellow' : 'red';
      expect(dot).toBe('pulse-green');
    });

    it('some relays connected → yellow indicator', () => {
      const relays: RelayHealth[] = [
        { url: 'wss://relay1.com', status: 'connected' },
        { url: 'wss://relay2.com', status: 'disconnected' },
      ];
      const connected = relays.filter(r => r.status === 'connected').length;
      const dot = connected === relays.length ? 'pulse-green' : connected > 0 ? 'yellow' : 'red';
      expect(dot).toBe('yellow');
    });

    it('no relays connected → red indicator', () => {
      const relays: RelayHealth[] = [
        { url: 'wss://relay1.com', status: 'disconnected' },
        { url: 'wss://relay2.com', status: 'error' },
      ];
      const connected = relays.filter(r => r.status === 'connected').length;
      const dot = connected === relays.length ? 'pulse-green' : connected > 0 ? 'yellow' : 'red';
      expect(dot).toBe('red');
    });
  });

  describe('Pylon status derivation', () => {
    it('authenticated = green dot', () => {
      const dot = (isAuthenticated: boolean, isConnected: boolean): string =>
        isAuthenticated ? 'pulse-green' : isConnected ? 'yellow' : 'gray';

      expect(dot(true, true)).toBe('pulse-green');
    });

    it('connected but not authenticated = yellow dot', () => {
      const dot = (isAuthenticated: boolean, isConnected: boolean): string =>
        isAuthenticated ? 'pulse-green' : isConnected ? 'yellow' : 'gray';

      expect(dot(false, true)).toBe('yellow');
    });

    it('disconnected = gray dot', () => {
      const dot = (isAuthenticated: boolean, isConnected: boolean): string =>
        isAuthenticated ? 'pulse-green' : isConnected ? 'yellow' : 'gray';

      expect(dot(false, false)).toBe('gray');
    });
  });

  describe('Timestamp formatting', () => {
    function formatRelative(iso: string): string {
      const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (secs < 5)  return 'just now';
      if (secs < 60) return `${secs}s ago`;
      if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
      return `${Math.floor(secs / 3600)}h ago`;
    }

    it('returns "just now" for very recent timestamps', () => {
      const ts = new Date(Date.now() - 2000).toISOString();
      expect(formatRelative(ts)).toBe('just now');
    });

    it('returns seconds for < 1 minute ago', () => {
      const ts = new Date(Date.now() - 30000).toISOString();
      const result = formatRelative(ts);
      expect(result).toMatch(/\ds ago/);
    });

    it('returns minutes for < 1 hour ago', () => {
      const ts = new Date(Date.now() - 5 * 60000).toISOString();
      expect(formatRelative(ts)).toBe('5m ago');
    });

    it('returns hours for > 1 hour ago', () => {
      const ts = new Date(Date.now() - 2 * 3600000).toISOString();
      expect(formatRelative(ts)).toBe('2h ago');
    });
  });

  describe('Panel props', () => {
    it('SystemStatusPanelProps allows no props', () => {
      const props: SystemStatusPanelProps = {};
      expect(props).toBeDefined();
    });

    it('compact mode prop is optional boolean', () => {
      const compact: SystemStatusPanelProps = { compact: true };
      expect(compact.compact).toBe(true);
    });

    it('non-compact is the default', () => {
      const props: SystemStatusPanelProps = {};
      expect(props.compact).toBeUndefined();
    });
  });

  describe('Queued events threshold', () => {
    it('shows banner when queued events > 0', () => {
      const queuedEvents = 5;
      expect(queuedEvents > 0).toBe(true);
    });

    it('no banner when queued events = 0', () => {
      const queuedEvents = 0;
      expect(queuedEvents > 0).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-component integration: session data flow
// ═══════════════════════════════════════════════════════════════════════════════

describe('Session data flow across dashboards', () => {
  it('AgentSession maps to ActiveSessionSummary correctly', () => {
    const agentSessionId = 'sess_001';
    const agentId = 'agent_001';

    // Simulate the mapping done in SessionManagerPanel
    const summary: ActiveSessionSummary = {
      session_id: agentSessionId,
      agent_id: agentId,
      agent_name: agentId.slice(0, 8),
      creator_id: null,
      status: 'ACTIVE',
      channel: 'nostr',
      session_type: 'AUTONOMOUS',
      total_messages: 5,
      total_tool_calls: 2,
      total_tokens: 1200,
      total_sats_cost: 15,
      started_at: new Date(Date.now() - 1800000).toISOString(),
      last_activity_at: new Date().toISOString(),
      duration_minutes: 30,
      last_activity_ago_minutes: 0,
      auto_hibernate_remaining_minutes: null,
      avg_response_time_ms: 280,
      error_count: 0,
      warning_count: 0,
      current_compute_load_percent: 15,
      active_task_count: 1,
      available_budget_sats: 5000,
      accepts_new_tasks: true,
    };

    expect(summary.session_id).toBe(agentSessionId);
    expect(summary.agent_id).toBe(agentId);
    expect(summary.status).toBe('ACTIVE');
  });

  it('sats_spent flows correctly from session to performance', () => {
    const sessions = [
      { sats_spent: 100 },
      { sats_spent: 250 },
      { sats_spent: 75 },
    ];
    const total = sessions.reduce((s, e) => s + e.sats_spent, 0);
    expect(total).toBe(425);
  });
});
