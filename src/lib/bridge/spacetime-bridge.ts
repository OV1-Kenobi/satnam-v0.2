/**
 * @module bridge/spacetime-bridge
 * @description SpacetimeDB bridge via Pylon relay.
 *
 * ## Architecture
 *
 * Satnam v2 does NOT add `@clockworklabs/spacetimedb-sdk` as a direct
 * dependency (axiom 4 — minimize deps). Instead, all SpacetimeDB
 * communication is bridged through Nostr events on the Pylon relay.
 *
 * The Pylon-side bridge module (part of the OpenAgents Pylon deployment,
 * not Satnam's responsibility) translates Nostr events into SpacetimeDB
 * table operations and vice versa.
 *
 * ## Bridge Mapping (spec §8.4)
 *
 * | SpacetimeDB Table    | Direction                    | Nostr Kind |
 * |---------------------|------------------------------|-----------|
 * | session_presence     | Satnam → SpacetimeDB via Pylon | 10003    |
 * | sync_event           | Bidirectional                | 39201     |
 * | sync_checkpoint      | SpacetimeDB → Satnam via Pylon | 39231   |
 * | provider_capability  | Satnam → SpacetimeDB via Pylon | 31990   |
 * | compute_assignment   | SpacetimeDB → Satnam via Pylon | 39242   |
 * | bridge_outbox        | SpacetimeDB → Satnam via Pylon | 39211   |
 * | presence_event       | Satnam → SpacetimeDB via Pylon | 10003   |
 *
 * ## Usage
 *
 * ```typescript
 * const bridge = new SpacetimeBridge(pylonCepsClient, vault);
 *
 * // Publish presence
 * await bridge.publishPresence({ status: 'online', agentPubkey: myPubkey });
 *
 * // Subscribe to compute assignments
 * const unsub = bridge.subscribeComputeAssignments(myPubkey, (assignment) => {
 *   console.log('New compute task:', assignment.taskDescription);
 * });
 *
 * // Start heartbeat
 * const stopHeartbeat = bridge.startHeartbeatInterval(myPubkey, 30_000);
 * ```
 *
 * @see phase4-spec-sections-8-9.md §8.4
 */

import { finalizeEvent, getPublicKey } from 'nostr-tools';
import type { Event as NostrEvent } from 'nostr-tools';
import type { PylonCepsClient } from '../pylon/ceps-pylon.js';
import type { Vault } from '../vault/vault.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Nostr event kind for presence events (session_presence + presence_event tables). */
const PRESENCE_KIND = 10003;

/** Nostr event kind for compute assignment events (SpacetimeDB → Satnam). */
const COMPUTE_ASSIGNMENT_KIND = 39242;

/** Nostr event kind for sync checkpoints (SpacetimeDB → Satnam). */
const SYNC_CHECKPOINT_KIND = 39231;

/** Nostr event kind for bridge outbox messages. */
const BRIDGE_OUTBOX_KIND = 39211;

/** Default heartbeat content. */
const HEARTBEAT_CONTENT = 'heartbeat';

// ---------------------------------------------------------------------------
// Exported Types
// ---------------------------------------------------------------------------

/**
 * A compute task assignment routed from SpacetimeDB via Pylon.
 * Corresponds to the `compute_assignment` SpacetimeDB table.
 * Arrives as a kind:39242 (Credit Envelope) event.
 */
export interface ComputeAssignment {
  /** The Nostr event ID of the credit envelope event. */
  envelopeEventId: string;

  /** Hex pubkey of the agent assigned to this task. */
  assignedAgentPubkey: string;

  /** Human-readable description of the task. */
  taskDescription: string;

  /** Budget in millisatoshis allocated for this task. */
  budgetMsats: bigint;

  /** Unix timestamp deadline for task completion. */
  deadline: number;
}

/**
 * A sync checkpoint from SpacetimeDB via Pylon.
 * Corresponds to the `sync_checkpoint` SpacetimeDB table.
 * Arrives as a kind:39231 event with `type: sync_checkpoint` tag.
 */
