/**
 * @module nip26/construct
 * @description NIP-26 Delegation event construction.
 *
 * Provides functions to construct and sign NIP-26 delegation tokens and
 * delegation events for use in the Satnam v2 role hierarchy.
 *
 * ## Usage
 *
 * A Guardian delegating Steward authority to a pubkey:
 *
 * ```ts
 * const conditions = constructDelegationConditionsString(
 *   [1, 4, 9735, 27235, 39200],  // allowed event kinds
 *   Math.floor(Date.now() / 1000) + 365 * 24 * 3600,  // expiry in 1 year
 * );
 *
 * const delegation = await constructDelegationEvent(
 *   guardianNsec,
 *   stewardPubkey,
 *   conditions,
 *   RoleType.Steward,
 * );
 * ```
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/26.md
 * @see SPECIFICATION.md §4.2 — NIP-26 Delegation Events
 */

import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import * as nt from 'nostr-tools';

import type { DelegationEvent, DelegationConditions } from './types.js';
import { RoleType } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** NIP-26 delegation token prefix. */
const DELEGATION_TOKEN_PREFIX = 'nostr:delegation';

// ---------------------------------------------------------------------------
// Secret Key Decoding
// ---------------------------------------------------------------------------

/**
 * Decode a secret key from nsec bech32, hex string, or raw bytes.
 * @internal
 */
function decodeSecretKey(nsec: string | Uint8Array): Uint8Array {
  if (nsec instanceof Uint8Array) return nsec;

  if (/^[0-9a-fA-F]{64}$/.test(nsec)) {
    return hexToBytes(nsec);
  }

  if (nsec.startsWith('nsec1')) {
    const { nip19 } = nt;
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') throw new Error('Expected nsec bech32 string');
    return decoded.data as Uint8Array;
  }

  throw new Error('Invalid secret key format');
}

// ---------------------------------------------------------------------------
// Conditions String
// ---------------------------------------------------------------------------

/**
 * Construct a NIP-26 conditions string restricting what kinds and time range
 * a delegatee is authorized to sign.
 *
 * @param allowedKinds - Nostr event kinds the delegatee may sign. Pass an
 *                       empty array for no kind restriction.
 * @param expiry - Optional Unix timestamp after which the delegation expires
 *                 (creates a `created_at<expiry` condition).
 * @param notBefore - Optional Unix timestamp before which the delegation is
 *                    not valid (creates a `created_at>notBefore` condition).
 * @returns NIP-26 conditions string, e.g. `kind=27235&kind=1&created_at<1735689600`
 *
 * @example
 * ```ts
 * const conditions = constructDelegationConditionsString(
 *   [27235, 1, 9735],
 *   Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
 * );
 * // → "kind=27235&kind=1&kind=9735&created_at<1767225600"
 * ```
 */
export function constructDelegationConditionsString(
  allowedKinds: number[],
  expiry?: number,
  notBefore?: number,
): string {
  const parts: string[] = [];

  for (const kind of allowedKinds) {
    parts.push(`kind=${kind}`);
  }

  if (expiry !== undefined) {
    parts.push(`created_at<${expiry}`);
  }

  if (notBefore !== undefined) {
    parts.push(`created_at>${notBefore}`);
  }

  return parts.join('&');
}

/**
 * Construct a conditions string from a DelegationConditions object.
 * Inverse of parseDelegationConditions().
 *
 * @param conditions - Structured delegation conditions
 * @returns NIP-26 conditions string
 */
export function serializeDelegationConditions(conditions: DelegationConditions): string {
  return constructDelegationConditionsString(
    conditions.allowedKinds,
    conditions.notAfter,
    conditions.notBefore,
  );
}

// ---------------------------------------------------------------------------
// Default Conditions per Role
// ---------------------------------------------------------------------------

/**
 * Default set of allowed event kinds per role in the Satnam v2 hierarchy.
 * Used when constructing role-based delegation events.
 */
export const ROLE_ALLOWED_KINDS: Record<RoleType, number[]> = {
  [RoleType.Guardian]: [
    1,       // Short text note
    4,       // Encrypted direct message
    9735,    // Zap
    27235,   // NIP-98 HTTP auth
    39200,   // NIP-SA Agent Profile
    39201,   // NIP-SA Agent State
    39202,   // NIP-SA Agent Schedule
    39240,   // NIP-AC Credit Intent
    39241,   // NIP-AC Credit Offer
    39242,   // NIP-AC Credit Envelope
    39243,   // NIP-AC Spend Authorization
    39244,   // NIP-AC Settlement Receipt
    1984,    // Report
    1985,    // Label (NIP-32 attestation)
  ],
  [RoleType.Steward]: [
    1,
    4,
    9735,
    27235,
    39200,
    39201,
    39202,
    39240,
    39241,
    39242,
    39243,
    39244,
  ],
  [RoleType.Adult]: [
    1,
    4,
    9735,
    27235,
    39200,
    39201,
    39202,
    39240,
    39241,
    39242,
    39243,
    39244,
  ],
  [RoleType.Offspring]: [
    1,
    4,
    27235,
  ],
};

