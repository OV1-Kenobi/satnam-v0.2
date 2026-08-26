// Shared Netlify function library — NOT a deployable function (S9 invariant:
// the function-count test counts only *.ts files directly under
// netlify/functions/, and this lives in _lib/).

/**
 * NIP-98 replay dedupe (H-2 fix, 2026-08-25).
 *
 * verifyNip98 validates signature/URL/method/±60s-timestamp but has no
 * memory of consumed auth events, so a captured Authorization header replays
 * for up to ~120 seconds across all five authed functions. This module adds
 * a seen-nonce check keyed on the auth EVENT ID.
 *
 * ## Why not an in-memory Map
 *
 * Netlify functions are stateless and multi-instance: a process-local Map is
 * per-lambda-instance only. The authoritative store is the Supabase table
 * `nip98_seen_events` (event_id PRIMARY KEY — see migration
 * database/migrations/005_nip98_seen_events.sql). A single INSERT relying on
 * the primary-key constraint makes first-seen vs replay resolution atomic at
 * the storage layer even across concurrent instances.
 *
 * ## TTL
 *
 * NIP98_REPLAY_TTL_MS = 5 minutes ≥ worst-case replay span (±60s verify
 * window = 120s) plus realistic clock-skew margin. Rows older than the TTL
 * are dead weight (the window they guard has closed) and are purged.
 *
 * ## Outage policy — SPLIT, per founder Decision 2 (2026-08-25)
 *
 * The store being unavailable does NOT behave the same on every function.
 * Callers declare their posture via `outagePolicy`:
 *
 * - **'fail-closed'** — mutating endpoints (register-identity,
 *   issuer-registry POST, simpleproof-anchor): a store outage REJECTS the
 *   request ({ allowed: false, reason: 'store_unavailable' }); callers
 *   respond 503 + Retry-After. Rationale: a captured token must not get one
 *   untracked execution against state-mutating surfaces during an outage;
 *   identity rows and issuer upserts are exactly the H-2 forgery targets.
 * - **'fail-open'** — forwarders (nwc-proxy, unified-comms): request
 *   proceeds WITHOUT dedupe, console.error alert fires. Rationale: these
 *   surfaces never needed the DB before; byte-identical replays are partly
 *   neutralized downstream (relay event-id dedupe / idempotent forwarding),
 *   so availability damage from failing closed would be disproportionate to
 *   the bounded duplicate-forward nuisance.
 *
 * NOTE vs round-2 first implementation: this replaces the earlier global
 * fail-open default for ALL five functions after founder review. Missing or
 * malformed eventId still fails open under BOTH policies (it cannot happen
 * from the real verifier — ids are signature-covered hashes — and there is
 * no key to dedupe on); it alerts loudly either way.
 *
 * ## Privacy note
 *
 * Stored event ids are pseudonymous identifiers (64-char hex digests of
 * auth events). They are retained only for the TTL above and link to a
 * user identity no more strongly than the pubkey already present in the
 * request itself.
 */

import { getSharedSupabaseClient } from './supabase-client';

/** Replay protection TTL. Must be >= ±60s verify window + clock-skew margin. */
export const NIP98_REPLAY_TTL_MS = 5 * 60_000;

/** Minimum acceptable TTL given the verifier's ±60s window (2 × 60s). */
export const NIP98_REPLAY_MIN_TTL_MS = 2 * 60_000;

/** How often (per instance) the opportunistic expired-row purge may run. */
const PURGE_INTERVAL_MS = 60_000;

/** Hex event id format enforced by the NIP-98 spec (case-insensitive; normalized below). */
const EVENT_ID_REGEX = /^[0-9a-fA-F]{64}$/;

// ---------------------------------------------------------------------------
// Storage abstraction (dependency-injected; unit tests use an in-memory store)
// ---------------------------------------------------------------------------

export type TryRecordOutcome = 'inserted' | 'duplicate' | 'error';

export interface ReplayStore {
  /**
   * Atomically record an auth event id as consumed.
   * - 'inserted': first sighting — request may proceed.
   * - 'duplicate': primary-key conflict — REPLAY, reject.
   * - 'error': store unreachable/unexpected failure — caller applies the
   *   documented fail-open-with-alerting policy.
   */
  tryRecord(eventId: string, nowMs: number): Promise<TryRecordOutcome>;

