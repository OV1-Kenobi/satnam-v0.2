/**
 * CR-G — founder copy content module tests.
 * Verbatim guarantees + naming-adaptation rules per R6 manifest sign-off.
 */
import { describe, expect, it } from 'vitest';

import { WEALTH_CODES } from '../../src/content/wealth-codes';
import {
  ATTRIBUTION,
  FOUNDRY,
  HERO,
  INVITATIONS,
  LANDING_VIDEOS,
  TETRAHEDRON,
} from '../../src/content/foundry';

describe('CR-G Wealth Codes — word-for-word (founder verdict)', () => {
  it('carries all three codes with verbatim titles', () => {
    const titles = WEALTH_CODES.map((c) => c.title);
    expect(titles).toContain('Code #018: Business + Kingdom');
    expect(titles).toContain('Code #021: Structure Belongs in the Home');
    expect(titles).toContain('Code #006: Wealth Is Not the Goal. Stewardship Is.');
  });

  it('preserves the long-form prose (no truncation in extraction)', () => {
    for (const code of WEALTH_CODES) {
      // v1 prose bodies are all >2000 chars; a bad extraction would truncate
      expect(code.body.length).toBeGreaterThan(2000);
      // ** markers preserve emphasis spans from <strong> elements
      expect(code.body).toMatch(/\*\*[^*]+\*\*/);
      // no JSX leakage
      expect(code.body).not.toMatch(/<\w+[\s>]/);
      expect(code.body).not.toMatch(/className=/);
    }
  });

  it('keeps the Code #018 thesis line intact', () => {
    const c018 = WEALTH_CODES.find((c) => c.title.startsWith('Code #018'))!;
    expect(c018.body).toContain(
      'A successful legacy must be operationally efficient AND spiritually anchored.',
    );
  });
});

describe('CR-G hero + foundry copy', () => {
  it('hero lines are byte-identical to v1', () => {
    expect(HERO.title).toBe('Claim Your True Name');
    expect(HERO.subtitle).toBe('Control Your Digital Dynasty');
  });

  it('governing lines word-for-word under the Group Foundry surface name', () => {
    expect(FOUNDRY.surfaceTitle).toBe('Group Foundry'); // naming adaptation
    expect(FOUNDRY.headlineLine1).toBe('Run The Family Like A Public Business'); // verbatim
    expect(FOUNDRY.headlineLine2).toBe('Govern It Like A Private Kingdom'); // verbatim
    expect(FOUNDRY.subhead).toBe(
      'Build your family federation with structure, sovereignty, and sacred stewardship for multigenerational wealth.',
    );
  });

  it('tetrahedron framing carried verbatim including the em-dash quirk', () => {
    // v1 uses "three-creating" without spaces — preserved as-is, not "fixed"
    expect(TETRAHEDRON.note).toBe(
      'Each face shares an edge and vertex with the other three-creating a stable, self-supporting structure',
    );
  });

  it("Namaste` Moore attribution keeps the backtick and link", () => {
    expect(ATTRIBUTION.byline).toBe('- Teachings by Namaste` Moore');
    expect(ATTRIBUTION.href).toBe('https://linktr.ee/iamnamastemoore');
  });

  it('wizard invitation language preserved', () => {
    expect(INVITATIONS.noNostrYet).toBe("Works for people who don't have Nostr yet!");
  });
});

describe('CR-G landing videos — verified live 2026-08-24', () => {
  it('carries exactly the three v1 videos with correct ids', () => {
    const ids = LANDING_VIDEOS.map((v) => v.id);
    expect(ids).toEqual(['7omuPt42Ep8', 'YtFOxNbmD38', 'uYO5L88h26Y']);
    for (const v of LANDING_VIDEOS) {
      expect(v.url).toBe(`https://www.youtube.com/watch?v=${v.id}`);
    }
  });
});
