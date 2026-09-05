/**
 * @file nip46-ceps-bindings.integration.test.ts
 * @description REAL-RELAY integration tests for the CEPS presence bindings
 * (src/lib/nip46/ceps-bindings.ts) — WP-2 Item 3, Amendment 2.0 (founder
 * decision F-3: real relay; the mock-boundary test strategy is REJECTED).
 *
 * CONFIG SEAM: the relay endpoint is read from the NIP46_TEST_RELAY
 * environment variable (a wss:// URL) — NEVER hardcoded, NEVER committed
 * credentials. The value is supplied by the founder separately and set at
 * run time (e.g. `$env:NIP46_TEST_RELAY='wss://…'; npm run test:integration`).
 *
 * GATING: these tests run ONLY when NIP46_TEST_RELAY is present AND the relay
 * is reachable; otherwise every test SKIPS with a clear message. The
 * change-group is never blocked on connectivity and CI stays green (CI does
 * not set NIP46_TEST_RELAY by default).
 *
 * IDENTITY POLICY: a SYNTHETIC ephemeral keypair generated per run
 * (generateSecretKey/getPublicKey) — a fake 64-hex pubkey, NOT a real
 * identity. No secrets beyond the disposable in-memory test secret; no app
 * activation; no production path touched; no CEPS session with real keys.
 *
 * CLEANUP: kind:10003 is replaceable — after the round-trip, the suite
 * republishes an EMPTY presence list under the synthetic key, replacing the
 * test event (natural cleanup; no delete API). The residual empty-list event
 * under the synthetic key is inert residue.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { getRelayHealthWithCeps } from '../../src/lib/ceps/ceps-client.js';
import {
  bindCepsPresencePublisher,
  bindCepsPresenceFetcher,
  bindCepsPresenceSubscriber,
} from '../../src/lib/nip46/ceps-bindings.js';
import type { Nip46PresenceEventTemplate } from '../../src/lib/nip46/presence.js';

const relayUrl: string | null =
  ((process.env.NIP46_TEST_RELAY as string | undefined) ??
    ((import.meta as any).env?.NIP46_TEST_RELAY as string | undefined) ??
    null);

async function isRelayReachable(url: string): Promise<boolean> {
  try {
    const report = await getRelayHealthWithCeps([url]);
    return report.healthyCount > 0;
  } catch {
    return false;
  }
}

// Module-level gate, evaluated once at collection time.
const relayReachable = relayUrl === null ? false : await isRelayReachable(relayUrl);
const runIntegration = relayUrl !== null && relayReachable;
if (!runIntegration) {
  console.info(
    `[nip46-ceps-bindings.integration] SKIPPED: NIP46_TEST_RELAY ${
      relayUrl === null ? 'is not set' : `(${relayUrl}) is not reachable`
    }. Set NIP46_TEST_RELAY to a reachable test relay to run the real-relay round-trip tests.`,
  );
}

// Synthetic ephemeral identity (per run; never persisted; never logged).
const SYNTHETIC_SECRET = generateSecretKey();
const SYNTHETIC_PUB = getPublicKey(SYNTHETIC_SECRET);
const SYNTHETIC_CLIENT_PUB = getPublicKey(generateSecretKey());
const RELAYS = relayUrl === null ? [] : [relayUrl];

describe.skipIf(!runIntegration)('CEPS presence bindings — REAL-RELAY round-trip (Amendment 2.0, F-3)', () => {
  const signer = async (template: Nip46PresenceEventTemplate): Promise<unknown> => {
    // Sign with the synthetic key via nostr-tools' signing primitive
    // (expected export: finalizeEvent — verify the exact export name at
    // implementation time [REQUIRES VERIFICATION, Amendment 2.0 section I]).
    const { finalizeEvent } = await import('nostr-tools');
    return finalizeEvent(template as never, SYNTHETIC_SECRET);
  };

  it('publishes a kind:10003 test event and queries it back (round-trip)', async () => {
    const publisher = bindCepsPresencePublisher({ signer, relays: RELAYS });
    const fetcher = bindCepsPresenceFetcher({ bunkerPubkey: SYNTHETIC_PUB, relays: RELAYS });

    const template: Nip46PresenceEventTemplate = {
      kind: 10003,
      pubkey: SYNTHETIC_PUB,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', SYNTHETIC_CLIENT_PUB]],
      content: '',
    };
    await publisher(template);

    // Bounded poll: replaceable-event propagation is async (up to 5 attempts, 1 s apart).
    let observed: { tags: readonly (readonly string[])[] } | null = null;
    for (let attempt = 0; attempt < 5 && observed === null; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      observed = await fetcher();
    }

    expect(observed).not.toBeNull();
    expect(observed!.tags.some((t) => t[0] === 'p' && t[1] === SYNTHETIC_CLIENT_PUB)).toBe(true);
  });

  it('publishes a kind:10003 test event and receives it on the subscription (round-trip)', async () => {
    const publisher = bindCepsPresencePublisher({ signer, relays: RELAYS });
    const subscriber = bindCepsPresenceSubscriber({ bunkerPubkey: SYNTHETIC_PUB, relays: RELAYS });

    // Subscribe FIRST so the round-trip is deterministic (no race).
    let resolveReceived!: (observation: { tags: readonly (readonly string[])[] }) => void;
    let unsubscribe: (() => void) | undefined;
    const received = new Promise<{ tags: readonly (readonly string[])[] }>((resolve) => {
      resolveReceived = resolve;
    });
    unsubscribe = await subscriber((observation) => {
      if (observation.tags.some((t) => t[0] === 'p' && t[1] === SYNTHETIC_CLIENT_PUB)) {
        resolveReceived(observation);
      }
    });

    const template: Nip46PresenceEventTemplate = {
      kind: 10003,
      pubkey: SYNTHETIC_PUB,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', SYNTHETIC_CLIENT_PUB]],
      content: '',
    };
    await publisher(template);

    // Bounded window (10 s — the presence timeout default): the event must arrive on the subscription.
    const observation = await Promise.race([
      received,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timed out waiting for the subscribed kind:10003 event')), 10_000),
      ),
    ]);
    expect(observation.tags.some((t) => t[0] === 'p' && t[1] === SYNTHETIC_CLIENT_PUB)).toBe(true);
    unsubscribe?.();
  });

  afterAll(async () => {
    // Cleanup: republish an EMPTY presence list under the synthetic key —
    // kind:10003 is replaceable, so this replaces the test event (natural
    // cleanup). Non-fatal: the residual empty-list event is inert residue
    // under a synthetic key.
    try {
      const publisher = bindCepsPresencePublisher({ signer, relays: RELAYS });
      const emptyTemplate: Nip46PresenceEventTemplate = {
        kind: 10003,
        pubkey: SYNTHETIC_PUB,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: '',
      };
      await publisher(emptyTemplate);
      console.info('[nip46-ceps-bindings.integration] cleanup: empty presence list republished under the synthetic key.');
    } catch (error) {
      console.warn(
        '[nip46-ceps-bindings.integration] cleanup publish failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
  });
});