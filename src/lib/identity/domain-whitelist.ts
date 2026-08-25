/**
 * @module identity/domain-whitelist
 * @description CR-A + 004 unified subdomain categorizer.
 *
 * Founder-directed (2026-08-25): NIP-05 is username@subdomain_prefix.root_domain
 *   my.*    → human (alice@my.satnam.pub)
 *   our.*   → family/group (myfamily@our.satnam.pub)
 *   agent.* → agent swarm (treasury@agent.satnam.pub)
 * TLD stays clean: satnam.pub never appears as a NIP-05 host.
 *
 * Whitelist is root_domain ONLY (config-not-code via VITE_NIP05_ROOT_DOMAINS).
 * Subdomain categorizer is code allow-list, not env.
 */

const DEFAULT_PRIMARY_ROOT = 'satnam.pub';

export const ROOT_WHITELIST_DEFAULT = [
  DEFAULT_PRIMARY_ROOT,
  'openagents.com',
  'sovereignhybridcompute.com',
] as const;

export const SUBDOMAIN_ALLOW = ['my', 'our', 'agent'] as const;
export type SubdomainPrefix = (typeof SUBDOMAIN_ALLOW)[number];

const ROOT_REGEX = /^[a-z0-9][a-z0-9\-.]{1,253}$/;

function parseConfiguredRoots(): string[] {
  const raw =
    (typeof import.meta !== 'undefined' &&
      (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
        ?.VITE_NIP05_ROOT_DOMAINS) ||
    // Back-compat: old VITE_NIP05_DOMAINS still honored as root list
    (typeof import.meta !== 'undefined' &&
      (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
        ?.VITE_NIP05_DOMAINS) ||
    '';
  const configured = (raw as string)
    .split(',')
    .map((d: string) => d.trim().toLowerCase())
    .filter((d: string) => ROOT_REGEX.test(d));
  return configured.length > 0 ? [...new Set([DEFAULT_PRIMARY_ROOT, ...configured])] : [...ROOT_WHITELIST_DEFAULT];
}

let cachedRoots: string[] | null = null;

export function getWhitelistedRoots(): string[] {
  if (!cachedRoots) cachedRoots = parseConfiguredRoots();
  return cachedRoots;
}

/** @deprecated — use getWhitelistedRoots() + SUBDOMAIN_ALLOW */
export function getWhitelistedDomains(): string[] {
  const roots = getWhitelistedRoots();
  return roots.flatMap((r) => SUBDOMAIN_ALLOW.map((s) => `${s}.${r}`));
}

export function getPrimaryRoot(): string {
  return getWhitelistedRoots()[0] ?? DEFAULT_PRIMARY_ROOT;
}

/** @deprecated — use getPrimaryRoot() */
export function getPrimaryDomain(): string {
  return `my.${getPrimaryRoot()}`;
}

export function isValidSubdomain(prefix: string): boolean {
  return (SUBDOMAIN_ALLOW as readonly string[]).includes(prefix.trim().toLowerCase());
}

export function isWhitelistedRoot(root: string): boolean {
  return getWhitelistedRoots().includes(root.trim().toLowerCase());
}

/** True when a domain may be used for NIP-05 names and Lightning addresses. */
export function isWhitelistedDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase();
  const parts = normalized.split('.');
  if (parts.length < 3) return false;
  const root = parts.slice(-2).join('.');
  const sub = parts.slice(0, -2).join('.');
  return isValidSubdomain(sub) && isWhitelistedRoot(root);
}

export function parseNip05(full: string): { username: string; subdomain_prefix: SubdomainPrefix; root_domain: string } | null {
  const at = full.indexOf('@');
  if (at === -1) return null;
  const username = full.slice(0, at).trim().toLowerCase();
  const domain = full.slice(at + 1).trim().toLowerCase();
  const parts = domain.split('.');
  if (parts.length < 3) return null;
  const root = parts.slice(-2).join('.');
  const sub = parts.slice(0, -2).join('.') as SubdomainPrefix;
  if (!username || !isValidSubdomain(sub) || !isWhitelistedRoot(root)) return null;
  return { username, subdomain_prefix: sub, root_domain: root };
}

export function resolveRequestedDomain(requested?: string): string | null {
  if (!requested) return `my.${getPrimaryRoot()}`;
  const candidate = requested.trim().toLowerCase();
  return isWhitelistedDomain(candidate) ? candidate : null;
}

/** Resolve a categorized NIP-05 request by class. */
export function resolveRequestedCategorized(params: { username: string; subdomain_prefix: SubdomainPrefix; root_domain: string }): string | null {
  if (!isValidSubdomain(params.subdomain_prefix)) return null;
  if (!isWhitelistedRoot(params.root_domain)) return null;
  return `${params.username}@${params.subdomain_prefix}.${params.root_domain}`;
}

/** Test seam: clear the memoized whitelist so env changes are picked up. */
export function resetDomainWhitelistCache(): void {
  cachedRoots = null;
}
