// Netlify function #7 of 8 (ceiling: S9 invariant)
// GET: NIP-98 not required — public issuer discovery endpoint
// POST: NIP-98 required (MUST call verifyNip98 before any business logic — S10 invariant)

/**
 * Issuer Registry — Netlify Function
 * GET  /.netlify/functions/issuer-registry?pubkey=<hex>  — public issuer lookup
 * POST /.netlify/functions/issuer-registry              — register/update issuer
 *
 * NIP-CA (Certificate Authority for Nostr) issuer discovery registry.
 * Issuers publish their capabilities so credential verifiers can look them up.
 *
 * GET Auth: None (public endpoint).
 * NIP-98 not required — public issuer discovery. Issuer pubkeys and
 * capabilities are public data analogous to NIP-05 entries.
 *
 * POST Auth: NIP-98 required — the caller must own the pubkey they register.
 *
 * Body (POST): {
 *   name: string,
 *   about?: string,
 *   capabilities: string[],   // e.g. ["age-attestation", "id-verification"]
 *   credential_types: string[], // credential kinds this issuer supports
 *   metadata?: Record<string, string>
 * }
 *
 * Returns (GET): issuer metadata or 404
 * Returns (POST): { registered: true, pubkey: string }
 */

import type { Handler, HandlerResponse } from "@netlify/functions";
import { createClient } from '@supabase/supabase-js';
import { verifyNip98 } from '../../src/lib/nip98/verify';

// ============================================================================
// Supabase client
// ============================================================================

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    '';
  return createClient(url, key);
}

// ============================================================================
// Constants
// ============================================================================

const NIP05_DOMAIN = process.env.NIP05_DOMAIN || 'satnam.pub';
const HEX_PUBKEY_REGEX = /^[0-9a-f]{64}$/i;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_IP = 30;
const MAX_CAPABILITIES = 20;
const MAX_STRING_LENGTH = 512;

// ============================================================================
// Security headers
// ============================================================================

function corsHeaders(
  origin?: string,
  methods: string = 'GET, POST, OPTIONS'
): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': methods,
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
// Rate limiting
// ============================================================================

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX_IP) return false;
  entry.count += 1;
  return true;
}

function getClientIP(headers: Record<string, string | undefined>): string {
  return (
    (headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (headers['x-real-ip'] ?? 'unknown')
  );
}

// ============================================================================
// GET handler — public issuer lookup
// ============================================================================

async function handleGet(
  pubkey: string,
  requestOrigin: string | undefined
): Promise<HandlerResponse> {
  if (!HEX_PUBKEY_REGEX.test(pubkey)) {
    return errorResponse(400, 'Invalid pubkey format (expected 64-character hex)', requestOrigin);
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('issuer_registry')
    .select('pubkey, name, about, capabilities, credential_types, metadata, created_at, updated_at')
    .eq('pubkey', pubkey.toLowerCase())
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('[issuer-registry] DB error (GET):', error.message);
    return errorResponse(500, 'Internal server error', requestOrigin);
  }

  if (!data) {
    return errorResponse(404, `Issuer not found: ${pubkey}`, requestOrigin);
  }

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders(requestOrigin),
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    },
    body: JSON.stringify(data),
  };
}

// ============================================================================
// POST handler — register/update issuer (NIP-98 auth required)
// ============================================================================

