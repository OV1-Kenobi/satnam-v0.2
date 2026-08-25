/**
 * @module nostr/relay-manager
 * @description CR-E — minimal NIP-65 relay management, Bitchat-informed.
 *
 * Per evidence/r2 (2026-08-24): adopt Bitchat's GEOMETRIC deterministic
 * strategy — Haversine-nearest over a PINNED relay registry (static relay
 * coordinates from CSV), self-hosted-first composition. Hash-scoring was
 * dropped (never implemented upstream). Privacy rule: distances use RELAY
 * coordinates only; user location is never read, never published.
 *
 * Scope is intentionally minimal per plan: no health dashboards, no
 * auto-discovery beyond spec. Publish kind:10002 on identity creation;
 * fetch peer lists before DM routing; honor inbox hints.
 */

import { finalizeEvent, type Event } from 'nostr-tools';

// ---------------------------------------------------------------------------
// Pinned relay registry (seed data; extend via config, never code changes)
// ---------------------------------------------------------------------------

export interface PinnedRelay {
  readonly url: string;
  /** Latitude in decimal degrees — RELAY infrastructure position, not user. */
  readonly lat: number;
  /** Longitude in decimal degrees. */
  readonly lon: number;
  /** Self-hosted relays sort first unconditionally when configured by user. */
  readonly selfHosted?: boolean;
}

/** Seed subset of the pinned registry (Bitchat online_relays_gps.csv, curated). */
export const DEFAULT_PINNED_RELAYS: ReadonlyArray<PinnedRelay> = [
  { url: 'wss://relay.damus.io', lat: 52.52, lon: 13.405 },      // Berlin
  { url: 'wss://nos.lol', lat: 50.11, lon: 8.682 },              // Frankfurt
  { url: 'wss://relay.nostr.band', lat: 37.7749, lon: -122.4194 }, // SF
  { url: 'wss://nostr.wine', lat: 48.1351, lon: 11.582 },        // Munich
  { url: 'wss://relay.primal.net', lat: 40.7128, lon: -74.006 }, // NYC
];

/** User-configured self-hosted relay (Pylon), always first in write set. */
let userSelfHostedRelay: string | null = null;

export function setSelfHostedRelay(url: string | null): void {
  userSelfHostedRelay = url ? url.trim() : null;
}

// ---------------------------------------------------------------------------
// Deterministic selection (R2 §1)
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export interface RelaySelection {
  /** Relays we publish/write to: self-hosted first, then nearest pinned. */
  readonly writeSet: string[];
  /** Read superset: write set + one extra fallback for redundancy. */
  readonly readSet: string[];
  /** Deterministic distance table used for the ordering (audit/debug). */
  readonly orderedByDistance: ReadonlyArray<{ url: string; km: number }>;
}

/**
 * Deterministically select the relay set relative to an anchor point.
 * Same anchor + same registry → same output, always (unit-tested property).
 */
export function selectRelaysDeterministic(params: {
  anchorLat: number;
  anchorLon: number;
  registry?: ReadonlyArray<PinnedRelay>;
}): RelaySelection {
  const registry = params.registry ?? DEFAULT_PINNED_RELAYS;
  const scored = [...registry]
    .map((r) => ({
      url: r.url,
      km: haversineKm(params.anchorLat, params.anchorLon, r.lat, r.lon),
    }))
    // tie-break by URL so ordering is total even at equal distance
    .sort((a, b) => a.km - b.km || a.url.localeCompare(b.url));

  const nearest = scored.slice(0, 3).map((s) => s.url);
  const writeSet =
    userSelfHostedRelay && !nearest.includes(userSelfHostedRelay)
      ? [userSelfHostedRelay, ...nearest.slice(0, 2)]
      : nearest;

  const fallback = scored.find((s) => !writeSet.includes(s.url));
  return {
    writeSet,
    readSet: fallback ? [...writeSet, fallback.url] : writeSet,
    orderedByDistance: scored,
  };
}

// ---------------------------------------------------------------------------
// NIP-65 kind:10002
// ---------------------------------------------------------------------------

export interface RelayList {
  /** Write+read relays (NIP-65 marker absent or 'write'). */
  readonly write: string[];
  /** Read-only fallbacks. */
  readonly read: string[];
}

/**
 * Build a SIGNED kind:10002 relay-list event. The caller supplies the signing
 * secret (from the OPFS vault session); it is used once here and never stored.
 */
export function buildKind10002(relayList: RelayList, secret: Uint8Array): Event {
  const tags: string[][] = [
    ...relayList.write.map((r) => ['r', r] as string[]),
    ...relayList.read.map((r) => ['r', r, 'read'] as string[]),
  ];
  return finalizeEvent(
    { kind: 10002, created_at: Math.floor(Date.now() / 1000), tags, content: '' },
    secret,
  );
}

/**
 * Parse a peer's kind:10002 event into inbox hints.
 */
export function parsePeerRelayList(event: {
  tags: string[][];
}): RelayList {
  const write: string[] = [];
  const read: string[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== 'r' || !tag[1]) continue;
    if (tag[2] === 'read') read.push(tag[1]);
    else write.push(tag[1]);
  }
  return { write, read };
}

/**
 * DM routing decision per NIP-65 + R2: honor the peer's inbox (their write
 * relays are where they receive); fall back to our own write set.
 */
export function routeDirectMessage(params: {
  peerList?: RelayList | null;
  ourWriteSet: string[];
}): string[] {
  if (params.peerList && params.peerList.write.length > 0) {
    return params.peerList.write;
  }
  return params.ourWriteSet;
}
