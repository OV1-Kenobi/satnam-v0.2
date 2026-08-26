/**
 * @module frost/ceremony
 * @description FROST group creation, share distribution, and threshold
 * signing coordination for Satnam v2, backed END-TO-END by
 * @frostr/bifrost v2's real APIs (FB-1..FB-4 remediation, 2026-08-25).
 *
 * ## Trust model (explicit)
 *
 * @frostr/bifrost v2 key generation is a TRUSTED-DEALER model:
 * generate_dealer_package(threshold, n) produces the group package and ALL
 * n shares in one call inside the dealer's memory. This is inherent to the
 * installed library — there is no interactive DKG on this API surface. We
 * ACCEPT that model with hardened custody:
 *
 * - Only the Guardian runs the dealer, transiently. The output lives in
 *   function scope ONLY — the former module-scope cache holding every
 *   member's shares is DELETED.
 * - Every other member receives THEIR OWN encoded share credential via a
 *   NIP-44-encrypted gift-wrapped direct message (CEPS). Shares are never
 *   published to relays and never held server-side.
 * - Protocol/coordinator announcements are signed by participants' PERSONAL
 *   identity keys — never by secret shares.
 * - Residual trust: the dealer sees all shares at creation time and could
 *   retain them. Mitigation path (future, not built): bifrost re-share /
   DKG refresh ceremonies once the library exposes them.
 *
 * ## What was DELETED vs prior versions
 *
 * - The simulated signing core (zero-byte signatures, first-partial-sig
 *   "aggregation", fabricated nonce commitments, plain-schnorr "partial"
 *   signatures) — replaced by BifrostNode's real req.sign/handler machinery.
 * - The custom kind-20100 DKG round-1/round-2 scaffolding — bifrost's own
 *   relay protocol supersedes it; the dead publish/wait code never
 *   transmitted anything peers consumed. Coordinator ANNOUNCEMENT events
 *   (dkg_init / signing_request) remain as signed, best-effort UI records.
 * - joinDkg's synthetic-session fallback ("so tests pass").
 * - rotateShares' silent fake rotation (no reshare API exists in installed
 *   bifrost; the function now says so instead of lying).
 *
 * @see SPECIFICATION.md §4.3
 * @see node_modules/@frostr/bifrost/dist/class/client.d.ts — verified API
 */

import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';

import {
  type BfProfile,
  type BfShare,
  type DkgSession,
  type SigningSession,
  type UnsignedNostrEvent,
  type NostrEvent,
  type GroupMetadata,
  type FrostConfig,
  type DkgInitPayload,
  type SigningRequestPayload,
  type FrostCoordinatorPayload,
  DEFAULT_FROST_CONFIG,
  FrostError,
  frostErr,
} from './types.js';
import {
  storeBfProfileAndRegister,
  storeBfShare,
  generateSessionId,
  computeEventId,
} from './vault-storage.js';
import {
  encodeGroupPackage,
  encodeSharePackage,
  decodeGroupPackage,
  decodeSharePackage,
  createConnectedNode,
  closeNodeQuietly,
  requestThresholdSignature,
} from './node.js';
import type { BifrostNode } from '@frostr/bifrost';
// Re-exports for client.ts convenience (single import surface)
export { closeNodeQuietly, requestThresholdSignature, createConnectedNode } from './node.js';
import type { GroupPackage, SharePackage } from '@frostr/bifrost';

// ---------------------------------------------------------------------------
// Relay Communication Helpers (announcement channel only)
// ---------------------------------------------------------------------------

/** Maximum time (ms) to wait for a relay message before giving up. */
const RELAY_CONNECT_TIMEOUT = 10_000;

/**
 * Publish a FROST coordinator event to a relay (raw WebSocket, best-effort).
 * @internal
 */
async function publishToRelay(relayUrl: string, event: NostrEvent): Promise<boolean> {
  return new Promise((resolve) => {
    let ws: WebSocket;

    const timeout = setTimeout(() => {
      try { ws?.close(); } catch { /* ignore */ }
      resolve(false);
    }, RELAY_CONNECT_TIMEOUT);

    try {
      ws = new WebSocket(relayUrl);
    } catch {
      clearTimeout(timeout);
      resolve(false);
      return;
    }

    ws.onopen = () => {
      ws.send(JSON.stringify(['EVENT', event]));
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data as string) as unknown[];
        if (Array.isArray(data) && data[0] === 'OK' && data[1] === event.id) {
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      resolve(false);
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      resolve(false);
    };
  });
}

