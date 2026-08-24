/**
 * CR-A — identity keygen + domain whitelist tests.
 *
 * Known-vector test uses the canonical BIP-39 "abandon…about" mnemonic and the
 * FROZEN OpenAgents sovereign-identity vectors (evidence/r1 §3), proving
 * cross-ecosystem derivation parity: same words → same npub in both systems.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import {
  decodeNpub,
  deriveFromMnemonic,
  derivePublicFromMnemonic,
  generateMnemonic12,
  importFromNsec,
  isValidEnglishMnemonic,
  normalizeMnemonic,
  NOSTR_DERIVATION_PATH,
  scanLocalStorageForSecrets,
  verifyMnemonicMatches,
} from '../../src/lib/identity/keygen';
import {
  getPrimaryDomain,
  getWhitelistedDomains,
  isWhitelistedDomain,
  resolveRequestedDomain,
  resetDomainWhitelistCache,
} from '../../src/lib/identity/domain-whitelist';

// Frozen OpenAgents public test vector (PUBLIC — published test mnemonic only)
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const EXPECTED_PUBKEY_HEX = 'e8bcf3823669444d0b49ad45d65088635d9fd8500a75b5f20b59abefa56a144f';
const EXPECTED_NPUB = 'npub1az708q3kd9zy6z6f44zav5ygvdwelkzspf6mtusttx47lft2z38sghk0w7';

describe('CR-A keygen — known-vector derivation parity', () => {
  it('derives the exact OpenAgents frozen vector from the canonical test mnemonic', () => {
    const derived = derivePublicFromMnemonic(TEST_MNEMONIC);
    expect(derived.pubkeyHex).toBe(EXPECTED_PUBKEY_HEX);
    expect(derived.npub).toBe(EXPECTED_NPUB);
    expect(derived.derivationPath).toBe(NOSTR_DERIVATION_PATH);
  });

  it('normalizes whitespace without changing the derivation', () => {
    const messy = '  ' + TEST_MNEMONIC.replace(/ /g, '\t\n ') + ' ';
    expect(normalizeMnemonic(messy)).toBe(TEST_MNEMONIC);
    expect(derivePublicFromMnemonic(messy).npub).toBe(EXPECTED_NPUB);
  });

  it('rejects an invalid mnemonic checksum', () => {
    const bad = TEST_MNEMONIC.replace('about', 'abandon');
    expect(isValidEnglishMnemonic(bad)).toBe(false);
    expect(() => derivePublicFromMnemonic(bad)).toThrow(/not a valid BIP-39/);
  });

  it('generates fresh valid 12-word mnemonics with distinct keys', () => {
    const a = generateMnemonic12();
    const b = generateMnemonic12();
    expect(a.split(' ').length).toBe(12);
    expect(b.split(' ').length).toBe(12);
    expect(isValidEnglishMnemonic(a)).toBe(true);
    expect(derivePublicFromMnemonic(a).npub).not.toBe(derivePublicFromMnemonic(b).npub);
  });
});

describe('CR-A keygen — import round-trips', () => {
  it('mnemonic → nsec → import reproduces the identical npub', () => {
    const full = deriveFromMnemonic(TEST_MNEMONIC);
    // encode the secret as bech32 nsec then re-import
    const { encodeNsec } = awaitImport();
    const nsec = encodeNsec(full.secret);
    const reimported = importFromNsec(nsec);
    expect(reimported.publicPart.npub).toBe(full.publicPart.npub);
    expect(Buffer.from(reimported.secret).equals(Buffer.from(full.secret))).toBe(true);
  });

  it('nsec hex and bech32 forms import identically', () => {
    const full = deriveFromMnemonic(TEST_MNEMONIC);
    const asHex = Buffer.from(full.secret).toString('hex');
    const fromHex = importFromNsec(asHex);
    expect(fromHex.publicPart.pubkeyHex).toBe(EXPECTED_PUBKEY_HEX);
  });

  it('rejects malformed nsec material', () => {
    expect(() => importFromNsec('nsec1garbage')).toThrow();
    expect(() => importFromNsec('nothexandnotbech32')).toThrow(/64-hex or nsec/);
  });

  it('verifyMnemonicMatches confirms expected npub and rejects mismatch', () => {
    expect(verifyMnemonicMatches(TEST_MNEMONIC, EXPECTED_NPUB)).toBe(true);
    expect(
      verifyMnemonicMatches(
        TEST_MNEMONIC,
        'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
      ),
    ).toBe(false);
  });

  // small local helper to avoid a top-level circular import
  function awaitImport() {
    return { encodeNsec: encodeNsecRef };
  }
});

// imported directly at module scope below (kept separate for readability)
import { encodeNsec as encodeNsecRef } from '../../src/lib/identity/keygen';

describe('CR-A keygen — npub decode', () => {
  it('round-trips bech32 npub decode to the x-only pubkey', () => {
    const decoded = decodeNpub(EXPECTED_NPUB);
    expect(Buffer.from(decoded).toString('hex')).toBe(EXPECTED_PUBKEY_HEX);
  });
});

// ---------------------------------------------------------------------------
// Memory fence: no secret-shaped material may ever land in localStorage
// ---------------------------------------------------------------------------
describe('CR-A keygen — memory fence (S-invariant support)', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    const fake = {
      getItem: (k: string) => (k in store ? store[k]! : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      clear: () => {
        store = {};
      },
      get length() {
        return Object.keys(store).length;
      },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
  });

  it('flags nsec/mnemonic-shaped storage keys as offenders', () => {
    localStorage.setItem('satnam.mnemonic', 'some words here');
    localStorage.setItem('identity.nsec', 'nsec1qqq…');
    expect(scanLocalStorageForSecrets().sort()).toEqual(['identity.nsec', 'satnam.mnemonic']);
  });

  it('flags nsec1-prefixed VALUES even under innocuous keys', () => {
    localStorage.setItem('clipboard-cache', 'user copied nsec1abcxyz');
    expect(scanLocalStorageForSecrets()).toContain('clipboard-cache');
  });

  it('passes a clean profile (the state after correct CR-A flows)', () => {
    localStorage.setItem('satnam.vault.meta', '{"unlocked":true}');
    localStorage.setItem('nip05.registered', 'satoshi@satnam.pub');
    expect(scanLocalStorageForSecrets()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Domain whitelist
// ---------------------------------------------------------------------------
describe('CR-A domain-whitelist (config-not-code)', () => {
  beforeEach(() => resetDomainWhitelistCache());

  it('defaults include founder-approved initial entries', () => {
    const domains = getWhitelistedDomains();
    expect(domains).toContain('satnam.pub');
    expect(domains).toContain('openagents.com');
    expect(domains).toContain('sovereignhybridcompute.com');
    expect(getPrimaryDomain()).toBe('satnam.pub');
  });

  it('accepts whitelisted domains and rejects unlisted ones', () => {
    expect(isWhitelistedDomain('OPENAGENTS.com')).toBe(true);
    expect(resolveRequestedDomain('sovereignhybridcompute.com')).toBe('sovereignhybridcompute.com');
    expect(isWhitelistedDomain('evil.example.com')).toBe(false);
    expect(resolveRequestedDomain('evil.example.com')).toBeNull();
  });

  it('falls back to primary when no domain requested', () => {
    expect(resolveRequestedDomain(undefined)).toBe('satnam.pub');
    expect(resolveRequestedDomain('')).toBe('satnam.pub');
  });
});