export interface SyncCheckpoint {
  /** Session ID this checkpoint belongs to. */
  sessionId: string;

  /** Checkpoint identifier string. */
  checkpoint: string;

  /** Unix timestamp of the checkpoint. */
  timestamp: number;

  /** Arbitrary checkpoint data. */
  data: Record<string, unknown>;
}

/**
 * Presence status values for the session_presence table.
 */
export type PresenceStatus = 'online' | 'away' | 'offline';

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/** Options for publishPresence. */
interface PresenceParams {
  /** Presence status to publish. */
  status: PresenceStatus;

  /** Optional agent pubkey to tag in the presence event. */
  agentPubkey?: string;
}

// ---------------------------------------------------------------------------
// SpacetimeBridge
// ---------------------------------------------------------------------------

/**
 * SpacetimeDB bridge — all communication via Nostr events on Pylon.
 *
 * This class does NOT connect directly to SpacetimeDB. The Pylon-side
 * bridge module handles translation between Nostr events and SpacetimeDB
 * table operations.
 */
export class SpacetimeBridge {
  /** Currently active heartbeat timer, or null if stopped. */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** Current presence status (tracked locally to avoid redundant publishes). */
  private currentPresenceStatus: PresenceStatus = 'offline';

  /**
   * @param pylonCeps - Authenticated PylonCepsClient for all relay I/O
   * @param vault - OPFS Vault for retrieving the Principal's nsec
   */
  constructor(
    private readonly pylonCeps: PylonCepsClient,
    private readonly vault: Vault
  ) {}

  // ── Presence ───────────────────────────────────────────────────────────────

  /**
   * Publish a presence event (kind:10003) to Pylon.
   *
   * The Pylon-side bridge translates this event into a SpacetimeDB
   * `session_presence` and `presence_event` table insert.
   *
   * Event structure:
   * ```json
   * {
   *   "kind": 10003,
   *   "tags": [
   *     ["status", "online"],
   *     ["agent", "<agent_hex_pubkey>"],   // if agentPubkey provided
   *     ["d", "presence"]
   *   ],
   *   "content": "{\"status\":\"online\"}"
   * }
   * ```
   *
   * @param params.status - Current presence status
   * @param params.agentPubkey - Optional agent pubkey to include in the event
   * @throws If Vault nsec retrieval or event publishing fails
   */
  async publishPresence(params: PresenceParams): Promise<void> {
    const { status, agentPubkey } = params;

    // Retrieve Principal's nsec from vault (first identity = principal)
    const identities = await this.vault.listIdentities();
    if (identities.length === 0) {
      throw new Error('[SpacetimeBridge] No identities in vault — unlock vault before publishing presence');
    }
    const principalNpub = identities[0]!;
    const nsecBytes = await this.vault.getNsec(principalNpub);
    try {
      const principalPubkey = getPublicKey(nsecBytes);

      const tags: string[][] = [
        ['d', 'presence'],
        ['status', status],
      ];

      if (agentPubkey) {
        tags.push(['p', agentPubkey]);
        tags.push(['agent', agentPubkey]);
      }

      const unsigned = {
        kind: PRESENCE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: JSON.stringify({
          status,
          pubkey: principalPubkey,
          ...(agentPubkey ? { agentPubkey } : {}),
          timestamp: Math.floor(Date.now() / 1000),
        }),
      };

      const signed = finalizeEvent(unsigned, nsecBytes);
      await this.pylonCeps.publish(signed as NostrEvent);
    } finally {
      nsecBytes.fill(0);
    }

    this.currentPresenceStatus = status;
  }

  // ── Compute Assignments ────────────────────────────────────────────────────

