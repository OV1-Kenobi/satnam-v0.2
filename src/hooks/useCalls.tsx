/**
 * useCalls — React hook for WebRTC calls via Nostr signaling
 * Spec: circle-of-trust-spec.md § useCalls.tsx
 *
 * Provides:
 *   activeCall       — current call session (if any)
 *   incomingCall     — incoming call awaiting answer (if any)
 *   initiateCall     — start outgoing call
 *   answerCall       — accept incoming call
 *   rejectCall       — reject incoming call
 *   endCall          — hang up
 *   toggleMute       — mute/unmute local audio
 *   toggleVideo      — enable/disable local video
 *   isMuted          — current mute state
 *   isVideoOff       — current video state
 *   localStream      — local MediaStream
 *   remoteStream     — remote MediaStream
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { NostrSignaling }       from '../lib/calls/signaling.js';
import { PeerConnectionManager } from '../lib/calls/peer-connection.js';
import type { CallSession, CallType, SignalingMessage } from '../lib/calls/types.js';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCalls(selfPubkey?: string) {
  const [activeCall,    setActiveCall]    = useState<CallSession | null>(null);
  const [incomingCall,  setIncomingCall]  = useState<CallSession | null>(null);
  const [isMuted,       setIsMuted]       = useState(false);
  const [isVideoOff,    setIsVideoOff]    = useState(false);
  const [localStream,   setLocalStream]   = useState<MediaStream | null>(null);
  const [remoteStream,  setRemoteStream]  = useState<MediaStream | null>(null);
  const [callDuration,  setCallDuration]  = useState(0);

  const signalingRef = useRef<NostrSignaling | null>(null);
  const peerRef      = useRef<PeerConnectionManager | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Setup signaling ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!selfPubkey) return;

    const signaling = new NostrSignaling(selfPubkey);
    signalingRef.current = signaling;

    const unsub = signaling.subscribe(handleIncomingSignal);

    return () => {
      unsub();
      signaling.destroy();
      signalingRef.current = null;
    };
  }, [selfPubkey]);

  // ── Duration timer ───────────────────────────────────────────────────────

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCallDuration(0);
    timerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ── Incoming signal handler ──────────────────────────────────────────────

  const handleIncomingSignal = useCallback(
    async (msg: SignalingMessage, fromPubkey: string) => {
      switch (msg.type) {
        case 'offer': {
          const session: CallSession = {
            id:         msg.callId,
            peerPubkey: fromPubkey,
            type:       msg.callType,
            state:      'incoming',
            startedAt:  Math.floor(Date.now() / 1000),
            isOutgoing: false,
          };
          setIncomingCall(session);
          break;
        }

        case 'answer': {
          if (!peerRef.current || !msg.sdp) return;
          await peerRef.current.handleAnswer(msg.sdp);
          setActiveCall(prev => prev ? { ...prev, state: 'connected', connectedAt: Math.floor(Date.now() / 1000) } : prev);
          startTimer();
          break;
        }

        case 'ice-candidate': {
          if (!peerRef.current || !msg.candidate) return;
          await peerRef.current.addIceCandidate(msg.candidate);
          break;
        }

        case 'hangup': {
          cleanup();
          setActiveCall(prev => prev ? { ...prev, state: 'ended', endedAt: Math.floor(Date.now() / 1000) } : null);
          setTimeout(() => setActiveCall(null), 3000);
          break;
        }
      }
    },
    [startTimer],
  );

  // ── Cleanup ──────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    stopTimer();
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsVideoOff(false);
  }, [stopTimer]);

  // ── Initiate outgoing call ───────────────────────────────────────────────

  const initiateCall = useCallback(
    async (peerPubkey: string, type: CallType) => {
      if (!signalingRef.current) return;

      const callId   = crypto.randomUUID();
      const session: CallSession = {
        id:         callId,
        peerPubkey,
        type,
        state:      'ringing',
        startedAt:  Math.floor(Date.now() / 1000),
        isOutgoing: true,
      };
      setActiveCall(session);

      // Setup WebRTC
      const peer = new PeerConnectionManager();
      peerRef.current = peer;

      peer.onRemoteStream = stream => setRemoteStream(stream);
      peer.onIceCandidate = candidate => {
        signalingRef.current?.sendIceCandidate(peerPubkey, candidate, callId);
      };
      peer.onConnectionStateChange = state => {
        if (state === 'connected') {
          setActiveCall(prev => prev ? { ...prev, state: 'connected', connectedAt: Math.floor(Date.now() / 1000) } : prev);
          startTimer();
        } else if (state === 'failed' || state === 'disconnected') {
          cleanup();
          setActiveCall(prev => prev ? { ...prev, state: 'failed' } : null);
        }
      };

      const stream = await peer.getLocalStream(type);
      setLocalStream(stream);

      const offer = await peer.createOffer();
      if (offer.sdp) {
        await signalingRef.current.sendOffer(peerPubkey, offer.sdp, callId, type);
      }
    },
    [startTimer, cleanup],
  );

  // ── Answer incoming call ─────────────────────────────────────────────────

  const answerCall = useCallback(async () => {
    if (!incomingCall || !signalingRef.current) return;

    const session: CallSession = { ...incomingCall, state: 'connecting' };
    setActiveCall(session);
    setIncomingCall(null);

    const peer = new PeerConnectionManager();
    peerRef.current = peer;

    peer.onRemoteStream = stream => setRemoteStream(stream);
    peer.onIceCandidate = candidate => {
      signalingRef.current?.sendIceCandidate(session.peerPubkey, candidate, session.id);
    };

    const stream = await peer.getLocalStream(session.type);
    setLocalStream(stream);

    // Note: In real implementation, the SDP would be cached from the incoming offer event.
    // For Phase 1 this is a no-op placeholder.
  }, [incomingCall]);

  // ── Reject incoming call ─────────────────────────────────────────────────

  const rejectCall = useCallback(() => {
    if (!incomingCall || !signalingRef.current) return;
    signalingRef.current.sendHangup(incomingCall.peerPubkey, incomingCall.id);
    setIncomingCall(null);
  }, [incomingCall]);

  // ── End active call ──────────────────────────────────────────────────────

  const endCall = useCallback(() => {
    if (!activeCall || !signalingRef.current) return;
    signalingRef.current.sendHangup(activeCall.peerPubkey, activeCall.id);
    cleanup();
    setActiveCall(null);
  }, [activeCall, cleanup]);

  // ── Mute toggle ──────────────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    peerRef.current?.setAudioEnabled(!next);
  }, [isMuted]);

  // ── Video toggle ─────────────────────────────────────────────────────────

  const toggleVideo = useCallback(() => {
    const next = !isVideoOff;
    setIsVideoOff(next);
    peerRef.current?.setVideoEnabled(!next);
  }, [isVideoOff]);

  return {
    activeCall,
    incomingCall,
    initiateCall,
    answerCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleVideo,
    isMuted,
    isVideoOff,
    localStream,
    remoteStream,
    callDuration,
  };
}

export default useCalls;

