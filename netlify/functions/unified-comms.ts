// Netlify function #8 of 8 (ceiling: S9 invariant — DO NOT add more functions)
// Auth: NIP-98 (MUST call verifyNip98 before any business logic — S10 invariant)

/**
 * Unified Comms — Netlify Function
 * POST /.netlify/functions/unified-comms
 *
 * NIP-17 gift-wrapped message relay. Accepts a pre-built, pre-signed
 * kind:1059 (gift-wrap) event and forwards it to the appropriate Nostr relays
 * for delivery to the recipient. The function NEVER decrypts message content.
 *
 * NIP-17 gift-wrapping: messages are sealed (kind:13) and then wrapped
 * (kind:1059) so relay operators cannot see sender, recipient, or content.
 * Only the final recipient (who holds the nsec in their client-side vault) can
 * unwrap and read the message.
 *
 * Auth: NIP-98 required — authenticated relay prevents spam.
 * The sender must be authenticated, but the function cannot and does not
 * associate the NIP-98 pubkey with the wrapped message sender (by design —
 * gift-wrapping uses ephemeral keys).
 *
 * Body: { gift_wrapped_event: NostrEvent }
 * Returns: { relayed: true, relay_count: number }
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/17.md
 */

import type { Handler, HandlerResponse } from "@netlify/functions";
import { verifyNip98 } from '../../src/lib/nip98/verify';

// ============================================================================
// Constants
// ============================================================================

/**
 * Relays to forward gift-wrapped messages to.
 * Multiple relays for redundancy (NIP-17 recommends 2-3 inboxes).
 */
const DELIVERY_RELAYS = [
  process.env.VITE_PYLON_RELAY || 'wss://pylon.openagents.com',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

/** Gift-wrap event kind (NIP-59). */
const GIFT_WRAP_KIND = 1059;

/** WebSocket timeout per relay. */
const WS_TIMEOUT_MS = 10_000;

const NIP05_DOMAIN = process.env.NIP05_DOMAIN || 'satnam.pub';

/** Rate limit: per-IP, 1-minute window. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_IP = 30;

/** Maximum gift-wrap event JSON size (256 KB). */
const MAX_EVENT_BYTES = 256 * 1024;

// ============================================================================
// Types
// ============================================================================

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

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
  const resolvedOrigin: string = (origin && allowedOrigins.some((o) => origin.startsWith(o)))
    ? origin
    : (allowedOrigins[0] ?? 'https://satnam.pub');
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
    ((headers['x-forwarded-for'] || '').split(',')[0] ?? '').trim() ||
    (headers['x-real-ip'] ?? 'unknown')
  );
}

// ============================================================================
// Gift-wrap event validation
// ============================================================================

/**
 * Structural validation of a NIP-59 gift-wrap event.
 * We validate structure only — we cannot and do not decrypt content.
 */
function validateGiftWrapEvent(e: unknown): e is NostrEvent {
  if (!e || typeof e !== 'object') return false;
  const ev = e as Record<string, unknown>;

  // Required fields
  if (typeof ev.id !== 'string' || ev.id.length !== 64) return false;
  if (typeof ev.pubkey !== 'string' || ev.pubkey.length !== 64) return false;
  if (typeof ev.created_at !== 'number') return false;
  if (typeof ev.kind !== 'number') return false;
  if (!Array.isArray(ev.tags)) return false;
  if (typeof ev.content !== 'string') return false;
  if (typeof ev.sig !== 'string' || ev.sig.length !== 128) return false;

  // Must be a gift-wrap event
  if (ev.kind !== GIFT_WRAP_KIND) return false;

  // Hex-only checks
  if (!/^[0-9a-f]{64}$/.test(ev.id as string)) return false;
  if (!/^[0-9a-f]{64}$/.test(ev.pubkey as string)) return false;
  if (!/^[0-9a-f]{128}$/.test(ev.sig as string)) return false;

  // created_at must be recent (within 24 hours — gift-wraps use randomized timestamps)
  const now = Math.floor(Date.now() / 1000);
  const age = Math.abs(now - (ev.created_at as number));
  if (age > 86400) return false; // older than 24 hours

  return true;
}

// ============================================================================
// Relay delivery
// ============================================================================

/**
 * Publish a gift-wrap event to a single relay.
 * Returns true if the relay accepted the event (OK response).
 */
