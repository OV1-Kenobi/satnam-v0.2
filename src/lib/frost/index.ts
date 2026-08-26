/**
 * @module frost
 * @description FROST threshold signing module for Satnam v2.
 *
 * Provides the complete FROST (Flexible Round-Optimized Schnorr Threshold)
 * implementation for Nostr-native t-of-n group signing via the
 * `@frostr/bifrost` v2 package.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { FrostClient, DEFAULT_FROST_CONFIG } from '@/lib/frost';
 * import { getVault } from '@/lib/vault';
 *
 * const client = new FrostClient(getVault(), DEFAULT_FROST_CONFIG);
 *
 * // Create a 2-of-3 group
 * const profile = await client.createGroup({
 *   name: 'Family Multisig',
 *   threshold: 2,
 *   participants: [guardian, steward1, steward2],
 *   guardianNsec: myNsec,
 * });
 *
 * // Sign an event
 * const sig = await client.groupSign(profile.groupPubkey, unsignedEvent);
 * ```
 *
 * ## Module Structure
 *
 * - `types.ts` — All FROST types (BfProfile, BfShare, DkgSession, etc.)
 * - `vault-storage.ts` — Vault persistence for profiles and shares
 * - `ceremony.ts` — DKG and signing ceremony coordination
 * - `client.ts` — High-level FrostClient class
 *
 * @see SPECIFICATION.md §4.3 — FROST Threshold Signatures
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  BfProfile,
  BfShare,
  BfOnboard,
  GroupMetadata,
  DkgState,
  DkgSession,
  SigningState,
  SigningSession,
  UnsignedNostrEvent,
  NostrEvent,
  FrostConfig,
  DkgInitPayload,
  DkgRound1Payload,
  DkgRound2Payload,
  SigningRequestPayload,
  PartialSigPayload,
  FrostCoordinatorPayload,
  ShareBackupContent,
} from './types.js';

export {
  DEFAULT_FROST_CONFIG,
  FrostError,
  frostErr,
} from './types.js';

// ---------------------------------------------------------------------------
// Vault Storage
// ---------------------------------------------------------------------------

export {
  storeBfProfile,
  storeBfProfileAndRegister,
  retrieveBfProfile,
  storeBfShare,
  retrieveBfShare,
  listGroups,
  deleteGroupData,
  createShareBackupEvent,
  restoreShareFromBackup,
  hasShareForGroup,
  generateSessionId,
} from './vault-storage.js';

// ---------------------------------------------------------------------------
// Ceremony Functions
// ---------------------------------------------------------------------------

export {
  initiateDkg,
  joinDkg,
  initiateGroupSigning,
  computeEventSighash,
  runTrustedDealerCreation,
  deliverShareInvitation,
  acceptShareInvitation,
  openGroupSigningNode,
  ensureResponderOnline,
  closeAllResponders,
  collectRelayMessages,
} from './ceremony.js';

export type {
  ShareInvitationPayload,
} from './ceremony.js';

// ---------------------------------------------------------------------------
// BifrostNode wrapper
// ---------------------------------------------------------------------------

export {
  decodeGroupPackage,
  decodeSharePackage,
  encodeGroupPackage,
  encodeSharePackage,
  createConnectedNode,
  closeNodeQuietly,
  requestThresholdSignature,
  NODE_CONNECT_TIMEOUT_MS,
} from './node.js';

// ---------------------------------------------------------------------------
// High-level Client
// ---------------------------------------------------------------------------

export { FrostClient, getFrostClient } from './client.js';
