/**
 * @file nip46-ceps-bindings.integration.test.ts
 * @description REAL-RELAY integration tests for the CEPS presence bindings
 * (src/lib/nip46/ceps-bindings.ts) — WP-2 Item 3, Amendment 2.0 (founder
 * decision F-3: real relay; the mock-boundary test strategy is REJECTED),
 * re-scoped by fix-plan 10 (NIP-42 AUTH / credential-aware config seam).
 *
 * CONFIG SEAM (credentials-required posture, fix-plan 10 Item B): the relay
 * endpoint is read from NIP46_TEST_RELAY and the synthetic TEST identity
 * from NIP46_TEST_RELAY_NSEC (a 64-hex secret or nsec1 string) — both
 * environment variables, NEVER hardcoded, NEVER defaulted, NEVER committed,
 * NEVER logged. Skip messages print presence/absence only. Values are
 * supplied by the founder separately and set at run time via the
 * NIP46_TEST_RELAY and NIP46_TEST_RELAY_NSEC environment variables
 * (e.g. `$env:NIP46_TEST_RELAY='wss://…'; npm run test:integration`).
 *
 * GATING: the suite runs ONLY when BOTH env vars are present AND the nsec
 * decodes AND the relay is reachable; otherwise every test SKIPS with a
 * clear message. Skip paths never initialize a session (no key in memory).
 * The change-group is never blocked on connectivity and CI stays green (CI
 * does not set the env vars by default).
 *
 * SESSION LIFECYCLE (fix-plan 10 Item B3): on an auth-required relay the
 * reachability probe (a kind:0 querySync) is itself subject to NIP-42 AUTH,
 * so the CEPS session is initialized BEFORE the probe — the pool's
 * automaticallyAuth signer (fix-plan 10 Item A) answers the challenge. A
 * top-level afterAll tears the session down (endSessionWithCeps: zeroizes
 * the in-memory key and closes the pool relays) even when the suite skipped.
 *
 * IDENTITY POLICY (fix-plan 10 Item C1): the identity comes from the env
 * seam — a DISPOSABLE synthetic test identity, never a real user identity.
 * The SAME identity initializes the CEPS session and authors the presence
 * events (relay auth binds the connection to it; the event-author filter
 * agrees). No secrets beyond the in-memory test secret; no app activation;
 * no production path touched.
 *
 * CLEANUP: kind:10003 is replaceable — after the round-trip, the suite
 * republishes an EMPTY presence list under the synthetic key, replacing the
 * test event (natural cleanup; no delete API). The residual empty-list event
 * under the synthetic key is inert residue. Session teardown additionally
 * zeroizes the in-memory key.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils';
import {
  endSessionWithCeps,
  getRelayHealthWithCeps,
  initializeSessionWithCeps,
} from '../../src/lib/ceps/ceps-client.js';
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

const relayNsec: string | null =
  ((process.env.NIP46_TEST_RELAY_NSEC as string | undefined) ??
    ((import.meta as any).env?.NIP46_TEST_RELAY_NSEC as string | undefined) ??
    null);

function decodeTestNsec(raw: string): { secret: Uint8Array; pubkey: string } {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    const secret = hexToBytes(raw);
    return { secret, pubkey: getPublicKey(secret) };
  }
  const dec = nip19.decode(raw);
  if (dec.type !== 'nsec') {
    throw new Error('NIP46_TEST_RELAY_NSEC must be an nsec or 64-hex secret');
  }
  const secret = dec.data as Uint8Array;
  return { secret, pubkey: getPublicKey(secret) };
}

async function isRelayReachable(url: string): Promise<boolean> {
  try {
    const report = await getRelayHealthWithCeps([url]);
    return report.healthyCount > 0;
  } catch {
    return false;
  }
}

// Module-level gate, evaluated once at collection time. The SESSION IS
// INITIALIZED BEFORE the reachability check: on an auth-required relay the
// health probe (a kind:0 querySync) is itself subject to NIP-42 AUTH, and
// the pool's automaticallyAuth signer (fix-plan 10) can only answer when a
// session key is active. Skip paths never initialize a session. The nsec
// VALUE is never logged — messages print presence/absence only.
const configComplete = relayUrl !== null && relayNsec !== null;
if (!configComplete) {
  console.info(
    `[nip46-ceps-bindings.integration] SKIPPED: NIP46_TEST_RELAY ${
      relayUrl === null ? 'is not set' : 'is set'
    } and NIP46_TEST_RELAY_NSEC ${
      relayNsec === null ? 'is not set' : 'is set'
    }. Both are required: the test relay demands NIP-42 AUTH (credentials-required pattern).`,
  );
}

let testIdentity: { secret: Uint8Array; pubkey: string } | null = null;
let sessionInitialized = false;
let relayReachable = false;

if (configComplete) {
  try {
    testIdentity = decodeTestNsec(relayNsec!);
  } catch {
    // SEC-014: static message only — never echo the library error, because
    // bech32 checksum-mismatch errors include the full input string (a
    // near-credential on console if the env value is corrupted).
    console.info(
      '[nip46-ceps-bindings.integration] SKIPPED: NIP46_TEST_RELAY_NSEC is not a valid nsec/64-hex secret (the value is not echoed; check the env var).',
    );
  }
  if (testIdentity) {
    await initializeSessionWithCeps(relayNsec!);
    sessionInitialized = true;
    relayReachable = await isRelayReachable(relayUrl!);
    if (!relayReachable) {
      console.info(
        `[nip46-ceps-bindings.integration] SKIPPED: NIP46_TEST_RELAY (${relayUrl}) is not reachable (the auth handshake may have failed or timed out).`,
      );
    }
  }
}

const runIntegration = configComplete && testIdentity !== null && relayReachable;

// The synthetic identity comes from the env seam and IS the session identity
// (relay auth binds the connection to it; the presence events are authored
// by the same key). The p-tag recipient stays a fresh ephemeral pubkey.
const SYNTHETIC_PUB = testIdentity?.pubkey ?? '';
const SYNTHETIC_CLIENT_PUB = getPublicKey(generateSecretKey());
const RELAYS = relayUrl === null ? [] : [relayUrl];

describe.skipIf(!runIntegration)('CEPS presence bindings — REAL-RELAY round-trip (Amendment 2.0, F-3)', () => {
  const signer = async (template: Nip46PresenceEventTemplate): Promise<unknown> => {
    // SAME identity as the CEPS session (fix-plan 10 Item C1): the relay
    // auth binds the connection to this identity; the presence event is
    // authored by the same key.
    return finalizeEvent(template as never, testIdentity!.secret);
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

afterAll(async () => {
  // Session teardown (zeroizes the in-memory session key and closes pool
  // relays). Runs even when the suite skipped — a session may have been
  // initialized before the reachability gate failed.
  if (sessionInitialized) {
    await endSessionWithCeps();
  }
});