#!/usr/bin/env node
// Customer Blueprint brief C1, Part E — no external deps, plain grep-style
// checks over backend/src/**/*.ts, cloned from lint-catalog.mjs's structure
// (file walk, allow-lists with expiry notes, `file:line  message`, exit 1).
// Run via `npm run lint:customer`; also invoked by a vitest wrapper
// (services/lintCustomer.test.ts) and by .github/workflows/deploy.yml right
// before the backend build, beside lint:catalog.
//
// Four rules. See backend/src/features/customer_blueprint/
// CLAUDE_CODE_PROMPT_CUSTOMER_1_ROLES_NAMING_DOOR.md, Part E.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '..', 'src');
const SCHEMA_PATH = path.resolve(SRC_ROOT, 'db', 'schema.sql');

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
// one of these tables/verbs in prose never trips a check meant for real code.
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

const fileTextCache = new Map();
function fileText(relPath) {
  if (fileTextCache.has(relPath)) return fileTextCache.get(relPath);
  const raw = readFileSync(path.join(SRC_ROOT, relPath), 'utf8');
  const stripped = stripBlockComments(raw);
  fileTextCache.set(relPath, stripped);
  return stripped;
}

function stripLineComment(line) {
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

function lineNumberAt(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') n++;
  return n;
}

// ── Fact table list, parsed from schema.sql at lint time so it never goes
// stale (Part E, rule 1's own instruction) ───────────────────────────────────
const schemaText = readFileSync(SCHEMA_PATH, 'utf8');
const FACT_TABLES = [...schemaText.matchAll(/CREATE TABLE IF NOT EXISTS (customer_\w+)/g)].map(m => m[1]);
// customer_order_kind is a dimension, not a fact (D18) — excluded everywhere below.
const FACT_TABLES_NO_DIMENSION = FACT_TABLES.filter(t => t !== 'customer_order_kind');
const NAMED_FACT_TABLES = ['quiz_session', 'quiz_session_interpretation', 'order', 'order_line_item'];
const ALL_FACT_TABLES = [...FACT_TABLES_NO_DIMENSION, 'catalog_change'];

// ── Rule 1: INSERT into a fact table outside the door ───────────────────────
// Allowed writer: services/customerFacts.ts. No allow-list this brief.
// quiz_session/quiz_session_interpretation/"order"/order_line_item are NOT
// covered by this rule yet (their writers are quizSession.ts/orders.ts and
// stay so until C2 decides whether they move behind the door).
const RULE1_WRITER = 'services/customerFacts.ts';
function buildInsertPattern(table) {
  return new RegExp(`\\bINSERT\\s+INTO\\s+"?${table}"?\\b`, 'i');
}
for (const relPath of files) {
  if (relPath === RULE1_WRITER) continue;
  const text = fileText(relPath);
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const stripped = stripLineComment(line);
    for (const table of ALL_FACT_TABLES) {
      if (buildInsertPattern(table).test(stripped)) {
        violations.push({ file: relPath, line: i + 1, message: `INSERT INTO '${table}' outside services/customerFacts.ts` });
      }
    }
  });
}

// ── Rule 2: UPDATE or DELETE on any fact table, anywhere, including the door ─
// Same table list plus the four named ones. Allow-list: none. Task 0
// (2026-09-27) found no live UPDATE/DELETE against any fact table anywhere in
// backend/src — both quizSession.ts's live path and
// quizInterpretationBackfill.ts's backfill are INSERT-only (every row is
// written with its final is_current/valid_to already decided in application
// code, never flipped afterward by an UPDATE). So there is nothing to
// allow-list for quiz_session_interpretation's "SCD2 flip" the brief
// describes — it doesn't exist as a live UPDATE today. If one is ever added,
// it needs an entry here (and the column-level grant in schema.sql's Part A2
// needs to match its exact column list). routes/orders.ts's
// `DELETE FROM user_flavor_feedback` is NOT matched by this rule —
// user_flavor_feedback isn't a fact table by name — listed here only as the
// reminder the brief itself asks for: C2 removes that statement.
const RULE2_ALLOWLIST = [
  { file: 'services/customerIntegrity.ts', table: 'quiz_session', verb: 'UPDATE', note: 'check 3, the live immutability probe — always WHERE false, always rolled back, permanent' },
];
function buildDmlPattern(table, verb) {
  const verbPattern = verb.replace(' ', '\\s+');
  return new RegExp(`\\b${verbPattern}\\s+"?${table}"?\\b`, 'i');
}
for (const relPath of files) {
  const text = fileText(relPath);
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const stripped = stripLineComment(line);
    for (const table of [...ALL_FACT_TABLES, ...NAMED_FACT_TABLES]) {
      for (const verb of ['UPDATE', 'DELETE FROM']) {
        if (!buildDmlPattern(table, verb).test(stripped)) continue;
        const allowed = RULE2_ALLOWLIST.some(a => a.file === relPath && a.table === table && a.verb === verb);
        if (!allowed) {
          violations.push({ file: relPath, line: i + 1, message: `${verb} on fact table '${table}' — facts are append-only (D3/D17)` });
        }
      }
    }
  });
}