  /**
   * Subscribe to compute assignments routed from SpacetimeDB.
   *
   * Listens for kind:39242 (Credit Envelope) events tagged with the
   * provided pubkey. The Pylon bridge routes compute assignments from
   * the SpacetimeDB `compute_assignment` table as these events.
   *
   * @param pubkey - Hex pubkey to filter assignments for
   * @param callback - Called for each new compute assignment
   * @returns Unsubscribe function — call to clean up
   */
  subscribeComputeAssignments(
    pubkey: string,
    callback: (assignment: ComputeAssignment) => void
  ): () => void {
    return this.pylonCeps.subscribe(
      {
        kinds: [COMPUTE_ASSIGNMENT_KIND],
        '#p': [pubkey],
      } as any,
      (rawEvent: NostrEvent) => {
        try {
          const assignment = this._parseComputeAssignment(rawEvent);
          if (assignment) {
            callback(assignment);
          }
        } catch (err) {
          console.warn('[SpacetimeBridge] Failed to parse compute assignment:', err);
        }
      }
    );
  }

  // ── Sync Checkpoints ───────────────────────────────────────────────────────

  /**
   * Subscribe to sync checkpoints from SpacetimeDB.
   *
   * Listens for kind:39231 trajectory events tagged with `type: sync_checkpoint`
   * and the specified agent pubkey. The Pylon bridge routes these from
   * the SpacetimeDB `sync_checkpoint` table.
   *
   * @param agentPubkey - Hex pubkey of the agent to subscribe for
   * @param callback - Called for each new sync checkpoint
   * @returns Unsubscribe function — call to clean up
   */
  subscribeSyncCheckpoints(
    agentPubkey: string,
    callback: (checkpoint: SyncCheckpoint) => void
  ): () => void {
    return this.pylonCeps.subscribe(
      {
        kinds: [SYNC_CHECKPOINT_KIND],
        '#p': [agentPubkey],
        '#type': ['sync_checkpoint'],
      } as any,
      (rawEvent: NostrEvent) => {
        try {
          const checkpoint = this._parseSyncCheckpoint(rawEvent);
          if (checkpoint) {
            callback(checkpoint);
          }
        } catch (err) {
          console.warn('[SpacetimeBridge] Failed to parse sync checkpoint:', err);
        }
      }
    );
  }

  // ── Bridge Outbox ──────────────────────────────────────────────────────────

  /**
   * Subscribe to bridge outbox messages from SpacetimeDB.
   *
   * Listens for kind:39211 (tick result) events routed from the
   * SpacetimeDB `bridge_outbox` table via Pylon.
   *
   * @param pubkey - Hex pubkey to filter outbox messages for
   * @param callback - Called for each bridge outbox message
   * @returns Unsubscribe function
   */
  subscribeBridgeOutbox(
    pubkey: string,
    callback: (event: NostrEvent) => void
  ): () => void {
    return this.pylonCeps.subscribe(
      {
        kinds: [BRIDGE_OUTBOX_KIND],
        '#p': [pubkey],
      } as any,
      callback
    );
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────────

  /**
   * Publish a single agent heartbeat event.
   *
   * Publishes a presence event (kind:10003) with `status: online` for
   * the specified agent pubkey. The Pylon bridge bridges this to the
   * SpacetimeDB `presence_event` table.
   *
   * @param agentPubkey - Hex pubkey of the agent sending the heartbeat
   * @throws If Vault nsec retrieval or publishing fails
   */
  async publishHeartbeat(agentPubkey: string): Promise<void> {
    // Retrieve Principal's nsec from vault (first identity = principal)
    const identities = await this.vault.listIdentities();
    if (identities.length === 0) {
      throw new Error('[SpacetimeBridge] No identities in vault — unlock vault before publishing heartbeat');
    }
    const principalNpub = identities[0]!;
    const nsecBytes = await this.vault.getNsec(principalNpub);
    try {
      const unsigned = {
        kind: PRESENCE_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['d', 'heartbeat'],
          ['p', agentPubkey],
          ['agent', agentPubkey],
          ['status', 'online'],
          ['heartbeat', 'true'],
        ],
        content: JSON.stringify({
          type: HEARTBEAT_CONTENT,
          agentPubkey,
          timestamp: Math.floor(Date.now() / 1000),
        }),
      };

      const signed = finalizeEvent(unsigned, nsecBytes);
      await this.pylonCeps.publish(signed as NostrEvent);
    } finally {
      nsecBytes.fill(0);
    }
  }

