/**
 * @module frost/types
 * @description TypeScript type definitions for FROST threshold signing via
 * the `@frostr/bifrost` v2 protocol.
 *
 * FROST (Flexible Round-Optimized Schnorr Threshold) enables a t-of-n group
 * of participants to collaboratively sign Nostr events without any single
 * party ever holding the full group secret key. The group's identity
 * (public key) is preserved across share rotations and membership changes.
 *
 * Key terminology:
 * - **bfprofile**: The group's public configuration — threshold, participants,
 *   group pubkey. Contains no secret material. Stored per-participant in OPFS.
 * - **bfshare**: A participant's secret share of the group key. This is
 *   sensitive material that MUST only ever be stored in the OPFS Vault and
 *   backed up as a NIP-44-encrypted Nostr event.
 * - **DKG**: Distributed Key Generation ceremony — establishes the group
 *   keypair without any party knowing the full secret key.
 *
 * @see SPECIFICATION.md §4.3 — FROST Threshold Signatures
 * @see https://eprint.iacr.org/2020/852 — FROST paper
 * @see https://github.com/frostr-org/bifrost — @frostr/bifrost implementation
 */

// ---------------------------------------------------------------------------
// Group Identity Types
// ---------------------------------------------------------------------------

/**
 * Group profile (bfprofile) — the public metadata for a FROST group.
 * Contains no secret material. Published as kind:39200 on Nostr relays and
 * stored in each participant's OPFS Vault under `frost/{groupPubkey}.bfprofile`.
 */
export interface BfProfile {
  /** Group public key (hex) — the threshold signing pubkey */
  groupPubkey: string;

  /** Threshold (t): minimum number of participants required for signing */
  threshold: number;

  /** Total shares (n): total number of participants in the group */
  totalShares: number;

  /** Participant public keys (hex[]) in share-index order (index 0 = share 1) */
  participants: string[];

  /** Human-readable group metadata */
  metadata: GroupMetadata;

  /** Unix timestamp when this group was created */
  createdAt: number;
}

/**
 * Individual FROST share (bfshare) — a participant's secret share of the
 * group key. This is the MOST sensitive material in the vault. It must:
 * 1. Never leave the OPFS Vault in plaintext.
 * 2. Never be transmitted to any server.
 * 3. Only be backed up via NIP-44 encrypted kind:10000 Nostr events.
 *
 * Stored at `frost/{groupPubkey}.bfshare`.
 */
export interface BfShare {
  /** The participant's share index (1-based, per FROST spec) */
  index: number;

  /**
   * The participant's secret share scalar (hex-encoded 32 bytes).
   * ⚠️ SENSITIVE — treat as equivalent to an nsec.
   */
  secretShare: string;

  /** The participant's public verification key (hex-encoded 33 bytes, compressed) */
  publicShare: string;

  /** Group public key this share belongs to (hex) */
  groupPubkey: string;

  /**
   * Nonce commitments for the signing protocol.
   * Pre-generated for performance; consumed one-per-signing-round.
   * Refreshed after each signing ceremony.
   */
  nonceCommitments?: string[];
}

/**
 * Onboarding invitation from a Guardian to a new participant.
 * Published as an encrypted Nostr DM (NIP-17) to the invitee's pubkey.
 */
export interface BfOnboard {
  /** Group public key the invitee is being added to */
  groupPubkey: string;

  /** Threshold (t-of-n) of the group */
  threshold: number;

  /** Total shares of the group */
  totalShares: number;

  /** Hex pubkeys of existing participants (to verify quorum) */
  existingParticipants: string[];

  /** NIP-44-encrypted invitation payload (share index assignment, etc.) */
  encryptedPayload: string;
}

/**
 * Human-readable metadata for a FROST group.
 * Stored in BfProfile and published to kind:39200 agent profile events.
 */
export interface GroupMetadata {
  /** Display name for the group */
  name: string;

  /** Optional longer description */
  description?: string;

  /** Optional avatar URL */
  picture?: string;

  /**
   * Nostr event ID of the published kind:39200 group profile event.
   * Set after the profile has been published to a relay.
   */
  profileEventId?: string;
}

// ---------------------------------------------------------------------------
// DKG (Distributed Key Generation) Session
// ---------------------------------------------------------------------------

/**
 * State machine for a FROST Distributed Key Generation ceremony.
 *
 * State transitions:
 * ```
 * idle
 *   → round1_initiated  (Guardian calls initiateDkg)
 *   → round1_collecting (waiting for all participants to send commitments)
 *   → round2_initiated  (all round-1 commitments received, begin round 2)
 *   → round2_collecting (waiting for all participants to send shares)
 *   → completed         (group key derived, bfprofile/bfshare stored in vault)
 *   → failed            (timeout or protocol violation)
 * ```
 */
