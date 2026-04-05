/**
 * @module lnbits/types
 * @description TypeScript type definitions for the LNbits client in Satnam v2.
 *
 * LNbits is a free, open-source Lightning wallet/accounts system that runs on
 * top of a Lightning node. API keys are stored in the OPFS Vault — never in
 * localStorage or any plaintext store.
 *
 * @see https://docs.lnbits.org/
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * LNbits instance configuration.
 * Admin and invoice keys are stored in OPFS Vault at:
 *   lnbits/{instance_hash}.admin
 *   lnbits/{instance_hash}.invoice
 */
export interface LNbitsConfig {
  /** LNbits instance URL (user's self-hosted or hosted, e.g. https://legend.lnbits.com) */
  instanceUrl: string;
  /** Admin key — stored in OPFS Vault at lnbits/{instance_hash}.admin */
  adminKey?: string;
  /** Invoice/Read key — stored in OPFS Vault at lnbits/{instance_hash}.invoice */
  invoiceKey?: string;
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

/**
 * LNbits wallet details as returned by the /api/v1/wallet endpoint.
 */
export interface LNbitsWallet {
  /** Wallet UUID */
  id: string;
  /** Human-readable wallet name */
  name: string;
  /** Balance in millisatoshis */
  balance: number;
  /** Admin key (write access) */
  adminkey: string;
  /** Invoice/read key (read-only access) */
  inkey: string;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * LNbits payment record as returned by the payments API.
 */
export interface LNbitsPayment {
  /** SHA-256 payment hash (hex) */
  paymentHash: string;
  /** BOLT-11 invoice string */
  bolt11: string;
  /** Amount in millisatoshis (negative for outgoing payments) */
  amount: number;
  /** Routing fee in millisatoshis */
  fee: number;
  /** Payment memo / description */
  memo: string;
  /** Unix timestamp of the payment */
  time: number;
  /** Whether the payment is still pending */
  pending: boolean;
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------

/**
 * LNbits extension metadata.
 */
export interface LNbitsExtension {
  /** Extension identifier (e.g. "boltz", "lnurlp") */
  id: string;
  /** Human-readable extension name */
  name: string;
  /** Whether the extension is installed on this instance */
  isInstalled: boolean;
  /** Whether the extension is active/enabled */
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Boltz Swaps
// ---------------------------------------------------------------------------

/**
 * Request to create a Boltz submarine or reverse swap via the LNbits Boltz extension.
 *
 * Swap types:
 * - submarine: on-chain → Lightning (send on-chain, receive via LN invoice)
 * - reverse: Lightning → on-chain (pay LN invoice, receive on-chain)
 */
export interface BoltzSwapRequest {
  /** Swap direction */
  type: 'submarine' | 'reverse';
  /** Amount in satoshis */
  amountSats: number;
  /** Destination on-chain Bitcoin address (required for reverse swaps) */
  onchainAddress?: string;
  /** BOLT-11 invoice to pay (required for submarine swaps) */
  invoice?: string;
}

/**
 * Boltz swap status as returned by the LNbits Boltz extension.
 */
export interface BoltzSwapStatus {
  /** Boltz swap identifier */
  id: string;
  /** Current swap state */
  status: 'created' | 'pending' | 'completed' | 'failed' | 'refunded';
  /** Amount in satoshis */
  amountSats: number;
  /** Fee paid in satoshis */
  feeSats: number;
  /** Swap direction */
  type: 'submarine' | 'reverse';
  /** Unix timestamp when the swap was created */
  createdAt: number;
}

// ---------------------------------------------------------------------------
// LNURL-pay
// ---------------------------------------------------------------------------

/**
 * Configuration for an LNURL-pay endpoint set up via LNbits.
 */
export interface LNURLPayConfig {
  /** LNURL-pay metadata description (shown to payer) */
  description: string;
  /** Minimum payable amount in satoshis */
  minSats: number;
  /** Maximum payable amount in satoshis */
  maxSats: number;
  /** Callback URL that the payer's wallet calls to get the invoice */
  callback: string;
}

// ---------------------------------------------------------------------------
// Internal API response shapes
// ---------------------------------------------------------------------------

/**
 * Raw API response from LNbits /api/v1/wallet.
 * @internal
 */
export interface LNbitsWalletApiResponse {
  id: string;
  name: string;
  balance: number;
  adminkey: string;
  inkey: string;
}

/**
 * Raw API response from LNbits /api/v1/payments (single item).
 * @internal
 */
export interface LNbitsPaymentApiResponse {
  checking_id: string;
  pending: boolean;
  amount: number;
  fee: number;
  memo: string;
  time: number;
  bolt11: string;
  payment_hash: string;
}

/**
 * Raw request body for creating an invoice via LNbits.
 * @internal
 */
export interface LNbitsCreateInvoiceRequest {
  out: boolean;
  amount: number; // sats
  memo?: string;
  unit?: string;
  webhook?: string;
}

/**
 * Raw response from LNbits invoice creation.
 * @internal
 */
export interface LNbitsCreateInvoiceResponse {
  payment_hash: string;
  payment_request: string; // bolt11
}

/**
 * Raw request body for paying an invoice via LNbits.
 * @internal
 */
export interface LNbitsPayInvoiceRequest {
  out: boolean;
  bolt11: string;
}
