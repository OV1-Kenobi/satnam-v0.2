// Ported from v1 well-known-agent.js pattern
// Stripped: Supabase DB reads, JWT auth, direct relay connection boilerplate
// v2: Queries relay for kind:39200 events, caches with 5-minute TTL
// Netlify function count: this is function #2 of 8 (nip05-resolver is #1)

/**
 * Well-Known Agent Endpoint — Netlify Function
 * GET /.netlify/functions/well-known-agent?name=<agent_name>
 *
 * Serves `.well-known/agent.json`-compatible discovery data for NIP-SA agents.
 *
 * Resolution flow:
 * 1. Parse `name` query parameter (e.g. "research-bot-7")
 * 2. Check in-memory cache (5-minute TTL)
 * 3. If cache miss: query coordination relay for kind:39200 event matching agent name
 * 4. Parse agent profile content and tags
 * 5. Return discovery format compatible with NIP-SA agent discovery
 *
 * Auth: None (public discovery endpoint, like NIP-05).
 * NIP-98 not required — public agent discovery endpoint (S10 invariant: this
 * endpoint is intentionally unauthenticated so external clients can discover
 * agents without credentials, analogous to NIP-05 resolution).
 *
 * Rate limiting: IP-based in-memory, 30 req/min.
 *
 * @see phase3-spec-sections.md §7.1 — Agent Profile (kind:39200)
 */

import type { Handler } from '@netlify/functions';

// ============================================================================
// Constants
// ============================================================================

/** Relay to query for agent profiles. Pylon is the primary coordination relay. */
const COORDINATION_RELAY =
  process.env.COORDINATION_RELAY_URL ||
  process.env.VITE_COORDINATION_RELAY ||
  'wss://pylon.openagents.com';

/** Fallback relays if the coordination relay is unavailable. */
const FALLBACK_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

/** Cache TTL in milliseconds (5 minutes). */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Rate limit window in milliseconds (1 minute). */
const RATE_LIMIT_WINDOW_MS = 60_000;

/** Maximum requests per IP per rate-limit window. */
const RATE_LIMIT_MAX = 30;

/** WebSocket connection timeout in milliseconds. */
const WS_TIMEOUT_MS = 8000;

// ============================================================================
// In-memory cache
// ============================================================================

interface CacheEntry {
  data: AgentDiscoveryResponse;
  expiresAt: number;
}

const agentCache = new Map<string, CacheEntry>();

// ============================================================================
// In-memory rate limiting
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
// Response types
// ============================================================================

/**
 * Agent discovery response format.
 * Compatible with `.well-known/agent.json` discovery protocol.
 */
interface AgentDiscoveryResponse {
  /** Agent's Nostr pubkey (hex) */
  pubkey: string;
  /** Agent profile content */
  profile: {
    name: string;
    about: string;
    picture?: string;
    capabilities: string[];
    autonomy_level: string;
    version: string;
  };
  /** NIP-05 identifier */
  nip05?: string;
  /** Lightning address */
  lud16?: string;
  /** Coordination relay URLs */
  coordination_relays: string[];
  /** Enabled skill scope IDs */
  enabled_skills: string[];
  /** Governor/operator pubkey */
  operator?: string;
  /** kind:39200 event ID */
  event_id: string;
  /** Event creation timestamp */
  created_at: number;
}

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
// Relay query for kind:39200 agent profiles
// ============================================================================

/**
 * Query a Nostr relay via WebSocket for kind:39200 agent profile events.
 * Implements NIP-01 REQ/EVENT/EOSE protocol over raw WebSocket.
 *
 * Falls back to additional relays if the primary relay fails or times out.
 *
 * @param agentName - The agent name to search for (matched against profile content)
 * @returns Parsed agent discovery response or null if not found
 */
async function queryRelayForAgent(
  agentName: string
): Promise<AgentDiscoveryResponse | null> {
  const relays = [COORDINATION_RELAY, ...FALLBACK_RELAYS];

  for (const relayUrl of relays) {
    try {
      const result = await queryRelay(relayUrl, agentName);
      if (result) return result;
    } catch (err) {
      console.warn(
        `[well-known-agent] Relay ${relayUrl} failed:`,
        err instanceof Error ? err.message : String(err)
      );
      // Continue to next relay
    }
  }

  return null;
}

/**
 * Query a single relay for a kind:39200 event matching the agent name.
 * @internal
 */
