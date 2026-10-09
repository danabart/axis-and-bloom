// Core of the quiz_session_interpretation seed + backfill (SCD Type 2). Quiz interpretation v2.1, brief 2, Part C;
// v2.2 pass added by Prompt 4B, Part E (2026-10-09). Lives in src/ so the deploy build's tsc (rootDir: src) covers
// it and the tests can import it; the CLI is scripts/backfillQuizInterpretation.ts.
//
// Writes quiz_session_interpretation ONLY, and only two ways: INSERT (ON CONFLICT DO NOTHING), and the SCD2 close
// of a superseded current row through quizSession.closeCurrentInterpretation (valid_to, is_current; nothing else).
// Read-only against everything else. Never updates, deletes or alters quiz_session, newsletter_subscriber or any
// Firestore document; a data guard proves it inside every write transaction.
//
// Which sessions:
//  - current row is the previous ruleset (v2.1) → close it at the run timestamp, insert the current ruleset (v2.2)
//    as current with valid_from = the run timestamp. One transaction per session.
//  - no interpretation row at all (a stale bundle saved without answerIds, or a brand-new database) → the brief-2
//    seed: v1 from context_data, plus the current ruleset as current when computable (else v1 stays current).
//  - current row v1 (no answerIds) or already the current ruleset → not touched. A second run finds nothing.
import { type Tx } from '../db/client.js';
import { interpret, historicalBranchAnswerCode, INTERPRETATION_VERSION, type Interpretation } from './quizScoring.js';
import { scoreAnswerIds } from './quizScorer.js';
import {
  saveQuizInterpretation, closeCurrentInterpretation, canonicalArchetypeName, type InterpretationInput,
} from './quizSession.js';

export const BATCH_SIZE = 200;
export const DEFAULT_EXPECTED_DB = 'axisandbloom_test';
// The ruleset a v2.2 pass supersedes. Sessions whose current row has any other version are not re-interpreted.
export const SUPERSEDED_VERSION = 'v2.1';

// ── Pure-ish planning: read a session, decide the rows ───────────────────────

export interface CurrentRow {
  version: string;
  secondaryArchetype: string | null;
  secondaryPath: string | null;
  recommendationMode: string;
  pairConfidence: string | null;
  exploreArchetype: string | null;
  exploreReason: string | null;
  validFrom: Date;
}

export interface SessionRow {
  id: string;
  user_id?: string | null;
  completed_at: Date | null;
  context_data: any;
  archetype_name: string | null;
  branch_answer_code?: string | null;
  current?: CurrentRow | null;     // the session's current interpretation row, if any
}

export interface SessionPlan {
  sessionId: string;
  userId: string | null;
  completedAt: Date | null;
  answerIds: string[] | null;
  archetypeName: string | null;
  branchedFrom: string | null;
  branchAnswerCode: string | null;         // stored (new sessions) or derived from branchedFrom (historical)
  kind: 'seed' | 'reinterpret';            // no row yet / current row is SUPERSEDED_VERSION
  previous: CurrentRow | null;             // 'reinterpret': the row being closed
  v1: InterpretationInput;                 // 'seed': seeded verbatim from context_data
  v2: Interpretation | null;               // the current ruleset; null: no answerIds / not scoreable
  v2SkipReason: string | null;
}

export async function planSession(row: SessionRow): Promise<SessionPlan> {
  const ctx = row.context_data ?? {};
  const answerIds: string[] | null =
    Array.isArray(ctx.answerIds) && ctx.answerIds.length ? ctx.answerIds : null;
  const branchedFrom = await canonicalArchetypeName(ctx.branchedFrom ?? null);
  const branchAnswerCode = row.branch_answer_code ?? historicalBranchAnswerCode(row.archetype_name, branchedFrom);

  // v1: what the old ruleset stored, verbatim, with the old route defaults for absent keys.
  const v1: InterpretationInput = {
    interpretationVersion: 'v1',
    secondaryArchetype: ctx.secondaryArchetype ?? null,
    recommendationMode: ctx.recommendationMode ?? 'primary_only',
    foodSignalAlignment: ctx.foodSignalAlignment ?? 'high',
  };

  const plan: SessionPlan = {
    sessionId: row.id, userId: row.user_id ?? null, completedAt: row.completed_at, answerIds,
    archetypeName: row.archetype_name, branchedFrom, branchAnswerCode,
    kind: row.current ? 'reinterpret' : 'seed', previous: row.current ?? null,
    v1, v2: null, v2SkipReason: null,
  };

  if (!answerIds) { plan.v2SkipReason = 'no answerIds in context_data'; return plan; }
  if (!row.archetype_name) { plan.v2SkipReason = 'no resulting archetype'; return plan; }

  const scored = await scoreAnswerIds(answerIds);
  if (!Object.keys(scored.scores).length) { plan.v2SkipReason = 'answerIds not scoreable'; return plan; }

  plan.v2 = interpret({ ...scored, finalArchetype: row.archetype_name, branchedFrom, branchAnswerCode });
  return plan;
}

