/**
 * @module nwc
 * @description Public API surface for the NWC (Nostr Wallet Connect) subsystem.
 *
 * Usage:
 * ```typescript
 * import { NwcConnectionManager } from '@lib/nwc';
 * import type { NwcConnection, PaymentResult } from '@lib/nwc';
 * ```
 */

export { NwcConnectionManager } from './connection-manager.js';

export {
  NWC_REQUEST_KIND,
  NWC_RESPONSE_KIND,
  NWC_INFO_KIND,
} from './types.js';

export type {
  NwcConnection,
  PaymentResult,
  InvoiceStatus,
  Transaction,
  TxListOptions,
  NwcError,
} from './types.js';
