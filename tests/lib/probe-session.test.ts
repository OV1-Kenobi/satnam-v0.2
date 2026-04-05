/**
 * @file probe-session.test.ts
 * @description Unit tests for ProbeSessionClient — trajectory parsing and tool approval.
 *
 * Tests cover:
 * 1. parseSessionEvent — parses kind:39230 with all standard tags
 * 2. parseSessionEvent — defaults status to 'active' if tag missing
 * 3. parseSessionEvent — throws on wrong kind
 * 4. parseSessionEvent — throws on missing 'd' tag
 * 5. parseSessionEvent — merges JSON content into metadata
 * 6. parseTrajectoryEvent — parses kind:39231 tool_call event
 * 7. parseTrajectoryEvent — parses tool_approval event with approved=false
 * 8. parseTrajectoryEvent — parses tool_result event with stdout/stderr
 * 9. parseTrajectoryEvent — parses diff event with hunks
 * 10. parseTrajectoryEvent — parses result event with file changes
 * 11. parseTrajectoryEvent — parses error event with code and stack
 * 12. parseTrajectoryEvent — parses message event (agent role)
 * 13. parseTrajectoryEvent — throws on wrong kind
 * 14. parseTrajectoryEvent — throws on missing 'type' tag
 * 15. parseTrajectoryEvent — throws on unknown event type
 * 16. respondToToolCall — publishes kind:39231 with tool_approval tags
 * 17. respondToToolCall — sets 'approved' tag to 'false' on rejection
 * 18. respondToToolCall — includes modifiedParameters tag when provided
 * 19. subscribeSession — filters and delivers only kind:39231 events
 * 20. getActiveSessions — returns only sessions with status 'active'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { ProbeSessionClient } from '../../src/lib/probe/session-client.js';
import type { PylonCepsClient } from '../../src/lib/pylon/ceps-pylon.js';
import type { TrajectoryEvent, ToolCallData, ToolApprovalData, DiffData, ResultData, ErrorData, MessageData, ToolResultData } from '../../src/lib/probe/types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>();
  return {
    ...actual,
    finalizeEvent: vi.fn((event: any, _secretKey: Uint8Array) => ({
      ...event,
      id: 'published-event-id-' + Math.random().toString(36).slice(2),
      pubkey: 'aa'.repeat(32),
      sig: 'bb'.repeat(32),
    })),
    getPublicKey: vi.fn((_secretKey: Uint8Array) => 'approver-pubkey-hex'),
    nip19: {
      ...actual.nip19,
      decode: vi.fn((input: string) => {
        if (input.startsWith('nsec1')) {
          return { type: 'nsec', data: new Uint8Array(32).fill(0x01) };
        }
        throw new Error('Not an nsec');
      }),
    },
  };
});

vi.mock('@noble/hashes/utils', () => ({
  hexToBytes: vi.fn((hex: string) => {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return arr;
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal kind:39230 session event. */
function makeSessionEvent(overrides: Partial<{
  tags: string[][];
  content: string;
  pubkey: string;
  created_at: number;
}> = {}) {
  return {
    id: 'session-event-id',
    kind: 39230,
    pubkey: 'agent-pubkey-hex',
    created_at: 1_700_000_000,
    tags: [
      ['d', 'sess-abc123'],
      ['status', 'active'],
      ['started_at', '1700000000'],
      ['p', 'principal-pubkey-hex'],
    ],
    content: '',
    sig: 'sig',
    ...overrides,
  };
}

/** Create a minimal kind:39231 trajectory event. */
function makeTrajectoryEvent(
  type: string,
  content: Record<string, unknown>,
  extraTags: string[][] = []
) {
  return {
    id: 'trajectory-event-id-' + type,
    kind: 39231,
    pubkey: 'agent-pubkey-hex',
    created_at: 1_700_001_000,
    tags: [
      ['d', 'sess-abc123'],
      ['type', type],
      ...extraTags,
    ],
    content: JSON.stringify(content),
    sig: 'sig',
  };
}

