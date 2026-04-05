/**
 * Satnam v2 — Type-Safe Environment Configuration
 * Spec: SATNAM-V2-SPEC-001 § 9.1, § 9.2, § 9.3, § 9.4
 *
 * All environment variables are accessed through this module.
 * Never read import.meta.env directly from feature code.
 *
 * Required variables (missing any of these will throw at startup):
 *   VITE_SUPABASE_URL        — Supabase project URL
 *   VITE_SUPABASE_ANON_KEY   — Supabase anonymous (public) key
 *   VITE_PYLON_RELAY         — Primary Nostr relay (Pylon WSS URL)
 *
 * Optional variables (have safe defaults):
 *   VITE_FALLBACK_RELAYS     — Comma-separated list of fallback relay URLs
 *   VITE_ENABLE_NFC          — Feature flag: NFC NTAG424 support (default: false)
 *   VITE_ENABLE_CASHU        — Feature flag: Cashu ecash (default: false)
 *   VITE_ENABLE_NIP90        — Feature flag: NIP-90 DVM marketplace (default: false)
 *   VITE_ENABLE_FROST         — Feature flag: FROST group keys (default: false)
 *   VITE_APP_ENV              — 'development' | 'staging' | 'production' (default: 'production')
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Validated, parsed environment configuration */
interface EnvConfig {
  // ── Required ──────────────────────────────────────────────────────────────
  supabaseUrl: string;
  supabaseAnonKey: string;
  pylonRelay: string;

  // ── Optional (with defaults) ──────────────────────────────────────────────
  fallbackRelays: string[];
  appEnv: 'development' | 'staging' | 'production';

