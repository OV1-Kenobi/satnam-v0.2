/**
 * @file nip98-replay.test.ts
 * @description Unit tests for the NIP-98 replay-dedupe helper (H-2 fix).
 *
 * Covers the decision logic (hit/miss/expiry/outage fallback) against a
 * mocked in-memory store and the Supabase adapter's error mapping.
 * NO live Supabase is required — storage is injected or hand-mocked.
 *
 * Policy under test (documented in netlify/functions/_lib/nip98-replay.ts):
 * - duplicate auth event id → reject (replay_detected)
 * - first sighting → allow
 * - TTL-expired rows purged → same id allowed again after expiry
 * - store outage → FAIL OPEN with alerting (availability tradeoff documented)
 */

import { describe, it, expect, vi } from 'vitest';

import {
  checkAndRecordAuthEvent,
  createSupabaseReplayStore,
  NIP98_REPLAY_TTL_MS,
  NIP98_REPLAY_MIN_TTL_MS,
  type ReplayStore,
  type TryRecordOutcome,
} from '../../netlify/functions/_lib/nip98-replay';

const EVENT_ID = 'b'.repeat(64);

// ---------------------------------------------------------------------------
// In-memory ReplayStore mimicking nip98_seen_events semantics
// ---------------------------------------------------------------------------

class InMemoryReplayStore implements ReplayStore {
  readonly rows = new Map<string, number>();
  failNextTryRecord = false;
  throwNextTryRecord = false;

  async tryRecord(eventId: string, nowMs: number): Promise<TryRecordOutcome> {
    if (this.throwNextTryRecord) {
      this.throwNextTryRecord = false;
      throw new Error('store exploded');
    }
    if (this.failNextTryRecord) {
      this.failNextTryRecord = false;
      return 'error';
    }
    if (this.rows.has(eventId)) return 'duplicate';
    this.rows.set(eventId, nowMs);
    return 'inserted';
  }

  async purgeExpired(nowMs: number): Promise<void> {
    for (const [id, ts] of [...this.rows.entries()]) {
      if (nowMs - ts > NIP98_REPLAY_TTL_MS) this.rows.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Decision logic
// ---------------------------------------------------------------------------

describe('checkAndRecordAuthEvent', () => {
  it('allows a first-sighting event id', async () => {
    const store = new InMemoryReplayStore();
    const decision = await checkAndRecordAuthEvent(store, EVENT_ID, { nowMs: 1_000_000 });
    expect(decision).toEqual({ allowed: true });
    expect(store.rows.has(EVENT_ID)).toBe(true);
  });

  it('rejects a replayed event id as replay_detected', async () => {
    const store = new InMemoryReplayStore();
    const t0 = 1_000_000;
    await checkAndRecordAuthEvent(store, EVENT_ID, { nowMs: t0 });

    const second = await checkAndRecordAuthEvent(store, EVENT_ID, { nowMs: t0 + 1000 });
    expect(second).toEqual({ allowed: false, reason: 'replay_detected' });
  });

  it('allows the same id again after the TTL expires (purge path)', async () => {
    const store = new InMemoryReplayStore();
    const t0 = 1_000_000;
    await checkAndRecordAuthEvent(store, EVENT_ID, { nowMs: t0 });
    expect(
      await checkAndRecordAuthEvent(store, EVENT_ID, { nowMs: t0 + 5000 }),
    ).toEqual({ allowed: false, reason: 'replay_detected' });

    // After TTL the guarded window has closed; purge drops the row and the
    // id may be consumed again (it is a NEW auth event reusing nothing).
    const tLater = t0 + NIP98_REPLAY_TTL_MS + 1;
    await checkAndRecordAuthEvent(store, 'c'.repeat(64), { nowMs: tLater }); // triggers purge
    expect(store.rows.has(EVENT_ID)).toBe(false);
    expect(
      await checkAndRecordAuthEvent(store, EVENT_ID, { nowMs: tLater }),
    ).toEqual({ allowed: true });
  });

  it("FAILS OPEN under 'fail-open' policy on store outcome 'error' (forwarders)", async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const store = new InMemoryReplayStore();
      store.failNextTryRecord = true;
      const decision = await checkAndRecordAuthEvent(store, EVENT_ID, {
        nowMs: 1_000_000,
        outagePolicy: 'fail-open',
      });
      expect(decision).toEqual({ allowed: true });
      // Single-argument alert line from the documented fail-open policy
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('fail-open'),
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it("FAILS CLOSED under 'fail-closed' policy on store outcome 'error' (mutating endpoints)", async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const store = new InMemoryReplayStore();
      store.failNextTryRecord = true;
      const decision = await checkAndRecordAuthEvent(store, EVENT_ID, {
        nowMs: 1_000_000,
        outagePolicy: 'fail-closed',
      });
      expect(decision).toEqual({ allowed: false, reason: 'store_unavailable' });
      expect(errSpy).toHaveBeenCalledWith(
        expect.stringContaining('fail-closed'),
      );
    } finally {
      errSpy.mockRestore();
    }
  });

  it("FAILS CLOSED under 'fail-closed' policy when the store throws", async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const store = new InMemoryReplayStore();
      store.throwNextTryRecord = true;
      const decision = await checkAndRecordAuthEvent(store, EVENT_ID, {
        nowMs: 1_000_000,
        outagePolicy: 'fail-closed',
      });
      expect(decision).toEqual({ allowed: false, reason: 'store_unavailable' });
    } finally {
      errSpy.mockRestore();
    }
  });

  it('missing/malformed eventId fails open under BOTH policies (no key to dedupe on)', async () => {
    const store = new InMemoryReplayStore();

    expect(
      await checkAndRecordAuthEvent(store, 'not-hex', { outagePolicy: 'fail-closed' }),
    ).toEqual({ allowed: true });
    expect(
      await checkAndRecordAuthEvent(store, undefined, { outagePolicy: 'fail-closed' }),
    ).toEqual({ allowed: true });
  });

  it('skips dedupe (fail-open) for missing/malformed eventId without touching the store', async () => {
    const store = new InMemoryReplayStore();
    const trySpy = vi.spyOn(store, 'tryRecord');

    expect(await checkAndRecordAuthEvent(store, undefined)).toEqual({ allowed: true });
    expect(await checkAndRecordAuthEvent(store, 'not-hex')).toEqual({ allowed: true });
    // 64 chars but not valid hex — must never be recorded:
    expect(await checkAndRecordAuthEvent(store, `${'A'.repeat(63)}z`)).toEqual({ allowed: true });

    expect(trySpy).not.toHaveBeenCalled();
    expect(store.rows.size).toBe(0);
  });

  it('normalizes uppercase event ids to lowercase before storing', async () => {
    const store = new InMemoryReplayStore();
    const upper = EVENT_ID.toUpperCase();
    await checkAndRecordAuthEvent(store, upper, { nowMs: 1_000_000 });
    expect(store.rows.has(EVENT_ID)).toBe(true);

    // Same id in lowercase is then correctly detected as replay
    const again = await checkAndRecordAuthEvent(store, EVENT_ID, { nowMs: 1_000_001 });
    expect(again).toEqual({ allowed: false, reason: 'replay_detected' });
  });

  it('TTL constant satisfies verify-window + skew margin invariant', () => {
    expect(NIP98_REPLAY_TTL_MS).toBeGreaterThanOrEqual(NIP98_REPLAY_MIN_TTL_MS);
    expect(NIP98_REPLAY_MIN_TTL_MS).toBe(120_000); // ±60s window both directions
  });
});