export type DkgState =
  | 'idle'
  | 'round1_initiated'
  | 'round1_collecting'
  | 'round2_initiated'
  | 'round2_collecting'
  | 'completed'
  | 'failed';

/**
 * An in-progress or completed DKG ceremony session.
 * Created by {@link initiateDkg} and mutated through
 * {@link processDkgRound1}, {@link processDkgRound2}, and {@link finalizeDkg}.
 */
export interface DkgSession {
  /** Current protocol state */
  state: DkgState;

  /**
   * Unique session identifier (random hex, 32 bytes).
   * Used as the `d` tag on coordinator events.
   */
  groupId: string;

  /** Threshold (t) for this group */
  threshold: number;

  /** Total shares (n) for this group */
  totalShares: number;

  /** Participant public keys (hex[]) */
  participants: string[];

  /**
   * Round-1 commitment packages received, keyed by participant pubkey.
   * Populated during the `round1_collecting` state.
   */
  round1Commitments: Map<string, Uint8Array>;

  /**
   * Round-2 secret share packages received, keyed by participant pubkey.
   * Populated during the `round2_collecting` state.
   */
  round2Shares: Map<string, Uint8Array>;

  /**
   * Human-readable error message if state is 'failed'.
   * Must not contain key material.
   */
  error?: string;

  /** Unix timestamp when this session was created */
  createdAt: number;

  /** Relay URL for the coordinator channel */
  coordinatorRelay?: string;
}

// ---------------------------------------------------------------------------
// Signing Session
// ---------------------------------------------------------------------------

/**
 * State machine for a FROST group signing ceremony.
 *
 * State transitions:
 * ```
 * idle
 *   → request_published      (initiator publishes signing request, kind 20100)
 *   → collecting_partial_sigs (waiting for threshold participants to respond)
 *   → combining               (aggregating partial signatures)
 *   → completed               (final Schnorr sig produced)
 *   → failed                  (timeout or insufficient participants)
 * ```
 */
export type SigningState =
  | 'idle'
  | 'request_published'
  | 'collecting_partial_sigs'
  | 'combining'
  | 'completed'
  | 'failed';

/**
 * An in-progress or completed group signing session.
 * Created by {@link initiateGroupSigning}.
 */
export interface SigningSession {
  /** Current protocol state */
  state: SigningState;

  /**
   * Unique session identifier (random hex, 32 bytes).
   * Included in coordinator event tags for correlation.
   */
  sessionId: string;

  /** Group public key being used for signing (hex) */
  groupPubkey: string;

  /** The unsigned Nostr event to be signed by the group */
  unsignedEvent: UnsignedNostrEvent;

  /**
   * Partial signatures collected, keyed by participant share index.
   * The map is considered complete when `partialSigs.size >= threshold`.
   */
  partialSigs: Map<number, Uint8Array>;

  /** Required threshold of partial signatures */
  threshold: number;

  /**
   * The final combined Schnorr signature (64-byte hex).
   * Only present when `state === 'completed'`.
   */
  finalSig?: string;

  /**
   * Human-readable error if `state === 'failed'`.
   * Must not contain key material.
   */
  error?: string;

  /** Unix timestamp when this session was created */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Nostr Event Types
// ---------------------------------------------------------------------------

/**
 * An unsigned Nostr event awaiting threshold signing.
 * Matches the NIP-01 event structure minus the `id` and `sig` fields.
 */
export interface UnsignedNostrEvent {
  /** Nostr event kind number */
  kind: number;

  /** Hex-encoded author public key (the group pubkey for group-signed events) */
  pubkey: string;

  /** Unix timestamp (seconds) */
  created_at: number;

  /** Array of NIP-01 tag arrays */
  tags: string[][];

  /** Event content string */
  content: string;
}

/**
 * A fully signed Nostr event.
 * Extends UnsignedNostrEvent with the computed `id` and Schnorr `sig`.
 */
export interface NostrEvent extends UnsignedNostrEvent {
  /** SHA-256 event ID (hex) */
  id: string;

  /** 64-byte Schnorr signature (hex) */
  sig: string;
}

// ---------------------------------------------------------------------------
// FROST Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the FrostClient and ceremony functions.
 * Passed to {@link FrostClient} constructor and ceremony helpers.
 */
export interface FrostConfig {
  /**
   * Nostr relay WebSocket URL for the FROST coordinator channel.
   * Participants must all connect to the same relay for a ceremony.
   *
   * @example 'wss://relay.satnam.pub'
   */
  coordinatorRelay: string;

  /**
   * Nostr event kind for FROST coordinator messages.
   * Must be in the ephemeral range (20000–29999).
   *
   * @default 20100
   */
  signingRequestKind: number;

  /**
   * Maximum time (ms) to wait for all DKG round participants to respond
   * before declaring the ceremony failed.
   *
   * @default 120000 (2 minutes)
   */
  dkgTimeout: number;

