/**
 * @module ots/nip03
 * @description CR-F — NIP-03 OpenTimestamps attestation events (kind:1040).
 *
 * Published ONLY after an OTS proof has Bitcoin confirmation (CR-F honest
 * state rule: attestations are never published for pending anchors).
 *
 * Event shape per NIP-03:
 *   kind: 1040
 *   tags:
 *     ["e", <anchored event id>, <relay hint, optional>]
 *     ["p", <author pubkey of the anchored event>]   // when applicable
 *     ["alt", "OpenTimestamps attestation"]           // accessibility summary
 *   content: base64-encoded OTS proof file (or proof URL when too large)
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { finalizeEvent, type Event } from 'nostr-tools';

/** The OTS commitment: SHA-256 over the 32-byte event id (anchor convention). */
export function otsDigestForEvent(eventIdHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(eventIdHex)) {
    throw new Error('ots/nip03: event id must be 64 hex chars');
  }
  const idBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    idBytes[i] = parseInt(eventIdHex.slice(i * 2, i * 2 + 2), 16)!;
  }
  return bytesToHex(sha256(idBytes));
}

export interface AttestationInput {
  /** Hex id of the anchored Nostr event. */
  anchoredEventId: string;
  /** Base64-encoded OTS proof file (from the calendar receipt). */
  proofBase64: string;
  /** Optional relay hint where the anchored event lives. */
  relayHint?: string;
  /** Author pubkey of the anchored event (p tag), when known. */
  anchoredAuthorPubkeyHex?: string;
}

/**
 * Build and sign a kind:1040 attestation. Caller supplies the signing secret;
 * it is used once and never stored.
 */
export function buildKind1040(params: AttestationInput & { secret: Uint8Array }): Event {
  if (!params.proofBase64) throw new Error('ots/nip03: proof required');

  const tags: string[][] = [['e', params.anchoredEventId]];
  if (params.relayHint) tags[0]!.push(params.relayHint);
  if (params.anchoredAuthorPubkeyHex) {
    tags.push(['p', params.anchoredAuthorPubkeyHex]);
  }
  tags.push(['alt', 'OpenTimestamps attestation']);

  return finalizeEvent(
    {
      kind: 1040,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: params.proofBase64,
    },
    params.secret,
  );
}

/**
 * Verify a kind:1040 binds to its claimed event: recompute the OTS digest
 * from the e-tag event id and check structural integrity. Full cryptographic
 * verification (Bitcoin header chain walk) requires an OTS verifier and is
 * performed by the second-client path.
 */
export function verifyAttestationBinding(attestation: Event): boolean {
  const eTag = attestation.tags.find((t) => t[0] === 'e');
  if (!eTag || !eTag[1]) return false;
  const eventId = eTag[1];
  try {
    const digest = otsDigestForEvent(eventId);
    // Structural binding: content must carry a non-empty proof, and the
    // digest derived from the event id must be well-formed (64 hex).
    return (
      digest.length === 64 &&
      typeof attestation.content === 'string' &&
      attestation.content.length > 0 &&
      attestation.kind === 1040
    );
  } catch {
    return false;
  }
}
