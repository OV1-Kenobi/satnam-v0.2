// Netlify function #5 of 8 (ceiling: S9 invariant)
// Auth: NIP-98 (MUST call verifyNip98 before any business logic — S10 invariant)

/**
 * NWC Proxy — Netlify Function
 * POST /.netlify/functions/nwc-proxy
 *
 * Relay proxy for Nostr Wallet Connect (NWC) connections. Forwards encrypted
 * NWC payloads to the specified relay URL. The function NEVER decrypts payloads
 * — it is a pure pass-through. The encryption key lives only in the client's
 * client-side vault (S1 invariant).
 *
 * This proxy exists to work around CORS restrictions on NWC relay WebSockets
 * from browser clients. All content is end-to-end encrypted by the caller.
 *
 * Auth: NIP-98 required — authenticated pass-through prevents abuse.
 *
 * Body: { encrypted_payload: string, relay_url: string }
 * Returns: { relayed: true, response?: string }
 *
 * Security note: S6 invariant — no CMAC values are processed here.
 * S5 invariant — no client-vault access (server-side function).
 */

import type { Handler, HandlerResponse } from "@netlify/functions";
import { verifyNip98 } from '../../src/lib/nip98/verify';

// ============================================================================
// Constants
// ============================================================================

/** Allowed NWC relay URL prefixes (whitelist). */
const ALLOWED_RELAY_PREFIXES = [
  'wss://relay.getalby.com',
  'wss://relay.mutinywallet.com',
  'wss://nostr.mutinywallet.com',
  'wss://relay.damus.io',
  'wss://nostr.bitcoiner.social',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://nostr.wine',
  'wss://pylon.openagents.com',
];

/** WebSocket connection timeout in milliseconds. */
const WS_TIMEOUT_MS = 15_000;

/** Maximum encrypted payload size (128 KB). */
const MAX_PAYLOAD_BYTES = 128 * 1024;

const NIP05_DOMAIN = process.env.NIP05_DOMAIN || 'satnam.pub';

/** Rate limit: per-IP, 1-minute window. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_IP = 60;

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
    'Access-Control-Allow-Origin': isAllowed && origin ? origin : allowedOrigins[0],
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
    (headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    (headers['x-real-ip'] ?? 'unknown')
  );
}

// ============================================================================
// Relay URL validation
// ============================================================================

function isAllowedRelayUrl(relayUrl: string): boolean {
  try {
    const parsed = new URL(relayUrl);
    if (parsed.protocol !== 'wss:') return false;
    return ALLOWED_RELAY_PREFIXES.some((prefix) => relayUrl.startsWith(prefix));
  } catch {
    return false;
  }
}

// ============================================================================
// NWC relay forwarding
// ============================================================================

/**
 * Forward an encrypted NWC payload to a relay via WebSocket.
 * Returns the relay's response (encrypted) or null on timeout.
 *
 * NOTE: This function never inspects payload content — it is a pure
 * pass-through. Decryption is client-only.
 */