  /** Best-effort deletion of rows older than the TTL. Never throws. */
  purgeExpired(nowMs: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Core decision logic (pure w.r.t. injected store)
// ---------------------------------------------------------------------------

/** Outage posture declared by the calling function (founder Decision 2). */
export type ReplayOutagePolicy = 'fail-open' | 'fail-closed';

export type ReplayDecision =
  | { allowed: true }
  | { allowed: false; reason: 'replay_detected' | 'store_unavailable' };

/** Module-level last-purge timestamp (per lambda instance). */
let lastPurgeAtMs = 0;

/**
 * Consult + record the auth event id AFTER verifyNip98 passes and BEFORE any
 * business logic. Applies the documented policies:
 * - duplicate → reject ({ allowed: false, reason: 'replay_detected' }).
 * - store error under 'fail-closed' → reject with 'store_unavailable'
 *   (caller responds 503 + Retry-After).
 * - store error under 'fail-open' (default) → ALLOW with console.error
 *   alerting.
 * - missing/malformed eventId → allow + alert under BOTH policies (no key
 *   exists to dedupe on; unreachable from the real verifier).
 * - opportunistically purges TTL-expired rows at most once per minute per
 *   instance; purge failures are logged at warn level and never fatal.
 */
export async function checkAndRecordAuthEvent(
  store: ReplayStore,
  eventId: string | undefined,
  options?: { nowMs?: number; outagePolicy?: ReplayOutagePolicy },
): Promise<ReplayDecision> {
  const nowMs = options?.nowMs ?? Date.now();
  const outagePolicy: ReplayOutagePolicy = options?.outagePolicy ?? 'fail-open';

  // Malformed / absent id: we cannot dedupe what we cannot key. Fail open
  // with an alert — signature verification already succeeded, so this can
  // only be a programming error or a hand-mocked outcome.
  if (!eventId || !EVENT_ID_REGEX.test(eventId)) {
    console.error(
      '[nip98-replay] missing or malformed auth eventId — replay dedupe skipped (fail-open)',
    );
    return { allowed: true };
  }

  // Opportunistic TTL hygiene (time-guarded, never fatal).
  if (nowMs - lastPurgeAtMs >= PURGE_INTERVAL_MS) {
    lastPurgeAtMs = nowMs;
    try {
      await store.purgeExpired(nowMs);
    } catch (err) {
      // purgeExpired implementations should swallow internally; this is a
      // second belt-and-braces guard so hygiene can never break requests.
      console.warn(
        '[nip98-replay] TTL purge failed (non-fatal):',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  let outcome: TryRecordOutcome;
  try {
    outcome = await store.tryRecord(eventId.toLowerCase(), nowMs);
  } catch (err) {
    console.error(
      '[nip98-replay] dedupe store threw —',
      outagePolicy === 'fail-closed'
        ? 'rejecting request (fail-closed policy)'
        : 'allowing request (fail-open):',
      err instanceof Error ? err.message : String(err),
    );
    return outagePolicy === 'fail-closed'
      ? { allowed: false, reason: 'store_unavailable' }
      : { allowed: true };
  }

  switch (outcome) {
    case 'inserted':
      return { allowed: true };
    case 'duplicate':
      console.error(
        '[nip98-replay] REPLAY detected — auth event id was already consumed',
      );
      return { allowed: false, reason: 'replay_detected' };
    case 'error':
    default:
      if (outagePolicy === 'fail-closed') {
        console.error(
          '[nip98-replay] dedupe store unavailable — REJECTING request '
          + '(fail-closed policy on mutating endpoint). Investigate Supabase connectivity.',
        );
        return { allowed: false, reason: 'store_unavailable' };
      }
      console.error(
        '[nip98-replay] dedupe store unavailable — allowing request (fail-open). '
        + 'Replay protection degraded; investigate Supabase connectivity.',
      );
      return { allowed: true };
  }
}

// ---------------------------------------------------------------------------
// Supabase adapter (production store)
// ---------------------------------------------------------------------------

/**
 * Structural surface of the Supabase client used by the adapter. Real
 * supabase-js query builders are thenable, so awaiting them satisfies these
 * promise-returning signatures; callers holding a full SupabaseClient cast
 * via `as unknown as SupabaseReplayClient`.
 */
export interface SupabaseReplayClient {
  from(table: string): {
    insert(row: unknown): Promise<{ error: { code?: string; message?: string } | null }>;
    delete(): {
      lt(column: string, value: string): Promise<{ error: { message?: string } | null }>;
    };
  };
}

/** Lazily-resolved shared client (delegates to _lib/supabase-client). */
let sharedClient: SupabaseReplayClient | null | undefined;

async function getSharedSupabase(): Promise<SupabaseReplayClient | null> {
  if (sharedClient !== undefined) return sharedClient;
  const resolved = (await getSharedSupabaseClient()) as SupabaseReplayClient | null;
  sharedClient = resolved ?? null;
  return sharedClient;
}

/**
 * Production ReplayStore backed by the nip98_seen_events Supabase table.
 *
 * @param supabase - Optional client to reuse (functions that already hold one,
 *   e.g. register-identity / issuer-registry). When omitted, a lazily-created
 *   service-role client from env is used; when env is unconfigured the store
 *   reports 'error' (→ documented fail-open behavior).
 */
export function createSupabaseReplayStore(
  supabase?: SupabaseReplayClient | null,
): ReplayStore {
  async function resolveClient(): Promise<SupabaseReplayClient | null> {
    if (supabase !== undefined && supabase !== null) return supabase;
    return getSharedSupabase();
  }

  return {
    async tryRecord(eventId, nowMs): Promise<TryRecordOutcome> {
      const client = await resolveClient();
      if (!client) return 'error';
      try {
        const { error } = await client.from('nip98_seen_events').insert({
          event_id: eventId,
          inserted_at: new Date(nowMs).toISOString(),
        });
        if (!error) return 'inserted';
        // PostgREST surfaces unique-violation as SQLSTATE 23505.
        if (
          error.code === '23505' ||
          /duplicate key|unique constraint/i.test(error.message ?? '')
        ) {
          return 'duplicate';
        }
        console.error(
          '[nip98-replay] insert failed:',
          error.message ?? 'unknown error',
        );
        return 'error';
      } catch (err) {
        console.error(
          '[nip98-replay] insert threw:',
          err instanceof Error ? err.message : String(err),
        );
        return 'error';
      }
    },

    async purgeExpired(nowMs): Promise<void> {
      const client = await resolveClient();
      if (!client) return;
      try {
        const cutoffIso = new Date(nowMs - NIP98_REPLAY_TTL_MS).toISOString();
        await client.from('nip98_seen_events').delete().lt('inserted_at', cutoffIso);
      } catch (err) {
        console.warn(
          '[nip98-replay] purge threw (non-fatal):',
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  };
}