  /**
   * Maximum time (ms) to wait for threshold partial signatures during
   * a signing ceremony.
   *
   * @default 60000 (1 minute)
   */
  signingTimeout: number;
}

/**
 * Default FROST configuration values.
 */
export const DEFAULT_FROST_CONFIG: FrostConfig = {
  coordinatorRelay: 'wss://relay.satnam.pub',
  signingRequestKind: 20100,
  dkgTimeout: 120_000,
  signingTimeout: 60_000,
} as const;

// ---------------------------------------------------------------------------
// Coordinator Event Payload Types
// ---------------------------------------------------------------------------

/**
 * Payload for a DKG initiation event (kind 20100).
 * Published by the Guardian to invite participants to a new DKG ceremony.
 */
export interface DkgInitPayload {
  type: 'dkg_init';
  sessionId: string;
  threshold: number;
  totalShares: number;
  participants: string[];
  metadata: GroupMetadata;
  initiatorPubkey: string;
  timestamp: number;
}

/**
 * Payload for a DKG Round 1 message (kind 20100).
 * Contains the participant's commitment package.
 */
export interface DkgRound1Payload {
  type: 'dkg_round1';
  sessionId: string;
  participantPubkey: string;
  /** Base64-encoded commitment package */
  commitmentPackage: string;
  timestamp: number;
}

/**
 * Payload for a DKG Round 2 message (kind 20100).
 * Contains the participant's secret share package (encrypted to recipient).
 */
export interface DkgRound2Payload {
  type: 'dkg_round2';
  sessionId: string;
  fromPubkey: string;
  toPubkey: string;
  /** NIP-44 encrypted share package */
  encryptedSharePackage: string;
  timestamp: number;
}

/**
 * Payload for a signing request event (kind 20100).
 * Published by the signing initiator to request threshold participation.
 */
export interface SigningRequestPayload {
  type: 'signing_request';
  sessionId: string;
  groupPubkey: string;
  /** JSON-serialized UnsignedNostrEvent */
  unsignedEvent: string;
  /** Base64-encoded nonce commitments from the initiator */
  nonceCommitments: string;
  timestamp: number;
}

/**
 * Payload for a partial signature response (kind 20100).
 * Published by each co-signing participant.
 */
export interface PartialSigPayload {
  type: 'partial_sig';
  sessionId: string;
  groupPubkey: string;
  shareIndex: number;
  /** Hex-encoded partial signature scalar */
  partialSig: string;
  timestamp: number;
}

/**
 * Union of all FROST coordinator event payloads.
 */
export type FrostCoordinatorPayload =
  | DkgInitPayload
  | DkgRound1Payload
  | DkgRound2Payload
  | SigningRequestPayload
  | PartialSigPayload;

// ---------------------------------------------------------------------------
// Share Backup / Restore
// ---------------------------------------------------------------------------

/**
 * Metadata stored in the content of a kind:10000 share backup event.
 * The actual bfshare bytes are NIP-44 encrypted before embedding.
 */
export interface ShareBackupContent {
  version: number;
  groupPubkey: string;
  shareIndex: number;
  /** Base64-encoded NIP-44 ciphertext of the serialized BfShare */
  encryptedShare: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

/**
 * FROST-specific error discriminants.
 * Errors carry no data payloads to prevent key material or internal state
 * from appearing in logs.
 */
export enum FrostError {
  /** Attempted a ceremony operation without the vault being unlocked */
  VaultLocked = 'FrostError.VaultLocked',

  /** No bfshare found in vault for the requested group */
  ShareNotFound = 'FrostError.ShareNotFound',

  /** No bfprofile found in vault for the requested group */
  ProfileNotFound = 'FrostError.ProfileNotFound',

  /** DKG or signing ceremony timed out */
  CeremonyTimeout = 'FrostError.CeremonyTimeout',

  /** Insufficient participants responded to meet threshold */
  InsufficientParticipants = 'FrostError.InsufficientParticipants',

  /** The @frostr/bifrost package is not available */
  BifrostUnavailable = 'FrostError.BifrostUnavailable',

  /** Partial signature aggregation failed cryptographic verification */
  AggregationFailed = 'FrostError.AggregationFailed',

  /** NIP-44 encryption/decryption failed during backup or coordinator messaging */
  EncryptionFailed = 'FrostError.EncryptionFailed',

  /** Relay connection failed or was lost during a ceremony */
  RelayConnectionFailed = 'FrostError.RelayConnectionFailed',

  /** The caller's role does not permit this operation */
  PermissionDenied = 'FrostError.PermissionDenied',

  /** Share backup event has invalid format or failed decryption */
  InvalidBackup = 'FrostError.InvalidBackup',
}

/**
 * Create a typed FROST error.
 * Message is the enum variant name only — no data payloads.
 *
 * @internal
 */
export function frostErr(variant: FrostError): Error {
  return Object.assign(new Error(variant), { frostError: variant });
}
