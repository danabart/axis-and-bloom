// Core of the quiz_session_interpretation seed + backfill (SCD Type 2). Quiz interpretation v2.1, brief 2, Part C.
// Lives in src/ so the deploy build's tsc (rootDir: src) covers it and the tests can import it; the CLI is
// scripts/backfillQuizInterpretation.ts. INSERT-only against quiz_session_interpretation; read-only against
// everything else. Never updates, deletes or alters quiz_session, newsletter_subscriber or any Firestore doc.
import { type Tx } from '../db/client.js';
import { interpret, type Interpretation } from './quizScoring.js';
import { scoreAnswerIds } from './quizScorer.js';
import { saveQuizInterpretation, canonicalArchetypeName, type InterpretationInput } from './quizSession.js';

export const BATCH_SIZE = 200;
export const DEFAULT_EXPECTED_DB = 'axisandbloom_test';

// ── Pure-ish planning: read a session, decide the rows ───────────────────────

export interface SessionRow {
  id: string;
  completed_at: Date | null;
  context_data: any;
  archetype_name: string | null;
}

export interface SessionPlan {
  sessionId: string;
  completedAt: Date | null;
  answerIds: string[] | null;
  archetypeName: string | null;
  branchedFrom: string | null;
  v1: InterpretationInput;                 // seeded verbatim from context_data
  v2: Interpretation | null;               // null: no answerIds / not scoreable
  v2SkipReason: string | null;
}

export async function planSession(row: SessionRow): Promise<SessionPlan> {
  const ctx = row.context_data ?? {};
  const answerIds: string[] | null =
    Array.isArray(ctx.answerIds) && ctx.answerIds.length ? ctx.answerIds : null;
  const branchedFrom = await canonicalArchetypeName(ctx.branchedFrom ?? null);

  // v1: what the old ruleset stored, verbatim, with the old route defaults for absent keys.
  const v1: InterpretationInput = {
    interpretationVersion: 'v1',
    secondaryArchetype: ctx.secondaryArchetype ?? null,
    recommendationMode: ctx.recommendationMode ?? 'primary_only',
    foodSignalAlignment: ctx.foodSignalAlignment ?? 'high',
  };

  const plan: SessionPlan = {
    sessionId: row.id, completedAt: row.completed_at, answerIds, archetypeName: row.archetype_name,
    branchedFrom, v1, v2: null, v2SkipReason: null,
  };

  if (!answerIds) { plan.v2SkipReason = 'no answerIds in context_data'; return plan; }
  if (!row.archetype_name) { plan.v2SkipReason = 'no resulting archetype'; return plan; }

  const scored = await scoreAnswerIds(answerIds);
  if (!Object.keys(scored.scores).length) { plan.v2SkipReason = 'answerIds not scoreable'; return plan; }

  plan.v2 = interpret({ ...scored, finalArchetype: row.archetype_name, branchedFrom });
  return plan;
}

// ── Writing (insert-only, one transaction per batch, supplied by the caller) ──

type Runner = Pick<Tx, 'query'>;

