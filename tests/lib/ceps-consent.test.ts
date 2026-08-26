/**
 * @file ceps-consent.test.ts
 * @description Tests for the F-11 / R2-M-2 signing-consent gate (founder
 * Decision 1, 2026-08-25): the DEFAULT requestSigningConsent policy is a
 * FAIL-CLOSED WHITELIST per Security round-2 §6 Option A.
 *
 * Coverage:
 * 1. Every kind on CONSENT_AUTO_APPROVED_KINDS passes the default policy.
 * 2. DM-core kinds (4, 14, 1059) bypass the hook entirely (unchanged).
 * 3. Unknown/unwhitelisted kinds are REJECTED by default (incl. memo's
 *    inbound-only kind 39241).
 * 4. The hook remains overridable (future UI modal seam): an override can
 *    both allow non-whitelisted kinds and deny whitelisted ones.
 */

import { describe, it, expect } from 'vitest';
import { generateSecretKey } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils';

import {
  CentralEventPublishingService,
  CONSENT_AUTO_APPROVED_KINDS,
} from '../../src/lib/ceps/central-event-publishing-service.js';

const NSEC_HEX = bytesToHex(generateSecretKey());

function makeUnsigned(kind: number) {
  return {
    kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: [] as string[][],
    content: '',
  };
}

async function makeSession(): Promise<CentralEventPublishingService> {
  const ceps = new CentralEventPublishingService();
  await ceps.initializeSession(NSEC_HEX);
  return ceps;
}

describe('CEPS consent whitelist (R2-M-2 founder Decision 1)', () => {
  it('whitelist constant contains exactly the cross-checked first-party kinds', () => {
    expect([...CONSENT_AUTO_APPROVED_KINDS].sort((a, b) => a - b)).toEqual(
      [
        5, 30078, 443, 22456, 33400, 33401, 1985,
        39240, 39242, 39243, 39244, 39245,
        10050,
      ].sort((a, b) => a - b),
    );
    // Memo delta: inbound-only credit-offer kind must NOT be signable
    expect(CONSENT_AUTO_APPROVED_KINDS.has(39241)).toBe(false);
  });

  for (const kind of [
    5, 30078, 443, 22456, 33400, 33401, 1985,
    39240, 39242, 39243, 39244, 39245,
    10050,
  ]) {
    it(`default policy auto-approves whitelisted kind ${kind}`, async () => {
      const ceps = await makeSession();
      const signed = await ceps.signEventWithActiveSession(makeUnsigned(kind));
      expect(signed.kind).toBe(kind);
      expect(typeof signed.id).toBe('string');
    });
  }

  for (const kind of [4, 14, 1059]) {
    it(`DM-core kind ${kind} bypasses the consent hook entirely`, async () => {
      const ceps = await makeSession();
      const signed = await ceps.signEventWithActiveSession(makeUnsigned(kind));
      expect(signed.kind).toBe(kind);
    });
  }

  for (const kind of [1, 7, 22242, 30023, 99999, 39241]) {
    it(`default policy REJECTS non-whitelisted kind ${kind}`, async () => {
      const ceps = await makeSession();
      await expect(
        ceps.signEventWithActiveSession(makeUnsigned(kind)),
      ).rejects.toThrow('[CEPS] Signing rejected');
    });
  }

  it('hook stays overridable: a UI override may ALLOW a non-whitelisted kind', async () => {
    class ModalConsentCeps extends CentralEventPublishingService {
      protected override async requestSigningConsent(): Promise<boolean> {
        return true; // future UI modal would ask the user here
      }
    }
    const ceps = new ModalConsentCeps();
    await ceps.initializeSession(NSEC_HEX);
    const signed = await ceps.signEventWithActiveSession(makeUnsigned(99999));
    expect(signed.kind).toBe(99999);
  });

  it('hook stays overridable: a UI override may DENY even a whitelisted kind', async () => {
    class DenyAllCeps extends CentralEventPublishingService {
      protected override async requestSigningConsent(): Promise<boolean> {
        return false;
      }
    }
    const ceps = new DenyAllCeps();
    await ceps.initializeSession(NSEC_HEX);
    await expect(
      ceps.signEventWithActiveSession(makeUnsigned(5)),
    ).rejects.toThrow('[CEPS] Signing rejected');
  });
});