// ---------------------------------------------------------------------------
// Delegation Event Construction
// ---------------------------------------------------------------------------

/**
 * Construct and sign a NIP-26 delegation event.
 *
 * Creates the delegation token `nostr:delegation:<delegateePubkey>:<conditions>`,
 * hashes it with SHA-256, and signs with the delegator's secret key using
 * secp256k1 Schnorr signatures.
 *
 * The returned DelegationEvent can be embedded in Nostr events as a delegation
 * tag or published as a kind:1 note to Pylon for relay-cached delegation storage.
 *
 * @param delegatorNsec - Delegator's secret key (nsec bech32, hex, or bytes)
 * @param delegateePubkey - Hex-encoded pubkey of the entity receiving delegation
 * @param conditions - NIP-26 conditions string (use constructDelegationConditionsString())
 * @param role - The Satnam role being delegated (stored as metadata)
 * @returns A signed DelegationEvent
 *
 * @example
 * ```ts
 * const delegation = constructDelegationEvent(
 *   guardianNsec,
 *   stewardHexPubkey,
 *   'kind=27235&kind=1&created_at<1767225600',
 *   RoleType.Steward,
 * );
 *
 * // Embed in a Nostr event:
 * const tags = [
 *   ['delegation', delegation.delegatorPubkey, delegation.conditions, delegation.signature],
 * ];
 * ```
 */
export function constructDelegationEvent(
  delegatorNsec: string | Uint8Array,
  delegateePubkey: string,
  conditions: string,
  role: RoleType,
): DelegationEvent {
  const delegatorSecretKey = decodeSecretKey(delegatorNsec);
  const delegatorPubkey = getPublicKey(delegatorSecretKey);

  // Construct the delegation token
  const token = `${DELEGATION_TOKEN_PREFIX}:${delegateePubkey}:${conditions}`;
  const tokenHash = sha256(utf8ToBytes(token));

  // Sign the token hash with Schnorr
  const signature = schnorr.sign(tokenHash, delegatorSecretKey);
  const signatureHex = bytesToHex(signature);

  return {
    delegateePubkey,
    delegatorPubkey,
    conditions,
    signature: signatureHex,
    role,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Build a signed Nostr event (kind:1) that announces a NIP-26 delegation.
 * The event is published to Pylon so other clients can discover the delegation.
 *
 * The delegation tag within the event enables NIP-26 verification by any
 * verifier that reads the event.
 *
 * @param delegatorNsec - Delegator's secret key
 * @param delegateePubkey - Hex-encoded delegatee pubkey
 * @param conditions - NIP-26 conditions string
 * @param role - The Satnam role being delegated
 * @returns A finalized, signed Nostr event with delegation tag
 *
 * @example
 * ```ts
 * const event = buildDelegationNostrEvent(guardianNsec, stewardPubkey, conditions, RoleType.Steward);
 * // publish to relay...
 * ```
 */
export function buildDelegationNostrEvent(
  delegatorNsec: string | Uint8Array,
  delegateePubkey: string,
  conditions: string,
  role: RoleType,
): ReturnType<typeof finalizeEvent> {
  const delegatorSecretKey = decodeSecretKey(delegatorNsec);
  const delegation = constructDelegationEvent(
    delegatorSecretKey,
    delegateePubkey,
    conditions,
    role,
  );

  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  const { nip19 } = nt;
  const delegateeNpub = nip19.npubEncode(delegateePubkey);

  return finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        [
          'delegation',
          delegation.delegatorPubkey,
          delegation.conditions,
          delegation.signature,
        ],
        ['role', role],
        ['p', delegateePubkey],
      ],
      content: `NIP-26 delegation: ${roleLabel} role granted to ${delegateeNpub}`,
    },
    delegatorSecretKey,
  );
}

/**
 * Construct a delegation with default conditions for a specific role.
 * Automatically populates the allowed kinds based on the role capability matrix.
 *
 * @param delegatorNsec - Delegator's secret key
 * @param delegateePubkey - Hex-encoded delegatee pubkey
 * @param role - The role to delegate
 * @param expiryTimestamp - Optional Unix timestamp for delegation expiry
 * @returns A signed DelegationEvent with role-appropriate conditions
 *
 * @example
 * ```ts
 * const delegation = constructRoleDelegation(
 *   guardianNsec,
 *   stewardPubkey,
 *   RoleType.Steward,
 *   Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
 * );
 * ```
 */
export function constructRoleDelegation(
  delegatorNsec: string | Uint8Array,
  delegateePubkey: string,
  role: RoleType,
  expiryTimestamp?: number,
): DelegationEvent {
  const allowedKinds = ROLE_ALLOWED_KINDS[role];
  const conditions = constructDelegationConditionsString(allowedKinds, expiryTimestamp);
  return constructDelegationEvent(delegatorNsec, delegateePubkey, conditions, role);
}
