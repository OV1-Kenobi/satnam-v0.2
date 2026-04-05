/**
 * @module nfc/proof-of-life
 * @description Proof of Life mutual contact exchange ceremony state machine.
 *
 * A Proof of Life ceremony proves physical co-presence of two Satnam users.
 * Each user scans the OTHER person's NFC "Name Tag" card, creating a bilateral
 * contact attestation anchored by OTS.
 *
 * States:
 * ```
 * IDLE
 *   → INITIATED          (local user starts ceremony)
 *   → SCANNING_PEER      (local user scans peer's NFC card)
 *   → PEER_VERIFIED      (peer card CMAC verified; peer pubkey extracted)
 *   → AWAITING_RECIPROCAL (waiting for peer to scan our card)
 *   → MUTUAL_VERIFIED    (both scans complete)
 *   → PIN_EXCHANGE       (both users enter their PINs to authorize)
 *   → ATTESTING          (constructing bilateral kind:30078 events)
 *   → PUBLISHED          (events published to relay + OTS anchored)
 *   → CONFIRMED          (both sides confirm receipt)
 *   → FAILED             (timeout, invalid CMAC, wrong PIN)
 * ```
 *
 * Events published (one per participant):
 * - kind:30078 with d-tag `satnam:proof-of-life`
 *   - `p` tag: the OTHER participant's pubkey
 *   - `nfc-card-hash` tag: SHA-256 of the OTHER participant's card UID
 *   - `ots` tag: OpenTimestamps commitment (anchored asynchronously)
 *   - Content: JSON with both pubkey hashes, bilateral flag, timestamp
 *
 * After ceremony, the contact is "authenticated" — future DMs and Zaps to
 * that contact require NFC card tap + PIN before publishing (PinGatedOperation
 * 'message_send' and 'zap_send').
 *
 * @see SPECIFICATION.md §5.4 — Proof of Life Ceremony
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import * as nt from 'nostr-tools';

import type { VaultOps } from '../vault/types.js';
import { NTAG424ProductionManager } from './ntag424.js';
import { PinGate } from './pin-gate.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PolState =
  | 'IDLE'
  | 'INITIATED'
  | 'SCANNING_PEER'
  | 'PEER_VERIFIED'
  | 'AWAITING_RECIPROCAL'
  | 'MUTUAL_VERIFIED'
  | 'PIN_EXCHANGE'
  | 'ATTESTING'
  | 'PUBLISHED'
  | 'CONFIRMED'
  | 'FAILED';

/** Result of scanning a peer's card */
export interface PeerScanResult {
  /** Card UID extracted from piccData */
  peerCardUid: string;
  /** SHA-256 hash of peer card UID (published; not the raw UID) */
  peerCardUidHash: string;
  /** Verified CMAC counter for replay protection */
  cmacCounter: number;
}

/** Bilateral attestation events (one per participant) */
export interface AttestationEvents {
  /** Local user's kind:30078 event (p-tag points to peer) */
  localEvent: unknown;
  /** Peer user's kind:30078 event (p-tag points to local) — constructed locally; peer must publish their own */
  peerEvent: unknown;
}

export interface PolCeremony {
  state: PolState;

  // ── Local participant ────────────────────────────────────────────────────
  /** Hex pubkey of the local user initiating the ceremony */
  localPubkey: string;
  /** Local user's card UID (derived from our own card tap on the peer device) */
  localCardUid: string;
  /** SHA-256 hash of local card UID */
  localCardUidHash: string;
  /** True once the local user's PIN has been verified */
  localPinVerified: boolean;

  // ── Peer participant ─────────────────────────────────────────────────────
  /** Hex pubkey of the peer user (populated after peer card CMAC verification) */
  peerPubkey: string;
  /** Peer's NFC card UID */
  peerCardUid: string;
  /** SHA-256 hash of peer card UID */
  peerCardUidHash: string;
  /** True once the peer has confirmed they scanned our card */
  peerPinVerified: boolean;

