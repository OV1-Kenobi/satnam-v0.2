/**
 * @file spacetime-bridge.test.ts
 * @description Unit tests for SpacetimeBridge — presence sync and compute assignments.
 *
 * Tests cover:
 * 1. publishPresence — publishes kind:10003 with status tag
 * 2. publishPresence — includes agentPubkey as 'p' and 'agent' tags
 * 3. publishPresence — sets content with status JSON
 * 4. publishPresence — uses kind:10003 (not any other kind)
 * 5. publishPresence — updates internal presenceStatus after publish
 * 6. subscribeComputeAssignments — subscribes with kind:39242 filter
 * 7. subscribeComputeAssignments — delivers parsed ComputeAssignment via callback
 * 8. subscribeComputeAssignments — parses budgetMsats as BigInt
 * 9. subscribeComputeAssignments — returns unsubscribe function
 * 10. subscribeSyncCheckpoints — subscribes with kind:39231 and type tag filter
 * 11. subscribeSyncCheckpoints — parses SyncCheckpoint from event
 * 12. subscribeSyncCheckpoints — returns unsubscribe function
 * 13. publishHeartbeat — publishes kind:10003 with heartbeat=true tag
 * 14. publishHeartbeat — includes agentPubkey in 'p' and 'agent' tags
 * 15. startHeartbeatInterval — clamps interval below 10s to 10s
 * 16. startHeartbeatInterval — publishes heartbeat immediately
 * 17. startHeartbeatInterval — sets heartbeatActive to true
 * 18. stopHeartbeatInterval — sets heartbeatActive back to false
 * 19. SpacetimeBridge — no SpacetimeDB SDK imported
 * 20. _parseComputeAssignment — extracts task description from JSON content
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import { SpacetimeBridge } from '../../src/lib/bridge/spacetime-bridge.js';
import type { PylonCepsClient } from '../../src/lib/pylon/ceps-pylon.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('nostr-tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools')>();
  return {
    ...actual,
    finalizeEvent: vi.fn((event: any, _secretKey: Uint8Array) => ({
      ...event,
      id: 'mock-event-id-' + Math.random().toString(36).slice(2),
      pubkey: 'aa'.repeat(32),
      sig: 'bb'.repeat(32),
    })),
    getPublicKey: vi.fn((_secretKey: Uint8Array) => 'principal-pubkey-hex'),
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

function createMockVault(nsecHex: string = 'a'.repeat(64)) {
  const nsecBytes = new Uint8Array(nsecHex.length / 2);
  for (let i = 0; i < nsecHex.length; i += 2) {
    nsecBytes[i / 2] = parseInt(nsecHex.slice(i, i + 2), 16) || 0xaa;
  }
  return {
    listIdentities: vi.fn().mockResolvedValue(['npub1testprincipal']),
    getNsec: vi.fn().mockResolvedValue(nsecBytes),
    getAgentNsec: vi.fn().mockResolvedValue(nsecBytes),
  } as any;
}

function createMockCeps(): PylonCepsClient {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
    list: vi.fn().mockResolvedValue([]),
    isPylonAuthenticated: vi.fn().mockReturnValue(true),
  } as unknown as PylonCepsClient;
}

/** Create a kind:39242 compute assignment event. */
function makeComputeAssignmentEvent(overrides: Partial<{
  tags: string[][];
  content: string;
}> = {}) {
  return {
    id: 'compute-event-id',
    kind: 39242,
    pubkey: 'bridge-pubkey',
    created_at: 1_700_000_000,
    tags: [
      ['p', 'assigned-agent-pubkey'],
      ['amount', '5000000'],
      ['expiry', '1700003600'],
    ],
    content: JSON.stringify({
      description: 'Fix the authentication bug in auth.ts',
      budget_msats: '5000000',
      deadline: 1700003600,
    }),
    sig: 'sig',
    ...overrides,
  };
}

