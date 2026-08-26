// Shared Netlify function library — NOT a deployable function.

/**
 * Lazily-created singleton Supabase client from environment variables,
 * shared by the _lib helper modules (nip98-replay, rate-limit). Functions
 * that already hold a client (register-identity, issuer-registry) pass it
 * explicitly instead of using this.
 *
 * Returns null when SUPABASE_URL / a key is unconfigured or construction
 * fails — callers apply their documented outage policies.
 */

let sharedClient: unknown | undefined;

export async function getSharedSupabaseClient(): Promise<unknown | null> {
  if (sharedClient !== undefined) return sharedClient;
  try {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      '';
    if (!url || !key) {
      sharedClient = null;
      return sharedClient;
    }
    const { createClient } = await import('@supabase/supabase-js');
    sharedClient = createClient(url, key);
  } catch {
    sharedClient = null;
  }
  return sharedClient;
}

/** Test seam: clear the memoized shared client (per isolated module instance). */
export function __resetSharedSupabaseClientForTests(): void {
  sharedClient = undefined;
}