// ── Writing (one transaction per session, supplied by the caller) ────────────

type Runner = Pick<Tx, 'query'>;

export async function applyPlan(
  client: Runner, plan: SessionPlan, runAt: Date
): Promise<{ v1: boolean; v2: boolean; closed: boolean }> {
  if (plan.kind === 'reinterpret') {
    if (!plan.v2) return { v1: false, v2: false, closed: false };   // nothing better to offer: leave it current
    const closed = await closeCurrentInterpretation(client, plan.sessionId, plan.previous!.version, runAt);
    if (!closed) throw new Error(`session ${plan.sessionId}: current ${plan.previous!.version} row vanished mid-run`);
    const v2 = await saveQuizInterpretation(client, plan.sessionId, plan.v2, 'backfill', {
      isCurrent: true, validFrom: runAt, validTo: null,
    });
    if (!v2) throw new Error(`session ${plan.sessionId}: a ${plan.v2.interpretationVersion} row already exists`);
    return { v1: false, v2, closed };
  }
  if (plan.v2) {
    // v1 is history the moment the current ruleset exists: closed at the run timestamp (its successor's valid_from).
    const v1 = await saveQuizInterpretation(client, plan.sessionId, plan.v1, 'seed', {
      isCurrent: false, validFrom: plan.completedAt ?? runAt, validTo: runAt,
    });
    const v2 = await saveQuizInterpretation(client, plan.sessionId, plan.v2, 'backfill', {
      isCurrent: true, validFrom: runAt, validTo: null,
    });
    return { v1, v2, closed: false };
  }
  // No current-ruleset row possible (cross-device match claims, pre-August rows): v1 stays the current row.
  const v1 = await saveQuizInterpretation(client, plan.sessionId, plan.v1, 'seed', {
    isCurrent: true, validFrom: plan.completedAt ?? runAt, validTo: null,
  });
  return { v1, v2: false, closed: false };
}

// ── Data guard: what the backfill must never change ──────────────────────────

export interface GuardReading {
  quizSession: string;            // count:md5
  newsletterSubscriber: string;   // count:md5
  nonCurrentRulesetRows: number;  // interpretation rows whose version is not INTERPRETATION_VERSION
}

export async function readGuard(client: Runner): Promise<GuardReading> {
  const r = (await client.query(
    `SELECT
       (SELECT COUNT(*) || ':' || COALESCE(md5(string_agg(t::text, '|' ORDER BY t.id)), '') FROM quiz_session t) AS qs,
       (SELECT COUNT(*) || ':' || COALESCE(md5(string_agg(t::text, '|' ORDER BY t::text)), '') FROM newsletter_subscriber t) AS ns,
       (SELECT COUNT(*)::int FROM quiz_session_interpretation WHERE interpretation_version <> $1) AS other`,
    [INTERPRETATION_VERSION]
  )).rows[0];
  return { quizSession: r.qs, newsletterSubscriber: r.ns, nonCurrentRulesetRows: r.other };
}

