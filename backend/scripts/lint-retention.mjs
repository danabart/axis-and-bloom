#!/usr/bin/env node
// Quiz Resync Fix Part D1 (2026-09-25) — no external deps, plain grep-style
// check over backend/src/**/*.ts, same shape as lint-catalog.mjs (its sibling,
// not merged into it — a distinct concern deserves its own script and its own
// clean pass/fail). Run via `npm run lint:retention`; also invoked by
// .github/workflows/deploy.yml right before the backend build.
//
// One rule: DELETE FROM (or TRUNCATE of) api_event, quiz_funnel_event,
// quiz_session, or newsletter_subscriber, anywhere outside src/test/. These
// four are gold or near-gold — quiz_funnel_event and quiz_session are the
// crawl's own source-of-truth tables, api_event is the append-only record
// that made the 2026-09-24 audit possible in the first place, and
// newsletter_subscriber is what the Quiz Resync Fix exists to stop being
// silently corrupted. No existing app code deletes from any of them as of
// this writing (confirmed by hand before adding this rule) — this exists so
// that stays true. A failure is reported as `file:line  message` and the
// process exits 1; a clean run exits 0 and prints nothing (CI-quiet).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '..', 'src');

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// Deliberate deviation from "outside src/test/" taken literally (reported,
// not silently done): every *.test.ts file needs to be excluded, not just
// files under the src/test/ directory — a test's own afterAll cleanup
// legitimately DELETEs the exact rows it seeded in newsletter.test.ts,
// staleGuestCleanup.test.ts, etc., none of which live under src/test/. This
// matches lint-catalog.mjs's own established exclusion (by extension, not
// just directory) for the identical reason. src/test/ itself (globalSetup.ts
// and friends) is excluded too, same as the brief asked.
function isExcluded(relPath) {
  if (relPath.endsWith('.test.ts') || relPath.endsWith('.test.tsx')) return true;
  return relPath === 'test' || relPath.startsWith('test/');
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.ts')) {
      const relPath = toPosix(path.relative(SRC_ROOT, full));
      if (!isExcluded(relPath)) out.push(relPath);
    }
  }
  return out;
}

const files = walk(SRC_ROOT, []);

/** @type {{file: string, line: number, message: string}[]} */
const violations = [];

// Same block-comment blanking as lint-catalog.mjs, so a docstring mentioning
// one of these tables in prose never trips the check.
function stripBlockComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let j = i; j < stop; j++) out += text[j] === '\n' ? '\n' : ' ';
      i = stop;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

function stripLineComment(line) {
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

const PROTECTED_TABLES = ['api_event', 'quiz_funnel_event', 'quiz_session', 'newsletter_subscriber'];

function buildPattern(table) {
  // e.g. /\b(DELETE\s+FROM|TRUNCATE(\s+TABLE)?)\s+"?api_event"?\b/i
  return new RegExp(`\\b(DELETE\\s+FROM|TRUNCATE(\\s+TABLE)?)\\s+"?${table}"?\\b`, 'i');
}

for (const relPath of files) {
  const raw = readFileSync(path.join(SRC_ROOT, relPath), 'utf8');
  const lines = stripBlockComments(raw).split('\n');
  lines.forEach((line, i) => {
    const stripped = stripLineComment(line);
    for (const table of PROTECTED_TABLES) {
      if (buildPattern(table).test(stripped)) {
        violations.push({
          file: relPath, line: i + 1,
          message: `DELETE/TRUNCATE on '${table}' outside src/test/ — this table is append-only/gold by decision (see api_event_log/REPLAY.md)`,
        });
      }
    }
  });
}

if (violations.length) {
  console.error(`lint:retention — ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.error(`  backend/src/${v.file}:${v.line}  ${v.message}`);
  }
  process.exit(1);
}