  // ── Feature flags ─────────────────────────────────────────────────────────
  features: {
    nfc: boolean;
    cashu: boolean;
    nip90: boolean;
    frost: boolean;
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Read a required environment variable.
 * Throws a clear error at startup if missing or empty.
 */
function requireEnv(key: string): string {
  const value = import.meta.env[key] as string | undefined;
  if (!value || value.trim() === '') {
    throw new Error(
      `[Satnam Config] Missing required environment variable: ${key}\n` +
      `  Add it to .env.local (development) or Netlify Environment Variables (production).\n` +
      `  See .env.example for the full list of required variables.`
    );
  }
  return value.trim();
}

/**
 * Read an optional environment variable with a fallback value.
 */
function optionalEnv(key: string, fallback: string): string {
  const value = import.meta.env[key] as string | undefined;
  return value && value.trim() !== '' ? value.trim() : fallback;
}

/**
 * Parse a boolean feature flag environment variable.
 * Accepts: 'true', '1', 'yes' (case-insensitive) → true, anything else → false.
 */
function parseFlag(key: string, defaultValue = false): boolean {
  const value = import.meta.env[key] as string | undefined;
  if (!value) return defaultValue;
  return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
}

/**
 * Validate a WSS URL format.
 * Throws if the URL is not a valid websocket URL.
 */
function validateRelayUrl(url: string, varName: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') {
      throw new Error(`Protocol must be wss:// or ws://, got: ${parsed.protocol}`);
    }
  } catch (err) {
    throw new Error(
      `[Satnam Config] Invalid relay URL for ${varName}: "${url}"\n` +
      `  ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return url;
}

/**
 * Validate a Supabase URL format.
 */
function validateSupabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Supabase URL must use https://, got: ${parsed.protocol}`);
    }
    if (!parsed.hostname.includes('supabase.co') && !parsed.hostname.includes('localhost')) {
      // Allow custom domains, but warn in development
      if (import.meta.env.DEV) {
        console.warn(
          `[Satnam Config] VITE_SUPABASE_URL does not contain "supabase.co". ` +
          `If using a custom domain, this warning can be ignored.`
        );
      }
    }
  } catch (err) {
    throw new Error(
      `[Satnam Config] Invalid VITE_SUPABASE_URL: "${url}"\n` +
      `  ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return url;
}

/**
 * Parse the VITE_APP_ENV variable into a typed union.
 */
function parseAppEnv(raw: string): 'development' | 'staging' | 'production' {
  const valid = ['development', 'staging', 'production'] as const;
  if (valid.includes(raw as typeof valid[number])) {
    return raw as typeof valid[number];
  }
  console.warn(
    `[Satnam Config] Unknown VITE_APP_ENV value: "${raw}". Defaulting to "production".`
  );
  return 'production';
}

// ── Build & validate config at module load time ───────────────────────────────
//
// This runs once when the module is first imported. If any required variable
// is missing, the app throws immediately with a clear diagnostic message
// rather than failing silently at the callsite.

let _config: EnvConfig;

function buildConfig(): EnvConfig {
  // ── Required ──────────────────────────────────────────────────────────────
  const supabaseUrl    = validateSupabaseUrl(requireEnv('VITE_SUPABASE_URL'));
  const supabaseAnonKey = requireEnv('VITE_SUPABASE_ANON_KEY');
  const pylonRelay     = validateRelayUrl(requireEnv('VITE_PYLON_RELAY'), 'VITE_PYLON_RELAY');

  // ── Optional ──────────────────────────────────────────────────────────────
  const rawFallbackRelays = optionalEnv('VITE_FALLBACK_RELAYS', '');
  const fallbackRelays = rawFallbackRelays
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(url => {
      try {
        return validateRelayUrl(url, 'VITE_FALLBACK_RELAYS');
      } catch {
        console.warn(`[Satnam Config] Skipping invalid fallback relay URL: "${url}"`);
        return null;
      }
    })
    .filter((url): url is string => url !== null);

  const rawAppEnv = optionalEnv('VITE_APP_ENV', import.meta.env.MODE ?? 'production');
  const appEnv = parseAppEnv(rawAppEnv);

  // ── Feature flags ─────────────────────────────────────────────────────────
  const features = {
    nfc:       parseFlag('VITE_ENABLE_NFC',       false),
    cashu:     parseFlag('VITE_ENABLE_CASHU',     false),
    nip90:     parseFlag('VITE_ENABLE_NIP90',     false),
    frost:     parseFlag('VITE_ENABLE_FROST',     false),
  };

  return {
    supabaseUrl,
    supabaseAnonKey,
    pylonRelay,
    fallbackRelays,
    appEnv,
    features,
  };
}

function getConfig(): EnvConfig {
  if (!_config) {
    _config = buildConfig();
  }
  return _config;
}

// ── Public API ────────────────────────────────────────────────────────────────
//
// All callers use these typed getter functions. This keeps import.meta.env
// access confined to this module and makes mocking in tests straightforward.

/**
 * Returns the Supabase project URL.
 * @example "https://xyzcompany.supabase.co"
 */
export function getSupabaseUrl(): string {
  return getConfig().supabaseUrl;
}

/**
 * Returns the Supabase anonymous key (public — safe to expose to clients).
 * This is the `anon` key, not the `service_role` key.
 * The service_role key is only used in Netlify functions via server env vars.
 */
export function getSupabaseAnonKey(): string {
  return getConfig().supabaseAnonKey;
}

/**
 * Returns the primary Pylon relay WSS URL.
 * @example "wss://pylon.openagents.com"
 */
export function getPylonRelay(): string {
  return getConfig().pylonRelay;
}

/**
 * Returns the list of fallback relay URLs.
 * Used when Pylon is unavailable or for NIP-65 relay discovery.
 */
export function getFallbackRelays(): string[] {
  return getConfig().fallbackRelays;
}

/**
 * Returns all configured relay URLs: Pylon first, then fallbacks.
 * Convenience function for relay pool initialization.
 */
export function getAllRelays(): string[] {
  const cfg = getConfig();
  return [cfg.pylonRelay, ...cfg.fallbackRelays];
}

/**
 * Returns the current application environment.
 */
export function getAppEnv(): 'development' | 'staging' | 'production' {
  return getConfig().appEnv;
}

/**
 * Returns true when running in development mode.
 */
export function isDev(): boolean {
  return getConfig().appEnv === 'development' || import.meta.env.DEV;
}

// ── Feature flag getters ──────────────────────────────────────────────────────

/**
 * S5 / Phase 2 Week 7: NFC NTAG424 client-side CMAC verification.
 * Requires Web NFC API (Android Chrome only; iOS uses deep-link fallback).
 */
export function isNfcEnabled(): boolean {
  return getConfig().features.nfc;
}

/**
 * Phase 2 Week 8: Cashu ecash client (mint management, token operations).
 */
export function isCashuEnabled(): boolean {
  return getConfig().features.cashu;
}

/**
 * Phase 3 Week 12: NIP-90 DVM marketplace (job requests, results, payments).
 */
export function isNip90Enabled(): boolean {
  return getConfig().features.nip90;
}

/**
 * Phase 2 Week 5: FROST group key management via @frostr/bifrost.
 */
export function isFrostEnabled(): boolean {
  return getConfig().features.frost;
}

// ── Re-export for convenience ─────────────────────────────────────────────────

export type { EnvConfig };
