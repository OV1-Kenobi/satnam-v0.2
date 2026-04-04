/**
 * @module nip26/verify
 * @description NIP-26 Delegation verification functions.
 *
 * Provides cryptographic verification of NIP-26 delegation tokens and chains,
 * used in role-gated operations throughout Satnam v2.
 *
 * ## How NIP-26 Delegation Works
 *
 * A delegator (e.g. a Guardian) creates a delegation token:
 * 1. Construct the token string: `nostr:delegation:<delegatee_pubkey>:<conditions>`
 * 2. Hash it with SHA-256: `tokenHash = sha256(token)`
 * 3. Sign with Schnorr: `sig = schnorr.sign(tokenHash, delegatorPrivkey)`
 *
 * A delegated event includes the tag:
 * ```json
 * ["delegation", "<delegator_pubkey>", "<conditions>", "<sig>"]
 * ```
 *
 * Verifying a delegation:
 * 1. Reconstruct the token string from the event's pubkey and conditions.
 * 2. Hash with SHA-256.
 * 3. Verify Schnorr sig against delegator pubkey.
 * 4. Verify event satisfies all conditions.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/26.md
 * @see SPECIFICATION.md §4.2 — NIP-26 Delegation Events
 */

import { schnorr } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

import type { DelegationConditions, DelegationChain } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** NIP-26 delegation token prefix per the spec. */
const DELEGATION_TOKEN_PREFIX = 'nostr:delegation';

// ---------------------------------------------------------------------------
// Condition Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a NIP-26 conditions string into a structured DelegationConditions object.
 *
 * Handles the following condition types:
 * - `kind=N` — restricts to specific event kinds
 * - `created_at<T` — expiry (event must be created before timestamp T)
 * - `created_at>T` — not-before (event must be created after timestamp T)
 *
 * Unknown condition types are silently ignored to allow forward compatibility
 * with future NIP-26 extensions.
 *
 * @param conditionsString - Raw NIP-26 conditions string (e.g. `kind=27235&created_at<1735689600`)
 * @returns Parsed DelegationConditions
 *
 * @example
 * ```ts
 * const conditions = parseDelegationConditions('kind=27235&kind=1&created_at<1735689600');
 * // → { allowedKinds: [27235, 1], notAfter: 1735689600, notBefore: undefined }
 * ```
 */
export function parseDelegationConditions(conditionsString: string): DelegationConditions {
  const result: DelegationConditions = {
    allowedKinds: [],
    notAfter: undefined,
    notBefore: undefined,
  };

  if (!conditionsString || conditionsString.trim() === '') {
    return result;
  }

  const parts = conditionsString.split('&');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('kind=')) {
      const kind = parseInt(trimmed.slice('kind='.length), 10);
      if (!isNaN(kind)) {
        result.allowedKinds.push(kind);
      }
    } else if (trimmed.startsWith('created_at<')) {
      const ts = parseInt(trimmed.slice('created_at<'.length), 10);
      if (!isNaN(ts)) {
        result.notAfter = ts;
      }
    } else if (trimmed.startsWith('created_at>')) {
      const ts = parseInt(trimmed.slice('created_at>'.length), 10);
      if (!isNaN(ts)) {
        result.notBefore = ts;
      }
    }
    // Unknown conditions are silently skipped (forward compat)
  }

  return result;
}

// ---------------------------------------------------------------------------
// Single Delegation Verification
// ---------------------------------------------------------------------------

/**
 * Verify a NIP-26 delegation signature.
 *
 * Reconstructs the delegation token from the delegatee pubkey and conditions,
 * hashes it with SHA-256, and verifies the Schnorr signature against the
 * delegator's pubkey using @noble/curves secp256k1.
 *
 * Optionally checks that the delegation conditions are satisfied by the
 * provided event kind and timestamp (if passed).
 *
 * @param delegateePubkey - Hex-encoded pubkey of the delegatee (event signer)
 * @param delegatorPubkey - Hex-encoded pubkey of the delegator (authority granter)
 * @param conditions - NIP-26 conditions string from the delegation tag
 * @param signature - Hex-encoded 64-byte Schnorr signature from the delegation tag
 * @param eventKind - Optional event kind to check against conditions
 * @param eventCreatedAt - Optional event timestamp to check against conditions
 * @returns true if the delegation signature is valid and conditions are satisfied
 *
 * @example
 * ```ts
 * const isValid = verifyDelegation(
 *   event.pubkey,
 *   delegationTag[1],
 *   delegationTag[2],
 *   delegationTag[3],
 *   event.kind,
 *   event.created_at,
 * );
 * ```
 */