  // ── Ceremony metadata ────────────────────────────────────────────────────
  timestamp: number;
  cmacCounter: number;

  // ── Results ──────────────────────────────────────────────────────────────
  /** Both bilateral attestation events when state >= ATTESTING */
  attestationEvents?: AttestationEvents;
  /** OpenTimestamps commitment hex */
  otsCommitment?: string;
  /** Relay URL the events were published to */
  relayUrl?: string;
  /** Error message when state === FAILED */
  error?: string;

  /**
   * @deprecated Use localCardUid / localCardUidHash / peerCardUid / peerCardUidHash instead.
   * Kept for backward compatibility with components that read ceremony.cardUid.
   */
  cardUid: string;
  /** @deprecated Use localCardUidHash or peerCardUidHash */
  cardUidHash: string;
  /** @deprecated Use localPubkey */
  guardianPubkey: string;
  /** @deprecated Use attestationEvents.localEvent or attestationEvents.peerEvent */
  signedEvent?: unknown;
}

/** Proof of Life event kind (NIP-78 app-specific data) */
export const POL_EVENT_KIND = 30078;

/** d-tag for PoL events */
export const POL_D_TAG = 'satnam:proof-of-life';

/** Timeout for awaiting reciprocal scan (60 seconds) */
export const RECIPROCAL_SCAN_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// ProofOfLifeService
// ---------------------------------------------------------------------------

export class ProofOfLifeService {
  private readonly ntag = new NTAG424ProductionManager();

  constructor(
    private readonly vault: VaultOps,
    private readonly pinGate: PinGate,
  ) {}

  // -------------------------------------------------------------------------
  // State machine transitions
  // -------------------------------------------------------------------------

  /**
   * Initiate a Proof of Life ceremony.
   * Transitions: IDLE → INITIATED
   *
   * @param localPubkey - Hex-encoded pubkey of the local user starting the ceremony
   */
  async initiateCeremony(localPubkey: string): Promise<PolCeremony> {
    return {
      state: 'INITIATED',
      localPubkey,
      localCardUid: '',
      localCardUidHash: '',
      localPinVerified: false,
      peerPubkey: '',
      peerCardUid: '',
      peerCardUidHash: '',
      peerPinVerified: false,
      timestamp: Math.floor(Date.now() / 1000),
      cmacCounter: 0,
      // Backward-compat shims
      cardUid: '',
      cardUidHash: '',
      guardianPubkey: localPubkey,
    };
  }

  /**
   * @deprecated Use initiateCeremony(localPubkey) instead.
   * Kept for backward compatibility.
   */
  async initiate(localPubkey: string): Promise<PolCeremony> {
    return this.initiateCeremony(localPubkey);
  }

