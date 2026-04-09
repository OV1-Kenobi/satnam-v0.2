// Netlify function #6 of 8 (ceiling: S9 invariant)
// Auth: NIP-98 (MUST call verifyNip98 before any business logic — S10 invariant)

/**
 * SimpleProof Anchor — Netlify Function
 * POST /.netlify/functions/simpleproof-anchor
 *
 * Submits Nostr event IDs to OpenTimestamps (OTS) calendar servers for
 * Bitcoin block-height anchoring. This creates a cryptographic proof that
 * an event existed at or before a specific Bitcoin block.
 *
 * Auth: NIP-98 required — prevents calendar spam from unauthenticated sources.
 *
 * Data handled: only public event IDs (hashes). No key material. No private
 * content. The OTS servers receive SHA-256 digests of event IDs only.
 *
 * Body: { event_ids: string[] }
 * Returns: { pending: true, calendar_urls: string[], digests: string[] }
 *
 * @see https://opentimestamps.org
 */

import type { Handler, HandlerResponse } from "@netlify/functions";
import { verifyNip98 } from '../../src/lib/nip98/verify';

// ============================================================================
// Constants
// ============================================================================

/**
 * OpenTimestamps calendar servers.
 * These are public calendar servers that accept digest submissions.
 */
const OTS_CALENDAR_SERVERS = [
  'https://alice.btc.calendar.opentimestamps.org',
  'https://bob.btc.calendar.opentimestamps.org',
  'https://finney.calendar.eternitywall.com',
];

/** Maximum event IDs per request. */
const MAX_EVENT_IDS = 100;

/** Maximum event ID batch to submit to a single calendar. */
const CALENDAR_BATCH_SIZE = 10;

const NIP05_DOMAIN = process.env.NIP05_DOMAIN || 'satnam.pub';

/** Rate limit: per-IP, 5-minute window, 10 requests. */
const RATE_LIMIT_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT_MAX_IP = 10;

/** Hex event ID regex (64 hex chars). */
const EVENT_ID_REGEX = /^[0-9a-f]{64}$/i;

// ============================================================================
// Security headers
// ============================================================================

function corsHeaders(origin?: string): Record<string, string> {
  const allowedOrigins = [
    `https://${NIP05_DOMAIN}`,
    'https://satnam.pub',
    'http://localhost:5173',
    'http://localhost:8888',
  ];
  const isAllowed = origin && allowedOrigins.some((o) => origin.startsWith(o));
  return {
    'Access-Control-Allow-Origin': (isAllowed && origin) ? (origin as string) : allowedOrigins[0],
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
// IP rate limiting
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
    ((headers['x-forwarded-for'] || '').split(',')[0] ?? '').trim() ||
    (headers['x-real-ip'] ?? 'unknown')
  );
}

// ============================================================================
// SHA-256 hashing (built-in Node.js crypto — no new dep)
// ============================================================================