async function publishToRelay(
  relayUrl: string,
  giftWrapEvent: NostrEvent
): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      resolve(false);
    }, WS_TIMEOUT_MS);

    const WebSocket =
      typeof globalThis.WebSocket !== 'undefined'
        ? globalThis.WebSocket
        : (require('ws') as typeof import('ws'));

    const ws = new (WebSocket as any)(relayUrl);
    let resolved = false;

    ws.onopen = () => {
      try {
        const publishFrame = JSON.stringify(['EVENT', giftWrapEvent]);
        ws.send(publishFrame);
      } catch {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(false);
        }
      }
    };

    ws.onmessage = (msgEvent: MessageEvent) => {
      try {
        const raw = typeof msgEvent.data === 'string' ? msgEvent.data : msgEvent.data.toString();
        const msg = JSON.parse(raw);

        if (!Array.isArray(msg)) return;

        if (msg[0] === 'OK' && msg[1] === giftWrapEvent.id) {
          const accepted = msg[2] === true;
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve(accepted);
          }
        }

        if (msg[0] === 'NOTICE') {
          console.log(`[unified-comms] NOTICE from ${relayUrl}:`, msg[1]);
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(false);
      }
    };

    ws.onclose = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(false);
      }
    };
  });
}

/**
 * Publish a gift-wrap to multiple relays in parallel.
 * Returns the count of relays that accepted the event.
 */
async function publishToRelays(giftWrapEvent: NostrEvent): Promise<number> {
  const results = await Promise.allSettled(
    DELIVERY_RELAYS.map((relay) => publishToRelay(relay, giftWrapEvent))
  );

  const successCount = results.filter(
    (r) => r.status === 'fulfilled' && r.value === true
  ).length;

  return successCount;
}

// ============================================================================
// Handler
// ============================================================================

export const handler: Handler = async (event): Promise<HandlerResponse> => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const clientIP = getClientIP(event.headers as Record<string, string | undefined>);

  console.log('[unified-comms] request', {
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
    return errorResponse(429, 'Rate limit exceeded. Try again in a minute.', requestOrigin);
  }

  // ── NIP-98 Authentication (MUST be called before any business logic — S10) ──
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const requestUrl = `https://${event.headers?.host || NIP05_DOMAIN}/.netlify/functions/unified-comms`;
  const bodyBytes = event.body
    ? new TextEncoder().encode(event.isBase64Encoded ? atob(event.body) : event.body)
    : undefined;

  const authOutcome = verifyNip98(authHeader, requestUrl, 'POST', bodyBytes);
  if (!authOutcome.authenticated) {
    console.log('[unified-comms] auth failed:', authOutcome.reason);
    return errorResponse(401, `Unauthorized: ${authOutcome.reason}`, requestOrigin);
  }

  // ── Parse request body ──
  let body: { gift_wrapped_event?: unknown };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return errorResponse(400, 'Invalid JSON body', requestOrigin);
  }

  const { gift_wrapped_event } = body;

  if (!gift_wrapped_event) {
    return errorResponse(400, 'Missing gift_wrapped_event', requestOrigin);
  }

  // Size check (before expensive validation)
  const eventJson = JSON.stringify(gift_wrapped_event);
  if (new TextEncoder().encode(eventJson).length > MAX_EVENT_BYTES) {
    return errorResponse(413, 'Event too large (max 256 KB)', requestOrigin);
  }

  // ── Structural validation of gift-wrap event ──
  if (!validateGiftWrapEvent(gift_wrapped_event)) {
    return errorResponse(400, 'Invalid gift-wrap event structure (must be kind:1059 with valid id, pubkey, sig, and recent created_at)', requestOrigin);
  }

  const giftWrapEvent = gift_wrapped_event as NostrEvent;

  // ── Forward to relays ──
  try {
    const relayCount = await publishToRelays(giftWrapEvent);

    if (relayCount === 0) {
      return errorResponse(502, 'Failed to relay to any delivery relay', requestOrigin);
    }

    console.log('[unified-comms] relayed gift-wrap', {
      eventId: giftWrapEvent.id.slice(0, 16) + '...',
      relayCount,
    });

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(requestOrigin),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        relayed: true,
        relay_count: relayCount,
      }),
    };
  } catch (err) {
    console.error('[unified-comms] unexpected error:', err);
    return errorResponse(500, 'Internal server error', requestOrigin);
  }
};



