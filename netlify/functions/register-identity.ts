// Netlify function #4 of 8 (ceiling: S9 invariant)
// Auth: NIP-98 (MUST call verifyNip98 before any business logic — S10 invariant)

/**
 * Register Identity — Netlify Function
 * POST /.netlify/functions/register-identity
 *
 * Registers a NIP-05 identity and optional Lightning address for an
 * authenticated Nostr pubkey. The caller must provide a valid NIP-98
 * Authorization header signed by the key they are registering.
 *
 * Auth: NIP-98 required. No nsec is ever transmitted — only the pubkey
 * is extracted from the verified auth event. No key material is stored
 * in Supabase (S1 invariant).
 *
 * Rate limiting: per-pubkey (10/hour) enforced via Supabase rate_limits table.
 *
 * Body: { username: string, lud16?: string }
 * Returns: { success: true, nip05: "username@satnam.pub" }
 */

import type { Handler, HandlerResponse } from "@netlify/functions";
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyNip98 } from '../../src/lib/nip98/verify';

// ============================================================================
// Supabase client
// ============================================================================

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) {
    // SECURITY: Write operations require the service_role key.
    // Falling back to anon key would silently fail due to RLS, making
    // registrations appear to succeed while actually being rejected.
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured. Write operations require the service role key.');
  }
  return createClient(url, key);
}

// ============================================================================
// Constants
// ============================================================================

const NIP05_DOMAIN = process.env.NIP05_DOMAIN || process.env.VITE_NIP05_DOMAIN || 'satnam.pub';
// Layer 2 (2026-08-24, founder-directed): configurable domain whitelist —
// config-not-code. Initial entries per founder: openagents.com, sovereignhybridcompute.com.
const ALLOWED_NIP05_DOMAINS = new Set(
  (
    process.env.NIP05_DOMAINS ||
    process.env.VITE_NIP05_DOMAINS ||
    'satnam.pub,openagents.com,sovereignhybridcompute.com'
  )
    .split(',')
    .map((d) => d.trim().toLowerCase())
);
const DOMAIN_REGEX = /^[a-z0-9][a-z0-9\-.]{1,253}$/;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_PER_PUBKEY = 10; // 10 registrations/hour per pubkey
const RATE_LIMIT_WINDOW_IP_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_IP = 20;
const USERNAME_REGEX = /^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$|^[a-z0-9]{1,64}$/;
const MAX_USERNAME_LENGTH = 64;
const MIN_USERNAME_LENGTH = 3;
const LUD16_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ============================================================================
// Security headers (auth'd endpoint — no wildcard CORS)
// ============================================================================

// Layer 2 fix (2026-08-24): EXACT origin matching — startsWith() prefix matching
// admitted lookalike origins such as https://satnam.pub.evil.com
const ALLOWED_ORIGINS = new Set([
  `https://${NIP05_DOMAIN}`,
  'https://satnam.pub',
  'http://localhost:5173',
  'http://localhost:8888',
]);

function corsHeaders(origin?: string): Record<string, string> {
  const resolvedOrigin: string =
    origin && ALLOWED_ORIGINS.has(origin)
      ? origin
      : `https://${NIP05_DOMAIN}`;
  return {
    'Access-Control-Allow-Origin': resolvedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  };
}

function errorResponse(
  statusCode: number,
  message: string,
  origin?: string
): HandlerResponse {
  return {
    statusCode,
    headers: corsHeaders(origin),
    body: JSON.stringify({ success: false, error: message }),
  };
}

// ============================================================================
// IP-level rate limiting (in-memory guard)
// ============================================================================

const ipRateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    ipRateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_IP_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX_IP) return false;
  entry.count += 1;
  return true;
}

function getClientIP(headers: Record<string, string | undefined>): string {
  return (
    ((headers['x-forwarded-for'] || '').split(',')[0] ?? '').trim() ||
    (headers['x-real-ip'] ?? 'unknown')
  );
}