async function forwardToRelay(
  relayUrl: string,
  encryptedPayload: string,
  pubkey: string
): Promise<{ response: string | null; relayed: boolean }> {
  return new Promise(async (resolve) => {
    const timeout = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      resolve({ response: null, relayed: false });
    }, WS_TIMEOUT_MS);

    // C2 fix: use dynamic import instead of require('ws') to preserve ESM
    const WebSocket =
      typeof globalThis.WebSocket !== 'undefined'
        ? globalThis.WebSocket
        : (await import('ws')).default;

    const ws = new (WebSocket as any)(relayUrl);
    let resolved = false;
    let relayed = false;

    const subscriptionId = `nwc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    ws.onopen = () => {
      // Send the encrypted NWC event as a NIP-01 EVENT publish
      // The payload is a pre-built, pre-signed kind:23194 event (NWC request)
      // We wrap it in a NIP-01 publish frame
      try {
        const event = JSON.parse(encryptedPayload);
        const publishFrame = JSON.stringify(['EVENT', event]);
        ws.send(publishFrame);
        relayed = true;

        // Subscribe to responses (kind:23195 from wallet service)
        const reqFrame = JSON.stringify([
          'REQ',
          subscriptionId,
          {
            kinds: [23195],
            '#p': [pubkey],
            since: Math.floor(Date.now() / 1000) - 5,
            limit: 1,
          },
        ]);
        ws.send(reqFrame);
      } catch (err) {
        console.error('[nwc-proxy] failed to send payload:', err);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          ws.close();
          resolve({ response: null, relayed: false });
        }
      }
    };

    ws.onmessage = (msgEvent: MessageEvent) => {
      try {
        const raw = typeof msgEvent.data === 'string' ? msgEvent.data : msgEvent.data.toString();
        const msg = JSON.parse(raw);

        if (!Array.isArray(msg)) return;

        const [type] = msg;

        if (type === 'OK') {
          // Publish acknowledged — no response content yet; wait for REQ response
          return;
        }

        if (type === 'EVENT' && msg[2]) {
          // Encrypted response from wallet service — pass through without decryption
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve({ response: JSON.stringify(msg[2]), relayed: true });
          }
        }

        if (type === 'EOSE') {
          // End of stored events — no cached response; publish was the goal
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve({ response: null, relayed });
          }
        }

        if (type === 'NOTICE') {
          console.log('[nwc-proxy] NOTICE from relay:', msg[1]);
        }
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ response: null, relayed: false });
      }
    };

    ws.onclose = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ response: null, relayed });
      }
    };
  });
}

// ============================================================================
// Handler
// ============================================================================

export const handler: Handler = async (event): Promise<HandlerResponse> => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const clientIP = getClientIP(event.headers as Record<string, string | undefined>);

  console.log('[nwc-proxy] request', {
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
  const requestUrl = `https://${event.headers?.host || NIP05_DOMAIN}/.netlify/functions/nwc-proxy`;
  const bodyBytes = event.body
    ? new TextEncoder().encode(event.isBase64Encoded ? atob(event.body) : event.body)
    : undefined;

  const authOutcome = verifyNip98(authHeader, requestUrl, 'POST', bodyBytes);
  if (!authOutcome.authenticated) {
    console.log('[nwc-proxy] auth failed:', authOutcome.reason);
    return errorResponse(401, `Unauthorized: ${authOutcome.reason}`, requestOrigin);
  }

  const pubkey = authOutcome.pubkey;

  // ── Parse + validate request body ──
  let body: { encrypted_payload?: string; relay_url?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return errorResponse(400, 'Invalid JSON body', requestOrigin);
  }

  const { encrypted_payload, relay_url } = body;

  if (!encrypted_payload || typeof encrypted_payload !== 'string') {
    return errorResponse(400, 'Missing encrypted_payload', requestOrigin);
  }

  if (!relay_url || typeof relay_url !== 'string') {
    return errorResponse(400, 'Missing relay_url', requestOrigin);
  }

  // Validate payload size
  if (new TextEncoder().encode(encrypted_payload).length > MAX_PAYLOAD_BYTES) {
    return errorResponse(413, 'Payload too large (max 128 KB)', requestOrigin);
  }

  // Validate relay URL (whitelist — prevents SSRF)
  if (!isAllowedRelayUrl(relay_url)) {
    return errorResponse(400, 'Relay URL not in allowed list', requestOrigin);
  }

  // Validate encrypted_payload is a parseable JSON Nostr event
  let parsedEvent: Record<string, unknown>;
  try {
    parsedEvent = JSON.parse(encrypted_payload);
    if (typeof parsedEvent !== 'object' || !parsedEvent.id || !parsedEvent.sig) {
      throw new Error('Not a Nostr event');
    }
  } catch {
    return errorResponse(400, 'encrypted_payload must be a signed Nostr event JSON string', requestOrigin);
  }

  // ── Forward to relay ──
  try {
    const { response, relayed } = await forwardToRelay(relay_url, encrypted_payload, pubkey);

    if (!relayed) {
      return errorResponse(502, 'Failed to relay to NWC relay', requestOrigin);
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(requestOrigin),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify({
        relayed: true,
        ...(response ? { response } : {}),
      }),
    };
  } catch (err) {
    console.error('[nwc-proxy] unexpected error:', err);
    return errorResponse(500, 'Internal server error', requestOrigin);
  }
};
