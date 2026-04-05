# SpacetimeDB Bridge

**Module path:** `src/lib/bridge/`
**Import alias:** `@lib/bridge`

---

## Why No SpacetimeDB SDK (Axiom 4)

SpacetimeDB is the real-time coordination database used by OpenAgents for presence, session sync, and compute assignment. It has a native TypeScript SDK (`@clockworklabs/spacetimedb-sdk`).

Satnam v2 does **not** add this SDK as a direct dependency. The reason is **Axiom 4 — minimize dependencies: every dependency is an attack surface**. The target is ≤22 production dependencies. Adding the SpacetimeDB SDK would exceed this limit and introduce a non-mandate-mapped dependency.

Instead, Satnam bridges to SpacetimeDB **via the Pylon relay** using existing Nostr WebSocket connections. The translation between Nostr event kinds and SpacetimeDB table operations is handled server-side by the Pylon deployment — a responsibility of the OpenAgents infrastructure, not Satnam.

This means:
- Satnam requires no new network connections beyond Nostr relay WebSockets (already established)
- No additional cryptographic library surface area
- The bridge is transparent to Satnam's security model — all bridge events are signed Nostr events

---

## Bridge Architecture

```
Satnam Client                    Pylon Relay                  SpacetimeDB
      │                               │                             │
      │─── Nostr kind:10003 ─────────►│── bridge.session_presence ─►│
      │    (presence heartbeat)       │                             │
      │                               │                             │
      │─── Nostr kind:39201 ─────────►│── bridge.sync_event ───────►│
      │    (agent state update)       │                             │
      │                               │                             │
      │◄── Nostr kind:39231 ──────────│◄── bridge.sync_checkpoint ──│
      │    (trajectory checkpoint)    │                             │
      │                               │                             │
      │─── Nostr kind:31990 ─────────►│── bridge.provider_capability►│
      │    (DVM provider profile)     │                             │
      │                               │                             │
      │◄── Nostr kind:39242 ──────────│◄── bridge.compute_assignment│
      │    (credit envelope)          │                             │
      │                               │                             │
      │◄── Nostr kind:39211 ──────────│◄── bridge.bridge_outbox ───│
      │    (tick result)              │                             │
      │                               │                             │
      │─── Nostr kind:10003 ─────────►│── bridge.presence_event ───►│
      │    (presence update)          │                             │
```

The Pylon relay operates a bridge module that subscribes to specific Nostr event kinds from authenticated Satnam clients and translates them into SpacetimeDB table operations. The reverse path also applies: SpacetimeDB updates are forwarded to subscribed Satnam clients as Nostr events.

---

## Table-to-Kind Mapping

| SpacetimeDB Table | Bridge Direction | Nostr Event Kind | Description |
|---|---|---|---|
| `session_presence` | Satnam → SpacetimeDB | kind:10003 (presence) | User/agent online/offline status |
| `sync_event` | Bidirectional | kind:39201 (agent state) | Agent status changes (idle/working/paused/error) |
| `sync_checkpoint` | SpacetimeDB → Satnam | kind:39231 (trajectory event) | Session sync checkpoints from Probe |
| `provider_capability` | Satnam → SpacetimeDB | kind:31990 (NIP-90 provider) | DVM provider capability announcements |
| `compute_assignment` | SpacetimeDB → Satnam | kind:39242 (credit envelope) | Compute task assignments from OpenAgents |
| `bridge_outbox` | SpacetimeDB → Satnam | kind:39211 (tick result) | Agent tick results from OpenAgents scheduler |
| `presence_event` | Satnam → SpacetimeDB | kind:10003 (presence) | Granular presence events |

---

## Presence Pattern

Satnam publishes a heartbeat presence event to Pylon every 30 seconds while active. Pylon translates this to a SpacetimeDB `session_presence` row insert/upsert.

```typescript
interface PresenceEvent {
  type: 'online' | 'offline' | 'idle';
  principalPubkey: string;
  agentPubkeys: string[];      // Active agent pubkeys
  lastActivityAt: number;      // Unix timestamp
  clientVersion: string;       // e.g. "2.0.0-alpha.1"
}

// Published as kind:10003 with content = JSON.stringify(PresenceEvent)
// Tags: [["p", agentPubkey], ...agentPubkeys]
```

```typescript
import { BridgeClient } from '@lib/bridge/client';

const bridge = new BridgeClient({ ceps, principalNpub });

// Start presence heartbeat (30s interval)
const stopHeartbeat = bridge.startPresenceHeartbeat({
  agentPubkeys: activeAgents.map(a => a.pubkey),
});

// Publish offline on unmount
window.addEventListener('beforeunload', () => {
  bridge.publishPresence('offline');
});

// Cleanup
return () => stopHeartbeat();
```