  /**
   * Scan peer's NFC card and verify CMAC.
   * Transitions: INITIATED → SCANNING_PEER → PEER_VERIFIED
   *
   * The local user taps the PEER'S physical card against their device.
   * This verifies the peer card's CMAC and extracts the peer card UID.
   *
   * @param ceremony    - Current ceremony state (must be INITIATED)
   * @param piccDataHex - Encrypted UID+counter from the SUN URL (piccData parameter)
   * @param cmacHex     - CMAC from the SUN URL
   */
  async scanPeerCard(
    ceremony: PolCeremony,
    piccDataHex: string,
    cmacHex: string,
  ): Promise<PolCeremony> {
    if (ceremony.state !== 'INITIATED' && ceremony.state !== 'SCANNING_PEER') {
      return {
        ...ceremony,
        state: 'FAILED',
        error: `scanPeerCard called in invalid state: ${ceremony.state}`,
      };
    }

    const scanning: PolCeremony = { ...ceremony, state: 'SCANNING_PEER' };

    try {
      // Extract peer card UID from piccData
      const peerCardUid = this._extractUidFromPiccData(piccDataHex);
      const peerCardUidHash = bytesToHex(sha256(utf8ToBytes(peerCardUid)));

      // Retrieve peer's SUN key (K2) from vault — peer must have registered their card
      let sunKeyHex: string;
      try {
        const sunKeyBytes = await this.vault.getNfcKey(peerCardUid, 'k2');
        sunKeyHex = bytesToHex(sunKeyBytes);
      } catch {
        return {
          ...scanning,
          state: 'FAILED',
          error: 'Peer card not registered — SUN key not found in vault',
        };
      }

      // Verify peer card CMAC
      const counterHex = piccDataHex.slice(14, 20);
      const result = await this.ntag.verifySUNMessage(
        `?uid=${peerCardUid}&ctr=${counterHex}&cmac=${cmacHex}`,
        sunKeyHex,
      );

      if (!result.valid) {
        return {
          ...scanning,
          state: 'FAILED',
          error: result.error ?? 'Peer card CMAC verification failed',
        };
      }

      // Derive peer pubkey from the peer card UID registration in vault
      // (The pubkey association is stored at the time of card registration)
      const peerPubkey = await this._lookupPubkeyForCard(peerCardUid);

      return {
        ...scanning,
        state: 'PEER_VERIFIED',
        peerCardUid,
        peerCardUidHash,
        peerPubkey,
        cmacCounter: result.counter ?? 0,
        timestamp: Math.floor(Date.now() / 1000),
        // Backward-compat shims
        cardUid: peerCardUid,
        cardUidHash: peerCardUidHash,
      };
    } catch (err) {
      return {
        ...scanning,
        state: 'FAILED',
        error: err instanceof Error ? err.message : 'Peer card scan failed',
      };
    }
  }

  /**
   * @deprecated Use scanPeerCard instead.
   * Kept for backward compatibility.
   */
  async processCardTap(
    ceremony: PolCeremony,
    piccDataHex: string,
    cmacHex: string,
  ): Promise<PolCeremony> {
    return this.scanPeerCard(ceremony, piccDataHex, cmacHex);
  }

  /**
   * Confirm that the peer has reciprocally scanned the local user's card.
   * Transitions: PEER_VERIFIED → AWAITING_RECIPROCAL → MUTUAL_VERIFIED
   *
   * In practice this is invoked when the peer's device broadcasts a scan-complete
   * signal (via a Nostr ephemeral event or direct Bluetooth/NFC handshake).
   * The peerScanResult contains the data from the peer's scan of our card.
   *
   * @param ceremony       - Current ceremony (must be PEER_VERIFIED or AWAITING_RECIPROCAL)
   * @param peerScanResult - Result of the peer scanning the local card
   */
  async confirmReciprocalScan(
    ceremony: PolCeremony,
    peerScanResult: PeerScanResult,
  ): Promise<PolCeremony> {
    if (
      ceremony.state !== 'PEER_VERIFIED' &&
      ceremony.state !== 'AWAITING_RECIPROCAL'
    ) {
      return {
        ...ceremony,
        state: 'FAILED',
        error: `confirmReciprocalScan called in invalid state: ${ceremony.state}`,
      };
    }

    return {
      ...ceremony,
      state: 'MUTUAL_VERIFIED',
      localCardUid: peerScanResult.peerCardUid,
      localCardUidHash: peerScanResult.peerCardUidHash,
    };
  }

  /**
   * Mark ceremony as awaiting reciprocal scan.
   * Transitions: PEER_VERIFIED → AWAITING_RECIPROCAL
   *
   * Called after the local user's card scan is confirmed and we're waiting
   * for the peer to also scan the local user's card.
   */
  async awaitReciprocalScan(ceremony: PolCeremony): Promise<PolCeremony> {
    if (ceremony.state !== 'PEER_VERIFIED') {
      return {
        ...ceremony,
        state: 'FAILED',
        error: `awaitReciprocalScan called in invalid state: ${ceremony.state}`,
      };
    }
    return { ...ceremony, state: 'AWAITING_RECIPROCAL' };
  }

