/**
 * @module lnbits
 * @description LNbits client barrel export for Satnam v2.
 *
 * @example
 * ```typescript
 * import { LNbitsClient } from '@/lib/lnbits';
 * ```
 */

export { LNbitsClient } from './client.js';

export type {
  LNbitsConfig,
  LNbitsWallet,
  LNbitsPayment,
  LNbitsExtension,
  BoltzSwapRequest,
  BoltzSwapStatus,
  LNURLPayConfig,
} from './types.js';
