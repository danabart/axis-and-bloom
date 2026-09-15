#!/usr/bin/env node
// Catalog Blueprint brief 3, Part D — no external deps, plain grep-style checks
// over backend/src/**/*.ts. Run via `npm run lint:catalog`; also invoked by a
// vitest wrapper (services/lintCatalog.test.ts) so `npm test` catches it too,
// and by .github/workflows/deploy.yml right before the backend build.
//
// Four rules, each an allow-list of {file, ...} exceptions with an expiry note
// where one applies. A rule failure is reported as `file:line  message` and
// the process exits 1; a clean run exits 0 and prints nothing (CI-quiet).

import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '..', 'src');
// Catalog Blueprint brief 4, Part A — rule 4 (hardcoded archetype labels) now
// also covers the admin frontend, since admin components must fetch labels
// from GET /api/admin/catalog/archetypes instead of a hardcoded map.
const FRONTEND_ADMIN_ROOT = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'app', 'components', 'admin');

// ── File discovery ──────────────────────────────────────────────────────────

const EXCLUDED_DIR_SEGMENTS = new Set(['db/seeds/_retired', 'db/migrations']);

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function isExcluded(relPath) {
  if (relPath.endsWith('.test.ts') || relPath.endsWith('.test.tsx')) return true;
  for (const seg of EXCLUDED_DIR_SEGMENTS) {
    if (relPath.includes(seg)) return true;
  }
  return false;
}

// root -> relative posix path, so every violation prints unambiguously
// regardless of which root (backend src, frontend admin) it came from.
const fileRoots = new Map();

function walk(root, dir, extensions, out) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(root, full, extensions, out);
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      const relPath = toPosix(path.relative(root, full));
      if (!isExcluded(relPath)) { fileRoots.set(relPath, root); out.push(relPath); }
    }
  }
  return out;
}

const files = walk(SRC_ROOT, SRC_ROOT, ['.ts'], []);
const frontendAdminFiles = walk(FRONTEND_ADMIN_ROOT, FRONTEND_ADMIN_ROOT, ['.ts', '.tsx'], []);

/** @type {{file: string, line: number, message: string}[]} */
const violations = [];

// Blanks out /* ... */ block comments (JSDoc included) before splitting into
// lines, replacing comment characters with spaces so line numbers (and
// column positions, not that this script uses them) are unaffected. Handles
// multi-line block comments; doesn't try to be a real tokenizer (a `/*`
// inside a string literal would confuse it, but none of this codebase's
// flagged files do that).
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

const fileLineCache = new Map();

function fileLines(relPath) {
  if (fileLineCache.has(relPath)) return fileLineCache.get(relPath);
  const root = fileRoots.get(relPath) ?? SRC_ROOT;
  const raw = readFileSync(path.join(root, relPath), 'utf8');
  const lines = stripBlockComments(raw).split('\n');
  fileLineCache.set(relPath, lines);
  return lines;
}