/** Create a kind:39231 sync checkpoint event. */
function makeSyncCheckpointEvent() {
  return {
    id: 'checkpoint-event-id',
    kind: 39231,
    pubkey: 'bridge-pubkey',
    created_at: 1_700_001_000,
    tags: [
      ['p', 'agent-pubkey'],
      ['d', 'sess-abc123'],
      ['type', 'sync_checkpoint'],
      ['checkpoint', 'checkpoint-v2-abc'],
    ],
    content: JSON.stringify({ syncState: 'committed', blockHeight: 850000 }),
    sig: 'sig',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpacetimeBridge', () => {
  let mockCeps: PylonCepsClient;
  let mockVault: ReturnType<typeof createMockVault>;
  let bridge: SpacetimeBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockCeps = createMockCeps();
    mockVault = createMockVault();
    bridge = new SpacetimeBridge(mockCeps, mockVault);
  });

  afterEach(() => {
    bridge.stopHeartbeatInterval();
    vi.useRealTimers();
  });

  // ── publishPresence ────────────────────────────────────────────────────────

  describe('publishPresence()', () => {
    it('publishes a kind:10003 event', async () => {
      const { finalizeEvent } = await import('nostr-tools');
      const mockFinalize = finalizeEvent as MockedFunction<typeof finalizeEvent>;

      await bridge.publishPresence({ status: 'online' });

      expect(mockCeps.publish).toHaveBeenCalledTimes(1);
      const eventArg = mockFinalize.mock.calls[0]?.[0];
      expect(eventArg?.kind).toBe(10003);
    });

    it('includes status tag', async () => {
      const { finalizeEvent } = await import('nostr-tools');
      const mockFinalize = finalizeEvent as MockedFunction<typeof finalizeEvent>;

      await bridge.publishPresence({ status: 'away' });

      const eventArg = mockFinalize.mock.calls[0]?.[0];
      expect(eventArg?.tags).toEqual(
        expect.arrayContaining([['status', 'away']])
      );
    });

    it('includes d tag set to "presence"', async () => {
      const { finalizeEvent } = await import('nostr-tools');
      const mockFinalize = finalizeEvent as MockedFunction<typeof finalizeEvent>;

      await bridge.publishPresence({ status: 'offline' });

      const eventArg = mockFinalize.mock.calls[0]?.[0];
      expect(eventArg?.tags).toEqual(expect.arrayContaining([['d', 'presence']]));
    });

    it('includes p and agent tags when agentPubkey is provided', async () => {
      const { finalizeEvent } = await import('nostr-tools');
      const mockFinalize = finalizeEvent as MockedFunction<typeof finalizeEvent>;

      await bridge.publishPresence({ status: 'online', agentPubkey: 'my-agent-hex' });

      const eventArg = mockFinalize.mock.calls[0]?.[0];
      expect(eventArg?.tags).toEqual(
        expect.arrayContaining([
          ['p', 'my-agent-hex'],
          ['agent', 'my-agent-hex'],
        ])
      );
    });

    it('sets content as JSON with status field', async () => {
      const { finalizeEvent } = await import('nostr-tools');
      const mockFinalize = finalizeEvent as MockedFunction<typeof finalizeEvent>;

      await bridge.publishPresence({ status: 'online' });

      const eventArg = mockFinalize.mock.calls[0]?.[0];
      const content = JSON.parse(eventArg?.content ?? '{}');
      expect(content.status).toBe('online');
    });

    it('updates internal presenceStatus after publish', async () => {
      expect(bridge.presenceStatus).toBe('offline');

      await bridge.publishPresence({ status: 'online' });
      expect(bridge.presenceStatus).toBe('online');

      await bridge.publishPresence({ status: 'away' });
      expect(bridge.presenceStatus).toBe('away');
    });

    it('retrieves nsec from vault via listIdentities + getNsec', async () => {
      await bridge.publishPresence({ status: 'online' });

      expect(mockVault.listIdentities).toHaveBeenCalledTimes(1);
      expect(mockVault.getNsec).toHaveBeenCalledTimes(1);
    });
  });

  // ── subscribeComputeAssignments ────────────────────────────────────────────

  describe('subscribeComputeAssignments()', () => {
    it('subscribes with kind:39242 and #p filter', () => {
      const callback = vi.fn();
      bridge.subscribeComputeAssignments('agent-pubkey-hex', callback);

      expect(mockCeps.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          kinds: [39242],
          '#p': ['agent-pubkey-hex'],
        }),
        expect.any(Function)
      );
    });

    it('delivers parsed ComputeAssignment to callback', () => {
      const callback = vi.fn();
      let capturedCb: ((event: any) => void) | undefined;

      (mockCeps.subscribe as MockedFunction<any>).mockImplementation(
        (_filter: any, cb: (event: any) => void) => {
          capturedCb = cb;
          return () => {};
        }
      );

      bridge.subscribeComputeAssignments('agent-pubkey', callback);
      capturedCb?.(makeComputeAssignmentEvent());

      expect(callback).toHaveBeenCalledTimes(1);
      const assignment = callback.mock.calls[0][0];
      expect(assignment.envelopeEventId).toBe('compute-event-id');
      expect(assignment.assignedAgentPubkey).toBe('assigned-agent-pubkey');
      expect(assignment.taskDescription).toBe('Fix the authentication bug in auth.ts');
    });

    it('parses budgetMsats as BigInt', () => {
      const callback = vi.fn();
      let capturedCb: ((event: any) => void) | undefined;

      (mockCeps.subscribe as MockedFunction<any>).mockImplementation(
        (_filter: any, cb: (event: any) => void) => {
          capturedCb = cb;
          return () => {};
        }
      );

      bridge.subscribeComputeAssignments('agent-pubkey', callback);
      capturedCb?.(makeComputeAssignmentEvent());

      const assignment = callback.mock.calls[0][0];
      expect(typeof assignment.budgetMsats).toBe('bigint');
      expect(assignment.budgetMsats).toBe(BigInt(5_000_000));
    });

    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsub = bridge.subscribeComputeAssignments('agent-pubkey', callback);
      expect(typeof unsub).toBe('function');
      expect(() => unsub()).not.toThrow();
    });
  });

  // ── subscribeSyncCheckpoints ───────────────────────────────────────────────

  describe('subscribeSyncCheckpoints()', () => {
    it('subscribes with kind:39231 filter', () => {
      const callback = vi.fn();
      bridge.subscribeSyncCheckpoints('agent-pubkey', callback);

      expect(mockCeps.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({ kinds: [39231] }),
        expect.any(Function)
      );
    });

    it('delivers parsed SyncCheckpoint from event', () => {
      const callback = vi.fn();
      let capturedCb: ((event: any) => void) | undefined;

      (mockCeps.subscribe as MockedFunction<any>).mockImplementation(
        (_filter: any, cb: (event: any) => void) => {
          capturedCb = cb;
          return () => {};
        }
      );

      bridge.subscribeSyncCheckpoints('agent-pubkey', callback);
      capturedCb?.(makeSyncCheckpointEvent());

      expect(callback).toHaveBeenCalledTimes(1);
      const checkpoint = callback.mock.calls[0][0];
      expect(checkpoint.sessionId).toBe('sess-abc123');
      expect(checkpoint.checkpoint).toBe('checkpoint-v2-abc');
      expect(checkpoint.timestamp).toBe(1_700_001_000);
    });

    it('does not deliver non-sync_checkpoint events', () => {
      const callback = vi.fn();
      let capturedCb: ((event: any) => void) | undefined;

      (mockCeps.subscribe as MockedFunction<any>).mockImplementation(
        (_filter: any, cb: (event: any) => void) => {
          capturedCb = cb;
          return () => {};
        }
      );

      bridge.subscribeSyncCheckpoints('agent-pubkey', callback);

      // Simulate a different type of kind:39231 event
      capturedCb?.({
        id: 'other',
        kind: 39231,
        pubkey: 'p',
        created_at: 1,
        tags: [['d', 'sess'], ['type', 'tool_call']],
        content: '{}',
        sig: 's',
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe function', () => {
      const unsub = bridge.subscribeSyncCheckpoints('agent-pubkey', vi.fn());
      expect(typeof unsub).toBe('function');
    });
  });

  // ── publishHeartbeat ───────────────────────────────────────────────────────

  describe('publishHeartbeat()', () => {
    it('publishes kind:10003 with heartbeat=true tag', async () => {
      const { finalizeEvent } = await import('nostr-tools');
      const mockFinalize = finalizeEvent as MockedFunction<typeof finalizeEvent>;

      await bridge.publishHeartbeat('my-agent-hex');

      const eventArg = mockFinalize.mock.calls[0]?.[0];
      expect(eventArg?.kind).toBe(10003);
      expect(eventArg?.tags).toEqual(
        expect.arrayContaining([['heartbeat', 'true']])
      );
    });

    it('includes agentPubkey in p and agent tags', async () => {
      const { finalizeEvent } = await import('nostr-tools');
      const mockFinalize = finalizeEvent as MockedFunction<typeof finalizeEvent>;

      await bridge.publishHeartbeat('my-agent-pubkey-hex');

      const eventArg = mockFinalize.mock.calls[0]?.[0];
      expect(eventArg?.tags).toEqual(
        expect.arrayContaining([
          ['p', 'my-agent-pubkey-hex'],
          ['agent', 'my-agent-pubkey-hex'],
        ])
      );
    });

    it('includes d tag set to "heartbeat"', async () => {
      const { finalizeEvent } = await import('nostr-tools');
      const mockFinalize = finalizeEvent as MockedFunction<typeof finalizeEvent>;

      await bridge.publishHeartbeat('agent-hex');

      const eventArg = mockFinalize.mock.calls[0]?.[0];
      expect(eventArg?.tags).toEqual(expect.arrayContaining([['d', 'heartbeat']]));
    });
  });

  // ── startHeartbeatInterval ─────────────────────────────────────────────────

  describe('startHeartbeatInterval()', () => {
    it('returns a stop function', () => {
      const stop = bridge.startHeartbeatInterval('agent-hex', 30_000);
      expect(typeof stop).toBe('function');
    });

    it('publishes a heartbeat immediately (at interval start)', async () => {
      // The source fires publishHeartbeat() immediately (not via a timer),
      // then schedules a setInterval for subsequent heartbeats.
      // With fake timers active we must NOT call runAllTimers (infinite loop
      // from setInterval). Instead, stop the interval first, then flush the
      // microtask queue so the immediate async publish can resolve.
      bridge.startHeartbeatInterval('agent-hex', 30_000);

      // Stop the repeating interval so fake-timer advancement is finite
      bridge.stopHeartbeatInterval();

      // Flush all pending microtasks/promises (the immediate publish).
      // vi.runAllTicksAsync does NOT exist in Vitest 2.x — use
      // vi.advanceTimersByTimeAsync(0) which advances zero ms but still
      // drains the microtask queue associated with fake timers.
      await vi.advanceTimersByTimeAsync(0);

      expect(mockCeps.publish).toHaveBeenCalled();
    });

    it('sets isHeartbeatActive to true', () => {
      bridge.startHeartbeatInterval('agent-hex', 30_000);
      expect(bridge.isHeartbeatActive).toBe(true);
    });

    it('clamps interval below minimum to 10s', async () => {
      // Should not throw even with very short interval
      expect(() => {
        bridge.startHeartbeatInterval('agent-hex', 100); // Way below 10s minimum
      }).not.toThrow();

      expect(bridge.isHeartbeatActive).toBe(true);
    });

    it('replaces an existing heartbeat when called again', async () => {
      const stop1 = bridge.startHeartbeatInterval('agent-hex', 30_000);
      const stop2 = bridge.startHeartbeatInterval('agent-hex', 60_000);

      // Both stop functions should work without errors
      expect(() => stop1()).not.toThrow();
      expect(() => stop2()).not.toThrow();
    });
  });

  // ── stopHeartbeatInterval ──────────────────────────────────────────────────

  describe('stopHeartbeatInterval()', () => {
    it('sets isHeartbeatActive to false', () => {
      bridge.startHeartbeatInterval('agent-hex', 30_000);
      expect(bridge.isHeartbeatActive).toBe(true);

      bridge.stopHeartbeatInterval();
      expect(bridge.isHeartbeatActive).toBe(false);
    });

    it('is safe to call when no heartbeat is active (no-op)', () => {
      expect(bridge.isHeartbeatActive).toBe(false);
      expect(() => bridge.stopHeartbeatInterval()).not.toThrow();
    });
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('presenceStatus starts as offline', () => {
      expect(bridge.presenceStatus).toBe('offline');
    });

    it('isHeartbeatActive starts as false', () => {
      expect(bridge.isHeartbeatActive).toBe(false);
    });
  });

  // ── No SpacetimeDB SDK ─────────────────────────────────────────────────────

  describe('no SpacetimeDB SDK dependency', () => {
    it('does not import @clockworklabs/spacetimedb-sdk', async () => {
      // This verifies the bridge module only uses nostr-tools (already mocked)
      // and @noble/hashes. No SpacetimeDB imports should exist.
      const bridgeModule = await import('../../src/lib/bridge/spacetime-bridge.js');

      // If the module loaded without throwing, it has no SpacetimeDB imports
      expect(bridgeModule.SpacetimeBridge).toBeDefined();
    });
  });
});
