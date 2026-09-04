/**
 * @module nip46/presence
 * @description kind:10003 presence helpers for the NIP-46 bunker (WP-2).
 *
 * Shared by both sides of the NIP-46 flow:
 *
 * - Bunker (phone) — the SINGLE publisher of its own replaceable kind:10003
 *   presence event. `addPresenceClient` / `removePresenceClient` mutate the
 *   authoritative encrypted vault entry (`nip46/presence.json`, shape
 *   `{ clients: string[]; updatedAt: string }` — WP-2 design note §2 item 2)
 *   and `republishPresence` builds the public projection: one `p` tag per
 *   permitted client pubkey, signed by the bunker identity, newest wins.
 *   The vault copy is the source of truth; the relay event is derived.
 * - Client (laptop) — absence-as-revoked subscription helper. Per the satnam
 *   bunker spec §3.1/§4 and the WP-2 design note §5, the client treats its
 *   permission as revoked when ANY of:
 *     (a) the latest observed presence event exists and does not include the
 *         client pubkey  -> reason 'absent-from-latest-list';
 *     (b) the presence event cannot be observed at all (no list exists, or
 *         the query channel fails) -> reason 'unobservable';
 *     (c) the subscription window times out before any list arrives
 *         -> reason 'timeout'.
 *   All three collapse to `permitted: false` — the design deliberately does
 *   NOT distinguish "revoked by the bunker" from "bunker offline".
 *
 * Wire encoding (founder decision 3a, WP-2 plan): one `p` tag per permitted
 * client pubkey (replaceable-list convention). The event `content` stays
 * empty — the content-embedded list was the explicitly rejected option (b).
 * kind:10003 itself is NOT pinned by upstream NIP-46 (cross-checked
 * 2026-09-03); the replaceable "newest wins" behavior follows the NIP-01
 * convention for kinds 10000-19999.
 *
 * Relay/CEPS wiring is intentionally NOT imported here: publication and
 * subscription are injected seams (see `Nip46PresencePublisher` and the
 * `subscribe` option of `awaitPresenceVerdict`). The bunker/client modules
 * bind CEPS (`publishEventWithCeps` / `subscribeWithCeps`) into these seams.
 * This keeps tests mock-only — no relay connection (design note §7) — and
 * honors the WP-2 non-negotiable of no relay/production activation.
 *
 * Secret hygiene: this module handles public keys and an encrypted vault
 * entry only. It never touches secret-key material, so the spec §6 grep
 * invariant over this directory (no secret-key token may appear) holds.
 */

import { bytesToUtf8, utf8ToBytes } from '@noble/hashes/utils';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Replaceable presence event kind (satnam bunker spec §3.1, WP-2 design §5). */
export const NIP46_PRESENCE_KIND = 10003;

/**
 * Default client-side absence-as-revoked window (founder decision Q4: 30 s,
 * configurable, test-pinned). After this window with no presence list
 * observed, the client treats its permission as revoked.
 */
export const DEFAULT_PRESENCE_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Typed error for presence-layer failures. Messages name fields, never echo values. */
export class Nip46PresenceError extends Error {
  readonly code: 'invalid-client-pubkey' | 'malformed-presence-entry';

