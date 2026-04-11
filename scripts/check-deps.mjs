#!/usr/bin/env node
/**
 * check-deps.mjs
 *
 * Reads package.json and counts production dependencies.
 * Fails (exit 1) if count exceeds 22.
 *
 * Security Invariant S8: package.json production dependencies ≤ 22.
 *
 * Usage: node scripts/check-deps.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const PKG_PATH = resolve(ROOT, 'package.json');
const MAX_DEPS = 22;

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const BOLD  = '\x1b[1m';
const DIM   = '\x1b[2m';

if (!existsSync(PKG_PATH)) {
  console.error(`${RED}ERROR: package.json not found at ${PKG_PATH}${RESET}`);
  process.exit(1);
}

let pkg;
try {
  pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
} catch (err) {
  console.error(`${RED}ERROR: Failed to parse package.json: ${err.message}${RESET}`);
  process.exit(1);
}

const dependencies = pkg.dependencies || {};
const depNames = Object.keys(dependencies);
const count = depNames.length;

console.log();
console.log(`${BOLD}S8 — Production Dependency Count Check${RESET}`);
console.log(`${DIM}Limit: ${MAX_DEPS} | Found: ${count}${RESET}`);
console.log();

if (depNames.length > 0) {
  depNames.forEach((name, i) => {
    const version = dependencies[name];
    const marker = count > MAX_DEPS && i >= MAX_DEPS ? `${RED}  ← OVER LIMIT${RESET}` : '';
    console.log(`  ${String(i + 1).padStart(2, ' ')}. ${name}@${version}${marker}`);
  });
} else {
  console.log(`  ${DIM}(no production dependencies)${RESET}`);
}

console.log();

if (count > MAX_DEPS) {
  console.log(
    `${RED}${BOLD}FAIL${RESET} — ${count} production dependencies found (limit: ${MAX_DEPS}).`
  );
  console.log(
    `${DIM}Remove ${count - MAX_DEPS} package(s) from "dependencies" in package.json.${RESET}`
  );
  console.log();
  process.exit(1);
} else {
  console.log(
    `${GREEN}${BOLD}PASS${RESET} — ${count}/${MAX_DEPS} production dependencies (within limit).`
  );
  console.log();
  process.exit(0);
}
