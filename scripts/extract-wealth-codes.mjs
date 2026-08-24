// CR-G extraction script: pulls the Wealth Codes prose from the v1 source
// verbatim, strips JSX tags, and emits src/content/wealth-codes.ts.
// Run once from satnam-v0.2 root:  node scripts/extract-wealth-codes.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const V1 = 'C:/Users/ov1kn/Documents/satnam_pub/src/components/pages/FamilyFoundryLandingPage.tsx';
const OUT = 'src/content/wealth-codes.ts';

const src = readFileSync(V1, 'utf8');

// Each code block lives between <h3 ...>Code #NNN...</h3> and the closing
// </div> of its bg-white/5 card. Extract per-code by splitting on h3 markers.
const h3Re = /<h3[^>]*>([^<]+)<\/h3>([\s\S]*?)(?=<h3|\{\/\*|<\/div>\s*<\/div>\s*<\/div>)/g;

function stripJsx(block) {
  return block
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // drop JSX comments entirely
    .replace(/<strong[^>]*>/g, '**')
    .replace(/<\/strong>/g, '**')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

const codes = [];
let m;
while ((m = h3Re.exec(src)) !== null) {
  const title = m[1].trim();
  if (!/^Code #\d+/.test(title)) continue;
  const body = stripJsx(m[2]);
  if (body.length > 100) codes.push({ title, body });
}

if (codes.length < 3) {
  console.error(`expected ≥3 wealth codes, found ${codes.length} — aborting without write`);
  process.exit(1);
}

const header = `/**
 * @module content/wealth-codes
 * @description CR-G — founder-authored Multigenerational Wealth Codes,
 * carried VERBATIM from v1 per founder verdict 2026-08-24 ("wealth codes
 * stay word-for-word"). Extracted programmatically from
 * satnam_pub/src/components/pages/FamilyFoundryLandingPage.tsx — do NOT
 * edit prose here; edits belong in v1 first, then re-extract.
 *
 * **bold** markers preserve v1 emphasis spans.
 */

export interface WealthCode {
  readonly title: string;
  readonly body: string;
}
`;

const out =
  header +
  '\nexport const WEALTH_CODES: ReadonlyArray<WealthCode> = [\n' +
  codes.map((c) => '  {\n' + `    title: ${JSON.stringify(c.title)},\n` + `    body:\n${JSON.stringify(c.body)},\n  }`).join(',\n') +
  ',\n];\n';

writeFileSync(OUT, out);
console.log(`wrote ${OUT} with ${codes.length} codes:`);
for (const c of codes) console.log(' -', c.title, `(${c.body.length} chars)`);
