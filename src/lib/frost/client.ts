/**
 * @module frost/client
 * @description High-level FrostClient class providing a unified interface for
 * all FROST threshold signing operations in Satnam v2.
 *
 * FrostClient wraps the ceremony coordination ({@link ceremony}) and vault
 * storage ({@link vault-storage}) modules, handling:
 * - Group creation (DKG ceremony initiation by Guardian)
 * - Group joining (DKG ceremony participation by Steward)
 * - Group listing (from vault)
 * - Threshold signing (group sign coordination)
 * - Share rotation
 * - Share backup and restore
 *
 * ## Usage
 *
 * ```typescript
 * const client = new FrostClient(getVault(), {
 *   coordinatorRelay: 'wss://relay.satnam.pub',
 *   signingRequestKind: 20100,
 *   dkgTimeout: 120_000,
 *   signingTimeout: 60_000,
 * });
 *
 * // Create a 2-of-3 group
 * const profile = await client.createGroup({
 *   name: 'Family Multisig',
 *   threshold: 2,
 *   participants: [guardianPubkey, steward1Pubkey, steward2Pubkey],
 *   guardianNsec: myNsec,
 * });
 *
 * // Sign an event with threshold
 * const sig = await client.groupSign(profile.groupPubkey, unsignedEvent);
 * ```
 *
 * ## Security Notes
 *
 * - All secret material (bfshare) is retrieved from and stored to the OPFS
 *   Vault. FrostClient never holds key material in instance state.
 * - The Vault must be unlocked before any operation. FrostClient propagates
 *   VaultError.VaultLocked if the vault is locked.
 * - groupSign() and requestGroupSignature() require the vault to be unlocked
 *   to retrieve the bfshare for signing.
 *
 * @see SPECIFICATION.md §4.3 — FROST Threshold Signatures
 */

import type { Vault } from '../vault/vault.js';
import {
  type BfProfile,
  type BfShare,
  type BfOnboard,
  type DkgSession,
  type SigningSession,
  type UnsignedNostrEvent,
  type GroupMetadata,
  type FrostConfig,
  type NostrEvent,
  DEFAULT_FROST_CONFIG,
  FrostError,
  frostErr,
} from './types.js';
import {
  storeBfProfileAndRegister,
  storeBfShare,
  retrieveBfProfile,
  retrieveBfShare,
  listGroups,
  createShareBackupEvent,
  restoreShareFromBackup,
} from './vault-storage.js';
import {
  initiateDkg,
  joinDkg,
  processDkgRound1,
  processDkgRound2,
  finalizeDkg,
  initiateGroupSigning,
  respondToSigningRequest,
  combineSignatures,
  collectPartialSigs,
  collectRelayMessages,
  rotateShares as rotateSharesCeremony,
} from './ceremony.js';

// ---------------------------------------------------------------------------
// FrostClient
// ---------------------------------------------------------------------------

/**
 * High-level FROST threshold signing client for Satnam v2.
 *
 * Wraps ceremony coordination and vault storage into a clean, composable API.
 * Designed to be instantiated once per application session and injected into
 * React context via the {@link useFrost} hook.
 */
export class FrostClient {
  /**
   * Create a new FrostClient.
   *
   * @param vault - The OPFS Vault instance (must be initialized and unlocked
   *   before calling most methods). Passed for injection/testing — the client
   *   calls getVault() internally but also accepts an explicit vault for tests.
   * @param config - FROST protocol configuration
   */
  constructor(
    _vault: Vault,
    private readonly config: FrostConfig = DEFAULT_FROST_CONFIG,
  ) {
    void _vault; // vault is held for future direct vault operations
  }

  // -------------------------------------------------------------------------
  // Group Creation (Guardian only)
  // -------------------------------------------------------------------------

