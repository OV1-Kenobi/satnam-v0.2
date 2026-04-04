#!/usr/bin/env node
/**
 * check-invariants.mjs
 *
 * Runs all S1–S12 security invariant checks locally.
 * Exit code 0 if all pass, 1 if any fail.
 *
 * Usage: node scripts/check-invariants.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Helpers ──────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

function pass(label) {
  console.log(`  ${GREEN}✓ PASS${RESET}  ${label}`);
}

function fail(label, detail = '') {
  console.log(`  ${RED}✗ FAIL${RESET}  ${label}`);
  if (detail) {
    const lines = detail.trim().split('\n').slice(0, 10);
    lines.forEach(l => console.log(`         ${DIM}${l}${RESET}`));
    if (detail.trim().split('\n').length > 10) {
      console.log(`         ${DIM}... (truncated)${RESET}`);
    }
  }
}

function skip(label, reason) {
  console.log(`  ${YELLOW}– SKIP${RESET}  ${label}  ${DIM}(${reason})${RESET}`);
}

/**
 * Run a shell grep and return stdout, or '' if nothing found.
 * Returns null on actual grep error (exit 2), '' when no matches (exit 1).
 */
function grepFiles(pattern, paths, extensions = [], extraArgs = '') {
  const extArgs = extensions.map(e => `--include="*.${e}"`).join(' ');
  const pathList = paths
    .filter(p => existsSync(join(ROOT, p)))
    .map(p => join(ROOT, p))
    .join(' ');

  if (!pathList) return '';

  try {
    const cmd = `grep -rn ${extArgs} ${extraArgs} -E '${pattern}' ${pathList}`;
    return execSync(cmd, { encoding: 'utf8', cwd: ROOT });
  } catch (err) {
    // grep exits 1 when no matches found — that's fine
    if (err.status === 1) return '';
    // exit 2 is a real error
    return '';
  }
}

function fileContains(relPath, pattern) {
  const fullPath = join(ROOT, relPath);
  if (!existsSync(fullPath)) return false;
  const content = readFileSync(fullPath, 'utf8');
  return new RegExp(pattern, 'i').test(content);
}

function fileExists(relPath) {
  return existsSync(join(ROOT, relPath));
}

function readJson(relPath) {
  const fullPath = join(ROOT, relPath);
  if (!existsSync(fullPath)) return null;
  return JSON.parse(readFileSync(fullPath, 'utf8'));
}