  constructor(
    code: 'invalid-client-pubkey' | 'malformed-presence-entry',
    message: string,
  ) {
    super(message);
    this.name = 'Nip46PresenceError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * The bunker's private source of truth — the decrypted `nip46/presence.json`
 * entry. `clients` holds hex pubkeys of currently permitted clients; the
 * public projection is the signed kind:10003 event (WP-2 design §2 item 2).
 */
export interface Nip46PresenceList {
  clients: string[];
  /** ISO 8601 timestamp of the last list mutation. */
  updatedAt: string;
}

/**
 * Unsigned kind:10003 event template. The bunker slice signs it with the
 * bunker identity (via its signing seam) before publication.
 */
export interface Nip46PresenceEventTemplate {
  kind: number;
  /** Bunker identity pubkey (hex) — the single permitted publisher. */
  pubkey: string;
  /** Unix seconds — later `created_at` replaces earlier ones (newest wins). */
  created_at: number;
  /** One `['p', <client pubkey hex>]` per permitted client. */
  tags: string[][];
  /** Always '' — the list lives in `p` tags (founder decision 3a). */
  content: string;
}

/**
 * Minimal structural shape of an observed kind:10003 event (client side).
 * A full nostr event satisfies this structurally.
 */
export interface Nip46PresenceObservation {
  tags: readonly (readonly string[])[];
}

/**
 * Public crypto seam — a structural subset of the vault's `VaultOps`
 * (`encryptBytes`/`decryptBytes`, src/lib/vault/types.ts :652/:662). Any
 * VaultOps implementation satisfies it; the entry is ciphertext under the
 * master key, never plaintext at rest.
 */
export interface Nip46PresenceCrypto {
  encryptBytes(plaintext: Uint8Array): Promise<Uint8Array>;
  decryptBytes(data: Uint8Array): Promise<Uint8Array>;
}

/**
 * Persistence seam for the single encrypted `nip46/presence.json` entry.
 * The bunker slice binds this to the OPFS vault directory; tests use local
 * fakes (design note §7 — mocks only, no relay).
 */
export interface Nip46PresenceStore {
  /** Raw encrypted entry (nonce || ciphertext), or null if none stored yet. */
  loadEncrypted(): Promise<Uint8Array | null>;
  /** Persist the raw encrypted entry (nonce || ciphertext). */
  saveEncrypted(data: Uint8Array): Promise<void>;
}

/**
 * Publication seam — receives the unsigned kind:10003 template. The bunker
 * slice binds signing (bunker identity) + CEPS publish into this seam.
 */
export type Nip46PresencePublisher = (
  event: Nip46PresenceEventTemplate,
) => Promise<unknown>;

/** Client-side verdict on a pairing's presence status. */
export type PresenceCheckResult =
  | { permitted: true; clients: string[] }
  | {
      permitted: false;
      reason: 'absent-from-latest-list' | 'unobservable' | 'timeout';
      clients: null;
    };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

/** Fail-closed format gate: exactly 64 lowercase hex chars. Reject-only. */
function assertHexPubkey(value: string, field: string): void {
  if (!HEX_PUBKEY_RE.test(value)) {
    throw new Nip46PresenceError(
      'invalid-client-pubkey',
      `${field} must be a 64-character lowercase hex pubkey`,
    );
  }
}

function serializePresenceList(list: Nip46PresenceList): Uint8Array {
  return utf8ToBytes(
    JSON.stringify({ clients: list.clients, updatedAt: list.updatedAt }),
  );
}

function parsePresenceList(plaintext: Uint8Array): Nip46PresenceList {
  let raw: unknown;
  try {
    raw = JSON.parse(bytesToUtf8(plaintext));
  } catch {
    throw new Nip46PresenceError(
      'malformed-presence-entry',
      'presence entry is not valid JSON',
    );
  }
  if (raw === null || typeof raw !== 'object') {
    throw new Nip46PresenceError(
      'malformed-presence-entry',
      'presence entry is not an object',
    );
  }
  const candidate = raw as { clients?: unknown; updatedAt?: unknown };
  if (
    !Array.isArray(candidate.clients) ||
    candidate.clients.some((entry) => typeof entry !== 'string')
  ) {
    throw new Nip46PresenceError(
      'malformed-presence-entry',
      'presence entry clients must be an array of strings',
    );
  }
  if (typeof candidate.updatedAt !== 'string') {
    throw new Nip46PresenceError(
      'malformed-presence-entry',
      'presence entry updatedAt must be a string',
    );
  }
  return {
    clients: candidate.clients as string[],
    updatedAt: candidate.updatedAt,
  };
}

async function writePresenceList(
  crypto: Nip46PresenceCrypto,
  store: Nip46PresenceStore,
  clients: string[],
): Promise<Nip46PresenceList> {
  const list: Nip46PresenceList = {
    clients,
    updatedAt: new Date().toISOString(),
  };
  await store.saveEncrypted(await crypto.encryptBytes(serializePresenceList(list)));
  return list;
}

// ---------------------------------------------------------------------------
// Bunker side — authoritative vault list (presence.json)
// ---------------------------------------------------------------------------

/**
 * Read the authoritative presence list from the encrypted vault entry.
 * Returns null when no entry has been stored yet (fresh bunker).
 *
 * Throws {@link Nip46PresenceError} (`malformed-presence-entry`) on a
 * decrypted-but-unparseable entry — corrupt state fails closed, never
 * silently reads as "empty". Decryption failures propagate as the vault's
 * own typed errors.
 */
export async function readPresenceList(
  crypto: Nip46PresenceCrypto,
  store: Nip46PresenceStore,
): Promise<Nip46PresenceList | null> {
  const encrypted = await store.loadEncrypted();
  if (encrypted === null) {
    return null;
  }
  const plaintext = await crypto.decryptBytes(encrypted);
  return parsePresenceList(plaintext);
}

/**
 * Add a client pubkey to the authoritative presence list. Idempotent: an
 * already-permitted client is left untouched (no updatedAt bump). The caller
 * (bunker slice) follows a successful add with `republishPresence` so the
 * public projection stays in sync (design §5 add semantics).
 */
export async function addPresenceClient(
  crypto: Nip46PresenceCrypto,
  store: Nip46PresenceStore,
  clientPubkey: string,
): Promise<Nip46PresenceList> {
  assertHexPubkey(clientPubkey, 'clientPubkey');
  const current = await readPresenceList(crypto, store);
  const clients = current?.clients ?? [];
  if (current !== null && clients.includes(clientPubkey)) {
    return current;
  }
  return writePresenceList(crypto, store, [...clients, clientPubkey]);
}

/**
 * Remove a client pubkey from the authoritative presence list. Idempotent:
 * removing an absent pubkey is a no-op. The caller (bunker slice) follows a
 * successful removal with `republishPresence` AND stops responding to that
 * client — removal takes effect twice over (design §5 remove semantics).
 */
export async function removePresenceClient(
  crypto: Nip46PresenceCrypto,
  store: Nip46PresenceStore,
  clientPubkey: string,
): Promise<Nip46PresenceList> {
  assertHexPubkey(clientPubkey, 'clientPubkey');
  const current = await readPresenceList(crypto, store);
  if (current === null) {
    return writePresenceList(crypto, store, []);
  }
  if (!current.clients.includes(clientPubkey)) {
    return current;
  }
  return writePresenceList(
    crypto,
    store,
    current.clients.filter((pubkey) => pubkey !== clientPubkey),
  );
}

// ---------------------------------------------------------------------------
// Bunker side — public kind:10003 projection
// ---------------------------------------------------------------------------

/**
 * Build the presence event's `p` tags: exactly one `['p', <pubkey>]` per
 * permitted client, first-occurrence order preserved. Duplicates (which the
 * idempotent add prevents) are collapsed to keep the one-tag-per-client
 * invariant. Every entry is format-gated; an invalid entry throws.
 */
export function buildPresenceEventTags(
  clients: readonly string[],
): string[][] {
  const tags: string[][] = [];
  const seen = new Set<string>();
  for (const [index, pubkey] of clients.entries()) {
    assertHexPubkey(pubkey, `clients[${index}]`);
    if (seen.has(pubkey)) {
      continue;
    }
    seen.add(pubkey);
    tags.push(['p', pubkey]);
  }
  return tags;
}

/**
 * Build the unsigned kind:10003 presence event template. Replaceable-list
 * convention (founder decision 3a): one `p` tag per permitted client pubkey,
 * empty content. `created_at` defaults to now so each republish wins over
 * the previous version of the same replaceable event.
 */
export function buildPresenceEvent(
  clients: readonly string[],
  bunkerPubkey: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Nip46PresenceEventTemplate {
  assertHexPubkey(bunkerPubkey, 'bunkerPubkey');
  return {
    kind: NIP46_PRESENCE_KIND,
    pubkey: bunkerPubkey,
    created_at: nowSeconds,
    tags: buildPresenceEventTags(clients),
    content: '',
  };
}

/**
 * Republish the public presence projection from the authoritative vault
 * list: read presence.json, build the kind:10003 template, hand it to the
 * publisher seam (bunker slice binds signing + CEPS publish). The vault copy
 * is authoritative; the relay event is derived from it.
 */
export async function republishPresence(
  crypto: Nip46PresenceCrypto,
  store: Nip46PresenceStore,
  publisher: Nip46PresencePublisher,
  bunkerPubkey: string,
): Promise<{ list: Nip46PresenceList | null; event: Nip46PresenceEventTemplate }> {
  const list = await readPresenceList(crypto, store);
  const event = buildPresenceEvent(list?.clients ?? [], bunkerPubkey);
  await publisher(event);
  return { list, event };
}

// ---------------------------------------------------------------------------
// Client side — absence-as-revoked (design §5 client contract)
// ---------------------------------------------------------------------------

/** Extract the client pubkey list from an observed event's p tags. */
export function presenceClientsFromTags(
  tags: readonly (readonly string[])[],
): string[] {
  const clients: string[] = [];
  for (const tag of tags) {
    if (tag[0] === 'p' && typeof tag[1] === 'string') {
      clients.push(tag[1]);
    }
  }
  return clients;
}

/**
 * Pure classification of an observed presence event against a client pubkey
 * (design §5 conditions (a) and (b)):
 * - no observation at all -> revoked ('unobservable');
 * - latest list exists and includes the client -> permitted;
 * - latest list exists without the client -> revoked ('absent-from-latest-list').
 */
export function classifyPresence(
  observation: Nip46PresenceObservation | null | undefined,
  clientPubkey: string,
): PresenceCheckResult {
  if (observation === null || observation === undefined) {
    return { permitted: false, reason: 'unobservable', clients: null };
  }
  const clients = presenceClientsFromTags(observation.tags);
  if (clients.includes(clientPubkey)) {
    return { permitted: true, clients };
  }
  return { permitted: false, reason: 'absent-from-latest-list', clients: null };
}

/** How the watch ended without a positive observation. */
export interface Nip46PresenceWatch {
  /** The client pubkey whose permission is being checked. */
  clientPubkey: string;
  /**
   * Absence-as-revoked window in milliseconds. Default
   * {@link DEFAULT_PRESENCE_TIMEOUT_MS} (30 s, founder decision Q4).
   */
  timeoutMs?: number;
  /**
   * Optional initial query seam (bunker slice binds a CEPS list query for
   * the bunker's latest kind:10003). Semantics:
   * - resolves with an event -> classified immediately (condition (a));
   * - resolves null/undefined -> definitive "no list (yet)"; the window
   *   still guards relay lag, and window expiry ends as 'unobservable';
   * - rejects -> the presence event cannot be observed at all
   *   (condition (b)) -> revoked immediately as 'unobservable'.
   */
  fetchLatestPresence?: () => Promise<Nip46PresenceObservation | null | undefined>;
  /**
   * Optional subscription seam (bunker slice binds CEPS subscribe for
   * kind:10003 from the bunker). Receives each observed event; returns an
   * unsubscribe function, invoked on every exit path.
   */
  subscribe?: (
    onEvent: (event: Nip46PresenceObservation) => void,
  ) => () => void;
}

/**
 * Await the client's presence verdict under the absence-as-revoked contract
 * (design §5; spec §3.1 "Client MUST treat missing presence as revoked",
 * spec §4 "treat timeout as revoke"). The verdict is `permitted: true` only
 * when a presence list containing the client pubkey is observed within the
 * window. Every exit path cleans up the timer and the subscription.
 */
export async function awaitPresenceVerdict(
  watch: Nip46PresenceWatch,
): Promise<PresenceCheckResult> {
  const timeoutMs = watch.timeoutMs ?? DEFAULT_PRESENCE_TIMEOUT_MS;
  let sawMissingList = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  type Outcome =
    | { kind: 'event'; observation: Nip46PresenceObservation }
    | { kind: 'timer' };

  try {
    let settle!: (outcome: Outcome) => void;
    const settled = new Promise<Outcome>((resolve) => {
      settle = resolve;
    });
    timer = setTimeout(() => settle({ kind: 'timer' }), timeoutMs);

    if (watch.fetchLatestPresence !== undefined) {
      type QueryOutcome =
        | { kind: 'query'; observation: Nip46PresenceObservation | null | undefined }
        | { kind: 'query-error' };
      const raced = await Promise.race([
        watch
          .fetchLatestPresence()
          .then(
            (observation): QueryOutcome => ({ kind: 'query', observation }),
            (): QueryOutcome => ({ kind: 'query-error' }),
          ),
        settled,
      ]);
      if (raced.kind === 'event') {
        return classifyPresence(raced.observation, watch.clientPubkey);
      }
      if (raced.kind === 'timer') {
        return {
          permitted: false,
          reason: sawMissingList ? 'unobservable' : 'timeout',
          clients: null,
        };
      }
      if (raced.kind === 'query-error') {
        // Condition (b): the presence event cannot be observed at all.
        return { permitted: false, reason: 'unobservable', clients: null };
      }
      if (raced.observation != null) {
        return classifyPresence(raced.observation, watch.clientPubkey);
      }
      // Definitive null: no list stored (yet). Relay lag is still guarded by
      // the window; expiry ends as 'unobservable' rather than 'timeout'.
      sawMissingList = true;
    }

    if (watch.subscribe !== undefined) {
      unsubscribe = watch.subscribe((observation) => {
        settle({ kind: 'event', observation });
      });
    }
    const outcome = await settled;
    if (outcome.kind === 'event') {
      return classifyPresence(outcome.observation, watch.clientPubkey);
    }
    return {
      permitted: false,
      reason: sawMissingList ? 'unobservable' : 'timeout',
      clients: null,
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (unsubscribe !== undefined) {
      unsubscribe();
    }
  }
}
