// Netlify function #3 of 8 (ceiling: S9 invariant)
// Ported pattern: nip05-resolver.ts (public function template)

/**
 * Check Username — Netlify Function
 * GET /.netlify/functions/check-username?name=<username>
 *
 * Checks whether a NIP-05 username is available for registration.
 * Queries both nip05_identifiers and username_reservations tables.
 *
 * Auth: None (public endpoint).
 * NIP-98 not required — public availability check. Username availability
 * is not sensitive data; any user needs to query this before registering.
 *
 * Rate limiting: IP-based in-memory, 30 req/min.
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// ============================================================================
// Supabase client (service role — Netlify env vars, never exposed to client)
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

/** Maximum username length. */
const MAX_USERNAME_LENGTH = 64;

/** Minimum username length. */
const MIN_USERNAME_LENGTH = 3;

/** Username regex: lowercase alphanumeric, hyphens, underscores. */
const USERNAME_REGEX = /^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$|^[a-z0-9]{1,64}$/;

/** Rate limit window in milliseconds (1 minute). */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Maximum requests per IP per rate-limit window. */
const RATE_LIMIT_MAX = 30;

// ============================================================================
// Security headers
// ============================================================================

function corsHeaders(origin?: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  };
}

function errorResponse(
  statusCode: number,
  message: string,
  origin?: string
): ReturnType<Handler> {
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
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

function getClientIP(headers: Record<string, string | undefined>): string {
  return (
    (headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    headers['x-real-ip'] ||
    'unknown'
  );
}

// ============================================================================
// Username validation
// ============================================================================

/**
 * Validate a proposed username string.
 * Returns null on success, or a human-readable error string on failure.
 */
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
  // Reserved names
  const reserved = ['admin', 'root', 'satnam', 'support', 'help', 'system', 'nostr', 'bitcoin', 'api', 'www'];
  if (reserved.includes(name.toLowerCase())) {
    return 'This username is reserved';
  }
  return null;
}

// ============================================================================
// Handler
// ============================================================================

export const handler: Handler = async (event) => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const clientIP = getClientIP(event.headers as Record<string, string | undefined>);

  console.log('[check-username] request', {
    method: event.httpMethod,
    ip: clientIP,
    name: event.queryStringParameters?.name,
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

  if (event.httpMethod !== 'GET') {
    return errorResponse(405, 'Method not allowed', requestOrigin);
  }

  // Rate limiting
  if (!checkRateLimit(clientIP)) {
    return errorResponse(429, 'Rate limit exceeded. Try again in a minute.', requestOrigin);
  }

  const rawName = (event.queryStringParameters?.name || '').trim().toLowerCase();

  // Validate format before hitting the database
  const validationError = validateUsername(rawName);
  if (validationError) {
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(requestOrigin),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({ available: false, reason: validationError }),
    };
  }

  try {
    const supabase = getSupabase();

    // Check nip05_identifiers (active registrations)
    const { data: existing, error: identErr } = await supabase
      .from('nip05_identifiers')
      .select('username')
      .eq('username', rawName)
      .eq('is_active', true)
      .maybeSingle();

    if (identErr) {
      console.error('[check-username] DB error (nip05_identifiers):', identErr.message);
      return errorResponse(500, 'Internal server error', requestOrigin);
    }

    if (existing) {
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders(requestOrigin),
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify({ available: false, reason: 'Username already registered' }),
      };
    }

    // Check username_reservations (short-lived locks during registration flow)
    const { data: reserved, error: resErr } = await supabase
      .from('username_reservations')
      .select('username, expires_at')
      .eq('username', rawName)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (resErr) {
      console.error('[check-username] DB error (username_reservations):', resErr.message);
      return errorResponse(500, 'Internal server error', requestOrigin);
    }

    if (reserved) {
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders(requestOrigin),
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify({ available: false, reason: 'Username temporarily reserved' }),
      };
    }

    // Available
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(requestOrigin),
        'Content-Type': 'application/json',
        // Short cache — availability can change quickly during high registration traffic
        'Cache-Control': 'public, max-age=5, stale-while-revalidate=10',
      },
      body: JSON.stringify({ available: true }),
    };
  } catch (err) {
    console.error('[check-username] unexpected error:', err);
    return errorResponse(500, 'Internal server error', requestOrigin);
  }
};
