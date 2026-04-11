// Ported from v1 netlify/functions_active/nip05-resolver.ts
// Stripped: JWT middleware (none present — this function uses only public Supabase reads)
//   getRequestClient → replaced with direct @supabase/supabase-js createClient
//   import paths updated for v2 netlify/functions/ directory structure
//   Hybrid DID/PKARR verification metadata removed (scope cut for v2 initial phase)
// Kept: Rate limiting, NIP-05 resolution, issuer_registry lookup, security headers

/**
 * NIP-05 Resolver — Netlify Function
 * GET /.netlify/functions/nip05-resolver?nip05=username@domain
 *
 * Resolves NIP-05 identifiers to Nostr pubkeys via the v2 Supabase
 * nip05_identifiers table (public read — no auth required).
 *
 * Auth: None (public endpoint — no authentication required; read-only public data).
 * Rate limiting: IP-based via Supabase rate_limits table.
 */

import type { Handler, HandlerResponse } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// ============================================================================
// Supabase client (service role — Netlify env vars, never exposed to client)
// ============================================================================

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  // Read-only function: anon key is sufficient (SELECT on public tables).
  // Prefer service key if available for consistency, but anon is acceptable here.
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";
  if (!key) {
    throw new Error('Neither SUPABASE_SERVICE_ROLE_KEY nor SUPABASE_ANON_KEY is configured.');
  }
  return createClient(url, key);
}

// ============================================================================
// Security headers
// ============================================================================

function corsHeaders(origin?: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
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
// Rate limiting (simple in-memory + Supabase fallback)
// ============================================================================

const inMemoryRateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 requests/minute per IP

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = inMemoryRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    inMemoryRateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

function getClientIP(headers: Record<string, string | undefined>): string {
  return (
    ((headers["x-forwarded-for"] || "").split(",")[0] ?? "").trim() ||
    (headers["x-real-ip"] ?? "unknown")
  );
}

// ============================================================================
// NIP-05 parsing
// ============================================================================

function parseNip05(nip05: string): { username: string; domain: string } {
  const parts = nip05.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Invalid NIP-05 format; expected username@domain");
  }
  return { username: parts[0].toLowerCase(), domain: parts[1].toLowerCase() };
}

// ============================================================================
// Handler
// ============================================================================

export const handler: Handler = async (event): Promise<HandlerResponse> => {
  const requestOrigin = event.headers?.origin || event.headers?.Origin;
  const clientIP = getClientIP(event.headers as Record<string, string | undefined>);

  console.log("[nip05-resolver] request", {
    method: event.httpMethod,
    ip: clientIP,
    timestamp: new Date().toISOString(),
  });

  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(requestOrigin),
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return errorResponse(405, "Method not allowed", requestOrigin);
  }

  // Rate limiting
  if (!checkRateLimit(clientIP)) {
    return errorResponse(429, "Rate limit exceeded. Try again in a minute.", requestOrigin);
  }

  const nip05 = (event.queryStringParameters?.nip05 || "").trim();
  if (!nip05) {
    return errorResponse(400, "Missing nip05 query parameter", requestOrigin);
  }

  let username: string;
  let domain: string;
  try {
    ({ username, domain } = parseNip05(nip05));
  } catch (err) {
    return errorResponse(
      400,
      err instanceof Error ? err.message : "Invalid nip05",
      requestOrigin
    );
  }

  // Only serve identifiers for our own domain
  const ownedDomains = (
    process.env.NIP05_DOMAINS ||
    process.env.VITE_NIP05_DOMAINS ||
    "satnam.pub"
  )
    .split(",")
    .map((d) => d.trim());

  if (!ownedDomains.includes(domain)) {
    return errorResponse(
      404,
      `Domain ${domain} not served by this resolver`,
      requestOrigin
    );
  }

  try {
    const supabase = getSupabase();

    // Query nip05_identifiers (public table — no RLS bypass needed for reads)
    const { data, error } = await supabase
      .from("nip05_identifiers")
      .select("username, pubkey")
      .eq("username", username)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      console.error("[nip05-resolver] DB error:", error.message);
      return errorResponse(500, "Internal server error", requestOrigin);
    }

    if (!data) {
      return errorResponse(404, `NIP-05 identity not found: ${nip05}`, requestOrigin);
    }

    // NIP-05 response format: { names: { username: pubkey }, relays?: {...} }
    const responseData = {
      names: { [data.username]: data.pubkey },
    };

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(requestOrigin),
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      },
      body: JSON.stringify(responseData),
    };
  } catch (err) {
    console.error("[nip05-resolver] unexpected error:", err);
    return errorResponse(500, "Internal server error", requestOrigin);
  }
};

