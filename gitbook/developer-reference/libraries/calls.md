# Calls Library

**Module path:** `src/lib/calls/`
**Import alias:** `@lib/calls`
**Signaling protocol:** NIP-44 encrypted ephemeral events (kind:25050)
**Media protocol:** WebRTC (DTLS-SRTP)

---

## Overview

The calls library provides WebRTC voice and video calling between PoL-verified Nostr contacts. Signaling (offer/answer negotiation and ICE candidate exchange) is handled over Nostr via encrypted `kind:25050` ephemeral events. Media flows directly peer-to-peer once the WebRTC connection is established.

**Key modules:**
- `signaling.ts` — Nostr signaling (kind:25050 offer/answer/ICE)
- `peer-connection.ts` — WebRTC PeerConnection wrapper
- `types.ts` — Call types and state machine
- `index.ts` — Barrel export

---

## Types

### `CallSession`

```typescript
interface CallSession {
  sessionId: string;          // Random UUID per call
  peerPubkey: string;         // The other party's Nostr pubkey
  type: 'voice' | 'video';
  state: CallState;
  initiatedAt: number;        // Unix timestamp
  connectedAt?: number;       // Unix timestamp (set when CONNECTED)
  endedAt?: number;           // Unix timestamp (set when ENDED)
}

type CallState = 'IDLE' | 'RINGING' | 'CONNECTED' | 'ENDED';
```

### `SignalingMessage`

```typescript
interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'hangup';
  sessionId: string;
  // For offer/answer:
  sdp?: RTCSessionDescriptionInit;
  // For ice-candidate:
  candidate?: RTCIceCandidateInit;
}
```

---

## NostrSignaling Class

**File:** `src/lib/calls/signaling.ts`

The `NostrSignaling` class handles call setup via Nostr. Signaling messages are sent as NIP-44 encrypted `kind:25050` ephemeral events — only the two parties can read the offer/answer content.

```typescript
class NostrSignaling {
  constructor(
    signer: NostrSigner,
    ceps: CepsClient,
    relays: string[]
  );

  /**
   * Send a signaling message to a peer.
   * Message is NIP-44 encrypted to the peer's pubkey and published
   * as a kind:25050 ephemeral event.
   *
   * @param peerPubkey - Recipient's Nostr pubkey
   * @param message    - SignalingMessage payload
   */
  send(peerPubkey: string, message: SignalingMessage): Promise<void>;

  /**
   * Subscribe to incoming signaling messages.
   * Callback is invoked for each decrypted kind:25050 addressed to self.
   * Returns an unsubscribe function.
   */
  subscribe(
    callback: (from: string, message: SignalingMessage) => void
  ): () => void;

  /**
   * Unsubscribe all listeners and clean up relay subscriptions.
   */
  destroy(): void;
}
```

### kind:25050 Event Format

```json
{
  "kind": 25050,
  "pubkey": "<sender_pubkey>",
  "created_at": <unix_timestamp>,
  "tags": [
    ["p", "<recipient_pubkey>"],
    ["session", "<session_uuid>"]
  ],
  "content": "<nip44_encrypted_SignalingMessage_json>"
}
```

`kind:25050` is in the ephemeral event range (20000–29999). Relays are not required to persist ephemeral events — they are delivered in real time to subscribed clients and may not be available after the call ends.

---

## PeerConnectionManager Class

**File:** `src/lib/calls/peer-connection.ts`

The `PeerConnectionManager` wraps the browser's `RTCPeerConnection` API, managing the WebRTC lifecycle including offer/answer negotiation, ICE gathering, and media stream handling.

