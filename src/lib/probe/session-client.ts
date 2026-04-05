/**
 * @module probe/session-client
 * @description Probe session monitoring client.
 *
 * Subscribes to Probe trajectory events (kinds 39230/39231) via Pylon
 * and provides methods to:
 * - Monitor active Probe sessions
 * - Parse trajectory events into typed structures
 * - Respond to tool call approval requests
 * - Retrieve full session trajectories
 *
 * ## Nostr Event Structure
 *
 * ### kind:39230 — Trajectory Session
 * ```json
 * {
 *   "kind": 39230,
 *   "pubkey": "<agent_hex_pubkey>",
 *   "tags": [
 *     ["d", "<session_id>"],
 *     ["status", "active"],
 *     ["started_at", "<unix_timestamp>"]
 *   ],
 *   "content": "<optional_json_metadata>"
 * }
 * ```
 *
 * ### kind:39231 — Trajectory Event
 * ```json
 * {
 *   "kind": 39231,
 *   "pubkey": "<agent_hex_pubkey>",
 *   "tags": [
 *     ["d", "<session_id>"],
 *     ["type", "tool_call"],
 *     ["call_id", "<uuid>"]
 *   ],
 *   "content": "<json_payload>"
 * }
 * ```
 *
 * @see phase4-spec-sections-8-9.md §8.2
 */