/**
 * Subscribe to FROST coordinator events on a relay and collect responses.
 * Used for dkg_init discovery during join; announcements only.
 * @internal
 */
export async function collectRelayMessages(
  relayUrl: string,
  filter: { kinds: number[]; '#d': string[] },
  expectedCount: number,
  timeoutMs: number,
): Promise<NostrEvent[]> {
  return new Promise((resolve) => {
    const events: NostrEvent[] = [];
    let ws: WebSocket;

    const done = () => {
      try { ws?.close(); } catch { /* ignore */ }
      resolve(events);
    };

    const timeout = setTimeout(done, timeoutMs);

    try {
      ws = new WebSocket(relayUrl);
    } catch {
      clearTimeout(timeout);
      resolve([]);
      return;
    }

    const subId = bytesToHex(new Uint8Array(8).map(() => Math.floor(Math.random() * 256)));

    ws.onopen = () => {
      ws.send(JSON.stringify(['REQ', subId, filter]));
    };

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data as string) as unknown[];
        if (!Array.isArray(data)) return;

        if (data[0] === 'EVENT' && data[1] === subId) {
          events.push(data[2] as NostrEvent);
          if (events.length >= expectedCount) {
            clearTimeout(timeout);
            done();
          }
        } else if (data[0] === 'EOSE') {
          if (events.length >= expectedCount) {
            clearTimeout(timeout);
            done();
          }
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = done;
    ws.onclose = done;
  });
}

// ---------------------------------------------------------------------------
// Event Construction Helpers
// ---------------------------------------------------------------------------

/**
 * Build and sign a FROST coordinator event with a PARTICIPANT'S PERSONAL
 * identity key (never a secret share — FB-2).
 * @internal
 */
function buildCoordinatorEvent(
  payload: FrostCoordinatorPayload,
  sessionId: string,
  signerNsec: string,
  kind = DEFAULT_FROST_CONFIG.signingRequestKind,
): NostrEvent {
  const nsecBytes = hexToBytes(signerNsec);
  const pubkeyBytes = secp256k1.getPublicKey(nsecBytes, true);
  const pubkey = bytesToHex(pubkeyBytes.slice(1));

  const created_at = Math.floor(Date.now() / 1000);
  const content = JSON.stringify(payload);
  const tags: string[][] = [
    ['d', sessionId],
    ['frost-type', payload.type],
  ];

  const id = computeEventId(pubkey, created_at, kind, tags, content);
  const eventIdBytes = hexToBytes(id);
  const sig = bytesToHex(schnorr.sign(eventIdBytes, nsecBytes));

  return { id, kind, pubkey, created_at, tags, content, sig };
}

/**
 * Parse a FROST coordinator payload from a Nostr event.
 * @internal
 */
