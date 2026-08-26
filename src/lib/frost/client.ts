/**
 * @module frost/client
 * @description High-level FrostClient class providing a unified interface for
 * all FROST threshold signing operations in Satnam v2.
 *
 * Wave FB remediation (2026-08-25): every method is now an honest wrapper
 * over @frostr/bifrost v2's real machinery:
 * - createGroup: trusted-dealer generation (Guardian, transient custody) +
 *   NIP-44 gift-wrapped delivery of each member's OWN share credential.
 * - joinGroup: validated acceptance of an assigned encoded share.
 * - groupSign / requestGroupSignature / respondToSigning: real BifrostNode
 *   req.sign + automatic inbound co-sign handling. Output is the genuine
 *   aggregated FROST signature and verifies under the GROUP pubkey.
 * - rotateShares: honestly reports that resharing is not available in the
 *   installed bifrost API (the previous silent fake rotation is deleted).
 *
 * Public method signatures are UNCHANGED from prior releases so useFrost /
 * HomePage consumers are unaffected.
 *
 * ## Security Notes
 *
 * - All secret material is retrieved from and stored to the OPFS Vault.
 * - The Vault must be unlocked before any operation.
 * - Coordinator announcements are signed by the user's PERSONAL identity
 *   key (retrieved transiently from the vault and zeroed) — never by a
 *   secret share.
 *
 * @see SPECIFICATION.md §4.3
 */

import type { Vault } from '../vault/vault.js';
import { bytesToHex } from '@noble/hashes/utils';
import {
  type BfProfile,
  type BfShare,
  type BfOnboard,
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
  retrieveBfProfile,
  retrieveBfShare,
  listGroups,
  createShareBackupEvent,
  restoreShareFromBackup,
} from './vault-storage.js';
import {
  runTrustedDealerCreation,
  deliverShareInvitation,
  acceptShareInvitation,
  initiateDkg,
  initiateGroupSigning,
  computeEventSighash,
  openGroupSigningNode,
  closeNodeQuietly,
  ensureResponderOnline,
  requestThresholdSignature,
} from './ceremony.js';

// ---------------------------------------------------------------------------
// Background signature-request registry (fire-and-monitor support)
// ---------------------------------------------------------------------------

interface PendingGroupSignature {
  promise: Promise<{ signature: string; groupPubkey: string }>;
  node: import('@frostr/bifrost').BifrostNode;
}

const pendingSignatures = new Map<string, PendingGroupSignature>();

// ---------------------------------------------------------------------------
// FrostClient
// ---------------------------------------------------------------------------

export class FrostClient {
  constructor(
    private readonly vault: Vault,
    private readonly config: FrostConfig = DEFAULT_FROST_CONFIG,
  ) {}

  // -------------------------------------------------------------------------
  // Group Creation (Guardian only) — trusted dealer + NIP-44 delivery (FB-2)
  // -------------------------------------------------------------------------

  /**
   * Create a new FROST group as Guardian.
   *
   * Runs generate_dealer_package TRANSIENTLY (function scope), persists the
   * Guardian's own profile+share, publishes a best-effort dkg_init
   * announcement, and delivers every other participant their OWN encoded
   * share credential via NIP-44 gift-wrapped DMs through CEPS.
   *
   * Trust model: the Guardian sees all shares at creation instant — inherent
   * to @frostr/bifrost v2's dealer model (documented; future re-share may
   * mitigate).
   *
   * @returns The BfProfile for the newly created group
   */
  async createGroup(params: {
    name: string;
    description?: string;
    threshold: number;
    participants: string[]; // hex pubkeys, [0] = Guardian
    guardianNsec: string;
  }): Promise<BfProfile> {
    const { name, description, threshold, participants, guardianNsec } = params;

    const metadata: GroupMetadata = { name, description };

    // Best-effort announcement for invitees' UIs (carries no key material)
    try {
      await initiateDkg({
        threshold,
        participants,
        groupMetadata: metadata,
        coordinatorRelay: this.config.coordinatorRelay,
        initiatorNsec: guardianNsec,
      });
    } catch {
      // announcements are non-fatal records
    }

    const { profile, distributions } = await runTrustedDealerCreation({
      threshold,
      participants,
      metadata,
    });

    // Deliver each member's own encoded share via NIP-44 DM (FB-2)
    const deliveries = await Promise.allSettled(
      distributions.map((d) => deliverShareInvitation(d.payload, d.recipientPubkey)),
    );
    const failed = deliveries.filter((r) => r.status === 'rejected' || r.value === null).length;
    if (failed > 0) {
      console.error(
        `[FrostClient] ${failed}/${deliveries.length} share invitations failed delivery — ` +
        'those members cannot sign until re-invited.',
      );
    }

    return profile;
  }

  // -------------------------------------------------------------------------
  // Group Joining — validated acceptance of an assigned share (FB-3)
  // -------------------------------------------------------------------------