export function verifyDelegation(
  delegateePubkey: string,
  delegatorPubkey: string,
  conditions: string,
  signature: string,
  eventKind?: number,
  eventCreatedAt?: number,
): boolean {
  // Reconstruct the delegation token string
  const token = `${DELEGATION_TOKEN_PREFIX}:${delegateePubkey}:${conditions}`;

  // Hash the token with SHA-256
  const tokenHash = sha256(utf8ToBytes(token));

  // Verify Schnorr signature
  try {
    const sigBytes = hexToBytes(signature);
    const pubkeyBytes = hexToBytes(delegatorPubkey);
    const isValidSig = schnorr.verify(sigBytes, tokenHash, pubkeyBytes);
    if (!isValidSig) return false;
  } catch {
    return false;
  }

  // If event details are provided, verify conditions are satisfied
  if (eventKind !== undefined || eventCreatedAt !== undefined) {
    const parsed = parseDelegationConditions(conditions);

    // Check kind restrictions
    if (parsed.allowedKinds.length > 0 && eventKind !== undefined) {
      if (!parsed.allowedKinds.includes(eventKind)) return false;
    }

    // Check timestamp bounds
    if (eventCreatedAt !== undefined) {
      if (parsed.notAfter !== undefined && eventCreatedAt >= parsed.notAfter) return false;
      if (parsed.notBefore !== undefined && eventCreatedAt <= parsed.notBefore) return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Chain Verification
// ---------------------------------------------------------------------------

/**
 * Verify a full delegation chain from a delegatee back to a Guardian.
 *
 * A valid chain satisfies:
 * 1. Each delegation in the chain is individually valid (signature + conditions).
 * 2. The chain is contiguous: `chain[i].delegatorPubkey === chain[i+1].delegateePubkey`
 *    for all i in [0, chain.length - 2].
 * 3. The final element's delegatorPubkey is the root Guardian (has no further delegation).
 * 4. All delegations are valid at the current timestamp.
 *
 * An empty chain is considered valid (root Guardian with no delegation).
 * A chain with a single element is valid if that single delegation is valid.
 *
 * @param chain - Array of DelegationEvents from delegatee to Guardian.
 *               chain[0] is the leaf (most-derived) delegation.
 *               chain[chain.length-1] is the Guardian-issued delegation.
 * @returns true if the entire chain is cryptographically valid and contiguous
 *
 * @example
 * ```ts
 * const chain: DelegationChain = [
 *   { delegateePubkey: adultPubkey, delegatorPubkey: stewardPubkey, ... },
 *   { delegateePubkey: stewardPubkey, delegatorPubkey: guardianPubkey, ... },
 * ];
 * const valid = verifyDelegationChain(chain);
 * ```
 */
export function verifyDelegationChain(chain: DelegationChain): boolean {
  if (chain.length === 0) return true;

  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    if (!link) return false;

    // Verify this individual delegation
    const isValid = verifyDelegation(
      link.delegateePubkey,
      link.delegatorPubkey,
      link.conditions,
      link.signature,
      undefined, // kind is checked per-event, not per-chain
      now,       // check timestamp validity
    );

    if (!isValid) return false;

    // Verify chain contiguity
    if (i < chain.length - 1) {
      const nextLink = chain[i + 1];
      if (!nextLink) return false;
      if (link.delegatorPubkey !== nextLink.delegateePubkey) {
        // Chain is broken: the delegator of this link must be the delegatee of the next
        return false;
      }
    }
  }

  return true;
}

/**
 * Verify that a chain of delegations is valid at a specific timestamp.
 * Like verifyDelegationChain() but allows specifying a timestamp other than now.
 *
 * @param chain - Array of DelegationEvents (see verifyDelegationChain)
 * @param timestamp - Unix timestamp to validate delegation conditions at
 * @returns true if the chain is valid at the given timestamp
 */
export function verifyDelegationChainAt(chain: DelegationChain, timestamp: number): boolean {
  if (chain.length === 0) return true;

  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    if (!link) return false;

    const parsed = parseDelegationConditions(link.conditions);

    // Check timestamp bounds
    if (parsed.notAfter !== undefined && timestamp >= parsed.notAfter) return false;
    if (parsed.notBefore !== undefined && timestamp <= parsed.notBefore) return false;

    // Verify the cryptographic signature
    const isValidSig = verifyDelegation(
      link.delegateePubkey,
      link.delegatorPubkey,
      link.conditions,
      link.signature,
    );
    if (!isValidSig) return false;

    // Verify chain contiguity
    if (i < chain.length - 1) {
      const nextLink = chain[i + 1];
      if (!nextLink || link.delegatorPubkey !== nextLink.delegateePubkey) return false;
    }
  }

  return true;
}

/**
 * Check whether a delegation is currently valid (not expired and not before notBefore).
 * Does not verify the signature — use verifyDelegation() for full verification.
 *
 * @param conditions - NIP-26 conditions string
 * @param atTimestamp - Unix timestamp to check (defaults to now)
 * @returns true if the conditions permit events at the given timestamp
 */
export function isDelegationCurrentlyValid(conditions: string, atTimestamp?: number): boolean {
  const ts = atTimestamp ?? Math.floor(Date.now() / 1000);
  const parsed = parseDelegationConditions(conditions);

  if (parsed.notAfter !== undefined && ts >= parsed.notAfter) return false;
  if (parsed.notBefore !== undefined && ts <= parsed.notBefore) return false;

  return true;
}