// The only allowed movement in nonCurrentRulesetRows is the v1 seed rows this run inserted itself.
export function assertGuard(before: GuardReading, after: GuardReading, v1RowsInserted: number): void {
  const problems: string[] = [];
  if (before.quizSession !== after.quizSession) problems.push(`quiz_session changed (${before.quizSession} -> ${after.quizSession})`);
  if (before.newsletterSubscriber !== after.newsletterSubscriber) problems.push(`newsletter_subscriber changed (${before.newsletterSubscriber} -> ${after.newsletterSubscriber})`);
  if (after.nonCurrentRulesetRows !== before.nonCurrentRulesetRows + v1RowsInserted) {
    problems.push(`interpretation rows other than ${INTERPRETATION_VERSION}: ${before.nonCurrentRulesetRows} -> ${after.nonCurrentRulesetRows} (expected +${v1RowsInserted} v1 seed rows)`);
  }
  if (problems.length) throw new Error(`DATA GUARD — aborting: ${problems.join('; ')}`);
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface BackfillOptions {
  apply: boolean;
  limit?: number;
  runAt?: Date;
  nested?: boolean;          // tests: run inside an outer transaction (SAVEPOINT per session instead of BEGIN)
}

export interface BackfillReport {
  mode: 'dry-run' | 'apply';
  ruleset: string;
  sessionsTotal: number;
  sessionsAlreadyCurrent: number;   // current row is the current ruleset, or v1 (not re-interpretable)
  sessionsProcessed: number;
  reinterpret: number;              // current row was SUPERSEDED_VERSION
  seeded: number;                   // had no interpretation row at all
  withAnswerIds: number;
  v1Rows: number;                   // would insert (dry-run) / inserted (apply)
  v2Rows: number;
  closedRows: number;
  v1OnlyCurrent: number;            // seeded sessions that keep v1 as their current row
  skipReasons: Record<string, number>;
  guard: { before: GuardReading; after: GuardReading } | null;
  plans: SessionPlan[];
}

const PENDING_WHERE = `
  (NOT EXISTS (SELECT 1 FROM quiz_session_interpretation i0 WHERE i0.quiz_session_id = qs.id)
   OR EXISTS (SELECT 1 FROM quiz_session_interpretation i1
              WHERE i1.quiz_session_id = qs.id AND i1.is_current AND i1.interpretation_version = $1))`;

export async function runBackfill(client: Runner, opts: BackfillOptions): Promise<BackfillReport> {
  const runAt = opts.runAt ?? new Date();
  const total = (await client.query(`SELECT COUNT(*)::int AS n FROM quiz_session`)).rows[0].n;
  const allPending = (await client.query(
    `SELECT COUNT(*)::int AS n FROM quiz_session qs WHERE ${PENDING_WHERE}`, [SUPERSEDED_VERSION])).rows[0].n;
  const pending = await client.query(
    `SELECT qs.id FROM quiz_session qs WHERE ${PENDING_WHERE}
     ORDER BY qs.completed_at NULLS LAST, qs.id
     ${opts.limit ? 'LIMIT ' + Number(opts.limit) : ''}`,
    [SUPERSEDED_VERSION]
  );
  const ids: string[] = pending.rows.map((r: any) => r.id);

  const report: BackfillReport = {
    mode: opts.apply ? 'apply' : 'dry-run', ruleset: INTERPRETATION_VERSION,
    sessionsTotal: total, sessionsAlreadyCurrent: total - allPending,
    sessionsProcessed: 0, reinterpret: 0, seeded: 0, withAnswerIds: 0, v1Rows: 0, v2Rows: 0, closedRows: 0,
    v1OnlyCurrent: 0, skipReasons: {}, guard: null, plans: [],
  };
  const guardBefore = await readGuard(client);

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BATCH_SIZE);
    const rows = await client.query(
      `SELECT qs.id, qs.user_id, qs.completed_at, qs.context_data, ar.name AS archetype_name,
              ba.answer_code AS branch_answer_code,
              i.interpretation_version AS cur_version, i.secondary_archetype AS cur_secondary_archetype,
              i.secondary_path AS cur_secondary_path, i.recommendation_mode AS cur_recommendation_mode,
              i.pair_confidence AS cur_pair_confidence, i.explore_archetype AS cur_explore_archetype,
              i.explore_reason AS cur_explore_reason, i.valid_from AS cur_valid_from
       FROM quiz_session qs
       LEFT JOIN coffee_archetype ar ON ar.id = qs.resulting_archetype_id
       LEFT JOIN quiz_answer ba ON ba.id = qs.branch_answer_id
       LEFT JOIN quiz_session_interpretation i ON i.quiz_session_id = qs.id AND i.is_current
       WHERE qs.id = ANY($1::uuid[])
       ORDER BY qs.completed_at NULLS LAST, qs.id`,
      [batchIds]
    );
    for (const r of rows.rows as any[]) {
      const plan = await planSession({
        id: r.id, user_id: r.user_id, completed_at: r.completed_at, context_data: r.context_data,
        archetype_name: r.archetype_name, branch_answer_code: r.branch_answer_code,
        current: r.cur_version ? {
          version: r.cur_version, secondaryArchetype: r.cur_secondary_archetype, secondaryPath: r.cur_secondary_path,
          recommendationMode: r.cur_recommendation_mode, pairConfidence: r.cur_pair_confidence,
          exploreArchetype: r.cur_explore_archetype, exploreReason: r.cur_explore_reason, validFrom: r.cur_valid_from,
        } : null,
      });

      if (opts.apply) {
        const [begin, commit, rollback] = opts.nested
          ? ['SAVEPOINT backfill_session', 'RELEASE SAVEPOINT backfill_session', 'ROLLBACK TO SAVEPOINT backfill_session']
          : ['BEGIN', 'COMMIT', 'ROLLBACK'];
        await client.query(begin);
        try {
          const before = await readGuard(client);
          const res = await applyPlan(client, plan, runAt);
          assertGuard(before, await readGuard(client), res.v1 ? 1 : 0);
          await client.query(commit);
          if (res.v1) report.v1Rows++;
          if (res.v2) report.v2Rows++;
          if (res.closed) report.closedRows++;
        } catch (err) {
          await client.query(rollback);
          throw err;
        }
      } else if (plan.kind === 'reinterpret') {
        if (plan.v2) { report.v2Rows++; report.closedRows++; }
      } else {
        report.v1Rows++;
        if (plan.v2) report.v2Rows++;
      }

      report.sessionsProcessed++;
      if (plan.kind === 'reinterpret') report.reinterpret++; else report.seeded++;
      if (plan.answerIds) report.withAnswerIds++;
      if (!plan.v2) {
        if (plan.kind === 'seed') report.v1OnlyCurrent++;
        const k = plan.v2SkipReason ?? 'unknown';
        report.skipReasons[k] = (report.skipReasons[k] ?? 0) + 1;
      }
      report.plans.push(plan);
    }
  }

  // The hard abort is the per-session guard inside each write transaction above. This whole-run reading is
  // reported (the CLI prints both), not asserted: on production a real quiz completion during the run legitimately
  // adds a quiz_session row and would make it differ.
  report.guard = { before: guardBefore, after: await readGuard(client) };
  return report;
}