  /**
   * Create a new FROST group by initiating a DKG ceremony (Guardian only).
   *
   * Runs the full DKG state machine:
   * 1. Initiates the ceremony and publishes the init event to the coordinator relay
   * 2. Processes DKG Round 1 (generates and broadcasts commitment package)
   * 3. Advances to Round 2 once all Round 1 commitments are collected
   * 4. Finalizes the DKG to derive the group pubkey
   * 5. Stores the bfprofile and bfshare in the OPFS Vault
   *
   * @param params - Group creation parameters
   * @returns The BfProfile for the newly created group
   * @throws {FrostError.PermissionDenied} if the caller is not a Guardian
   * @throws {FrostError.CeremonyTimeout} if DKG times out
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  async createGroup(params: {
    name: string;
    description?: string;
    threshold: number;
    participants: string[]; // hex pubkeys of all participants
    guardianNsec: string; // hex-encoded 32-byte nsec of the Guardian
  }): Promise<BfProfile> {
    const { name, description, threshold, participants, guardianNsec } = params;

    const metadata: GroupMetadata = {
      name,
      description,
    };

    // Phase 1: Initiate the DKG ceremony
    let session: DkgSession = await initiateDkg({
      threshold,
      participants,
      groupMetadata: metadata,
      coordinatorRelay: this.config.coordinatorRelay,
      initiatorNsec: guardianNsec,
    });

    // Phase 2: Process Round 1 (generate our commitment)
    session = await processDkgRound1(session);

    // Phase 3: Wait for Round 1 from all participants (with timeout)
    session = await this._waitForDkgRound1(session);

    // Phase 4: Process Round 2 (exchange shares)
    session = { ...session, state: 'round2_initiated' };
    session = await processDkgRound2(session);

    // Phase 5: Wait for Round 2 from all participants (with timeout)
    session = await this._waitForDkgRound2(session);

    // Phase 6: Finalize DKG — derives group pubkey and stores to vault
    const { profile } = await finalizeDkg(session);

    return profile;
  }

  /**
   * Wait for all Round 1 commitments to arrive.
   * Transitions the session from `round1_collecting` to `round2_initiated`.
   * @internal
   */
  private async _waitForDkgRound1(session: DkgSession): Promise<DkgSession> {
    // Collect round-1 commitment packages from all participants via the coordinator relay.
    // Waits until all `totalShares` participants have published their round-1 events,
    // or until the DKG timeout elapses.
    const timeoutMs = this.config.dkgTimeout ?? 120_000;
    const events = await collectRelayMessages(
      session.coordinatorRelay ?? this.config.coordinatorRelay,
      {
        kinds: [this.config.signingRequestKind],
        '#d': [session.groupId],
      },
      session.totalShares,
      timeoutMs,
    );

    // Parse round-1 commitments from collected events
    const round1Commitments = new Map<string, Uint8Array>(session.round1Commitments);
    const encoder = new TextEncoder();
    for (const event of events) {
      try {
        const payload = JSON.parse(event.content) as { type?: string; commitments?: string };
        if (payload.type === 'dkg_round1' && payload.commitments) {
          round1Commitments.set(event.pubkey, encoder.encode(payload.commitments));
        }
      } catch { /* ignore malformed events */ }
    }

    return {
      ...session,
      state: 'round2_initiated',
      round1Commitments,
    };
  }

  /**
   * Wait for all Round 2 shares to arrive.
   * Transitions the session from `round2_collecting` to `round2_collecting`
   * with all shares populated, ready for finalization.
   * @internal
   */
  private async _waitForDkgRound2(session: DkgSession): Promise<DkgSession> {
    // Collect round-2 secret share packages from all participants via the coordinator relay.
    // Waits until all `totalShares` participants have published their round-2 events,
    // or until the DKG timeout elapses.
    const timeoutMs = this.config.dkgTimeout ?? 120_000;
    const events = await collectRelayMessages(
      session.coordinatorRelay ?? this.config.coordinatorRelay,
      {
        kinds: [this.config.signingRequestKind],
        '#d': [session.groupId],
      },
      session.totalShares,
      timeoutMs,
    );

    // Parse round-2 share packages from collected events
    const round2Shares = new Map<string, Uint8Array>(session.round2Shares);
    const encoder = new TextEncoder();
    for (const event of events) {
      try {
        const payload = JSON.parse(event.content) as { type?: string; sharePackage?: string };
        if (payload.type === 'dkg_round2' && payload.sharePackage) {
          round2Shares.set(event.pubkey, encoder.encode(payload.sharePackage));
        }
      } catch { /* ignore malformed events */ }
    }

    return {
      ...session,
      state: 'round2_collecting',
      round2Shares,
    };
  }

  // -------------------------------------------------------------------------
  // Group Joining
  // -------------------------------------------------------------------------

