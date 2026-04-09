/**
 * @module lnbits/client
 * @description LNbits REST API client for Satnam v2.
 *
 * ## Security model
 * - Admin and invoice keys are stored ONLY in the OPFS Vault at:
 *     lnbits/{instance_hash}.admin
 *     lnbits/{instance_hash}.invoice
 * - Keys are never stored in localStorage, sessionStorage, or memory beyond
 *   the lifetime of a single API call.
 *
 * ## Browser proxy
 * Browser environments proxy all LNbits API calls through the existing
 * nwc-proxy Netlify function to avoid CORS issues with self-hosted instances.
 * Agent/server environments call the LNbits REST API directly.
 *
 * @see https://docs.lnbits.org/
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes, bytesToUtf8 } from '@noble/hashes/utils';

import { Vault } from '../vault/vault.js';
import { VaultError } from '../vault/types.js';

import type {
  LNbitsConfig,
  LNbitsWallet,
  LNbitsPayment,
  LNbitsExtension,
  BoltzSwapRequest,
  BoltzSwapStatus,
  LNbitsWalletApiResponse,
  LNbitsPaymentApiResponse,
  LNbitsCreateInvoiceResponse,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The path prefix used in OPFS Vault for LNbits keys.
 * Full paths:
 *   lnbits/{instance_hash}.admin
 *   lnbits/{instance_hash}.invoice
 */
const VAULT_PREFIX = 'lnbits';

/**
 * Whether we are running in a browser environment.
 * Used to decide whether to proxy API calls.
 */
const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * The nwc-proxy Netlify function endpoint.
 * All browser-side LNbits calls are forwarded through this to avoid CORS.
 */
const NWC_PROXY_URL = '/.netlify/functions/nwc-proxy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 of the instance URL for use as a vault key prefix.
 * Normalizes the URL before hashing.
 *
 * @param instanceUrl - LNbits instance URL
 * @returns Hex-encoded SHA-256 hash
 */
function hashInstanceUrl(instanceUrl: string): string {
  const normalized = instanceUrl.trim().replace(/\/+$/, '').toLowerCase();
  return bytesToHex(sha256(utf8ToBytes(normalized)));
}

/**
 * Map LNbits payment API response to our LNbitsPayment type.
 * @internal
 */
function mapPayment(raw: LNbitsPaymentApiResponse): LNbitsPayment {
  return {
    paymentHash: raw.payment_hash ?? raw.checking_id ?? '',
    bolt11: raw.bolt11 ?? '',
    amount: raw.amount ?? 0,
    fee: raw.fee ?? 0,
    memo: raw.memo ?? '',
    time: raw.time ?? 0,
    pending: raw.pending ?? false,
  };
}

// ---------------------------------------------------------------------------
// LNbitsClient
// ---------------------------------------------------------------------------

/**
 * LNbits REST API client.
 *
 * All API keys are retrieved from the OPFS Vault on demand — they are never
 * held in memory between calls. The `instanceUrl` is stored in plaintext in
 * the client config; only the admin/invoice keys are secret.
 *
 * @example
 * ```typescript
 * const client = new LNbitsClient(vault, {
 *   instanceUrl: 'https://legend.lnbits.com',
 * });
 * await client.connect({ instanceUrl: '...', adminKey: '...', invoiceKey: '...' });
 * const wallet = await client.getWalletDetails();
 * ```
 */
export class LNbitsClient {
  private instanceUrl: string | null = null;
  private instanceHash: string | null = null;