// ── Before/after report rows (the --report CSV) ──────────────────────────────

export interface ReportRow {
  quiz_session_id: string;
  first_name: string | null;
  email: string | null;
  shown_archetype: string | null;
  v2_1_secondary: string | null; v2_1_path: string | null; v2_1_mode: string | null;
  v2_1_pair_confidence: string | null; v2_1_explore: string | null;
  v2_2_secondary: string | null; v2_2_path: string | null; v2_2_mode: string | null;
  v2_2_pair_confidence: string | null; v2_2_explore: string | null;
  v2_2_match_archetype: string | null; v2_2_intensity_lean: string | null;
  branch_answer_code: string | null;
  changed: boolean;
  changed_fields: string;
  explore_thread_already_asked: boolean;
}

/**
 * One row per re-interpreted session: what the superseded row says next to what the new ruleset says.
 * `explore_thread_already_asked`: Liam already asked this customer the thread question for the OLD row's explore
 * archetype after that row became current (userSignals.ts' rule). The new row's later valid_from makes Liam treat
 * that thread as not yet asked, so it can be asked again. Read-only.
 */
export async function buildReportRows(client: Runner, plans: SessionPlan[]): Promise<ReportRow[]> {
  const out: ReportRow[] = [];
  for (const p of plans) {
    if (p.kind !== 'reinterpret' || !p.previous || !p.v2) continue;
    const who = (await client.query(
      `SELECT ns.first_name, ns.email FROM newsletter_subscriber ns WHERE ns.user_id = $1
       ORDER BY ns.created_at DESC LIMIT 1`, [p.userId])).rows[0];
    let asked = false;
    if (p.previous.exploreArchetype && p.userId) {
      const r = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM v_palate_threads t
           JOIN v_customer_identity vci ON vci.canonical_user_id = t.canonical_user_id AND vci.user_id = $1
           JOIN coffee_archetype ca ON ca.code::text = t.archetype_code::text AND ca.name = $2
           WHERE t.kind = 'thread' AND t.occurred_at > $3) AS asked`,
        [p.userId, p.previous.exploreArchetype, p.previous.validFrom]
      );
      asked = r.rows[0].asked;
    }
    const prev = p.previous, next = p.v2;
    const pairs: [string, unknown, unknown][] = [
      ['secondary', prev.secondaryArchetype, next.secondaryArchetype],
      ['path', prev.secondaryPath, next.secondaryPath],
      ['mode', prev.recommendationMode, next.recommendationMode],
      ['pair_confidence', prev.pairConfidence, next.pairConfidence],
      ['explore', prev.exploreArchetype, next.exploreArchetype],
    ];
    const changedFields = pairs.filter(([, a, b]) => (a ?? null) !== (b ?? null)).map(([k]) => k);
    if (next.matchArchetype !== p.archetypeName) changedFields.push('match');
    if (next.intensityLean !== null) changedFields.push('intensity_lean');
    out.push({
      quiz_session_id: p.sessionId, first_name: who?.first_name ?? null, email: who?.email ?? null,
      shown_archetype: p.archetypeName,
      v2_1_secondary: prev.secondaryArchetype, v2_1_path: prev.secondaryPath, v2_1_mode: prev.recommendationMode,
      v2_1_pair_confidence: prev.pairConfidence, v2_1_explore: prev.exploreArchetype,
      v2_2_secondary: next.secondaryArchetype, v2_2_path: next.secondaryPath, v2_2_mode: next.recommendationMode,
      v2_2_pair_confidence: next.pairConfidence, v2_2_explore: next.exploreArchetype,
      v2_2_match_archetype: next.matchArchetype, v2_2_intensity_lean: next.intensityLean,
      branch_answer_code: p.branchAnswerCode,
      changed: changedFields.length > 0, changed_fields: changedFields.join(' '),
      explore_thread_already_asked: asked,
    });
  }
  return out;
}

export function toCsv(rows: ReportRow[]): string {
  const header: (keyof ReportRow)[] = [
    'quiz_session_id', 'first_name', 'email', 'shown_archetype',
    'v2_1_secondary', 'v2_1_path', 'v2_1_mode', 'v2_1_pair_confidence', 'v2_1_explore',
    'v2_2_secondary', 'v2_2_path', 'v2_2_mode', 'v2_2_pair_confidence', 'v2_2_explore',
    'v2_2_match_archetype', 'v2_2_intensity_lean', 'branch_answer_code',
    'changed', 'changed_fields', 'explore_thread_already_asked',
  ];
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.join(','), ...rows.map(r => header.map(h => cell(r[h])).join(','))].join('\n') + '\n';
}

// ── Crawl fixture comparison (dry-run output) ────────────────────────────────

export interface FixtureComparison {
  caseId: string;
  matchedSessions: number;
  agree: boolean | null;     // null: no session in this database matches the case
  detail?: string;
}

export function compareToFixture(
  plans: SessionPlan[],
  fixture: { cases: Array<{ case_id: string; input: any; expected_v2_2: any }> }
): FixtureComparison[] {
  return fixture.cases.map(c => {
    const candidates = plans.filter(p =>
      p.v2 !== null &&
      JSON.stringify(p.answerIds) === JSON.stringify(c.input.answerIds) &&
      p.archetypeName === c.input.archetype &&
      (p.branchedFrom ?? null) === (c.input.branchedFrom ?? null)
    );
    if (!candidates.length) return { caseId: c.case_id, matchedSessions: 0, agree: null };
    const e = c.expected_v2_2;
    const bad = candidates.filter(p => {
      const v = p.v2!;
      return v.secondaryArchetype !== e.secondaryArchetype || v.recommendationMode !== e.recommendationMode ||
        v.pairConfidence !== e.pairConfidence || v.exploreArchetype !== e.exploreArchetype ||
        v.primaryMargin !== e.primaryMargin || v.matchArchetype !== e.matchArchetype ||
        v.intensityLean !== e.intensityLean;
    });
    return {
      caseId: c.case_id, matchedSessions: candidates.length, agree: bad.length === 0,
      detail: bad.length ? `${bad.length} session(s) differ from expected_v2_2` : undefined,
    };
  });
}

// ── Safety: which database is this? ──────────────────────────────────────────

export function dbNameFromUrl(url: string): string {
  return url.split('?')[0].split('/').pop() ?? '';
}

export function parseArgs(argv: string[]): { apply: boolean; limit?: number; expectDb: string; report?: string } {
  let apply = false, dryRun = false, limit: number | undefined, expectDb = DEFAULT_EXPECTED_DB, report: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--limit') limit = Number(argv[++i]);
    else if (a === '--expect-db') expectDb = argv[++i];
    else if (a === '--report') report = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (apply && dryRun) throw new Error('Pass either --dry-run (default) or --apply, not both');
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error('--limit needs a positive integer');
  if (!expectDb) throw new Error('--expect-db needs a database name');
  if (report !== undefined && !report) throw new Error('--report needs a file path');
  return report === undefined ? { apply, limit, expectDb } : { apply, limit, expectDb, report };
}
