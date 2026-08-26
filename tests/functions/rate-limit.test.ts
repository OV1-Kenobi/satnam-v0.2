/**
 * @file rate-limit.test.ts
 * @description Unit tests for the shared cross-instance rate limiter
 * (A-2 / founder W2.1 override). Covers allow/block/window-reset and the
 * DOCUMENTED FAIL-OPEN outage policy, plus the Supabase adapter's RPC
 * mapping. No live Supabase — storage is injected or hand-mocked.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  enforceSharedRateLimit,
  createSupabaseRateLimitStore,
  type RateLimitStore,
  type ConsumeOutcome,
} from '../../netlify/functions/_lib/rate-limit';

const PARAMS = { endpoint: 'register-identity', limit: 3, windowMs: 60_000 };

// ---------------------------------------------------------------------------
// In-memory store mirroring the RPC semantics (count per fixed window)
// ---------------------------------------------------------------------------

class InMemoryRateLimitStore implements RateLimitStore {
  readonly counts = new Map<string, number>();
  failNext = false;
  throwNext = false;

  async consume(
    identifier: string,
    endpoint: string,
    windowStartIso: string,
    _limit: number,
  ): Promise<ConsumeOutcome> {
    if (this.throwNext) {
      this.throwNext = false;
      throw new Error('store exploded');
    }
    if (this.failNext) {
      this.failNext = false;
      return 'error';
    }
    const key = `${identifier}|${endpoint}|${windowStartIso}`;
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next <= _limit ? 'allowed' : 'blocked';
  }

  async purgeExpired(_nowMs: number): Promise<void> {}
}

describe('enforceSharedRateLimit', () => {
  const T0 = 1_700_000_000_000; // aligned anywhere; buckets derive from it

  it('allows requests under the limit', async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < PARAMS.limit; i++) {
      const d = await enforceSharedRateLimit(store, '1.2.3.4', PARAMS, { nowMs: T0 });
      expect(d).toEqual({ allowed: true });
    }
  });

  it('blocks the request that exceeds the limit, with Retry-After within the window', async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < PARAMS.limit; i++) {
      await enforceSharedRateLimit(store, '1.2.3.4', PARAMS, { nowMs: T0 });
    }
    const d = await enforceSharedRateLimit(store, '1.2.3.4', PARAMS, { nowMs: T0 + 5_000 });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.retryAfterSec).toBeGreaterThanOrEqual(1);
      expect(d.retryAfterSec).toBeLessThanOrEqual(60);
    }
  });

  it('resets on a new window (fixed, epoch-aligned buckets)', async () => {
    const store = new InMemoryRateLimitStore();
    // Align test times to the bucket grid the limiter actually uses.
    const BUCKET = Math.floor(T0 / PARAMS.windowMs) * PARAMS.windowMs;
    const inBucket = (offsetMs: number) => BUCKET + offsetMs;

    for (let i = 0; i < PARAMS.limit; i++) {
      await enforceSharedRateLimit(store, '1.2.3.4', PARAMS, { nowMs: inBucket(1_000) });
    }
    // Same bucket: still blocked
    expect(
      (await enforceSharedRateLimit(store, '1.2.3.4', PARAMS, { nowMs: inBucket(59_000) })).allowed,
    ).toBe(false);
    // Next bucket: fresh allowance
    expect(
      await enforceSharedRateLimit(store, '1.2.3.4', PARAMS, { nowMs: inBucket(PARAMS.windowMs + 1_000) }),
    ).toEqual({ allowed: true });
  });

  it('tracks identifiers independently', async () => {
    const store = new InMemoryRateLimitStore();
    for (let i = 0; i < PARAMS.limit; i++) {
      await enforceSharedRateLimit(store, '1.1.1.1', PARAMS, { nowMs: T0 });
    }
    expect(await enforceSharedRateLimit(store, '2.2.2.2', PARAMS, { nowMs: T0 })).toEqual({ allowed: true });
    expect((await enforceSharedRateLimit(store, '1.1.1.1', PARAMS, { nowMs: T0 })).allowed).toBe(false);
  });

  it("FAILS OPEN on store outcome 'error' (documented policy — NOT the replay split)", async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const store = new InMemoryRateLimitStore();
      store.failNext = true;
      expect(await enforceSharedRateLimit(store, '1.2.3.4', PARAMS, { nowMs: T0 })).toEqual({ allowed: true });
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('fail-open'));
    } finally {
      errSpy.mockRestore();
    }
  });

  it('FAILS OPEN when the store throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const store = new InMemoryRateLimitStore();
      store.throwNext = true;
      expect(await enforceSharedRateLimit(store, '1.2.3.4', PARAMS, { nowMs: T0 })).toEqual({ allowed: true });
    } finally {
      errSpy.mockRestore();
    }
  });

  it('fails open on misconfiguration (limit < 1) instead of taking endpoints down', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const store = new InMemoryRateLimitStore();
      expect(
        await enforceSharedRateLimit(store, '1.2.3.4', { ...PARAMS, limit: 0 }, { nowMs: T0 }),
      ).toEqual({ allowed: true });
      expect(store.counts.size).toBe(0);
    } finally {
      errSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Supabase adapter mapping (hand-built client — no live Supabase)
// ---------------------------------------------------------------------------

function makeRpcClient(results: Array<{ data?: unknown; error?: { message?: string } | null }>) {
  let call = 0;
  const ltCalls: Array<[string, string]> = [];
  return {
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      expect(_fn).toBe('increment_rate_limit');
      void args;
      const r = results[Math.min(call, results.length - 1)] ?? {};
      call++;
      return { data: r.data ?? null, error: r.error ?? null };
    },
    from: (table: string) => ({
      delete: () => ({
        lt: async (column: string, value: string) => {
          expect(table).toBe('rate_limit_counters');
          ltCalls.push([column, value]);
          return { error: null };
        },
      }),
    }),
    ltCalls,
  };
}

describe('createSupabaseRateLimitStore', () => {
  it("maps count <= limit to 'allowed'", async () => {
    const db = makeRpcClient([{ data: 2 }]);
    const store = createSupabaseRateLimitStore(db as never);
    expect(await store.consume('1.2.3.4', 'e', new Date(0).toISOString(), 3)).toBe('allowed');
  });

  it("maps count > limit to 'blocked'", async () => {
    const db = makeRpcClient([{ data: 4 }]);
    const store = createSupabaseRateLimitStore(db as never);
    expect(await store.consume('1.2.3.4', 'e', new Date(0).toISOString(), 3)).toBe('blocked');
  });

  it("maps rpc errors to 'error' (→ fail-open at decision layer)", async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const db = makeRpcClient([{ error: { message: 'relation does not exist' } }]);
      const store = createSupabaseRateLimitStore(db as never);
      expect(await store.consume('1.2.3.4', 'e', new Date(0).toISOString(), 3)).toBe('error');
    } finally {
      errSpy.mockRestore();
    }
  });

  it("maps non-numeric rpc payloads to 'error' defensively", async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const db = makeRpcClient([{ data: 'garbage' }]);
      const store = createSupabaseRateLimitStore(db as never);
      expect(await store.consume('1.2.3.4', 'e', new Date(0).toISOString(), 3)).toBe('error');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('purgeExpired deletes counters older than the retention cutoff', async () => {
    const db = makeRpcClient([]);
    const store = createSupabaseRateLimitStore(db as never);
    const now = Date.now();
    await store.purgeExpired(now);
    const [column, cutoffIso] = db.ltCalls[0]!;
    expect(column).toBe('window_start');
    expect(new Date(cutoffIso).getTime()).toBeLessThanOrEqual(now - 24 * 60 * 60 * 1000);
  });

  it("reports 'error' without env-configured client", async () => {
    const savedUrl = process.env.SUPABASE_URL;
    const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    try {
      vi.resetModules();
      const { createSupabaseRateLimitStore: freshStore } = await import(
        '../../netlify/functions/_lib/rate-limit'
      );
      expect(await freshStore().consume('1.2.3.4', 'e', new Date(0).toISOString(), 3)).toBe('error');
    } finally {
      if (savedUrl) process.env.SUPABASE_URL = savedUrl;
      if (savedKey) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
      vi.resetModules();
    }
  });
});
