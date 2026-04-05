/**
 * @module cashu
 * @description Public API surface for the Cashu eCash client subsystem.
 *
 * Usage:
 * ```typescript
 * import { CashuClient } from '@lib/cashu';
 * import type { MintInfo, CashuProof, MeltResult } from '@lib/cashu';
 * ```
 */

export { CashuClient } from './client.js';

export type {
  MintInfo,
  CashuProof,
  MeltResult,
  ProofStatus,
  TokenPayload,
} from './types.js';