// ---------------------------------------------------------------------------
// Supabase adapter error mapping (hand-built client — no live Supabase)
// ---------------------------------------------------------------------------

function makeSupabaseMock(insertResults: Array<{ code?: string; message?: string } | null>) {
  const ltCalls: Array<[string, string]> = [];
  let call = 0;
  return {
    from: (table: string) => ({
      insert: async (_row: unknown) => {
        expect(table).toBe('nip98_seen_events');
        const error = insertResults[Math.min(call, insertResults.length - 1)] ?? null;
        call++;
        return { error };
      },
      delete: () => ({
        lt: async (column: string, value: string) => {
          ltCalls.push([column, value]);
          return { error: null };
        },
      }),
    }),
    ltCalls,
  };
}

describe('createSupabaseReplayStore', () => {
  it('maps successful insert to "inserted"', async () => {
    const db = makeSupabaseMock([null]);
    const store = createSupabaseReplayStore(db as never);
    expect(await store.tryRecord(EVENT_ID, Date.now())).toBe('inserted');
  });

  it('maps unique-violation (23505) to "duplicate"', async () => {
    const db = makeSupabaseMock([{ code: '23505', message: 'duplicate key value violates unique constraint' }]);
    const store = createSupabaseReplayStore(db as never);
    expect(await store.tryRecord(EVENT_ID, Date.now())).toBe('duplicate');
  });

  it('treats other DB errors as "error" (→ fail-open at decision layer)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const db = makeSupabaseMock([{ code: '42P01', message: 'relation does not exist' }]);
      const store = createSupabaseReplayStore(db as never);
      expect(await store.tryRecord(EVENT_ID, Date.now())).toBe('error');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('reports "error" when no client can be resolved (env unset)', async () => {
    const savedUrl = process.env.SUPABASE_URL;
    const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const savedAnon = process.env.SUPABASE_ANON_KEY;
    const savedViteUrl = process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;

    try {
      // Fresh module instance so the memoized shared client resets.
      vi.resetModules();
      const { createSupabaseReplayStore: freshStore } = await import(
        '../../netlify/functions/_lib/nip98-replay'
      );
      const store = freshStore();
      expect(await store.tryRecord(EVENT_ID, Date.now())).toBe('error');
      await expect(store.purgeExpired(Date.now())).resolves.toBeUndefined();
    } finally {
      if (savedUrl) process.env.SUPABASE_URL = savedUrl;
      if (savedKey) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
      if (savedAnon) process.env.SUPABASE_ANON_KEY = savedAnon;
      if (savedViteUrl) process.env.VITE_SUPABASE_URL = savedViteUrl;
      vi.resetModules();
    }
  });

  it('purgeExpired deletes rows older than the TTL cutoff', async () => {
    const db = makeSupabaseMock([]);
    const store = createSupabaseReplayStore(db as never);
    const now = Date.now();
    await store.purgeExpired(now);
    expect(db.ltCalls.length).toBeGreaterThan(0);
    const [column, cutoffIso] = db.ltCalls[0]!;
    expect(column).toBe('inserted_at');
    expect(new Date(cutoffIso).getTime()).toBe(now - NIP98_REPLAY_TTL_MS);
  });
});