// Strips a trailing `// ...` line comment so prose in comments (e.g. a
// docstring quoting "Experimental" as a family name) never trips a literal
// or table-name check meant for real code. Block comments are handled
// separately, above, before the file is even split into lines.
function stripLineComment(line) {
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

// ── Rule 1: db.query('BEGIN') anywhere ──────────────────────────────────────
// Catalog writes go through withTransaction() (db/client.ts), which itself
// legitimately issues BEGIN on a checked-out client — that's `client.query`,
// never the shared pool `db` directly. This rule guards against that
// distinction being lost again.
const RULE1_PATTERN = /\bdb\.query\(\s*['"`]BEGIN['"`]/;

for (const relPath of files) {
  const lines = fileLines(relPath);
  lines.forEach((line, i) => {
    if (RULE1_PATTERN.test(stripLineComment(line))) {
      violations.push({ file: relPath, line: i + 1, message: `db.query('BEGIN') found — writes must go through withTransaction()` });
    }
  });
}

// ── Rule 2: DML on catalog tables outside services/catalogService.ts ───────
const DML_TABLES = [
  'coffee_slot_assignment', 'coffee_dial_slot', 'archetype_assignments',
  'dial_slot_price', 'dial_coffee_relationships', 'coffee_category_assignment',
  'roaster_blend', 'archetype', 'coffees',
];
const DML_VERBS = ['INSERT INTO', 'UPDATE', 'DELETE FROM'];
const RULE2_WRITER = 'services/catalogService.ts';
// {file, table, verb} — each an explicit, permanent-or-expiring exception.
const RULE2_ALLOWLIST = [
  { file: 'routes/orders.ts', table: 'roaster_blend', verb: 'UPDATE', note: 'commerce stock decrement, permanent' },
  { file: 'routes/admin.ts', table: 'coffees', verb: 'UPDATE', note: 'content columns, permanent' },
  { file: 'routes/coffees.ts', table: 'coffees', verb: 'UPDATE', note: 'content columns, permanent' },
  { file: 'services/qrDoor.ts', table: 'coffees', verb: 'UPDATE', note: 'content columns (qr_token), permanent' },
];

function buildDmlPattern(table, verb) {
  // e.g. /\bUPDATE\s+"?coffees"?\b/i
  const verbPattern = verb.replace(' ', '\\s+');
  return new RegExp(`\\b${verbPattern}\\s+"?${table}"?\\b`, 'i');
}

for (const relPath of files) {
  if (relPath === RULE2_WRITER) continue;
  const lines = fileLines(relPath);
  lines.forEach((line, i) => {
    const stripped = stripLineComment(line);
    for (const table of DML_TABLES) {
      for (const verb of DML_VERBS) {
        if (!buildDmlPattern(table, verb).test(stripped)) continue;
        const allowed = RULE2_ALLOWLIST.some(
          (a) => a.file === relPath && a.table === table && a.verb === verb
        );
        if (!allowed) {
          violations.push({
            file: relPath, line: i + 1,
            message: `${verb} on '${table}' outside services/catalogService.ts`,
          });
        }
      }
    }
  });
}

// ── Rule 3: references to dormant/legacy catalog tables & views ────────────
const RESTRICTED_REFS = [
  'dial_archetype_positions', 'coffee_alias', 'dial_slot_alias',
  'dial_position_vocabulary', 'dial_archetype_config',
  'v_dial_positions', 'v_dial_navigation',
];
// file → allowed patterns (subset of RESTRICTED_REFS), each with its expiry.
// Catalog Blueprint brief 4, Part A — routes/admin.ts's own allow-list entry
// removed now that admin.ts itself moves onto the views. Catalog Blueprint
// brief 5a (2026-09-15) dropped all seven RESTRICTED_REFS objects outright —
// dialSuggestion.ts's vocabulary-id mapping and catalogService.ts's
// roastery-lifecycle-cascade read (two of the three entries this allow-list
// used to carry) no longer exist. The third — catalogIntegrity.ts's check 13
// — turns out to need a PERMANENT exception instead of disappearing: the
// check's entire job, now that the objects are dropped, is asserting none of
// them exist (`to_regclass('public.' || name) IS NOT NULL`), which requires
// literally naming all seven as data (a JS string array passed as a query
// parameter, not a live SQL reference) — this rule's regex can't distinguish
// that from a real reference. Discovered running `npm run lint:catalog`
// against this brief's own check-13 rewrite, not anticipated by the brief
// text (which called for an empty allow-list). Scoped to check 13's own
// array literal only, not the whole file.
const RULE3_ALLOWLIST = {
  'services/catalogIntegrity.ts': {
    patterns: [...RESTRICTED_REFS],
    note: 'check 13 names all seven as data, to assert none exist — permanent, does not expire',
  },
};

for (const relPath of files) {
  const lines = fileLines(relPath);
  const allow = RULE3_ALLOWLIST[relPath];
  lines.forEach((line, i) => {
    const stripped = stripLineComment(line);
    for (const ref of RESTRICTED_REFS) {
      if (!new RegExp(`\\b${ref}\\b`).test(stripped)) continue;
      const allowed = allow && allow.patterns.includes(ref);
      if (!allowed) {
        violations.push({ file: relPath, line: i + 1, message: `reference to legacy table/view '${ref}' outside its allow-list` });
      }
    }
  });
}

// ── Rule 4: hardcoded archetype display-label literals ─────────────────────
const LABELS = ['Chocolate & Nutty', 'Balanced & Sweet', 'Fruity', 'Earthy', 'Floral', 'Experimental'];
const RULE4_SCOPE_DIRS = ['routes/', 'services/'];
// Catalog Blueprint brief 4, Part A — routes/admin.ts's own allow-list entry
// removed now that admin.ts fetches labels from GET /catalog/archetypes too;
// the scope also grows to frontend/src/app/components/admin/** (scanned
// separately below, frontendAdminFiles) — an admin component must fetch
// labels via useArchetypes(), not import archetypeConstants.ts. Two
// pre-existing quiz-subsystem files stay allow-listed — discovered during
// brief 3's implementation, not in that brief's Task 0 inventory:
// quizScoring.findWinner's tie-break default and quizIntegrity.ts check 8
// both predate the Catalog Blueprint, belong to the quiz subsystem (not
// catalog placement), and asserting/returning a literal archetype name is
// their actual job (integrity check 8 IS the spelling check; findWinner's
// default is a scoring tie-break, not a "label lookup"). Rewriting either
// into the async catalogReads API would ripple through the quiz subsystem's
// unrelated call graph — out of this brief's scope too, same "another
// thread" boundary the brief itself draws around the Balanced rename.
const RULE4_ALLOWLIST_FILES = new Set([
  'services/quizScoring.ts',
  'services/quizIntegrity.ts',
]);

function buildLabelPattern(label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`['"]${escaped}['"]`);
}

function checkRule4(relPath) {
  if (RULE4_ALLOWLIST_FILES.has(relPath)) return;
  const lines = fileLines(relPath);
  lines.forEach((line, i) => {
    const stripped = stripLineComment(line);
    for (const label of LABELS) {
      if (buildLabelPattern(label).test(stripped)) {
        violations.push({ file: relPath, line: i + 1, message: `hardcoded archetype label literal '${label}' — use archetypeLabel()` });
      }
    }
  });
}

for (const relPath of files) {
  if (RULE4_SCOPE_DIRS.some((d) => relPath.startsWith(d))) checkRule4(relPath);
}
for (const relPath of frontendAdminFiles) {
  checkRule4(relPath);
}

// ── Report ───────────────────────────────────────────────────────────────────

if (violations.length) {
  console.error(`lint:catalog — ${violations.length} violation(s):\n`);
  for (const v of violations) {
    const prefix = fileRoots.get(v.file) === FRONTEND_ADMIN_ROOT ? 'frontend/src/app/components/admin' : 'backend/src';
    console.error(`  ${prefix}/${v.file}:${v.line}  ${v.message}`);
  }
  process.exit(1);
}
