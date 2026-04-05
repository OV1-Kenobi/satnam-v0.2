/**
 * @module nfc/proof-of-life
 * @description Proof of Life ceremony state machine.
 *
 * A Proof of Life ceremony proves physical presence of a card holder at a
 * specific time, using the NTAG424 CMAC counter for recency and a PIN for
 * identity confirmation.
 *
 * States:
 * ```
 * IDLE → INITIATED → CARD_TAPPED → PIN_VERIFIED → SIGNED → PUBLISHED → CONFIRMED
 *                                                     ↓
 *                                               FAILED (timeout, wrong PIN, invalid CMAC)
 * ```
 *
 * The Proof of Life event is kind:30078 (NIP-78 app-specific data) with
 * d-tag `satnam:proof-of-life`.
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
  | 'CARD_TAPPED'
  | 'PIN_VERIFIED'
  | 'SIGNED'
  | 'PUBLISHED'
  | 'CONFIRMED'
  | 'FAILED';

export interface PolCeremony {
  state: PolState;
  cardUid: string;
  /** SHA-256 hash of card UID (published, not the raw UID — privacy) */
  cardUidHash: string;
  guardianPubkey: string;
  timestamp: number;
  cmacCounter: number;
  /** Optional GPS (opt-in, ephemeral — not stored permanently) */
  gpsCoordinates?: { lat: number; lon: number };
  /** Signed Nostr event (kind:30078) when state >= SIGNED */
  signedEvent?: unknown;
  /** Relay URL the event was published to */
  relayUrl?: string;
  /** Error message when state === FAILED */
  error?: string;
}

/** Proof of Life event kind (NIP-78 app-specific data) */
export const POL_EVENT_KIND = 30078;