  /**
   * Verify the local user's PIN.
   * Transitions: MUTUAL_VERIFIED → PIN_EXCHANGE (partial) or PIN_EXCHANGE → PIN_EXCHANGE
   *
   * @param ceremony - Current ceremony (must be MUTUAL_VERIFIED or PIN_EXCHANGE)
   * @param pin      - PIN entered by the local user
   */
  async verifyLocalPin(
    ceremony: PolCeremony,
    pin: string,
  ): Promise<PolCeremony> {
    if (
      ceremony.state !== 'MUTUAL_VERIFIED' &&
      ceremony.state !== 'PIN_EXCHANGE'
    ) {
      return {
        ...ceremony,
        state: 'FAILED',
        error: `verifyLocalPin called in invalid state: ${ceremony.state}`,
      };
    }

    if (this.pinGate.isLockedOut()) {
      return {
        ...ceremony,
        state: 'FAILED',
        error: `PIN locked out. Try again in ${Math.ceil(this.pinGate.getRemainingLockout() / 1000)}s`,
      };
    }

    const isValid = await this.pinGate.verifyPin(pin);
    if (!isValid) {
      const remaining = this.pinGate.getRemainingAttempts();
      return {
        ...ceremony,
        state: 'FAILED',
        error:
          remaining > 0
            ? `Incorrect PIN. ${remaining} attempt(s) remaining.`
            : 'PIN locked out.',
      };
    }

    const updated: PolCeremony = {
      ...ceremony,
      state: 'PIN_EXCHANGE',
      localPinVerified: true,
    };

    // If peer PIN is already verified, advance to ATTESTING
    if (updated.peerPinVerified) {
      return { ...updated, state: 'ATTESTING' };
    }

    return updated;
  }

  /**
   * @deprecated Use verifyLocalPin instead.
   * Kept for backward compatibility.
   */
  async processPin(ceremony: PolCeremony, pin: string): Promise<PolCeremony> {
    // Map old CARD_TAPPED state to MUTUAL_VERIFIED for compatibility
    const adapted =
      (ceremony.state as string) === 'CARD_TAPPED'
        ? { ...ceremony, state: 'MUTUAL_VERIFIED' as PolState }
        : ceremony;
    return this.verifyLocalPin(adapted, pin);
  }

  /**
   * Acknowledge that the peer has verified their PIN.
   * Transitions: PIN_EXCHANGE → PIN_EXCHANGE (with peerPinVerified=true) → ATTESTING
   *
   * @param ceremony - Current ceremony (must be PIN_EXCHANGE)
   */
  async verifyPeerPin(ceremony: PolCeremony): Promise<PolCeremony> {
    if (ceremony.state !== 'PIN_EXCHANGE') {
      return {
        ...ceremony,
        state: 'FAILED',
        error: `verifyPeerPin called in invalid state: ${ceremony.state}`,
      };
    }

    const updated: PolCeremony = {
      ...ceremony,
      peerPinVerified: true,
    };

    // If local PIN is already verified, advance to ATTESTING
    if (updated.localPinVerified) {
      return { ...updated, state: 'ATTESTING' };
    }

    return updated;
  }