  /**
   * Join an existing FROST group by accepting an assigned share invitation.
   *
   * `invitation.encryptedPayload` carries the DECRYPTED ShareInvitationPayload
   * JSON ({v:2, groupPkg, sharePkg, idx, groupPubkey}); transport-level NIP-44
   * unwrapping happens at the messaging boundary that produced this object.
   * The payload is fully validated (index range, derived-pubkey match, idx
   * agreement) before anything touches the vault.
   *
   * The former self-minting path ("joins" by creating its OWN new group) and
   * the synthetic-session fallback are DELETED (FB-3).
   *
   * @param invitation - Onboarding record carrying the decrypted payload
   * @param _participantNsec - Retained for API compatibility (unused: the
   *        invitation payload is already unwrapped and validated)
   */
  async joinGroup(invitation: BfOnboard, _participantNsec?: string): Promise<BfProfile> {
    if (!invitation?.encryptedPayload) {
      throw frostErr(FrostError.InvalidBackup);
    }
    return acceptShareInvitation(invitation.encryptedPayload);
  }

  // -------------------------------------------------------------------------
  // Group Listing
  // -------------------------------------------------------------------------

  async listGroups(): Promise<BfProfile[]> {
    return listGroups();
  }

  // -------------------------------------------------------------------------
  // Group Signing — real BifrostNode machinery (FB-1)
  // -------------------------------------------------------------------------

  /**
   * Sign a Nostr event with the group's threshold key.
   *
   * Opens a connected BifrostNode from (stored profile, own share), issues a
   * real req.sign for the event's sighash, verifies the returned aggregated
   * signature attributes to THIS group, and returns the 64-byte hex
   * signature ready to embed in the NIP-01 event.
   *
   * Requires threshold-1 peers online on the coordinator relays.
   */
  async groupSign(groupPubkey: string, unsignedEvent: UnsignedNostrEvent): Promise<string> {
    const { node, expectedPubkey } = await this._openSigningNode(groupPubkey);
    try {
      const sighash = computeEventSighash(unsignedEvent);
      const result = await requestThresholdSignature(node, sighash);
      if (result.groupPubkey.toLowerCase() !== expectedPubkey.toLowerCase()) {
        throw frostErr(FrostError.AggregationFailed);
      }
      return result.signature;
    } finally {
      await closeNodeQuietly(node);
    }
  }

  /**
   * Request a signing ceremony without blocking on completion.
   *
   * Fires the real threshold request in the background and returns the
   * session immediately; the settled signature can be awaited via
   * {@link awaitGroupSignature}. The background node closes itself once the
   * request settles.
   */
  async requestGroupSignature(
    groupPubkey: string,
    unsignedEvent: UnsignedNostrEvent,
  ): Promise<SigningSession> {
    const share = await this._requireShare(groupPubkey);
    const profile = await this._requireProfile(groupPubkey);

    // Best-effort announcement signed by the caller's PERSONAL identity key
    let coordinatorNsec: string | undefined;
    try {
      const identities = await this.vault.listIdentities();
      if (identities.length > 0) {
        const nsec = await this.vault.getNsec(identities[0]!);
        coordinatorNsec = bytesToHex(nsec);
        nsec.fill(0);
      }
    } catch { /* announcements optional */ }

    const session = await initiateGroupSigning({
      groupPubkey,
      unsignedEvent,
      coordinatorRelay: this.config.coordinatorRelay,
      initiatorShare: share,
      coordinatorNsec,
      threshold: profile.threshold,
    });

    // Fire the real request in the BACKGROUND: connectivity/peer failures
    // surface through awaitGroupSignature, not as a thrown session-open —
    // fire-and-monitor semantics must not require peers to be online yet.
    void this._openSigningNode(groupPubkey)
      .then(({ node }) => {
        const sighash = computeEventSighash(unsignedEvent);
        const promise = requestThresholdSignature(node, sighash)
          .finally(() => {
            pendingSignatures.delete(session.sessionId);
            void closeNodeQuietly(node);
          });
        pendingSignatures.set(session.sessionId, { promise, node });
      })
      .catch((err) => {
        // Register the failure so awaitGroupSignature rejects deterministically
        const failed = Promise.reject(err instanceof Error ? err : new Error(String(err)));
        failed.catch(() => {}); // avoid unhandled-rejection noise until awaited
        pendingSignatures.set(session.sessionId, {
          promise: failed as Promise<{ signature: string; groupPubkey: string }>,
          node: null as never,
        });
      });

    return session;
  }

  /**
   * Await the settled result of a background signature request opened by
   * {@link requestGroupSignature}. Additive API (does not alter existing
   * consumers).
   */
  async awaitGroupSignature(sessionId: string): Promise<string> {
    const pending = pendingSignatures.get(sessionId);
    if (!pending) {
      throw frostErr(FrostError.CeremonyTimeout);
    }
    const { signature, groupPubkey } = await pending.promise;
    void groupPubkey;
    return signature;
  }