```typescript
class PeerConnectionManager {
  constructor(config?: RTCConfiguration);

  /**
   * Create an SDP offer (caller side).
   * Attaches local media streams before creating the offer.
   * @param type - 'voice' | 'video'
   */
  createOffer(type: 'voice' | 'video'): Promise<RTCSessionDescriptionInit>;

  /**
   * Handle an SDP answer from the remote peer.
   * Call after receiving the peer's answer via signaling.
   */
  handleAnswer(answer: RTCSessionDescriptionInit): Promise<void>;

  /**
   * Handle an SDP offer from a remote peer (callee side).
   * Returns the local SDP answer to send back via signaling.
   * @param offer - The remote peer's SDP offer
   * @param type  - 'voice' | 'video'
   */
  handleOffer(
    offer: RTCSessionDescriptionInit,
    type: 'voice' | 'video'
  ): Promise<RTCSessionDescriptionInit>;

  /**
   * Add a remote ICE candidate received via signaling.
   */
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;

  /**
   * Request access to local media and attach to the connection.
   * @param constraints - Standard MediaStreamConstraints
   */
  attachLocalMedia(
    constraints: MediaStreamConstraints
  ): Promise<MediaStream>;

  /**
   * Get the remote media stream (set once connected).
   */
  getRemoteStream(): MediaStream | null;

  /**
   * Close the WebRTC connection and release media resources.
   */
  close(): void;

  /** Event callback: fires when a local ICE candidate is ready to send. */
  onIceCandidate: ((candidate: RTCIceCandidateInit) => void) | null;

  /** Event callback: fires when the connection state changes. */
  onConnectionStateChange: ((state: RTCPeerConnectionState) => void) | null;

  /** Event callback: fires when the remote stream arrives. */
  onRemoteStream: ((stream: MediaStream) => void) | null;

  /** Current connection state. */
  readonly connectionState: RTCPeerConnectionState;
}
```

---

## Call State Machine

```
IDLE
  │
  │  initiateCall(pubkey, type)
  │  → NostrSignaling.send(OFFER)
  ▼
RINGING
  │                    └── timeout (60s) or hangup received ──► ENDED
  │  answerCall()
  │  → NostrSignaling.send(ANSWER)
  ▼
CONNECTED
  │  ← media flows peer-to-peer via WebRTC ─────────────────►
  │
  │  endCall() or connection-lost
  │  → NostrSignaling.send(HANGUP)
  ▼
ENDED
```

---

## Quick Start: Initiating a Call

```typescript
import { NostrSignaling, PeerConnectionManager } from '@lib/calls';
import { v4 as uuid } from 'uuid';

const signaling = new NostrSignaling(signer, ceps, relays);
const peerConn = new PeerConnectionManager();
const sessionId = uuid();

// Step 1: Create and send offer
const offer = await peerConn.createOffer('video');

await signaling.send(peerPubkey, {
  type: 'offer',
  sessionId,
  sdp: offer,
});

// Step 2: Forward local ICE candidates as they arrive
peerConn.onIceCandidate = async (candidate) => {
  await signaling.send(peerPubkey, {
    type: 'ice-candidate',
    sessionId,
    candidate,
  });
};

// Step 3: Handle answer and ICE from peer
signaling.subscribe(async (from, message) => {
  if (from !== peerPubkey || message.sessionId !== sessionId) return;

  if (message.type === 'answer' && message.sdp) {
    await peerConn.handleAnswer(message.sdp);
  }
  if (message.type === 'ice-candidate' && message.candidate) {
    await peerConn.addIceCandidate(message.candidate);
  }
  if (message.type === 'hangup') {
    peerConn.close();
    signaling.destroy();
  }
});

// Step 4: Remote stream
peerConn.onRemoteStream = (stream) => {
  remoteVideoElement.srcObject = stream;
};
```

---

## Privacy Notes

- Signaling messages are NIP-44 encrypted — only the two parties can read offer/answer content.
- `kind:25050` is ephemeral — relays typically do not persist these events after delivery.
- Media is encrypted via DTLS-SRTP (WebRTC standard) — Satnam servers are not in the media path.
- WebRTC ICE negotiation may expose your public IP address to the peer. TURN relay support for IP masking is planned for a future version.

---

## Related

- [useCalls hook](../hooks/use-calls.md)
- [Voice and Video Calls user guide](../../user-guides/calls/README.md)
- [Protocol Reference: kind:25050](../../protocol-reference/README.md#event-kind-registry)
