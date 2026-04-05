# Voice and Video Calls

Satnam v2 supports encrypted voice and video calls between PoL-verified contacts. Calls use **WebRTC** for peer-to-peer media, with **Nostr as the signaling layer** — offer/answer negotiation is sent as NIP-44 encrypted ephemeral events (kind:25050) via your relay.

---

## How Calls Work

A Satnam call proceeds in two phases:

### Phase 1: Signaling (via Nostr)

Nostr replaces the traditional SIP/STUN signaling server. The call setup — WebRTC offer, answer, and ICE candidates — is exchanged as `kind:25050` ephemeral events, encrypted with NIP-44.

```
Alice's device                            Bob's device
     │                                         │
     │── kind:25050 (OFFER, encrypted) ───────►│
     │                                         │  Bob's app rings
     │◄─ kind:25050 (ANSWER, encrypted) ───────│
     │                                         │
     │── kind:25050 (ICE candidates) ─────────►│
     │◄─ kind:25050 (ICE candidates) ──────────│
     │                                         │
     │◄══════ WebRTC P2P media stream ════════►│
     │         (audio + video direct)          │
```

Once the WebRTC connection is established, media flows **directly between devices** — it does not pass through Satnam servers or your relay. The relay is only involved during the brief signaling phase.

### Phase 2: Media (WebRTC peer-to-peer)

WebRTC provides encrypted audio and video streams via DTLS-SRTP. Media encryption is handled by the browser's WebRTC implementation — Satnam does not add an extra encryption layer over the media stream itself, because WebRTC already mandates end-to-end encryption.

---

## Requirements

| Requirement | Details |
|---|---|
| **Contact** | Must be a PoL-verified contact in your Circle of Trust |
| **Browser** | Chrome 89+, Firefox 90+, or Safari 15.4+ |
| **Permissions** | Microphone required for voice; camera required for video |
| **Connectivity** | Both parties must be online at the same time |
| **Relay** | Both parties must share at least one Nostr relay |

> **Why PoL-verified contacts only?** Calls are only available to contacts you have physically verified. This prevents spam calls and ensures the person calling you is who they say they are — their identity is backed by a face-to-face ceremony and NFC card verification.

---

## Making a Call

1. Navigate to **Contacts** and open a PoL-verified contact's profile.
2. Click the **voice call** icon (phone) or **video call** icon (camera).
3. Satnam publishes a NIP-44 encrypted `kind:25050` OFFER event to your relay.
4. Your screen shows a **Calling...** overlay with the contact's name.
5. If your contact answers, the call connects automatically. If they decline or don't respond within 60 seconds, the call ends with a timeout notification.

---

## Receiving a Call

When someone in your Circle of Trust calls you:

1. An **Incoming Call** overlay appears, showing the caller's name, NIP-05 identifier, and call type (voice or video).
2. Tap **Accept** to answer, or **Decline** to reject.
3. If you accept, your browser requests microphone (and camera, for video) permissions if not already granted.
4. The call connects.

**Note:** You must have the Satnam app open (or the PWA active in a browser tab) to receive incoming call notifications. Background call reception is not supported in v2.

---

## During a Call

The **Active Call Panel** shows:

| Control | Action |
|---|---|
| **Mute / Unmute** | Toggle your microphone on/off |
| **Video On / Off** | Toggle your camera on/off (video calls) |
| **End Call** | Hang up and terminate the WebRTC connection |
| **Duration timer** | Elapsed call time |

For video calls, your local video preview appears in a small inset, and your contact's video fills the main panel.

---

## Privacy

| Property | Detail |
|---|---|
| **Signaling encryption** | NIP-44 v2 (ChaCha20-Poly1305 + HKDF) — only the two parties can read offer/answer |
| **Media encryption** | DTLS-SRTP (WebRTC standard) — encrypted end-to-end in the WebRTC layer |
| **Relay visibility** | Relay sees encrypted `kind:25050` events — it cannot read offer content |
| **Server involvement** | Satnam servers are not involved in media or signaling after the relay connection |
| **IP exposure** | WebRTC may expose your IP address to your contact during ICE negotiation. Future versions may support TURN relays for IP masking. |

---

## Call State Machine

```
IDLE
  │
  │  initiateCall(pubkey, type)
  ▼
RINGING
  │                    └── timeout or decline ──► ENDED
  │  answerCall()
  ▼
CONNECTED
  │
  │  endCall() or connection lost
  ▼
ENDED
```

---

## Related Pages

- [Circle of Trust](../circle-of-trust/README.md) — PoL-verified contact requirements
- [Calls Library](../../developer-reference/libraries/calls.md) — Developer reference (NostrSignaling, PeerConnectionManager)
- [useCalls hook](../../developer-reference/hooks/use-calls.md)
