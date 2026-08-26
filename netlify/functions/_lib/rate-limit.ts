// Shared Netlify function library — NOT a deployable function.

import { getSharedSupabaseClient } from './supabase-client';

/**
 * Cross-instance rate limiting (A-2 / founder W2-5 override, 2026-08-25).
 *
 * Two-tier design: each function KEEPS its process-local in-memory Map as
 * the first-line fast path (zero latency, absorbs bursts); this module adds
 * a SHARED Supabase-backed counter so ceilings hold across lambda instances
 * and cold starts on the endpoints that matter.
 *
 * ## Atomicity
 * Counting uses the `increment_rate_limit` RPC (migration 007): a single
 * INSERT .. ON CONFLICT DO UPDATE .. RETURNING — one round trip, no
 * read-modify-write race between concurrent instances.
 *
 * ## Windowing
 * FIXED windows (window_start = floor(now/windowMs)*windowMs). Deterministic
 * keying across instances; a client can burst at window boundaries (~2x
 * limit worst case) — accepted tradeoff vs per-key rolling state, consistent
 * with the existing in-memory tier's behavior class.
 *
 * ## OUTAGE POLICY — FAIL OPEN WITH ALERTING (deliberate contrast to
 * founder Decision 2's replay split)
 *
 * Rate limiting is DEFENSE-IN-DEPTH against abuse volume. It is NOT the
 * replay dedupe control, where an untracked execution is itself the threat:
 * during a limiter-store outage, requests proceed and are still bounded by
 * (a) the per-instance in-memory tier that stays up regardless and (b)
 * NIP-98 signature requirements + downstream business constraints. Failing
 * closed here would let any Supabase blip take down all five functions for
 * a purely volumetric protection — the opposite tradeoff of Decision 2,
 * which fails closed precisely BECAUSE replay-dedupe skip equals untracked
 * execution. Do NOT "fix" this by symmetry with Decision 2.
 */

/** How often (per instance) the opportunistic expired-window purge may run. */
const PURGE_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// Storage abstraction (unit tests inject in-memory implementations)
// ---------------------------------------------------------------------------

export type ConsumeOutcome = 'allowed' | 'blocked' | 'error';

export interface RateLimitStore {
  /**
   * Atomically consume one slot for (identifier, endpoint, windowStart).
   * Returns the outcome; 'error' means store unavailable (caller applies
   * the documented fail-open policy).
   */
  consume(
    identifier: string,
    endpoint: string,
    windowStartIso: string,
    limit: number,
  ): Promise<ConsumeOutcome>;

  /** Best-effort deletion of whole expired windows. Never throws. */
  purgeExpired(nowMs: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Core decision logic
// ---------------------------------------------------------------------------

export interface RateLimitParams {
  endpoint: string;
  /** Max requests per window. */
  limit: number;
  /** Window length in ms (fixed buckets). */
  windowMs: number;
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number };

let lastPurgeAtMs = 0;

/**
 * Consult the shared counter AFTER the in-memory fast path has admitted the
 * request. Applies the documented fail-open-with-alerting outage policy.
 */
export async function enforceSharedRateLimit(
  store: RateLimitStore,
  identifier: string,
  params: RateLimitParams,
  options?: { nowMs?: number },
): Promise<RateLimitDecision> {
  const nowMs = options?.nowMs ?? Date.now();
  const { endpoint, limit, windowMs } = params;

  if (!identifier || limit < 1 || windowMs < 1_000) {
    // Misconfiguration must never take endpoints down: alert + allow.
    console.error('[rate-limit] misconfigured limiter — allowing request:', { endpoint, limit, windowMs });
    return { allowed: true };
  }

  const trimmedId = identifier.trim();
  if (!trimmedId) {
    console.error('[rate-limit] empty identifier — allowing request:', endpoint);
    return { allowed: true };
  }

  // Opportunistic hygiene (time-guarded, never fatal).
  if (nowMs - lastPurgeAtMs >= PURGE_INTERVAL_MS) {
    lastPurgeAtMs = nowMs;
    try {
      await store.purgeExpired(nowMs);
    } catch (err) {
      console.warn('[rate-limit] purge failed (non-fatal):', err instanceof Error ? err.message : String(err));
    }
  }

  const bucketMs = Math.floor(nowMs / windowMs) * windowMs;
  const windowStartIso = new Date(bucketMs).toISOString();

  let outcome: ConsumeOutcome;
  try {
    outcome = await store.consume(trimmedId, endpoint, windowStartIso, limit);
  } catch (err) {
    console.error(
      '[rate-limit] counter threw — allowing request (fail-open):',
      err instanceof Error ? err.message : String(err),
    );
    return { allowed: true };
  }

  switch (outcome) {
    case 'allowed':
      return { allowed: true };
    case 'blocked': {
      const retryAfterSec = Math.max(1, Math.ceil((bucketMs + windowMs - nowMs) / 1000));
      console.error('[rate-limit] LIMIT EXCEEDED —', endpoint, trimmedId.slice(0, 12));
      return { allowed: false, retryAfterSec };
    }
    case 'error':
    default:
      console.error(
        '[rate-limit] counter store unavailable — allowing request (fail-open). '
        + 'Cross-instance ceiling degraded; per-instance map still active.',
      );
      return { allowed: true };
  }
}

// ---------------------------------------------------------------------------
// Supabase adapter (production store; migration 007 schema + RPC)
// ---------------------------------------------------------------------------

interface SupabaseRateLimitClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
  from(table: string): {
    delete(): {
      lt(column: string, value: string): Promise<{ error: { message?: string } | null }>;
    };
  };
}

/**
 * Production RateLimitStore backed by rate_limit_counters + the atomic
 * increment_rate_limit RPC (migration 007). Pass an existing client to reuse
 * it; otherwise a lazily-created service-role client from env is used; when
 * env is unconfigured every consume reports 'error' (→ documented fail-open).
 */
export function createSupabaseRateLimitStore(
  supabase?: SupabaseRateLimitClient | null,
): RateLimitStore {
  async function resolveClient(): Promise<SupabaseRateLimitClient | null> {
    if (supabase !== undefined && supabase !== null) return supabase;
    const resolved = await getSharedSupabaseClient();
    return (resolved as SupabaseRateLimitClient | null) ?? null;
  }

  return {
    async consume(identifier, endpoint, windowStartIso, limit): Promise<ConsumeOutcome> {
      const client = await resolveClient();
      if (!client) return 'error';
      try {
        const { data, error } = await client.rpc('increment_rate_limit', {
          p_identifier: identifier,
          p_endpoint: endpoint,
          p_window_start: windowStartIso,
          p_limit: limit,
        });
        if (error) {
          console.error('[rate-limit] rpc failed:', error.message ?? 'unknown error');
          return 'error';
        }
        const count = typeof data === 'number' ? data : Number(data);
        if (!Number.isFinite(count)) {
          console.error('[rate-limit] rpc returned non-numeric count:', String(data));
          return 'error';
        }
        return count <= limit ? 'allowed' : 'blocked';
      } catch (err) {
        console.error('[rate-limit] rpc threw:', err instanceof Error ? err.message : String(err));
        return 'error';
      }
    },

    async purgeExpired(nowMs): Promise<void> {
      const client = await resolveClient();
      if (!client) return;
      try {
        // Delete counters whose ENTIRE window ended before the cutoff.
        const cutoffIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
        await client.from('rate_limit_counters').delete().lt('window_start', cutoffIso);
      } catch (err) {
        console.warn('[rate-limit] purge threw (non-fatal):', err instanceof Error ? err.message : String(err));
      }
    },
  };
}