// ============================================================================
// Per-pubkey rate limiting (Supabase rate_limits table)
// ============================================================================

async function checkPubkeyRateLimit(
  supabase: SupabaseClient<any>,
  pubkey: string
): Promise<boolean> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();

  // Layer 2 fix (2026-08-24, C5 alignment): rate_limits columns are
  // identifier / endpoint / window_start / request_count per migration 001,
  // aggregated as one row per (identifier, endpoint, hour).
  // Previous code queried nonexistent pubkey/action/created_at columns,
  // which always errored and (combined with fail-open) disabled limiting.
  const { data, error } = await supabase
    .from('rate_limits')
    .select('request_count')
    .eq('identifier', pubkey)
    .eq('endpoint', 'register-identity')
    .gte('window_start', windowStart);

  if (error) {
    // Layer 2 fix: FAIL CLOSED on DB error. The previous fail-open posture let a
    // persistent DB fault silently disable the per-pubkey limit entirely.
    console.error('[register-identity] rate limit check error (failing closed):', error.message);
    return false;
  }

  const total = (data ?? []).reduce((sum, row) => sum + ((row as { request_count?: number }).request_count ?? 0), 0);
  return total < RATE_LIMIT_MAX_PER_PUBKEY;
}

async function recordRateLimitEvent(
  supabase: SupabaseClient<any>,
  pubkey: string,
  _ip: string
): Promise<void> {
  // C5 alignment: read-modify-write increment of the hourly aggregate row.
  // (Supabase JS has no atomic increment without an RPC; a lost update here
  // only undercounts by one within the same second — acceptable for this limit.)
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);
  const iso = windowStart.toISOString();

  const { data: existing } = await supabase
    .from('rate_limits')
    .select('request_count')
    .eq('identifier', pubkey)
    .eq('endpoint', 'register-identity')
    .eq('window_start', iso)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('rate_limits')
      .update({ request_count: ((existing as { request_count?: number }).request_count ?? 0) + 1 })
      .eq('identifier', pubkey)
      .eq('endpoint', 'register-identity')
      .eq('window_start', iso);
  } else {
    await supabase.from('rate_limits').insert({
      identifier: pubkey,
      endpoint: 'register-identity',
      window_start: iso,
      request_count: 1,
    });
  }
}

// ============================================================================
// Username validation
// ============================================================================

function validateUsername(name: string): string | null {
  if (!name) return 'Username is required';
  if (name.length < MIN_USERNAME_LENGTH) {
    return `Username must be at least ${MIN_USERNAME_LENGTH} characters`;
  }
  if (name.length > MAX_USERNAME_LENGTH) {
    return `Username must be at most ${MAX_USERNAME_LENGTH} characters`;
  }
  if (!USERNAME_REGEX.test(name)) {
    return 'Username must be lowercase alphanumeric with hyphens or underscores only';
  }
  const reserved = ['admin', 'root', 'satnam', 'support', 'help', 'system', 'nostr', 'bitcoin', 'api', 'www'];
  if (reserved.includes(name.toLowerCase())) {
    return 'This username is reserved';
  }
  return null;
}

// ============================================================================
// Handler
// ============================================================================

