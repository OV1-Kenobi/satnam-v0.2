/**
 * @module content/foundry
 * @description CR-G — founder-authored copy carried per R6 manifest verdicts
 * (signed off 2026-08-24).
 *
 * VERBATIM strings are byte-identical to v1 sources (cited per string).
 * GROUP-NAMING ADAPTATION applies only where the manifest specifies it:
 * "Family Foundry" surfaces present as "Group Foundry" with family framing
 * retained in prose. Founder personally proofreads before any public use.
 */

// ---------------------------------------------------------------------------
// Hero (v1 App.tsx:1350–1354) — CARRY REVISED: subhead reflects real v2 flow
// ---------------------------------------------------------------------------

export const HERO = {
  /** VERBATIM */
  title: 'Claim Your True Name',
  /** VERBATIM */
  subtitle: 'Control Your Digital Dynasty',
} as const;

// ---------------------------------------------------------------------------
// Foundry headline (v1 FamilyFoundryLandingPage.tsx:63–68) — CARRY REVISED:
// surface name is "Group Foundry"; the two governing lines stay word-for-word.
// ---------------------------------------------------------------------------

export const FOUNDRY = {
  /** Surface title adapted per naming directive; framing retained in prose below. */
  surfaceTitle: 'Group Foundry',
  /** VERBATIM line 1 */
  headlineLine1: 'Run The Family Like A Public Business',
  /** VERBATIM line 2 */
  headlineLine2: 'Govern It Like A Private Kingdom',
  /** VERBATIM subhead */
  subhead:
    'Build your family federation with structure, sovereignty, and sacred stewardship for multigenerational wealth.',
} as const;

// ---------------------------------------------------------------------------
// Tetrahedron four-face framing (v1 FamilyFoundryLandingPage.tsx:96–99) —
// VERBATIM
// ---------------------------------------------------------------------------

export const TETRAHEDRON = {
  heading: 'Dynastic Family Rule Requires Good Rules AND Rulers',
  subheading: 'Four interconnected faces of the Dynastic Governance Tetrahedron',
  note: 'Each face shares an edge and vertex with the other three-creating a stable, self-supporting structure',
  imageAlt: 'Dynastic Governance Tetrahedron - Four interconnected faces of family rule',
} as const;

// ---------------------------------------------------------------------------
// Namaste` Moore attribution (v1 FamilyFoundryLandingPage.tsx:391–400) —
// CARRY VERBATIM including the backtick in the name
// ---------------------------------------------------------------------------

export const ATTRIBUTION = {
  byline: '- Teachings by Namaste` Moore',
  linkText: 'Learn more from Namaste` Moore ',
  href: 'https://linktr.ee/iamnamastemoore',
} as const;

// ---------------------------------------------------------------------------
// Wizard invitation language (R6 §A: preserved where group-legible)
// ---------------------------------------------------------------------------

export const INVITATIONS = {
  noNostrYet: 'Works for people who don\'t have Nostr yet!',
} as const;

// ---------------------------------------------------------------------------
// YouTube embeds (R6 §C: CARRY VERBATIM) — all three VERIFIED LIVE 2026-08-24
// via YouTube oEmbed API:
//   7omuPt42Ep8 → "Why RIGHT NOW Matters More Than Any Time in History |
//                  JEFF BOOTH" (THE Bitcoin Podcast with Walker)
//   YtFOxNbmD38 → "What's The Problem? - Joe Bryan"
//   uYO5L88h26Y → "Bitcoin - Get on the Ark - Meme" (Smart Fusion)
// Re-check liveness before any release build.
// ---------------------------------------------------------------------------

export interface VideoEmbed {
  /** YouTube video id (v1 App.tsx:1445/1480/1515). */
  readonly id: string;
  readonly url: string;
  readonly caption: string;
}

export const LANDING_VIDEOS: ReadonlyArray<VideoEmbed> = [
  {
    id: '7omuPt42Ep8',
    url: 'https://www.youtube.com/watch?v=7omuPt42Ep8',
    caption: 'Jeff Booth & Walker Podcast',
  },
  {
    id: 'YtFOxNbmD38',
    url: 'https://www.youtube.com/watch?v=YtFOxNbmD38',
    caption: "What's The Problem?",
  },
  {
    id: 'uYO5L88h26Y',
    url: 'https://www.youtube.com/watch?v=uYO5L88h26Y',
    caption: 'Get on the Bitcoin Ark',
  },
];