  /**
   * Start a periodic heartbeat publishing interval.
   *
   * Immediately publishes one heartbeat, then repeats at `intervalMs`.
   * The first failure is logged but does not stop the interval.
   *
   * @param agentPubkey - Hex pubkey of the agent
   * @param intervalMs - Interval between heartbeats in milliseconds (min 10s)
   * @returns Stop function — call to cancel the interval
   */
  startHeartbeatInterval(
    agentPubkey: string,
    intervalMs: number
  ): () => void {
    if (intervalMs < 10_000) {
      console.warn(
        `[SpacetimeBridge] Heartbeat interval ${intervalMs}ms is below minimum 10s — clamping to 10s`
      );
      intervalMs = 10_000;
    }

    // Stop any existing heartbeat
    this.stopHeartbeatInterval();

    // Publish immediately
    this.publishHeartbeat(agentPubkey).catch((err) =>
      console.warn('[SpacetimeBridge] Initial heartbeat failed:', err)
    );

    // Schedule recurring heartbeats
    this.heartbeatTimer = setInterval(() => {
      this.publishHeartbeat(agentPubkey).catch((err) =>
        console.warn('[SpacetimeBridge] Heartbeat publish failed:', err)
      );
    }, intervalMs);

    return () => this.stopHeartbeatInterval();
  }

  /**
   * Stop the active heartbeat interval if one is running.
   */
  stopHeartbeatInterval(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Whether a heartbeat interval is currently active.
   */
  get isHeartbeatActive(): boolean {
    return this.heartbeatTimer !== null;
  }

  /**
   * The most recently published presence status.
   */
  get presenceStatus(): PresenceStatus {
    return this.currentPresenceStatus;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Parse a kind:39242 event into a ComputeAssignment.
   * Returns null if the event is not a valid compute assignment.
   * @internal
   */
  private _parseComputeAssignment(event: NostrEvent): ComputeAssignment | null {
    if (event.kind !== COMPUTE_ASSIGNMENT_KIND) return null;

    const assignedAgentPubkey =
      this._getTag(event, 'p') ?? event.pubkey;

    const budgetTag = this._getTag(event, 'amount');
    const deadlineTag = this._getTag(event, 'expiry');

    let taskDescription = '';
    let budgetMsats = BigInt(0);
    let deadline = Math.floor(Date.now() / 1000) + 3600; // Default 1 hour

    // Try to parse content as JSON for richer data
    try {
      const content = JSON.parse(event.content);
      taskDescription = content.description ?? content.task ?? '';
      if (content.budget_msats) {
        budgetMsats = BigInt(content.budget_msats);
      }
      if (content.deadline) {
        deadline = Number(content.deadline);
      }
    } catch {
      taskDescription = event.content;
    }

    // Override with tag data if present
    if (budgetTag) {
      try {
        budgetMsats = BigInt(budgetTag);
      } catch {
        // Ignore parse errors
      }
    }
    if (deadlineTag) {
      deadline = parseInt(deadlineTag, 10);
    }

    return {
      envelopeEventId: event.id,
      assignedAgentPubkey,
      taskDescription,
      budgetMsats,
      deadline,
    };
  }

  /**
   * Parse a kind:39231 sync checkpoint event into a SyncCheckpoint.
   * Returns null if the event lacks required sync_checkpoint tags.
   * @internal
   */
  private _parseSyncCheckpoint(event: NostrEvent): SyncCheckpoint | null {
    const typeTag = this._getTag(event, 'type');
    if (typeTag !== 'sync_checkpoint') return null;

    const sessionId = this._getTag(event, 'd') ?? '';
    const checkpoint = this._getTag(event, 'checkpoint') ?? '';

    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(event.content) as Record<string, unknown>;
    } catch {
      // Content might not be JSON
    }

    return {
      sessionId,
      checkpoint,
      timestamp: event.created_at,
      data,
    };
  }

  /**
   * Extract the first value of a named tag from an event.
   * @internal
   */
  private _getTag(event: NostrEvent, name: string): string | undefined {
    const tag = event.tags.find((t) => t[0] === name);
    return tag?.[1];
  }

}