// ── Rule 3: Firestore writes on customer (`users/`) paths ───────────────────
// The brief's own pattern ("firestoreDb.(doc|collection)(`users/` followed
// within the same statement chain by .set(/.add(/.update(, scan forward to
// the next `;`") misses a pattern this codebase uses at least four real
// places today: `const ref = firestoreDb.doc(...)` (or `.collection(...)`)
// assigned once, read from, and written via the variable much later —
// quiz.ts's `journeyRef` (taste_journey), sommelier.ts's `docRef`
// (resolveRemember/brew_profile), users.ts's two tombstone `ref`s
// (dial_events/liam_saves removedAt). The literal same-statement rule would
// silently pass all four AND any future write using the same pattern,
// defeating rule 3's stated purpose ("a new Firestore write anywhere fails
// the build from this brief on"). Deliberately strengthened beyond the
// brief's literal wording (reported here, not silently done, same precedent
// as lint-catalog.mjs's own rule 3/rule 4 deviations): this also tracks
// `const/let <name> = firestoreDb.(doc|collection)(\`...users/...\`)`
// bindings per file and flags `<name>.set(/.add(/.update(` anywhere later in
// that same file, not just within the assignment's own statement.
const RULE3_PERMANENT = [
  // routes/sommelier.ts's message transcript — permanent, never expires,
  // both the direct chain and its two collection-ref-then-.doc().set()
  // variants (messagesCol / messagesColForClose).
  { file: 'routes/sommelier.ts', note: 'sommelier_sessions/{id}/messages transcript — permanent' },
];
// Exact sites found in Task 0 (2026-09-27), not just the brief's own rough
// bucket list — grepped `\.(set|add|update)\(` over src/**/*.ts excluding
// tests, then traced each to its Firestore path by hand (see the closing
// report for the full table). Customer Blueprint C2 (2026-09-27) relabels
// every `until C2` note to `until C3`, per its own Part D instruction — dual-
// write now exists for feedback/brew/dial (routes/orders.ts,
// services/liamSmsFeedback.ts, routes/users.ts, routes/sommelier.ts's
// resolveRemember), but the OLD Firestore writer stays exactly where it is
// until C3 retires it. Two of these seven never actually gained a C2 writer
// (services/behavioralConfidence.ts's confidence_profile — no fact table for
// it exists at all; routes/users.ts's liam_saves sub-note — C2's real scope
// never touched it, "C2" was only ever an analogy in C1) — relabeled to
// `until C3` anyway per the brief's literal instruction, flagged here and in
// the C2 closing report rather than silently left as a stale `until C2`.
const RULE3_ALLOWLIST = [
  { file: 'routes/quiz.ts', note: 'until C3' },
  { file: 'routes/orders.ts', note: 'until C3 (user doc, feedback/confidence)' },
  { file: 'routes/users.ts', note: 'until C3 (user doc, dial/liam_saves/brew)' },
  { file: 'services/behavioralConfidence.ts', note: 'until C3' },
  { file: 'services/liamSmsFeedback.ts', note: 'until C3' },
  { file: 'services/sommelierEvaluator.ts', note: 'until C3' },
  { file: 'services/outcomeTracker.ts', note: 'until C3' },
  { file: 'routes/sommelier.ts', note: 'until C3 (resolveRemember -> brew_profile; evaluations)' },
  { file: 'services/tokenService.ts', note: 'until C3 (user doc tokenBalance sync)' },
];
function isRule3Allowed(relPath) {
  return RULE3_PERMANENT.some(a => a.file === relPath) || RULE3_ALLOWLIST.some(a => a.file === relPath);
}

