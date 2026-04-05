/**
 * @module nwc/types
 * @description TypeScript type definitions for the NWC (Nostr Wallet Connect, NIP-47)
 * connection manager. All Lightning amounts are denominated in millisatoshis (msats)
 * using bigint to avoid floating-point precision loss.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/47.md — NIP-47 specification
 */

// ---------------------------------------------------------------------------
// NIP-47 Kind Constants
// ---------------------------------------------------------------------------

/** NIP-47 request event kind (client → wallet). */
export const NWC_REQUEST_KIND = 23194;

/** NIP-47 response event kind (wallet → client). */
export const NWC_RESPONSE_KIND = 23195;

/** NIP-47 wallet info event kind (wallet publishes capabilities). */
export const NWC_INFO_KIND = 13194;

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/**
 * Metadata for a stored NWC connection. The connection secret is NOT present
 * here — it lives exclusively in the OPFS Vault at `nwc/{connectionId}.uri`.
 * The `connectionSecret` field is present for type completeness only and is
 * always an empty string when loaded from storage.
 */
export interface NwcConnection {
  /** UUID identifying this connection (used as vault key). */
  id: string;

  /** User-provided human-readable label, e.g. "Alby Hub", "Phoenix". */
  label: string;

  /** WebSocket relay URL extracted from the NWC URI (e.g. wss://relay.getalby.com/v1). */
  relayUrl: string;

  /**
   * Wallet public key (hex-encoded 32-byte secp256k1 key) extracted from the NWC URI.
   * This is the key used to encrypt requests to the wallet and verify response signatures.
   */
  walletPubkey: string;

  /**
   * Connection secret — NOT stored here. Always empty string in memory.
   * The actual secret lives in the OPFS Vault at nwc/{connectionId}.uri
   * as part of the full NWC URI.
   */
  connectionSecret: '';

  /** Unix timestamp (seconds) when this connection was added. */
  createdAt: number;

  /** Whether this is the active default connection used for all operations. */
  isDefault: boolean;

  /** Cached balance in millisatoshis from the most recent getBalance() call. */
  lastKnownBalance?: bigint;

  /** Unix timestamp of the most recent successful getBalance() call. */
  lastBalanceUpdate?: number;

  /**
   * NIP-47 methods supported by this wallet, reported by the info event.
   * Populated after the first getInfo() call.
   */
  supportedMethods?: string[];
}

// ---------------------------------------------------------------------------
// Payment operations
// ---------------------------------------------------------------------------

/**
 * Result of a successful pay_invoice operation.
 */
export interface PaymentResult {
  /** Payment preimage (hex-encoded), proves the invoice was paid. */
  preimage: string;

  /** SHA-256 hash of the payment preimage (hex-encoded). */
  paymentHash: string;

  /** Routing fees paid in millisatoshis. */
  feeMsats: bigint;

  /** Total amount paid including fees in millisatoshis. */
  totalMsats: bigint;
}

/**
 * Status of a BOLT-11 invoice, returned by lookupInvoice.
 */
export interface InvoiceStatus {
  /** SHA-256 hash of the preimage (hex-encoded). */
  paymentHash: string;

  /** The BOLT-11 invoice string. */
  bolt11: string;

  /** Invoice amount in millisatoshis. */
  amountMsats: bigint;

  /** Invoice description / memo. */
  description: string;

  /** Whether the invoice has been paid. */
  isPaid: boolean;

  /** Unix timestamp when the invoice was settled (only present if paid). */
  paidAt?: number;

  /** Unix timestamp when the invoice expires. */
  expiresAt?: number;
}

// ---------------------------------------------------------------------------
// Transaction history
// ---------------------------------------------------------------------------

/**
 * A single transaction entry from list_transactions.
 */
export interface Transaction {
  /** Direction of the transaction. */
  type: 'incoming' | 'outgoing';

  /** SHA-256 payment hash (hex-encoded). */
  paymentHash: string;

  /** Amount in millisatoshis (absolute value, always positive). */
  amountMsats: bigint;

  /** Routing/swap fees paid in millisatoshis (outgoing only). */
  feeMsats?: bigint;

  /** Payment description / memo. */
  description: string;

  /** Unix timestamp when the transaction was created / initiated. */
  createdAt: number;

  /** Unix timestamp when the transaction was settled (if settled). */
  settledAt?: number;

  /** The BOLT-11 invoice string associated with this transaction. */
  bolt11?: string;

  /** Payment preimage (hex-encoded) — present only for settled outgoing. */
  preimage?: string;
}

/**
 * Options for filtering the list_transactions response.
 */
export interface TxListOptions {
  /** Only return transactions created at or after this Unix timestamp. */
  from?: number;

  /** Only return transactions created at or before this Unix timestamp. */
  until?: number;

  /** Maximum number of transactions to return. */
  limit?: number;

  /** Number of transactions to skip (for pagination). */
  offset?: number;

  /** Filter by transaction direction. */
  type?: 'incoming' | 'outgoing';

  /** If true, include only unpaid/pending invoices. */
  unpaid?: boolean;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * A NIP-47 error returned by the wallet in a response event.
 */
export interface NwcError {
  /** NIP-47 error code string (e.g. "INSUFFICIENT_BALANCE", "UNAUTHORIZED"). */
  code: string;

  /** Human-readable error description. */
  message: string;
}