  /**
   * @param vault - OPFS Vault instance. Must be unlocked before key operations.
   * @param config - Optional initial configuration. Call connect() if not provided.
   */
  constructor(
    private readonly vault: Vault,
    config?: Pick<LNbitsConfig, 'instanceUrl'>,
  ) {
    if (config?.instanceUrl) {
      this.instanceUrl = config.instanceUrl.trim().replace(/\/+$/, '');
      this.instanceHash = hashInstanceUrl(this.instanceUrl);
    }
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  /**
   * Connect to an LNbits instance by storing its API keys in the OPFS Vault.
   *
   * @param config - LNbits configuration including instance URL and keys
   * @throws {VaultError.VaultLocked} if the vault is locked
   */
  async connect(config: LNbitsConfig): Promise<void> {
    const normalized = config.instanceUrl.trim().replace(/\/+$/, '');
    this.instanceUrl = normalized;
    this.instanceHash = hashInstanceUrl(normalized);

    this.requireUnlocked();

    if (config.adminKey) {
      await this.vault.storeLNbitsKey(
        `${VAULT_PREFIX}/${this.instanceHash}.admin`,
        config.adminKey,
      );
    }
    if (config.invoiceKey) {
      await this.vault.storeLNbitsKey(
        `${VAULT_PREFIX}/${this.instanceHash}.invoice`,
        config.invoiceKey,
      );
    }
  }

  /**
   * Disconnect from the current LNbits instance and delete stored keys.
   *
   * @throws {VaultError.VaultLocked} if the vault is locked
   */
  async disconnect(): Promise<void> {
    this.requireConnected();
    this.requireUnlocked();
    await this.vault.deleteLNbitsKey(`${VAULT_PREFIX}/${this.instanceHash!}.admin`);
    await this.vault.deleteLNbitsKey(`${VAULT_PREFIX}/${this.instanceHash!}.invoice`);
    this.instanceUrl = null;
    this.instanceHash = null;
  }

  /**
   * Check whether a connection is configured (instance URL is set).
   * Does not verify that keys are stored or that the instance is reachable.
   */
  isConnected(): boolean {
    return this.instanceUrl !== null;
  }

  // -------------------------------------------------------------------------
  // Wallet operations
  // -------------------------------------------------------------------------

  /**
   * Get wallet details including balance.
   *
   * Uses the invoice/read key if admin key is not available.
   *
   * @returns LNbitsWallet with current balance in millisatoshis
   * @throws {Error} if not connected or the request fails
   */
  async getWalletDetails(): Promise<LNbitsWallet> {
    const key = await this.getApiKey('invoice');
    const raw = await this.request<LNbitsWalletApiResponse>('GET', '/api/v1/wallet', key);
    return {
      id: raw.id ?? '',
      name: raw.name ?? '',
      balance: raw.balance ?? 0,
      adminkey: raw.adminkey ?? '',
      inkey: raw.inkey ?? '',
    };
  }

  /**
   * Create a Lightning invoice (BOLT-11) for receiving payment.
   *
   * @param amountSats - Amount in satoshis
   * @param memo - Invoice description / memo
   * @returns BOLT-11 invoice string
   * @throws {Error} if not connected or the request fails
   */
  async createInvoice(amountSats: number, memo: string): Promise<string> {
    const key = await this.getApiKey('invoice');
    const body = {
      out: false,
      amount: amountSats,
      memo: memo || '',
      unit: 'sat',
    };
    const raw = await this.request<LNbitsCreateInvoiceResponse>(
      'POST',
      '/api/v1/payments',
      key,
        );
    return raw.payment_request ?? '';
  }

  /**
   * Pay a BOLT-11 invoice.
   *
   * Requires admin key access.
   *
   * @param bolt11 - BOLT-11 invoice string to pay
   * @returns LNbitsPayment with payment details
   * @throws {Error} if not connected, admin key unavailable, or payment fails
   */
  async payInvoice(bolt11: string): Promise<LNbitsPayment> {
    const key = await this.getApiKey('admin');
      const raw = await this.request<LNbitsPaymentApiResponse>(
      'POST',
      '/api/v1/payments',
      key,
        );
    return mapPayment(raw);
  }

  /**
   * List recent payments from the wallet.
   *
   * @param limit - Maximum number of payments to return (default 50)
   * @param offset - Pagination offset (default 0)
   * @returns Array of LNbitsPayment records (newest first)
   * @throws {Error} if not connected or the request fails
   */
  async getPayments(limit = 50, offset = 0): Promise<LNbitsPayment[]> {
    const key = await this.getApiKey('invoice');
    const raw = await this.request<LNbitsPaymentApiResponse[]>(
      'GET',
      `/api/v1/payments?limit=${limit}&offset=${offset}`,
      key,
    );
    return (Array.isArray(raw) ? raw : []).map(mapPayment);
  }

  /**
   * Check the status of a payment by its payment hash.
   *
   * @param paymentHash - Hex-encoded payment hash
   * @returns LNbitsPayment with current status
   * @throws {Error} if not connected or payment not found
   */
  async checkPayment(paymentHash: string): Promise<LNbitsPayment> {
    const key = await this.getApiKey('invoice');
    const raw = await this.request<LNbitsPaymentApiResponse>(
      'GET',
      `/api/v1/payments/${paymentHash}`,
      key,
    );
    return mapPayment(raw);
  }

  // -------------------------------------------------------------------------
  // LNURL-pay
  // -------------------------------------------------------------------------

  /**
   * Create an LNURL-pay endpoint for a given username via the LNbits lnurlp extension.
   *
   * The resulting LNURL can be used as a Lightning Address (user@domain.com).
   *
   * @param username - Username for the LNURL-pay address
   * @returns LNURLPayConfig with the callback URL and min/max amounts
   * @throws {Error} if the lnurlp extension is not installed/active
   */
  async createLnurlPay(username: string): Promise<import('./types.js').LNURLPayConfig> {
    const key = await this.getApiKey('admin');
    const body = {
      description: `Lightning Address for ${username}`,
      min: 1,
      max: 1_000_000, // 1M sats
      comment_chars: 255,
      username,
    };
    const raw = await this.request<{
      description: string;
      min: number;
      max: number;
      lnurl: string;
    }>('POST', '/lnurlp/api/v1/links', key);

    return {
      description: raw.description ?? '',
      minSats: raw.min ?? 1,
      maxSats: raw.max ?? 1_000_000,
      callback: raw.lnurl ?? '',
    };
  }

  // -------------------------------------------------------------------------
  // Boltz swaps (via LNbits Boltz extension)
  // -------------------------------------------------------------------------

  /**
   * Create a Boltz swap via the LNbits Boltz extension.
   *
   * Submarine swap (on-chain → LN): send BTC on-chain, receive via invoice.
   * Reverse swap (LN → on-chain): pay LN invoice, receive BTC on-chain.
   *
   * @param request - Swap parameters
   * @returns BoltzSwapStatus with the initial swap state
   * @throws {Error} if the Boltz extension is not installed/active
   */
  async createBoltzSwap(request: BoltzSwapRequest): Promise<BoltzSwapStatus> {
    const key = await this.getApiKey('admin');

    const body: Record<string, unknown> = {
      wallet: await this.getWalletId(),
      amount: request.amountSats,
    };

    let endpoint: string;
    if (request.type === 'submarine') {
      endpoint = '/boltz/api/v1/swap/submarine';
      if (request.invoice) body.invoice = request.invoice;
    } else {
      endpoint = '/boltz/api/v1/swap/reverse';
      if (request.onchainAddress) body.onchain_address = request.onchainAddress;
    }

    const raw = await this.request<{
      id: string;
      status: string;
      amount: number;
      fee: number;
      time?: number;
    }>(
      'POST',
      endpoint,
      key,
        );

    return {
      id: raw.id ?? '',
      status: (raw.status as BoltzSwapStatus['status']) ?? 'created',
      amountSats: raw.amount ?? request.amountSats,
      feeSats: raw.fee ?? 0,
      type: request.type,
      createdAt: raw.time ?? Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Check the status of an existing Boltz swap.
   *
   * @param swapId - Boltz swap identifier
   * @returns BoltzSwapStatus with current state
   * @throws {Error} if the Boltz extension is not installed or swap not found
   */
  async checkBoltzSwap(swapId: string): Promise<BoltzSwapStatus> {
    const key = await this.getApiKey('invoice');
    const raw = await this.request<{
      id: string;
      status: string;
      amount: number;
      fee: number;
      type: string;
      time?: number;
    }>(
      'GET',
      `/boltz/api/v1/swap/${swapId}`,
      key,
    );

    return {
      id: raw.id ?? swapId,
      status: (raw.status as BoltzSwapStatus['status']) ?? 'pending',
      amountSats: raw.amount ?? 0,
      feeSats: raw.fee ?? 0,
      type: (raw.type as 'submarine' | 'reverse') ?? 'submarine',
      createdAt: raw.time ?? 0,
    };
  }

  // -------------------------------------------------------------------------
  // Extensions
  // -------------------------------------------------------------------------

  /**
   * List all extensions installed on this LNbits instance.
   *
   * @returns Array of LNbitsExtension metadata
   * @throws {Error} if not connected or the request fails
   */
  async listExtensions(): Promise<LNbitsExtension[]> {
    const key = await this.getApiKey('invoice');
    const raw = await this.request<Array<{
      id?: string;
      name?: string;
      isInstalled?: boolean;
      isActive?: boolean;
      code?: string;
      active?: boolean;
    }>>('GET', '/api/v1/extension?all_extensions=true', key);

    return (Array.isArray(raw) ? raw : []).map((ext) => ({
      id: ext.id ?? ext.code ?? '',
      name: ext.name ?? '',
      isInstalled: ext.isInstalled ?? false,
      isActive: ext.isActive ?? ext.active ?? false,
    }));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Throw if no instance URL is configured. */
  private requireConnected(): string {
    if (!this.instanceUrl || !this.instanceHash) {
      throw new Error(
        'LNbitsClient: not connected. Call connect() or pass instanceUrl to constructor.',
      );
    }
    return this.instanceHash;
  }

  /** Throw if vault is locked (requires VaultOps to have isUnlocked). */
  private requireUnlocked(): void {
    if (!this.vault.isUnlocked()) {
      throw new Error('LNbitsClient: vault is locked. Unlock the vault first.');
    }
  }

  /**
   * Retrieve an API key from the OPFS Vault.
   *
   * Falls back from 'admin' to 'invoice' if admin key is not found.
   *
   * @param preferred - Preferred key type ('admin' or 'invoice')
   * @returns API key string
   */
  private async getApiKey(preferred: 'admin' | 'invoice'): Promise<string> {
    const hash = this.requireConnected();

    // Try preferred key type first
    const tryTypes = preferred === 'admin'
      ? (['admin', 'invoice'] as const)
      : (['invoice', 'admin'] as const);

    for (const type of tryTypes) {
      try {
        const keyBytes = await this.vault.getLNbitsKey(`${VAULT_PREFIX}/${hash}.${type}`);
        const key = bytesToUtf8(keyBytes);
        if (key) return key;
      } catch (err) {
        // VaultError.IdentityNotFound — try next type
        if (err instanceof Error && err.message === VaultError.IdentityNotFound) {
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `LNbitsClient: no API key found in vault for instance ${this.instanceUrl}. ` +
      'Call connect() with adminKey and/or invoiceKey.',
    );
  }

  /**
   * Get the wallet ID for Boltz swap operations.
   * @internal
   */
  private async getWalletId(): Promise<string> {
    const wallet = await this.getWalletDetails();
    return wallet.id;
  }

  /**
   * Make an authenticated request to the LNbits REST API.
   *
   * In browser environments, calls are proxied through the nwc-proxy Netlify
   * function to avoid CORS issues. In agent/server environments, calls are
   * made directly.
   *
   * @param method - HTTP method
   * @param path - API path (e.g. /api/v1/wallet)
   * @param apiKey - LNbits API key to authenticate with
   * @param body - Optional request body (will be JSON-encoded)
   * @returns Parsed JSON response
   * @throws {Error} if the request fails or returns a non-2xx status
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    apiKey: string?: unknown,
  ): Promise<T> {
    this.requireConnected();

    const url = IS_BROWSER
      ? this.buildProxyUrl(path, method)
      : `${this.instanceUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    };

    // When proxying, pass the instance URL and key in headers
    if (IS_BROWSER) {
      headers['X-LNbits-Instance'] = this.instanceUrl!;
      headers['X-LNbits-Key'] = apiKey;
    }

    const fetchOptions: RequestInit = {
      method: IS_BROWSER ? 'POST' : method,
      headers,
    };

    if (!IS_BROWSER && body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, fetchOptions);
    } catch (err) {
      throw new Error(
        `LNbitsClient: network error reaching ${this.instanceUrl}: ` +
        (err instanceof Error ? err.message : String(err)),
      );
    }

    if (!response.ok) {
      let errorDetail = '';
      try {
        const errJson = await response.json() as Record<string, unknown>;
        errorDetail = String(errJson.detail ?? errJson.message ?? '');
      } catch {
        errorDetail = await response.text().catch(() => '');
      }
      throw new Error(
        `LNbitsClient: HTTP ${response.status} from ${path}` +
        (errorDetail ? `: ${errorDetail}` : ''),
      );
    }

    const data = await response.json() as T;
    return data;
  }

  /**
   * Build the proxy URL for browser environments.
   * Encodes the target URL and method as query parameters.
   *
   * @internal
   */
  private buildProxyUrl(
    path: string,
    method: string?: unknown,
  ): string {
    const targetUrl = encodeURIComponent(`${this.instanceUrl}${path}`);
    const proxyUrl = `${NWC_PROXY_URL}?target=${targetUrl}&method=${method}`;
    return proxyUrl;
  }
}

// ---------------------------------------------------------------------------
// Vault extension: LNbits key storage
// ---------------------------------------------------------------------------

/**
 * Augment the Vault interface with LNbits key storage methods.
 *
 * These are implemented by extending the vault's generic encrypted storage.
 * The vault does not have native LNbits methods, so we define a thin adapter
 * that uses the vault's storage internals via the existing agent key pattern.
 *
 * @internal
 */
declare module '../vault/vault.js' {
  interface Vault {
    storeLNbitsKey(path: string, key: string): Promise<void>;
    getLNbitsKey(path: string): Promise<Uint8Array>;
    deleteLNbitsKey(path: string): Promise<void>;
  }
}

// Provide the implementation at runtime via prototype extension.
// This is safe because Vault is a class, not a plain interface.
// (The Vault class is already imported above — no duplicate import needed.)

/**
 * Store an LNbits API key in the OPFS Vault.
 *
 * The key is encoded as UTF-8 and encrypted with the vault's master key.
 * We reuse the vault's agent key storage pattern, since the Vault class
 * already has storeAgentNsec/getAgentNsec which accept arbitrary keys via
 * the generic path mechanism. We piggyback on storeCashuProofs for generic
 * JSON blobs, wrapping the key string in a single-element array.
 */
(Vault.prototype as unknown as {
  storeLNbitsKey: (path: string, key: string) => Promise<void>;
}).storeLNbitsKey = async function (this: Vault, path: string, key: string): Promise<void> {
  // We store the key string as a JSON-encoded single-element array in the cashu
  // proof storage slot (which accepts arbitrary JSON blobs).
  // Path format: "lnbits/hash.admin" maps to storeCashuProofs("lnbits_hash_admin", ...)
  const storageKey = path.replace(/\//g, '_').replace(/\./g, '_');
  await this.storeCashuProofs(storageKey, [{ id: 'lnbits_key', amount: 0, secret: key, C: '' }]);
};

(Vault.prototype as unknown as {
  getLNbitsKey: (path: string) => Promise<Uint8Array>;
}).getLNbitsKey = async function (this: Vault, path: string): Promise<Uint8Array> {
  const storageKey = path.replace(/\//g, '_').replace(/\./g, '_');
  const proofs = await this.getCashuProofs(storageKey);
  const key = proofs[0]?.secret ?? '';
  return utf8ToBytes(key);
};

(Vault.prototype as unknown as {
  deleteLNbitsKey: (path: string) => Promise<void>;
}).deleteLNbitsKey = async function (this: Vault, path: string): Promise<void> {
  const storageKey = path.replace(/\//g, '_').replace(/\./g, '_');
  try {
    await this.storeCashuProofs(storageKey, []);
  } catch {
    // ignore — key may not exist
  }
};