/** d-tag for PoL events */
export const POL_D_TAG = 'satnam:proof-of-life';

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
   * @param guardianPubkey - Hex-encoded pubkey of the Guardian witnessing the ceremony
   */
  async initiate(guardianPubkey: string): Promise<PolCeremony> {
    return {
      state: 'INITIATED',
      cardUid: '',
      cardUidHash: '',
      guardianPubkey,
      timestamp: Math.floor(Date.now() / 1000),
      cmacCounter: 0,
    };
  }

  /**
   * Process card tap with CMAC verification.
   * Transitions: INITIATED → CARD_TAPPED
   *
   * Verifies the NTAG424 SUN message CMAC client-side using the key from vault.
   *
   * @param ceremony - Current ceremony state
   * @param piccDataHex - Encrypted UID+counter from the SUN URL (piccData parameter)
   * @param cmacHex - CMAC from the SUN URL
   */
  async processCardTap(
    ceremony: PolCeremony,
    piccDataHex: string,
    cmacHex: string,
  ): Promise<PolCeremony> {
    if (ceremony.state !== 'INITIATED') {
      return {
        ...ceremony,
        state: 'FAILED',
        error: `processCardTap called in invalid state: ${ceremony.state}`,
      };
    }

    try {
      // Extract card UID from piccData (first 7 bytes after decryption).
      // For the SUN URL format, piccData contains the encrypted UID.
      // We decode the UID from the piccData hex prefix (7 bytes = 14 hex chars).
      const cardUid = this._extractUidFromPiccData(piccDataHex);
      const cardUidHash = bytesToHex(sha256(utf8ToBytes(cardUid)));

      // Retrieve SUN key (K2) from vault
      let sunKeyHex: string;
      try {
        const sunKeyBytes = await this.vault.getNfcKey(cardUid, 'k2');
        sunKeyHex = bytesToHex(sunKeyBytes);
      } catch {
        return {
          ...ceremony,
          state: 'FAILED',
          error: 'Card not registered — SUN key not found in vault',
        };
      }

      // Verify SUN message CMAC
      const sunMessage = `?uid=${cardUid}&cmac=${cmacHex}`;
      const counterHex = piccDataHex.slice(14, 20); // bytes 7-9 (counter)
      const counter = parseInt(counterHex, 16);
      const result = await this.ntag.verifySUNMessage(
        `?uid=${cardUid}&ctr=${counterHex}&cmac=${cmacHex}`,
        sunKeyHex,
      );

      if (!result.valid) {
        return {
          ...ceremony,
          state: 'FAILED',
          error: result.error ?? 'CMAC verification failed',
        };
      }

      return {
        ...ceremony,
        state: 'CARD_TAPPED',
        cardUid,
        cardUidHash,
        cmacCounter: result.counter ?? counter,
        timestamp: Math.floor(Date.now() / 1000),
      };
    } catch (err) {
      return {
        ...ceremony,
        state: 'FAILED',
        error: err instanceof Error ? err.message : 'Card tap processing failed',
      };
    }
  }

  /**
   * Process PIN verification.
   * Transitions: CARD_TAPPED → PIN_VERIFIED
   *
   * @param ceremony - Current ceremony state (must be CARD_TAPPED)
   * @param pin - PIN entered by the user
   */
  async processPin(ceremony: PolCeremony, pin: string): Promise<PolCeremony> {
    if (ceremony.state !== 'CARD_TAPPED') {
      return {
        ...ceremony,
        state: 'FAILED',
        error: `processPin called in invalid state: ${ceremony.state}`,
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
        error: remaining > 0
          ? `Incorrect PIN. ${remaining} attempt(s) remaining.`
          : 'PIN locked out.',
      };
    }

    return { ...ceremony, state: 'PIN_VERIFIED' };
  }

  /**
   * Sign the Proof of Life event.
   * Creates a kind:30078 NIP-78 event with d-tag "satnam:proof-of-life".
   * Transitions: PIN_VERIFIED → SIGNED
   *
   * @param ceremony - Current ceremony state (must be PIN_VERIFIED)
   * @param signerNsec - nsec of the Guardian signing the event
   */
  async sign(ceremony: PolCeremony, signerNsec: string): Promise<PolCeremony> {
    if (ceremony.state !== 'PIN_VERIFIED') {
      return {
        ...ceremony,
        state: 'FAILED',
        error: `sign called in invalid state: ${ceremony.state}`,
      };
    }

    try {
      const secretKey = this._decodeNsec(signerNsec);

      const content = JSON.stringify({
        timestamp: ceremony.timestamp,
        card_uid_hash: ceremony.cardUidHash,
        guardian_pubkey: ceremony.guardianPubkey,
        cmac_counter: ceremony.cmacCounter,
        ...(ceremony.gpsCoordinates
          ? { gps: ceremony.gpsCoordinates }
          : {}),
      });

      const signedEvent = finalizeEvent(
        {
          kind: POL_EVENT_KIND,
          created_at: ceremony.timestamp,
          tags: [
            ['d', POL_D_TAG],
            ['card_uid_hash', ceremony.cardUidHash],
            ['guardian', ceremony.guardianPubkey],
            ['cmac_counter', String(ceremony.cmacCounter)],
          ],
          content,
        },
        secretKey,
      );

      return { ...ceremony, state: 'SIGNED', signedEvent };
    } catch (err) {
      return {
        ...ceremony,
        state: 'FAILED',
        error: err instanceof Error ? err.message : 'Signing failed',
      };
    }
  }

  /**
   * Publish the signed Proof of Life event to a Nostr relay.
   * Transitions: SIGNED → PUBLISHED → CONFIRMED
   *
   * @param ceremony - Current ceremony state (must be SIGNED)
   * @param relayUrl - WebSocket URL of the target relay
   */
  async publish(ceremony: PolCeremony, relayUrl: string): Promise<PolCeremony> {
    if (ceremony.state !== 'SIGNED') {
      return {
        ...ceremony,
        state: 'FAILED',
        error: `publish called in invalid state: ${ceremony.state}`,
      };
    }

    if (!ceremony.signedEvent) {
      return { ...ceremony, state: 'FAILED', error: 'No signed event to publish' };
    }

    const published = { ...ceremony, state: 'PUBLISHED' as PolState, relayUrl };

    return new Promise((resolve) => {
      const ws = new WebSocket(relayUrl);
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          ws.close();
          resolve({
            ...published,
            state: 'FAILED',
            error: 'Relay publish timed out (10s)',
          });
        }
      }, 10_000);

      ws.onopen = () => {
        ws.send(JSON.stringify(['EVENT', ceremony.signedEvent]));
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
                ...published,
                state: success ? 'CONFIRMED' : 'FAILED',
                error: success ? undefined : (msg[3] as string) ?? 'Relay rejected event',
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
            ...published,
            state: 'FAILED',
            error: `WebSocket error connecting to ${relayUrl}`,
          });
        }
      };
    });
  }

  /**
   * Get ceremony history for a card (stored in vault).
   *
   * @param cardUidHash - SHA-256 hash of card UID
   * @returns Array of completed ceremonies, newest first
   */
  async getHistory(cardUidHash: string): Promise<PolCeremony[]> {
    // History is persisted as encrypted entries in vault under
    // nfc/{cardUidHash}.pol_history using the NFC key slot convention.
    // For this implementation we return empty array — persistence is
    // handled at the app layer (ceremonies can be fetched from relay).
    return [];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Extract card UID from piccData hex string.
   * piccData = AES-128-encrypted(UID[7] || counter[3] || random[4])
   * For SUN messages with LRP mode the first 7 bytes after decryption are the UID.
   * Since we don't have the encryption key here, we use the cardUid from
   * the URL path if piccData is the raw encrypted blob, or directly if
   * the piccData has been pre-decoded.
   */
  private _extractUidFromPiccData(piccDataHex: string): string {
    // When called from parseNfcUrl (ios-fallback), the piccData might be
    // the raw encrypted blob or a pre-extracted UID.
    // NTAG424 SUN piccData is 16 bytes (32 hex chars): encrypted UID+counter.
    // In the iOS URL flow, the card_uid is in the URL path; piccData is extra.
    // We treat piccDataHex as the UID directly if it's 14 hex chars (7 bytes),
    // otherwise take the first 14 chars as a best-effort UID extraction.
    if (piccDataHex.length === 14) {
      return piccDataHex.toLowerCase();
    }
    // For 32-char piccData (encrypted), return the hex as-is for CMAC verification.
    // The actual UID comes from the URL path in the NFC handler.
    return piccDataHex.slice(0, 14).toLowerCase();
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
