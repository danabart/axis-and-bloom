#!/usr/bin/env node
// Customer Blueprint brief C1, Part E — no external deps, plain grep-style
// checks over backend/src/**/*.ts, cloned from lint-catalog.mjs's structure
// (file walk, allow-lists with expiry notes, `file:line  message`, exit 1).
// Run via `npm run lint:customer`; also invoked by a vitest wrapper
// (services/lintCustomer.test.ts) and by .github/workflows/deploy.yml right
// before the backend build, beside lint:catalog.
//
// Started at four rules (C1, Part E); rules 5/6 added in C3, Part F; rule 7
// added in a later C3 fix pass. See backend/src/features/customer_blueprint/
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
// Customer Blueprint C3, Part C (2026-09-27) — every `until C3` entry from C1/
// C2 is gone: quiz.ts's archetype/quiz_sessions/taste_journey writers,
// orders.ts's feedback/confidence writers, users.ts's dial/liam_saves/brew
// writers, behavioralConfidence.ts, liamSmsFeedback.ts, sommelierEvaluator.ts,
// outcomeTracker.ts and sommelier.ts's resolveRemember/evaluation writers are
// all retired. What's left in each of these files (below) is deliberately
// permanent, not "until" anything: operating-state mirrors (user doc email/
// name/tokenBalance sync) and the Liam transcript — this rule can't tell
// which specific write in a file is legitimate, only that the file has one,
// so a future regression re-adding a retired write to one of these same
// files would NOT be caught by this rule alone; rule 5 (retired Firestore
// *reads*) is the backstop for the read side of the same regression class.
const RULE3_PERMANENT = [
  { file: 'routes/sommelier.ts', note: 'sommelier_sessions/{id}/messages transcript — permanent' },
  { file: 'routes/users.ts', note: 'user doc email/firstName/lastName/syncedAt sync (GET, PATCH /profile) — permanent' },
  { file: 'routes/orders.ts', note: 'user doc tokenBalance sync (signup bonus award) — permanent' },
  { file: 'services/tokenService.ts', note: 'user doc tokenBalance sync — permanent' },
];
const RULE3_ALLOWLIST = [];
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

