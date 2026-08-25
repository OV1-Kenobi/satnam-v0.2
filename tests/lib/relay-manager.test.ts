/**
 * CR-E — NIP-65 relay management tests (Bitchat-informed deterministic order).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { generateSecretKey } from 'nostr-tools';

import {
  DEFAULT_PINNED_RELAYS,
  buildKind10002,
  parsePeerRelayList,
  routeDirectMessage,
  selectRelaysDeterministic,
  setSelfHostedRelay,
  type PinnedRelay,
} from '../../src/lib/nostr/relay-manager';

const REGISTRY: ReadonlyArray<PinnedRelay> = DEFAULT_PINNED_RELAYS;

describe('CR-E deterministic relay selection (R2 verdict: geometric)', () => {
  beforeEach(() => setSelfHostedRelay(null));

  it('same anchor + registry → identical ordering every time', () => {
    const a = selectRelaysDeterministic({ anchorLat: 52.52, anchorLon: 13.405, registry: REGISTRY });
    const b = selectRelaysDeterministic({ anchorLat: 52.52, anchorLon: 13.405, registry: REGISTRY });
    expect(a.writeSet).toEqual(b.writeSet);
    expect(a.readSet).toEqual(b.readSet);
    expect(a.orderedByDistance).toEqual(b.orderedByDistance);
  });

  it('orders relays nearest-first by Haversine distance', () => {
    const { orderedByDistance } = selectRelaysDeterministic({
      anchorLat: 50.11, // Frankfurt
      anchorLon: 8.682,
      registry: REGISTRY,
    });
    // nos.lol (Frankfurt, ~0 km) first; Munich (~300 km) second; SF last
    expect(orderedByDistance[0]!.url).toBe('wss://nos.lol');
    expect(orderedByDistance[1]!.url).toBe('wss://nostr.wine');
    expect(orderedByDistance[orderedByDistance.length - 1]!.url).toBe('wss://relay.nostr.band');
    for (let i = 1; i < orderedByDistance.length; i++) {
      expect(orderedByDistance[i]!.km).toBeGreaterThanOrEqual(orderedByDistance[i - 1]!.km);
    }
  });

  it('self-hosted relay is always first in the write set', () => {
    setSelfHostedRelay('wss://pylon.satnam.pub');
    const { writeSet } = selectRelaysDeterministic({
      anchorLat: -33.8688, // Sydney — farthest from all pinned
      anchorLon: 151.2093,
      registry: REGISTRY,
    });
    expect(writeSet[0]).toBe('wss://pylon.satnam.pub');
    expect(writeSet.length).toBe(3);
  });

  it('tie-breaks equal distances by URL (total order)', () => {
    const tied: ReadonlyArray<PinnedRelay> = [
      { url: 'wss://b.relay', lat: 10, lon: 10 },
      { url: 'wss://a.relay', lat: 10, lon: 10 },
    ];
    const { orderedByDistance } = selectRelaysDeterministic({
      anchorLat: 20,
      anchorLon: 20,
      registry: tied,
    });
    expect(orderedByDistance.map((r) => r.url)).toEqual(['wss://a.relay', 'wss://b.relay']);
  });

  it('read set is a superset of write set', () => {
    const { writeSet, readSet } = selectRelaysDeterministic({
      anchorLat: 40,
      anchorLon: 0,
      registry: REGISTRY,
    });
    expect(readSet.length).toBeGreaterThanOrEqual(writeSet.length);
    for (const r of writeSet) expect(readSet).toContain(r);
  });
});

describe('CR-E kind:10002 publish/parse round-trip + inbox routing', () => {
  it('builds a signed kind:10002 with r tags; parses back symmetrically', () => {
    const event = buildKind10002(
      { write: ['wss://pylon.satnam.pub'], read: ['wss://nos.lol'] },
      generateSecretKey(),
    );
    expect(event.kind).toBe(10002);
    expect(event.tags).toContainEqual(['r', 'wss://pylon.satnam.pub']);
    expect(event.tags).toContainEqual(['r', 'wss://nos.lol', 'read']);
    expect(event.sig).toHaveLength(128);

    const parsed = parsePeerRelayList(event);
    expect(parsed.write).toEqual(['wss://pylon.satnam.pub']);
    expect(parsed.read).toEqual(['wss://nos.lol']);
  });

  it('DM routing honors peer inbox hints over our own write set', () => {
    const routed = routeDirectMessage({
      peerList: { write: ['wss://peer-inbox.example'], read: [] },
      ourWriteSet: ['wss://ours.example'],
    });
    expect(routed).toEqual(['wss://peer-inbox.example']);
  });

  it('DM routing falls back to our write set when the peer list is missing or empty', () => {
    expect(routeDirectMessage({ peerList: null, ourWriteSet: ['wss://ours.example'] })).toEqual([
      'wss://ours.example',
    ]);
    expect(
      routeDirectMessage({ peerList: { write: [], read: ['x'] }, ourWriteSet: ['wss://ours.example'] }),
    ).toEqual(['wss://ours.example']);
  });
});
