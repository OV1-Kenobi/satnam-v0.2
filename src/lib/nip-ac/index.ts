/**
 * NIP-AC barrel export — Agent Credit
 * All public types and functions for the NIP-AC credit lifecycle module (kinds 39240–39245).
 */

// ============================================================================
// Types (from types.ts — do not modify types.ts directly)
// ============================================================================

export type {
  NostrEvent,
  CreditIntentContent,
  CreditIntentTags,
  CreditOfferContent,
  CreditOfferTags,
  EnvelopeRevocationStatus,
  CreditEnvelopeContent,
  CreditEnvelopeTags,
  SpendAuthorizationContent,
  SpendAuthorizationTags,
  SettlementReceiptContent,
  SettlementReceiptTags,
  DefaultNoticeContent,
  DefaultNoticeTags,
  EnvelopeRevocationRequest,
  EnvelopeRevocationResult,
  ReputationDeltaInput,
  CreditLifecycleState,
  CreditLifecycleRecord,
} from "./types.js";

// ============================================================================
// Client (client.ts)
// ============================================================================

export type {
  UnsignedEvent,
  CreditOffer,
  CreditEnvelope,
  IntentParams,
  CreditLifecycleCallback,
} from "./client.js";

export {
  buildCreditIntent,
  parseCreditOffer,
  buildCreditEnvelope,
  buildSpendAuth,
  buildSettlementReceipt,
  buildDefaultNotice,
  calculateReputationDelta,
  CreditLifecycleManager,
} from "./client.js";