function parseCoordinatorPayload(event: NostrEvent): FrostCoordinatorPayload | null {
  try {
    return JSON.parse(event.content) as FrostCoordinatorPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Group Creation — trusted-dealer with hardened custody (FB-2)
// ---------------------------------------------------------------------------

export interface ShareDistribution {
  /** Recipient's hex pubkey */
  recipientPubkey: string;
  /** 1-based share index assigned to this recipient */
  shareIndex: number;
  /** Encoded bfshare1… credential delivered via NIP-44 DM */
  encodedShare: string;
}

export interface TrustedDealerResult {
  profile: BfProfile;
  /** The GUARDIAN's own share (already persisted to vault by this call) */
  guardianShare: BfShare;
  /** Payloads to deliver to every OTHER participant via NIP-44 DM */
  distributions: Array<{ recipientPubkey: string; payload: ShareInvitationPayload }>;
  /** The transient dealer output — caller MUST drop references after delivery */
  _dealerTransient?: never;
}

/**
 * Payload delivered to each non-Guardian member via NIP-44 gift-wrapped DM.
 * Contains everything needed to construct a BifrostNode: the PUBLIC group
 * package plus THIS member's own encoded share.
 */
export interface ShareInvitationPayload {
  v: 2;
  /** Encoded bfgroup1… credential (public data) */
  groupPkg: string;
  /** Encoded bfshare1… credential — THIS recipient's share only */
  sharePkg: string;
  /** Assigned 1-based share index (redundant with sharePkg.idx; explicit for UX) */
  idx: number;
  /** Group public key (hex) */
  groupPubkey: string;
}

/**
 * Run the trusted-dealer group creation as the Guardian (transient custody).
 *
 * Generates the bifrost dealer package IN FUNCTION SCOPE, assigns shares to
 * participants BY POSITION (participants[0] = Guardian = share idx 1), maps
 * bifrost compressed member pubkeys onto the caller-supplied participant
 * pubkeys for the profile, persists the Guardian's profile+share to the
 * vault, and returns the per-member invitation payloads for NIP-44 delivery.
 *
 * NOTE on participant mapping: bifrost derives each member's pubkey FROM the
 * generated shares, so caller-provided participant pubkeys are recorded as
 * the human directory (BfProfile.participants, positional) while the
 * cryptographic member keys live inside the encoded group package. Delivery
 * targets are the caller-supplied pubkeys.
 *
 * @throws if threshold/participants are invalid
 */
export async function runTrustedDealerCreation(config: {
  threshold: number;
  participants: string[]; // hex pubkeys, [0] = Guardian/dealer
  metadata: GroupMetadata;
}): Promise<{ profile: BfProfile; guardianShare: BfShare; distributions: TrustedDealerResult['distributions'] }> {
  const { threshold, participants, metadata } = config;

  if (threshold < 2) {
    throw new Error('FROST threshold must be at least 2');
  }
  if (participants.length < threshold) {
    throw new Error('Total participants must be >= threshold');
  }

  // TRANSIENT dealer execution — function scope only, no module cache (FB-2).
  const lib = (await import('@frostr/bifrost/lib')) as unknown as {
    generate_dealer_package: (threshold: number, count: number) => {
      group: GroupPackage;
      shares: SharePackage[];
    };
  };
  const dealer = lib.generate_dealer_package(threshold, participants.length);

  if (dealer.shares.length !== participants.length) {
    throw frostErr(FrostError.AggregationFailed);
  }

  const encodedGroup = encodeGroupPackage(dealer.group);

  const now = Math.floor(Date.now() / 1000);
  const profile: BfProfile = {
    groupPubkey: dealer.group.group_pk,
    threshold,
    totalShares: participants.length,
    participants: [...participants],
    metadata: { ...metadata },
    createdAt: now,
    encodedGroupPkg: encodedGroup,
  };

  const [guardianShareRaw] = dealer.shares;
  if (!guardianShareRaw) throw frostErr(FrostError.AggregationFailed);

  const guardianShare: BfShare = {
    index: guardianShareRaw.idx,
    secretShare: guardianShareRaw.seckey,
    publicShare: bytesToHex(secp256k1.getPublicKey(hexToBytes(guardianShareRaw.seckey), true)),
    groupPubkey: dealer.group.group_pk,
    encodedShare: encodeSharePackage(guardianShareRaw),
  };

  await storeBfProfileAndRegister(profile.groupPubkey, profile);
  await storeBfShare(profile.groupPubkey, guardianShare);

  const distributions = participants.slice(1).map((recipientPubkey, i) => {
    const share = dealer.shares[i + 1];
    if (!share) throw frostErr(FrostError.AggregationFailed);
    return {
      recipientPubkey,
      payload: {
        v: 2 as const,
        groupPkg: encodedGroup,
        sharePkg: encodeSharePackage(share),
        idx: share.idx,
        groupPubkey: dealer.group.group_pk,
      } satisfies ShareInvitationPayload,
    };
  });

  return { profile, guardianShare, distributions };
}

/**
 * Deliver one share-invitation payload to a member via NIP-44-encrypted
 * gift-wrapped DM through CEPS (FB-2). Fire-and-forget friendly; returns
 * the CEPS event id or null on failure.
 */
export async function deliverShareInvitation(
  payload: ShareInvitationPayload,
  recipientPubkey: string,
): Promise<string | null> {
  try {
    const ceps = await import('../ceps/ceps-client.js');
    const wrapped = JSON.stringify({ type: 'satnam:frost:share_invite', ...payload });
    const eventId = await ceps.sendGiftwrappedMessageWithCeps(recipientPubkey, wrapped);
    return eventId ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Join flow — validated acceptance of an assigned share (FB-3)
// ---------------------------------------------------------------------------

/**
 * Accept a decrypted share invitation: validate the credentials against the
 * group package (index within range; derived pubkey matches the member
 * record), persist profile + own share to the vault, and return the profile.
 *
 * @param invitationJson - The decrypted ShareInvitationPayload (transport
 *   NIP-44 unwrapping happens at the messaging boundary before this call)
 * @throws FrostError.InvalidBackup on any validation failure
 */
export async function acceptShareInvitation(invitationJson: string): Promise<BfProfile> {
  let payload: ShareInvitationPayload;
  try {
    payload = JSON.parse(invitationJson) as ShareInvitationPayload;
  } catch {
    throw frostErr(FrostError.InvalidBackup);
  }

  if (payload.v !== 2 || !payload.groupPkg || !payload.sharePkg) {
    throw frostErr(FrostError.InvalidBackup);
  }

  const group = decodeGroupPackage(payload.groupPkg);
  const share = decodeSharePackage(payload.sharePkg);

  // Validation 1: index within range
  if (share.idx < 1 || share.idx > group.members.length) {
    throw frostErr(FrostError.InvalidBackup);
  }

  // Validation 2: the share's derived pubkey matches its member record
  const member = group.members[share.idx - 1];
  const derived = bytesToHex(secp256k1.getPublicKey(hexToBytes(share.seckey), true));
  if (!member || member.pubkey.toLowerCase() !== derived.toLowerCase()) {
    throw frostErr(FrostError.InvalidBackup);
  }

  // Validation 3: explicit idx agreement
  if (payload.idx !== share.idx) {
    throw frostErr(FrostError.InvalidBackup);
  }

  const bfShare: BfShare = {
    index: share.idx,
    secretShare: share.seckey,
    publicShare: derived,
    groupPubkey: group.group_pk,
    encodedShare: payload.sharePkg,
  };

  const profile: BfProfile = {
    groupPubkey: group.group_pk,
    threshold: group.threshold,
    totalShares: group.members.length,
    participants: [],
    metadata: { name: `FROST Group (${group.threshold}-of-${group.members.length})` },
    createdAt: Math.floor(Date.now() / 1000),
    encodedGroupPkg: payload.groupPkg,
  };

  await storeBfProfileAndRegister(profile.groupPubkey, profile);
  await storeBfShare(profile.groupPubkey, bfShare);

  return profile;
}

// ---------------------------------------------------------------------------
// DKG announcement sessions (UI/persistence state machines — FB-4 keeps these)
// ---------------------------------------------------------------------------

/**
 * Initiate a FROST group-creation ANNOUNCEMENT (Guardian only).
 *
 * Publishes a signed dkg_init event (kind 20100) to the coordinator relay as
 * a discoverable record for invitees' UIs. Cryptographic key material flows
 * exclusively through runTrustedDealerCreation + NIP-44 DMs — this event
 * carries none.
 */
export async function initiateDkg(config: {
  threshold: number;
  participants: string[];
  groupMetadata: GroupMetadata;
  coordinatorRelay: string;
  initiatorNsec: string;
}): Promise<DkgSession> {
  const { threshold, participants, groupMetadata, coordinatorRelay, initiatorNsec } = config;

  if (threshold < 2) {
    throw new Error('FROST threshold must be at least 2');
  }
  if (participants.length < threshold) {
    throw new Error('Total participants must be >= threshold');
  }

  const nsecBytes = hexToBytes(initiatorNsec);
  const pubkeyBytes = secp256k1.getPublicKey(nsecBytes, true);
  const initiatorPubkey = bytesToHex(pubkeyBytes.slice(1));

  const sessionId = generateSessionId();

  const session: DkgSession = {
    state: 'round1_initiated',
    groupId: sessionId,
    threshold,
    totalShares: participants.length,
    participants,
    round1Commitments: new Map(),
    round2Shares: new Map(),
    createdAt: Math.floor(Date.now() / 1000),
    coordinatorRelay,
  };

  const initPayload: DkgInitPayload = {
    type: 'dkg_init',
    sessionId,
    threshold,
    totalShares: participants.length,
    participants,
    metadata: groupMetadata,
    initiatorPubkey,
    timestamp: session.createdAt,
  };

  const initEvent = buildCoordinatorEvent(initPayload, sessionId, initiatorNsec);

  try {
    await publishToRelay(coordinatorRelay, initEvent);
  } catch {
    // Non-fatal: announcements are best-effort records
  }

  return session;
}

/**
 * Discover an announced ceremony by sessionId. Throws when the announcement
 * cannot be found — the previous synthetic-session fallback ("so tests pass")
 * is DELETED (FB-3): a join that cannot see the announcement is an error,
 * not an offline mode.
 */
export async function joinDkg(config: {
  sessionId: string;
  coordinatorRelay: string;
  participantNsec: string;
}): Promise<DkgSession> {
  const { sessionId, coordinatorRelay } = config;

  const events = await collectRelayMessages(
    coordinatorRelay,
    { kinds: [DEFAULT_FROST_CONFIG.signingRequestKind], '#d': [sessionId] },
    1,
    RELAY_CONNECT_TIMEOUT,
  );

  for (const event of events) {
    const payload = parseCoordinatorPayload(event);
    if (payload?.type === 'dkg_init') {
      return {
        state: 'round1_initiated',
        groupId: sessionId,
        threshold: payload.threshold,
        totalShares: payload.totalShares,
        participants: payload.participants,
        round1Commitments: new Map(),
        round2Shares: new Map(),
        createdAt: Math.floor(Date.now() / 1000),
        coordinatorRelay,
      };
    }
  }

  throw frostErr(FrostError.CeremonyTimeout);
}

// ---------------------------------------------------------------------------
// Threshold signing — real BifrostNode machinery (FB-1)
// ---------------------------------------------------------------------------

/**
 * Compute the sighash for a NIP-01 event (sha256 of the canonical
 * serialization) — the exact value BifrostNode signs and the value a
 * verifier checks the final signature against.
 */
export function computeEventSighash(unsignedEvent: UnsignedNostrEvent): string {
  const eventJson = JSON.stringify([
    0,
    unsignedEvent.pubkey,
    unsignedEvent.created_at,
    unsignedEvent.kind,
    unsignedEvent.tags,
    unsignedEvent.content,
  ]);
  return bytesToHex(sha256(utf8ToBytes(eventJson)));
}

/**
 * Open a connected BifrostNode from a stored profile + own share.
 * Requires the encoded credentials (present on all groups created through
 * the current flow; absent on legacy pre-FB entries, which cannot sign).
 */
export async function openGroupSigningNode(config: {
  profile: BfProfile;
  share: BfShare;
  relays?: string[];
  connectTimeoutMs?: number;
}): Promise<BifrostNode> {
  const { profile, share, relays, connectTimeoutMs } = config;
  if (!profile.encodedGroupPkg || !share.encodedShare) {
    // Legacy/pre-FB entry — honest failure, never a simulated signature.
    throw frostErr(FrostError.InvalidBackup);
  }
  const group = decodeGroupPackage(profile.encodedGroupPkg);
  const sharePkg = decodeSharePackage(share.encodedShare);
  return createConnectedNode({
    group,
    share: sharePkg,
    relays: relays ?? [DEFAULT_FROST_CONFIG.coordinatorRelay],
    connectTimeoutMs,
  });
}

/**
 * Initiate a FROST group signing session.
 *
 * Semantics PRESERVED (signature unchanged): returns a SigningSession for
 * monitoring. With the real machinery, the actual signature is produced by
 * BifrostNode once threshold peers co-sign — callers drive that through
 * {@link requestThresholdSignature} (see FrostClient.groupSign) or await the
 * background request opened by FrostClient.requestGroupSignature.
 *
 * The optional `coordinatorNsec`, WHEN PROVIDED, is the initiator's PERSONAL
 * identity key used to sign a best-effort signing_request announcement for
 * other participants' UIs. It is NEVER a secret share (FB-2).
 */
export async function initiateGroupSigning(config: {
  groupPubkey: string;
  unsignedEvent: UnsignedNostrEvent;
  coordinatorRelay: string;
  initiatorShare: BfShare;
  /** Optional: initiator's PERSONAL identity nsec for the announcement */
  coordinatorNsec?: string;
  /** Optional: threshold from the stored profile (defaults 2-of-n) */
  threshold?: number;
}): Promise<SigningSession> {
  const { groupPubkey, unsignedEvent, coordinatorRelay, initiatorShare } = config;

  const sessionId = generateSessionId();
  const sighash = computeEventSighash(unsignedEvent);

  const session: SigningSession = {
    state: 'request_published',
    sessionId,
    groupPubkey,
    unsignedEvent,
    partialSigs: new Map(),
    threshold: config.threshold ?? 2,
    createdAt: Math.floor(Date.now() / 1000),
  };

  if (config.coordinatorNsec && /^[0-9a-fA-F]{64}$/.test(config.coordinatorNsec)) {
    const requestPayload: SigningRequestPayload = {
      type: 'signing_request',
      sessionId,
      groupPubkey,
      unsignedEvent: JSON.stringify(unsignedEvent),
      // Sighash reference for observers — bifrost handles nonce exchange
      // internally over its own encrypted channel.
      nonceCommitments: sighash,
      timestamp: session.createdAt,
    };

    const requestEvent = buildCoordinatorEvent(requestPayload, sessionId, config.coordinatorNsec);
    try {
      await publishToRelay(coordinatorRelay, requestEvent);
    } catch {
      // Non-fatal: announcement only
    }
  }

  void initiatorShare; // signature compatibility; node construction is caller-driven

  return session;
}

// ---------------------------------------------------------------------------
// Responder node registry (fire-and-monitor co-signing)
// ---------------------------------------------------------------------------

interface ResponderHandle {
  node: BifrostNode;
  closeAt: number;
}

const responderNodes = new Map<string, ResponderHandle>();

function sweepResponders(now: number): void {
  for (const [key, h] of responderNodes) {
    if (h.closeAt <= now) {
      responderNodes.delete(key);
      void closeNodeQuietly(h.node);
    }
  }
}

/**
 * Ensure this participant has a CONNECTED responder node for a group so the
 * BifrostNode handler can co-sign inbound peer requests automatically.
 * Nodes idle-close after signingTimeout. Returns true when a node is (or
 * was just made) available.
 */
export async function ensureResponderOnline(config: {
  profile: BfProfile;
  share: BfShare;
  relays?: string[];
  onlineForMs?: number;
}): Promise<boolean> {
  sweepResponders(Date.now());
  const key = config.profile.groupPubkey;
  const existing = responderNodes.get(key);
  if (existing) {
    existing.closeAt = Date.now() + (config.onlineForMs ?? DEFAULT_FROST_CONFIG.signingTimeout);
    return true;
  }
  try {
    const node = await openGroupSigningNode({
      profile: config.profile,
      share: config.share,
      relays: config.relays,
    });
    responderNodes.set(key, {
      node,
      closeAt: Date.now() + (config.onlineForMs ?? DEFAULT_FROST_CONFIG.signingTimeout),
    });
    return true;
  } catch {
    return false;
  }
}

/** Test/teardown seam: close all responder nodes immediately. */
export async function closeAllResponders(): Promise<void> {
  for (const [, h] of responderNodes) {
    await closeNodeQuietly(h.node);
  }
  responderNodes.clear();
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export {
  DEFAULT_FROST_CONFIG,
  FrostError,
  frostErr,
};

export type {
  BfProfile,
  BfShare,
  DkgSession,
  SigningSession,
  UnsignedNostrEvent,
  NostrEvent,
  GroupMetadata,
  FrostConfig,
};