export const handler: Handler = async (event): Promise<HandlerResponse> => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const clientIP = getClientIP(event.headers as Record<string, string | undefined>);

  console.log('[register-identity] request', {
    method: event.httpMethod,
    ip: clientIP,
    timestamp: new Date().toISOString(),
  });

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(requestOrigin),
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return errorResponse(405, 'Method not allowed', requestOrigin);
  }

  // IP rate limit (fast path before NIP-98 verification)
  if (!checkIpRateLimit(clientIP)) {
    return errorResponse(429, 'Rate limit exceeded. Try again in a minute.', requestOrigin);
  }

  // ── NIP-98 Authentication (MUST be called before any business logic — S10) ──
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const requestUrl = `https://${event.headers?.host || NIP05_DOMAIN}/.netlify/functions/register-identity`;
  const bodyBytes = event.body
    ? new TextEncoder().encode(event.isBase64Encoded ? atob(event.body) : event.body)
    : undefined;

  const authOutcome = verifyNip98(authHeader, requestUrl, 'POST', bodyBytes);
  if (!authOutcome.authenticated) {
    console.log('[register-identity] auth failed:', authOutcome.reason);
    return errorResponse(401, `Unauthorized: ${authOutcome.reason}`, requestOrigin);
  }

  const pubkey = authOutcome.pubkey;

  // ── Parse + validate request body (action-routed per plan CR-A/CR-H) ──
  // Layer 2: action routing keeps the ≤8-function ceiling (S9). Supported:
  //   register (default) — new NIP-05 identity
  //   update             — change lud16 / reactivate on an owned username
  let body: { action?: string; username?: string; lud16?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return errorResponse(400, 'Invalid JSON body', requestOrigin);
  }

  const action = (body.action || 'register').toLowerCase();
  if (!['register', 'update'].includes(action)) {
    return errorResponse(400, `Unsupported action: ${action}`, requestOrigin);
  }

  const username = (body.username || '').trim().toLowerCase();
  const lud16 = body.lud16?.trim();
  // Whitelist-aware domain (CR-A): defaults to primary domain; must be whitelisted.
  const requestedDomain = ((body as { domain?: string }).domain || NIP05_DOMAIN).trim().toLowerCase();

  if (!DOMAIN_REGEX.test(requestedDomain) || !ALLOWED_NIP05_DOMAINS.has(requestedDomain)) {
    return errorResponse(403, `Domain not whitelisted: ${requestedDomain}`, requestOrigin);
  }

  const usernameError = validateUsername(username);
  if (usernameError) {
    return errorResponse(400, usernameError, requestOrigin);
  }

  if (lud16 && !LUD16_REGEX.test(lud16)) {
    return errorResponse(400, 'Invalid Lightning address format (expected user@domain.tld)', requestOrigin);
  }

  const supabase = getSupabase();

  // ── Per-pubkey rate limit (Supabase) ──
  const withinLimit = await checkPubkeyRateLimit(supabase, pubkey);
  if (!withinLimit) {
    return errorResponse(429, 'Rate limit exceeded: max 10 registrations per hour per identity.', requestOrigin);
  }

  // ── Action routing: update path (owner-only mutation, no new identity) ──
  if (action === 'update') {
    const { data: owned, error: ownedErr } = await supabase
      .from('nip05_identifiers')
      .select('username')
      .eq('username', username)
      .eq('pubkey', pubkey)
      .eq('is_active', true)
      .maybeSingle();

    if (ownedErr) {
      console.error('[register-identity] DB error (ownership check):', ownedErr.message);
      return errorResponse(500, 'Internal server error', requestOrigin);
    }
    if (!owned) {
      return errorResponse(403, 'Username is not registered to this pubkey', requestOrigin);
    }

    if (lud16) {
      if (!LUD16_REGEX.test(lud16)) {
        return errorResponse(400, 'Invalid Lightning address format (expected user@domain.tld)', requestOrigin);
      }
      const lud16Domain = lud16.split('@')[1] ?? NIP05_DOMAIN;
      const { error: updErr } = await supabase
        .from('lightning_addresses')
        .upsert({
          username,
          lnurl_callback: `https://${lud16Domain}/.well-known/lnurlp/${username}`,
          min_sendable_msats: 1000,
          max_sendable_msats: 100000000000,
          metadata_json: JSON.stringify([['text/identifier', `${lud16}`]]),
        });
      if (updErr) {
        console.error('[register-identity] DB error (update lightning):', updErr.message);
        return errorResponse(500, 'Internal server error', requestOrigin);
      }
    }

    await recordRateLimitEvent(supabase, pubkey, clientIP);
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(requestOrigin),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({ success: true, nip05: `${username}@${NIP05_DOMAIN}`, ...(lud16 ? { lud16 } : {}) }),
    };
  }

  // ── Check username availability (active identifiers, whitelist-scoped) ──
  const { data: existingIdent, error: identCheckErr } = await supabase
    .from('nip05_identifiers')
    .select('username')
    .eq('username', username)
    .eq('domain', requestedDomain)
    .eq('is_active', true)
    .maybeSingle();

  if (identCheckErr) {
    console.error('[register-identity] DB error (availability check):', identCheckErr.message);
    return errorResponse(500, 'Internal server error', requestOrigin);
  }

  if (existingIdent) {
    return errorResponse(409, 'Username already registered', requestOrigin);
  }

  // ── Check if pubkey already has an active identity ──
  const { data: existingPubkey, error: pubkeyCheckErr } = await supabase
    .from('nip05_identifiers')
    .select('username')
    .eq('pubkey', pubkey)
    .eq('is_active', true)
    .maybeSingle();

  if (pubkeyCheckErr) {
    console.error('[register-identity] DB error (pubkey check):', pubkeyCheckErr.message);
    return errorResponse(500, 'Internal server error', requestOrigin);
  }

  if (existingPubkey) {
    return errorResponse(409, `Pubkey already registered as ${existingPubkey.username}@${NIP05_DOMAIN}`, requestOrigin);
  }

  // ── Check username_reservations (active reservation for another pubkey) ──
  const { data: reservation, error: resCheckErr } = await supabase
    .from('username_reservations')
    .select('pubkey, expires_at')
    .eq('username', username)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (resCheckErr) {
    console.error('[register-identity] DB error (reservation check):', resCheckErr.message);
    return errorResponse(500, 'Internal server error', requestOrigin);
  }

  if (reservation && reservation.pubkey !== pubkey) {
    return errorResponse(409, 'Username temporarily reserved by another user', requestOrigin);
  }

  // ── Insert into nip05_identifiers ──
  const { error: insertErr } = await supabase.from('nip05_identifiers').insert({
    username,
    pubkey,
    domain: requestedDomain,
    is_active: true,
    created_at: new Date().toISOString(),
  });

  if (insertErr) {
    // Handle unique constraint violation (race condition)
    if (insertErr.code === '23505') {
      return errorResponse(409, 'Username already registered (race condition)', requestOrigin);
    }
    console.error('[register-identity] DB error (insert nip05):', insertErr.message);
    return errorResponse(500, 'Internal server error', requestOrigin);
  }

  // ── Insert Lightning address if provided ──
  if (lud16) {
    // C5 alignment (2026-08-24): lightning_addresses columns per migration 001 are
    // username (FK), lnurl_callback, min/max_sendable_msats, metadata_json.
    // The previous insert used nonexistent pubkey/lud16 columns.
    // LUD-16 → LUD-06 callback: https://<domain>/.well-known/lnurlp/<username>
    const lud16Domain = lud16.split('@')[1] ?? NIP05_DOMAIN;
    const { error: lnErr } = await supabase.from('lightning_addresses').insert({
      username,
      lnurl_callback: `https://${lud16Domain}/.well-known/lnurlp/${username}`,
      min_sendable_msats: 1000,
      max_sendable_msats: 100000000000,
      metadata_json: JSON.stringify([
        ['text/identifier', `${lud16}`],
      ]),
    });

    if (lnErr) {
      // Non-fatal: NIP-05 registered; Lightning address failed
      console.error('[register-identity] DB error (insert lightning):', lnErr.message);
    }
  }

  // ── Clean up any expired reservation for this username ──
  await supabase
    .from('username_reservations')
    .delete()
    .eq('username', username);

  // ── Record rate limit event ──
  await recordRateLimitEvent(supabase, pubkey, clientIP);

  const nip05 = `${username}@${requestedDomain}`;

  console.log('[register-identity] registered', { username, nip05 });

  return {
    statusCode: 201,
    headers: {
      ...corsHeaders(requestOrigin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      success: true,
      nip05,
      ...(lud16 ? { lud16 } : {}),
    }),
  };
};



