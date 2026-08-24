/**
 * @module identity/domain-whitelist
 * @description CR-A configurable NIP-05 / Lightning address domain whitelist.
 *
 * Founder-directed (2026-08-24): settings must allow whitelisting additional
 * domains as valid NIP-05 sign-in names and Lightning addresses. Initial
 * entries: openagents.com, sovereignhybridcompute.com.
 *
 * CONFIG-NOT-CODE: entries come from VITE_NIP05_DOMAINS (build/env config).
 * Adding a domain is a configuration change, never a code change. The server
 * side enforces the same list via the NIP05_DOMAINS env on register-identity.
 */

const DEFAULT_PRIMARY_DOMAIN = 'satnam.pub';

/** Founder-approved initial whitelist (primary first). */
const DEFAULT_DOMAINS = [
  DEFAULT_PRIMARY_DOMAIN,
  'openagents.com',
  'sovereignhybridcompute.com',
] as const;

const DOMAIN_REGEX = /^[a-z0-9][a-z0-9\-.]{1,253}$/;

function parseConfiguredDomains(): string[] {
  const raw =
    (typeof import.meta !== 'undefined' &&
      (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
        ?.VITE_NIP05_DOMAINS) ||
    '';
  const configured = (raw as string)
    .split(',')
    .map((d: string) => d.trim().toLowerCase())
    .filter((d: string) => DOMAIN_REGEX.test(d));
  return configured.length > 0 ? [...new Set([DEFAULT_PRIMARY_DOMAIN, ...configured])] : [...DEFAULT_DOMAINS];
}

let cachedDomains: string[] | null = null;

/**
 * The active whitelist, primary domain first. Reads VITE_NIP05_DOMAINS once;
 * tests can reset via resetDomainWhitelistCache().
 */
export function getWhitelistedDomains(): string[] {
  if (!cachedDomains) cachedDomains = parseConfiguredDomains();
  return cachedDomains;
}

/** Primary domain (registration default + display). */
export function getPrimaryDomain(): string {
  return getWhitelistedDomains()[0] ?? DEFAULT_PRIMARY_DOMAIN;
}

/** True when a domain may be used for NIP-05 names and Lightning addresses. */
export function isWhitelistedDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase();
  return getWhitelistedDomains().includes(normalized);
}

/** Validate + normalize a user-supplied domain; null when not whitelisted. */
export function resolveRequestedDomain(requested?: string): string | null {
  const candidate = (requested ?? '').trim().toLowerCase() || getPrimaryDomain();
  return isWhitelistedDomain(candidate) ? candidate : null;
}

/** Test seam: clear the memoized whitelist so env changes are picked up. */
export function resetDomainWhitelistCache(): void {
  cachedDomains = null;
}