const WRITE_METHOD_RE = /\.(set|add|update)\s*\(/;
for (const relPath of files) {
  const text = fileText(relPath);
  const allowed = isRule3Allowed(relPath);

  // (a) direct chain: firestoreDb.(doc|collection)(`...users/...`) ... .set/
  // add/update( before the next top-level `;`.
  const chainRe = /firestoreDb\s*\.\s*(doc|collection)\s*\(/g;
  let m;
  while ((m = chainRe.exec(text))) {
    const semiIdx = text.indexOf(';', m.index);
    const chunk = text.slice(m.index, semiIdx === -1 ? text.length : semiIdx + 1);
    const hasUsersPath = /users\//.test(chunk);
    if (hasUsersPath && WRITE_METHOD_RE.test(chunk) && !allowed) {
      violations.push({ file: relPath, line: lineNumberAt(text, m.index), message: `Firestore write on a users/ path outside the door (direct chain)` });
    }
  }

  // (b) ref-variable binding: const/let <name> = firestoreDb.(doc|collection)(`...users/...`)
  // then <name>.set(/.add(/.update( anywhere later in the file.
  const bindRe = /\b(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?firestoreDb\s*\.\s*(?:doc|collection)\s*\(\s*[`'"]([^`'"]*)[`'"]/g;
  while ((m = bindRe.exec(text))) {
    const [, varName, refPath] = m;
    if (!refPath.includes('users/')) continue;
    const writeRe = new RegExp(`\\b${varName}\\s*\\.(set|add|update)\\s*\\(`);
    const writeMatch = writeRe.exec(text.slice(m.index));
    if (writeMatch && !allowed) {
      violations.push({
        file: relPath,
        line: lineNumberAt(text, m.index + writeMatch.index),
        message: `Firestore write on a users/ path outside the door (via ref variable '${varName}')`,
      });
    }
  }
}

// ── Rule 4: direct SELECT from a customer_* table outside customerReads.ts ──
// Allowed: services/customerReads.ts, services/customerIntegrity.ts,
// services/customerFacts.ts (its own RETURNING/duplicate check), test files
// (already excluded). Scope: customer_* and catalog_change only — the four
// named tables have dozens of legitimate readers today; C3 moves them.
const RULE4_ALLOWLIST_FILES = new Set([
  'services/customerReads.ts',
  'services/customerIntegrity.ts',
  'services/customerFacts.ts',
]);
function buildSelectPattern(table) {
  return new RegExp(`\\bSELECT\\b[\\s\\S]*?\\bFROM\\s+"?${table}"?\\b`, 'i');
}
for (const relPath of files) {
  if (RULE4_ALLOWLIST_FILES.has(relPath)) continue;
  const lines = fileText(relPath).split('\n');
  lines.forEach((line, i) => {
    const stripped = stripLineComment(line);
    for (const table of ALL_FACT_TABLES) {
      // Single-line SELECT ... FROM check (matches this codebase's own
      // lint-catalog.mjs precision level — a multi-line SELECT whose FROM is
      // on a later line is out of scope for this grep-style check, same
      // limitation lint-catalog.mjs accepts for its own DML rule).
      if (new RegExp(`\\bFROM\\s+"?${table}"?\\b`, 'i').test(stripped)) {
        violations.push({ file: relPath, line: i + 1, message: `SELECT from '${table}' outside services/customerReads.ts` });
      }
    }
  });
}

// ── Report ───────────────────────────────────────────────────────────────────
if (violations.length) {
  console.error(`lint:customer — ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.error(`  backend/src/${v.file}:${v.line}  ${v.message}`);
  }
  process.exit(1);
}
