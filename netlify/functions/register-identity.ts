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
import { checkAndRecordAuthEvent, createSupabaseReplayStore, type SupabaseReplayClient } from './_lib/nip98-replay';

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

const NIP05_DOMAIN = process.env.NIP05_DOMAIN || process.env.VITE_NIP05_DOMAIN || 'satnam.pub'; // legacy, kept for ALLOWED_ORIGINS
// 004 (2026-08-25): unified categorizer — my.* = human, our.* = family/group, agent.* = agent
// Whitelist is root_domain ONLY (config-not-code via NIP05_ROOT_DOMAINS). Subdomain is code allow-list.
const DEFAULT_ROOT_DOMAIN = process.env.NIP05_ROOT_DOMAIN || process.env.NIP05_DOMAIN || process.env.VITE_NIP05_ROOT_DOMAIN || process.env.VITE_NIP05_DOMAIN || 'satnam.pub';
const ROOT_WHITELIST = new Set(
  (
    process.env.NIP05_ROOT_DOMAINS ||
    process.env.NIP05_DOMAINS ||
    process.env.VITE_NIP05_ROOT_DOMAINS ||
    process.env.VITE_NIP05_DOMAINS ||
    'satnam.pub,openagents.com,sovereignhybridcompute.com'
  )
    .split(',')
    .map((d) => d.trim().toLowerCase())
);
const SUBDOMAIN_ALLOW = new Set(['my', 'our', 'agent']);
// Root domain format is enforced by ROOT_WHITELIST membership for auto-created rows;
// imported LN addresses bypass the whitelist but must still be a valid host (checked via URL parsing).
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
// 004: allow my./our./agent. subdomains for all whitelisted roots
const ALLOWED_ORIGINS = new Set([
  `https://${NIP05_DOMAIN}`,
  `https://my.${DEFAULT_ROOT_DOMAIN}`,
  `https://our.${DEFAULT_ROOT_DOMAIN}`,
  `https://agent.${DEFAULT_ROOT_DOMAIN}`,
  'https://satnam.pub',
  'https://my.satnam.pub',
  'https://our.satnam.pub',
  'https://agent.satnam.pub',
  'https://my.openagents.com',
  'https://our.openagents.com',
  'https://agent.openagents.com',
  'https://my.sovereignhybridcompute.com',
  'https://our.sovereignhybridcompute.com',
  'https://agent.sovereignhybridcompute.com',
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
  const requestUrl = `https://${event.headers?.host || DEFAULT_ROOT_DOMAIN}/.netlify/functions/register-identity`;
  const bodyBytes = event.body
    ? new TextEncoder().encode(event.isBase64Encoded ? atob(event.body) : event.body)
    : undefined;

  const authOutcome = verifyNip98(authHeader, requestUrl, 'POST', bodyBytes);
  if (!authOutcome.authenticated) {
    console.log('[register-identity] auth failed:', authOutcome.reason);
    return errorResponse(401, `Unauthorized: ${authOutcome.reason}`, requestOrigin);
  }

  const pubkey = authOutcome.pubkey;

  // Supabase client needed by every action branch below.
  const supabase = getSupabase();

  // ── NIP-98 replay dedupe (H-2 fix, 2026-08-25; split policy per founder
  //    Decision 2): mutating endpoint → FAIL-CLOSED. Store outage = 503 so a
  //    captured token never gets an untracked execution here. ──
  if (authOutcome.eventId) {
    const replay = await checkAndRecordAuthEvent(
      createSupabaseReplayStore(supabase as unknown as SupabaseReplayClient),
      authOutcome.eventId,
      { outagePolicy: 'fail-closed' },
    );
    if (!replay.allowed) {
      if (replay.reason === 'store_unavailable') {
        return {
          statusCode: 503,
          headers: { ...corsHeaders(requestOrigin), 'Retry-After': '30', 'Cache-Control': 'no-store' },
          body: JSON.stringify({ success: false, error: 'Replay protection store unavailable; retry shortly' }),
        };
      }
      return errorResponse(401, 'Unauthorized: replay_detected', requestOrigin);
    }
  }

  // ── Parse + validate request body (action-routed per plan CR-A/CR-H) ──
  // Layer 2: action routing keeps the ≤8-function ceiling (S9). Supported:
  //   register (default) — new NIP-05 identity
  //   update             — change lud16 / reactivate on an owned username
  //   rotate             — CR-H: move an owned record to a successor pubkey
  let body: { action?: string; username?: string; lud16?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return errorResponse(400, 'Invalid JSON body', requestOrigin);
  }

  const action = (body.action || 'register').toLowerCase();
  if (!['register', 'update', 'rotate', 'group_create', 'agent_deploy'].includes(action)) {
    return errorResponse(400, `Unsupported action: ${action}`, requestOrigin);
  }

  // ── Action routing: CR-I Layer 2 — group creation with batch provisioning ──
  if (action === 'group_create') {
    const gb = body as {
      charter?: string;
      role?: string;
      members?: Array<{ pubkey?: string; role?: string }>;
    };
    const charter = (gb.charter ?? '').trim();
    if (charter.length < 3 || charter.length > 2000) {
      return errorResponse(400, 'charter must be 3–2000 characters', requestOrigin);
    }
    const creatorRole = ['guardian', 'steward'].includes(gb.role ?? '')
      ? (gb.role as string)
      : 'guardian';

    // Validate members before any write; cap batch at 50 per call.
    const members = (gb.members ?? []).slice(0, 50);
    for (const m of members) {
      if (!m.pubkey || !/^[0-9a-f]{64}$/.test(m.pubkey)) {
        return errorResponse(400, 'each member needs a valid 64-hex pubkey', requestOrigin);
      }
      if (!['guardian', 'steward', 'adult', 'offspring'].includes(m.role ?? '')) {
        return errorResponse(400, 'member roles must be guardian/steward/adult/offspring', requestOrigin);
      }
    }

    const { data: group, error: gErr } = await supabase
      .from('groups')
      .insert({ charter, created_by_pubkey: pubkey })
      .select('id')
      .single();
    if (gErr || !group) {
      console.error('[register-identity] DB error (group insert):', gErr?.message);
      return errorResponse(500, 'Internal server error', requestOrigin);
    }
    const groupId = (group as { id: string }).id;

    // Creator joins with their chosen role, then all provisioned members.
    const rows = [
      { group_id: groupId, member_pubkey: pubkey, role: creatorRole },
      ...members.map((m) => ({
        group_id: groupId,
        member_pubkey: m.pubkey!,
        role: m.role!,
        invited_by_pubkey: pubkey,
      })),
    ];
    // Deduplicate (creator may also appear in the batch list).
    const unique = new Map<string, string>();
    for (const r of rows) unique.set(`${r.member_pubkey}:${r.role}`, JSON.stringify(r));
    const { error: mErr } = await supabase
      .from('group_members')
      .insert([...unique.values()].map((r) => JSON.parse(r)));
    if (mErr) {
      console.error('[register-identity] DB error (member insert):', mErr.message);
      return errorResponse(500, 'Internal server error', requestOrigin);
    }

    await recordRateLimitEvent(supabase, pubkey, clientIP);
    return {
      statusCode: 201,
      headers: { ...corsHeaders(requestOrigin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ success: true, group_id: groupId, member_count: unique.size }),
    };
  }

  // ── Action routing: CR-I Layer 2 — agent deployment with guardrails ──
  if (action === 'agent_deploy') {
    const ab = body as {
      agent_pubkey?: string;
      name?: string;
      description?: string;
      spend_policy?: Record<string, unknown>;
    };
    if (!ab.agent_pubkey || !/^[0-9a-f]{64}$/.test(ab.agent_pubkey)) {
      return errorResponse(400, 'agent_pubkey must be 64 hex chars', requestOrigin);
    }
    if (!ab.name || ab.name.length > 100) {
      return errorResponse(400, 'agent name required (≤100 chars)', requestOrigin);
    }

    // Deployer must be Guardian or Steward of an active group.
    const deployerGroup = (body as { group_id?: string }).group_id;
    let groupId = deployerGroup;
    if (groupId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(groupId)) {
        return errorResponse(400, 'invalid group_id format', requestOrigin);
      }
      const { data: membership, error: memErr } = await supabase
        .from('group_members')
        .select('role')
        .eq('group_id', groupId)
        .eq('member_pubkey', pubkey)
        .in('role', ['guardian', 'steward'])
        .maybeSingle();
      if (memErr) {
        console.error('[register-identity] DB error (deployer role check):', memErr.message);
        return errorResponse(500, 'Internal server error', requestOrigin);
      }
      if (!membership) {
        return errorResponse(403, 'Only guardians/stewards may deploy agents into a group', requestOrigin);
      }
    } else {
      // Personal agent: create a single-member group owned by the deployer.
      const { data: personal, error: pgErr } = await supabase
        .from('groups')
        .insert({ charter: `Personal agents of ${pubkey.slice(0, 12)}…`, created_by_pubkey: pubkey })
        .select('id')
        .single();
      if (pgErr || !personal) {
        console.error('[register-identity] DB error (personal group insert):', pgErr?.message);
        return errorResponse(500, 'Internal server error', requestOrigin);
      }
      groupId = (personal as { id: string }).id;
      await supabase
        .from('group_members')
        .insert({ group_id: groupId, member_pubkey: pubkey, role: 'guardian' });
    }

    // Guardrails: conservative defaults; delegation expires by default.
    const policy = ab.spend_policy ?? {};
    const maxSingle = Math.max(1, Number(policy.max_single_spend_msats ?? 100_000)); // 100 sats default
    const daily = Math.max(maxSingle, Number(policy.daily_limit_msats ?? 500_000));
    const approval = Math.max(daily, Number(policy.approval_threshold_msats ?? daily));
    const expiresAt =
      typeof policy.delegation_expires_at === 'string' ? policy.delegation_expires_at : null;

    const { data: profile, error: apErr } = await supabase
      .from('agent_profiles')
      .insert({
        group_id: groupId,
        agent_pubkey: ab.agent_pubkey,
        name: ab.name,
        ...(ab.description ? { description: ab.description } : {}),
        created_by_pubkey: pubkey,
      })
      .select('id')
      .single();
    if (apErr || !profile) {
      console.error('[register-identity] DB error (agent insert):', apErr?.message);
      return errorResponse(500, 'Internal server error', requestOrigin);
    }
    const profileId = (profile as { id: string }).id;

    const { error: spErr } = await supabase.from('agent_spend_policies').insert({
      agent_profile_id: profileId,
      max_single_spend_msats: maxSingle,
      daily_limit_msats: daily,
      weekly_limit_msats: Math.max(daily, Number(policy.weekly_limit_msats ?? daily * 5)),
      approval_threshold_msats: approval,
      allowed_kinds: Array.isArray(policy.allowed_kinds) ? policy.allowed_kinds.map(String).map(String) : [],
      allowed_rails: Array.isArray(policy.allowed_rails) ? policy.allowed_rails.map(String) : [],
      allowed_mints: Array.isArray(policy.allowed_mints) ? policy.allowed_mints.map(String) : [],
      ...(expiresAt ? { delegation_expires_at: expiresAt } : {}),
    });
    if (spErr) {
      console.error('[register-identity] DB error (spend policy insert):', spErr.message);
      return errorResponse(500, 'Internal server error', requestOrigin);
    }

    // Delegation constraints default to least privilege.
    await supabase.from('agent_delegation_constraints').insert({
      agent_profile_id: profileId,
      can_invite_members: false,
      can_create_agents: false,
      can_modify_spend_policy: false,
      can_rotate_keys: false,
      max_delegation_depth: 1,
    });

    await recordRateLimitEvent(supabase, pubkey, clientIP);
    return {
      statusCode: 201,
      headers: { ...corsHeaders(requestOrigin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ success: true, agent_profile_id: profileId, group_id: groupId }),
    };
  }

  const username = (body.username || '').trim().toLowerCase();
  const lud16 = body.lud16?.trim();
  // 004 unified categorizer: domain = subdomain_prefix.root_domain
  // Accept either body.domain as full categorized domain (my.satnam.pub) or
  // separate body.subdomain_prefix + body.root_domain for explicit class.
  const rawDomain = (
    (body as { domain?: string }).domain ||
    (body as { subdomain_prefix?: string; root_domain?: string }).subdomain_prefix && (body as { root_domain?: string }).root_domain
      ? `${(body as { subdomain_prefix?: string }).subdomain_prefix}.${(body as { root_domain?: string }).root_domain}`
      : `my.${DEFAULT_ROOT_DOMAIN}`
  ).trim().toLowerCase();

  const domainParts = rawDomain.split('.');
  if (domainParts.length < 3) {
    return errorResponse(400, `Invalid categorized domain: ${rawDomain} (expected subdomain.root, e.g. my.satnam.pub)`, requestOrigin);
  }
  const root_domain = domainParts.slice(-2).join('.');
  const subdomain_prefix = domainParts.slice(0, -2).join('.');
  const requestedDomain = rawDomain; // for messages/back-compat

  if (!SUBDOMAIN_ALLOW.has(subdomain_prefix) || !ROOT_WHITELIST.has(root_domain)) {
    return errorResponse(403, `Domain not whitelisted: ${requestedDomain} (subdomain must be my/our/agent, root must be whitelisted)`, requestOrigin);
  }

  const usernameError = validateUsername(username);
  if (usernameError) {
    return errorResponse(400, usernameError, requestOrigin);
  }

  if (lud16 && !LUD16_REGEX.test(lud16)) {
    return errorResponse(400, 'Invalid Lightning address format (expected user@domain.tld)', requestOrigin);
  }

  // ── Per-pubkey rate limit (Supabase) ──
  const withinLimit = await checkPubkeyRateLimit(supabase, pubkey);
  if (!withinLimit) {
    return errorResponse(429, 'Rate limit exceeded: max 10 registrations per hour per identity.', requestOrigin);
  }

  // ── Action routing: rotate path (CR-H — old key hands the record over) ──
  if (action === 'rotate') {
    const rotateBody = body as { username?: string; domain?: string; subdomain_prefix?: string; root_domain?: string; successor_pubkey?: string };
    const username = (rotateBody.username || '').trim().toLowerCase();
    const successor = (rotateBody.successor_pubkey || '').trim().toLowerCase();
    const rawRotateDomain = (rotateBody.domain || (rotateBody.subdomain_prefix && rotateBody.root_domain ? `${rotateBody.subdomain_prefix}.${rotateBody.root_domain}` : '') || `my.${DEFAULT_ROOT_DOMAIN}`).trim().toLowerCase();
    const rParts = rawRotateDomain.split('.');
    if (rParts.length < 3) return errorResponse(400, `Invalid categorized domain: ${rawRotateDomain}`, requestOrigin);
    const r_root = rParts.slice(-2).join('.');
    const r_sub = rParts.slice(0, -2).join('.');

    if (!username || !/^[0-9a-f]{64}$/.test(successor)) {
      return errorResponse(400, 'rotate requires username and 64-hex successor_pubkey', requestOrigin);
    }
    if (!SUBDOMAIN_ALLOW.has(r_sub) || !ROOT_WHITELIST.has(r_root)) {
      return errorResponse(403, `Domain not whitelisted: ${rawRotateDomain}`, requestOrigin);
    }
    // Self-rotation is a no-op and almost certainly a client bug.
    if (successor === pubkey) {
      return errorResponse(400, 'successor_pubkey must differ from the authenticating key', requestOrigin);
    }

    // Only the CURRENT owner may rotate. The record's pubkey must equal the
    // NIP-98-authenticated (old) key.
    const { data: owned, error: ownedErr } = await supabase
      .from('nip05_identifiers')
      .select('id, pubkey')
      .eq('username', username)
      .eq('subdomain_prefix', r_sub)
      .eq('root_domain', r_root)
      .eq('pubkey', pubkey)
      .eq('is_active', true)
      .maybeSingle();

    if (ownedErr) {
      console.error('[register-identity] DB error (rotate ownership check):', ownedErr.message);
      return errorResponse(500, 'Internal server error', requestOrigin);
    }
    if (!owned) {
      // Fail closed: do not reveal whether the username exists for someone else.
      return errorResponse(403, 'Rotation not authorized for this identity', requestOrigin);
    }

    // Successor pubkey must not already hold an active record on this categorized domain.
    const { data: successorTaken, error: takenErr } = await supabase
      .from('nip05_identifiers')
      .select('username')
      .eq('subdomain_prefix', r_sub)
      .eq('root_domain', r_root)
      .eq('pubkey', successor)
      .eq('is_active', true)
      .maybeSingle();
    if (takenErr) {
      console.error('[register-identity] DB error (successor check):', takenErr.message);
      return errorResponse(500, 'Internal server error', requestOrigin);
    }
    if (successorTaken) {
      return errorResponse(409, 'Successor pubkey already holds an active identity', requestOrigin);
    }

    // Pointer move: same row, same address string, new pubkey.
    const { error: rotErr } = await supabase
      .from('nip05_identifiers')
      .update({ pubkey: successor })
      .eq('id', (owned as { id: string }).id);
    if (rotErr) {
      console.error('[register-identity] DB error (rotate update):', rotErr.message);
      return errorResponse(500, 'Internal server error', requestOrigin);
    }

    await recordRateLimitEvent(supabase, pubkey, clientIP);
    console.log('[register-identity] rotated', { username, domain: `${r_sub}.${r_root}` });
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(requestOrigin),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({ success: true, nip05: `${username}@${r_sub}.${r_root}`, rotated_to: successor }),
    };
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
      const lud16DomainRaw2 = (lud16.split('@')[1] ?? `my.${DEFAULT_ROOT_DOMAIN}`).toLowerCase();
      const ludParts2 = lud16DomainRaw2.split('.');
      const ludRoot2 = ludParts2.slice(-2).join('.');
      const ludSub2 = ludParts2.slice(0, -2).join('.') || 'my';
      const isImported2 = lud16DomainRaw2 !== `${subdomain_prefix}.${root_domain}` && lud16DomainRaw2 !== requestedDomain;
      const { error: updErr } = await supabase
        .from('lightning_addresses')
        .upsert({
          username,
          subdomain_prefix: isImported2 ? ludSub2 : subdomain_prefix,
          root_domain: isImported2 ? ludRoot2 : root_domain,
          lnurl_callback: `https://${lud16DomainRaw2}/.well-known/lnurlp/${username}`,
          is_imported: isImported2,
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
    // For update path, return the existing NIP-05 (username's current categorized domain)
    // If we have subdomain context from the request, use it; otherwise lookup would be needed.
    // Pragmatic: use the requested domain for human updates (my.*) as that's the human directory.
    const updateNip05 = `${username}@${subdomain_prefix}.${root_domain}`;
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(requestOrigin),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({ success: true, nip05: updateNip05, ...(lud16 ? { lud16 } : {}) }),
    };
  }

  // ── Check username availability (active identifiers, whitelist-scoped, 004) ──
  const { data: existingIdent, error: identCheckErr } = await supabase
    .from('nip05_identifiers')
    .select('username')
    .eq('username', username)
    .eq('subdomain_prefix', subdomain_prefix)
    .eq('root_domain', root_domain)
    .eq('is_active', true)
    .maybeSingle();

  if (identCheckErr) {
    console.error('[register-identity] DB error (availability check):', identCheckErr.message);
    return errorResponse(500, 'Internal server error', requestOrigin);
  }

  if (existingIdent) {
    return errorResponse(409, 'Username already registered', requestOrigin);
  }

  // ── Check if pubkey already has an active identity — 004 unified
  const { data: existingPubkey, error: pubkeyCheckErr } = await supabase
    .from('nip05_identifiers')
    .select('username, subdomain_prefix, root_domain')
    .eq('pubkey', pubkey)
    .eq('is_active', true)
    .maybeSingle();

  if (pubkeyCheckErr) {
    console.error('[register-identity] DB error (pubkey check):', pubkeyCheckErr.message);
    return errorResponse(500, 'Internal server error', requestOrigin);
  }

  if (existingPubkey) {
    // 004: show categorized NIP-05 if we can, else fallback to the requested domain
    const ep = existingPubkey as unknown as { username: string; subdomain_prefix?: string; root_domain?: string };
    const existingDomain = ep.subdomain_prefix && ep.root_domain ? `${ep.subdomain_prefix}.${ep.root_domain}` : requestedDomain;
    return errorResponse(409, `Pubkey already registered as ${ep.username}@${existingDomain}`, requestOrigin);
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

  // ── Insert into nip05_identifiers — 004 unified: subdomain_prefix + root_domain ──
  const { error: insertErr } = await supabase.from('nip05_identifiers').insert({
    username,
    pubkey,
    subdomain_prefix,
    root_domain,
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

  // ── Insert Lightning address if provided — 004: subdomain_prefix + root_domain + is_imported ──
  if (lud16) {
    const lud16DomainRaw = (lud16.split('@')[1] ?? `my.${DEFAULT_ROOT_DOMAIN}`).toLowerCase();
    const ludParts = lud16DomainRaw.split('.');
    const ludRoot = ludParts.slice(-2).join('.');
    const ludSubRaw = ludParts.slice(0, -2).join('.') || 'my';
    const isImported = lud16DomainRaw !== requestedDomain;
    // For imported external LN (e.g. getalby.com), keep its own subdomain/root even if not in allow-list — is_imported bypasses CHECK
    const lnSub = isImported ? ludSubRaw : subdomain_prefix;
    const lnRoot = isImported ? ludRoot : root_domain;
    const { error: lnErr } = await supabase.from('lightning_addresses').insert({
      username,
      subdomain_prefix: lnSub,
      root_domain: lnRoot,
      lnurl_callback: `https://${lud16DomainRaw}/.well-known/lnurlp/${username}`,
      is_imported: isImported,
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



