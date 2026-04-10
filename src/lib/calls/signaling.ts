/**
 * Calls — NostrSignaling
 * Spec: circle-of-trust-spec.md § calls/signaling.ts
 *
 * WebRTC signaling over Nostr NIP-17 sealed GiftWrap (kind:1059).
 * Uses NIP-17 gift-wrapped messages to route offer/answer/ICE/hangup between
 * callers over the Nostr relay network via the CEPS event publishing service.
 *
 * ## Privacy model
 * All signaling messages (SDP offers, answers, ICE candidates, hangup) are
 * sent as NIP-17 gift-wrapped events:
 *   - Outer wrapper: kind:1059 (gift wrap) — encrypted NIP-44 to recipient
 *   - Inner seal: kind:13 (seal) — signed by sender's ephemeral key
 *   - Innermost rumor: the actual signaling payload (JSON-encoded SignalingMessage)
 *
 * Call setup metadata (who is calling whom, SDP details, ICE candidates) is
 * NOT visible on the relay. Only the recipient's pubkey tag leaks.
 *
 * ## Session initialisation
 * The caller must first create a CEPS session for the nsec (via
 * SatnamPrivacyFirstCommunications.createFromVault) before constructing
 * NostrSignaling. The sessionId returned by CEPS identifies the authenticated
 * session used to sign and publish events.
 *
 * ## Subscription (Phase 2)
 * Incoming GiftWrap events are received through CEPS subscriptions. The current
 * implementation provides a hook point for the subscription callback; wiring
 * to the CEPS subscription API is delegated to the useCalls hook.
 */

import type {
  SignalingMessage,
  CallType,
} from './types.js';
import {
  SatnamPrivacyFirstCommunications,
  type GiftwrappedMessageConfig,
} from '../nip17/index.js';

type SignalingCallback = (msg: SignalingMessage, fromPubkey: string) => void;

// ---------------------------------------------------------------------------
// NostrSignaling
// ---------------------------------------------------------------------------

export class NostrSignaling {
  private readonly selfPubkey: string;
  private readonly messaging: SatnamPrivacyFirstCommunications;
  private readonly listeners: SignalingCallback[] = [];

  /**
   * @param selfPubkey - Hex-encoded public key of this participant
   * @param cepsSessionId - Active CEPS session ID (from SatnamPrivacyFirstCommunications.createFromVault)
   */
  constructor(selfPubkey: string, cepsSessionId: string = '') {
    this.selfPubkey = selfPubkey;
    this.messaging = new SatnamPrivacyFirstCommunications(cepsSessionId);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Publish a NIP-17 sealed GiftWrap event carrying the signaling payload.
   *
   * The SignalingMessage is JSON-encoded and sent as the gift-wrap content.
   * The CEPS layer handles ephemeral key generation, NIP-44 encryption,
   * and relay publishing.
   */
  private async emitEvent(toPubkey: string, msg: SignalingMessage): Promise<void> {
    const config: GiftwrappedMessageConfig = {
      content: JSON.stringify(msg),
      recipient: toPubkey,
      sender: this.selfPubkey,
      encryptionLevel: 'maximum',
      communicationType: 'individual',
      messageType: 'direct',
    };

    const result = await this.messaging.sendGiftwrappedMessage(config);
    if (!result.success) {
      console.warn('[signaling] emitEvent failed:', result.error);
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
   * Register a callback for incoming signaling messages.
   *
   * Phase 2 implementation: This registers the callback for delivery
   * by the useCalls hook when it decrypts incoming NIP-17 gift-wrap events
   * from the CEPS subscription.
   *
   * @param callback - Called with (msg, fromPubkey) for each incoming signal
   * @returns Unsubscribe function
   */
  subscribe(callback: SignalingCallback): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  /**
   * Deliver an incoming decrypted signaling message to all registered callbacks.
   *
   * Called by the useCalls hook after it decrypts an incoming NIP-17 event
   * and confirms the payload is a SignalingMessage.
   *
   * @param rawContent - Decrypted gift-wrap content string (JSON-encoded SignalingMessage)
   * @param fromPubkey - Hex-encoded pubkey of the sender
   */
  deliver(rawContent: string, fromPubkey: string): void {
    try {
      const msg = JSON.parse(rawContent) as SignalingMessage;
      if (msg && typeof msg.type === 'string' && typeof msg.callId === 'string') {
        for (const listener of this.listeners) {
          listener(msg, fromPubkey);
        }
      }
    } catch {
      // Not a valid signaling message — ignore
    }
  }

  /** Cleanup — clear all listeners */
  destroy(): void {
    this.listeners.length = 0;
  }
}


