# CEPS + Pylon

**Module paths:**
- CEPS: `src/lib/ceps/`
- Pylon client: `src/lib/pylon/`
**Import aliases:** `@lib/ceps`, `@lib/pylon`

---

## Overview

CEPS (Central Event Publishing Service) is the relay abstraction layer — the single module responsible for constructing, signing, and publishing Nostr events. All event publishing in Satnam v2 goes through CEPS. No other module publishes directly to relays.

Pylon is the [OpenAgents authenticated Nostr relay](https://openagents.com). It requires NIP-42 AUTH before events can be written. CEPS handles the Pylon AUTH challenge automatically on WebSocket connection.

The relationship:
```
Feature code → CEPS → PylonCepsClient → Pylon relay (primary)
                   └─────────────────→ Public relays (fallback)
```

---

## CepsClient API

`CepsClient` is the base CEPS implementation. For most use cases, use `PylonCepsClient` (Pylon-first with fallback) instead.

```typescript
interface CepsClient {
  /**
   * Publish a signed Nostr event to all configured relays.
   * Retries with exponential backoff on transient failures.
   * @param event - Fully signed Nostr event
   * @returns Map of relay URL → publish result
   */
  publish(event: NostrEvent): Promise<Map<string, PublishResult>>;

  /**
   * Construct, sign, and publish a Nostr event.
   * Signs using the Principal's nsec from the OPFS Vault.
   *
   * @param template - Unsigned event (kind, tags, content)
   * @param signerNpub - Which vault identity to sign with
   * @returns The fully signed, published event
   */
  signAndPublish(
    template: UnsignedNostrEvent,
    signerNpub: string
  ): Promise<NostrEvent>;

  /**
   * Subscribe to events matching a filter on all connected relays.
   * Returns an unsubscribe function.
   */
  subscribe(
    filter: NostrFilter,
    onEvent: (event: NostrEvent) => void,
    onEose?: () => void
  ): () => void;

  /** Connect to all configured relays. */
  connect(): Promise<void>;

  /** Disconnect from all relays. */
  disconnect(): void;

  /** Returns relay connection status. */
  getStatus(): RelayStatus[];
}

interface PublishResult {
  success: boolean;
  message?: string; // Relay's OK/NOTICE message
}

interface RelayStatus {
  url: string;
  connected: boolean;
  lastSeen?: number; // Unix timestamp of last received event
}
```

---

## PylonAuth (NIP-42 AUTH Flow)

Pylon requires authenticated connections via NIP-42 before accepting published events.

```typescript
class PylonAuth {
  constructor(vault: VaultOps, signerNpub: string);

  /**
   * Respond to a Pylon AUTH challenge.
   * Called automatically when the WebSocket receives ["AUTH", "<challenge>"].
   *
   * @param challenge - Challenge string from the relay
   * @param relayUrl - The relay's WSS URL
   * @returns Signed kind:22242 AUTH event
   */
  handleChallenge(challenge: string, relayUrl: string): Promise<NostrEvent>;
}
```

### NIP-42 Challenge/Response Protocol

```
Client                    Pylon Relay
  │                           │
  │─── WebSocket connect ───►│
  │                           │
  │◄── ["AUTH", challenge] ──│
  │                           │
  │  (construct kind:22242)   │
  │  {                        │
  │    kind: 22242,           │
  │    tags: [                │
  │      ["relay", pylonUrl], │
  │      ["challenge", "..."] │
  │    ],                     │
  │    content: ""            │
  │  }                        │
  │                           │
  │─── ["AUTH", signedEvent] ►│
  │                           │
  │◄── ["OK", eventId, true] ─│
  │                           │
  │  (authenticated — can     │
  │   publish events now)     │
```

The AUTH event is signed with the Principal's nsec from the OPFS Vault. After successful AUTH, the connection is considered authenticated for the WebSocket session lifetime.

---

## PylonCepsClient

`PylonCepsClient` extends `CepsClient` with Pylon-first publishing and automatic fallback to public relays.

```typescript
interface PylonCepsClientConfig {
  pylonUrl: string;          // Primary authenticated relay URL
  fallbackRelays: string[];  // Public relays for redundancy
  signerNpub: string;        // Principal's npub for signing
  vault: VaultOps;
  retryConfig?: RetryConfig;
}

interface RetryConfig {
  maxAttempts: number;    // Default: 3
  baseDelayMs: number;    // Default: 1000
  maxDelayMs: number;     // Default: 30000
  backoffFactor: number;  // Default: 2 (exponential)
}

class PylonCepsClient implements CepsClient {
  constructor(config: PylonCepsClientConfig);

  /**
   * Publish to Pylon first. If Pylon fails, publish to fallback relays
   * and queue for Pylon retry with exponential backoff.
   */
  publish(event: NostrEvent): Promise<Map<string, PublishResult>>;

  /** Returns whether Pylon is currently authenticated. */
  isPylonAuthenticated(): boolean;

  /** Returns the current length of the Pylon retry queue. */
  getRetryQueueLength(): number;

  /** Force retry of all queued events. */
  flushRetryQueue(): Promise<void>;
}
```

---

## Event Publishing Patterns

### Basic Event Publishing

```typescript
import { PylonCepsClient } from '@lib/ceps/pylon-client';
import { getPylonRelay, getFallbackRelays } from '@config/env';

const ceps = new PylonCepsClient({
  pylonUrl: getPylonRelay(),
  fallbackRelays: getFallbackRelays(),
  signerNpub: principalNpub,
  vault,
});

await ceps.connect();

// Publish an agent profile (kind:39200)
const event = await ceps.signAndPublish(
  {
    kind: 39200,
    pubkey: agentPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', 'profile'],
      ['operator', guardianPubkeyHex],
    ],
    content: JSON.stringify(agentProfileContent),
  },
  agentNpub // Sign with agent's nsec from vault
);

console.log('Published agent profile:', event.id);
```

### Group Signing + Publishing

For group-signed events, the signing is handled by the FROST module. CEPS publishes the pre-signed event:

```typescript
// After FROST signing ceremony produces a fully signed event:
const results = await ceps.publish(frostedSignedEvent);
for (const [relayUrl, result] of results) {
  console.log(`${relayUrl}: ${result.success ? 'OK' : result.message}`);
}
```

### Event Subscription

```typescript
const ceps = new PylonCepsClient(config);

// Subscribe to agent state events (NIP-44 encrypted)
const unsubscribe = ceps.subscribe(
  {
    kinds: [39201],
    '#p': [agentPubkey],
    since: Math.floor(Date.now() / 1000) - 3600, // Last hour
  },
  (event) => {
    console.log('Agent state update:', event.id);
    // Decrypt with NIP-44 using Principal's nsec
  },
  () => {
    console.log('EOSE — historical events loaded');
  }
);

// Clean up on component unmount
return () => unsubscribe();
```

---

## Retry Queue and Exponential Backoff

When Pylon is unavailable, CEPS:
1. Publishes immediately to fallback relays (if configured).
2. Queues the event for Pylon retry.
3. Retries with exponential backoff: `delay = min(baseDelay * 2^attempt, maxDelay)`.

```
Retry schedule (defaults: base=1000ms, max=30000ms, factor=2):
  Attempt 1: 1 second
  Attempt 2: 2 seconds
  Attempt 3: 4 seconds
  ... capped at 30 seconds
```

The retry queue is in-memory only. If the app is closed, queued events are lost. For critical events (group profile updates, skill registrations), callers should confirm the Pylon publish result and retry manually if needed.

```typescript
// Monitor retry queue status
setInterval(() => {
  const queueLen = ceps.getRetryQueueLength();
  if (queueLen > 0) {
    console.warn(`${queueLen} events queued for Pylon retry`);
  }
}, 5000);

// Force flush when Pylon reconnects
ceps.onPylonReconnect(() => {
  ceps.flushRetryQueue();
});
```

---

## Pylon-Specific Event Kinds

Pylon is the primary relay for agent coordination events. These kinds are routed to Pylon first:

| Kind | Name | Direction |
|---|---|---|
| 22242 | NIP-42 AUTH | Client → Relay |
| 20100 | FROST coordinator | Bidirectional |
| 39200–39231 | NIP-SA events | Published to Pylon |
| 39240–39245 | NIP-AC events | Published to Pylon |
| 10003 | Presence heartbeat | Published to Pylon → SpacetimeDB bridge |
| 39231 | Trajectory events | Subscribed from Pylon |

Public events (kind:0 metadata, kind:1 notes, kind:3 contacts) are published to both Pylon and fallback public relays.

---

## Quick Start

```typescript
import { useCeps } from '@hooks/useCeps'; // (from context provider)

// In a component
function AgentCreationFlow() {
  const ceps = useCeps();

  async function publishAgentProfile(profile: AgentProfileContent) {
    const event = await ceps.signAndPublish(
      {
        kind: 39200,
        pubkey: newAgentPubkey,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'profile'],
          ['operator', myPubkey],
          ['lud16', `${agentUsername}@satnam.pub`],
        ],
        content: JSON.stringify(profile),
      },
      newAgentNpub
    );

    console.log('Agent profile published:', event.id);
    return event;
  }
}
```

---

## Related

- [SpacetimeDB Bridge](./bridge.md) — Pylon-mediated bridge to SpacetimeDB
- [Libraries overview](./README.md) — Module dependency graph
- Specification §8.3 — Pylon Relay (NIP-42 AUTH)