async function queryRelay(
  relayUrl: string,
  agentName: string
): Promise<AgentDiscoveryResponse | null> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Relay ${relayUrl} timed out after ${WS_TIMEOUT_MS}ms`));
    }, WS_TIMEOUT_MS);

    // Use require-style WebSocket available in Node.js Netlify runtime
    const WebSocket =
      typeof globalThis.WebSocket !== 'undefined'
        ? globalThis.WebSocket
        : (require('ws') as typeof import('ws'));

    const ws = new (WebSocket as any)(relayUrl);
    let resolved = false;

    const subscriptionId = `well-known-${Date.now()}`;

    ws.onopen = () => {
      // NIP-01 REQ — fetch recent kind:39200 events, limit 50 to find by name
      const req = JSON.stringify([
        'REQ',
        subscriptionId,
        { kinds: [39200], limit: 50 },
      ]);
      ws.send(req);
    };

    ws.onmessage = (msgEvent: MessageEvent) => {
      try {
        const message = JSON.parse(
          typeof msgEvent.data === 'string' ? msgEvent.data : msgEvent.data.toString()
        );

        if (!Array.isArray(message)) return;

        const [type] = message;

        if (type === 'EVENT' && message[2]) {
          const event = message[2] as {
            id: string;
            pubkey: string;
            kind: number;
            created_at: number;
            tags: string[][];
            content: string;
          };

          if (event.kind !== 39200) return;

          // Parse profile content
          let profile: Record<string, any>;
          try {
            profile = JSON.parse(event.content);
          } catch {
            return;
          }

          // Match by name (case-insensitive)
          const profileName: string = profile.name || '';
          if (profileName.toLowerCase() !== agentName.toLowerCase()) return;

          // Extract tags
          const getTag = (tagName: string): string | undefined =>
            event.tags.find((t) => t[0] === tagName)?.[1];

          const getTagAll = (tagName: string): string[] =>
            event.tags
              .filter((t) => t[0] === tagName)
              .map((t) => t[1])
              .filter(Boolean);

          const enabledSkillsTag = event.tags.find(
            (t) => t[0] === 'enabled_skills'
          );
          const enabledSkills = enabledSkillsTag
            ? enabledSkillsTag.slice(1)
            : [];

          const discoveryResponse: AgentDiscoveryResponse = {
            pubkey: event.pubkey,
            profile: {
              name: profile.name || agentName,
              about: profile.about || '',
              ...(profile.picture ? { picture: profile.picture } : {}),
              capabilities: Array.isArray(profile.capabilities)
                ? profile.capabilities
                : [],
              autonomy_level: profile.autonomy_level || 'bounded',
              version: profile.version || '2.0.0',
            },
            nip05: getTag('nip05'),
            lud16: getTag('lud16'),
            coordination_relays: getTagAll('coordination_relay'),
            enabled_skills: enabledSkills,
            operator: getTag('operator'),
            event_id: event.id,
            created_at: event.created_at,
          };

          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve(discoveryResponse);
          }
        }

        if (type === 'EOSE') {
          // End of stored events — no match found on this relay
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve(null);
          }
        }

        if (type === 'NOTICE') {
          console.log(`[well-known-agent] NOTICE from ${relayUrl}:`, message[1]);
        }
      } catch (err) {
        console.warn('[well-known-agent] Failed to parse relay message:', err);
      }
    };

    ws.onerror = (err: Event) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`WebSocket error on ${relayUrl}`));
      }
    };

    ws.onclose = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(null);
      }
    };
  });
}

// ============================================================================
// Handler
// ============================================================================

export const handler: Handler = async (event) => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const clientIP = getClientIP(
    event.headers as Record<string, string | undefined>
  );

  console.log('[well-known-agent] request', {
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
    return errorResponse(
      429,
      'Rate limit exceeded. Try again in a minute.',
      requestOrigin
    );
  }

  const agentName = (event.queryStringParameters?.name || '').trim().toLowerCase();
  if (!agentName) {
    return errorResponse(400, 'Missing name query parameter', requestOrigin);
  }

  // Validate agent name format (alphanumeric, hyphens, underscores)
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(agentName)) {
    return errorResponse(400, 'Invalid agent name format', requestOrigin);
  }

  // Check cache
  const cached = agentCache.get(agentName);
  if (cached && Date.now() < cached.expiresAt) {
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(requestOrigin),
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        'X-Cache': 'HIT',
      },
      body: JSON.stringify(cached.data),
    };
  }

  // Query relay
  try {
    const agentData = await queryRelayForAgent(agentName);

    if (!agentData) {
      return errorResponse(
        404,
        `Agent '${agentName}' not found`,
        requestOrigin
      );
    }

    // Store in cache
    agentCache.set(agentName, {
      data: agentData,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(requestOrigin),
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
        'X-Cache': 'MISS',
      },
      body: JSON.stringify(agentData),
    };
  } catch (err) {
    console.error('[well-known-agent] unexpected error:', err);
    return errorResponse(500, 'Internal server error', requestOrigin);
  }
};
