/**
 * Voice/Video Calls — Types
 * Spec: circle-of-trust-spec.md § calls/types.ts
 *
 * WebRTC signaling over Nostr NIP-44 encrypted messages.
 * Kind:25050 — ephemeral signaling events (custom ephemeral range)
 */

export type CallType = 'audio' | 'video';

export type CallState =
  | 'idle'
  | 'ringing'      // Outgoing: waiting for answer
  | 'incoming'     // Incoming: ringing on our side
  | 'connecting'   // ICE negotiation in progress
  | 'connected'    // Active call
  | 'ended'        // Call terminated normally
  | 'failed';      // Error / rejected

export interface CallSession {
  /** Unique call ID (generated locally) */
  id: string;
  /** Peer's Nostr pubkey */
  peerPubkey: string;
  /** Audio or video */
  type: CallType;
  /** Current state */
  state: CallState;
  /** Unix timestamp when call was initiated */
  startedAt: number;
  /** Unix timestamp when call connected (if connected) */
  connectedAt?: number;
  /** Unix timestamp when call ended (if ended) */
  endedAt?: number;
  /** Whether we initiated the call */
  isOutgoing: boolean;
}

export type SignalingMessageType =
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'hangup';

export interface SignalingMessage {
  type: SignalingMessageType;
  callId: string;
  callType: CallType;
  /** SDP offer or answer */
  sdp?: string;
  /** ICE candidate */
  candidate?: RTCIceCandidateInit;
}

/** Nostr event kind for WebRTC signaling (ephemeral) */
export const SIGNALING_KIND = 25050;
