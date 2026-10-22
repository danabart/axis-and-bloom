#!/usr/bin/env node
// Cupping evidence, brief 1 (2026-10-18), C1 — no external deps, grep-style
// checks over backend/src/**/*.ts, cloned from lint-roastery-portal.mjs (file
// walk, comment blanking, `file:line  message`, exit 1). Run via
// `npm run lint:cupping`; also run by .github/workflows/deploy.yml before the
// backend build, beside lint:catalog / lint:retention / lint:customer /
// lint:roastery-portal / lint:lineage.
// See backend/src/features/cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_1_FOUNDATION.md, C1.
//
// Rule 1: INSERT / UPDATE / DELETE / TRUNCATE on a cupping evidence table
//         (cupping_sessions, cupping_session_coffees, cupping_brew_params,
//         cupping_scores, cupping_score_values, cupping_score_descriptors)
//         outside services/cuppingService.ts fails. The reference tables are
//         seed-only (schema.sql, not scanned), except cupper, whose admin door
//         is cuppingService.addCupper; DML on them anywhere else fails too.
// Rule 2: FROM / JOIN on any of those tables outside cuppingService.ts and
//         cuppingReads.ts fails: everyone else reads cupping evidence through
//         cuppingReads (over the views).
// Rule 3: recordCuppingSignal( is called only from cuppingService.ts (its
//         definition in dialSuggestion.ts is allowed); refreshDialSignal( is
//         called only from cuppingService.ts, catalogService.ts and the brief 2
//         loader (features/cupping_evidence/load/).
// Rule 4 (cupping evidence brief 3, 2026-10-18): FROM / JOIN v_evidence_* (the
//         reconciliation views) only in services/evidenceReads.ts.
// Brief 6 (2026-10-21): evidence_parameter is written by
//         services/evidenceParameterService.ts (rule 1) and read there and in
//         services/evidenceReads.ts (rule 2); every other reference table
//         stays seed-only.
// Tests (*.test.ts) and db/migrations are exempt; schema.sql and the .sql
// seeds are not scanned.

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
// stay right) so prose mentioning a table or a function never trips a check.
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

const SERVICE = 'services/cuppingService.ts';
const READS = 'services/cuppingReads.ts';
const EVIDENCE_TABLES = [
  'cupping_sessions', 'cupping_session_coffees', 'cupping_brew_params',
  'cupping_scores', 'cupping_score_values', 'cupping_score_descriptors',
];
const REFERENCE_TABLES = [
  'cupper', 'cupping_scale', 'cupping_scale_step', 'cupping_sheet_format', 'cupping_sheet_line',
  'evidence_parameter', 'evidence_stop_word', 'cupper_calibration_offset',
];
// Who may write each table; null = nobody in TS (seed only).
// Brief 6 (2026-10-21): evidence_parameter's admin door is
// evidenceParameterService.setParameter (a new row superseding the current
// one); evidenceReads.getParameters reads it for the admin card.
const PARAMETER_SERVICE = 'services/evidenceParameterService.ts';
const WRITERS = Object.fromEntries([
  ...EVIDENCE_TABLES.map(t => [t, SERVICE]),
  ...REFERENCE_TABLES.map(t => [t, t === 'cupper' ? SERVICE : t === 'evidence_parameter' ? PARAMETER_SERVICE : null]),
]);
const TABLES = [...EVIDENCE_TABLES, ...REFERENCE_TABLES].sort((a, b) => b.length - a.length).join('|');

const RULE1 = new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?)\\s+(?:ONLY\\s+)?"?(${TABLES})(?![a-z0-9_])`, 'gi');
const RULE2 = new RegExp(`\\b(FROM|JOIN)\\s+"?(${TABLES})(?![a-z0-9_])`, 'gi');
const RULE2_ALLOWED = new Set([SERVICE, READS]);
const RULE2_ALLOWED_FOR = { evidence_parameter: new Set([PARAMETER_SERVICE, 'services/evidenceReads.ts']) };

const RECORD_SIGNAL = /\brecordCuppingSignal\s*\(/g;
const RECORD_SIGNAL_ALLOWED = new Set([SERVICE]);
const RECORD_SIGNAL_DEFINITION = 'services/dialSuggestion.ts';
const REFRESH_SIGNAL = /\brefreshDialSignal\s*\(/g;
const REFRESH_SIGNAL_ALLOWED = (relPath) =>
  relPath === SERVICE || relPath === 'services/catalogService.ts' || relPath.startsWith('features/cupping_evidence/load/');

const EVIDENCE_VIEW = /\b(FROM|JOIN)\s+"?(v_evidence_[a-z_]+)/gi;
const EVIDENCE_READS = 'services/evidenceReads.ts';

const violations = [];
for (const relPath of walk(SRC_ROOT, [])) {
  const text = stripComments(readFileSync(path.join(SRC_ROOT, relPath), 'utf8'));
  let m;

  RULE1.lastIndex = 0;
  while ((m = RULE1.exec(text))) {
    const table = m[2].toLowerCase();
    const writer = WRITERS[table];
    if (relPath !== writer) {
      violations.push({ file: relPath, line: lineNumberAt(text, m.index),
        message: `${m[1].toUpperCase().replace(/\s+/g, ' ')} on '${table}' outside ${writer ?? 'schema.sql (seed-only reference table)'}` });
    }
  }

  if (!RULE2_ALLOWED.has(relPath)) {
    RULE2.lastIndex = 0;
    while ((m = RULE2.exec(text))) {
      if (RULE2_ALLOWED_FOR[m[2].toLowerCase()]?.has(relPath)) continue;
      violations.push({ file: relPath, line: lineNumberAt(text, m.index),
        message: `${m[1].toUpperCase()} '${m[2].toLowerCase()}' outside cuppingService.ts / cuppingReads.ts: read cupping evidence through cuppingReads (views)` });
    }
  }

  RECORD_SIGNAL.lastIndex = 0;
  while ((m = RECORD_SIGNAL.exec(text))) {
    if (RECORD_SIGNAL_ALLOWED.has(relPath)) continue;
    if (relPath === RECORD_SIGNAL_DEFINITION && /function\s+$/.test(text.slice(Math.max(0, m.index - 20), m.index))) continue;
    violations.push({ file: relPath, line: lineNumberAt(text, m.index),
      message: 'recordCuppingSignal( outside cuppingService.ts: call cuppingService.refreshDialSignal instead' });
  }

  if (relPath !== EVIDENCE_READS) {
    EVIDENCE_VIEW.lastIndex = 0;
    while ((m = EVIDENCE_VIEW.exec(text))) {
      violations.push({ file: relPath, line: lineNumberAt(text, m.index),
        message: `${m[1].toUpperCase()} '${m[2].toLowerCase()}' outside evidenceReads.ts: read the reconciliation views through evidenceReads` });
    }
  }

  REFRESH_SIGNAL.lastIndex = 0;
  while ((m = REFRESH_SIGNAL.exec(text))) {
    if (REFRESH_SIGNAL_ALLOWED(relPath)) continue;
    violations.push({ file: relPath, line: lineNumberAt(text, m.index),
      message: 'refreshDialSignal( outside cuppingService.ts, catalogService.ts and the cupping evidence loader' });
  }
}

if (violations.length) {
  console.error(`lint:cupping — ${violations.length} violation(s):\n`);
  for (const v of violations) console.error(`  backend/src/${v.file}:${v.line}  ${v.message}`);
  process.exit(1);
}
console.log('lint:cupping — clean');
