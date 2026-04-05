/**
 * @module nip26
 * @description NIP-26 Delegation barrel export.
 *
 * NIP-26 Delegation replaces the database-backed role table in Satnam v2.
 * Every role assignment in the trust hierarchy (Guardian → Steward → Adult →
 * Offspring) is a NIP-26 delegation event published to Pylon.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/26.md
 * @see SPECIFICATION.md §4 — RBAC v2 — NIP-26 Delegation + FROST Threshold
 *
 * @example
 * ```ts
 * import { constructDelegationEvent, verifyDelegation, RoleType } from '@lib/nip26';
 *
 * // Guardian delegates Steward role
 * const delegation = constructDelegationEvent(
 *   guardianNsec,
 *   stewardHexPubkey,
 *   'kind=27235&kind=1&created_at<1767225600',
 *   RoleType.Steward,
 * );
 *
 * // Verify delegation
 * const valid = verifyDelegation(
 *   delegation.delegateePubkey,
 *   delegation.delegatorPubkey,
 *   delegation.conditions,
 *   delegation.signature,
 * );
 * ```
 */

export { RoleType } from './types.js';
export type {
  DelegationConditions,
  DelegationEvent,
  DelegationChain,
  DelegationGraph as DelegationGraphInterface,
} from './types.js';

export {
  parseDelegationConditions,
  verifyDelegation,
  verifyDelegationChain,
  verifyDelegationChainAt,
  isDelegationCurrentlyValid,
} from './verify.js';

export {
  constructDelegationConditionsString,
  serializeDelegationConditions,
  constructDelegationEvent,
  buildDelegationNostrEvent,
  constructRoleDelegation,
  ROLE_ALLOWED_KINDS,
} from './construct.js';

// Delegation Graph implementation
export { DelegationGraph } from './graph.js';