---

## Heartbeat Pattern

The presence heartbeat is published as an ephemeral Nostr event. It is consumed by Pylon but not necessarily stored on public relays (it has no value to store long-term).

```typescript
class BridgeClient {
  constructor(config: {
    ceps: CepsClient;
    principalNpub: string;
  });

  /**
   * Start publishing presence heartbeats every intervalMs milliseconds.
   * Returns a stop function.
   */
  startPresenceHeartbeat(opts: {
    agentPubkeys?: string[];
    intervalMs?: number; // Default: 30000
  }): () => void;

  /**
   * Publish a single presence event.
   * @param type - 'online' | 'offline' | 'idle'
   */
  publishPresence(type: 'online' | 'offline' | 'idle'): Promise<void>;

  /**
   * Publish an agent state update (kind:39201).
   * Translated to SpacetimeDB sync_event by Pylon.
   */
  publishAgentState(
    agentNpub: string,
    state: AgentStateContent
  ): Promise<void>;

  /**
   * Subscribe to compute assignments (kind:39242).
   * These are credit envelopes routed from SpacetimeDB.
   * @returns unsubscribe function
   */
  subscribeToComputeAssignments(
    principalPubkey: string,
    onAssignment: (envelope: CreditEnvelopeContent) => void
  ): () => void;

  /**
   * Subscribe to tick results (kind:39211).
   * These are agent execution results from the OpenAgents scheduler.
   * @returns unsubscribe function
   */
  subscribeToTickResults(
    agentPubkey: string,
    onResult: (result: unknown) => void
  ): () => void;
}
```

---

## Compute Assignment Pattern

When OpenAgents routes a compute task to a Satnam Principal's agent, it arrives as a kind:39242 credit envelope event published to Pylon. Satnam subscribes to this and presents it in the agent monitoring UI.

```typescript
// Subscribe to incoming compute assignments
const unsubscribe = bridge.subscribeToComputeAssignments(
  principalPubkey,
  async (envelope) => {
    // envelope is a decoded CreditEnvelopeContent
    console.log('New compute assignment:', envelope.offer_id);
    console.log('Max budget:', envelope.max_sats, 'sats');
    console.log('Agent authorized:', envelope.agent_pubkey);

    // Present to Principal for acceptance or auto-accept within policy
    if (envelope.max_sats <= agentPolicy.requires_approval_above_sats) {
      await acceptComputeAssignment(envelope);
    } else {
      showApprovalDialog(envelope);
    }
  }
);
```

---

## SpacetimeDB Subscription (Without SDK)

Instead of the SpacetimeDB subscription API, Satnam uses Nostr filter subscriptions via Pylon. The filter structure mirrors what a SpacetimeDB subscription would query:

```typescript
// Equivalent to: SELECT * FROM session_presence WHERE principal_pubkey = myPubkey
ceps.subscribe(
  {
    kinds: [10003],
    '#p': [principalPubkey],
    since: Math.floor(Date.now() / 1000) - 300, // Last 5 minutes
  },
  (event) => {
    const presence: PresenceEvent = JSON.parse(event.content);
    updatePresenceState(presence);
  }
);

// Equivalent to: SELECT * FROM compute_assignment WHERE agent_pubkey = agentPubkey
ceps.subscribe(
  {
    kinds: [39242],
    '#p': [agentPubkey],
  },
  (event) => {
    const envelope: CreditEnvelopeContent = JSON.parse(event.content);
    handleComputeAssignment(envelope);
  }
);
```

---

## Quick Start

```typescript
import { BridgeClient } from '@lib/bridge/client';
import { useSpacetimeBridge } from '@hooks/useSpacetimeBridge';

// In a component
function AgentMonitoringPanel({ agentPubkey }: { agentPubkey: string }) {
  const bridge = useSpacetimeBridge();

  useEffect(() => {
    // Subscribe to tick results from this agent
    const unsubscribe = bridge.subscribeToTickResults(agentPubkey, (result) => {
      setLastTickResult(result);
    });

    // Start presence heartbeat including this agent
    const stopHeartbeat = bridge.startPresenceHeartbeat({
      agentPubkeys: [agentPubkey],
    });

    return () => {
      unsubscribe();
      stopHeartbeat();
    };
  }, [agentPubkey]);
}
```

---

## Related

- [CEPS + Pylon library](./ceps.md) — Event publishing backbone
- [useSpacetimeBridge hook (via useProbeSession)](../hooks/use-probe-session.md)
- Specification §8.4 — SpacetimeDB Bridge
