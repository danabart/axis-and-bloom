#!/usr/bin/env node
// Data catalog brief 3, Part A (2026-10-16) — who writes and who reads every
// table, from the code, and the one-writer rule
// (backend/src/features/data_catalog/CLAUDE_CODE_PROMPT_DATA_CATALOG_3_LINEAGE.md).
//
// No deps, no database: walks backend/src, backend/scripts and
// cloud-functions (tests, db/migrations, db/seeds/_retired excluded), finds
// SQL verbs against known tables, and compares each table's static writers
// with the `Writer:` field of its comment in backend/src/db/comments.sql.
//
// Writer field format (Dana, 2026-10-16): `module.function` entries
// separated by commas, groups separated by semicolons, e.g.
//   Writer: catalogService.createCoffee, catalogService.updateCoffee; seed; backfill:migrateSavedItems
// Only the module part (before the dot) is compared. A module is a file
// stem (routes/orders.ts -> orders); `seed` is schema.sql or db/seeds/*;
// `backfill:<name>` is any file under backend/scripts or backend/src/scripts;
// `cloud-function:<dir>` a cloud function; `manual:<what>` is an operation
// run by hand (never expected in code, never warned about).
//
// Rule 1, one writer (set match, Dana 2026-10-16): a table's static writer
// modules must equal its declared set. An extra static writer FAILS (exit 1).
// A declared module with no static write is a warning (dead door).
// Rule 2: a table with no reader in code and no view reading it is a warning
// (dead table candidate).
//
// `// lineage: probe, not a write` on the statement's line or the line above
// makes that one write not count (a grant probe, `UPDATE t SET id = id WHERE
// false`). Every use is listed in lineage.json, so it cannot hide a real
// write silently.
//
// Writes backend/lineage.json (deterministic apart from generated_at).
// CI-quiet when clean; pass --warnings to print the warnings too.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(BACKEND, '..');
const COMMENTS_SQL = join(BACKEND, 'src', 'db', 'comments.sql');
const SCHEMA_SQL = join(BACKEND, 'src', 'db', 'schema.sql');
const OUT = process.env.LINEAGE_OUT ?? join(BACKEND, 'lineage.json');
const SHOW_WARNINGS = process.argv.includes('--warnings');
const PROBE_MARKER = '// lineage: probe, not a write';

// SQL functions that write tables (decision 2). Calling one counts as a
// write by the caller. Definitions: schema.sql (quiz_* family, Prompt 4A)
// and db/functions/grant_tokens.sql.
const SQL_WRITE_FUNCTIONS = {
  quiz_assert_question: ['quiz_question'],
  quiz_assert_answer: ['quiz_answer'],
  quiz_assert_answer_score: ['quiz_answer_archetype_score'],
  quiz_answer_new_version: ['quiz_answer', 'quiz_answer_archetype_score'],
  quiz_retire_answer: ['quiz_answer'],
  grant_tokens: ['user_tokens', 'token_events'],
};

// Helpers that take the table name as an argument instead of naming it in
// the SQL (`INSERT INTO ${table}`). customerFacts.insertFact writes every
// customer_* fact table (Customer Blueprint C2).
const TABLE_ARG_HELPERS = [
  { file: 'backend/src/services/customerFacts.ts', re: /\binsertFact\s*\(\s*[^,]+,\s*'([a-z_][a-z0-9_]*)'/g, verb: 'INSERT' },
];

// Files that only mention SQL as text (lint patterns, this scanner).
const NOT_DB_CODE = /^backend\/scripts\/(lint-[^/]+|lineage-scan)\.mjs$/;

// ── Known relations (from comments.sql: every table and view has one) ─────
const commentsSql = readFileSync(COMMENTS_SQL, 'utf8');
const TABLES = new Map(); // table -> raw Writer field
const VIEWS = new Set();
for (const line of commentsSql.split(/\r?\n/)) {
  const m = /^COMMENT ON (TABLE|VIEW) "?([a-z_][a-z0-9_]*)"? IS \$c\$(.*)\$c\$;$/.exec(line);
  if (!m) continue;
  if (m[1] === 'VIEW') { VIEWS.add(m[2]); continue; }
  const w = /(?:^| \| )Writer: ([^|]*)/.exec(m[3]);
  TABLES.set(m[2], w ? w[1].trim() : '');
}

// Splits on , and ; outside parentheses, so a note like "(INSERT first,
// UPDATE at finish)" stays inside its entry.
function splitEntries(field) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of field) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || ch === ';')) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(e => e.trim()).filter(Boolean);
}