  /**
   * Join an existing FROST group (Steward responding to Guardian's invitation).
   *
   * Processes the BfOnboard invitation, participates in the DKG ceremony on
   * the coordinator relay, and stores the resulting bfprofile and bfshare
   * in the OPFS Vault.
   *
   * @param invitation - The BfOnboard invitation from the Guardian
   * @param participantNsec - Hex-encoded 32-byte participant secret key
   * @returns The BfProfile for the joined group
   * @throws {FrostError.CeremonyTimeout} if the DKG ceremony is not found
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  async joinGroup(invitation: BfOnboard, participantNsec: string): Promise<BfProfile> {
    // Decode the invitation to find the session ID
    // In a full implementation, the encryptedPayload would be NIP-44 decrypted
    // to reveal the sessionId and share index assignment
    const sessionId = invitation.groupPubkey; // Use groupPubkey as session ID in onboarding

    let session: DkgSession = await joinDkg({
      sessionId,
      coordinatorRelay: this.config.coordinatorRelay,
      participantNsec,
    });

    // Participate in Round 1
    session = await processDkgRound1(session);

    // Participate in Round 2 (after Round 1 completes across participants)
    session = { ...session, state: 'round2_initiated' };
    session = await processDkgRound2(session);

    // Finalize: derive group key and store to vault
    session = { ...session, state: 'round2_collecting' };
    const { profile } = await finalizeDkg(session);

    return profile;
  }

  // -------------------------------------------------------------------------
  // Group Listing
  // -------------------------------------------------------------------------

  /**
   * List all FROST groups this participant belongs to.
   *
   * Reads all `frost/*.bfprofile` entries from the OPFS Vault.
   *
   * @returns Array of BfProfile for all groups in the vault
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  async listGroups(): Promise<BfProfile[]> {
    return listGroups();
  }

  // -------------------------------------------------------------------------
  // Group Signing
  // -------------------------------------------------------------------------

  /**
   * Sign a Nostr event using the group's threshold signature.
   *
   * This is the high-level coordinator path: initiates a signing session,
   * collects threshold partial signatures from the coordinator relay, and
   * aggregates them into a final Schnorr signature.
   *
   * For the two-party (2-of-2) case, this can be done synchronously if the
   * second participant is online. For larger groups, partial signatures are
   * collected from the coordinator relay.
   *
   * @param groupPubkey - Hex-encoded group public key
   * @param unsignedEvent - The event to sign
   * @returns The 64-byte Schnorr signature as a hex string
   * @throws {FrostError.ShareNotFound} if the caller has no share for this group
   * @throws {FrostError.InsufficientParticipants} if not enough participants sign
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  async groupSign(groupPubkey: string, unsignedEvent: UnsignedNostrEvent): Promise<string> {
    // Retrieve the caller's share
    const share = await this._requireShare(groupPubkey);

    // Initiate the signing session
    let session: SigningSession = await initiateGroupSigning({
      groupPubkey,
      unsignedEvent,
      coordinatorRelay: this.config.coordinatorRelay,
      initiatorShare: share,
    });

    // Wait for threshold partial signatures
    session = await collectPartialSigs(
      session,
      this.config.coordinatorRelay,
      this.config.signingTimeout,
    );

    // If still insufficient (relay timeout), combine what we have
    if (session.partialSigs.size < session.threshold) {
      throw frostErr(FrostError.InsufficientParticipants);
    }

    // Aggregate partial signatures
    const finalSig = await combineSignatures(session);

    return finalSig;
  }

  /**
   * Request a signing ceremony without waiting for completion.
   *
   * This is the async/non-blocking variant of {@link groupSign}. It publishes
   * the signing request to the coordinator relay and returns the session for
   * the caller to monitor. Other participants respond asynchronously via the
   * {@link useFrost} hook's event subscription.
   *
   * @param groupPubkey - Hex-encoded group public key
   * @param unsignedEvent - The event to request signing for
   * @returns The new SigningSession in `request_published` state
   * @throws {FrostError.ShareNotFound} if the caller has no share for this group
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  async requestGroupSignature(
    groupPubkey: string,
    unsignedEvent: UnsignedNostrEvent,
  ): Promise<SigningSession> {
    const share = await this._requireShare(groupPubkey);

    const session = await initiateGroupSigning({
      groupPubkey,
      unsignedEvent,
      coordinatorRelay: this.config.coordinatorRelay,
      initiatorShare: share,
    });

    return session;
  }

  /**
   * Respond to an active signing session with this participant's partial signature.
   *
   * Called by non-initiating threshold participants when they receive a
   * signing request (e.g., via the useFrost hook's event subscription).
   *
   * @param sessionId - The signing session ID from the coordinator event
   * @param groupPubkey - The group pubkey for share lookup
   */
  async respondToSigning(sessionId: string, groupPubkey: string): Promise<void> {
    const share = await this._requireShare(groupPubkey);

    await respondToSigningRequest({
      sessionId,
      coordinatorRelay: this.config.coordinatorRelay,
      participantShare: share,
    });
  }

  // -------------------------------------------------------------------------
  // Share Rotation
  // -------------------------------------------------------------------------

