/**
 * @module messaging/protocol-bridge
 * @description Protocol detection and negotiation bridge for NIP-17 ↔ MLS.
 *
 * Phase 1 (current): NIP-17 gift-wrap only. All messages use kind:1059.
 * Phase 2 (when Marmot/MLS stabilises): detect kind:443 KeyPackages, upgrade
 * to MLS for peers that support it, fall back to NIP-17 for others.
 *
 * Key responsibilities:
 * - detectPeerProtocol: query relays for kind:443 → peer supports MLS
 * - negotiateProtocol: choose the best shared protocol for a conversation
 * - publishKeyPackage: publish our own kind:443 stub so White Noise / MLS
 *   clients can invite Satnam users (forward compat)
 * - wrapMessage: wrap content in the negotiated protocol format
 * - unwrapMessage: detect protocol from incoming event, unwrap accordingly
 * - getProtocolStatus: current capability report
 *
 * No new production dependencies. Uses existing CEPS + mls-types stubs.
 */

import type {
  MessagingProtocol,
  ProtocolNegotiationResult,
  ProtocolStatus,
} from './types.js';

import type {
  KeyPackage,
  KeyPackageEvent,
  MlsCiphersuite,
} from './mls-types.js';

import {
  KIND_MLS_KEY_PACKAGE,
  MARMOT_PROTOCOL_VERSION,
  isKeyPackageEvent,
  extractCiphersuite,
  extractClientName,
} from './mls-types.js';

import {
  listEventsWithCeps,
  publishEventWithCeps,
  signEventWithCeps,
  sendGiftwrappedMessageWithCeps,
  getDefaultRelays,
} from '../ceps/ceps-client.js';

// ============================================================================
// Constants
// ============================================================================

const KIND_GIFT_WRAP = 1059;
const PROTOCOL_STATUS_KEY = 'satnam:protocol:status:v2';

// ============================================================================
// Helpers
// ============================================================================

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// ============================================================================
// ProtocolBridge
// ============================================================================

export class ProtocolBridge {
  /**
   * @param localPubkeyHex - hex pubkey of the local user
   * @param relays         - relay URLs to query for peer key packages
   */
  constructor(
    private readonly localPubkeyHex: string,
    private readonly relays: string[] = getDefaultRelays(),
  ) {}

  // --------------------------------------------------------------------------
  // detectPeerProtocol
  // --------------------------------------------------------------------------

  /**
   * Detect whether a peer supports MLS by querying relays for their
   * kind:443 KeyPackage events.
   *
   * Phase 1: always returns 'nip17' (MLS detection is a stub).
   * Phase 2: real relay query + KeyPackage parsing.
   *
   * @param peerPubkeyHex - hex pubkey of the peer to detect
   * @returns 'mls' if the peer has published a valid kind:443, else 'nip17'
   */
  async detectPeerProtocol(peerPubkeyHex: string): Promise<MessagingProtocol> {
    try {
      const events = await listEventsWithCeps(
        [
          {
            kinds: [KIND_MLS_KEY_PACKAGE],
            authors: [peerPubkeyHex],
            limit: 1,
          } as any,
        ],
        this.relays,
        { eoseTimeout: 3000 },
      );

      if (events && events.length > 0) {
        const event = events[0] as any;
        // Verify it's actually a valid key package event with MLS protocol tag
        if (isKeyPackageEvent(event)) {
          const protocolTag = (event.tags as string[][]).find(
            (t) => t[0] === 'protocol',
          );
          if (protocolTag?.[1] === MARMOT_PROTOCOL_VERSION) {
            return 'mls';
          }
        }
      }
    } catch (err) {
      console.warn('[ProtocolBridge] Failed to detect peer protocol:', err);
    }

    // Phase 1: NIP-17 is the default / fallback
    return 'nip17';
  }

  // --------------------------------------------------------------------------
  // negotiateProtocol
  // --------------------------------------------------------------------------

