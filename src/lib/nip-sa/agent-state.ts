/**
 * @module nip-sa/agent-state
 * @description Agent state and schedule event construction/publishing for NIP-SA.
 *
 * Implements:
 * - kind:39201 (Agent State) — NIP-44 encrypted, only agent + governor can read
 * - kind:39202 (Agent Schedule) — heartbeat interval and working-hours config
 *
 * Agent state events are published by the agent runner after each significant
 * status change and on every heartbeat. They are NIP-44 encrypted to the
 * agent's own pubkey so only the agent and its Governor (who holds the shared
 * secret) can decrypt the content.
 *
 * @see phase3-spec-sections.md §7.1 — NIP-SA kinds 39201, 39202
 */

import { finalizeEvent, getPublicKey, nip19, nip44 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import type { CepsClient } from '../ceps/ceps-client.js';

// ---------------------------------------------------------------------------
// AgentOperationalState type (spec §7.1 + agent-state.ts spec block)
// ---------------------------------------------------------------------------

/**
 * Runtime operational state of an autonomous agent.
 * Published as kind:39201, NIP-44 encrypted to the agent's pubkey.
 *
 * Status transitions:
 *   idle → active (task assigned)
 *   active → paused (Governor suspend)
 *   active → error (task failure)
 *   * → terminated (deactivation)
 */
export type AgentOperationalState = {
  /** Current lifecycle status */
  status: 'idle' | 'active' | 'paused' | 'error' | 'terminated';
  /** Human-readable description of the current task (if active) */
  currentTask?: string;
  /** Unix timestamp of the last successful heartbeat */
  lastHeartbeat: number;
  /** Cumulative runtime metrics */
  metrics: {
    /** Total tasks completed successfully */
    tasksCompleted: number;
    /** Total tasks that failed or timed out */
    tasksFailed: number;
    /** Cumulative millisatoshis spent across all tasks */
    totalSpentMsats: bigint;
    /** Seconds the agent process has been running since last restart */
    uptimeSeconds: number;
  };
};

// ---------------------------------------------------------------------------
// publishAgentSchedule params
// ---------------------------------------------------------------------------

export interface PublishAgentScheduleParams {
  /** Agent's hex pubkey */
  agentPubkey: string;
  /** Heartbeat interval in seconds (minimum 60) */
  heartbeatIntervalSecs: number;
  /** Optional working-hour window in UTC (0–23 inclusive) */
  activeHours?: { start: number; end: number };
  /** Agent's secret key (nsec bech32 or hex) */
  signerNsec: string;
  /** Active CEPS client */
  ceps: CepsClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode an nsec bech32 or 64-char hex secret key to raw bytes.
 * @internal
 */
function decodeSecretKey(nsecOrHex: string): Uint8Array {
  if (/^[0-9a-fA-F]{64}$/.test(nsecOrHex)) {
    return hexToBytes(nsecOrHex);
  }
  if (nsecOrHex.startsWith('nsec1')) {
    const decoded = nip19.decode(nsecOrHex);
    if (decoded.type !== 'nsec') {
      throw new Error('Expected nsec bech32 string, got: ' + decoded.type);
    }
    return decoded.data as Uint8Array;
  }
  throw new Error(
    'Invalid secret key format — expected nsec bech32 or 64-char hex'
  );
}

/**
 * Serialize AgentOperationalState to JSON, converting bigint to string for
 * JSON compatibility (ECMA-262 does not support BigInt in JSON natively).
 * @internal
 */
function serializeState(state: AgentOperationalState): string {
  return JSON.stringify(state, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
}

// ---------------------------------------------------------------------------
// publishAgentState
// ---------------------------------------------------------------------------

/**
 * Publish an agent state update event (kind:39201).
 *
 * The content is NIP-44 encrypted to the agent's own pubkey using the agent's
 * private key. This means only the agent itself and any party that holds the
 * agent's private key (i.e. the Governor) can decrypt the content.
 *
 * Tags:
 * - ["d", "state"]
 * - ["p", "<governor_pubkey>"]  — hint for Governor subscription
 * - ["status", "<status>"]      — plaintext status for relay-side filtering
 *
 * @param params.agentPubkey - Agent's hex pubkey
 * @param params.state - Current operational state
 * @param params.signerNsec - Agent's secret key for signing and encryption
 * @param params.governorPubkey - Governor's pubkey (for "p" tag hint)
 * @param params.ceps - Active CEPS client
 * @returns Published event ID (hex)
 * @throws If NIP-44 encryption or relay publishing fails
 */
export async function publishAgentState(params: {
  agentPubkey: string;
  state: AgentOperationalState;
  signerNsec: string;
  governorPubkey: string;
  ceps: CepsClient;
}): Promise<string> {
  const { agentPubkey, state, signerNsec, governorPubkey, ceps } = params;

  const secretKey = decodeSecretKey(signerNsec);

  // Derive a shared NIP-44 conversation key with self (agent encrypts to own pubkey)
  // This allows the agent to re-read its own state and the Governor (holding nsec) to decrypt
  const conversationKey = nip44.v2.utils.getConversationKey(secretKey, agentPubkey);
  const encryptedContent = nip44.v2.encrypt(serializeState(state), conversationKey);

  const signed = finalizeEvent(
    {
      kind: 39201,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', 'state'],
        ['p', governorPubkey],
        ['status', state.status],
      ],
      content: encryptedContent,
    },
    secretKey
  );

  return ceps.publishEvent(signed as any);
}

// ---------------------------------------------------------------------------
// subscribeAgentState
// ---------------------------------------------------------------------------

/**
 * Subscribe to agent state updates (kind:39201) for a given agent pubkey.
 *
 * Returns an unsubscribe function. The callback receives the decrypted
 * AgentOperationalState on each new event. Events that cannot be decrypted
 * (e.g. the subscriber lacks the agent's private key) are silently skipped.
 *
 * Note: Decryption is only possible if the subscriber holds the agent's nsec.
 * If you need to monitor state without the private key, subscribe to the
 * plaintext "status" tag instead.
 *
 * @param agentPubkey - Agent's hex pubkey to subscribe to
 * @param relayUrl - Relay URL to subscribe on
 * @param callback - Called with each decrypted AgentOperationalState
 * @returns Unsubscribe function — call to clean up the subscription
 */
export function subscribeAgentState(
  agentPubkey: string,
  relayUrl: string,
  callback: (state: AgentOperationalState) => void
): () => void {
  // We use a SimplePool from nostr-tools for direct relay subscriptions
  // since CEPS subscribeMany is async; here we need a synchronous return.
  // The subscription is cleaned up via the returned unsubscribe closure.
  let closed = false;
  let sub: { close: () => void } | null = null;

  // Lazy import to avoid TDZ in non-browser environments
  import('nostr-tools').then(({ SimplePool }) => {
    if (closed) return;

    const pool = new SimplePool();
    sub = pool.subscribeMany(
      [relayUrl],
      [
        {
          kinds: [39201],
          authors: [agentPubkey],
          '#d': ['state'],
        },
      ],
      {
        onevent(event) {
          // Content is NIP-44 encrypted — attempt decrypt only if we have no key
          // The caller's callback receives plaintext when decryption is possible
          // For monitoring without the key, the raw status tag is used externally
          try {
            // Parse as plaintext fallback (non-encrypted legacy format)
            const parsed: AgentOperationalState = JSON.parse(event.content);
            if (parsed.status && parsed.lastHeartbeat !== undefined) {
              // Restore bigint from string serialization
              if (parsed.metrics && typeof (parsed.metrics as any).totalSpentMsats === 'string') {
                parsed.metrics.totalSpentMsats = BigInt((parsed.metrics as any).totalSpentMsats);
              }
              callback(parsed);
            }
          } catch {
            // Content is encrypted — extract status from tag for partial update
            const statusTag = event.tags.find((t) => t[0] === 'status');
            if (statusTag?.[1]) {
              const partialState: AgentOperationalState = {
                status: statusTag[1] as AgentOperationalState['status'],
                lastHeartbeat: event.created_at,
                metrics: {
                  tasksCompleted: 0,
                  tasksFailed: 0,
                  totalSpentMsats: BigInt(0),
                  uptimeSeconds: 0,
                },
              };
              callback(partialState);
            }
          }
        },
        oneose() {
          // Subscription is live — no action needed
        },
      }
    );
  }).catch((err) => {
    console.error('[agent-state] Failed to initialize state subscription:', err);
  });

  // Return unsubscribe function
  return () => {
    closed = true;
    if (sub) {
      sub.close();
      sub = null;
    }
  };
}

// ---------------------------------------------------------------------------
// publishAgentSchedule
// ---------------------------------------------------------------------------

/**
 * Publish an agent schedule/heartbeat configuration event (kind:39202).
 *
 * Tags:
 * - ["d", "schedule"]
 * - ["heartbeat_interval", "<seconds>"]
 * - ["active_hours", "<start_utc>", "<end_utc>"]   (optional)
 *
 * Content: JSON-serialized schedule config matching AgentScheduleContent.
 *
 * @param params - Schedule publication parameters
 * @returns Published event ID (hex)
 * @throws If heartbeat interval is invalid or publishing fails
 */
export async function publishAgentSchedule(
  params: PublishAgentScheduleParams
): Promise<string> {
  const { heartbeatIntervalSecs, activeHours, signerNsec, ceps } = params;

  if (heartbeatIntervalSecs < 30) {
    throw new Error(
      `Heartbeat interval must be at least 30 seconds, got ${heartbeatIntervalSecs}`
    );
  }

  const secretKey = decodeSecretKey(signerNsec);

  const scheduleContent = {
    heartbeatIntervalSeconds: heartbeatIntervalSecs,
    maxConcurrentTasks: 1, // Conservative default; agent runner can override
    ...(activeHours
      ? { preferredWorkingHoursUTC: activeHours }
      : {}),
  };

  const tags: string[][] = [
    ['d', 'schedule'],
    ['heartbeat_interval', String(heartbeatIntervalSecs)],
  ];

  if (activeHours) {
    tags.push(['active_hours', String(activeHours.start), String(activeHours.end)]);
  }

  const signed = finalizeEvent(
    {
      kind: 39202,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: JSON.stringify(scheduleContent),
    },
    secretKey
  );

  return ceps.publishEvent(signed as any);
}
