/**
 * @file nip46-ceps-bindings.test.ts
 * @description Relay-INDEPENDENT LOGIC tests for the REAL CEPS bindings
 * (src/lib/nip46/ceps-bindings.ts) — WP-2 Item 3, Amendment 2.0 (founder
 * decision F-3). NO module-boundary mocks (vi.mock is REJECTED by the
 * founder) and NO network: the bindings receive the CEPS functions as
 * INJECTED parameters (defaulting to the real ceps-client exports), so the
 * tests exercise pure composition — binding function construction,
 * filter/URL shapes, signing order, relays pass-through, handler mapping,
 * unsubscribe mapping — with plain function stand-ins passed at call time.
 * The substantive round-trip coverage is REAL relay, in
 * tests/lib/nip46-ceps-bindings.integration.test.ts (config-gated).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  bindCepsPresencePublisher,
  bindCepsPresenceFetcher,
  bindCepsPresenceSubscriber,
  buildPresenceFilter,
} from '../../src/lib/nip46/ceps-bindings.js';
import type { Nip46PresenceEventTemplate } from '../../src/lib/nip46/presence.js';

const BUNKER = 'd'.repeat(64);
const CLIENT = 'a'.repeat(64);
const RELAYS = ['wss://relay.example.com'];

const TEMPLATE: Nip46PresenceEventTemplate = {
  kind: 10003,
  pubkey: BUNKER,
  created_at: 1_000,
  tags: [['p', CLIENT]],
  content: '',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildPresenceFilter (pure filter/URL shape)', () => {
  it('builds the kind:10003 bunker-author filter', () => {
    expect(buildPresenceFilter(BUNKER)).toEqual({ kinds: [10003], authors: [BUNKER] });
  });
});

describe('bindCepsPresencePublisher (kind:10003 republish)', () => {
  it('signs the template with the injected bunker-identity signer, then publishes via the injected publish function', async () => {
    const signer = vi.fn(async (template: Nip46PresenceEventTemplate) => ({ ...template, id: 'evt', sig: 'sig' }));
    const publish = vi.fn(async () => 'published-id');
    const publisher = bindCepsPresencePublisher({ signer, relays: RELAYS, publish });

    const result = await publisher(TEMPLATE);

    expect(signer).toHaveBeenCalledTimes(1);
    expect(signer).toHaveBeenCalledWith(TEMPLATE);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ ...TEMPLATE, id: 'evt', sig: 'sig' }, RELAYS);
    expect(result).toBe('published-id');
  });

  it('propagates a signer failure (no publish on signing error)', async () => {
    const signer = vi.fn(async () => {
      throw new Error('signing failed');
    });
    const publish = vi.fn(async () => 'published-id');
    const publisher = bindCepsPresencePublisher({ signer, relays: RELAYS, publish });

    await expect(publisher(TEMPLATE)).rejects.toThrow('signing failed');
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('bindCepsPresenceFetcher (kind:10003 initial query)', () => {
  it('queries with the pure filter and returns the newest event mapped to the observation shape', async () => {
    const event = { id: 'evt', pubkey: BUNKER, kind: 10003, tags: [['p', CLIENT]], content: '', created_at: 1_000, sig: 'sig' };
    const list = vi.fn(async () => [event]);
    const fetcher = bindCepsPresenceFetcher({ bunkerPubkey: BUNKER, relays: RELAYS, list });

    const observation = await fetcher();

    expect(list).toHaveBeenCalledWith({ kinds: [10003], authors: [BUNKER] }, RELAYS);
    expect(observation?.tags).toEqual([['p', CLIENT]]);
  });

  it('returns null when no kind:10003 exists', async () => {
    const list = vi.fn(async () => []);
    const fetcher = bindCepsPresenceFetcher({ bunkerPubkey: BUNKER, relays: RELAYS, list });

    expect(await fetcher()).toBeNull();
  });
});

describe('bindCepsPresenceSubscriber (kind:10003 subscription)', () => {
  it('subscribes with the pure bunker-author filter and returns an async unsubscribe that closes the sub', async () => {
    const close = vi.fn();
    const subscribe = vi.fn(async (_relays: unknown, _filter: unknown, _handlers: unknown) => ({ close } as never));
    const subscriber = bindCepsPresenceSubscriber({ bunkerPubkey: BUNKER, relays: RELAYS, subscribe });

    const unsubscribe = await subscriber(() => {});
    unsubscribe();

    expect(subscribe).toHaveBeenCalledTimes(1);
    const [, filter] = subscribe.mock.calls[0]!;
    expect(filter).toEqual({ kinds: [10003], authors: [BUNKER] });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('forwards observed events to the onEvent callback through the onevent handler', async () => {
    let capturedHandler: ((event: unknown) => void) | undefined;
    const subscribe = vi.fn(async (_relays: unknown, _filter: unknown, handlers: { onevent: (e: unknown) => void }) => {
      capturedHandler = handlers.onevent;
      return { close: vi.fn() } as never;
    });
    const subscriber = bindCepsPresenceSubscriber({ bunkerPubkey: BUNKER, relays: RELAYS, subscribe });
    const onEvent = vi.fn();
    await subscriber(onEvent);

    const event = { id: 'evt', pubkey: BUNKER, kind: 10003, tags: [['p', CLIENT]], content: '', created_at: 1_000, sig: 'sig' };
    capturedHandler?.(event);

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect((onEvent.mock.calls[0]![0] as { tags: string[][] }).tags).toEqual([['p', CLIENT]]);
  });
});