  /**
   * Determine the best protocol to use for a conversation with a peer.
   *
   * Logic:
   * 1. If peer supports MLS and we have a published KeyPackage → use MLS
   * 2. Otherwise → use NIP-17
   *
   * Phase 1: always returns NIP-17 (no MLS implementation yet).
   *
   * @param peerPubkeyHex - hex pubkey of the peer
   * @returns ProtocolNegotiationResult
   */
  async negotiateProtocol(
    peerPubkeyHex: string,
  ): Promise<ProtocolNegotiationResult> {
    const peerProtocol = await this.detectPeerProtocol(peerPubkeyHex);
    const status = this.getProtocolStatus();

    // Phase 2 readiness check: both parties must have MLS key packages
    if (
      peerProtocol === 'mls' &&
      status.hasPublishedKeyPackage &&
      status.localProtocol === 'mls'
    ) {
      return {
        protocol: 'mls',
        isFallback: false,
        mlsKeyPackageEventId: status.keyPackageEventId,
        reason: 'Both parties support MLS; using MLS encryption',
      };
    }

    // Phase 1 / fallback: NIP-17
    return {
      protocol: 'nip17',
      isFallback: peerProtocol === 'mls',
      reason:
        peerProtocol === 'mls'
          ? 'Peer supports MLS but Satnam MLS is not yet active; using NIP-17 fallback'
          : 'Peer does not support MLS; using NIP-17',
    };
  }

  // --------------------------------------------------------------------------
  // publishKeyPackage
  // --------------------------------------------------------------------------

  /**
   * Publish a kind:443 MLS KeyPackage stub to enable forward compatibility
   * with White Noise and other MLS-capable clients.
   *
   * Phase 1: publishes a placeholder KeyPackage containing the local pubkey.
   * Phase 2: publishes a real MLS KeyPackage TLV from marmot-ts.
   *
   * White Noise users querying for kind:443 events by pubkey will find Satnam
   * users and be able to initiate MLS group invites (which Satnam will handle
   * once MLS support is implemented).
   *
   * @param ciphersuite - MLS ciphersuite to advertise (default: 1 = X25519/AES-128)
   * @returns The published KeyPackage record
   */
  async publishKeyPackage(
    ciphersuite: MlsCiphersuite = 0x0001,
  ): Promise<KeyPackage> {
    const now = nowUnix();

    // Phase 1: stub KeyPackage — placeholder base64 content.
    // Phase 2: replace with real marmot-ts KeyPackage TLV generation.
    const stubKeyPackageTlv = btoa(
      JSON.stringify({
        _note: 'Satnam v2 Phase-1 KeyPackage stub — not a real MLS KeyPackage',
        pubkey: this.localPubkeyHex,
        ciphersuite,
        issuedAt: now,
      }),
    );

    const event = {
      kind: KIND_MLS_KEY_PACKAGE,
      content: stubKeyPackageTlv,
      tags: [
        ['protocol', MARMOT_PROTOCOL_VERSION],
        ['cipher_suite', String(ciphersuite)],
        ['client', 'satnam-v2'],
        // Expiry: 30 days from now (standard KeyPackage lifetime)
        ['expiration', String(now + 30 * 24 * 60 * 60)],
      ],
      created_at: now,
    };

    let eventId = '';
    try {
      const signed = await signEventWithCeps(event);
      eventId = await publishEventWithCeps(signed, this.relays);
    } catch (err) {
      console.warn('[ProtocolBridge] Failed to publish KeyPackage:', err);
    }

    const keyPackage: KeyPackage = {
      eventId,
      authorPubkey: this.localPubkeyHex,
      keyPackageTlv: stubKeyPackageTlv,
      ciphersuite,
      protocol: MARMOT_PROTOCOL_VERSION,
      client: 'satnam-v2',
      notBefore: now,
      notAfter: now + 30 * 24 * 60 * 60,
    };

    // Persist status locally
    const statusUpdate: ProtocolStatus = {
      localProtocol: 'nip17', // still NIP-17 until MLS impl is active
      hasPublishedKeyPackage: true,
      keyPackageEventId: eventId,
      supportedProtocols: ['nip17'],
    };
    writeJson(PROTOCOL_STATUS_KEY, statusUpdate);

    return keyPackage;
  }

  // --------------------------------------------------------------------------
  // wrapMessage
  // --------------------------------------------------------------------------

  /**
   * Wrap a plaintext message in the appropriate protocol format.
   *
   * Phase 1: always NIP-17 gift-wrap (kind:1059) via CEPS.
   * Phase 2: MLS ApplicationMessage if protocol === 'mls'.
   *
   * @param content          - Plaintext message content
   * @param recipientPubkey  - hex pubkey of the recipient
   * @param protocol         - Protocol to use (defaults to 'nip17')
   * @returns Event id of the published wrapper
   */
  async wrapMessage(
    content: string,
    recipientPubkey: string,
    protocol: MessagingProtocol = 'nip17',
  ): Promise<string> {
    if (protocol === 'mls') {
      // Phase 2: MLS ApplicationMessage wrapping (stub)
      console.warn(
        '[ProtocolBridge] MLS wrapping not yet implemented; falling back to NIP-17',
      );
    }

    // NIP-17 gift-wrap via CEPS
    return sendGiftwrappedMessageWithCeps(recipientPubkey, content);
  }

