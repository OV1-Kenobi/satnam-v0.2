/**
 * Calls — NostrSignaling
 * Spec: circle-of-trust-spec.md § calls/signaling.ts
 *
 * WebRTC signaling over Nostr NIP-44 encrypted messages.
 * Uses ephemeral kind:25050 events for offer/answer/ICE/hangup.
 *
 * Phase 1: simulated relay (event emitter).
 * Phase 2: replace emitEvent / subscribeRelay with real relay pool.
 */

import type {
  SignalingMessage,
  SignalingMessageType,
  CallType,
} from './types.js';
import { SIGNALING_KIND } from './types.js';

type SignalingCallback = (msg: SignalingMessage, fromPubkey: string) => void;

// ---------------------------------------------------------------------------
// NostrSignaling
// ---------------------------------------------------------------------------

export class NostrSignaling {
  private readonly selfPubkey: string;
  private readonly listeners: SignalingCallback[] = [];
  private simulatedSub: ReturnType<typeof setInterval> | null = null;

  constructor(selfPubkey: string) {
    this.selfPubkey = selfPubkey;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Publish a NIP-44 encrypted kind:25050 event.
   * Phase 1: stored in sessionStorage for same-tab testing.
   * Phase 2: publish via relay pool.
   */
  private async emitEvent(toPubkey: string, msg: SignalingMessage): Promise<void> {
    const event = {
      kind: SIGNALING_KIND,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: this.selfPubkey,
      tags: [['p', toPubkey]],
      content: JSON.stringify(msg), // Phase 2: NIP-44 encrypted
    };

    // Phase 1 simulation: push to a shared in-memory bus
    const bus = (window as any).__satnamSignalingBus as SignalingEvent[] | undefined;
    if (bus) {
      bus.push({ from: this.selfPubkey, to: toPubkey, msg });
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Send SDP offer to peer */
  async sendOffer(peerPubkey: string, sdp: string, callId: string, callType: CallType): Promise<void> {
    await this.emitEvent(peerPubkey, { type: 'offer', sdp, callId, callType });
  }

  /** Send SDP answer to peer */
  async sendAnswer(peerPubkey: string, sdp: string, callId: string, callType: CallType): Promise<void> {
    await this.emitEvent(peerPubkey, { type: 'answer', sdp, callId, callType });
  }

  /** Send ICE candidate */
  async sendIceCandidate(
    peerPubkey: string,
    candidate: RTCIceCandidateInit,
    callId: string,
  ): Promise<void> {
    await this.emitEvent(peerPubkey, { type: 'ice-candidate', candidate, callId, callType: 'audio' });
  }

  /** Send hangup signal */
  async sendHangup(peerPubkey: string, callId: string): Promise<void> {
    await this.emitEvent(peerPubkey, { type: 'hangup', callId, callType: 'audio' });
  }

  /**
   * Subscribe to incoming signaling events.
   * Returns an unsubscribe function.
   */
  subscribe(callback: SignalingCallback): () => void {
    this.listeners.push(callback);

    // Phase 1: poll the in-memory bus
    if (!(window as any).__satnamSignalingBus) {
      (window as any).__satnamSignalingBus = [];
    }

    const interval = setInterval(() => {
      const bus = (window as any).__satnamSignalingBus as SignalingEvent[];
      const pending = bus.filter(e => e.to === this.selfPubkey && !e.delivered);
      for (const event of pending) {
        event.delivered = true;
        for (const listener of this.listeners) {
          listener(event.msg, event.from);
        }
      }
    }, 500);

    this.simulatedSub = interval;

    return () => {
      clearInterval(interval);
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /** Cleanup */
  destroy(): void {
    if (this.simulatedSub !== null) {
      clearInterval(this.simulatedSub);
    }
    this.listeners.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Internal simulation type
// ---------------------------------------------------------------------------

interface SignalingEvent {
  from: string;
  to: string;
  msg: SignalingMessage;
  delivered?: boolean;
}
