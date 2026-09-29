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

// Phase 0: BYO NWC — users paste any NIP-47 URI (Alby Hub, Mutiny, etc.) into Vault.
// No @getalby/sdk Hub detection. The URI's relay+secret is the only coupling.
// See connection-manager.ts addConnection(label, nwcUri).