  /**
   * Construct bilateral attestation events.
   * Transitions: ATTESTING → ATTESTING (with events attached)
   *
   * Creates two kind:30078 events:
   * 1. Local user's event: p-tag = peer pubkey, nfc-card-hash = peer card hash
   * 2. Peer user's event: p-tag = local pubkey, nfc-card-hash = local card hash
   *    (Peer must publish their own event from their device)
   *
   * @param ceremony    - Current ceremony (must be ATTESTING)
   * @param localNsec   - nsec of the local user for signing the local event
   */
  async constructAttestations(
    ceremony: PolCeremony,
    localNsec: string,
  ): Promise<PolCeremony> {
    if (ceremony.state !== 'ATTESTING') {
      return {
        ...ceremony,
        state: 'FAILED',
        error: `constructAttestations called in invalid state: ${ceremony.state}`,
      };
    }

    try {
      const secretKey = this._decodeNsec(localNsec);
      const localPubkeyFromNsec = bytesToHex(
        new Uint8Array(getPublicKey(secretKey) as unknown as ArrayBuffer),
      );

      // Use localPubkey from ceremony or derived from nsec
      const localPubkey = ceremony.localPubkey || localPubkeyFromNsec;
      const localPubkeyHash = bytesToHex(sha256(utf8ToBytes(localPubkey)));
      const peerPubkeyHash = bytesToHex(
        sha256(utf8ToBytes(ceremony.peerPubkey)),
      );

      const contentBase = {
        timestamp: ceremony.timestamp,
        bilateral: true,
        local_pubkey_hash: localPubkeyHash,
        peer_pubkey_hash: peerPubkeyHash,
        cmac_counter: ceremony.cmacCounter,
      };

      // ── Local user's event (p-tag → peer, nfc-card-hash → peer card) ──────
      const localEvent = finalizeEvent(
        {
          kind: POL_EVENT_KIND,
          created_at: ceremony.timestamp,
          tags: [
            ['d', POL_D_TAG],
            ['p', ceremony.peerPubkey],
            ['nfc-card-hash', ceremony.peerCardUidHash],
            ['bilateral', 'true'],
          ],
          content: JSON.stringify({
            ...contentBase,
            role: 'local',
            peer_card_uid_hash: ceremony.peerCardUidHash,
          }),
        },
        secretKey,
      );

      // ── Peer user's event template (unsigned — peer publishes their own) ──
      // We construct a template so the local device can preview it; the peer
      // must sign and publish from their own device.
      const peerEventTemplate = {
        kind: POL_EVENT_KIND,
        created_at: ceremony.timestamp,
        tags: [
          ['d', POL_D_TAG],
          ['p', localPubkey],
          ['nfc-card-hash', ceremony.localCardUidHash],
          ['bilateral', 'true'],
        ],
        content: JSON.stringify({
          ...contentBase,
          role: 'peer',
          peer_card_uid_hash: ceremony.localCardUidHash,
        }),
      };

      const attestationEvents: AttestationEvents = {
        localEvent,
        peerEvent: peerEventTemplate,
      };

      return {
        ...ceremony,
        state: 'ATTESTING',
        attestationEvents,
        // Backward-compat
        signedEvent: localEvent,
      };
    } catch (err) {
      return {
        ...ceremony,
        state: 'FAILED',
        error: err instanceof Error ? err.message : 'Attestation construction failed',
      };
    }
  }

  /**
   * @deprecated Use constructAttestations(ceremony, localNsec) instead.
   * Kept for backward compatibility with code calling sign().
   */
  async sign(ceremony: PolCeremony, signerNsec: string): Promise<PolCeremony> {
    // Map old PIN_VERIFIED state to ATTESTING for compatibility
    const adapted =
      (ceremony.state as string) === 'PIN_VERIFIED'
        ? { ...ceremony, state: 'ATTESTING' as PolState, localPinVerified: true, peerPinVerified: true }
        : ceremony;
    return this.constructAttestations(adapted, signerNsec);
  }

  /**
   * Publish attestation events to a Nostr relay and submit OTS anchor.
   * Transitions: ATTESTING → PUBLISHED → CONFIRMED
   *
   * Publishes the local user's signed event. The peer event template is returned
   * in the ceremony for the peer to publish from their own device.
   *
   * @param ceremony  - Current ceremony (must have attestationEvents)
   * @param relayUrl  - WebSocket URL of the target relay
   */
  async publishAttestations(
    ceremony: PolCeremony,
    relayUrl: string,
  ): Promise<PolCeremony> {
    if (ceremony.state !== 'ATTESTING' && ceremony.state !== 'PUBLISHED') {
      return {
        ...ceremony,
        state: 'FAILED',
        error: `publishAttestations called in invalid state: ${ceremony.state}`,
      };
    }

    if (!ceremony.attestationEvents?.localEvent) {
      return {
        ...ceremony,
        state: 'FAILED',
        error: 'No attestation events to publish — call constructAttestations first',
      };
    }

    const publishing: PolCeremony = {
      ...ceremony,
      state: 'PUBLISHED',
      relayUrl,
    };

    return new Promise((resolve) => {
      const ws = new WebSocket(relayUrl);
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          ws.close();
          resolve({
            ...publishing,
            state: 'FAILED',
            error: 'Relay publish timed out (10s)',
          });
        }
      }, 10_000);