async function handlePost(
  event: Parameters<Handler>[0],
  requestOrigin: string | undefined,
  _clientIP: string
): Promise<HandlerResponse> {
  // ── NIP-98 Authentication (MUST be called before any business logic — S10) ──
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const requestUrl = `https://${event.headers?.host || NIP05_DOMAIN}/.netlify/functions/issuer-registry`;
  const bodyBytes = event.body
    ? new TextEncoder().encode(event.isBase64Encoded ? atob(event.body) : event.body)
    : undefined;

  const authOutcome = verifyNip98(authHeader, requestUrl, 'POST', bodyBytes);
  if (!authOutcome.authenticated) {
    console.log('[issuer-registry] POST auth failed:', authOutcome.reason);
    return errorResponse(401, `Unauthorized: ${authOutcome.reason}`, requestOrigin);
  }

  const pubkey = authOutcome.pubkey;

  // ── Parse body ──
  let body: {
    name?: string;
    about?: string;
    capabilities?: unknown;
    credential_types?: unknown;
    metadata?: unknown;
  };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return errorResponse(400, 'Invalid JSON body', requestOrigin);
  }

  const { name, about, capabilities, credential_types, metadata } = body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return errorResponse(400, 'name is required', requestOrigin);
  }

  if (name.length > MAX_STRING_LENGTH) {
    return errorResponse(400, `name must be ≤${MAX_STRING_LENGTH} characters`, requestOrigin);
  }

  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return errorResponse(400, 'capabilities must be a non-empty array', requestOrigin);
  }

  if (capabilities.length > MAX_CAPABILITIES) {
    return errorResponse(400, `Too many capabilities (max ${MAX_CAPABILITIES})`, requestOrigin);
  }

  const validCaps = capabilities.every((c) => typeof c === 'string' && c.length <= 128);
  if (!validCaps) {
    return errorResponse(400, 'Each capability must be a string ≤128 characters', requestOrigin);
  }

  if (!Array.isArray(credential_types)) {
    return errorResponse(400, 'credential_types must be an array', requestOrigin);
  }

  const validCredTypes = credential_types.every((c) => typeof c === 'string' && c.length <= 128);
  if (!validCredTypes) {
    return errorResponse(400, 'Each credential_type must be a string ≤128 characters', requestOrigin);
  }

  // Metadata: must be a simple string→string map if provided
  let sanitizedMetadata: Record<string, string> = {};
  if (metadata !== undefined && metadata !== null) {
    if (typeof metadata !== 'object' || Array.isArray(metadata)) {
      return errorResponse(400, 'metadata must be a string→string object', requestOrigin);
    }
    const entries = Object.entries(metadata as Record<string, unknown>);
    if (entries.length > 20) {
      return errorResponse(400, 'metadata must have ≤20 keys', requestOrigin);
    }
    for (const [k, v] of entries) {
      if (typeof v !== 'string') {
        return errorResponse(400, 'metadata values must be strings', requestOrigin);
      }
      sanitizedMetadata[k.slice(0, 64)] = (v as string).slice(0, MAX_STRING_LENGTH);
    }
  }

  const supabase = getSupabase();

  // Upsert into issuer_registry table
  const { error: upsertErr } = await supabase
    .from('issuer_registry')
    .upsert(
      {
        pubkey: pubkey.toLowerCase(),
        name: name.trim(),
        about: about?.trim() || null,
        capabilities: capabilities as string[],
        credential_types: credential_types as string[],
        metadata: sanitizedMetadata,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'pubkey' }
    );

  if (upsertErr) {
    console.error('[issuer-registry] DB error (POST upsert):', upsertErr.message);
    return errorResponse(500, 'Internal server error', requestOrigin);
  }

  console.log('[issuer-registry] registered/updated issuer', { pubkey: pubkey.slice(0, 16) + '...' });

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders(requestOrigin, 'POST, OPTIONS'),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ registered: true, pubkey }),
  };
}

// ============================================================================
// Handler — routes GET and POST
// ============================================================================

export const handler: Handler = async (event): Promise<HandlerResponse> => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const clientIP = getClientIP(event.headers as Record<string, string | undefined>);

  console.log('[issuer-registry] request', {
    method: event.httpMethod,
    ip: clientIP,
    pubkey: event.queryStringParameters?.pubkey
      ? event.queryStringParameters.pubkey.slice(0, 16) + '...'
      : undefined,
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

  // Rate limiting (applies to both GET and POST)
  if (!checkRateLimit(clientIP)) {
    return errorResponse(429, 'Rate limit exceeded. Try again in a minute.', requestOrigin);
  }

  if (event.httpMethod === 'GET') {
    // NIP-98 not required — public issuer discovery. See module-level comment.
    const pubkey = (event.queryStringParameters?.pubkey || '').trim();
    if (!pubkey) {
      return errorResponse(400, 'Missing pubkey query parameter', requestOrigin);
    }
    return handleGet(pubkey, requestOrigin);
  }

  if (event.httpMethod === 'POST') {
    return handlePost(event, requestOrigin, clientIP);
  }

  return errorResponse(405, 'Method not allowed', requestOrigin);
};