// ── Rule 5: no firestoreDb read of a retired path (Customer Blueprint C3, Part C) ──
// The writers to these paths are gone (rule 3 above no longer allow-lists
// them); a read of one now means either a leftover reader C3 missed, or a
// future reader accidentally pointed at history instead of the SQL views.
// Allow-list: customerIntegrity.ts's own check 15, which deliberately reads
// these exact paths to verify nothing writes to them any more — a read for
// monitoring, not a production consumer.
const RETIRED_FIRESTORE_PATH_FRAGMENTS = [
  'feedback_events', 'dial_events', 'metadata/brew_profile', 'metadata/taste_journey',
  'metadata/confidence_profile', 'quiz_sessions', 'liam_saves', 'sommelier_evaluations',
];
const RULE5_ALLOWLIST = new Set(['services/customerIntegrity.ts']);
const firestoreRefRe = /firestoreDb\s*\.\s*(?:doc|collection|collectionGroup)\s*\(\s*[`'"]([^`'"]*)[`'"]/g;
for (const relPath of files) {
  if (RULE5_ALLOWLIST.has(relPath)) continue;
  const text = fileText(relPath);
  let rm;
  while ((rm = firestoreRefRe.exec(text))) {
    const refPath = rm[1];
    const hit = RETIRED_FIRESTORE_PATH_FRAGMENTS.find(f => refPath.includes(f));
    if (hit) {
      violations.push({ file: relPath, line: lineNumberAt(text, rm.index), message: `Firestore read of a retired path ('${hit}') — writers were removed in Customer Blueprint C3` });
    }
  }
  // collectionGroup('feedback_events') etc. pass a bare name, not a path
  // containing the fragment — caught separately since the regex above only
  // matches doc/collection paths with the fragment as a substring, which
  // already covers collectionGroup('feedback_events') too (fragment ===
  // whole string). No separate pass needed.
}

// ── Rule 6: SELECT from user_flavor_feedback outside a view (Customer
// Blueprint C3, Part C) ── The table has no writer left (orders.ts's
// DELETE+INSERT is gone); v_collaborative_flavor_wheel is repointed to
// customer_feedback_descriptor. Three pre-existing COUNT(*) admin/analytics
// reads are allow-listed here rather than migrated — the brief's own Part F
// docs keep the table "queryable until no view names it", and these were
// never business-logic reads of its rows, only trivial aggregate counts.
// Deviation from the brief's literal "any SELECT ... outside a view fails":
// disclosed here and in the C3 closing report, same precedent as rule 3's
// own documented strengthening beyond its brief's literal wording.
const RULE6_ALLOWLIST = new Set(['routes/admin.ts', 'routes/axis.ts', 'routes/users.ts']);
for (const relPath of files) {
  if (RULE6_ALLOWLIST.has(relPath)) continue;
  const lines = fileText(relPath).split('\n');
  lines.forEach((line, i) => {
    const stripped = stripLineComment(line);
    if (/\bFROM\s+"?user_flavor_feedback"?\b/i.test(stripped)) {
      violations.push({ file: relPath, line: i + 1, message: `SELECT from 'user_flavor_feedback' outside a view` });
    }
  });
}

// ── Rule 7: no CREATE OR REPLACE VIEW under the Customer Blueprint C3 block ──
// Dana, 2026-09-27, after CREATE OR REPLACE VIEW's column-reorder restriction
// (Postgres error 42P16) broke v_palate_slot_candidates live in production —
// rule 6 inserted a column ahead of existing ones, which CREATE OR REPLACE
// silently can't do (the failure is non-fatal per-statement at boot, so the
// view was just silently left on its old definition). Every view in this
// block now uses DROP VIEW IF EXISTS ... CASCADE; CREATE VIEW instead (see
// schema.sql's own comment above v_customer_identity) — this rule keeps it
// that way. Scope is schema.sql only, between the block's own BEGIN/END
// markers (added the same day as this rule, for exactly this purpose) — a
// CREATE OR REPLACE VIEW elsewhere in the file (catalog/quiz/reporting views
// that predate this convention and have no history of this failure mode) is
// out of scope and not flagged.
{
  const beginMarker = '-- BEGIN CUSTOMER BLUEPRINT C3 views/tables block';
  const endMarker = '-- END CUSTOMER BLUEPRINT C3 views/tables block';
  const beginIdx = schemaText.indexOf(beginMarker);
  const endIdx = schemaText.indexOf(endMarker);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    violations.push({
      file: 'db/schema.sql',
      line: 1,
      message: `Rule 7 can't find the Customer Blueprint C3 block markers ('${beginMarker}' / '${endMarker}') — schema.sql was restructured; update lint-customer.mjs's markers or this rule silently checks nothing`,
    });
  } else {
    // Strip SQL line comments (`-- ...`) before matching — this file's own
    // prose (including this rule's explanatory comments) mentions
    // "CREATE OR REPLACE VIEW" by name, which must not self-trigger.
    const block = schemaText.slice(beginIdx, endIdx);
    const blockNoComments = block
      .split('\n')
      .map(line => {
        const idx = line.indexOf('--');
        return idx === -1 ? line : line.slice(0, idx);
      })
      .join('\n');
    const reReplaceRe = /CREATE\s+OR\s+REPLACE\s+VIEW\s+(\w+)/gi;
    let rm;
    while ((rm = reReplaceRe.exec(blockNoComments))) {
      violations.push({
        file: 'db/schema.sql',
        line: lineNumberAt(schemaText, beginIdx + rm.index),
        message: `CREATE OR REPLACE VIEW '${rm[1]}' under the Customer Blueprint C3 block — use DROP VIEW IF EXISTS ... CASCADE; CREATE VIEW instead (CREATE OR REPLACE can't reorder/rename columns, see this view's own history)`,
      });
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
if (violations.length) {
  console.error(`lint:customer — ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.error(`  backend/src/${v.file}:${v.line}  ${v.message}`);
  }
  process.exit(1);
}
