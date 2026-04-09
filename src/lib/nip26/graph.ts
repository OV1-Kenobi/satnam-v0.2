/**
 * @module nip26/graph
 * @description NIP-26 Delegation Graph — client-side authority traversal.
 *
 * Maintains a local directed graph of NIP-26 delegation events, enabling:
 * - Role resolution by chain traversal from a pubkey back to a Guardian
 * - Delegation chain verification at any timestamp
 * - Relay synchronization of delegation events
 * - Encrypted persistence in OPFS Vault (IndexedDB via vault)
 *
 * Graph structure: delegator → [delegatee1, delegatee2, ...]
 * Chain traversal: delegatee → delegator → ... → Guardian
 *
 * Role capability matrix is from SPECIFICATION.md §4.1.
 *
 * @see SPECIFICATION.md §4.2 — NIP-26 Delegation Events
 * @see SPECIFICATION.md §4.1 — Role Hierarchy
 */

import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';

import type { DelegationEvent, DelegationChain } from './types.js';
import { RoleType } from './types.js';
import { verifyDelegationChainAt, isDelegationCurrentlyValid } from './verify.js';
import type { VaultOps } from '../vault/types.js';

// ---------------------------------------------------------------------------
// Role Capability Matrix (from spec §4.1)
// ---------------------------------------------------------------------------

/** Role hierarchy levels (lower number = higher authority) */
const ROLE_LEVEL: Record<RoleType, number> = {
  [RoleType.Guardian]: 0,
  [RoleType.Steward]: 1,
  [RoleType.Adult]: 2,
  [RoleType.Offspring]: 3,
};

/**
 * Capability → Set of roles that have the capability.
 * Source: SPECIFICATION.md §4.1 Role Capability Matrix.
 */
const CAPABILITY_ROLES: Record<string, RoleType[]> = {
  create_group:             [RoleType.Guardian],
  add_remove_members:       [RoleType.Guardian, RoleType.Steward],
  sign_nip26_delegation:    [RoleType.Guardian, RoleType.Steward],
  modify_spending_policy:   [RoleType.Guardian, RoleType.Steward],
  spend_lightning:          [RoleType.Guardian, RoleType.Steward, RoleType.Adult],
  spend_cashu:              [RoleType.Guardian, RoleType.Steward, RoleType.Adult],
  create_agent:             [RoleType.Guardian, RoleType.Steward, RoleType.Adult],
  submit_dvm_job:           [RoleType.Guardian, RoleType.Steward, RoleType.Adult],
  receive_dvm_job:          [RoleType.Guardian, RoleType.Steward, RoleType.Adult],
  publish_nip_ca:           [RoleType.Guardian],
  revoke_nip_ca:            [RoleType.Guardian],
  register_skill:           [RoleType.Guardian, RoleType.Steward, RoleType.Adult],
  frost_initiate:           [RoleType.Guardian],
  frost_participate:        [RoleType.Guardian, RoleType.Steward],
  proof_of_life:            [RoleType.Guardian, RoleType.Steward, RoleType.Adult, RoleType.Offspring],
  export_vault_backup:      [RoleType.Guardian, RoleType.Steward, RoleType.Adult],
  spend_offspring:          [], // Requires approval — no direct capability
};

// ---------------------------------------------------------------------------
// Persistence key
// ---------------------------------------------------------------------------

const GRAPH_STORAGE_KEY = 'nip26:delegation-graph:v1';

// ---------------------------------------------------------------------------
// DelegationGraph Class
// ---------------------------------------------------------------------------

/**
 * Local NIP-26 delegation graph.
 *
 * Thread-safety: This class is designed for single-threaded browser use.
 * All mutations are synchronous; async methods are for I/O only.
 */
export class DelegationGraph {
  /**
   * Primary index: delegateePubkey → DelegationEvent[]
   * Stores all delegations received by a pubkey.
   */
  private byDelegatee: Map<string, DelegationEvent[]> = new Map();