export async function applyPlan(
  client: Runner, plan: SessionPlan, runAt: Date
): Promise<{ v1: boolean; v2: boolean }> {
  if (plan.v2) {
    // v1 is history the moment v2.1 exists: closed at the run timestamp, which is v2.1's valid_from.
    const v1 = await saveQuizInterpretation(client, plan.sessionId, plan.v1, 'seed', {
      isCurrent: false, validFrom: plan.completedAt ?? runAt, validTo: runAt,
    });
    const v2 = await saveQuizInterpretation(client, plan.sessionId, plan.v2, 'backfill', {
      isCurrent: true, validFrom: runAt, validTo: null,
    });
    return { v1, v2 };
  }
  // No v2.1 possible (cross-device match claims, pre-August rows): v1 stays the current row.
  const v1 = await saveQuizInterpretation(client, plan.sessionId, plan.v1, 'seed', {
    isCurrent: true, validFrom: plan.completedAt ?? runAt, validTo: null,
  });
  return { v1, v2: false };
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface BackfillOptions {
  apply: boolean;
  limit?: number;
  runAt?: Date;
  nested?: boolean;          // tests: run inside an outer transaction (SAVEPOINT per batch instead of BEGIN)
}

export interface BackfillReport {
  mode: 'dry-run' | 'apply';
  sessionsTotal: number;
  sessionsAlreadyInterpreted: number;
  sessionsProcessed: number;
  withAnswerIds: number;
  v1Rows: number;            // would insert (dry-run) / inserted (apply)
  v2Rows: number;
  v1OnlyCurrent: number;     // sessions that keep v1 as their current row
  skipReasons: Record<string, number>;
  plans: SessionPlan[];
}

export async function runBackfill(client: Runner, opts: BackfillOptions): Promise<BackfillReport> {
  const runAt = opts.runAt ?? new Date();
  const total = await client.query(`SELECT COUNT(*)::int AS n FROM quiz_session`);
  const pending = await client.query(
    `SELECT qs.id
     FROM quiz_session qs
     WHERE NOT EXISTS (SELECT 1 FROM quiz_session_interpretation i WHERE i.quiz_session_id = qs.id)
     ORDER BY qs.completed_at NULLS LAST, qs.id
     ${opts.limit ? 'LIMIT ' + Number(opts.limit) : ''}`
  );
  const ids: string[] = pending.rows.map((r: any) => r.id);

  const report: BackfillReport = {
    mode: opts.apply ? 'apply' : 'dry-run',
    sessionsTotal: total.rows[0].n,
    sessionsAlreadyInterpreted: total.rows[0].n - ids.length,
    sessionsProcessed: 0, withAnswerIds: 0, v1Rows: 0, v2Rows: 0, v1OnlyCurrent: 0,
    skipReasons: {}, plans: [],
  };
  // (with --limit, sessionsAlreadyInterpreted is total minus the limited set: recomputed below for accuracy)
  if (opts.limit) {
    const un = await client.query(
      `SELECT COUNT(*)::int AS n FROM quiz_session qs
       WHERE NOT EXISTS (SELECT 1 FROM quiz_session_interpretation i WHERE i.quiz_session_id = qs.id)`
    );
    report.sessionsAlreadyInterpreted = total.rows[0].n - un.rows[0].n;
  }

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BATCH_SIZE);
    const rows = await client.query(
      `SELECT qs.id, qs.completed_at, qs.context_data, ar.name AS archetype_name
       FROM quiz_session qs
       LEFT JOIN coffee_archetype ar ON ar.id = qs.resulting_archetype_id
       WHERE qs.id = ANY($1::uuid[])
       ORDER BY qs.completed_at NULLS LAST, qs.id`,
      [batchIds]
    );
    const plans: SessionPlan[] = [];
    for (const row of rows.rows as SessionRow[]) plans.push(await planSession(row));

    if (opts.apply) {
      const [begin, commit, rollback] = opts.nested
        ? ['SAVEPOINT backfill_batch', 'RELEASE SAVEPOINT backfill_batch', 'ROLLBACK TO SAVEPOINT backfill_batch']
        : ['BEGIN', 'COMMIT', 'ROLLBACK'];
      await client.query(begin);
      try {
        for (const plan of plans) {
          const r = await applyPlan(client, plan, runAt);
          if (r.v1) report.v1Rows++;
          if (r.v2) report.v2Rows++;
        }
        await client.query(commit);
      } catch (err) {
        await client.query(rollback);
        throw err;
      }
    } else {
      for (const plan of plans) {
        report.v1Rows++;
        if (plan.v2) report.v2Rows++;
      }
    }

    for (const plan of plans) {
      report.sessionsProcessed++;
      if (plan.answerIds) report.withAnswerIds++;
      if (!plan.v2) {
        report.v1OnlyCurrent++;
        const k = plan.v2SkipReason ?? 'unknown';
        report.skipReasons[k] = (report.skipReasons[k] ?? 0) + 1;
      }
      report.plans.push(plan);
    }
  }
  return report;
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
  fixture: { cases: Array<{ case_id: string; input: any; expected_v2_1: any }> }
): FixtureComparison[] {
  return fixture.cases.map(c => {
    const candidates = plans.filter(p =>
      p.v2 !== null &&
      JSON.stringify(p.answerIds) === JSON.stringify(c.input.answerIds) &&
      p.archetypeName === c.input.archetype &&
      (p.branchedFrom ?? null) === (c.input.branchedFrom ?? null)
    );
    if (!candidates.length) return { caseId: c.case_id, matchedSessions: 0, agree: null };
    const e = c.expected_v2_1;
    const bad = candidates.filter(p => {
      const v = p.v2!;
      return v.secondaryArchetype !== e.secondaryArchetype || v.recommendationMode !== e.recommendationMode ||
        v.pairConfidence !== e.pairConfidence || v.exploreArchetype !== e.exploreArchetype ||
        v.primaryMargin !== e.primaryMargin;
    });
    return {
      caseId: c.case_id, matchedSessions: candidates.length, agree: bad.length === 0,
      detail: bad.length ? `${bad.length} session(s) differ from expected_v2_1` : undefined,
    };
  });
}

// ── Safety: which database is this? ──────────────────────────────────────────

export function dbNameFromUrl(url: string): string {
  return url.split('?')[0].split('/').pop() ?? '';
}

export function parseArgs(argv: string[]): { apply: boolean; limit?: number; expectDb: string } {
  let apply = false, dryRun = false, limit: number | undefined, expectDb = DEFAULT_EXPECTED_DB;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--limit') limit = Number(argv[++i]);
    else if (a === '--expect-db') expectDb = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (apply && dryRun) throw new Error('Pass either --dry-run (default) or --apply, not both');
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error('--limit needs a positive integer');
  if (!expectDb) throw new Error('--expect-db needs a database name');
  return { apply, limit, expectDb };
}