  // --------------------------------------------------------------------------
  // unwrapMessage
  // --------------------------------------------------------------------------

  /**
   * Detect the protocol of an incoming event and unwrap the message.
   *
   * Phase 1: handles kind:1059 (NIP-17 gift-wrap).
   * Phase 2: also handles MLS GroupEvents (kind TBD by Marmot).
   *
   * @param event - Raw Nostr event (any kind)
   * @returns Unwrapped content or null if the event is not a supported message
   */
  async unwrapMessage(event: {
    kind: number;
    content: string;
    tags: string[][];
    [key: string]: unknown;
  }): Promise<{ protocol: MessagingProtocol; content: string } | null> {
    if (event.kind === KIND_GIFT_WRAP) {
      // NIP-17: CEPS handles decryption in the subscription layer.
      // At this point content is already decrypted by the caller.
      return { protocol: 'nip17', content: event.content };
    }

    if (event.kind === KIND_MLS_KEY_PACKAGE) {
      // This is a KeyPackage — not a message. Ignore.
      return null;
    }

    // Phase 2: handle MLS GroupEvents here.
    // Detect by kind (TBD by Marmot), then decrypt via marmot-ts.

    return null;
  }

  // --------------------------------------------------------------------------
  // getProtocolStatus
  // --------------------------------------------------------------------------

  /**
   * Return the current protocol capability report.
   */
  getProtocolStatus(): ProtocolStatus {
    const stored = readJson<ProtocolStatus | null>(PROTOCOL_STATUS_KEY, null);
    if (stored) return stored;

    return {
      localProtocol: 'nip17',
      hasPublishedKeyPackage: false,
      supportedProtocols: ['nip17'],
    };
  }

  // --------------------------------------------------------------------------
  // getPeerKeyPackage
  // --------------------------------------------------------------------------

  /**
   * Fetch the most recent kind:443 KeyPackage event for a peer.
   *
   * Returns undefined if the peer has not published a KeyPackage.
   *
   * @param peerPubkeyHex - hex pubkey of the peer
   */
  async getPeerKeyPackage(
    peerPubkeyHex: string,
  ): Promise<KeyPackage | undefined> {
    try {
      const events = await listEventsWithCeps(
        [
          {
            kinds: [KIND_MLS_KEY_PACKAGE],
            authors: [peerPubkeyHex],
            limit: 1,
          } as any,
        ],
        this.relays,
        { eoseTimeout: 3000 },
      );

      if (!events || events.length === 0) return undefined;

      const event = events[0] as KeyPackageEvent & { id: string; pubkey: string };
      const tags = event.tags as string[][];
      const ciphersuite = extractCiphersuite(tags);
      const client = extractClientName(tags) ?? 'unknown';
      const expirationTag = tags.find((t) => t[0] === 'expiration');
      const notAfter = expirationTag ? parseInt(expirationTag[1], 10) : 0;

      return {
        eventId: event.id,
        authorPubkey: event.pubkey,
        keyPackageTlv: event.content,
        ciphersuite: ciphersuite ?? 0x0001,
        protocol: MARMOT_PROTOCOL_VERSION,
        client,
        notBefore: event.created_at,
        notAfter,
      };
    } catch (err) {
      console.warn('[ProtocolBridge] Failed to fetch peer KeyPackage:', err);
      return undefined;
    }
  }

  // --------------------------------------------------------------------------
  // isBackwardCompatible
  // --------------------------------------------------------------------------

  /**
   * Check if a received event from a peer using MLS should be responded to
   * using the same protocol the message arrived in.
   *
   * Per spec: always accept NIP-17 gift-wrapped messages. If a message arrives
   * via NIP-17 from a peer that also has MLS keys, respond in NIP-17.
   *
   * @param incomingProtocol - Protocol used by the incoming message
   * @returns The protocol to use for the reply
   */
  getReplyProtocol(incomingProtocol: MessagingProtocol): MessagingProtocol {
    // Respond in the same protocol the message arrived in
    // Phase 1: NIP-17 for everything
    return incomingProtocol === 'mls' ? 'nip17' : incomingProtocol;
  }
}