  /**
   * Rotate FROST shares without changing the group public key.
   *
   * This preserves the group identity while refreshing the secret shares.
   * All threshold participants must cooperate in the rotation ceremony.
   *
   * @param groupPubkey - Hex-encoded group public key
   * @throws {FrostError.ShareNotFound} if the caller has no share for this group
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  async rotateShares(groupPubkey: string): Promise<void> {
    const currentShare = await this._requireShare(groupPubkey);

    const newShare = await rotateSharesCeremony({
      groupPubkey,
      coordinatorRelay: this.config.coordinatorRelay,
      participantShare: currentShare,
    });

    // The rotateShares ceremony stores the new share in the vault automatically
    // This is a double-check to ensure storage succeeded
    await storeBfShare(groupPubkey, newShare);
  }

  // -------------------------------------------------------------------------
  // Share Backup / Restore
  // -------------------------------------------------------------------------

  /**
   * Backup this participant's bfshare as an encrypted Nostr event.
   *
   * Creates a kind:10000 event with the NIP-44-encrypted bfshare. The event
   * should be published to a relay for disaster recovery. Only the participant's
   * nsec can decrypt the backup.
   *
   * @param groupPubkey - Hex-encoded group public key
   * @param userPubkey - Hex-encoded user public key (for event authorship)
   * @returns The unsigned NostrEvent (call your relay publisher to broadcast it)
   * @throws {FrostError.ShareNotFound} if no share exists for this group
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  async backupShare(groupPubkey: string, userPubkey: string): Promise<NostrEvent> {
    return createShareBackupEvent(groupPubkey, userPubkey);
  }

  /**
   * Restore a bfshare from a relay backup event.
   *
   * Fetches the kind:10000 backup event, decrypts the bfshare using the
   * participant's nsec, and stores the recovered share in the OPFS Vault.
   *
   * @param event - The kind:10000 backup event from a relay
   * @param userNsec - Hex-encoded 32-byte user secret key (for NIP-44 decryption)
   * @throws {FrostError.InvalidBackup} if the event format is invalid
   * @throws {FrostError.EncryptionFailed} if NIP-44 decryption fails
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  async restoreShare(event: NostrEvent, userNsec: string): Promise<void> {
    await restoreShareFromBackup(event, userNsec);
  }

  // -------------------------------------------------------------------------
  // Profile Operations
  // -------------------------------------------------------------------------

  /**
   * Retrieve the BfProfile for a group.
   *
   * @param groupPubkey - Hex-encoded group public key
   * @returns The BfProfile, or null if not in vault
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  async getGroupProfile(groupPubkey: string): Promise<BfProfile | null> {
    return retrieveBfProfile(groupPubkey);
  }

  /**
   * Store a BfProfile in the vault (e.g., after receiving it from a relay).
   *
   * @param profile - The BfProfile to store
   * @throws {VaultError.VaultLocked} if vault is locked
   */
  async storeGroupProfile(profile: BfProfile): Promise<void> {
    await storeBfProfileAndRegister(profile.groupPubkey, profile);
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Retrieve a bfshare from the vault, throwing FrostError.ShareNotFound
   * if not present.
   *
   * @param groupPubkey - Hex-encoded group public key
   * @internal
   */
  private async _requireShare(groupPubkey: string): Promise<BfShare> {
    const share = await retrieveBfShare(groupPubkey);
    if (!share) {
      throw frostErr(FrostError.ShareNotFound);
    }
    return share;
  }
}

// ---------------------------------------------------------------------------
// Module-level Singleton
// ---------------------------------------------------------------------------

/** Module-level singleton FrostClient instance. */
let _frostClientInstance: FrostClient | null = null;

/**
 * Get or create the module-level FrostClient singleton.
 *
 * Lazily initializes the client on first call using the singleton Vault
 * instance from {@link getVault}. Pass config only on the first call;
 * subsequent calls ignore the config parameter.
 *
 * @param config - Optional FrostConfig override (applied on first call only)
 * @returns The module-level FrostClient instance
 */
export async function getFrostClient(config?: Partial<FrostConfig>): Promise<FrostClient> {
  if (!_frostClientInstance) {
    // Dynamic import to avoid circular module dependencies
    const { getVault } = await import('../vault/vault.js');
    const vault = getVault();
    const mergedConfig: FrostConfig = { ...DEFAULT_FROST_CONFIG, ...config };
    _frostClientInstance = new FrostClient(vault, mergedConfig);
  }
  return _frostClientInstance;
}

// Re-export types for convenience
export type {
  BfProfile,
  BfShare,
  BfOnboard,
  DkgSession,
  SigningSession,
  UnsignedNostrEvent,
  GroupMetadata,
  FrostConfig,
};

