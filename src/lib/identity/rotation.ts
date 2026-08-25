/**
 * @module identity/rotation
 * @description CR-H — key rotation / NIP-41-style succession flow.
 *
 * Flow (plan 2026-08-24):
 *   1. Succession event: signed by the OLD key, announcing the successor
 *      pubkey (plan directive: kind:13). FLAGGED: kind:13 also denotes
 *      NIP-59 seals — those are never published unwrapped, so relay-level
 *      ambiguity is bounded; surfaced to founder if a dedicated kind is
 *      preferred later.
 *   2. Old-key deprecation state recorded locally (vault slot via caller).
 *   3. Server-side NIP-05 update via the `rotate` action on the EXISTING
 *      register-identity function (≤8-function ceiling respected): the old
 *      key authenticates, names its username, and points the record at the
 *      successor pubkey. Address string unchanged.
 *   4. Re-publication of social graph (kind:3) and relay list (kind:10002)
 *      under the NEW key so followers can re-discover.
 *
 * The address string (username@domain) never changes during rotation.
 */

import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools';

/**
 * Succession event kind — FOUNDER DECISION 2026-08-24 (#3): kind:13 belongs
 * to NIP-59 seals; succession uses a DEDICATED kind instead of sharing.
 * Chosen 1041 (regular-event range, nod to the NIP-41 succession reference;
 * unassigned among common NIPs at time of writing).
 */
export const SUCCESSION_KIND = 1041;

export interface SuccessionEvent extends Event {
  kind: typeof SUCCESSION_KIND;
}

/**
 * Build the succession announcement signed by the OLD key.
 * Content: JSON {successor}. Tags: p=successor, claim namespace, alt summary.
 */
export function buildSuccessionEvent(params: {
  oldSecret: Uint8Array;
  successorPubkeyHex: string;
  reason?: 'planned' | 'compromised' | 'upgrade';
}): { event: Event; oldPubkeyHex: string } {
  if (!/^[0-9a-f]{64}$/.test(params.successorPubkeyHex)) {
    throw new Error('identity/rotation: successor pubkey must be 64 hex chars');
  }
  const oldPubkeyHex = getPublicKey(params.oldSecret);
  if (params.successorPubkeyHex === oldPubkeyHex) {
    throw new Error('identity/rotation: successor must differ from the rotating key');
  }

  const event = finalizeEvent(
    {
      kind: SUCCESSION_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', params.successorPubkeyHex],
        ['claim', params.reason ?? 'planned'],
        ['alt', 'Identity succession announcement'],
      ],
      content: JSON.stringify({
        successor: params.successorPubkeyHex,
        reason: params.reason ?? 'planned',
      }),
    },
    params.oldSecret,
  );
  return { event, oldPubkeyHex };
}

// ---------------------------------------------------------------------------
// Old-key deprecation state (client-side record)
// ---------------------------------------------------------------------------

export interface DeprecationRecord {
  readonly oldPubkeyHex: string;
  readonly newPubkeyHex: string;
  readonly successionEventId: string;
  /** Set once the server confirmed the NIP-05 pointer moved. */
  rotatedAt?: string;
}

export function createDeprecationRecord(params: {
  successionEvent: Event;
  newPubkeyHex: string;
}): DeprecationRecord {
  return {
    oldPubkeyHex: params.successionEvent.pubkey,
    newPubkeyHex: params.newPubkeyHex,
    successionEventId: params.successionEvent.id,
  };
}

// ---------------------------------------------------------------------------
// Re-publication builders (signed by the NEW key)
// ---------------------------------------------------------------------------

/**
 * Rebuild the social graph (kind:3) under the new key. Contacts are carried
 * verbatim from the old following set (array of hex pubkeys).
 */
export function rebuildContactList(params: {
  newSecret: Uint8Array;
  followingHexPubkeys: string[];
}): Event {
  return finalizeEvent(
    {
      kind: 3,
      created_at: Math.floor(Date.now() / 1000),
      tags: params.followingHexPubkeys.map((p) => ['p', p]),
      content: '{}',
    },
    params.newSecret,
  );
}

/**
 * Rebuild the NIP-65 relay list (kind:10002) under the new key.
 */
export function rebuildRelayList(params: {
  newSecret: Uint8Array;
  writeRelays: string[];
  readRelays: string[];
}): Event {
  const tags: string[][] = [
    ...params.writeRelays.map((r) => ['r', r]),
    ...params.readRelays.map((r) => ['r', r, 'read']),
  ];
  return finalizeEvent(
    {
      kind: 10002,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    },
    params.newSecret,
  );
}

/**
 * Build the request body for the server-side `rotate` action on the existing
 * register-identity function. Sent with NIP-98 auth signed by the OLD key.
 */
export function buildRotationRequestBody(params: {
  username: string;
  domain: string;
  successorPubkeyHex: string;
}): string {
  return JSON.stringify({
    action: 'rotate',
    username: params.username,
    domain: params.domain,
    successor_pubkey: params.successorPubkeyHex,
  });
}