import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import type { Event as NostrEvent } from 'nostr-tools';
import type { PylonCepsClient } from '../pylon/ceps-pylon.js';
import type {
  TrajectorySession,
  TrajectoryEvent,
  TrajectoryEventType,
  TrajectoryEventData,
  ToolCallData,
  ToolApprovalData,
  ToolResultData,
  DiffData,
  ResultData,
  ErrorData,
  MessageData,
  SubscribeSessionOptions,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Nostr event kind for trajectory session metadata. */
const TRAJECTORY_SESSION_KIND = 39230;

/** Nostr event kind for individual trajectory events. */
const TRAJECTORY_EVENT_KIND = 39231;

/** Default session list limit. */
const DEFAULT_SESSION_LIMIT = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode an nsec bech32 or 64-char hex string to raw secret key bytes.
 * @internal
 */
function decodeSecretKey(nsecOrHex: string): Uint8Array {
  if (/^[0-9a-fA-F]{64}$/.test(nsecOrHex)) {
    return hexToBytes(nsecOrHex);
  }
  if (nsecOrHex.startsWith('nsec1')) {
    const decoded = nip19.decode(nsecOrHex);
    if (decoded.type !== 'nsec') {
      throw new Error('Expected nsec bech32, got: ' + decoded.type);
    }
    return decoded.data as Uint8Array;
  }
  throw new Error('Invalid secret key format — expected nsec bech32 or 64-char hex');
}

/**
 * Extract the first value of a named tag from an event.
 * Returns `undefined` if the tag is not present.
 * @internal
 */
function getTag(event: NostrEvent, name: string): string | undefined {
  const tag = event.tags.find((t) => t[0] === name);
  return tag?.[1];
}

/**
 * Safely parse a JSON string, returning null on failure.
 * @internal
 */
function safeJsonParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ProbeSessionClient
// ---------------------------------------------------------------------------

/**
 * Client for monitoring and interacting with Probe agent sessions.
 *
 * All communication is via Nostr events on Pylon. No direct connection
 * to Probe infrastructure is required.
 *
 * @example
 * ```typescript
 * const client = new ProbeSessionClient(pylonCepsClient);
 *
 * // Subscribe to live trajectory events
 * const unsub = client.subscribeSession(
 *   agentPubkey,
 *   { since: Math.floor(Date.now() / 1000) - 3600 }
 * );
 * // Receive events via the Observable-style callback...
 *
 * // Approve a tool call
 * await client.respondToToolCall({
 *   callId: 'abc123',
 *   approved: true,
 *   signerNsec: myNsec,
 * });
 * ```
 */
export class ProbeSessionClient {
  /**
   * @param pylonCeps - Authenticated PylonCepsClient for all relay I/O
   */
  constructor(private readonly pylonCeps: PylonCepsClient) {}

  // ── Session Subscription ───────────────────────────────────────────────────

  /**
   * Subscribe to a Probe agent's trajectory events in real time.
   *
   * Subscribes to kinds [39230, 39231] on Pylon with `#p: [agentPubkey]`.
   * Calls `callback` for each new TrajectoryEvent received.
   *
   * @param agentPubkey - Hex public key of the Probe agent
   * @param callback - Called for each new trajectory event
   * @param options - Optional filter options (since, until, limit)
   * @returns Unsubscribe function — call to clean up
   */
  subscribeSession(
    agentPubkey: string,
    callback: (event: TrajectoryEvent) => void,
    options: SubscribeSessionOptions = {}
  ): () => void {
    const filter: Record<string, unknown> = {
      kinds: [TRAJECTORY_SESSION_KIND, TRAJECTORY_EVENT_KIND],
      '#p': [agentPubkey],
    };

    if (options.since !== undefined) filter['since'] = options.since;
    if (options.until !== undefined) filter['until'] = options.until;
    if (options.limit !== undefined) filter['limit'] = options.limit;

    return this.pylonCeps.subscribe(
      filter as any,
      (rawEvent: NostrEvent) => {
        if (rawEvent.kind === TRAJECTORY_EVENT_KIND) {
          try {
            const trajectoryEvent = this.parseTrajectoryEvent(rawEvent);
            callback(trajectoryEvent);
          } catch (err) {
            console.warn('[ProbeSessionClient] Failed to parse trajectory event:', err);
          }
        }
        // kind:39230 session events are handled separately via getActiveSessions
      }
    );
  }

  /**
   * Subscribe to both session and trajectory events.
   *
   * Unlike `subscribeSession`, this also fires `onSession` for kind:39230
   * events so callers can track session lifecycle changes in real time.
   *
   * @param agentPubkey - Hex public key of the Probe agent
   * @param onTrajectory - Called for each kind:39231 trajectory event
   * @param onSession - Called for each kind:39230 session event
   * @param options - Optional filter options
   * @returns Unsubscribe function
   */
  subscribeAll(
    agentPubkey: string,
    onTrajectory: (event: TrajectoryEvent) => void,
    onSession: (session: TrajectorySession) => void,
    options: SubscribeSessionOptions = {}
  ): () => void {
    const filter: Record<string, unknown> = {
      kinds: [TRAJECTORY_SESSION_KIND, TRAJECTORY_EVENT_KIND],
      '#p': [agentPubkey],
    };

    if (options.since !== undefined) filter['since'] = options.since;
    if (options.until !== undefined) filter['until'] = options.until;
    if (options.limit !== undefined) filter['limit'] = options.limit;

    return this.pylonCeps.subscribe(
      filter as any,
      (rawEvent: NostrEvent) => {
        try {
          if (rawEvent.kind === TRAJECTORY_SESSION_KIND) {
            const session = this.parseSessionEvent(rawEvent);
            onSession(session);
          } else if (rawEvent.kind === TRAJECTORY_EVENT_KIND) {
            const trajectoryEvent = this.parseTrajectoryEvent(rawEvent);
            onTrajectory(trajectoryEvent);
          }
        } catch (err) {
          console.warn('[ProbeSessionClient] Failed to parse event:', err);
        }
      }
    );
  }

  // ── Parsing ────────────────────────────────────────────────────────────────

  /**
   * Parse a kind:39230 session event into a typed TrajectorySession.
   *
   * @param event - Raw Nostr event with kind 39230
   * @returns Parsed TrajectorySession
   * @throws If required tags (d, status) are missing
   */
  parseSessionEvent(event: NostrEvent): TrajectorySession {
    if (event.kind !== TRAJECTORY_SESSION_KIND) {
      throw new Error(
        `[ProbeSessionClient] parseSessionEvent expects kind ${TRAJECTORY_SESSION_KIND}, got ${event.kind}`
      );
    }

    const sessionId = getTag(event, 'd');
    if (!sessionId) {
      throw new Error('[ProbeSessionClient] kind:39230 event missing "d" tag (session ID)');
    }

    const statusTag = getTag(event, 'status') ?? 'active';
    const status = ['active', 'paused', 'completed', 'failed'].includes(statusTag)
      ? (statusTag as TrajectorySession['status'])
      : 'active';

    const startedAtStr = getTag(event, 'started_at');
    const startedAt = startedAtStr ? parseInt(startedAtStr, 10) : event.created_at;

    // Collect all non-reserved tags as metadata
    const reservedTags = new Set(['d', 'status', 'started_at', 'p']);
    const metadata: Record<string, string> = {};
    for (const tag of event.tags) {
      if (tag.length >= 2 && !reservedTags.has(tag[0] ?? '')) {
        metadata[tag[0] ?? ''] = tag[1] ?? '';
      }
    }

    // Merge JSON content into metadata if parseable
    if (event.content) {
      const parsed = safeJsonParse<Record<string, string>>(event.content);
      if (parsed && typeof parsed === 'object') {
        Object.assign(metadata, parsed);
      }
    }

    return {
      sessionId,
      agentPubkey: event.pubkey,
      startedAt,
      status,
      metadata,
    };
  }

  /**
   * Parse a kind:39231 trajectory event into a typed TrajectoryEvent.
   *
   * The event content must be a JSON-serialized TrajectoryEventData object.
   * The `type` tag on the event overrides the `type` field in the content
   * if they differ.
   *
   * @param event - Raw Nostr event with kind 39231
   * @returns Parsed TrajectoryEvent
   * @throws If the session ID, event type, or content is missing/invalid
   */
  parseTrajectoryEvent(event: NostrEvent): TrajectoryEvent {
    if (event.kind !== TRAJECTORY_EVENT_KIND) {
      throw new Error(
        `[ProbeSessionClient] parseTrajectoryEvent expects kind ${TRAJECTORY_EVENT_KIND}, got ${event.kind}`
      );
    }

    const sessionId = getTag(event, 'd');
    if (!sessionId) {
      throw new Error('[ProbeSessionClient] kind:39231 event missing "d" tag (session ID)');
    }

    const eventType = getTag(event, 'type') as TrajectoryEventType | undefined;
    if (!eventType) {
      throw new Error('[ProbeSessionClient] kind:39231 event missing "type" tag');
    }

    const validTypes: TrajectoryEventType[] = [
      'tool_call', 'tool_approval', 'tool_result',
      'diff', 'result', 'error', 'message',
    ];
    if (!validTypes.includes(eventType)) {
      throw new Error(`[ProbeSessionClient] Unknown trajectory event type: "${eventType}"`);
    }

    // Parse JSON content
    const rawData = safeJsonParse<Record<string, unknown>>(event.content);

    // Build typed data from tag data + content
    const data = this._buildEventData(eventType, rawData, event);

    return {
      sessionId,
      eventType,
      timestamp: event.created_at,
      data,
    };
  }

  // ── Tool Call Response ─────────────────────────────────────────────────────

  /**
   * Publish a tool call approval or rejection response.
   *
   * Constructs and signs a kind:39231 event with `type: tool_approval`,
   * publishing via PylonCepsClient.
   *
   * @param params.callId - The call ID from the originating ToolCallData
   * @param params.approved - true = approved, false = rejected
   * @param params.sessionId - Session ID this call belongs to
   * @param params.agentPubkey - Agent pubkey to route the response to
   * @param params.signerNsec - nsec of the approver (Principal or Governor)
   * @param params.modifiedParameters - Optional parameter modifications
   * @returns Published event ID (hex)
   * @throws If signing or publishing fails
   */
  async respondToToolCall(params: {
    callId: string;
    approved: boolean;
    sessionId: string;
    agentPubkey: string;
    signerNsec: string;
    modifiedParameters?: Record<string, unknown>;
  }): Promise<string> {
    const {
      callId,
      approved,
      sessionId,
      agentPubkey,
      signerNsec,
      modifiedParameters,
    } = params;

    const secretKey = decodeSecretKey(signerNsec);
    const approverPubkey = getPublicKey(secretKey);

    const approvalData: ToolApprovalData = {
      type: 'tool_approval',
      callId,
      approved,
      approverPubkey,
      ...(modifiedParameters ? { modifiedParameters } : {}),
    };

    const tags: string[][] = [
      ['d', sessionId],
      ['p', agentPubkey],
      ['type', 'tool_approval'],
      ['call_id', callId],
      ['approved', String(approved)],
    ];

    if (modifiedParameters) {
      tags.push(['modified', 'true']);
    }

    const unsigned = {
      kind: TRAJECTORY_EVENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: JSON.stringify(approvalData),
    };

    const signed = finalizeEvent(unsigned, secretKey);
    await this.pylonCeps.publish(signed as NostrEvent);

    return signed.id;
  }

  // ── Session Queries ────────────────────────────────────────────────────────

  /**
   * Retrieve all active sessions for a Probe agent.
   *
   * Fetches kind:39230 events and filters to those with status = 'active'.
   *
   * @param agentPubkey - Hex public key of the Probe agent
   * @returns List of active TrajectorySession objects
   */
  async getActiveSessions(agentPubkey: string): Promise<TrajectorySession[]> {
    const events = await this.pylonCeps.list([
      {
        kinds: [TRAJECTORY_SESSION_KIND],
        authors: [agentPubkey],
        limit: DEFAULT_SESSION_LIMIT,
      } as any,
    ]);

    const sessions: TrajectorySession[] = [];
    for (const event of events) {
      try {
        const session = this.parseSessionEvent(event);
        if (session.status === 'active') {
          sessions.push(session);
        }
      } catch (err) {
        console.warn('[ProbeSessionClient] Failed to parse session event:', err);
      }
    }

    return sessions;
  }

  /**
   * Retrieve the full trajectory for a specific session.
   *
   * Fetches all kind:39231 events tagged with the given session ID.
   * Results are sorted chronologically by event created_at.
   *
   * @param sessionId - Session ID (the `d` tag value on kind:39231 events)
   * @param agentPubkey - Optional agent pubkey to scope the query
   * @returns Array of TrajectoryEvent objects, sorted by timestamp ascending
   */
  async getSessionTrajectory(
    sessionId: string,
    agentPubkey?: string
  ): Promise<TrajectoryEvent[]> {
    const filter: Record<string, unknown> = {
      kinds: [TRAJECTORY_EVENT_KIND],
      '#d': [sessionId],
    };

    if (agentPubkey) {
      filter['authors'] = [agentPubkey];
    }

    const events = await this.pylonCeps.list([filter as any]);

    // Sort chronologically
    events.sort((a, b) => a.created_at - b.created_at);

    const trajectory: TrajectoryEvent[] = [];
    for (const event of events) {
      try {
        trajectory.push(this.parseTrajectoryEvent(event));
      } catch (err) {
        console.warn('[ProbeSessionClient] Skipping unparseable trajectory event:', err);
      }
    }

    return trajectory;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Build a typed TrajectoryEventData from raw content + tags.
   * Merges tag-level data with JSON content for complete typed objects.
   * @internal
   */
  private _buildEventData(
    eventType: TrajectoryEventType,
    rawData: Record<string, unknown> | null,
    event: NostrEvent
  ): TrajectoryEventData {
    const data = rawData ?? {};

    switch (eventType) {
      case 'tool_call': {
        const callId = getTag(event, 'call_id') ?? (data['callId'] as string) ?? '';
        return {
          type: 'tool_call',
          toolName: (data['toolName'] as string) ?? getTag(event, 'tool_name') ?? '',
          parameters: (data['parameters'] as Record<string, unknown>) ?? {},
          requiresApproval: data['requiresApproval'] === true ||
            getTag(event, 'requires_approval') === 'true',
          callId,
        } satisfies ToolCallData;
      }

      case 'tool_approval': {
        const callId = getTag(event, 'call_id') ?? (data['callId'] as string) ?? '';
        const approved = data['approved'] === true ||
          getTag(event, 'approved') === 'true';
        const result: ToolApprovalData = {
          type: 'tool_approval',
          callId,
          approved,
          approverPubkey:
            (data['approverPubkey'] as string) ?? event.pubkey,
        };
        if (data['modifiedParameters']) {
          result.modifiedParameters = data['modifiedParameters'] as Record<string, unknown>;
        }
        return result;
      }

      case 'tool_result': {
        const callId = getTag(event, 'call_id') ?? (data['callId'] as string) ?? '';
        const result: ToolResultData = {
          type: 'tool_result',
          callId,
        };
        if (data['stdout'] !== undefined) result.stdout = data['stdout'] as string;
        if (data['stderr'] !== undefined) result.stderr = data['stderr'] as string;
        if (data['exitCode'] !== undefined) result.exitCode = data['exitCode'] as number;
        if (data['duration'] !== undefined) result.duration = data['duration'] as number;
        return result;
      }

      case 'diff': {
        return {
          type: 'diff',
          filePath: (data['filePath'] as string) ?? getTag(event, 'file') ?? '',
          hunks: (data['hunks'] as DiffData['hunks']) ?? [],
          language: (data['language'] as string | undefined) ??
            getTag(event, 'language'),
        } satisfies DiffData;
      }

      case 'result': {
        return {
          type: 'result',
          summary: (data['summary'] as string) ?? '',
          fileChanges: (data['fileChanges'] as ResultData['fileChanges']) ?? [],
          testResults: data['testResults'] as ResultData['testResults'],
        } satisfies ResultData;
      }

      case 'error': {
        return {
          type: 'error',
          message: (data['message'] as string) ?? getTag(event, 'error') ?? 'Unknown error',
          code: (data['code'] as string | undefined) ?? getTag(event, 'code'),
          stack: data['stack'] as string | undefined,
        } satisfies ErrorData;
      }

      case 'message': {
        return {
          type: 'message',
          content: (data['content'] as string) ?? event.content,
          role:
            ((data['role'] as string) ?? getTag(event, 'role') ?? 'agent') === 'system'
              ? 'system'
              : 'agent',
        } satisfies MessageData;
      }

      default: {
        // Exhaustive check — TypeScript will error if a variant is missing
        const _exhaustive: never = eventType;
        throw new Error(`[ProbeSessionClient] Unhandled event type: ${_exhaustive}`);
      }
    }
  }
}