async function sha256Hex(input: string): Promise<string> {
  // Use Web Crypto API (available in Node 20+ / Netlify runtime)
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// OTS calendar submission
// ============================================================================

/**
 * Submit a digest to a single OTS calendar server.
 * Returns the calendar's URL for the timestamp receipt, or null on failure.
 *
 * OTS protocol: POST /digest with hex-encoded SHA-256 as request body.
 * Response: 200 OK with an OTS file (binary), or a receipt URL header.
 */
async function submitToCalendar(
  calendarUrl: string,
  digest: string
): Promise<string | null> {
  try {
    const response = await fetch(`${calendarUrl}/digest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Satnam/2.0 (SimpleProof)',
      },
      body: digest,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.warn(`[simpleproof-anchor] Calendar ${calendarUrl} returned ${response.status}`);
      return null;
    }

    // Return the receipt URL
    const location = response.headers.get('Location');
    if (location) {
      return location.startsWith('http') ? location : `${calendarUrl}${location}`;
    }

    // Calendar accepted but no redirect — return canonical URL
    return `${calendarUrl}/timestamp/${digest}`;
  } catch (err) {
    console.warn(`[simpleproof-anchor] Calendar ${calendarUrl} failed:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ============================================================================
// Handler
// ============================================================================

export const handler: Handler = async (event): Promise<HandlerResponse> => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const clientIP = getClientIP(event.headers as Record<string, string | undefined>);

  console.log('[simpleproof-anchor] request', {
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

  // IP rate limit
  if (!checkRateLimit(clientIP)) {
    return errorResponse(429, 'Rate limit exceeded. Try again in 5 minutes.', requestOrigin);
  }

  // ── NIP-98 Authentication (MUST be called before any business logic — S10) ──
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const requestUrl = `https://${event.headers?.host || NIP05_DOMAIN}/.netlify/functions/simpleproof-anchor`;
  const bodyBytes = event.body
    ? new TextEncoder().encode(event.isBase64Encoded ? atob(event.body) : event.body)
    : undefined;

  const authOutcome = verifyNip98(authHeader, requestUrl, 'POST', bodyBytes);
  if (!authOutcome.authenticated) {
    console.log('[simpleproof-anchor] auth failed:', authOutcome.reason);
    return errorResponse(401, `Unauthorized: ${authOutcome.reason}`, requestOrigin);
  }

  // ── Parse + validate request body ──
  let body: { event_ids?: unknown };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return errorResponse(400, 'Invalid JSON body', requestOrigin);
  }

  const eventIds = body.event_ids;
  if (!Array.isArray(eventIds) || eventIds.length === 0) {
    return errorResponse(400, 'event_ids must be a non-empty array', requestOrigin);
  }

  if (eventIds.length > MAX_EVENT_IDS) {
    return errorResponse(400, `Too many event IDs (max ${MAX_EVENT_IDS} per request)`, requestOrigin);
  }

  // Validate each event ID is a valid 64-char hex string
  const invalidIds = eventIds.filter(
    (id) => typeof id !== 'string' || !EVENT_ID_REGEX.test(id)
  );
  if (invalidIds.length > 0) {
    return errorResponse(400, `Invalid event IDs: must be 64-character hex strings`, requestOrigin);
  }

  const validEventIds = eventIds as string[];

  // ── Hash event IDs (SHA-256 of each event ID) ──
  const digests: string[] = await Promise.all(
    validEventIds.map((id) => sha256Hex(id.toLowerCase()))
  );

  // ── Submit to OTS calendar servers ──
  const calendarResults: { calendar: string; receipts: (string | null)[] }[] = [];

  // Submit in batches to each calendar
  for (const calendarUrl of OTS_CALENDAR_SERVERS) {
    const receipts: (string | null)[] = [];

    for (let i = 0; i < digests.length; i += CALENDAR_BATCH_SIZE) {
      const batch = digests.slice(i, i + CALENDAR_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((digest) => submitToCalendar(calendarUrl, digest))
      );
      receipts.push(...batchResults);
    }

    calendarResults.push({ calendar: calendarUrl, receipts });
  }

  // Collect successful calendar URLs for polling
  const successfulCalendars = calendarResults
    .filter((r) => r.receipts.some((rec) => rec !== null))
    .map((r) => r.calendar);

  const allReceiptUrls = calendarResults
    .flatMap((r) => r.receipts)
    .filter((r): r is string => r !== null);

  console.log('[simpleproof-anchor] anchored', {
    eventCount: validEventIds.length,
    digestCount: digests.length,
    successfulCalendars: successfulCalendars.length,
  });

  return {
    statusCode: 202,
    headers: {
      ...corsHeaders(requestOrigin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      pending: true,
      digests,
      calendar_urls: successfulCalendars.length > 0 ? successfulCalendars : OTS_CALENDAR_SERVERS,
      receipt_urls: allReceiptUrls,
      event_count: validEventIds.length,
      note: 'Timestamps are pending Bitcoin block confirmation. Check receipt_urls after ~1 hour.',
    }),
  };
};

