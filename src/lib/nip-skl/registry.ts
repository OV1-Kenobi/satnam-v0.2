// Ported from v1 src/lib/nip-skl/registry.ts
// Stripped: Supabase import (supabase client), getFromSupabase(), dbRowToManifest()
//   (Supabase is still used as read-only cache for skill_manifests, but v2 reads
//   it via a Netlify function — not directly from the browser client)
// v2: IndexedDB is the primary offline cache; relay subscription via CEPS
//   Import path updated: types/nip-skl → ./types

/**
 * NIP-SKL Skill Registry — IndexedDB Cache with Relay Subscription
 *
 * v2 architecture:
 * - Primary: IndexedDB (offline-capable, TTL-based)
 * - Relay subscription: CEPS subscribeWithCeps() for live updates
 * - No direct Supabase reads from browser (Supabase is server-side only in v2)
 */

import type { SkillManifest, SkillRegistryCacheEntry } from "./types";
import { parseManifestContent, validateManifest } from "./manifest";

const DB_NAME = "satnam-skill-registry";
const DB_VERSION = 1;
const STORE_NAME = "manifests";
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

export class SkillRegistryCache {
  private db: IDBDatabase | null = null;
  private lastSyncTimestamp: number = 0;
  private eventListeners: Map<string, Set<(manifest: SkillManifest) => void>> =
    new Map();

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: "skillScopeId",
          });
          store.createIndex("cachedAt", "cachedAt", { unique: false });
        }
      };
    });
  }

  /**
   * Get a manifest from IndexedDB cache.
   * @param skillScopeId - Canonical skill address
   * @returns SkillManifest or null if not found or expired
   */
  async get(skillScopeId: string): Promise<SkillManifest | null> {
    if (!this.db) {
      throw new Error("Registry cache not initialized. Call init() first.");
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(skillScopeId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entry = request.result as SkillRegistryCacheEntry | undefined;
        if (!entry) {
          resolve(null);
          return;
        }

        const now = Date.now();
        const expiresAt = entry.cachedAt + entry.ttlSeconds * 1000;
        if (now > expiresAt) {
          this.delete(skillScopeId).catch(console.error);
          resolve(null);
          return;
        }

        resolve(entry.manifest);
      };
    });
  }

  /**
   * Store a manifest in IndexedDB cache.
   * @param manifest - SkillManifest to cache
   * @param ttlSeconds - Time-to-live in seconds (default: 1 hour)
   */
  async set(
    manifest: SkillManifest,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
  ): Promise<void> {
    if (!this.db) {
      throw new Error("Registry cache not initialized.");
    }

    const entry: SkillRegistryCacheEntry = {
      skillScopeId: manifest.skillScopeId,
      manifest,
      cachedAt: Date.now(),
      ttlSeconds,
      lastSyncTimestamp: this.lastSyncTimestamp,
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(entry);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async delete(skillScopeId: string): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(skillScopeId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Subscribe to new manifest events from Nostr relays via CEPS.
   * @param relayUrls - Relay URLs to subscribe to
   */
  async subscribeToRelays(relayUrls: string[]): Promise<() => void> {
    const { subscribeWithCeps } = await import("../ceps/index");

    const sub = await subscribeWithCeps(
      relayUrls,
      [
        {
          kinds: [33400, 33401],
          since: Math.floor(this.lastSyncTimestamp / 1000) || undefined,
        },
      ],
      {
        onevent: async (event: any) => {
          if (event.kind === 33400 && validateManifest(event)) {
            const manifest = parseManifestContent(event);
            await this.set(manifest);
            this.emit("manifest-added", manifest);
            this.lastSyncTimestamp = Date.now();
          }
        },
      }
    );

    return () => sub.close();
  }

  on(event: string, callback: (manifest: SkillManifest) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  off(event: string, callback: (manifest: SkillManifest) => void): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  private emit(event: string, manifest: SkillManifest): void {
    this.eventListeners.get(event)?.forEach((callback) => callback(manifest));
  }
}

// Singleton instance
let registryInstance: SkillRegistryCache | null = null;

export async function getSkillRegistry(): Promise<SkillRegistryCache> {
  if (!registryInstance) {
    registryInstance = new SkillRegistryCache();
    await registryInstance.init();
  }
  return registryInstance;
}