  /**
   * Secondary index: delegatorPubkey → DelegationEvent[]
   * Stores all delegations issued by a pubkey.
   */
  private byDelegator: Map<string, DelegationEvent[]> = new Map();

  /**
   * Set of known Guardian pubkeys (pubkeys with no incoming delegation).
   */
  private guardians: Set<string> = new Set();

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  /**
   * Add a delegation event to the graph.
   * Deduplicates by (delegatorPubkey, delegateePubkey) — the latest event wins.
   *
   * @param event - Delegation event to add
   */
  addDelegation(event: DelegationEvent): void {
    // Upsert into byDelegatee index
    const delegateeList = this.byDelegatee.get(event.delegateePubkey) ?? [];
    const existingIdx = delegateeList.findIndex(
      e => e.delegatorPubkey === event.delegatorPubkey,
    );
    if (existingIdx >= 0) {
      // Replace if newer
      const existing = delegateeList[existingIdx];
      if (new Date(event.createdAt) >= new Date(existing.createdAt)) {
        delegateeList[existingIdx] = event;
      }
    } else {
      delegateeList.push(event);
    }
    this.byDelegatee.set(event.delegateePubkey, delegateeList);

    // Upsert into byDelegator index
    const delegatorList = this.byDelegator.get(event.delegatorPubkey) ?? [];
    const existingDelegatorIdx = delegatorList.findIndex(
      e => e.delegateePubkey === event.delegateePubkey,
    );
    if (existingDelegatorIdx >= 0) {
      const existing = delegatorList[existingDelegatorIdx];
      if (new Date(event.createdAt) >= new Date(existing.createdAt)) {
        delegatorList[existingDelegatorIdx] = event;
      }
    } else {
      delegatorList.push(event);
    }
    this.byDelegator.set(event.delegatorPubkey, delegatorList);
  }

  /**
   * Revoke/remove a delegation from the graph.
   *
   * @param delegatorPubkey - Hex pubkey of the delegator
   * @param delegateePubkey - Hex pubkey of the delegatee
   */
  revokeDelegation(delegatorPubkey: string, delegateePubkey: string): void {
    // Remove from byDelegatee
    const delegateeList = this.byDelegatee.get(delegateePubkey) ?? [];
    this.byDelegatee.set(
      delegateePubkey,
      delegateeList.filter(e => e.delegatorPubkey !== delegatorPubkey),
    );

    // Remove from byDelegator
    const delegatorList = this.byDelegator.get(delegatorPubkey) ?? [];
    this.byDelegator.set(
      delegatorPubkey,
      delegatorList.filter(e => e.delegateePubkey !== delegateePubkey),
    );
  }

  /**
   * Register a pubkey as a root Guardian (no incoming delegation needed).
   * Call this for the group creator pubkey.
   */
  addGuardian(pubkey: string): void {
    this.guardians.add(pubkey);
  }

  // -------------------------------------------------------------------------
  // Chain Traversal
  // -------------------------------------------------------------------------

  /**
   * Returns the delegation chain from a pubkey back to a Guardian.
   *
   * chain[0] = delegation that directly authorized the pubkey
   * chain[N-1] = Guardian's root delegation
   *
   * Returns [] if pubkey is a Guardian (no delegation needed).
   *
   * @param pubkey - Hex-encoded pubkey to trace
   */
  getChain(pubkey: string): DelegationChain {
    if (this.guardians.has(pubkey)) return [];

    const chain: DelegationChain = [];
    const visited = new Set<string>();
    let current = pubkey;

    while (true) {
      if (visited.has(current)) break; // Cycle protection
      visited.add(current);

      const delegations = this.byDelegatee.get(current) ?? [];
      if (delegations.length === 0) break; // No delegation found

      // Take the most recent valid delegation
      const validDelegations = delegations
        .filter(e => isDelegationCurrentlyValid(e.conditions))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      if (validDelegations.length === 0) break;

      const delegation = validDelegations[0];
      chain.push(delegation);

      // If delegator is a known Guardian, stop
      if (this.guardians.has(delegation.delegatorPubkey)) break;

      // Continue up the chain
      current = delegation.delegatorPubkey;
    }

    return chain;
  }

