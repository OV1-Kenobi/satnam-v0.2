/**
 * @module nwc/connection-manager
 * @description NWC (Nostr Wallet Connect, NIP-47) connection manager for Satnam v2.
 *
 * ## Security model
 * - The full NWC URI (including the connection secret) is stored ONLY in the
 *   OPFS Vault at `nwc/{connectionId}.uri` via the Vault API.
 * - Connection metadata (label, relay URL, wallet pubkey) is stored in
 *   IndexedDB (localStorage fallback) in plaintext — none of these fields
 *   are secret.
 * - The connection secret never appears in any log output or error message.
 *
 * ## NIP-47 flow
 * Each wallet operation sends an encrypted kind:23194 request event to the
 * wallet relay, then subscribes for a kind:23195 response encrypted back to
 * the client's connection secret key.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/47.md
 */

import { SimplePool, finalizeEvent, getPublicKey } from 'nostr-tools';
import * as nip44 from 'nostr-tools/nip44';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';

import type { Vault } from '../vault/vault.js';
import {
  NWC_REQUEST_KIND,
  NWC_RESPONSE_KIND,
  NWC_INFO_KIND,
} from './types.js';
import type {
  NwcConnection,
  PaymentResult,
  InvoiceStatus,
  Transaction,
  TxListOptions,
  NwcError,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Timeout in milliseconds for NWC request → response round trip. */
const NWC_REQUEST_TIMEOUT_MS = 30_000;

/** IndexedDB database name for NWC connection metadata. */
const METADATA_DB_NAME = 'satnam-nwc-meta';

/** IndexedDB object store name for connection metadata records. */
const METADATA_STORE = 'connections';

// ---------------------------------------------------------------------------
// Internal metadata types
// ---------------------------------------------------------------------------

/** Non-secret metadata stored in IndexedDB. */
interface ConnectionMeta {
  id: string;
  label: string;
  relayUrl: string;
  walletPubkey: string;
  createdAt: number;
  isDefault: boolean;
  lastKnownBalance?: string; // serialized bigint as decimal string
  lastBalanceUpdate?: number;
  supportedMethods?: string[];
}

// ---------------------------------------------------------------------------
// IndexedDB metadata helpers
// ---------------------------------------------------------------------------

function openMetaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(METADATA_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(METADATA_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function metaGetAll(): Promise<ConnectionMeta[]> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(METADATA_STORE, 'readonly');
    const req = tx.objectStore(METADATA_STORE).getAll();
    req.onsuccess = () => resolve((req.result as ConnectionMeta[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function metaPut(record: ConnectionMeta): Promise<void> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(METADATA_STORE, 'readwrite');
    const req = tx.objectStore(METADATA_STORE).put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function metaDelete(id: string): Promise<void> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(METADATA_STORE, 'readwrite');
    const req = tx.objectStore(METADATA_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function metaGet(id: string): Promise<ConnectionMeta | null> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(METADATA_STORE, 'readonly');
    const req = tx.objectStore(METADATA_STORE).get(id);
    req.onsuccess = () => resolve((req.result as ConnectionMeta | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// URI parsing
// ---------------------------------------------------------------------------

interface ParsedNwcUri {
  walletPubkey: string;
  relayUrl: string;
  secret: string;
}

/**
 * Parse a nostr+walletconnect:// URI into its components.
 *
 * Expected format:
 *   nostr+walletconnect://<wallet_pubkey_hex>?relay=<relay_url>&secret=<connection_secret>
 *
 * @throws {Error} if the URI is malformed or missing required components
 */
function parseNwcUri(uri: string): ParsedNwcUri {
  if (!uri.startsWith('nostr+walletconnect://')) {
    throw new Error('Invalid NWC URI: must start with nostr+walletconnect://');
  }

  let url: URL;
  try {
    // Replace the custom scheme with https:// for standard URL parsing
    url = new URL(uri.replace('nostr+walletconnect://', 'https://'));
  } catch {
    throw new Error('Invalid NWC URI: malformed URL structure');
  }

  const walletPubkey = url.hostname;
  if (!walletPubkey || !/^[0-9a-f]{64}$/i.test(walletPubkey)) {
    throw new Error('Invalid NWC URI: wallet pubkey must be a 64-character hex string');
  }

  const relayUrl = url.searchParams.get('relay');
  if (!relayUrl) {
    throw new Error('Invalid NWC URI: missing relay parameter');
  }
  if (!relayUrl.startsWith('wss://') && !relayUrl.startsWith('ws://')) {
    throw new Error('Invalid NWC URI: relay must be a WebSocket URL (wss:// or ws://)');
  }

  const secret = url.searchParams.get('secret');
  if (!secret || secret.length < 32) {
    throw new Error('Invalid NWC URI: missing or too-short secret parameter');
  }

  return { walletPubkey, relayUrl, secret };
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function metaToConnection(meta: ConnectionMeta): NwcConnection {
  return {
    id: meta.id,
    label: meta.label,
    relayUrl: meta.relayUrl,
    walletPubkey: meta.walletPubkey,
    connectionSecret: '',
    createdAt: meta.createdAt,
    isDefault: meta.isDefault,
    lastKnownBalance: meta.lastKnownBalance !== undefined
      ? BigInt(meta.lastKnownBalance)
      : undefined,
    lastBalanceUpdate: meta.lastBalanceUpdate,
    supportedMethods: meta.supportedMethods,
  };
}


// ---------------------------------------------------------------------------
// NwcConnectionManager
// ---------------------------------------------------------------------------

/**
 * Manages NWC (Nostr Wallet Connect) connections and provides a high-level
 * API for Lightning wallet operations.
 *
 * All operations use the NIP-47 protocol:
 * - Requests are encrypted with NIP-44 to the wallet pubkey
 * - Responses are encrypted back to the client's connection secret pubkey
 * - Events are relayed through the wallet's relay URL
 *
 * Connection secrets are stored exclusively in the OPFS Vault.
 * Connection metadata (non-secret) is cached in IndexedDB.
 *
 * @example
 * ```typescript
 * const manager = new NwcConnectionManager(vault);
 * const id = await manager.addConnection('My Wallet', 'nostr+walletconnect://...');
 * const balance = await manager.getBalance(id);
 * ```
 */
export class NwcConnectionManager {
  /**
   * @param vault - OPFS Vault instance for storing connection secrets.
   *   The vault must be unlocked before calling any operation.
   */
  constructor(private readonly vault: Vault) {}

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  /**
   * Parse a NWC URI and add the connection.
   *
   * The full URI (including the connection secret) is stored in the OPFS Vault
   * at `nwc/{connectionId}.uri`. Only non-secret metadata (label, relay URL,
   * wallet pubkey) is stored in IndexedDB.
   *
   * If this is the first connection being added, it is automatically set as
   * the default.
   *
   * @param label - Human-readable label for this connection (e.g. "Alby Hub")
   * @param nwcUri - Full NWC URI (nostr+walletconnect://...)
   * @returns The new connection's UUID
   * @throws {Error} if the URI is malformed
   * @throws {VaultError.VaultLocked} if the vault is locked
   */
  async addConnection(label: string, nwcUri: string): Promise<string> {
    const parsed = parseNwcUri(nwcUri);

    // Generate a UUID for this connection
    const id = crypto.randomUUID();

    // Store the full URI (with secret) in the OPFS Vault
    await this.vault.storeNwcUri(id, nwcUri);

    // Determine if this should be the default connection
    const existing = await metaGetAll();
    const isDefault = existing.length === 0;

    // Clear existing default if this one is becoming default
    if (isDefault) {
      for (const conn of existing) {
        if (conn.isDefault) {
          await metaPut({ ...conn, isDefault: false });
        }
      }
    }

    const meta: ConnectionMeta = {
      id,
      label: label.trim() || 'Unnamed Wallet',
      relayUrl: parsed.relayUrl,
      walletPubkey: parsed.walletPubkey,
      createdAt: Math.floor(Date.now() / 1000),
      isDefault,
    };

    await metaPut(meta);
    return id;
  }

  /**
   * Remove a connection and delete its secret from the vault.
   *
   * If the removed connection was the default, the most recently added
   * remaining connection (if any) is promoted to default.
   *
   * @param connectionId - UUID of the connection to remove
   * @throws {VaultError.VaultLocked} if the vault is locked
   */
  async removeConnection(connectionId: string): Promise<void> {
    const meta = await metaGet(connectionId);

    // Remove from vault (fails silently if not found — vault.deleteNwcUri handles this)
    await this.vault.deleteNwcUri(connectionId);

    // Remove from IndexedDB
    await metaDelete(connectionId);

    // If this was the default connection, promote the next one
    if (meta?.isDefault) {
      const remaining = await metaGetAll();
      if (remaining.length > 0) {
        // Sort by createdAt descending, pick the most recent
        const next = remaining.sort((a, b) => b.createdAt - a.createdAt)[0];
        await metaPut({ ...next, isDefault: true } as ConnectionMeta);
      }
    }
  }

  /**
   * List all connections (metadata only — no secrets).
   *
   * @returns Array of NwcConnection objects. The `connectionSecret` field
   *   is always an empty string — retrieve it via the vault if needed.
   */
  async listConnections(): Promise<NwcConnection[]> {
    const all = await metaGetAll();
    return all.map(metaToConnection).sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get the current default connection, or null if no connections exist.
   */
  async getDefaultConnection(): Promise<NwcConnection | null> {
    const all = await metaGetAll();
    const def = all.find((c) => c.isDefault) ?? null;
    return def ? metaToConnection(def) : null;
  }

  /**
   * Set a connection as the default. Clears the default flag on all other
   * connections.
   *
   * @param connectionId - UUID of the connection to promote
   * @throws {Error} if the connection does not exist
   */
  async setDefaultConnection(connectionId: string): Promise<void> {
    const all = await metaGetAll();
    const target = all.find((c) => c.id === connectionId);
    if (!target) {
      throw new Error(`NWC connection not found: ${connectionId}`);
    }

    for (const conn of all) {
      await metaPut({ ...conn, isDefault: conn.id === connectionId } as ConnectionMeta);
    }
  }

  // -------------------------------------------------------------------------
  // Wallet operations
  // -------------------------------------------------------------------------

  /**
   * Pay a BOLT-11 invoice via NWC.
   *
   * Sends a NIP-47 `pay_invoice` request to the wallet relay and waits for
   * the encrypted response. The response contains the payment preimage,
   * confirming the payment.
   *
   * @param bolt11 - BOLT-11 Lightning invoice string
   * @param connectionId - Optional UUID; uses the default connection if omitted
   * @returns PaymentResult with preimage, payment hash, and fees
   * @throws {Error} if no connection is available or the payment fails
   */
  async payInvoice(bolt11: string, connectionId?: string): Promise<PaymentResult> {
    const connId = await this.resolveConnectionId(connectionId);
    const result = await this.sendNwcRequest('pay_invoice', { invoice: bolt11 }, connId) as {
      preimage: string;
      fees_paid?: number;
      payment_hash?: string;
    };

    const preimage = result.preimage ?? '';
    const feeMsats = BigInt(result.fees_paid ?? 0);

    // Derive payment hash from preimage if not provided by wallet
    let paymentHash = result.payment_hash ?? '';
    if (!paymentHash && preimage) {
      paymentHash = bytesToHex(sha256(hexToBytes(preimage)));
    }

    // Decode the invoice amount — fall back to 0 if we can't parse it
    let amountMsats = 0n;
    try {
      amountMsats = decodeBolt11Amount(bolt11);
    } catch {
      // non-fatal — use 0n if decoding fails
    }

    return {
      preimage,
      paymentHash,
      feeMsats,
      totalMsats: amountMsats + feeMsats,
    };
  }

  /**
   * Create a BOLT-11 invoice for receiving payment.
   *
   * Sends a NIP-47 `make_invoice` request to the wallet relay.
   *
   * @param amountMsats - Amount in millisatoshis
   * @param description - Invoice description / memo
   * @param connectionId - Optional UUID; uses the default connection if omitted
   * @returns BOLT-11 invoice string
   * @throws {Error} if no connection is available or invoice creation fails
   */
  async makeInvoice(
    amountMsats: bigint,
    description: string,
    connectionId?: string,
  ): Promise<string> {
    const connId = await this.resolveConnectionId(connectionId);
    const result = await this.sendNwcRequest(
      'make_invoice',
      { amount: Number(amountMsats), description },
      connId,
    ) as { invoice: string };

    if (!result.invoice) {
      throw new Error('NWC make_invoice: wallet returned no invoice');
    }
    return result.invoice;
  }

  /**
   * Query the wallet balance.
   *
   * Sends a NIP-47 `get_balance` request. The result is cached on the
   * connection metadata.
   *
   * @param connectionId - Optional UUID; uses the default connection if omitted
   * @returns Balance in millisatoshis
   * @throws {Error} if no connection is available
   */
  async getBalance(connectionId?: string): Promise<bigint> {
    const connId = await this.resolveConnectionId(connectionId);
    const result = await this.sendNwcRequest('get_balance', {}, connId) as {
      balance: number;
    };

    const balanceMsats = BigInt(result.balance ?? 0);

    // Cache the balance in metadata
    const meta = await metaGet(connId);
    if (meta) {
      await metaPut({
        ...meta,
        lastKnownBalance: balanceMsats.toString(),
        lastBalanceUpdate: Math.floor(Date.now() / 1000),
      });
    }

    return balanceMsats;
  }

  /**
   * Look up a payment by its payment hash.
   *
   * Sends a NIP-47 `lookup_invoice` request to the wallet relay.
   *
   * @param paymentHash - Hex-encoded SHA-256 payment hash
   * @param connectionId - Optional UUID; uses the default connection if omitted
   * @returns Invoice status including paid/unpaid state
   * @throws {Error} if no connection is available or lookup fails
   */
  async lookupInvoice(paymentHash: string, connectionId?: string): Promise<InvoiceStatus> {
    const connId = await this.resolveConnectionId(connectionId);
    const result = await this.sendNwcRequest(
      'lookup_invoice',
      { payment_hash: paymentHash },
      connId,
    ) as {
      payment_hash: string;
      invoice?: string;
      amount?: number;
      description?: string;
      paid_at?: number;
      expires_at?: number;
      settled_at?: number;
      preimage?: string;
    };

    const isPaid = !!(result.paid_at ?? result.settled_at ?? result.preimage);

    return {
      paymentHash: result.payment_hash ?? paymentHash,
      bolt11: result.invoice ?? '',
      amountMsats: BigInt(result.amount ?? 0),
      description: result.description ?? '',
      isPaid,
      paidAt: result.paid_at ?? result.settled_at,
      expiresAt: result.expires_at,
    };
  }

  /**
   * List transactions from the wallet history.
   *
   * Sends a NIP-47 `list_transactions` request with optional filters.
   *
   * @param options - Filtering options (time range, limit, type, etc.)
   * @param connectionId - Optional UUID; uses the default connection if omitted
   * @returns Array of Transaction objects in reverse chronological order
   * @throws {Error} if no connection is available
   */
  async listTransactions(options: TxListOptions, connectionId?: string): Promise<Transaction[]> {
    const connId = await this.resolveConnectionId(connectionId);

    const params: Record<string, unknown> = {};
    if (options.from !== undefined) params.from = options.from;
    if (options.until !== undefined) params.until = options.until;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    if (options.type !== undefined) params.type = options.type;
    if (options.unpaid !== undefined) params.unpaid = options.unpaid;

    const result = await this.sendNwcRequest('list_transactions', params, connId) as {
      transactions: Array<{
        type?: string;
        invoice?: string;
        description?: string;
        payment_hash?: string;
        preimage?: string;
        amount?: number;
        fees_paid?: number;
        created_at?: number;
        settled_at?: number;
        expires_at?: number;
      }>;
    };

    return (result.transactions ?? []).map((tx) => ({
      type: (tx.type === 'outgoing' ? 'outgoing' : 'incoming') as 'incoming' | 'outgoing',
      paymentHash: tx.payment_hash ?? '',
      amountMsats: BigInt(tx.amount ?? 0),
      feeMsats: tx.fees_paid !== undefined ? BigInt(tx.fees_paid) : undefined,
      description: tx.description ?? '',
      createdAt: tx.created_at ?? 0,
      settledAt: tx.settled_at,
      bolt11: tx.invoice,
      preimage: tx.preimage,
    }));
  }

  /**
   * Get wallet information including supported NIP-47 methods.
   *
   * Fetches the wallet's kind:13194 info event from the relay and caches
   * the supported methods on the connection metadata.
   *
   * @param connectionId - Optional UUID; uses the default connection if omitted
   * @returns Object containing the list of supported method names
   * @throws {Error} if no connection is available
   */
  async getInfo(connectionId?: string): Promise<{ supportedMethods: string[] }> {
    const connId = await this.resolveConnectionId(connectionId);
    const meta = await metaGet(connId);
    if (!meta) throw new Error(`NWC connection not found: ${connId}`);

    const pool = new SimplePool();
    try {
      const events = await pool.querySync(
        [meta.relayUrl],
        {
          kinds: [NWC_INFO_KIND],
          authors: [meta.walletPubkey],
          limit: 1,
        },
        { maxWait: 5000 },
      );

      const infoEvent = events[0];
      const content = infoEvent?.content ?? '';
      const supportedMethods = content
        .split(/\s+/)
        .map((m) => m.trim())
        .filter(Boolean);

      // Cache on metadata
      await metaPut({ ...meta, supportedMethods });

      return { supportedMethods };
    } finally {
      pool.close([meta.relayUrl]);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve a connection ID: return the provided ID if given, or fetch the
   * default connection's ID.
   *
   * @throws {Error} if no connectionId is given and no default exists
   */
  private async resolveConnectionId(connectionId?: string): Promise<string> {
    if (connectionId) return connectionId;
    const def = await this.getDefaultConnection();
    if (!def) {
      throw new Error(
        'No NWC connection available. Add a connection first via addConnection().',
      );
    }
    return def.id;
  }

  /**
   * Retrieve the full NWC URI from the vault, then return only the secret
   * (hex-encoded 32-byte scalar used as the client's private key).
   *
   * @param connectionId - UUID of the connection
   * @returns Hex-encoded connection secret (client private key)
   * @throws {VaultError.VaultLocked} if the vault is locked
   * @throws {VaultError.IdentityNotFound} if the connection is not in the vault
   */
  private async getConnectionSecret(connectionId: string): Promise<string> {
    const uri = await this.vault.getNwcUri(connectionId);
    const parsed = parseNwcUri(uri);
    return parsed.secret;
  }

  /**
   * Send a NIP-47 request and wait for the wallet's encrypted response.
   *
   * Protocol:
   * 1. Retrieve the connection secret from the vault
   * 2. Derive the client keypair from the secret
   * 3. Build a NIP-47 request JSON payload
   * 4. Encrypt it with NIP-44 to the wallet pubkey
   * 5. Sign and publish a kind:23194 event to the relay
   * 6. Subscribe for a kind:23195 response event
   * 7. Decrypt the response with NIP-44 using the conversation key
   * 8. Parse and return the result, or throw on error
   *
   * @param method - NIP-47 method name (e.g. "pay_invoice", "get_balance")
   * @param params - Method parameters
   * @param connectionId - UUID of the connection to use
   * @returns Parsed result from the wallet response
   * @throws {Error} on timeout, NIP-47 error code, or decryption failure
   */
  private async sendNwcRequest(
    method: string,
    params: Record<string, unknown>,
    connectionId: string,
  ): Promise<unknown> {
    const meta = await metaGet(connectionId);
    if (!meta) throw new Error(`NWC connection not found: ${connectionId}`);

    const secret = await this.getConnectionSecret(connectionId);

    // Derive client keypair from the secret
    let secretKeyBytes: Uint8Array;
    try {
      secretKeyBytes = hexToBytes(secret);
    } catch {
      throw new Error('NWC connection secret is not valid hex');
    }

    const clientPubkey = getPublicKey(secretKeyBytes);

    // Build the NIP-47 request payload
    const requestId = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const payload = JSON.stringify({
      method,
      params,
      id: requestId,
    });

    // Encrypt request with NIP-44 to the wallet pubkey
    const conversationKey = nip44.getConversationKey(secretKeyBytes, meta.walletPubkey);
    const encryptedContent = nip44.encrypt(payload, conversationKey);

    // Build and sign the kind:23194 request event
    const requestEvent = finalizeEvent(
      {
        kind: NWC_REQUEST_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', meta.walletPubkey]],
        content: encryptedContent,
      },
      secretKeyBytes,
    );

    // Send the request and wait for the response
    return new Promise<unknown>((resolve, reject) => {
      const pool = new SimplePool();
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          pool.close([meta.relayUrl]);
          reject(new Error(`NWC request timed out after ${NWC_REQUEST_TIMEOUT_MS}ms (method: ${method})`));
        }
      }, NWC_REQUEST_TIMEOUT_MS);

      // Subscribe for the response before publishing, to avoid race conditions
      const sub = pool.subscribeMany(
        [meta.relayUrl],
        {
          kinds: [NWC_RESPONSE_KIND],
          authors: [meta.walletPubkey],
          '#p': [clientPubkey],
          '#e': [requestEvent.id],
        } as import('nostr-tools').Filter,
        {
          onevent: (event) => {
            if (settled) return;

            let decrypted: string;
            try {
              decrypted = nip44.decrypt(event.content, conversationKey);
            } catch (err) {
              // Decryption failure — likely a different event, ignore
              return;
            }

            let parsed: {
              result_type?: string;
              error?: NwcError;
              result?: unknown;
            };
            try {
              parsed = JSON.parse(decrypted);
            } catch {
              return;
            }

            settled = true;
            clearTimeout(timeout);
            sub.close();
            pool.close([meta.relayUrl]);

            if (parsed.error) {
              reject(
                Object.assign(
                  new Error(`NWC error [${parsed.error.code}]: ${parsed.error.message}`),
                  { nwcError: parsed.error },
                ),
              );
            } else {
              resolve(parsed.result ?? {});
            }
          },
          onclose: (reasons) => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              reject(new Error(`NWC relay connection closed: ${reasons.join(', ')}`));
            }
          },
        },
      );

      // Publish the request event
      void Promise.all(pool.publish([meta.relayUrl], requestEvent)).catch((err: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          sub.close();
          pool.close([meta.relayUrl]);
          reject(new Error(`NWC publish failed: ${err instanceof Error ? err.message : String(err)}`));
        }
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to decode the invoice amount from a BOLT-11 string.
 * Returns 0n if the amount cannot be determined.
 *
 * This is a minimal decoder — it extracts the amount from the BOLT-11 human-
 * readable prefix without pulling in the full bolt11 library. The full library
 * is only needed for display; here we just need msats for the PaymentResult.
 *
 * @internal
 */
function decodeBolt11Amount(bolt11: string): bigint {
  // BOLT-11 format: lnbc<amount><multiplier>...
  // multipliers: m=milli, u=micro, n=nano, p=pico (of BTC)
  // 1 BTC = 100,000,000 sats = 100,000,000,000 msats
  const match = bolt11.toLowerCase().match(/^ln(?:bc|tb|bcrt)(\d+)([munp]?)1/);
  if (!match) return 0n;

  const amountStr = match[1];
  const multiplier = match[2];

  if (!amountStr) return 0n;

  const amount = BigInt(amountStr);

  // Convert to millisatoshis based on multiplier
  // 1 BTC = 1e11 msats
  switch (multiplier) {
    case 'm': return amount * 100_000_000n;         // milli-BTC → msats
    case 'u': return amount * 100_000n;             // micro-BTC → msats
    case 'n': return amount * 100n;                 // nano-BTC → msats
    case 'p': return amount / 10n;                  // pico-BTC → msats (may truncate)
    case '':  return amount * 100_000_000_000n;     // whole BTC → msats
    default:  return 0n;
  }
}

// Re-export types for convenience
export type {
  NwcConnection,
  PaymentResult,
  InvoiceStatus,
  Transaction,
  TxListOptions,
  NwcError,
};
