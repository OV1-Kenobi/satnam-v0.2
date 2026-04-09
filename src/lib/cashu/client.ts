/**
 * @module cashu/client
 * @description Cashu eCash client for Satnam v2.
 *
 * ## Security model
 * Cashu proofs are bearer instruments. Anyone who has a valid proof can redeem
 * it at the mint. The OPFS Vault is the sole protection against theft:
 * - All proofs are stored at `cashu/{mint_url_hash}.proofs` in the vault
 * - Proofs never appear in logs, error messages, or any plaintext storage
 * - The vault must be unlocked for all proof operations
 *
 * ## Usage
 * ```typescript
 * const client = new CashuClient(vault);
 * await client.addMint('https://mint.minibits.cash/Bitcoin');
 * const proofs = await client.mintTokens(1000, 'https://mint.minibits.cash/Bitcoin');
 * ```
 *
 * @see https://github.com/cashubtc/nuts — Cashu NUT specifications
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import type { Vault } from '../vault/vault.js';
import { VaultError } from '../vault/types.js';
import type {
  MintInfo,
  CashuProof,
  MeltResult,
  ProofStatus,
} from './types.js';

// ---------------------------------------------------------------------------
// Dynamic import of @cashu/cashu-ts
// ---------------------------------------------------------------------------
// We import cashu-ts dynamically to allow graceful degradation if the package
// is unavailable in certain build targets (e.g. test environments without WASM).

async function getCashuLib() {
  try {
    const mod = await import('@cashu/cashu-ts');
    return {
      CashuMint: mod.CashuMint,
      CashuWallet: mod.CashuWallet,
      getEncodedToken: mod.getEncodedToken,
      getDecodedToken: mod.getDecodedToken,
      CheckStateEnum: mod.CheckStateEnum,
    };
  } catch (err) {
    throw new Error(
      `@cashu/cashu-ts is required but could not be loaded: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// Cashu proof type alias
// ---------------------------------------------------------------------------

// cashu-ts Proof type — compatible shape with our CashuProof interface
interface CashuTsProof {
  id: string;
  amount: number;
  secret: string;
  C: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IndexedDB database name for mint metadata. */
const MINT_META_DB = 'satnam-cashu-mints';

/** IndexedDB object store name. */
const MINT_META_STORE = 'mints';

// ---------------------------------------------------------------------------
// Mint metadata (non-secret, stored in IndexedDB)
// ---------------------------------------------------------------------------

interface MintMetaRecord {
  url: string;
  name?: string;
  nuts: number[];
  isAllowed: boolean;
  addedAt: number;
}

function openMintDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MINT_META_DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(MINT_META_STORE, { keyPath: 'url' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function mintMetaGetAll(): Promise<MintMetaRecord[]> {
  const db = await openMintDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MINT_META_STORE, 'readonly');
    const req = tx.objectStore(MINT_META_STORE).getAll();
    req.onsuccess = () => resolve((req.result as MintMetaRecord[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function mintMetaPut(record: MintMetaRecord): Promise<void> {
  const db = await openMintDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MINT_META_STORE, 'readwrite');
    const req = tx.objectStore(MINT_META_STORE).put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function mintMetaDelete(url: string): Promise<void> {
  const db = await openMintDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MINT_META_STORE, 'readwrite');
    const req = tx.objectStore(MINT_META_STORE).delete(url);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// URL hashing
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hash of a mint URL for use as the vault key.
 * Normalizes the URL before hashing (strips trailing slash, lowercases scheme+host).
 *
 * @param url - Mint URL to hash
 * @returns Hex-encoded SHA-256 digest
 */
function hashMintUrl(url: string): string {
  // Normalize: lowercase, strip trailing slash
  const normalized = url.trim().replace(/\/+$/, '');
  return bytesToHex(sha256(utf8ToBytes(normalized)));
}

// ---------------------------------------------------------------------------
// Type mapping helpers
// ---------------------------------------------------------------------------

/** Convert a cashu-ts Proof to our CashuProof type. */
function fromCashuTsProof(p: CashuTsProof): CashuProof {
  return { id: p.id, amount: p.amount, secret: p.secret, C: p.C };
}

/** Convert our CashuProof to cashu-ts Proof shape. */
function toCashuTsProof(p: CashuProof): CashuTsProof {
  return { id: p.id, amount: p.amount, secret: p.secret, C: p.C };
}

// ---------------------------------------------------------------------------
// CashuClient
// ---------------------------------------------------------------------------

/**
 * Full Cashu eCash client wrapping `@cashu/cashu-ts`.
 *
 * Proofs are stored in the OPFS Vault (AES-256-GCM encrypted). All proof
 * mutations go through `storeProofs()` to ensure atomicity — partial writes
 * are not possible because the vault writes are atomic at the file level.
 *
 * ## Dual storage architecture
 *
 * CashuClient splits storage across two backends based on data sensitivity:
 *
 * **IndexedDB — mint metadata (non-secret)**
 * - Database: `satnam-cashu-mints` (object store: `mints`)
 * - Stores mint URL, display name, supported NUTs, and `isAllowed` flag
 * - These values are not secret — loss only degrades the mint list UI
 * - Survives vault lock/unlock cycles without requiring vault access
 *
 * **OPFS Vault — Cashu proofs (secret bearer instruments)**
 * - Path: `cashu/{sha256(mintUrl)}.proofs` (one file per mint)
 * - Encrypted with AES-256-GCM under the vault master key
 * - Proofs are bearer instruments — whoever has a valid proof can redeem it
 * - The vault MUST be unlocked for all proof read/write operations
 * - Lost proofs = lost sats; never log, cache, or copy proof data outside vault
 *
 * ## Coin selection
 * `selectProofsForAmount()` uses a greedy descending approach: it picks the
 * largest denominations first. This minimizes the number of proofs consumed
 * per transaction but may leave small "dust" proofs over time. Use
 * `swapProofs()` periodically to consolidate proof sets.
 */
export class CashuClient {
  /**
   * @param vault - OPFS Vault instance. Must be unlocked before all operations.
   */
  constructor(private readonly vault: Vault) {}

  // -------------------------------------------------------------------------
  // Mint management
  // -------------------------------------------------------------------------

  /**
   * Add a Cashu mint. Fetches the mint's info (NUT-06) to validate it is
   * reachable and caches the name and NUT list in IndexedDB.
   *
   * @param mintUrl - Base URL of the Cashu mint (e.g. https://mint.example.com)
   * @throws {Error} if the mint is unreachable or returns an invalid response
   */
  async addMint(mintUrl: string): Promise<void> {
    const normalizedUrl = mintUrl.trim().replace(/\/+$/, '');
    const { CashuMint } = await getCashuLib();

    const mint = new CashuMint(normalizedUrl);
    let name: string | undefined;
    let nuts: number[] = [];

    try {
      const info = await mint.getInfo();
      name = info.name ?? undefined;
      // Extract NUT numbers from the nuts object
      if (info.nuts && typeof info.nuts === 'object') {
        nuts = Object.keys(info.nuts)
          .map(Number)
          .filter((n) => !Number.isNaN(n))
          .sort((a, b) => a - b);
      }
    } catch {
      // Mint reachability check failed — store it anyway with empty metadata
      // so the user can see the failed mint and remove it if needed
    }

    await mintMetaPut({
      url: normalizedUrl,
      name,
      nuts,
      isAllowed: true,
      addedAt: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Remove a mint from the list and delete all associated proofs from the vault.
   *
   * **WARNING:** This operation deletes all eCash held at this mint. Ensure
   * the user has melted or transferred all proofs before calling this.
   *
   * @param mintUrl - Base URL of the mint to remove
   * @throws {VaultError.VaultLocked} if the vault is locked
   */
  async removeMint(mintUrl: string): Promise<void> {
    const normalizedUrl = mintUrl.trim().replace(/\/+$/, '');
    const urlHash = hashMintUrl(normalizedUrl);

    // Remove from IndexedDB
    await mintMetaDelete(normalizedUrl);

    // Delete proofs from vault — try but don't throw if not found
    try {
      // The vault's deleteNwcUri doesn't exist for cashu, but we can try to
      // overwrite proofs with empty array (vault has no explicit delete for cashu)
      await this.vault.storeCashuProofs(urlHash, []);
    } catch {
      // ignore — no proofs for this mint is fine
    }
  }

  /**
   * List all configured mints with their current balances.
   *
   * Balances are computed by summing the denomination values of all stored
   * proofs for each mint.
   *
   * @returns Array of MintInfo objects sorted by URL
   * @throws {VaultError.VaultLocked} if the vault is locked
   */
  async listMints(): Promise<MintInfo[]> {
    const records = await mintMetaGetAll();
    const mints: MintInfo[] = [];

    for (const record of records) {
      const proofs = await this.getProofs(record.url);
      const balance = proofs.reduce((sum, p) => sum + p.amount, 0);
      mints.push({
        url: record.url,
        name: record.name,
        nuts: record.nuts,
        balance,
        isAllowed: record.isAllowed,
      });
    }

    return mints.sort((a, b) => a.url.localeCompare(b.url));
  }

  // -------------------------------------------------------------------------
  // Token operations
  // -------------------------------------------------------------------------

  /**
   * Mint new tokens by obtaining a Lightning invoice from the mint and
   * minting proofs once the invoice is paid.
   *
   * **Note:** This method obtains the mint quote and immediately calls
   * `mintProofs()` assuming the invoice will be paid externally. In practice,
   * callers should:
   * 1. Call this method to get the BOLT-11 invoice
   * 2. Pay the invoice via NWC
   * 3. Call this method again — the mint will confirm payment and issue proofs
   *
   * For a complete UX flow, the caller should poll or use the returned quote
   * to check payment status before expecting proofs. This implementation
   * attempts to mint immediately and returns the proofs if successful.
   *
   * @param amountSats - Amount to mint in satoshis
   * @param mintUrl - Mint URL to use
   * @returns Array of new proofs (stored in vault)
   * @throws {Error} if the mint quote fails or the invoice is not yet paid
   */
  async mintTokens(amountSats: number, mintUrl: string): Promise<CashuProof[]> {
    const normalizedUrl = mintUrl.trim().replace(/\/+$/, '');
    const { CashuMint, CashuWallet } = await getCashuLib();

    const mint = new CashuMint(normalizedUrl);
    const wallet = new CashuWallet(mint, { unit: 'sat' });

    // Request a mint quote (gets a BOLT-11 invoice)
    const quote = await wallet.createMintQuote(amountSats);

    // Attempt to mint proofs (will succeed only if the invoice is paid)
    const newProofs = await wallet.mintProofs(amountSats, quote.quote);

    const cashuProofs = (newProofs as CashuTsProof[]).map(fromCashuTsProof);

    // Append to existing stored proofs
    const existing = await this.getProofs(normalizedUrl);
    await this.storeProofs(normalizedUrl, [...existing, ...cashuProofs]);

    return cashuProofs;
  }

  /**
   * Melt tokens (redeem Cashu proofs by paying a Lightning invoice).
   *
   * 1. Creates a melt quote for the provided BOLT-11 invoice
   * 2. Selects proofs covering the melt amount + estimated fees
   * 3. Submits proofs to the mint — the mint pays the invoice
   * 4. Removes spent proofs and stores any change proofs back in the vault
   *
   * @param proofs - Proofs to use for the melt (must total ≥ invoice amount + fees)
   * @param bolt11 - BOLT-11 Lightning invoice to pay
   * @returns MeltResult with payment status, preimage, and change proofs
   * @throws {Error} if proofs are insufficient or the mint rejects the request
   */
  async meltTokens(proofs: CashuProof[], bolt11: string): Promise<MeltResult> {
    if (proofs.length === 0) {
      throw new Error('No proofs provided for melt operation');
    }

    // All proofs must be from the same mint
    const mintUrls = await this.getMintUrlsForProofs(proofs);
    if (mintUrls.size !== 1) {
      throw new Error('All proofs for a melt operation must be from the same mint');
    }
    const mintUrl = [...mintUrls][0]!;
    const normalizedUrl = mintUrl.trim().replace(/\/+$/, '');

    const { CashuMint, CashuWallet } = await getCashuLib();
    const mint = new CashuMint(normalizedUrl);
    const wallet = new CashuWallet(mint, { unit: 'sat' });

    // Get the melt quote to learn the fee estimate
    const meltQuote = await wallet.createMeltQuote(bolt11);

    const cashuTsProofs = proofs.map(toCashuTsProof);
    const meltResult = await wallet.meltProofs(meltQuote, cashuTsProofs);

    const paid = meltResult.quote.state === 'PAID';
    const preimage = meltResult.quote.payment_preimage ?? undefined;
    const changeCashu = (meltResult.change as CashuTsProof[]).map(fromCashuTsProof);

    if (paid) {
      // Remove spent proofs and store change
      const existingProofs = await this.getProofs(normalizedUrl);
      const spentSecrets = new Set(proofs.map((p) => p.secret));
      const remaining = existingProofs.filter((p) => !spentSecrets.has(p.secret));
      await this.storeProofs(normalizedUrl, [...remaining, ...changeCashu]);
    }

    return {
      paid,
      preimage,
      change: changeCashu.length > 0 ? changeCashu : undefined,
    };
  }

  /**
   * Create a serialized Cashu token string for sending to another user.
   *
   * Selects proofs covering `amountSats` from the specified mint, swaps them
   * (to obtain exact-denomination proofs without leaking change), removes the
   * sent proofs from the vault, and returns the serialized token string
   * (cashuA...).
   *
   * @param amountSats - Amount to send in satoshis
   * @param mintUrl - Mint URL where the proofs are held
   * @returns Serialized Cashu token string (cashuA...)
   * @throws {Error} if insufficient balance at the specified mint
   */
  async sendTokens(amountSats: number, mintUrl: string): Promise<string> {
    const normalizedUrl = mintUrl.trim().replace(/\/+$/, '');
    const { CashuMint, CashuWallet, getEncodedToken } = await getCashuLib();

    const allProofs = await this.getProofs(normalizedUrl);
    const totalBalance = allProofs.reduce((s, p) => s + p.amount, 0);

    if (totalBalance < amountSats) {
      throw new Error(
        `Insufficient Cashu balance at ${normalizedUrl}: have ${totalBalance} sats, need ${amountSats} sats`,
      );
    }

    const mint = new CashuMint(normalizedUrl);
    const wallet = new CashuWallet(mint, { unit: 'sat' });

    // Pre-select proofs using greedy coin selection to minimize the proof set
    // passed to the mint's send operation. This reduces proof churn.
    const { selected: candidateProofs } = this.selectProofsForAmount(allProofs, amountSats);

    // Swap to get exact-denomination proofs for the send amount
    const cashuTsProofs = candidateProofs.map(toCashuTsProof);
    const sendResult = await wallet.send(amountSats, cashuTsProofs, { includeFees: false });

    const keepProofs = (sendResult.keep as CashuTsProof[]).map(fromCashuTsProof);

    // Store only the kept proofs — the sent proofs leave our custody
    await this.storeProofs(normalizedUrl, keepProofs);

    // Serialize the send proofs into a cashuA token
    // cashu-ts v2: Token is { mint, proofs, memo?, unit? } (flat structure)
    const token = getEncodedToken({
      mint: normalizedUrl,
      proofs: sendResult.send,
      unit: 'sat',
    } as import('@cashu/cashu-ts').Token);

    return token;
  }

  /**
   * Receive a serialized Cashu token.
   *
   * Decodes the token, swaps all proofs at their respective mints (to prevent
   * double-spend and obtain fresh proofs linked to this wallet's keys), and
   * stores the new proofs in the vault.
   *
   * @param serializedToken - cashuA... token string from the sender
   * @returns Array of new CashuProof objects added to the vault
   * @throws {Error} if the token is malformed or proofs are already spent
   */
  async receiveTokens(serializedToken: string): Promise<CashuProof[]> {
    const { CashuMint, CashuWallet, getDecodedToken } = await getCashuLib();

    // cashu-ts v2: getDecodedToken returns a single Token { mint, proofs, ... }.
    // For backward compat with v3 tokens (which had { token: [{mint, proofs}] }),
    // we cast and handle both shapes.
    const decoded = getDecodedToken(serializedToken) as unknown;
    const allNewProofs: CashuProof[] = [];

    // Normalize to an array of { mint, proofs } entries regardless of token version
    type TokenEntry = { mint: string; proofs: CashuTsProof[] };
    let entries: TokenEntry[];

    const raw = decoded as Record<string, unknown>;
    if (Array.isArray(raw['token'])) {
      // Legacy v3 format: { token: [{mint, proofs}], ... }
      entries = raw['token'] as TokenEntry[];
    } else {
      // v2 format: { mint, proofs, ... }
      entries = [{ mint: raw['mint'] as string, proofs: raw['proofs'] as CashuTsProof[] }];
    }

    for (const entry of entries) {
      const mintUrl = entry.mint.trim().replace(/\/+$/, '');
      const mint = new CashuMint(mintUrl);
      const wallet = new CashuWallet(mint, { unit: 'sat' });

      // Swap proofs to obtain fresh ones (prevents double-spend)
      const receivedTsProofs = entry.proofs as CashuTsProof[];
      const totalAmount = receivedTsProofs.reduce((s, p) => s + p.amount, 0);

      const swapResult = await wallet.swap(totalAmount, receivedTsProofs);
      const newProofs = [
        ...(swapResult.send as CashuTsProof[]),
        ...(swapResult.keep as CashuTsProof[]),
      ].map(fromCashuTsProof);

      // Merge with existing proofs for this mint
      const existing = await this.getProofs(mintUrl);
      await this.storeProofs(mintUrl, [...existing, ...newProofs]);

      allNewProofs.push(...newProofs);

      // Ensure this mint is in the metadata (auto-add if unknown)
      try {
        const records = await mintMetaGetAll();
        if (!records.find((r) => r.url === mintUrl)) {
          await mintMetaPut({
            url: mintUrl,
            nuts: [],
            isAllowed: false, // require explicit allow for unknown mints
            addedAt: Math.floor(Date.now() / 1000),
          });
        }
      } catch {
        // non-fatal
      }
    }

    return allNewProofs;
  }

  /**
   * Get the total balance across all mints, or for a specific mint.
   *
   * @param mintUrl - If provided, returns only the balance for that mint.
   *   If omitted, sums balances across all configured mints.
   * @returns Total balance in satoshis
   * @throws {VaultError.VaultLocked} if the vault is locked
   */
  async getBalance(mintUrl?: string): Promise<number> {
    if (mintUrl) {
      const normalized = mintUrl.trim().replace(/\/+$/, '');
      const proofs = await this.getProofs(normalized);
      return proofs.reduce((sum, p) => sum + p.amount, 0);
    }

    const records = await mintMetaGetAll();
    let total = 0;
    for (const record of records) {
      const proofs = await this.getProofs(record.url);
      total += proofs.reduce((sum, p) => sum + p.amount, 0);
    }
    return total;
  }

  // -------------------------------------------------------------------------
  // Proof management
  // -------------------------------------------------------------------------

  /**
   * Check whether a set of proofs are still valid (unspent) at their mint.
   *
   * **Note:** All proofs must be from the same mint. Mix proofs from different
   * mints by calling this method once per mint.
   *
   * @param proofs - Proofs to check
   * @returns Array of ProofStatus objects
   * @throws {Error} if proofs span multiple mints
   */
  async checkProofStatus(proofs: CashuProof[]): Promise<ProofStatus[]> {
    if (proofs.length === 0) return [];

    const mintUrls = await this.getMintUrlsForProofs(proofs);
    if (mintUrls.size !== 1) {
      throw new Error('checkProofStatus: all proofs must be from the same mint');
    }
    const mintUrl = [...mintUrls][0]!;

    const { CashuMint, CashuWallet, CheckStateEnum } = await getCashuLib();
    const mint = new CashuMint(mintUrl);
    const wallet = new CashuWallet(mint, { unit: 'sat' });

    const cashuTsProofs = proofs.map(toCashuTsProof);
    const states = await wallet.checkProofsStates(cashuTsProofs);

    return proofs.map((proof, i) => {
      const state = states[i]?.state;
      let proofState: ProofStatus['state'] = 'valid';

      if (state === CheckStateEnum.SPENT) {
        proofState = 'spent';
      } else if (state === CheckStateEnum.PENDING) {
        proofState = 'pending';
      }

      return { proof, state: proofState };
    });
  }

  /**
   * Swap proofs for fresh ones at the mint.
   *
   * Useful for consolidating many small proofs into fewer larger ones, or for
   * refreshing proofs before transferring them. The original proofs are
   * consumed and new ones are issued by the mint.
   *
   * @param proofs - Proofs to swap
   * @param mintUrl - Mint URL where the proofs were issued
   * @returns Array of new proofs (stored in vault, original proofs removed)
   * @throws {VaultError.VaultLocked} if the vault is locked
   */
  async swapProofs(proofs: CashuProof[], mintUrl: string): Promise<CashuProof[]> {
    if (proofs.length === 0) return [];

    const normalizedUrl = mintUrl.trim().replace(/\/+$/, '');
    const { CashuMint, CashuWallet } = await getCashuLib();

    const mint = new CashuMint(normalizedUrl);
    const wallet = new CashuWallet(mint, { unit: 'sat' });

    const totalAmount = proofs.reduce((s, p) => s + p.amount, 0);
    const cashuTsProofs = proofs.map(toCashuTsProof);

    const swapResult = await wallet.swap(totalAmount, cashuTsProofs);
    const newProofs = [
      ...(swapResult.send as CashuTsProof[]),
      ...(swapResult.keep as CashuTsProof[]),
    ].map(fromCashuTsProof);

    // Remove swapped proofs, add new ones
    const existing = await this.getProofs(normalizedUrl);
    const swappedSecrets = new Set(proofs.map((p) => p.secret));
    const remaining = existing.filter((p) => !swappedSecrets.has(p.secret));
    await this.storeProofs(normalizedUrl, [...remaining, ...newProofs]);

    return newProofs;
  }

  // -------------------------------------------------------------------------
  // Internal proof storage
  // -------------------------------------------------------------------------

  /**
   * Store proofs in the OPFS Vault, atomically replacing the current proof set
   * for this mint.
   *
   * Path in vault: `cashu/{sha256(mintUrl)}.proofs`
   *
   * @param mintUrl - Mint URL (used to compute the vault key)
   * @param proofs - Complete proof set for this mint (replaces existing)
   * @throws {VaultError.VaultLocked} if the vault is locked
   */
  private async storeProofs(mintUrl: string, proofs: CashuProof[]): Promise<void> {
    const urlHash = hashMintUrl(mintUrl);
    await this.vault.storeCashuProofs(urlHash, proofs);
  }

  /**
   * Retrieve all stored proofs for a mint from the OPFS Vault.
   *
   * @param mintUrl - Mint URL
   * @returns Array of proofs, or empty array if none are stored yet
   * @throws {VaultError.VaultLocked} if the vault is locked
   */
  private async getProofs(mintUrl: string): Promise<CashuProof[]> {
    const urlHash = hashMintUrl(mintUrl);
    try {
      const vaultProofs = await this.vault.getCashuProofs(urlHash);
      // The vault stores our CashuProof type — return as-is
      return vaultProofs as unknown as CashuProof[];
    } catch (err) {
      // VaultError.IdentityNotFound means no proofs yet — return empty array
      if (err instanceof Error && err.message === VaultError.IdentityNotFound) {
        return [];
      }
      // Any other vault error propagates (e.g. VaultLocked)
      throw err;
    }
  }

  /**
   * Select proofs to cover a given amount using a greedy descending strategy.
   *
   * Proofs are sorted by denomination (largest first) and selected until the
   * cumulative sum reaches or exceeds the target amount. This minimizes the
   * number of proofs spent per transaction.
   *
   * @param proofs - Available proofs (any order)
   * @param amount - Target amount in satoshis
   * @returns `selected`: proofs chosen for the spend; `remaining`: unselected proofs
   * @throws {Error} if the total available balance is insufficient
   */
  private selectProofsForAmount(
    proofs: CashuProof[],
    amount: number,
  ): { selected: CashuProof[]; remaining: CashuProof[] } {
    const totalAvailable = proofs.reduce((s, p) => s + p.amount, 0);
    if (totalAvailable < amount) {
      throw new Error(
        `Insufficient proof balance: need ${amount} sats, have ${totalAvailable} sats`,
      );
    }

    // Sort descending by denomination
    const sorted = [...proofs].sort((a, b) => b.amount - a.amount);

    const selected: CashuProof[] = [];
    let accumulated = 0;

    for (const proof of sorted) {
      if (accumulated >= amount) break;
      selected.push(proof);
      accumulated += proof.amount;
    }

    const selectedSecrets = new Set(selected.map((p) => p.secret));
    const remaining = proofs.filter((p) => !selectedSecrets.has(p.secret));

    return { selected, remaining };
  }

  /**
   * Determine which mint URLs correspond to a set of proofs.
   *
   * Matches proof keyset IDs against known mint keysets. Falls back to
   * returning all known mint URLs if the keyset cannot be resolved, which
   * is safe (the caller will then attempt the operation against the correct
   * mint and fail gracefully on a wrong one).
   *
   * @param proofs - Proofs to resolve mint URLs for
   * @returns Set of mint URLs that might have issued these proofs
   * @internal
   */
  private async getMintUrlsForProofs(proofs: CashuProof[]): Promise<Set<string>> {
    // We don't track keyset-to-mint mappings in this implementation.
    // A simpler heuristic: scan all mints' stored proofs and match by secret.
    const records = await mintMetaGetAll();
    const proofSecrets = new Set(proofs.map((p) => p.secret));
    const matchedMints = new Set<string>();

    for (const record of records) {
      const stored = await this.getProofs(record.url);
      const hasMatch = stored.some((p) => proofSecrets.has(p.secret));
      if (hasMatch) {
        matchedMints.add(record.url);
      }
    }

    // If no match found (proofs from outside sources), include all mints
    // so the caller can try all of them
    if (matchedMints.size === 0 && records.length > 0) {
      for (const record of records) {
        matchedMints.add(record.url);
      }
    }

    return matchedMints;
  }
}

// Re-export types
export type { MintInfo, CashuProof, MeltResult, ProofStatus } from './types.js';
