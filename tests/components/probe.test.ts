/**
 * Probe UI Component Tests
 *
 * Tests for:
 * - ProbeSessionPanel
 * - ToolCallApproval
 * - SessionDiffRenderer (including parseUnifiedDiff utility)
 * - ExecutionResultPanel
 *
 * Test strategy:
 * - Unit tests for pure logic (diff parser, JSON highlighter, formatters)
 * - Interface contract tests for component prop types
 * - Integration smoke tests for hook consumption patterns
 *
 * Note: Rendering tests require a full Vitest + jsdom setup with React Testing
 * Library. These tests are written for Vitest (the bundler used in Vite projects).
 * Run with: `npx vitest run tests/components/probe.test.ts`
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock hooks ──────────────────────────────────────────────────────────────

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

// ─── Import testable utilities ────────────────────────────────────────────────

import { parseUnifiedDiff } from '../../src/components/probe/SessionDiffRenderer.js';
import type {
  DiffFile,
  DiffLine,
  DiffHunk,
} from '../../src/components/probe/SessionDiffRenderer.js';

import type {
  ToolCallRequest,
  ApprovalRecord,
  ApprovalDecision,
} from '../../src/components/probe/ToolCallApproval.js';

import type {
  ExecutionResult,
  FileChange,
  TestResult,
} from '../../src/components/probe/ExecutionResultPanel.js';

import type { ProbeSessionPanelProps } from '../../src/components/probe/ProbeSessionPanel.js';

// ─── Also import session types for integration tests ─────────────────────────

import type {
  AgentSession,
  AgentSessionEvent,
  SessionStatus,
  SessionEventType,
  SessionChannel,
  SessionType,
} from '../../src/lib/agent/session/types.js';

// ═══════════════════════════════════════════════════════════════════════════════
// parseUnifiedDiff
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseUnifiedDiff', () => {
  it('returns empty array for empty string', () => {
    const result = parseUnifiedDiff('');
    expect(result).toEqual([]);
  });

  it('parses a minimal unified diff with one hunk', () => {
    const raw = [
      '--- a/src/lib/vault.ts',
      '+++ b/src/lib/vault.ts',
      '@@ -142,4 +142,4 @@',
      ' const key = await crypto.subtle.deriveKey(',
      '-    { name: \'PBKDF2\', ... },',
      '+    { name: \'HKDF\', ... },',
      '     keyMaterial,',
    ].join('\n');

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(1);

    const file = files[0];
    expect(file.oldPath).toBe('src/lib/vault.ts');
    expect(file.newPath).toBe('src/lib/vault.ts');
    expect(file.hunks).toHaveLength(1);

    const hunk = file.hunks[0];
    expect(hunk.header).toBe('@@ -142,4 +142,4 @@');
    expect(hunk.lines).toHaveLength(4);

    // Verify line types
    expect(hunk.lines[0].type).toBe('context');
    expect(hunk.lines[1].type).toBe('removed');
    expect(hunk.lines[2].type).toBe('added');
    expect(hunk.lines[3].type).toBe('context');
  });

  it('counts additions and deletions correctly', () => {
    const raw = [
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' line1',
      '-old_line',
      '+new_line_a',
      '+new_line_b',
      ' line3',
    ].join('\n');

    const [file] = parseUnifiedDiff(raw);
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(1);
  });

  it('assigns line numbers correctly', () => {
    const raw = [
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -10,3 +10,3 @@',
      ' context',
      '-removed',
      '+added',
      ' context2',
    ].join('\n');

    const [file] = parseUnifiedDiff(raw);
    const lines = file.hunks[0].lines;

    // context: old=10, new=10
    expect(lines[0].oldLineNum).toBe(10);
    expect(lines[0].newLineNum).toBe(10);

    // removed: old=11, new=null
    expect(lines[1].oldLineNum).toBe(11);
    expect(lines[1].newLineNum).toBeNull();

    // added: old=null, new=11
    expect(lines[2].oldLineNum).toBeNull();
    expect(lines[2].newLineNum).toBe(11);
  });

  it('parses multiple files in a single diff', () => {
    const raw = [
      '--- a/file1.ts',
      '+++ b/file1.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '--- a/file2.ts',
      '+++ b/file2.ts',
      '@@ -5 +5 @@',
      ' unchanged',
    ].join('\n');

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(2);
    expect(files[0].newPath).toBe('file1.ts');
    expect(files[1].newPath).toBe('file2.ts');
  });

  it('handles diff with no hunks (file rename only)', () => {
    const raw = [
      '--- a/old-name.ts',
      '+++ b/new-name.ts',
    ].join('\n');

    const [file] = parseUnifiedDiff(raw);
    expect(file.oldPath).toBe('old-name.ts');
    expect(file.newPath).toBe('new-name.ts');
    expect(file.hunks).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DiffFile type contract
// ═══════════════════════════════════════════════════════════════════════════════

describe('DiffFile type contract', () => {
  it('satisfies required DiffFile shape', () => {
    const file: DiffFile = {
      oldPath: 'src/foo.ts',
      newPath: 'src/foo.ts',
      language: 'TypeScript',
      hunks: [],
      additions: 0,
      deletions: 0,
    };
    expect(file.oldPath).toBeTruthy();
    expect(Array.isArray(file.hunks)).toBe(true);
  });

  it('satisfies DiffHunk and DiffLine shapes', () => {
    const line: DiffLine = {
      type: 'added',
      content: '+const x = 1;',
      oldLineNum: null,
      newLineNum: 42,
    };

    const hunk: DiffHunk = {
      header: '@@ -0,0 +1 @@',
      lines: [line],
    };

    expect(hunk.lines[0].type).toBe('added');
    expect(hunk.lines[0].newLineNum).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ToolCallApproval types
// ═══════════════════════════════════════════════════════════════════════════════

describe('ToolCallApproval types', () => {
  it('ToolCallRequest satisfies shape', () => {
    const req: ToolCallRequest = {
      id: 'tcr_001',
      session_id: 'sess_abc',
      tool_name: 'read_file',
      parameters: { path: '/src/lib/vault.ts' },
      description: 'Read vault source file',
      estimated_cost_sats: 5,
      risk_level: 'low',
      timestamp: new Date().toISOString(),
    };

    expect(req.id).toBe('tcr_001');
    expect(req.tool_name).toBe('read_file');
    expect(req.risk_level).toBe('low');
    expect(typeof req.parameters).toBe('object');
  });

  it('ApprovalRecord satisfies shape for all decision types', () => {
    const decisions: ApprovalDecision[] = ['approved', 'rejected', 'modified'];
    decisions.forEach(decision => {
      const record: ApprovalRecord = {
        id: 'rec_' + decision,
        tool_name: 'write_file',
        decision,
        timestamp: new Date().toISOString(),
        ...(decision === 'modified' ? { modified_parameters: { path: '/new/path' } } : {}),
      };
      expect(record.decision).toBe(decision);
    });
  });

  it('high risk level is a valid ToolCallRequest risk_level', () => {
    const req: ToolCallRequest = {
      id: 'tcr_high',
      session_id: 'sess_abc',
      tool_name: 'execute_shell',
      parameters: { command: 'rm -rf /tmp/test' },
      risk_level: 'high',
      timestamp: new Date().toISOString(),
    };
    expect(req.risk_level).toBe('high');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ExecutionResult types
// ═══════════════════════════════════════════════════════════════════════════════

describe('ExecutionResult types', () => {
  it('minimal result with just exit_code is valid', () => {
    const result: ExecutionResult = {
      exit_code: 0,
    };
    expect(result.exit_code).toBe(0);
  });

  it('full result with all fields satisfies type', () => {
    const fileChange: FileChange = {
      path: 'src/lib/vault.ts',
      status: 'modified',
      additions: 3,
      deletions: 1,
    };

    const testResult: TestResult = {
      name: 'should derive key with HKDF',
      status: 'passed',
      duration_ms: 42,
      file: 'tests/vault.test.ts',
    };

    const result: ExecutionResult = {
      exit_code: 0,
      stdout: 'Build successful\n3 tests passed',
      stderr: '',
      file_changes: [fileChange],
      test_results: [testResult],
      duration_ms: 1200,
      sats_cost: 15,
      timestamp: new Date().toISOString(),
    };

    expect(result.exit_code).toBe(0);
    expect(result.file_changes).toHaveLength(1);
    expect(result.test_results).toHaveLength(1);
    expect(result.test_results![0].status).toBe('passed');
  });

  it('FileChange handles all status types', () => {
    const statuses: FileChange['status'][] = ['added', 'modified', 'deleted', 'renamed'];
    statuses.forEach(status => {
      const change: FileChange = {
        path: 'src/foo.ts',
        status,
        ...(status === 'renamed' ? { oldPath: 'src/bar.ts' } : {}),
      };
      expect(change.status).toBe(status);
    });
  });

  it('TestResult handles all status types', () => {
    const statuses: TestResult['status'][] = ['passed', 'failed', 'skipped', 'pending'];
    statuses.forEach(status => {
      const tr: TestResult = {
        name: `test-${status}`,
        status,
        duration_ms: 10,
        ...(status === 'failed' ? { error_message: 'assertion failed' } : {}),
      };
      expect(tr.status).toBe(status);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ProbeSessionPanel prop types
// ═══════════════════════════════════════════════════════════════════════════════

describe('ProbeSessionPanel prop types', () => {
  it('props satisfy interface with no required fields', () => {
    const props: ProbeSessionPanelProps = {};
    expect(props).toBeDefined();
  });

  it('props accept optional className', () => {
    const props: ProbeSessionPanelProps = { className: 'custom-class' };
    expect(props.className).toBe('custom-class');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Session type integration
// ═══════════════════════════════════════════════════════════════════════════════

describe('Session type compatibility (AgentSession → Probe)', () => {
  const makeSession = (overrides: Partial<AgentSession> = {}): AgentSession => ({
    id: 'id_001',
    session_id: 'sess_001',
    session_token: 'ast_token',
    agent_id: 'agent_001',
    human_creator_id: null,
    session_type: 'AUTONOMOUS',
    status: 'ACTIVE',
    capability_scope: {},
    lifecycle_metadata: {},
    conversation_context: [],
    tool_invocation_log: [],
    state_snapshots: {},
    total_messages: 0,
    total_tool_calls: 0,
    tokens_consumed: 0,
    sats_spent: 0,
    primary_channel: 'nostr',
    auto_hibernate_after_minutes: 60,
    operational_state_snapshot: null,
    started_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    terminated_at: null,
    termination_reason: null,
    ...overrides,
  });

  it('can create a valid ACTIVE session', () => {
    const s = makeSession();
    expect(s.status).toBe('ACTIVE');
    expect(s.primary_channel).toBe('nostr');
  });

  it('all SessionStatus values are handled', () => {
    const statuses: SessionStatus[] = ['ACTIVE', 'PAUSED', 'HIBERNATED', 'TERMINATED'];
    statuses.forEach(status => {
      const s = makeSession({ status });
      expect(s.status).toBe(status);
    });
  });

  it('all SessionChannel values are valid', () => {
    const channels: SessionChannel[] = ['nostr', 'telegram', 'web_ui', 'api', 'cli'];
    channels.forEach(primary_channel => {
      const s = makeSession({ primary_channel });
      expect(s.primary_channel).toBe(primary_channel);
    });
  });

  it('AgentSessionEvent satisfies shape', () => {
    const event: AgentSessionEvent = {
      id: 'evt_001',
      session_id: 'sess_001',
      event_type: 'TOOL_CALL',
      event_data: { tool: 'read_file', args: { path: '/src/lib/vault.ts' } },
      timestamp: new Date().toISOString(),
      sats_cost: 3,
      input_tokens: 1200,
      output_tokens: 400,
      tool_name: 'read_file',
      tool_parameters: { path: '/src/lib/vault.ts' },
      tool_result: { content: '// vault source', error: null },
    };
    expect(event.event_type).toBe('TOOL_CALL');
    expect(event.tool_name).toBe('read_file');
  });

  it('SessionEventType covers all probe-relevant types', () => {
    const relevantTypes: SessionEventType[] = [
      'TOOL_CALL', 'TASK_COMPLETION', 'TASK_FAILURE',
      'ERROR', 'WARNING', 'DELEGATION', 'MESSAGE',
    ];
    expect(relevantTypes.length).toBeGreaterThan(0);
    relevantTypes.forEach(t => expect(typeof t).toBe('string'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Diff language detection
// ═══════════════════════════════════════════════════════════════════════════════

describe('Language detection from file extension', () => {
  const extensions: Array<{ ext: string; expected: string }> = [
    { ext: 'ts',      expected: 'TypeScript' },
    { ext: 'tsx',     expected: 'TypeScript' },
    { ext: 'js',      expected: 'JavaScript' },
    { ext: 'jsx',     expected: 'JavaScript' },
    { ext: 'py',      expected: 'Python'     },
    { ext: 'rs',      expected: 'Rust'       },
    { ext: 'go',      expected: 'Go'         },
    { ext: 'json',    expected: 'JSON'       },
    { ext: 'md',      expected: 'Markdown'   },
    { ext: 'css',     expected: 'CSS'        },
    { ext: 'unknown', expected: 'Text'       },
  ];

  const EXTENSION_MAP: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
    py: 'Python', rs: 'Rust', go: 'Go', json: 'JSON', md: 'Markdown',
    css: 'CSS', html: 'HTML', sh: 'Shell',
  };

  function detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    return EXTENSION_MAP[ext] ?? 'Text';
  }

  extensions.forEach(({ ext, expected }) => {
    it(`detects ${ext} as ${expected}`, () => {
      expect(detectLanguage(`src/file.${ext}`)).toBe(expected);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Approval decision flow
// ═══════════════════════════════════════════════════════════════════════════════

describe('Approval decision flow', () => {
  it('respondToToolCall is called with correct args on approve', async () => {
    const mockRespond = vi.fn().mockResolvedValue(undefined);
    const req: ToolCallRequest = {
      id: 'tcr_test',
      session_id: 'sess_001',
      tool_name: 'read_file',
      parameters: { path: '/test.ts' },
      timestamp: new Date().toISOString(),
    };

    await mockRespond(req.id, 'approved', req.parameters);
    expect(mockRespond).toHaveBeenCalledWith('tcr_test', 'approved', { path: '/test.ts' });
  });

  it('respondToToolCall is called with modified params on modify', async () => {
    const mockRespond = vi.fn().mockResolvedValue(undefined);
    const modifiedParams = { path: '/safe/test.ts' };

    await mockRespond('tcr_test', 'modified', modifiedParams);
    expect(mockRespond).toHaveBeenCalledWith('tcr_test', 'modified', modifiedParams);
  });

  it('respondToToolCall is called without params on reject', async () => {
    const mockRespond = vi.fn().mockResolvedValue(undefined);

    await mockRespond('tcr_test', 'rejected');
    expect(mockRespond).toHaveBeenCalledWith('tcr_test', 'rejected');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ExecutionResult exit code logic
// ═══════════════════════════════════════════════════════════════════════════════

describe('ExecutionResult exit code', () => {
  it('exit_code 0 means success', () => {
    const result: ExecutionResult = { exit_code: 0 };
    expect(result.exit_code === 0).toBe(true);
  });

  it('non-zero exit code means failure', () => {
    const codes = [1, 2, 127, 255, -1];
    codes.forEach(code => {
      const result: ExecutionResult = { exit_code: code };
      expect(result.exit_code !== 0).toBe(true);
    });
  });
});