  /**
   * Returns all currently active delegations issued by a pubkey.
   *
   * @param pubkey - Hex-encoded delegator pubkey
   */
  getDelegationsFrom(pubkey: string): DelegationEvent[] {
    return (this.byDelegator.get(pubkey) ?? [])
      .filter(e => isDelegationCurrentlyValid(e.conditions));
  }

  /**
   * Returns all currently active delegations received by a pubkey.
   *
   * @param pubkey - Hex-encoded delegatee pubkey
   */
  getDelegationsTo(pubkey: string): DelegationEvent[] {
    return (this.byDelegatee.get(pubkey) ?? [])
      .filter(e => isDelegationCurrentlyValid(e.conditions));
  }

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------

  /**
   * Verify a delegation chain is cryptographically valid at a given timestamp.
   *
   * @param pubkey - Hex-encoded pubkey whose chain to verify
   * @param timestamp - Unix timestamp (seconds) to verify at
   */
  verifyChainAt(pubkey: string, timestamp: number): boolean {
    if (this.guardians.has(pubkey)) return true; // Root Guardian always valid

    const chain = this.getChain(pubkey);
    if (chain.length === 0) {
      // No chain and not a guardian — not authorized
      return false;
    }

    return verifyDelegationChainAt(chain, timestamp);
  }

  // -------------------------------------------------------------------------
  // Role Resolution
  // -------------------------------------------------------------------------

  /**
   * Infer the role of a pubkey by traversing its delegation chain.
   *
   * The role is determined by the nearest delegator's explicit role tag,
   * or inferred from the allowed kinds in the delegation conditions.
   *
   * Returns Guardian if the pubkey is a known root Guardian.
   * Returns null if no valid chain exists.
   *
   * @param pubkey - Hex-encoded pubkey to check
   */
  getRole(pubkey: string): RoleType | null {
    if (this.guardians.has(pubkey)) return RoleType.Guardian;

    const chain = this.getChain(pubkey);
    if (chain.length === 0) return null;

    const leaf = chain[0];
    if (leaf.role) return leaf.role;

    // Infer role from the delegator's role
    const delegatorRole = this.getRole(leaf.delegatorPubkey);
    if (delegatorRole === null) return null;

    // Infer delegatee role: one level below delegator
    return this._inferDelegateeRole(delegatorRole);
  }

  /**
   * Get all members of a group reachable from a Guardian.
   *
   * @param guardianPubkey - Hex-encoded Guardian pubkey
   */
  getGroupMembers(guardianPubkey: string): Array<{ pubkey: string; role: RoleType }> {
    const members: Array<{ pubkey: string; role: RoleType }> = [];
    const visited = new Set<string>();

    // BFS from Guardian
    const queue: string[] = [guardianPubkey];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const role = this.getRole(current);
      if (role !== null) {
        members.push({ pubkey: current, role });
      } else if (current === guardianPubkey) {
        members.push({ pubkey: current, role: RoleType.Guardian });
      }

      // Expand to delegatees
      const delegations = this.getDelegationsFrom(current);
      for (const d of delegations) {
        if (!visited.has(d.delegateePubkey)) {
          queue.push(d.delegateePubkey);
        }
      }
    }