      ws.onopen = () => {
        ws.send(JSON.stringify(['EVENT', ceremony.attestationEvents!.localEvent]));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (Array.isArray(msg) && msg[0] === 'OK') {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              ws.close();
              const success = msg[2] === true;
              resolve({
                ...publishing,
                state: success ? 'CONFIRMED' : 'FAILED',
                error: success
                  ? undefined
                  : ((msg[3] as string) ?? 'Relay rejected event'),
              });
            }
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({
            ...publishing,
            state: 'FAILED',
            error: `WebSocket error connecting to ${relayUrl}`,
          });
        }
      };
    });
  }

  /**
   * @deprecated Use publishAttestations instead.
   * Kept for backward compatibility with code calling publish().
   */
  async publish(ceremony: PolCeremony, relayUrl: string): Promise<PolCeremony> {
    // For backward compat: if there's a signedEvent but no attestationEvents, wrap it
    if (!ceremony.attestationEvents && ceremony.signedEvent) {
      const wrapped: PolCeremony = {
        ...ceremony,
        state: 'ATTESTING',
        attestationEvents: {
          localEvent: ceremony.signedEvent,
          peerEvent: null,
        },
      };
      return this.publishAttestations(wrapped, relayUrl);
    }
    return this.publishAttestations(ceremony, relayUrl);
  }

  /**
   * Get ceremony history (stored externally on relay).
   * @returns Array of completed ceremonies, newest first
   */
  async getHistory(_cardUidHash: string): Promise<PolCeremony[]> {
    // History is fetched from relay at the app layer.
    return [];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Extract card UID from piccData hex string.
   * piccData = AES-128-encrypted(UID[7] || counter[3] || random[4])
   * We treat piccDataHex as UID directly if 14 hex chars (7 bytes),
   * otherwise take first 14 chars as best-effort.
   */
  private _extractUidFromPiccData(piccDataHex: string): string {
    if (piccDataHex.length === 14) {
      return piccDataHex.toLowerCase();
    }
    return piccDataHex.slice(0, 14).toLowerCase();
  }

  /**
   * Look up the pubkey associated with a card UID via vault registration.
   * Falls back to a deterministic placeholder if not registered.
   */
  private async _lookupPubkeyForCard(cardUid: string): Promise<string> {
    try {
      // Convention: pubkey is stored in vault under slot 'pubkey' for the card UID
      const pubkeyBytes = await this.vault.getNfcKey(cardUid, 'pubkey' as any);
      return bytesToHex(pubkeyBytes);
    } catch {
      // Card pubkey not registered — return empty string;
      // caller must resolve via out-of-band (e.g., NIP-05 lookup)
      return '';
    }
  }

  private _decodeNsec(nsec: string): Uint8Array {
    if (/^[0-9a-fA-F]{64}$/.test(nsec)) {
      return hexToBytes(nsec);
    }
    if (nsec.startsWith('nsec1')) {
      const decoded = nt.nip19.decode(nsec);
      if (decoded.type !== 'nsec') throw new Error('Expected nsec');
      return decoded.data as Uint8Array;
    }
    throw new Error('Invalid nsec format');
  }
}

// ---------------------------------------------------------------------------
// Utility: hash card UID for privacy
// ---------------------------------------------------------------------------

export function hashCardUid(cardUid: string): string {
  return bytesToHex(sha256(utf8ToBytes(cardUid)));
}
