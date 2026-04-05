/**
 * Calls — PeerConnectionManager
 * Spec: circle-of-trust-spec.md § calls/peer-connection.ts
 *
 * WebRTC PeerConnection wrapper:
 * - createOffer(): RTCSessionDescription
 * - handleOffer(sdp): create answer
 * - handleAnswer(sdp): set remote description
 * - addIceCandidate(candidate)
 * - getLocalStream(type: CallType): getUserMedia
 * - onRemoteStream callback
 * - close()
 */

import type { CallType } from './types.js';

// ---------------------------------------------------------------------------
// Default ICE server config
// ---------------------------------------------------------------------------

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ---------------------------------------------------------------------------
// PeerConnectionManager
// ---------------------------------------------------------------------------

export class PeerConnectionManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;

  /** Called when a remote media track is received */
  onRemoteStream?: (stream: MediaStream) => void;
  /** Called when an ICE candidate is generated (should be sent to peer) */
  onIceCandidate?: (candidate: RTCIceCandidateInit) => void;
  /** Called when connection state changes */
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;

  // ── Setup ────────────────────────────────────────────────────────────────

  private ensurePeerConnection(): RTCPeerConnection {
    if (this.pc) return this.pc;

    this.pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });

    this.pc.onicecandidate = (evt) => {
      if (evt.candidate && this.onIceCandidate) {
        this.onIceCandidate(evt.candidate.toJSON());
      }
    };

    this.pc.ontrack = (evt) => {
      const [stream] = evt.streams;
      if (stream && this.onRemoteStream) {
        this.onRemoteStream(stream);
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (this.pc && this.onConnectionStateChange) {
        this.onConnectionStateChange(this.pc.connectionState);
      }
    };

    return this.pc;
  }

  // ── Media stream ─────────────────────────────────────────────────────────

  /** Acquire user media (microphone / camera) */
  async getLocalStream(type: CallType): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: true,
      video: type === 'video' ? { width: 1280, height: 720 } : false,
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      // Fallback: audio-only if video is denied
      if (type === 'video') {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } else {
        throw err;
      }
    }

    return this.localStream;
  }

  /** Add local tracks to the peer connection */
  private addLocalTracks(): void {
    if (!this.localStream || !this.pc) return;
    for (const track of this.localStream.getTracks()) {
      this.pc.addTrack(track, this.localStream);
    }
  }

  // ── Offer / Answer ───────────────────────────────────────────────────────

  /** Create an SDP offer (caller side) */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const pc = this.ensurePeerConnection();
    this.addLocalTracks();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }

  /**
   * Handle incoming offer (callee side).
   * Adds local tracks and returns an answer.
   */
  async handleOffer(sdp: string): Promise<RTCSessionDescriptionInit> {
    const pc = this.ensurePeerConnection();
    this.addLocalTracks();

    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }

  /** Handle incoming answer (caller side) */
  async handleAnswer(sdp: string): Promise<void> {
    const pc = this.ensurePeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
  }

  /** Add a remote ICE candidate */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.ensurePeerConnection();
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Silently ignore stale ICE candidates
    }
  }

  // ── Mute / Video toggle ──────────────────────────────────────────────────

  setAudioEnabled(enabled: boolean): void {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }

  setVideoEnabled(enabled: boolean): void {
    if (!this.localStream) return;
    for (const track of this.localStream.getVideoTracks()) {
      track.enabled = enabled;
    }
  }

  get localStreamRef(): MediaStream | null {
    return this.localStream;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  close(): void {
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }
}