    return members;
  }

  /**
   * Check if a pubkey has a specific capability based on the role matrix.
   *
   * @param pubkey - Hex-encoded pubkey to check
   * @param capability - Capability identifier (e.g., 'create_group', 'spend_lightning')
   */
  hasCapability(pubkey: string, capability: string): boolean {
    const role = this.getRole(pubkey);
    if (role === null) return false;

    const allowedRoles = CAPABILITY_ROLES[capability];
    if (!allowedRoles) return false;

    return allowedRoles.includes(role);
  }

  // -------------------------------------------------------------------------
  // Relay Sync
  // -------------------------------------------------------------------------

  /**
   * Sync delegation events from a Nostr relay.
   *
   * Queries for kind:1 events with delegation tags from the provided pubkeys.
   * Adds valid events to the local graph.
   *
   * @param relayUrl - WebSocket URL of the Nostr relay
   * @param groupPubkeys - Pubkeys to query delegation events for
   */
  async syncFromRelay(relayUrl: string, groupPubkeys: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(relayUrl);
      const subId = `nip26-sync-${Date.now()}`;
      let resolved = false;
    
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          ws.close();
          resolve(); // Don't reject on timeout — partial sync is acceptable
        }
      }, 15_000);

      ws.onopen = () => {
        // Request delegation events from the relay
        const filter = {
          kinds: [1],
          authors: groupPubkeys,
          '#t': ['delegation'],
          limit: 500,
        };
        ws.send(JSON.stringify(['REQ', subId, filter]));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (!Array.isArray(msg)) return;

          if (msg[0] === 'EVENT' && msg[1] === subId) {
            const nostrEvent = msg[2];
            const delegationEvent = this._parseNostrDelegationEvent(nostrEvent);
            if (delegationEvent) {
              this.addDelegation(delegationEvent);
            }
          } else if (msg[0] === 'EOSE' && msg[1] === subId) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              ws.close();
              resolve();
            }
          } else if (msg[0] === 'NOTICE') {
            console.debug('[DelegationGraph] Relay notice:', msg[1]);
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`WebSocket error connecting to ${relayUrl}`));
        }
      };
    });
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /**
   * Persist the delegation graph to OPFS Vault.
   *
   * Serializes the graph as JSON, encrypts under the vault master key,
   * and stores as a synthetic NFC key entry.
   *
   * @param vault - Unlocked OPFS Vault instance
   */
  async persist(vault: VaultOps): Promise<void> {
    if (!vault.isUnlocked()) {
      throw new Error('Vault must be unlocked to persist delegation graph');
    }

    const data = this._serialize();
    const json = JSON.stringify(data);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(json);

    // Store in 16-byte chunks via NFC key slots using a hash-keyed entry.
    // Real impl: vault should expose a generic raw blob store.
    // For now we store the first 16KB as k1/k2 chunks with a synthetic UID.
    // We use a SHA-256 hash as the synthetic UID for the storage key.
    const storageKey = bytesToHex(sha256(utf8ToBytes(GRAPH_STORAGE_KEY)));

    // Chunk into 16-byte blocks for vault storage
    const chunks = this._splitIntoChunks(bytes, 16);
    for (let i = 0; i < chunks.length; i += 2) {
      const syntheticUid = `${storageKey.slice(0, 14)}_${i}`;
      const lo = chunks[i] ? this._padTo16(chunks[i]) : new Uint8Array(16);
      const hi = chunks[i + 1] ? this._padTo16(chunks[i + 1]) : new Uint8Array(16);
      await vault.storeNfcKey(syntheticUid, 'k1', lo);
      await vault.storeNfcKey(syntheticUid, 'k2', hi);
    }

    // Store chunk count metadata
    const meta = new Uint8Array(16);
    new DataView(meta.buffer).setUint32(0, Math.ceil(chunks.length / 2), true);
    await vault.storeNfcKey(storageKey.slice(0, 14) + '_meta', 'k1', meta);
  }

  /**
   * Load the delegation graph from OPFS Vault.
   *
   * @param vault - Unlocked OPFS Vault instance
   */
  async load(vault: VaultOps): Promise<void> {
    if (!vault.isUnlocked()) {
      throw new Error('Vault must be unlocked to load delegation graph');
    }

    try {
      const storageKey = bytesToHex(sha256(utf8ToBytes(GRAPH_STORAGE_KEY)));
      const metaKey = storageKey.slice(0, 14) + '_meta';
      const meta = await vault.getNfcKey(metaKey, 'k1');
      const chunkPairCount = new DataView(meta.buffer).getUint32(0, true);

      const allBytes: Uint8Array[] = [];
      for (let i = 0; i < chunkPairCount; i++) {
        const syntheticUid = `${storageKey.slice(0, 14)}_${i * 2}`;
        const lo = await vault.getNfcKey(syntheticUid, 'k1');
        const hi = await vault.getNfcKey(syntheticUid, 'k2');
        allBytes.push(lo, hi);
      }

      const fullBytes = this._mergeChunks(allBytes);
      const json = new TextDecoder().decode(fullBytes);
      this._deserialize(JSON.parse(json));
    } catch {
      // No saved graph — start fresh
    }
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  private _serialize(): { delegations: DelegationEvent[]; guardians: string[] } {
    const delegations: DelegationEvent[] = [];
    for (const list of this.byDelegatee.values()) {
      delegations.push(...list);
    }
    return {
      delegations,
      guardians: Array.from(this.guardians),
    };
  }

  private _deserialize(data: { delegations: DelegationEvent[]; guardians: string[] }): void {
    this.byDelegatee = new Map();
    this.byDelegator = new Map();
    this.guardians = new Set(data.guardians ?? []);
    for (const event of data.delegations ?? []) {
      this.addDelegation(event);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _inferDelegateeRole(delegatorRole: RoleType): RoleType | null {
    switch (delegatorRole) {
      case RoleType.Guardian: return RoleType.Steward;
      case RoleType.Steward: return RoleType.Adult;
      case RoleType.Adult: return RoleType.Offspring;
      case RoleType.Offspring: return null; // Offspring cannot delegate
    }
  }

  /**
   * Parse a Nostr event (kind:1 with delegation tag) into a DelegationEvent.
   */
  private _parseNostrDelegationEvent(event: {
    kind: number;
    pubkey: string;
    created_at: number;
    tags: string[][];
    id?: string;
  }): DelegationEvent | null {
    try {
      if (event.kind !== 1) return null;

      const delegationTag = event.tags.find(t => t[0] === 'delegation');
      if (!delegationTag || delegationTag.length < 4) return null;

      const roleTag = event.tags.find(t => t[0] === 'role');
      const role = roleTag?.[1] as RoleType | undefined;

      const [, delegatorPubkey, conditions, signature] = delegationTag;

      return {
        delegateePubkey: event.pubkey,
        delegatorPubkey,
        conditions,
        signature,
        role: role && Object.values(RoleType).includes(role) ? role : undefined,
        createdAt: new Date(event.created_at * 1000).toISOString(),
        nostrEventId: event.id,
      };
    } catch {
      return null;
    }
  }

  private _splitIntoChunks(bytes: Uint8Array, size: number): Uint8Array[] {
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += size) {
      chunks.push(bytes.slice(i, i + size));
    }
    return chunks;
  }

  private _padTo16(chunk: Uint8Array): Uint8Array {
    if (chunk.length === 16) return chunk;
    const padded = new Uint8Array(16);
    padded.set(chunk);
    return padded;
  }

  private _mergeChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    // Trim trailing null bytes
    let end = merged.length;
    while (end > 0 && merged[end - 1] === 0) end--;
    return merged.slice(0, end);
  }

  // -------------------------------------------------------------------------
  // Graph inspection (debug)
  // -------------------------------------------------------------------------

  /** Total number of delegation events in the graph. */
  get size(): number {
    let count = 0;
    for (const list of this.byDelegatee.values()) count += list.length;
    return count;
  }

  /** All pubkeys known to the graph. */
  get allPubkeys(): string[] {
    const pubkeys = new Set<string>();
    for (const [k, list] of this.byDelegatee) {
      pubkeys.add(k);
      for (const e of list) pubkeys.add(e.delegatorPubkey);
    }
    for (const g of this.guardians) pubkeys.add(g);
    return Array.from(pubkeys);
  }
}