export function declaredModules(field) {
  if (!field || /^none\b/i.test(field.trim())) return [];
  const mods = splitEntries(field).map(e => {
    if (/^seed\b/.test(e)) return 'seed';
    return e.split(/[.\s(]/)[0];
  });
  return [...new Set(mods)].sort();
}

// ── View -> relations it reads, from schema.sql (last definition wins) ─────
const schemaSql = readFileSync(SCHEMA_SQL, 'utf8').replace(/--[^\n]*/g, '');
const VIEW_READS = new Map();
for (const m of schemaSql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+"?([a-z_][a-z0-9_]*)"?\s+AS\b([\s\S]*?);/gi)) {
  const reads = new Set();
  for (const r of m[2].matchAll(/\b(?:FROM|JOIN)\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
    const n = r[1].toLowerCase();
    if ((TABLES.has(n) || VIEWS.has(n)) && n !== m[1]) reads.add(n);
  }
  VIEW_READS.set(m[1].toLowerCase(), reads);
}
function baseTablesOf(view, seen = new Set()) {
  const out = new Set();
  for (const r of VIEW_READS.get(view) ?? []) {
    if (TABLES.has(r)) out.add(r);
    else if (VIEWS.has(r) && !seen.has(r)) { seen.add(r); for (const t of baseTablesOf(r, seen)) out.add(t); }
  }
  return out;
}

// ── Files ──────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === 'node_modules' || n === 'dist' || n === 'lib') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js|sql)$/.test(n) && !/\.test\.(ts|js|mjs)$/.test(n)) out.push(p);
  }
  return out;
}
const files = [join(BACKEND, 'src'), join(BACKEND, 'scripts'), join(REPO, 'cloud-functions')]
  .flatMap(d => walk(d))
  .map(p => relative(REPO, p).replace(/\\/g, '/'))
  .filter(f => !f.includes('/db/migrations/') && !f.includes('/db/seeds/_retired/') && !f.startsWith('backend/src/db/functions/') && !NOT_DB_CODE.test(f))
  .sort();

function moduleOf(f) {
  if (f === 'backend/src/db/schema.sql' || f.startsWith('backend/src/db/seeds/')) return 'seed';
  if (f.startsWith('backend/scripts/') || f.startsWith('backend/src/scripts/')) return `backfill:${basename(f).replace(/\.(ts|mjs|js)$/, '')}`;
  if (f.startsWith('cloud-functions/')) return `cloud-function:${f.split('/')[1]}`;
  if (f.endsWith('.sql')) return null; // other .sql files are not writers
  return basename(f).replace(/\.(ts|mjs|js)$/, '');
}

// Blank out comments, keeping every newline and offset, so line numbers and
// match positions stay true to the source.
// A tiny lexer, not a regex: a `/*` or `//` inside a string must not eat
// code (that silently hid real writes in catalogService.ts during the first
// run). Strings and template literals are kept; only comments are blanked.
function maskComments(src, isSql) {
  if (isSql) return src.replace(/--[^\n]*/g, s => ' '.repeat(s.length));
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') out[i++] = ' ';
    } else if (c === '/' && d === '*') {
      out[i++] = ' '; out[i++] = ' ';
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') out[i] = ' '; i++; }
      if (i < n) { out[i++] = ' '; out[i++] = ' '; }
    } else if (c === '\'' || c === '"' || c === '`') {
      i++;
      while (i < n && src[i] !== c) { if (src[i] === '\\') i++; else if (c !== '`' && src[i] === '\n') break; i++; }
      i++;
    } else if (c === '/' && /[=(,:;!&|?{}\[\n]\s*$/.test(src.slice(Math.max(0, i - 20), i))) {
      // regex literal: skip to its closing slash so `//` or quotes inside it are not misread
      i++;
      let inClass = false;
      while (i < n && src[i] !== '\n' && (inClass || src[i] !== '/')) {
        if (src[i] === '\\') i++; else if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false;
        i++;
      }
      i++;
    } else i++;
  }
  return out.join('');
}
const lineAt = (src, idx) => src.slice(0, idx).split('\n').length;

