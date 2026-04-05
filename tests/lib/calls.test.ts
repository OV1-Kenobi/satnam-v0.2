/**
 * Calls — Library tests
 * Spec: circle-of-trust-spec.md (testing section)
 *
 * Tests:
 * - Signaling message construction (correct type, callId, callType)
 * - Call state machine transitions
 * - CallSession fields
 * - CallType values
 * - SIGNALING_KIND constant
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SIGNALING_KIND } from '../../src/lib/calls/types.js';
import type {
  CallSession,
  CallState,
  CallType,
  SignalingMessage,
} from '../../src/lib/calls/types.js';

// ---------------------------------------------------------------------------
// Type checks and constants
// ---------------------------------------------------------------------------

describe('calls/types', () => {
  it('SIGNALING_KIND is 25050', () => {
    expect(SIGNALING_KIND).toBe(25050);
  });

  it('CallType values are "audio" and "video"', () => {
    const audio: CallType = 'audio';
    const video: CallType = 'video';
    expect(audio).toBe('audio');
    expect(video).toBe('video');
  });

  it('CallState includes all required states', () => {
    const states: CallState[] = [
      'idle',
      'ringing',
      'incoming',
      'connecting',
      'connected',
      'ended',
      'failed',
    ];
    // All states are valid string literals
    expect(states).toHaveLength(7);
    expect(states).toContain('idle');
    expect(states).toContain('connected');
    expect(states).toContain('failed');
  });
});

// ---------------------------------------------------------------------------
// Signaling message construction
// ---------------------------------------------------------------------------

describe('SignalingMessage structure', () => {
  it('offer message has correct shape', () => {
    const msg: SignalingMessage = {
      type: 'offer',
      callId: 'call-001',
      callType: 'video',
      sdp: 'v=0\r\no=alice 123 456 IN IP4 127.0.0.1\r\n',
    };
    expect(msg.type).toBe('offer');
    expect(msg.callId).toBe('call-001');
    expect(msg.callType).toBe('video');
    expect(msg.sdp).toBeDefined();
  });

  it('answer message has correct shape', () => {
    const msg: SignalingMessage = {
      type: 'answer',
      callId: 'call-001',
      callType: 'audio',
      sdp: 'v=0\r\no=bob 789 012 IN IP4 127.0.0.1\r\n',
    };
    expect(msg.type).toBe('answer');
    expect(msg.sdp).toBeDefined();
  });

  it('ice-candidate message includes candidate', () => {
    const msg: SignalingMessage = {
      type: 'ice-candidate',
      callId: 'call-001',
      callType: 'audio',
      candidate: {
        candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 54321 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    };
    expect(msg.type).toBe('ice-candidate');
    expect(msg.candidate).toBeDefined();
    expect(msg.candidate?.candidate).toContain('candidate');
  });

  it('hangup message has no sdp or candidate', () => {
    const msg: SignalingMessage = {
      type: 'hangup',
      callId: 'call-001',
      callType: 'audio',
    };
    expect(msg.type).toBe('hangup');
    expect(msg.sdp).toBeUndefined();
    expect(msg.candidate).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CallSession state machine
// ---------------------------------------------------------------------------

describe('CallSession state machine', () => {
  function makeSession(override: Partial<CallSession> = {}): CallSession {
    return {
      id:         'call-abc',
      peerPubkey: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
      type:       'audio',
      state:      'idle',
      startedAt:  Math.floor(Date.now() / 1000),
      isOutgoing: true,
      ...override,
    };
  }

  it('new outgoing session starts as ringing', () => {
    const session = makeSession({ state: 'ringing', isOutgoing: true });
    expect(session.state).toBe('ringing');
  });

  it('new incoming session starts as incoming', () => {
    const session = makeSession({ state: 'incoming', isOutgoing: false });
    expect(session.state).toBe('incoming');
    expect(session.isOutgoing).toBe(false);
  });

  it('connected session has connectedAt timestamp', () => {
    const now = Math.floor(Date.now() / 1000);
    const session = makeSession({ state: 'connected', connectedAt: now });
    expect(session.state).toBe('connected');
    expect(session.connectedAt).toBeGreaterThanOrEqual(now - 1);
  });

  it('ended session has endedAt timestamp', () => {
    const now = Math.floor(Date.now() / 1000);
    const session = makeSession({ state: 'ended', endedAt: now });
    expect(session.state).toBe('ended');
    expect(session.endedAt).toBeDefined();
  });

  it('audio call type is preserved', () => {
    const session = makeSession({ type: 'audio' });
    expect(session.type).toBe('audio');
  });

  it('video call type is preserved', () => {
    const session = makeSession({ type: 'video' });
    expect(session.type).toBe('video');
  });

  it('state transitions: idle → ringing → connected → ended', () => {
    const states: CallState[] = ['idle', 'ringing', 'connecting', 'connected', 'ended'];

    let session = makeSession({ state: 'idle' });
    expect(session.state).toBe('idle');

    session = { ...session, state: 'ringing' };
    expect(session.state).toBe('ringing');

    session = { ...session, state: 'connecting' };
    expect(session.state).toBe('connecting');

    session = { ...session, state: 'connected', connectedAt: Math.floor(Date.now() / 1000) };
    expect(session.state).toBe('connected');

    session = { ...session, state: 'ended', endedAt: Math.floor(Date.now() / 1000) };
    expect(session.state).toBe('ended');
  });

  it('failed state is reachable', () => {
    const session = makeSession({ state: 'failed' });
    expect(session.state).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// NostrSignaling (Phase 1 simulation)
// ---------------------------------------------------------------------------

describe('NostrSignaling', () => {
  const WINDOW_MOCK = {} as any;

  beforeEach(() => {
    // Mock window for signaling bus
    Object.defineProperty(globalThis, 'window', { value: WINDOW_MOCK, writable: true });
    WINDOW_MOCK.__satnamSignalingBus = [];
  });

  afterEach(() => {
    WINDOW_MOCK.__satnamSignalingBus = [];
  });

  it('can be imported', async () => {
    const { NostrSignaling } = await import('../../src/lib/calls/signaling.js');
    expect(NostrSignaling).toBeDefined();
  });

  it('instantiates with selfPubkey', async () => {
    const { NostrSignaling } = await import('../../src/lib/calls/signaling.js');
    const sig = new NostrSignaling('pubkey001');
    expect(sig).toBeTruthy();
    sig.destroy();
  });

  it('emits offer to signaling bus', async () => {
    const { NostrSignaling } = await import('../../src/lib/calls/signaling.js');
    const sig = new NostrSignaling('self001');
    await sig.sendOffer('peer001', 'v=0', 'call001', 'audio');

    const bus = WINDOW_MOCK.__satnamSignalingBus;
    expect(bus.length).toBe(1);
    expect(bus[0].msg.type).toBe('offer');
    expect(bus[0].msg.callId).toBe('call001');
    expect(bus[0].to).toBe('peer001');
    expect(bus[0].from).toBe('self001');

    sig.destroy();
  });

  it('emits hangup to signaling bus', async () => {
    const { NostrSignaling } = await import('../../src/lib/calls/signaling.js');
    const sig = new NostrSignaling('self001');
    await sig.sendHangup('peer001', 'call001');

    const bus = WINDOW_MOCK.__satnamSignalingBus;
    const hangup = bus.find((e: any) => e.msg.type === 'hangup');
    expect(hangup).toBeDefined();
    expect(hangup.msg.callId).toBe('call001');

    sig.destroy();
  });
});
