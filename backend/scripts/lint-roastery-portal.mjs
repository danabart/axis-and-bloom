#!/usr/bin/env node
// Roastery Portal (2026-10-05) — no external deps, plain grep-style checks over
// backend/src/**/*.ts, cloned from lint-customer.mjs's structure (file walk,
// block-comment blanking, `file:line  message`, exit 1). Run via
// `npm run lint:roastery-portal`; also run by .github/workflows/deploy.yml right
// before the backend build, beside lint:catalog / lint:retention / lint:customer.
// See backend/src/features/roastery_portal/CLAUDE_CODE_PROMPT_ROASTERY_PORTAL_1.md, B6.
//
// Rule 1: any INSERT / UPDATE / DELETE / TRUNCATE on a roastery_portal_* table
//         outside services/roasteryPortalService.ts fails.
// Rule 2: the portal's own files (the service, the reads, both route files) must
//         not contain DML on `coffees`, any `coffee_*` table, or
//         `roastery_coffee_descriptors` — the portal collects evidence, it never
//         writes the catalog (accepting answers is part 2).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '..', 'src');

function toPosix(p) { return p.split(path.sep).join('/'); }

function isExcluded(relPath) {
  return relPath.endsWith('.test.ts') || relPath.endsWith('.test.tsx') || relPath.includes('db/migrations');
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) {
      const relPath = toPosix(path.relative(SRC_ROOT, full));
      if (!isExcluded(relPath)) out.push(relPath);
    }
  }
  return out;
}

// Blank block comments and `//` line comments (keeping newlines so line numbers
// stay right) so prose mentioning a table or verb never trips a check.
function stripComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let j = i; j < stop; j++) out += text[j] === '\n' ? '\n' : ' ';
      i = stop;
    } else if (text[i] === '/' && text[i + 1] === '/' && text[i - 1] !== ':') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++; }
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

function lineNumberAt(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') n++;
  return n;
}

const WRITER = 'services/roasteryPortalService.ts';
const PORTAL_FILES = new Set([
  'services/roasteryPortalService.ts',
  'services/roasteryPortalReads.ts',
  'routes/roasteryPortal.ts',
  'routes/roasteryPortalAdmin.ts',
]);

const RULE1 = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?"?(roastery_portal_\w+)"?/gi;
const RULE2 = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+(?:ONLY\s+)?"?(coffees|coffee_\w+|roastery_coffee_descriptors)"?\b/gi;

const violations = [];
for (const relPath of walk(SRC_ROOT, [])) {
  const text = stripComments(readFileSync(path.join(SRC_ROOT, relPath), 'utf8'));
  let m;
  if (relPath !== WRITER) {
    RULE1.lastIndex = 0;
    while ((m = RULE1.exec(text))) {
      violations.push({ file: relPath, line: lineNumberAt(text, m.index), message: `${m[1].toUpperCase()} on '${m[2]}' outside ${WRITER}` });
    }
  }
  if (PORTAL_FILES.has(relPath)) {
    RULE2.lastIndex = 0;
    while ((m = RULE2.exec(text))) {
      violations.push({ file: relPath, line: lineNumberAt(text, m.index), message: `${m[1].toUpperCase()} on catalog table '${m[2]}' — the portal never writes the catalog (part 2 does)` });
    }
  }
}

if (violations.length) {
  console.error(`lint:roastery-portal — ${violations.length} violation(s):\n`);
  for (const v of violations) console.error(`  backend/src/${v.file}:${v.line}  ${v.message}`);
  process.exit(1);
}
console.log('lint:roastery-portal — clean');
