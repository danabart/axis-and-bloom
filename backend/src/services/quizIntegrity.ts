import { db } from '../db/client.js';

// ── Quiz content drift prevention — integrity check service ──────────────────
// Codifies the manual EXPECTs in
// backend/src/features/quizes/quiz_v7_content_audit.sql into automated
// pass/fail assertions. Read-only — this service never writes or repairs
// anything; drift is the re-asserting seed's job (see schema.sql's V7 block).
// The one exception it cannot self-heal (check #0) is a deliberate human
// decision, not a bug: an active-quiz answer whose copy was hand-edited in
// prod so it no longer matches any code in the seed file. Flagging it by name
// here is the whole point — guessing by position would be worse than leaving
// it broken (answer ordering is `ORDER BY a.id` on UUIDs and means nothing).

export interface QuizIntegrityCheck {
  id: number;
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
  details?: string[];
}

export interface QuizIntegrityReport {
  ranAt: string;
  allPass: boolean;
  checks: QuizIntegrityCheck[];
}

export async function runQuizIntegrityChecks(): Promise<QuizIntegrityReport> {
  const checks: QuizIntegrityCheck[] = [];

  // ── 1. Exactly one active main quiz, and it should be v7 ───────────────────
  // (Numbered to match the audit SQL's own block 1, but reported as check id 1
  // — see check 0 below, which the audit SQL doesn't have a standalone block
  // for at all; it's this file's own addition per the spec.)
  const activeMainResult = await db.query<{ id: string; version: string }>(
    `SELECT id, version FROM quiz WHERE is_active = true AND parent_quiz_id IS NULL`
  );
  const activeMainRows = activeMainResult.rows;
  const activeMainId = activeMainRows[0]?.id ?? null;
  const check1Pass = activeMainRows.length === 1 && activeMainRows[0]?.version === 'v7';
  checks.push({
    id: 1,
    name: 'Exactly one active main quiz, version v7',
    pass: check1Pass,
    expected: '1 row, version = v7',
    actual: activeMainRows.length === 0
      ? 'no active main quiz'
      : `${activeMainRows.length} active main quiz row(s): ${activeMainRows.map(r => r.version).join(', ')}`,
  });

  // ── 0. Every answer on the active quiz + its branches has answer_code ─────
  // Depends on check 1 having found the active quiz — if it didn't, this
  // check has nothing to evaluate and is reported as an inconclusive fail
  // rather than silently passing on zero rows.
  let check0Pass = false;
  let check0Details: string[] = [];
  if (activeMainId) {
    const uncoded = await db.query<{ answer_text: string }>(
      `SELECT a.answer_text
       FROM quiz_answer a
       JOIN quiz_question qq ON qq.id = a.question_id
       JOIN quiz q           ON q.id  = qq.quiz_id
       WHERE (q.id = $1 OR q.parent_quiz_id = $1)
         AND a.answer_code IS NULL
       ORDER BY a.answer_text`,
      [activeMainId]
    );
    check0Details = uncoded.rows.map(r => r.answer_text);
    check0Pass = check0Details.length === 0;
  }
  checks.push({
    id: 0,
    name: 'Every answer on the active quiz + its branches has answer_code',
    pass: check0Pass,
    expected: 'zero un-coded answers',
    actual: !activeMainId
      ? 'no active quiz to check against (see check 1)'
      : `${check0Details.length} un-coded answer(s)`,
    details: check0Details.length ? check0Details : undefined,
  });

  // ── 2. Branch rows — present, active, non-null trigger, parented to v7 ────
  const branchResult = await db.query<{
    version: string; is_active: boolean; trigger_archetype_id: string | null; parent_quiz_id: string | null;
  }>(
    `SELECT version, is_active, trigger_archetype_id, parent_quiz_id
     FROM quiz WHERE version IN ('v7-branch-floral', 'v7-branch-earthy')`
  );
  const branchRows = branchResult.rows;
  const branchDetails: string[] = [];
  const expectedBranchVersions = ['v7-branch-floral', 'v7-branch-earthy'];
  for (const v of expectedBranchVersions) {
    const row = branchRows.find(r => r.version === v);
    if (!row) { branchDetails.push(`${v}: missing entirely`); continue; }
    if (!row.is_active) branchDetails.push(`${v}: is_active is false (expected true)`);
    if (!row.trigger_archetype_id) branchDetails.push(`${v}: trigger_archetype_id is null`);
    if (!activeMainId || row.parent_quiz_id !== activeMainId) branchDetails.push(`${v}: parent_quiz_id does not match the active v7 quiz`);
  }
  checks.push({
    id: 2,
    name: 'Both branch quizzes present, active, triggered, parented to v7',
    pass: branchDetails.length === 0,
    expected: 'v7-branch-floral and v7-branch-earthy: is_active=true, trigger_archetype_id set, parent_quiz_id = v7',
    actual: branchDetails.length === 0 ? 'both branches correct' : `${branchDetails.length} problem(s)`,
    details: branchDetails.length ? branchDetails : undefined,
  });

  // ── 3. Questions + weights on the active quiz ──────────────────────────────
  const EXPECTED_WEIGHTS: Record<number, number> = { 1: 1, 2: 2, 3: 1, 4: 2, 5: 3, 6: 0 };
  let check3Details: string[] = [];
  if (activeMainId) {
    const qResult = await db.query<{ q_number: number; weight: string }>(
      `SELECT qq.q_number, qq.weight FROM quiz_question qq WHERE qq.quiz_id = $1 ORDER BY qq.q_number`,
      [activeMainId]
    );
    const rows = qResult.rows;
    if (rows.length !== 6) check3Details.push(`expected 6 questions, found ${rows.length}`);
    for (const [qNumStr, expectedWeight] of Object.entries(EXPECTED_WEIGHTS)) {
      const qNum = Number(qNumStr);
      const row = rows.find(r => Number(r.q_number) === qNum);
      if (!row) { check3Details.push(`Q${qNum}: missing`); continue; }
      if (Number(row.weight) !== expectedWeight) check3Details.push(`Q${qNum}: weight ${row.weight} (expected ${expectedWeight})`);
    }
  } else {
    check3Details.push('no active quiz to check against (see check 1)');
  }
  checks.push({
    id: 3,
    name: '6 questions, weights exactly 1/2/1/2/3/0',
    pass: check3Details.length === 0,
    expected: 'Q1=1, Q2=2, Q3=1, Q4=2, Q5=3, Q6=0',
    actual: check3Details.length === 0 ? 'weights match' : `${check3Details.length} problem(s)`,
    details: check3Details.length ? check3Details : undefined,
  });

  // ── 4. Score rows — every Q1–Q5 answer has exactly one score row (score>0);
  // Q6 answers have none. ──────────────────────────────────────────────────
  let check4Details: string[] = [];
  if (activeMainId) {
    const scoreResult = await db.query<{ q_number: number; answer_text: string; score_count: number; total_score: string | null }>(
      `SELECT qq.q_number, a.answer_text,
              COUNT(aas.id)::int AS score_count,
              SUM(aas.score)::numeric AS total_score
       FROM quiz_question qq
       JOIN quiz_answer a ON a.question_id = qq.id
       LEFT JOIN quiz_answer_archetype_score aas ON aas.answer_id = a.id
       WHERE qq.quiz_id = $1
       GROUP BY qq.q_number, a.id, a.answer_text`,
      [activeMainId]
    );
    for (const row of scoreResult.rows) {
      const qNum = Number(row.q_number);
      if (qNum >= 1 && qNum <= 5) {
        if (row.score_count !== 1) check4Details.push(`Q${qNum} "${row.answer_text}": ${row.score_count} score row(s) (expected exactly 1)`);
        else if (!(Number(row.total_score) > 0)) check4Details.push(`Q${qNum} "${row.answer_text}": score is not > 0`);
      } else if (qNum === 6) {
        if (row.score_count !== 0) check4Details.push(`Q6 "${row.answer_text}": has ${row.score_count} score row(s) (expected 0 — food signal, not scored)`);
      }
    }
  } else {
    check4Details.push('no active quiz to check against (see check 1)');
  }
  checks.push({
    id: 4,
    name: 'Q1–Q5 answers each have exactly one score row (>0); Q6 answers have none',
    pass: check4Details.length === 0,
    expected: 'Q1=1pt, Q2=2pt, Q3=1pt, Q4=2pt, Q5=3pt per answer; Q6 unscored',
    actual: check4Details.length === 0 ? 'all score rows correct' : `${check4Details.length} problem(s)`,
    details: check4Details.length ? check4Details : undefined,
  });

  // ── 5. Experimental gate — exactly one flagged answer, on Q3 ──────────────
  let check5Details: string[] = [];
  if (activeMainId) {
    const gateResult = await db.query<{ q_number: number; answer_text: string }>(
      `SELECT qq.q_number, a.answer_text
       FROM quiz_answer a
       JOIN quiz_question qq ON qq.id = a.question_id
       WHERE qq.quiz_id = $1 AND a.is_experimental_gate = TRUE`,
      [activeMainId]
    );
    const rows = gateResult.rows;
    if (rows.length !== 1) check5Details.push(`${rows.length} flagged answer(s) (expected exactly 1)`);
    else if (Number(rows[0].q_number) !== 3) check5Details.push(`flagged answer is on Q${rows[0].q_number} (expected Q3)`);
  } else {
    check5Details.push('no active quiz to check against (see check 1)');
  }
  checks.push({
    id: 5,
    name: 'Exactly one experimental-gate answer, on Q3',
    pass: check5Details.length === 0,
    expected: '1 row — Q3’s "Interesting… what flavors am I getting here?"',
    actual: check5Details.length === 0 ? 'gate correct' : `${check5Details.length} problem(s)`,
    details: check5Details.length ? check5Details : undefined,
  });

  // ── 6. Q6 food-signal answers — 3 rows, each with a non-null archetype ────
  let check6Details: string[] = [];
  if (activeMainId) {
    const foodResult = await db.query<{ answer_text: string; archetype_name: string | null }>(
      `SELECT a.answer_text, ar.name AS archetype_name
       FROM quiz_answer a
       JOIN quiz_question qq ON qq.id = a.question_id
       LEFT JOIN archetype ar ON ar.id = a.resulting_archetype_id
       WHERE qq.quiz_id = $1 AND qq.q_number = 6`,
      [activeMainId]
    );
    const rows = foodResult.rows;
    if (rows.length !== 3) check6Details.push(`${rows.length} Q6 answer(s) (expected exactly 3)`);
    for (const row of rows) {
      if (!row.archetype_name) check6Details.push(`"${row.answer_text}": null resulting archetype`);
    }
  } else {
    check6Details.push('no active quiz to check against (see check 1)');
  }
  checks.push({
    id: 6,
    name: "Q6's 3 answers each map to a non-null archetype",
    pass: check6Details.length === 0,
    expected: '3 rows, each with a non-null food-signal archetype',
    actual: check6Details.length === 0 ? 'food signals correct' : `${check6Details.length} problem(s)`,
    details: check6Details.length ? check6Details : undefined,
  });

  // ── 7. Branch outcomes — 4 branch answers, every resulting_archetype_id
  // non-null ─────────────────────────────────────────────────────────────
  const branchAnswerResult = await db.query<{ branch_version: string; answer_text: string; archetype_name: string | null }>(
    `SELECT bq.version AS branch_version, a.answer_text, ar.name AS archetype_name
     FROM quiz bq
     JOIN quiz_question qq ON qq.quiz_id = bq.id
     JOIN quiz_answer a    ON a.question_id = qq.id
     LEFT JOIN archetype ar ON ar.id = a.resulting_archetype_id
     WHERE bq.parent_quiz_id IS NOT NULL`
  );
  const branchAnswerRows = branchAnswerResult.rows;
  const check7Details: string[] = [];
  if (branchAnswerRows.length !== 4) check7Details.push(`${branchAnswerRows.length} branch answer(s) total (expected exactly 4)`);
  for (const row of branchAnswerRows) {
    if (!row.archetype_name) check7Details.push(`${row.branch_version} "${row.answer_text}": null resulting archetype`);
  }
  checks.push({
    id: 7,
    name: '4 branch answers, every resulting_archetype_id non-null',
    pass: check7Details.length === 0,
    expected: '4 rows total (2 per branch quiz), all non-null',
    actual: check7Details.length === 0 ? 'branch outcomes correct' : `${check7Details.length} problem(s)`,
    details: check7Details.length ? check7Details : undefined,
  });

  // ── 8. Archetype names — Floral and Earthy exist, spelled exactly so.
  // Existence check ONLY — the Experimental archetype row is intentional
  // (treated archetype-like elsewhere in the product even though it is never
  // a quiz outcome) and must never be flagged or asserted away here. ───────
  const archetypeResult = await db.query<{ name: string }>(`SELECT name FROM archetype`);
  const archetypeNames = new Set(archetypeResult.rows.map(r => r.name));
  const check8Details: string[] = [];
  for (const required of ['Floral', 'Earthy']) {
    if (!archetypeNames.has(required)) check8Details.push(`"${required}" not found in archetype table`);
  }
  checks.push({
    id: 8,
    name: "Floral and Earthy archetype names exist exactly as spelled",
    pass: check8Details.length === 0,
    expected: '"Floral" and "Earthy" present (existence only — not an exclusivity check; Experimental is intentional and never flagged)',
    actual: check8Details.length === 0 ? 'both present' : `${check8Details.length} missing`,
    details: check8Details.length ? check8Details : undefined,
  });

  const allPass = checks.every(c => c.pass);
  return {
    ranAt: new Date().toISOString(),
    allPass,
    checks: checks.sort((a, b) => a.id - b.id),
  };
}
