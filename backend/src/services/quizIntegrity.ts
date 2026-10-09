import { db } from '../db/client.js';
import { toArchetypeSlug } from '../features/marketing/mailchimp.js';

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
//
// Quiz content is SCD Type 2 since Prompt 4A (2026-10-08): retired versions
// stay in quiz_question/quiz_answer forever, so every content check below
// reads current rows only (is_current). Checks 12–17 guard the versioning
// itself. Stray score rows are reported here (checks 4 and 7) and never
// removed — the seed's old self-healing DELETEs are gone.

export interface QuizIntegrityCheck {
  id: number;
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
  details?: string[];
}

// Prompt 4A, Part A: taken once at the first boot with SCD2 (schema.sql).
const QUIZ_SNAPSHOT_TABLES = [
  { snapshot: 'quiz_backup_20261008_quiz', source: 'quiz' },
  { snapshot: 'quiz_backup_20261008_quiz_question', source: 'quiz_question' },
  { snapshot: 'quiz_backup_20261008_quiz_answer', source: 'quiz_answer' },
  { snapshot: 'quiz_backup_20261008_quiz_answer_archetype_score', source: 'quiz_answer_archetype_score' },
] as const;

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
         AND qq.is_current AND a.is_current
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
     FROM quiz WHERE version IN ('v7-branch-floral', 'v7-branch-earthy', 'v7-branch-balanced')`
  );
  const branchRows = branchResult.rows;
  const branchDetails: string[] = [];
  // v7-branch-balanced added by Prompt 4B (2026-10-09).
  const expectedBranchVersions = ['v7-branch-floral', 'v7-branch-earthy', 'v7-branch-balanced'];
  for (const v of expectedBranchVersions) {
    const row = branchRows.find(r => r.version === v);
    if (!row) { branchDetails.push(`${v}: missing entirely`); continue; }
    if (!row.is_active) branchDetails.push(`${v}: is_active is false (expected true)`);
    if (!row.trigger_archetype_id) branchDetails.push(`${v}: trigger_archetype_id is null`);
    if (!activeMainId || row.parent_quiz_id !== activeMainId) branchDetails.push(`${v}: parent_quiz_id does not match the active v7 quiz`);
  }
  checks.push({
    id: 2,
    name: 'All three branch quizzes present, active, triggered, parented to v7',
    pass: branchDetails.length === 0,
    expected: 'v7-branch-floral, v7-branch-earthy and v7-branch-balanced: is_active=true, trigger_archetype_id set, parent_quiz_id = v7',
    actual: branchDetails.length === 0 ? 'all three branches correct' : `${branchDetails.length} problem(s)`,
    details: branchDetails.length ? branchDetails : undefined,
  });

  // ── 3. Questions + weights on the active quiz ──────────────────────────────
  const EXPECTED_WEIGHTS: Record<number, number> = { 1: 1, 2: 2, 3: 1, 4: 2, 5: 3, 6: 0 };
  let check3Details: string[] = [];
  if (activeMainId) {
    const qResult = await db.query<{ q_number: number; weight: string }>(
      `SELECT qq.q_number, qq.weight FROM quiz_question qq WHERE qq.quiz_id = $1 AND qq.is_current ORDER BY qq.q_number`,
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
       JOIN quiz_answer a ON a.question_id = qq.id AND a.is_current
       LEFT JOIN quiz_answer_archetype_score aas ON aas.answer_id = a.id
       WHERE qq.quiz_id = $1 AND qq.is_current
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
       WHERE qq.quiz_id = $1 AND qq.is_current AND a.is_current AND a.is_experimental_gate = TRUE`,
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
       LEFT JOIN coffee_archetype ar ON ar.id = a.resulting_archetype_id
       WHERE qq.quiz_id = $1 AND qq.q_number = 6 AND qq.is_current AND a.is_current`,
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

  // ── 7. Branch outcomes — 7 current branch answers (2 + 2 + 3 since Prompt 4B), every resulting_archetype_id
  // non-null, and no branch answer carries a score row (Prompt 4A: this
  // replaces the seed's old DELETE — a stray is reported, not removed) ─────
  const branchAnswerResult = await db.query<{ branch_version: string; answer_text: string; archetype_name: string | null; score_count: number }>(
    `SELECT bq.version AS branch_version, a.answer_text, ar.name AS archetype_name,
            (SELECT COUNT(*)::int FROM quiz_answer_archetype_score aas WHERE aas.answer_id = a.id) AS score_count
     FROM quiz bq
     JOIN quiz_question qq ON qq.quiz_id = bq.id AND qq.is_current
     JOIN quiz_answer a    ON a.question_id = qq.id AND a.is_current
     LEFT JOIN coffee_archetype ar ON ar.id = a.resulting_archetype_id
     WHERE bq.parent_quiz_id IS NOT NULL`
  );
  const branchAnswerRows = branchAnswerResult.rows;
  const check7Details: string[] = [];
  if (branchAnswerRows.length !== 7) check7Details.push(`${branchAnswerRows.length} branch answer(s) total (expected exactly 7)`);
  for (const row of branchAnswerRows) {
    if (!row.archetype_name) check7Details.push(`${row.branch_version} "${row.answer_text}": null resulting archetype`);
    if (row.score_count !== 0) check7Details.push(`${row.branch_version} "${row.answer_text}": has ${row.score_count} score row(s) (expected 0 — branch answers are not scored)`);
  }
  checks.push({
    id: 7,
    name: '7 branch answers, every resulting_archetype_id non-null, none scored',
    pass: check7Details.length === 0,
    expected: '7 current rows (floral 2, earthy 2, balanced 3), all non-null, zero score rows',
    actual: check7Details.length === 0 ? 'branch outcomes correct' : `${check7Details.length} problem(s)`,
    details: check7Details.length ? check7Details : undefined,
  });

  // ── 8. Archetype names — Floral and Earthy exist, spelled exactly so.
  // Existence check ONLY — the Experimental archetype row is intentional
  // (treated archetype-like elsewhere in the product even though it is never
  // a quiz outcome) and must never be flagged or asserted away here. ───────
  const archetypeResult = await db.query<{ name: string }>(`SELECT name FROM coffee_archetype`);
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

  // ── 9. Quiz-complete emails since Part B2 have archetype + resend id,
  // slug-matching the subscriber row ──────────────────────────────────────
  // Quiz Resync Fix Part E1 (2026-09-25). B2_DEPLOY_AT marks when
  // transactional_email_log.archetype/resend_message_id started being
  // populated — rows sent before this deploy legitimately have both NULL
  // and are not this check's concern. A subscriber archetype mismatch here
  // can also be a legitimate later retake (the subscriber row moved on since
  // the email went out), not necessarily a bug — surfaced for review either
  // way, warn-not-fail like every other check in this file.
  const B2_DEPLOY_AT = '2026-09-25T00:00:00Z';
  const emailLogResult = await db.query<{
    email: string; archetype: string | null; resend_message_id: string | null; subscriber_archetype: string | null;
  }>(
    `SELECT tel.email, tel.archetype, tel.resend_message_id, ns.archetype AS subscriber_archetype
     FROM transactional_email_log tel
     LEFT JOIN newsletter_subscriber ns ON ns.email = tel.email
     WHERE tel.template = 'quiz_complete_v2' AND tel.sent_at >= $1`,
    [B2_DEPLOY_AT],
  );
  const check9Details: string[] = [];
  for (const row of emailLogResult.rows) {
    if (!row.archetype) { check9Details.push(`${row.email}: archetype is null`); continue; }
    if (!row.resend_message_id) check9Details.push(`${row.email}: resend_message_id is null`);
    if (row.subscriber_archetype && toArchetypeSlug(row.archetype) !== toArchetypeSlug(row.subscriber_archetype)) {
      check9Details.push(`${row.email}: email archetype "${row.archetype}" does not slug-match subscriber archetype "${row.subscriber_archetype}" (may be a later retake, not necessarily a bug)`);
    }
  }
  checks.push({
    id: 9,
    name: `Quiz-complete emails sent since ${B2_DEPLOY_AT} have a non-null archetype + resend id, slug-matching the subscriber row`,
    pass: check9Details.length === 0,
    expected: 'non-null archetype/resend_message_id on every row; slug-matches newsletter_subscriber.archetype where a subscriber row exists',
    actual: check9Details.length === 0 ? 'all correct' : `${check9Details.length} problem(s)`,
    details: check9Details.length ? check9Details : undefined,
  });

  // ── 10. No newsletter_subscriber (with a linked quiz_session) disagrees
  // with their own latest scored archetype ──────────────────────────────
  const subscriberVsSessionResult = await db.query<{
    email: string; subscriber_archetype: string; latest_session_archetype: string;
  }>(
    `SELECT ns.email, ns.archetype AS subscriber_archetype, ca.name AS latest_session_archetype
     FROM newsletter_subscriber ns
     JOIN user_profile up ON up.id = ns.user_id
     JOIN LATERAL (
       SELECT resulting_archetype_id FROM quiz_session
       WHERE user_id = up.id AND resulting_archetype_id IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1
     ) latest ON true
     JOIN coffee_archetype ca ON ca.id = latest.resulting_archetype_id
     WHERE ns.archetype IS NOT NULL`,
  );
  const check10Details: string[] = [];
  for (const row of subscriberVsSessionResult.rows) {
    if (toArchetypeSlug(row.subscriber_archetype) !== toArchetypeSlug(row.latest_session_archetype)) {
      check10Details.push(`${row.email}: subscriber archetype "${row.subscriber_archetype}" != latest quiz_session archetype "${row.latest_session_archetype}"`);
    }
  }
  checks.push({
    id: 10,
    name: 'No newsletter_subscriber (with a linked quiz_session) disagrees with their latest scored archetype',
    pass: check10Details.length === 0,
    expected: 'subscriber.archetype slug-matches the linked user\'s latest quiz_session archetype',
    actual: check10Details.length === 0 ? 'all correct' : `${check10Details.length} mismatch(es)`,
    details: check10Details.length ? check10Details : undefined,
  });

  // ── 11. No post_quiz subscribe in the last 24h referenced a session key
  // without a matching quiz_complete/quiz_final row ──────────────────────
  // Quiz Resync Fix Part E1 — this is the resync-bug signature itself
  // (Part B1 now rejects these server-side; this check confirms that
  // rejection is actually holding, and flags it visibly if a stale client
  // bundle or a new caller ever reproduces the old shape).
  const recentPostQuizResult = await db.query<{
    occurred_at: string; quiz_session_key: string | null; archetype: string | null;
  }>(
    `SELECT occurred_at, request_body->>'quizSessionKey' AS quiz_session_key, request_body->>'archetype' AS archetype
     FROM api_event
     WHERE path IN ('/api/newsletter/subscribe', '/api/newsletter')
       AND request_body->>'source' = 'post_quiz'
       AND request_body->>'archetype' IS NOT NULL
       AND occurred_at >= now() - interval '24 hours'`,
  );
  const check11Details: string[] = [];
  for (const row of recentPostQuizResult.rows) {
    if (!row.quiz_session_key) {
      check11Details.push(`${row.occurred_at}: post_quiz subscribe with archetype "${row.archetype}" but no quizSessionKey at all`);
      continue;
    }
    const funnelResult = await db.query<{ archetype: string | null }>(
      `SELECT archetype FROM quiz_funnel_event WHERE session_key = $1 AND event IN ('quiz_complete', 'quiz_final') AND archetype IS NOT NULL`,
      [row.quiz_session_key],
    );
    const backed = funnelResult.rows.some(r => r.archetype && toArchetypeSlug(r.archetype) === toArchetypeSlug(row.archetype!));
    if (!backed) {
      check11Details.push(`${row.occurred_at}: session ${row.quiz_session_key} archetype "${row.archetype}" has no matching quiz_complete/quiz_final row (should have been server-rejected — see Part B1)`);
    }
  }
  checks.push({
    id: 11,
    name: 'No post_quiz subscribe in the last 24h referenced a session key with no matching quiz_complete/quiz_final',
    pass: check11Details.length === 0,
    expected: 'every recent post_quiz subscribe archetype is backed by a quiz_funnel_event row for the same session',
    actual: check11Details.length === 0 ? 'all backed' : `${check11Details.length} unbacked call(s)`,
    details: check11Details.length ? check11Details : undefined,
  });

  // ── 12. Exactly one current row per question business key (quiz_id,
  // q_number) — every key that has rows has one current version ─────────
  const qKeyResult = await db.query<{ version: string | null; q_number: number; current_count: number }>(
    `SELECT qz.version, qq.q_number, COUNT(*) FILTER (WHERE qq.is_current)::int AS current_count
     FROM quiz_question qq LEFT JOIN quiz qz ON qz.id = qq.quiz_id
     GROUP BY qq.quiz_id, qz.version, qq.q_number
     HAVING COUNT(*) FILTER (WHERE qq.is_current) <> 1
     ORDER BY qz.version, qq.q_number`
  );
  const check12Details = qKeyResult.rows.map(r => `${r.version ?? '(no quiz)'} Q${r.q_number}: ${r.current_count} current row(s)`);
  checks.push({
    id: 12,
    name: 'Exactly one current version per question (quiz_id, q_number)',
    pass: check12Details.length === 0,
    expected: 'one is_current row per (quiz_id, q_number)',
    actual: check12Details.length === 0 ? 'all question keys have one current row' : `${check12Details.length} key(s) wrong`,
    details: check12Details.length ? check12Details : undefined,
  });

  // ── 13. Exactly one current row per answer_code ────────────────────────
  // A code with no current row at all is a retired answer — legal only
  // through an explicit quiz_retire_answer() seed line, none exist yet.
  const aKeyResult = await db.query<{ answer_code: string; current_count: number }>(
    `SELECT answer_code, COUNT(*) FILTER (WHERE is_current)::int AS current_count
     FROM quiz_answer WHERE answer_code IS NOT NULL
     GROUP BY answer_code HAVING COUNT(*) FILTER (WHERE is_current) <> 1
     ORDER BY answer_code`
  );
  const check13Details = aKeyResult.rows.map(r => `${r.answer_code}: ${r.current_count} current row(s)`);
  checks.push({
    id: 13,
    name: 'Exactly one current version per answer_code',
    pass: check13Details.length === 0,
    expected: 'one is_current row per answer_code',
    actual: check13Details.length === 0 ? 'all answer codes have one current row' : `${check13Details.length} code(s) wrong`,
    details: check13Details.length ? check13Details : undefined,
  });

  // ── 14. No current answer hangs off a retired question ─────────────────
  const orphanResult = await db.query<{ answer_code: string | null; answer_text: string }>(
    `SELECT a.answer_code, a.answer_text
     FROM quiz_answer a JOIN quiz_question qq ON qq.id = a.question_id
     WHERE a.is_current AND NOT qq.is_current
     ORDER BY a.answer_code, a.answer_text`
  );
  const check14Details = orphanResult.rows.map(r => `${r.answer_code ?? '(uncoded)'} "${r.answer_text}"`);
  checks.push({
    id: 14,
    name: 'No current answer points at a retired question',
    pass: check14Details.length === 0,
    expected: 'zero current answers on a non-current question',
    actual: check14Details.length === 0 ? 'none' : `${check14Details.length} answer(s)`,
    details: check14Details.length ? check14Details : undefined,
  });

  // ── 15. Display order — every current answer on the active quiz and its
  // branches has a sort_order, unique within its question ─────────────────
  let check15Details: string[] = [];
  if (activeMainId) {
    const orderResult = await db.query<{ q_label: string; answer_code: string | null; sort_order: number | null; dup_count: number }>(
      `SELECT q.version || ' Q' || qq.q_number AS q_label, a.answer_code, a.sort_order,
              COUNT(*) OVER (PARTITION BY a.question_id, a.sort_order)::int AS dup_count
       FROM quiz_answer a
       JOIN quiz_question qq ON qq.id = a.question_id AND qq.is_current
       JOIN quiz q           ON q.id  = qq.quiz_id
       WHERE (q.id = $1 OR q.parent_quiz_id = $1) AND a.is_current`,
      [activeMainId]
    );
    for (const row of orderResult.rows) {
      if (row.sort_order === null) check15Details.push(`${row.q_label} ${row.answer_code ?? '(uncoded)'}: no sort_order`);
      else if (row.dup_count > 1) check15Details.push(`${row.q_label} ${row.answer_code ?? '(uncoded)'}: sort_order ${row.sort_order} shared by ${row.dup_count} answers`);
    }
  } else {
    check15Details.push('no active quiz to check against (see check 1)');
  }
  checks.push({
    id: 15,
    name: 'Every current answer on the active quiz + branches has a sort_order, unique within its question',
    pass: check15Details.length === 0,
    expected: 'sort_order set and unique per question',
    actual: check15Details.length === 0 ? 'display order correct' : `${check15Details.length} problem(s)`,
    details: check15Details.length ? check15Details : undefined,
  });

  // ── 16. The request pool role reads quiz content and nothing else ─────
  const QUIZ_CONTENT_TABLES = [
    'quiz', 'quiz_type', 'quiz_question', 'quiz_answer', 'quiz_answer_archetype_score',
    ...QUIZ_SNAPSHOT_TABLES.map(s => s.snapshot),
  ];
  const check16Details: string[] = [];
  const roleResult = await db.query(`SELECT 1 FROM pg_roles WHERE rolname = 'ab_app'`);
  if (!roleResult.rows.length) {
    check16Details.push('role ab_app does not exist');
  } else {
    for (const t of QUIZ_CONTENT_TABLES) {
      const exists = await db.query(`SELECT to_regclass($1) AS reg`, [`public.${t}`]);
      if (!exists.rows[0]?.reg) { check16Details.push(`${t}: table missing`); continue; }
      const priv = await db.query<Record<string, boolean>>(
        `SELECT has_table_privilege('ab_app', $1, 'SELECT') AS sel,
                has_table_privilege('ab_app', $1, 'INSERT') AS ins,
                has_table_privilege('ab_app', $1, 'UPDATE') AS upd,
                has_table_privilege('ab_app', $1, 'DELETE') AS del,
                has_table_privilege('ab_app', $1, 'TRUNCATE') AS trn,
                has_table_privilege('ab_app', $1, 'REFERENCES') AS ref,
                has_table_privilege('ab_app', $1, 'TRIGGER') AS trg`,
        [`public.${t}`]
      );
      const p = priv.rows[0];
      if (!p.sel) check16Details.push(`${t}: ab_app lacks SELECT`);
      const extra = (['ins', 'upd', 'del', 'trn', 'ref', 'trg'] as const).filter(k => p[k]);
      if (extra.length) check16Details.push(`${t}: ab_app also has ${extra.join(', ')}`);
    }
  }
  checks.push({
    id: 16,
    name: 'ab_app has SELECT and nothing else on quiz content and its snapshot tables',
    pass: check16Details.length === 0,
    expected: `SELECT only on ${QUIZ_CONTENT_TABLES.length} tables`,
    actual: check16Details.length === 0 ? 'read-only' : `${check16Details.length} problem(s)`,
    details: check16Details.length ? check16Details : undefined,
  });

  // ── 17. The 2026-10-08 snapshot exists and none of its rows has left
  // the live table (quiz content is never deleted) ─────────────────────────
  const check17Details: string[] = [];
  const snapshotCounts: string[] = [];
  for (const { snapshot, source } of QUIZ_SNAPSHOT_TABLES) {
    const exists = await db.query(`SELECT to_regclass($1) AS reg`, [`public.${snapshot}`]);
    if (!exists.rows[0]?.reg) { check17Details.push(`${snapshot}: missing`); continue; }
    // Identifiers are constants above, never user input.
    const r = await db.query<{ n: number; gone: number }>(
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM ${source} live WHERE live.id = s.id))::int AS gone
       FROM ${snapshot} s`
    );
    snapshotCounts.push(`${source} ${r.rows[0].n}`);
    if (r.rows[0].n === 0) check17Details.push(`${snapshot}: empty`);
    if (r.rows[0].gone > 0) check17Details.push(`${snapshot}: ${r.rows[0].gone} row(s) no longer in ${source}`);
  }
  checks.push({
    id: 17,
    name: 'Quiz content snapshot of 2026-10-08 present, every snapshot row still live',
    pass: check17Details.length === 0,
    expected: '4 non-empty snapshot tables; every snapshot id still exists in its source table',
    actual: check17Details.length === 0 ? `snapshot rows: ${snapshotCounts.join(', ')}` : `${check17Details.length} problem(s)`,
    details: check17Details.length ? check17Details : undefined,
  });

  // ── 18. The Balanced branch (Prompt 4B) — exactly three current answers, the codes below in this sort_order,
  // every one resolving to Balanced (the person is SHOWN Balanced whatever they pick; the answer only sets the
  // match, in quizScoring.ts) ───────────────────────────────────────────────
  const EXPECTED_BALANCED_BRANCH = ['v7_branch_bal_cozy', 'v7_branch_bal_fruit', 'v7_branch_bal_floral'];
  const balResult = await db.query<{ answer_code: string | null; sort_order: number | null; archetype_name: string | null }>(
    `SELECT a.answer_code, a.sort_order, ar.name AS archetype_name
     FROM quiz bq
     JOIN quiz_question qq ON qq.quiz_id = bq.id AND qq.is_current
     JOIN quiz_answer a    ON a.question_id = qq.id AND a.is_current
     LEFT JOIN coffee_archetype ar ON ar.id = a.resulting_archetype_id
     WHERE bq.version = 'v7-branch-balanced'
     ORDER BY a.sort_order, a.id`
  );
  const check18Details: string[] = [];
  const balRows = balResult.rows;
  if (balRows.length !== 3) check18Details.push(`${balRows.length} current answer(s) (expected exactly 3)`);
  EXPECTED_BALANCED_BRANCH.forEach((code, i) => {
    const row = balRows.find(r => r.answer_code === code);
    if (!row) { check18Details.push(`${code}: missing`); return; }
    if (Number(row.sort_order) !== i + 1) check18Details.push(`${code}: sort_order ${row.sort_order} (expected ${i + 1})`);
    if (row.archetype_name !== 'Balanced') check18Details.push(`${code}: resolves to ${row.archetype_name ?? 'null'} (expected Balanced)`);
  });
  for (const row of balRows) {
    if (!EXPECTED_BALANCED_BRANCH.includes(row.answer_code ?? '')) check18Details.push(`unexpected answer ${row.answer_code ?? '(uncoded)'}`);
  }
  checks.push({
    id: 18,
    name: 'Balanced branch: three current answers cozy / fruit / floral in sort_order 1–3, all Balanced',
    pass: check18Details.length === 0,
    expected: 'v7_branch_bal_cozy=1, v7_branch_bal_fruit=2, v7_branch_bal_floral=3, each resulting in Balanced',
    actual: check18Details.length === 0 ? 'correct' : `${check18Details.length} problem(s)`,
    details: check18Details.length ? check18Details : undefined,
  });

  const allPass = checks.every(c => c.pass);
  return {
    ranAt: new Date().toISOString(),
    allPass,
    checks: checks.sort((a, b) => a.id - b.id),
  };
}