/** Create a mock PylonCepsClient. */
function createMockPylonCeps(): PylonCepsClient {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    list: vi.fn().mockResolvedValue([]),
    isPylonAuthenticated: vi.fn().mockReturnValue(true),
    retryQueueSize: 0,
    clearRetryQueue: vi.fn(),
    destroy: vi.fn(),
    flushRetryQueue: vi.fn().mockResolvedValue(undefined),
  } as unknown as PylonCepsClient;
}

const TEST_NSEC_HEX = 'a'.repeat(64);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProbeSessionClient', () => {
  let mockCeps: PylonCepsClient;
  let client: ProbeSessionClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCeps = createMockPylonCeps();
    client = new ProbeSessionClient(mockCeps);
  });

  // ── parseSessionEvent ──────────────────────────────────────────────────────

  describe('parseSessionEvent()', () => {
    it('parses kind:39230 with all standard tags', () => {
      const event = makeSessionEvent();
      const session = client.parseSessionEvent(event as any);

      expect(session.sessionId).toBe('sess-abc123');
      expect(session.agentPubkey).toBe('agent-pubkey-hex');
      expect(session.startedAt).toBe(1_700_000_000);
      expect(session.status).toBe('active');
    });

    it('defaults status to active when tag is missing', () => {
      const event = makeSessionEvent({
        tags: [['d', 'sess-xyz'], ['started_at', '1700000000']],
      });
      const session = client.parseSessionEvent(event as any);
      expect(session.status).toBe('active');
    });

    it('parses paused status', () => {
      const event = makeSessionEvent({
        tags: [['d', 'sess-xyz'], ['status', 'paused']],
      });
      const session = client.parseSessionEvent(event as any);
      expect(session.status).toBe('paused');
    });

    it('throws on wrong kind', () => {
      const event = { ...makeSessionEvent(), kind: 39231 };
      expect(() => client.parseSessionEvent(event as any)).toThrow('expects kind 39230');
    });

    it('throws when d tag is missing', () => {
      const event = makeSessionEvent({ tags: [['status', 'active']] });
      expect(() => client.parseSessionEvent(event as any)).toThrow('missing "d" tag');
    });

    it('merges JSON content into metadata', () => {
      const event = makeSessionEvent({
        content: JSON.stringify({ task: 'fix bug', repo: 'openagents/satnam-v2' }),
      });
      const session = client.parseSessionEvent(event as any);
      expect(session.metadata['task']).toBe('fix bug');
      expect(session.metadata['repo']).toBe('openagents/satnam-v2');
    });

    it('uses event.created_at when started_at tag is absent', () => {
      const event = makeSessionEvent({
        tags: [['d', 'sess-nots']],
        created_at: 9_999_999,
      });
      const session = client.parseSessionEvent(event as any);
      expect(session.startedAt).toBe(9_999_999);
    });
  });

  // ── parseTrajectoryEvent ───────────────────────────────────────────────────

  describe('parseTrajectoryEvent()', () => {
    it('throws on wrong kind', () => {
      const event = { ...makeTrajectoryEvent('tool_call', {}), kind: 39230 };
      expect(() => client.parseTrajectoryEvent(event as any)).toThrow('expects kind 39231');
    });

    it('throws when type tag is missing', () => {
      const event = {
        id: 'x',
        kind: 39231,
        pubkey: 'pub',
        created_at: 123,
        tags: [['d', 'sess-abc']],
        content: '{}',
        sig: 'sig',
      };
      expect(() => client.parseTrajectoryEvent(event as any)).toThrow('missing "type" tag');
    });

    it('throws on unknown event type', () => {
      const event = makeTrajectoryEvent('unknown_type', {});
      expect(() => client.parseTrajectoryEvent(event as any)).toThrow('Unknown trajectory event type');
    });

    it('parses tool_call event', () => {
      const content = {
        toolName: 'bash',
        parameters: { command: 'ls -la' },
        requiresApproval: true,
        callId: 'call-001',
      };
      const event = makeTrajectoryEvent('tool_call', content, [['call_id', 'call-001']]);
      const result = client.parseTrajectoryEvent(event as any);

      expect(result.eventType).toBe('tool_call');
      expect(result.sessionId).toBe('sess-abc123');
      const data = result.data as ToolCallData;
      expect(data.type).toBe('tool_call');
      expect(data.toolName).toBe('bash');
      expect(data.callId).toBe('call-001');
      expect(data.requiresApproval).toBe(true);
      expect(data.parameters).toEqual({ command: 'ls -la' });
    });

    it('parses tool_approval event with approved=false', () => {
      const content = {
        callId: 'call-001',
        approved: false,
        approverPubkey: 'principal-pubkey',
      };
      const event = makeTrajectoryEvent('tool_approval', content, [
        ['call_id', 'call-001'],
        ['approved', 'false'],
      ]);
      const result = client.parseTrajectoryEvent(event as any);

      const data = result.data as ToolApprovalData;
      expect(data.type).toBe('tool_approval');
      expect(data.callId).toBe('call-001');
      expect(data.approved).toBe(false);
      expect(data.approverPubkey).toBe('principal-pubkey');
    });

    it('parses tool_result event with stdout, stderr, exitCode, duration', () => {
      const content = {
        callId: 'call-001',
        stdout: 'file1.ts\nfile2.ts',
        stderr: '',
        exitCode: 0,
        duration: 142,
      };
      const event = makeTrajectoryEvent('tool_result', content, [['call_id', 'call-001']]);
      const result = client.parseTrajectoryEvent(event as any);

      const data = result.data as ToolResultData;
      expect(data.type).toBe('tool_result');
      expect(data.stdout).toBe('file1.ts\nfile2.ts');
      expect(data.exitCode).toBe(0);
      expect(data.duration).toBe(142);
    });

    it('parses diff event with hunks', () => {
      const hunk = {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 4,
        lines: [
          { type: 'context', content: 'const x = 1;', lineNumber: 1 },
          { type: 'add', content: 'const y = 2;', lineNumber: 2 },
        ],
      };
      const content = {
        filePath: 'src/lib/probe/types.ts',
        hunks: [hunk],
        language: 'typescript',
      };
      const event = makeTrajectoryEvent('diff', content, [['file', 'src/lib/probe/types.ts']]);
      const result = client.parseTrajectoryEvent(event as any);

      const data = result.data as DiffData;
      expect(data.type).toBe('diff');
      expect(data.filePath).toBe('src/lib/probe/types.ts');
      expect(data.language).toBe('typescript');
      expect(data.hunks).toHaveLength(1);
      expect(data.hunks[0]?.lines).toHaveLength(2);
    });

    it('parses result event with file changes and test results', () => {
      const content = {
        summary: 'Fixed 3 bugs, added 2 tests',
        fileChanges: [
          { path: 'src/main.ts', changeType: 'modified', additions: 10, deletions: 5 },
        ],
        testResults: [
          { name: 'should pass', passed: true, duration: 50 },
          { name: 'should also pass', passed: false, duration: 10, error: 'assertion failed' },
        ],
      };
      const event = makeTrajectoryEvent('result', content);
      const result = client.parseTrajectoryEvent(event as any);

      const data = result.data as ResultData;
      expect(data.type).toBe('result');
      expect(data.summary).toBe('Fixed 3 bugs, added 2 tests');
      expect(data.fileChanges).toHaveLength(1);
      expect(data.testResults).toHaveLength(2);
      expect(data.testResults?.[1]?.passed).toBe(false);
    });

    it('parses error event with code and stack', () => {
      const content = {
        message: 'Tool not found',
        code: 'TOOL_NOT_FOUND',
        stack: 'Error: Tool not found\n  at ...',
      };
      const event = makeTrajectoryEvent('error', content);
      const result = client.parseTrajectoryEvent(event as any);

      const data = result.data as ErrorData;
      expect(data.type).toBe('error');
      expect(data.message).toBe('Tool not found');
      expect(data.code).toBe('TOOL_NOT_FOUND');
      expect(data.stack).toContain('Error: Tool not found');
    });

    it('parses message event with agent role', () => {
      const content = { content: 'Analyzing the codebase...', role: 'agent' };
      const event = makeTrajectoryEvent('message', content);
      const result = client.parseTrajectoryEvent(event as any);

      const data = result.data as any;
      expect(data.type).toBe('message');
      expect(data.content).toBe('Analyzing the codebase...');
      expect(data.role).toBe('agent');
    });

    it('parses message event with system role', () => {
      const content = { content: 'Task started', role: 'system' };
      const event = makeTrajectoryEvent('message', content);
      const result = client.parseTrajectoryEvent(event as any);

      const data = result.data as any;
      expect(data.role).toBe('system');
    });

    it('extracts sessionId and timestamp correctly', () => {
      const content = { message: 'test error' };
      const event = makeTrajectoryEvent('error', content);
      event.created_at = 1_750_000_000;

      const result = client.parseTrajectoryEvent(event as any);
      expect(result.sessionId).toBe('sess-abc123');
      expect(result.timestamp).toBe(1_750_000_000);
    });
  });

  // ── respondToToolCall ──────────────────────────────────────────────────────

  describe('respondToToolCall()', () => {
    it('publishes a kind:39231 tool_approval event on approval', async () => {
      const { finalizeEvent } = await import('nostr-tools');
      const mockFinalize = finalizeEvent as MockedFunction<typeof finalizeEvent>;

      await client.respondToToolCall({
        callId: 'call-002',
        approved: true,
        sessionId: 'sess-abc123',
        agentPubkey: 'agent-hex',
        signerNsec: TEST_NSEC_HEX,
      });

      expect(mockCeps.publish).toHaveBeenCalledTimes(1);
      const eventArg = mockFinalize.mock.calls[0]?.[0];
      expect(eventArg?.kind).toBe(39231);
      expect(eventArg?.tags).toEqual(
        expect.arrayContaining([
          ['d', 'sess-abc123'],
          ['p', 'agent-hex'],
          ['type', 'tool_approval'],
          ['call_id', 'call-002'],
          ['approved', 'true'],
        ])
      );
    });

    it('sets approved tag to "false" on rejection', async () => {
      const { finalizeEvent } = await import('nostr-tools');
      const mockFinalize = finalizeEvent as MockedFunction<typeof finalizeEvent>;

      await client.respondToToolCall({
        callId: 'call-003',
        approved: false,
        sessionId: 'sess-abc123',
        agentPubkey: 'agent-hex',
        signerNsec: TEST_NSEC_HEX,
      });

      const eventArg = mockFinalize.mock.calls[0]?.[0];
      expect(eventArg?.tags).toEqual(
        expect.arrayContaining([['approved', 'false']])
      );
    });

    it('includes modified tag when modifiedParameters provided', async () => {
      const { finalizeEvent } = await import('nostr-tools');
      const mockFinalize = finalizeEvent as MockedFunction<typeof finalizeEvent>;

      await client.respondToToolCall({
        callId: 'call-004',
        approved: true,
        sessionId: 'sess-abc123',
        agentPubkey: 'agent-hex',
        signerNsec: TEST_NSEC_HEX,
        modifiedParameters: { command: 'ls' },
      });

      const eventArg = mockFinalize.mock.calls[0]?.[0];
      expect(eventArg?.tags).toEqual(
        expect.arrayContaining([['modified', 'true']])
      );
    });

    it('includes modifiedParameters in event content', async () => {
      const { finalizeEvent } = await import('nostr-tools');
      const mockFinalize = finalizeEvent as MockedFunction<typeof finalizeEvent>;

      await client.respondToToolCall({
        callId: 'call-005',
        approved: true,
        sessionId: 'sess-abc123',
        agentPubkey: 'agent-hex',
        signerNsec: TEST_NSEC_HEX,
        modifiedParameters: { command: 'echo hello' },
      });

      const eventArg = mockFinalize.mock.calls[0]?.[0];
      const content = JSON.parse(eventArg?.content ?? '{}');
      expect(content.modifiedParameters).toEqual({ command: 'echo hello' });
    });

    it('returns the published event ID', async () => {
      const result = await client.respondToToolCall({
        callId: 'call-006',
        approved: true,
        sessionId: 'sess-abc123',
        agentPubkey: 'agent-hex',
        signerNsec: TEST_NSEC_HEX,
      });

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ── subscribeSession ────────────────────────────────────────────────────────

  describe('subscribeSession()', () => {
    it('calls pylonCeps.subscribe with correct filter', () => {
      const callback = vi.fn();
      client.subscribeSession('agent-pubkey', callback, { since: 1_700_000_000 });

      expect(mockCeps.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          kinds: [39230, 39231],
          '#p': ['agent-pubkey'],
          since: 1_700_000_000,
        }),
        expect.any(Function)
      );
    });

    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsub = client.subscribeSession('agent-pubkey', callback);
      expect(typeof unsub).toBe('function');
    });

    it('delivers parsed trajectory events to callback', () => {
      const callback = vi.fn();
      let capturedInternalCallback: ((event: any) => void) | undefined;

      (mockCeps.subscribe as MockedFunction<any>).mockImplementation(
        (_filter: any, cb: (event: any) => void) => {
          capturedInternalCallback = cb;
          return () => {};
        }
      );

      client.subscribeSession('agent-pubkey', callback);

      const rawEvent = makeTrajectoryEvent('message', {
        content: 'hello',
        role: 'agent',
      });

      capturedInternalCallback?.(rawEvent);

      expect(callback).toHaveBeenCalledTimes(1);
      const received = callback.mock.calls[0][0] as TrajectoryEvent;
      expect(received.eventType).toBe('message');
    });

    it('does not deliver kind:39230 events to trajectory callback', () => {
      const callback = vi.fn();
      let capturedCb: ((event: any) => void) | undefined;

      (mockCeps.subscribe as MockedFunction<any>).mockImplementation(
        (_filter: any, cb: (event: any) => void) => {
          capturedCb = cb;
          return () => {};
        }
      );

      client.subscribeSession('agent-pubkey', callback);
      capturedCb?.(makeSessionEvent());

      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ── getActiveSessions ──────────────────────────────────────────────────────

  describe('getActiveSessions()', () => {
    it('returns only sessions with status active', async () => {
      const activeEvent = makeSessionEvent({
        tags: [['d', 'sess-active'], ['status', 'active']],
      });
      const completedEvent = makeSessionEvent({
        tags: [['d', 'sess-done'], ['status', 'completed']],
      });

      (mockCeps.list as MockedFunction<any>).mockResolvedValueOnce([
        activeEvent,
        completedEvent,
      ]);

      const sessions = await client.getActiveSessions('agent-pubkey');

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.sessionId).toBe('sess-active');
      expect(sessions[0]?.status).toBe('active');
    });

    it('returns empty array when no active sessions', async () => {
      (mockCeps.list as MockedFunction<any>).mockResolvedValueOnce([
        makeSessionEvent({ tags: [['d', 'sess-1'], ['status', 'completed']] }),
        makeSessionEvent({ tags: [['d', 'sess-2'], ['status', 'failed']] }),
      ]);

      const sessions = await client.getActiveSessions('agent-pubkey');
      expect(sessions).toHaveLength(0);
    });

    it('skips unparseable events gracefully', async () => {
      const invalidEvent = { id: 'bad', kind: 39230, pubkey: 'p', created_at: 1, tags: [], content: '', sig: '' };

      (mockCeps.list as MockedFunction<any>).mockResolvedValueOnce([
        invalidEvent,
        makeSessionEvent({ tags: [['d', 'sess-good'], ['status', 'active']] }),
      ]);

      const sessions = await client.getActiveSessions('agent-pubkey');
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.sessionId).toBe('sess-good');
    });
  });

  // ── getSessionTrajectory ───────────────────────────────────────────────────

  describe('getSessionTrajectory()', () => {
    it('returns sorted trajectory events', async () => {
      const event1 = { ...makeTrajectoryEvent('message', { content: 'first', role: 'agent' }), created_at: 100 };
      const event2 = { ...makeTrajectoryEvent('error', { message: 'oops' }), created_at: 50 };

      (mockCeps.list as MockedFunction<any>).mockResolvedValueOnce([event1, event2]);

      const trajectory = await client.getSessionTrajectory('sess-abc');

      expect(trajectory).toHaveLength(2);
      expect(trajectory[0]?.timestamp).toBe(50); // Earlier event first
      expect(trajectory[1]?.timestamp).toBe(100);
    });
  });
});