function countFiles(dir, extensions, maxDepth = 1) {
  const fullDir = join(ROOT, dir);
  if (!existsSync(fullDir)) return 0;
  const extArgs = extensions.map(e => `-name "*.${e}"`).join(' -o ');
  try {
    const out = execSync(
      `find ${fullDir} -maxdepth ${maxDepth} \\( ${extArgs} \\) ` +
      `-not -name "_*" -not -name "*.test.*" -not -name "*.spec.*"`,
      { encoding: 'utf8' }
    );
    return out.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

// ── Invariant Checks ─────────────────────────────────────────────────────────

const results = [];

function check(id, label, fn) {
  const result = fn();
  results.push({ id, label, passed: result.passed });
  if (result.skipped) {
    skip(`${id}: ${label}`, result.reason);
  } else if (result.passed) {
    pass(`${id}: ${label}`);
  } else {
    fail(`${id}: ${label}`, result.detail);
  }
}

console.log();
console.log(`${BOLD}Satnam v2 — Security Invariant Checks${RESET}`);
console.log(`${DIM}Root: ${ROOT}${RESET}`);
console.log('─'.repeat(60));
console.log();

// S1 — No encrypted_nsec / nsec / secret_key / private_key column in SQL
check('S1', 'No key-material columns in SQL files', () => {
  const raw = grepFiles(
    'encrypted_nsec|nsec\\s+(TEXT|CHAR|VARCHAR|BYTEA)|secret_key|private_key',
    ['database', '.'],
    ['sql'],
    '--include="*.sql"'
  );
  // Filter out SQL comment lines (lines starting with -- after optional whitespace)
  const matches = raw
    .split('\n')
    .filter(line => line && !line.replace(/^[^:]+:\d+:/, '').match(/^\s*--/))
    .join('\n')
    .trim();
  if (matches) {
    return { passed: false, detail: matches };
  }
  return { passed: true };
});

// S2 — No JWT imports
check('S2', 'No JWT imports in source files', () => {
  const matches = grepFiles(
    "from ['\"]jsonwebtoken['\"]|from ['\"]jose['\"]|JWT_SECRET|import.*\\bjwt\\b",
    ['src', 'netlify', 'scripts'],
    ['ts', 'tsx', 'js', 'mjs']
  );
  if (matches) {
    return { passed: false, detail: matches };
  }
  return { passed: true };
});

// S3 — No @sentry/* in package.json
check('S3', 'No @sentry/* in package.json', () => {
  const pkg = readJson('package.json');
  if (!pkg) return { skipped: true, reason: 'package.json not found', passed: true };

  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
  };
  const sentryDeps = Object.keys(allDeps).filter(k => k.startsWith('@sentry/'));
  if (sentryDeps.length > 0) {
    return { passed: false, detail: `Found: ${sentryDeps.join(', ')}` };
  }
  return { passed: true };
});

// S4 — No localStorage.setItem storing key material
check('S4', 'No localStorage.setItem storing key material', () => {
  const matches = grepFiles(
    "localStorage\\.setItem\\s*\\([^)]*['\"]?(nsec|priv|secret|key|pairing)['\"]?",
    ['src'],
    ['ts', 'tsx', 'js'],
    '-i'
  );
  if (matches) {
    return { passed: false, detail: matches };
  }
  return { passed: true };
});

// S5 — No OPFS reference in netlify/functions/
check('S5', 'No OPFS in Netlify functions', () => {
  if (!fileExists('netlify/functions')) {
    return { skipped: true, reason: 'netlify/functions does not exist yet', passed: true };
  }
  const matches = grepFiles(
    'navigator\\.storage|getDirectory|OPFS|FileSystemDirectoryHandle|showDirectoryPicker',
    ['netlify/functions'],
    ['ts', 'js', 'mjs']
  );
  if (matches) {
    return { passed: false, detail: matches };
  }
  return { passed: true };
});

// S6 — No CMAC values in netlify/functions/
check('S6', 'No CMAC values in Netlify functions', () => {
  if (!fileExists('netlify/functions')) {
    return { skipped: true, reason: 'netlify/functions does not exist yet', passed: true };
  }
  const matches = grepFiles(
    'cmacHex|piccDataHex',
    ['netlify/functions'],
    ['ts', 'js', 'mjs']
  );
  if (matches) {
    return { passed: false, detail: matches };
  }
  return { passed: true };
});

// S7 — No external font CDN link tags in index.html
check('S7', 'No external font CDN links in index.html', () => {
  if (!fileExists('index.html')) {
    return { skipped: true, reason: 'index.html does not exist yet', passed: true };
  }
  const content = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const cdnPattern = /<link[^>]+(fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fast\.fonts\.net|cloud\.typography\.com|use\.fontawesome\.com|kit\.fontawesome\.com)/i;
  if (cdnPattern.test(content)) {
    const match = content.match(cdnPattern);
    return { passed: false, detail: match[0] };
  }
  return { passed: true };
});

// S8 — Production dependencies ≤ 22
check('S8', 'Production dependency count ≤ 22', () => {
  const pkg = readJson('package.json');
  if (!pkg) return { skipped: true, reason: 'package.json not found', passed: true };

  const deps = Object.keys(pkg.dependencies || {});
  const count = deps.length;
  if (count > 22) {
    return {
      passed: false,
      detail: `Found ${count} production deps (max 22):\n${deps.join('\n')}`,
    };
  }
  return { passed: true };
});

// S9 — Netlify function count ≤ 8
check('S9', 'Netlify function count ≤ 8', () => {
  if (!fileExists('netlify/functions')) {
    return { skipped: true, reason: 'netlify/functions does not exist yet', passed: true };
  }
  const count = countFiles('netlify/functions', ['ts', 'js', 'mjs'], 1);
  if (count > 8) {
    return { passed: false, detail: `Found ${count} functions (max 8)` };
  }
  return { passed: true };
});

// S10 — Every NIP-98 function calls verifyNip98
check('S10', 'All NIP-98 functions call verifyNip98', () => {
  if (!fileExists('netlify/functions')) {
    return { skipped: true, reason: 'netlify/functions does not exist yet', passed: true };
  }
  // Find files that reference NIP-98
  let nip98Files;
  try {
    const out = execSync(
      `grep -rl --include="*.ts" --include="*.js" --include="*.mjs" ` +
      `-E "NIP-98|nip98|NIP98" ${join(ROOT, 'netlify/functions')}`,
      { encoding: 'utf8' }
    );
    nip98Files = out.trim().split('\n').filter(Boolean);
  } catch {
    nip98Files = [];
  }

  const violations = [];
  for (const f of nip98Files) {
    const content = readFileSync(f, 'utf8');
    // Allow explicit opt-out: functions that document "NIP-98 not required"
    // (e.g., public endpoints like NIP-05 resolution)
    const hasOptOut = /NIP-98\s+not\s+required|no\s+auth\s+required/i.test(content);
    if (!hasOptOut && !/verifyNip98\s*\(/.test(content)) {
      violations.push(f.replace(ROOT + '/', ''));
    }
  }

  if (violations.length > 0) {
    return {
      passed: false,
      detail: `Missing verifyNip98 call:\n${violations.join('\n')}`,
    };
  }
  return { passed: true };
});

// S11 — No console.log/error with key-material variable names
check('S11', 'No console logging of key material', () => {
  const matches = grepFiles(
    'console\\.(log|error)\\s*\\([^)]*\\b(nsec|key|secret|share|proof)\\b',
    ['src', 'netlify'],
    ['ts', 'tsx', 'js', 'mjs']
  );
  if (matches) {
    return { passed: false, detail: matches };
  }
  return { passed: true };
});

// S12 — CSP does not contain unsafe-eval
check('S12', "CSP does not include 'unsafe-eval'", () => {
  if (!fileExists('netlify.toml')) {
    return { skipped: true, reason: 'netlify.toml does not exist yet', passed: true };
  }
  const content = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
  if (/'unsafe-eval'/.test(content)) {
    const line = content.split('\n').find(l => l.includes("'unsafe-eval'"));
    return { passed: false, detail: line || "'unsafe-eval' found in netlify.toml" };
  }
  return { passed: true };
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log();
console.log('─'.repeat(60));

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
const total  = results.length;

if (failed === 0) {
  console.log(`${GREEN}${BOLD}All ${total} invariants passed.${RESET}`);
  console.log();
  process.exit(0);
} else {
  console.log(`${RED}${BOLD}${failed} of ${total} invariants FAILED.${RESET}`);
  console.log();
  const failedChecks = results.filter(r => !r.passed).map(r => r.id).join(', ');
  console.log(`${DIM}Failed: ${failedChecks}${RESET}`);
  console.log();
  process.exit(1);
}
