/**
 * @module probe
 * @description Probe session protocol client and types.
 *
 * Probe is the OpenAgents coding agent. This module provides the Satnam
 * management interface for monitoring and controlling Probe sessions via
 * Nostr events on Pylon.
 *
 * ## Exports
 *
 * ### Client
 * - `ProbeSessionClient` — Subscribe to sessions, parse trajectory events,
 *   respond to tool calls, query session history
 *
 * ### Types
 * - `TrajectorySession` — kind:39230 session metadata
 * - `TrajectoryEvent` — kind:39231 trajectory step
 * - `TrajectoryEventType` — discriminant union
 * - `TrajectoryEventData` — discriminated union of all event payloads
 * - `ToolCallData`, `ToolApprovalData`, `ToolResultData` — tool interaction
 * - `DiffData`, `DiffHunk`, `DiffLine` — code diff structures
 * - `ResultData`, `FileChange`, `TestResult` — execution results
 * - `ErrorData`, `MessageData` — agent messages
 * - `SubscribeSessionOptions`, `ProbeSessionFilter` — subscription options
 *
 * ## Quick Start
 *
 * ```typescript
 * import { ProbeSessionClient } from '../lib/probe';
 * import { PylonCepsClient } from '../lib/pylon';
 *
 * const client = new ProbeSessionClient(pylonCepsClient);
 *
 * // Watch a Probe agent's session
 * const unsub = client.subscribeSession(agentPubkey, (event) => {
 *   if (event.eventType === 'tool_call') {
 *     const { toolName, callId, requiresApproval } = event.data as ToolCallData;
 *     if (requiresApproval) {
 *       // Show approval UI...
 *     }
 *   }
 * });
 *
 * // Approve a tool call
 * await client.respondToToolCall({ callId, approved: true, signerNsec, sessionId, agentPubkey });
 * ```
 */

export { ProbeSessionClient } from './session-client.js';

export type {
  TrajectoryEventType,
  TrajectorySession,
  TrajectoryEvent,
  TrajectoryEventData,
  ToolCallData,
  ToolApprovalData,
  ToolResultData,
  DiffData,
  DiffHunk,
  DiffLine,
  ResultData,
  FileChange,
  TestResult,
  ErrorData,
  MessageData,
  SubscribeSessionOptions,
  ProbeSessionFilter,
} from './types.js';
