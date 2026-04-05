# useCalls

**File:** `src/hooks/useCalls.tsx`
**Provider:** `CallsProvider` (requires `VaultProvider`, relay connection)

---

## Purpose

`useCalls` manages the voice and video call lifecycle — initiating, receiving, answering, and ending calls. It coordinates `NostrSignaling` (kind:25050 events) and `PeerConnectionManager` (WebRTC), exposing a simple React interface for call state and controls.

---

## Return Value Shape

```typescript
interface UseCallsReturn {
  // Active call (null when idle)
  activeCall: CallSession | null;

  // Incoming call (null when no incoming call)
  incomingCall: IncomingCall | null;

  // Call controls
  initiateCall: (pubkey: string, type: 'voice' | 'video') => Promise<void>;
  answerCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;

  // Media state
  isMuted: boolean;
  isVideoEnabled: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;

  // Duration (seconds, updates every second while CONNECTED)
  callDuration: number;

  // Error
  error: string | null;
}

interface IncomingCall {
  sessionId: string;
  fromPubkey: string;
  type: 'voice' | 'video';
  receivedAt: number; // Unix timestamp
}
```

---

## Methods

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `initiateCall` | `pubkey: string`, `type: 'voice' \| 'video'` | `Promise<void>` | Start a call to a PoL-verified contact. Sends kind:25050 OFFER. State: IDLE → RINGING. |
| `answerCall` | — | `Promise<void>` | Answer the incoming call. Sends kind:25050 ANSWER. State: RINGING → CONNECTED. |
| `declineCall` | — | `void` | Reject the incoming call. Sends kind:25050 HANGUP. |
| `endCall` | — | `void` | End the active call. Sends kind:25050 HANGUP. Closes WebRTC. State: CONNECTED → ENDED. |
| `toggleMute` | — | `void` | Mute or unmute local audio track. |
| `toggleVideo` | — | `void` | Enable or disable local video track (video calls only). |

---

## Example Usage

### Call Button on a Contact Profile

```tsx
import { useCalls } from '@hooks/useCalls';

function ContactActions({ pubkey }: { pubkey: string }) {
  const { initiateCall, activeCall } = useCalls();
  const isCallActive = activeCall !== null;

  return (
    <div className="flex gap-2">
      <button
        onClick={() => initiateCall(pubkey, 'voice')}
        disabled={isCallActive}
        className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30"
        title="Voice call"
      >
        <PhoneIcon className="h-5 w-5 text-white" />
      </button>
      <button
        onClick={() => initiateCall(pubkey, 'video')}
        disabled={isCallActive}
        className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30"
        title="Video call"
      >
        <VideoIcon className="h-5 w-5 text-white" />
      </button>
    </div>
  );
}
```

### Incoming Call Overlay

```tsx
import { useCalls } from '@hooks/useCalls';

function IncomingCallOverlay() {
  const { incomingCall, answerCall, declineCall } = useCalls();

  if (!incomingCall) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 text-center min-w-[300px]">
        <div className="text-zinc-400 text-sm mb-1">Incoming {incomingCall.type} call</div>
        <div className="text-white text-xl font-semibold mb-6">
          {incomingCall.fromPubkey.slice(0, 16)}...
        </div>
        <div className="flex gap-4 justify-center">
          <button
            onClick={declineCall}
            className="rounded-full bg-red-600 hover:bg-red-700 p-4"
          >
            <PhoneOffIcon className="h-6 w-6 text-white" />
          </button>
          <button
            onClick={answerCall}
            className="rounded-full bg-green-600 hover:bg-green-700 p-4"
          >
            <PhoneIcon className="h-6 w-6 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Active Call Panel

```tsx
import { useCalls } from '@hooks/useCalls';
import { useRef, useEffect } from 'react';

function ActiveCallPanel() {
  const {
    activeCall, endCall,
    toggleMute, isMuted,
    toggleVideo, isVideoEnabled,
    localStream, remoteStream,
    callDuration,
  } = useCalls();

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  if (!activeCall) return null;

  const minutes = Math.floor(callDuration / 60).toString().padStart(2, '0');
  const seconds = (callDuration % 60).toString().padStart(2, '0');

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col">
      {/* Remote video */}
      <div className="flex-1 relative">
        {activeCall.type === 'video' && (
          <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
        )}
        {/* Local video inset */}
        {activeCall.type === 'video' && (
          <video
            ref={localVideoRef}
            autoPlay playsInline muted
            className="absolute bottom-4 right-4 w-32 h-24 rounded-lg border border-zinc-700 object-cover"
          />
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-6 py-8 bg-zinc-900">
        <span className="font-mono text-zinc-400">{minutes}:{seconds}</span>

        <button
          onClick={toggleMute}
          className={`p-4 rounded-full ${isMuted ? 'bg-red-600' : 'bg-zinc-700'}`}
        >
          {isMuted ? <MicOffIcon className="h-6 w-6" /> : <MicIcon className="h-6 w-6" />}
        </button>

        {activeCall.type === 'video' && (
          <button
            onClick={toggleVideo}
            className={`p-4 rounded-full ${!isVideoEnabled ? 'bg-red-600' : 'bg-zinc-700'}`}
          >
            {isVideoEnabled ? <VideoIcon className="h-6 w-6" /> : <VideoOffIcon className="h-6 w-6" />}
          </button>
        )}

        <button
          onClick={endCall}
          className="p-4 rounded-full bg-red-600 hover:bg-red-700"
        >
          <PhoneOffIcon className="h-6 w-6 text-white" />
        </button>
      </div>
    </div>
  );
}
```

---

## Call Requirements

- The target pubkey must be a PoL-verified contact in the user's Circle of Trust.
- The browser must be granted microphone permission (for voice/video) and camera permission (for video).
- Both parties must be online and connected to a shared relay.

---

## Related

- [Calls library](../libraries/calls.md) — NostrSignaling and PeerConnectionManager
- [Voice and Video Calls user guide](../../user-guides/calls/README.md)