  /**
   * Bring this participant's responder node online so inbound peer signing
   * requests are co-signed automatically by BifrostNode's handler.
   *
   * Called by non-initiating participants (e.g. from useFrost's subscription)
   * when a signing_request announcement is observed. The node idle-closes
   * after the configured signing timeout.
   */
  async respondToSigning(_sessionId: string, groupPubkey: string): Promise<void> {
    const share = await this._requireShare(groupPubkey);
    const profile = await this._requireProfile(groupPubkey);

    const online = await ensureResponderOnline({
      profile,
      share,
      relays: [this.config.coordinatorRelay],
      onlineForMs: this.config.signingTimeout,
    });
    if (!online) {
      throw frostErr(FrostError.RelayConnectionFailed);
    }
  }

  // -------------------------------------------------------------------------
  // Share Rotation — honest unavailability (FB-1: no fake crypto)
  // -------------------------------------------------------------------------

  /**
   * NOT SUPPORTED by the installed @frostr/bifrost v2 API surface: there is
   * no re-sharing/rotation primitive, and fabricating one would corrupt the
   * group's cryptographic state. The previous silent fake rotation is
   * DELETED. Re-provision the group via createGroup/joinGroup instead.
   */
  async rotateShares(_groupPubkey: string): Promise<never> {
    throw new Error(
      'FROST share rotation requires a re-sharing protocol that @frostr/bifrost v2 ' +
      'does not expose. Re-provision the group (createGroup + joinGroup) instead.',
    );
  }

  // -------------------------------------------------------------------------
  // Share Backup / Restore (kind:10000 NIP-44, v2 payload)
  // -------------------------------------------------------------------------

  async backupShare(groupPubkey: string): Promise<NostrEvent> {
    const identities = await this.vault.listIdentities();
    if (identities.length === 0) {
      throw new Error('[FrostClient] No identities in vault — unlock vault before backup');
    }
    const userNsec = await this.vault.getNsec(identities[0]!);
    try {
      return await createShareBackupEvent(groupPubkey, userNsec);
    } finally {
      userNsec.fill(0);
    }
  }

  async restoreShare(event: NostrEvent): Promise<void> {
    const identities = await this.vault.listIdentities();
    if (identities.length === 0) {
      throw new Error('[FrostClient] No identities in vault — unlock vault before restore');
    }
    const userNsec = await this.vault.getNsec(identities[0]!);
    try {
      await restoreShareFromBackup(event, userNsec);
    } finally {
      userNsec.fill(0);
    }
  }

  // -------------------------------------------------------------------------
  // Profile Operations
  // -------------------------------------------------------------------------

  async getGroupProfile(groupPubkey: string): Promise<BfProfile | null> {
    return retrieveBfProfile(groupPubkey);
  }

  async storeGroupProfile(profile: BfProfile): Promise<void> {
    await storeBfProfileAndRegister(profile.groupPubkey, profile);
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private async _requireShare(groupPubkey: string): Promise<BfShare> {
    const share = await retrieveBfShare(groupPubkey);
    if (!share) {
      throw frostErr(FrostError.ShareNotFound);
    }
    return share;
  }

  private async _requireProfile(groupPubkey: string): Promise<BfProfile> {
    const profile = await retrieveBfProfile(groupPubkey);
    if (!profile) {
      throw frostErr(FrostError.ProfileNotFound);
    }
    return profile;
  }

  /** Open a connected signing node, normalizing the expected group pubkey. */
  private async _openSigningNode(groupPubkey: string): Promise<{
    node: import('@frostr/bifrost').BifrostNode;
    expectedPubkey: string;
  }> {
    const share = await this._requireShare(groupPubkey);
    const profile = await this._requireProfile(groupPubkey);

    const node = await openGroupSigningNode({
      profile,
      share,
      relays: [this.config.coordinatorRelay],
    });
    return { node, expectedPubkey: normalizeXOnly(groupPubkey) };
  }
}

/** Normalize a group pubkey to x-only (strip EC compression prefix). */
function normalizeXOnly(pubkeyHex: string): string {
  const lower = pubkeyHex.toLowerCase();
  return lower.startsWith('02') || lower.startsWith('03') ? lower.slice(2) : lower;
}

// ---------------------------------------------------------------------------
// Module-level Singleton
// ---------------------------------------------------------------------------

let _frostClientInstance: FrostClient | null = null;

/**
 * Get or create the module-level FrostClient singleton.
 */
export async function getFrostClient(config?: Partial<FrostConfig>): Promise<FrostClient> {
  if (!_frostClientInstance) {
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
  SigningSession,
  UnsignedNostrEvent,
  GroupMetadata,
  FrostConfig,
};
