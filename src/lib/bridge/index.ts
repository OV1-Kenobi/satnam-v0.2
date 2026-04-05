/**
 * @module bridge
 * @description SpacetimeDB bridge via Pylon relay.
 *
 * Satnam v2 bridges to SpacetimeDB via Nostr events on Pylon rather than
 * adding the SpacetimeDB SDK as a direct dependency (axiom 4).
 *
 * ## Exports
 *
 * - `SpacetimeBridge` — Main bridge class for presence, compute assignments,
 *   sync checkpoints, and heartbeats
 * - `ComputeAssignment` — Typed compute task assignment from SpacetimeDB
 * - `SyncCheckpoint` — Typed sync checkpoint from SpacetimeDB
 * - `PresenceStatus` — 'online' | 'away' | 'offline'
 *
 * ## Quick Start
 *
 * ```typescript
 * import { SpacetimeBridge } from '../lib/bridge';
 * import { PylonCepsClient } from '../lib/pylon';
 *
 * const bridge = new SpacetimeBridge(pylonCepsClient, vault);
 *
 * // Publish presence
 * await bridge.publishPresence({ status: 'online' });
 *
 * // Subscribe to compute assignments
 * const unsub = bridge.subscribeComputeAssignments(pubkey, (assignment) => {
 *   console.log('New task:', assignment.taskDescription);
 * });
 *
 * // Heartbeat every 30 seconds
 * const stop = bridge.startHeartbeatInterval(agentPubkey, 30_000);
 * ```
 */

export { SpacetimeBridge } from './spacetime-bridge.js';

export type {
  ComputeAssignment,
  SyncCheckpoint,
  PresenceStatus,
} from './spacetime-bridge.js';
