// Offline recalibration: re-reads a v_subscriber_quiz_results CSV export through interpret() and writes a
// calibration fixture (same shape as src/fixtures/quiz_calibration/hoboken-crawl-2026.calibration.json)
// with `expected_v2_1` plus a diff against `stored_v1`. NO DATABASE, NO NETWORK: it reads one file and
// writes one file.
//
//   npx tsx scripts/quizRecalibrate.ts <export.csv> [out.json] [calibration-set-name]
//
// Needs the export's quiz_result_json column (the saved quiz_session.context_data) and primary_archetype.
// Rows with no quiz session are skipped and listed. Answer ids are resolved with the v7 map, so a row
// from another quiz version is reported as skipped (extend fixtures/quiz_calibration/ for a v8 export).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { interpret, INTERPRETATION_VERSION } from '../src/services/quizScoring.js';
import { rebuildV7Scoring } from '../src/fixtures/quiz_calibration/v7AnswerMap.js';

// RFC 4180 parser: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const [csvPath, outArg, setName = 'recalibration'] = process.argv.slice(2);
if (!csvPath) {
  console.error('usage: npx tsx scripts/quizRecalibrate.ts <export.csv> [out.json] [calibration-set-name]');
  process.exit(1);
}

const rows = parseCsv(readFileSync(resolve(csvPath), 'utf8').replace(/^﻿/, ''));
const header = rows[0];
const col = (name: string) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`Column "${name}" not found in ${csvPath}`);
  return i;
};
const iCtx = col('quiz_result_json');
const iPrimary = col('primary_archetype');
const iEmail = header.indexOf('email');
const iCompleted = header.indexOf('quiz_completed_at');

const cases: unknown[] = [];
const skipped: { row: number; reason: string }[] = [];
let changed = 0;

rows.slice(1).forEach((r, idx) => {
  const rowNo = idx + 2;
  const raw = r[iCtx];
  if (!raw) { skipped.push({ row: rowNo, reason: 'no quiz session' }); return; }
  let ctx: any;
  try { ctx = JSON.parse(raw); } catch { skipped.push({ row: rowNo, reason: 'quiz_result_json is not JSON' }); return; }
  if (!Array.isArray(ctx.answerIds) || !ctx.answerIds.length) {
    skipped.push({ row: rowNo, reason: 'no answerIds in context_data' }); return;
  }
  let rebuilt;
  try { rebuilt = rebuildV7Scoring(ctx.answerIds); } catch (e) {
    skipped.push({ row: rowNo, reason: (e as Error).message }); return;
  }
  const finalArchetype = r[iPrimary] || ctx.archetype;
  const branchedFrom: string | null = ctx.branchedFrom ?? null;
  const out = interpret({ ...rebuilt, finalArchetype, branchedFrom });

  const stored_v1 = {
    secondaryArchetype: ctx.secondaryArchetype ?? null,
    recommendationMode: ctx.recommendationMode ?? null,
    foodSignalAlignment: ctx.foodSignalAlignment ?? null,
  };
  const expected_v2_1 = {
    secondaryArchetype: out.secondaryArchetype,
    recommendationMode: out.recommendationMode,
    pairConfidence: out.pairConfidence,
    exploreArchetype: out.exploreArchetype,
    primaryMargin: out.primaryMargin,
  };
  const diff: Record<string, { v1: unknown; v2_1: unknown }> = {};
  if (stored_v1.secondaryArchetype !== out.secondaryArchetype) {
    diff.secondaryArchetype = { v1: stored_v1.secondaryArchetype, v2_1: out.secondaryArchetype };
  }
  if (stored_v1.recommendationMode !== out.recommendationMode) {
    diff.recommendationMode = { v1: stored_v1.recommendationMode, v2_1: out.recommendationMode };
  }
  if (stored_v1.foodSignalAlignment !== out.pairConfidence) {
    diff.confidence = { v1: stored_v1.foodSignalAlignment, v2_1: out.pairConfidence };
  }
  if (Object.keys(diff).length) changed++;

  cases.push({
    case_id: `${setName}-${String(cases.length + 1).padStart(2, '0')}`,
    // email is for cross-referencing the export only; strip it before committing a fixture.
    source_row: { row: rowNo, email: iEmail >= 0 ? r[iEmail] : undefined, quiz_completed_at: iCompleted >= 0 ? r[iCompleted] : undefined },
    input: {
      answerIds: ctx.answerIds,
      scores: ctx.scores ?? rebuilt.scores,
      archetype: finalArchetype,
      foodSignal: rebuilt.foodSignal,
      experimental: rebuilt.experimental,
      branchedFrom,
    },
    stored_v1,
    expected_v2_1,
    explore_reason: out.exploreReason,
    diff,
  });
});

const outPath = resolve(outArg ?? `tmp/${setName}.calibration.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({
  calibration_set: setName,
  interpretation_version: INTERPRETATION_VERSION,
  quiz_version: 'v7',
  generated: new Date().toISOString().slice(0, 10),
  source: `${csvPath} (offline recalibration; review row by row before promoting to a fixture)`,
  cases,
}, null, 2) + '\n');

console.log(`${cases.length} cases -> ${outPath}; ${changed} differ from stored v1; ${skipped.length} skipped`);
for (const s of skipped) console.log(`  skipped row ${s.row}: ${s.reason}`);