const ID = '(?:public\\.)?("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)';
const WRITE_PATTERNS = [
  ['INSERT', new RegExp(`\\bINSERT\\s+INTO\\s+${ID}`, 'gi')],
  ['UPDATE', new RegExp(`\\bUPDATE\\s+(?:ONLY\\s+)?${ID}\\s+(?:AS\\s+)?(?:[a-z_][a-z0-9_]*\\s+)?SET\\b`, 'gi')],
  ['DELETE', new RegExp(`\\bDELETE\\s+FROM\\s+(?:ONLY\\s+)?${ID}`, 'gi')],
  ['TRUNCATE', new RegExp(`\\bTRUNCATE\\s+(?:TABLE\\s+)?(?:ONLY\\s+)?${ID}`, 'gi')],
  ['COPY', new RegExp(`\\bCOPY\\s+${ID}\\s*(?:\\(|FROM\\b)`, 'gi')],
  ['CREATE AS', new RegExp(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${ID}\\s+AS\\b`, 'gi')],
];
const READ_PATTERN = new RegExp(`\\b(?:FROM|JOIN)\\s+${ID}`, 'gi');
const unq = s => s.replace(/"/g, '').toLowerCase();

const writes = new Map();  // table -> Map(module -> { files: Map(file -> {verbs:Set, lines:Set}) })
const readers = new Map(); // relation -> Map(file -> Set(via_view|''))
const probes = [];
const unusedProbeMarkers = [];
const stemFiles = new Map(); // app module stem -> Set(file) (ambiguity check)

function addWrite(table, mod, file, verb, line) {
  const byMod = writes.get(table) ?? writes.set(table, new Map()).get(table);
  const entry = byMod.get(mod) ?? byMod.set(mod, new Map()).get(mod);
  const fe = entry.get(file) ?? entry.set(file, { verbs: new Set(), lines: new Set() }).get(file);
  fe.verbs.add(verb); fe.lines.add(line);
}
function addReader(rel, file, via) {
  const m = readers.get(rel) ?? readers.set(rel, new Map()).get(rel);
  (m.get(file) ?? m.set(file, new Set()).get(file)).add(via);
}

for (const f of files) {
  const raw = readFileSync(join(REPO, f), 'utf8');
  const isSql = f.endsWith('.sql');
  const src = maskComments(raw, isSql);
  const mod = moduleOf(f);
  const rawLines = raw.split('\n');
  const markerLines = new Set(rawLines.flatMap((l, i) => (l.includes(PROBE_MARKER) ? [i + 1] : [])));
  const usedMarkers = new Set();

  const record = (table, verb, idx) => {
    if (!TABLES.has(table) || !mod) return;
    const line = lineAt(src, idx);
    const marker = markerLines.has(line) ? line : markerLines.has(line - 1) ? line - 1 : null;
    if (marker !== null) { usedMarkers.add(marker); probes.push({ file: f, line, table, verb }); return; }
    if (!mod.startsWith('seed') && !mod.startsWith('backfill:') && !mod.startsWith('cloud-function:')) {
      (stemFiles.get(mod) ?? stemFiles.set(mod, new Set()).get(mod)).add(f);
    }
    addWrite(table, mod, f, verb, line);
  };

  for (const [verb, re] of WRITE_PATTERNS) {
    for (const m of src.matchAll(re)) {
      const t = unq(m[1]);
      if (verb === 'UPDATE' && t === 'set') continue;
      record(t, verb, m.index);
    }
  }
  if (!isSql) {
    for (const [fn, tables] of Object.entries(SQL_WRITE_FUNCTIONS)) {
      for (const m of src.matchAll(new RegExp(`\\b${fn}\\s*\\(`, 'g'))) for (const t of tables) record(t, `CALL ${fn}`, m.index);
    }
  }
  for (const h of TABLE_ARG_HELPERS) {
    if (h.file !== f) continue;
    for (const m of src.matchAll(h.re)) record(m[1], h.verb, m.index);
  }
  for (const l of markerLines) if (!usedMarkers.has(l)) unusedProbeMarkers.push({ file: f, line: l });

  if (!isSql) {
    for (const m of src.matchAll(READ_PATTERN)) {
      const n = unq(m[1]);
      if (TABLES.has(n)) addReader(n, f, '');
      else if (VIEWS.has(n)) { addReader(n, f, ''); for (const t of baseTablesOf(n)) addReader(t, f, n); }
    }
  }
}

// ── Rules ──────────────────────────────────────────────────────────────────
const errors = [];
const warnings = [];
for (const [stem, fs] of stemFiles) {
  if (fs.size > 1) errors.push({ where: [...fs].sort()[0], message: `module '${stem}' is ambiguous: ${[...fs].sort().join(', ')} all write tables; rename one or extend moduleOf()` });
}

const viewReadersOf = t => [...VIEW_READS].filter(([, r]) => r.has(t)).map(([v]) => v).sort();
const tablesOut = {};
const undeclared = [];
const deadDoors = [];
const deadCandidates = [];
for (const table of [...TABLES.keys()].sort()) {
  const field = TABLES.get(table);
  const declared = declaredModules(field);
  const byMod = writes.get(table) ?? new Map();
  const staticMods = [...byMod.keys()].sort();
  const writerList = staticMods.flatMap(m => [...byMod.get(m)].sort(([a], [b]) => a.localeCompare(b)).map(([file, e]) => ({
    module: m, file, verbs: [...e.verbs].sort(), lines: [...e.lines].sort((a, b) => a - b),
  })));
  for (const w of writerList) {
    if (!declared.includes(w.module)) {
      undeclared.push({ table, module: w.module, file: w.file, line: w.lines[0] });
      errors.push({ where: `${w.file}:${w.lines[0]}`, message: `${table}: writer '${w.module}' (${w.verbs.join(', ')}) is not in the declared Writer set [${declared.join(', ') || 'none'}] (comments.sql)` });
    }
  }
  for (const d of declared) {
    if (!staticMods.includes(d) && !d.startsWith('manual:')) {
      deadDoors.push({ table, module: d });
      warnings.push({ where: 'backend/src/db/comments.sql', message: `${table}: declared writer '${d}' has no write in code (dead door)` });
    }
  }
  const rd = readers.get(table) ?? new Map();
  const readerList = [...rd].sort(([a], [b]) => a.localeCompare(b)).flatMap(([file, vias]) =>
    [...vias].sort().map(v => (v ? { file, via_view: v } : { file })));
  const viewReaders = viewReadersOf(table);
  if (readerList.length === 0 && viewReaders.length === 0) {
    deadCandidates.push(table);
    warnings.push({ where: 'backend/src/db/comments.sql', message: `${table}: no reader in code and no view reads it (dead table candidate)` });
  }
  tablesOut[table] = { declared: { field, modules: declared }, writers: writerList, readers: readerList, view_readers: viewReaders };
}
for (const p of unusedProbeMarkers) warnings.push({ where: `${p.file}:${p.line}`, message: 'probe marker with no write statement on this line or the next' });

const out = {
  generated_at: new Date().toISOString(),
  note: 'Generated by backend/scripts/lineage-scan.mjs (npm run lint:lineage). Do not edit.',
  summary: {
    tables: TABLES.size,
    tables_with_writers: [...TABLES.keys()].filter(t => (writes.get(t)?.size ?? 0) > 0).length,
    multi_writer_tables: [...TABLES.keys()].filter(t => [...(writes.get(t)?.keys() ?? [])].filter(m => m !== 'seed' && !m.startsWith('backfill:')).length > 1).sort(),
    undeclared_writers: undeclared.length,
    dead_doors: deadDoors.length,
    dead_candidates: deadCandidates.length,
    probes: probes.length,
  },
  tables: tablesOut,
  probes: probes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
  findings: { undeclared, dead_doors: deadDoors, dead_candidates: deadCandidates, unused_probe_markers: unusedProbeMarkers },
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');

if (SHOW_WARNINGS) for (const w of warnings) console.log(`${w.where}  warning: ${w.message}`);
if (errors.length) {
  console.error(`lint:lineage — ${errors.length} violation(s):\n`);
  for (const e of errors) console.error(`  ${e.where}  ${e.message}`);
  process.exit(1);
}
