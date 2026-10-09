// Quiz interpretation v2.1, brief 2 — quiz_session_interpretation (SCD Type 2).
// Runs against axisandbloom_test (vitest.config.ts + src/test/guard.ts refuse anything else). Every test's
// writes live inside a transaction that is ROLLED BACK in afterEach, so the database is left byte-for-byte as
// found (the brief's md5 readings prove it). Nothing here calls the real HTTP route: POST /api/quiz/results
// also writes Firestore, which is not isolated by the test database.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { db } from '../db/client.js';
import {
  saveQuizInterpretation, recordScoredInterpretation, getLatestQuizResult, resolveInterpretation, resolveBranchAnswer,
} from './quizSession.js';
import { isProfileAmbiguous } from './sommelierEvaluator.js';
import {
  runBackfill, compareToFixture, parseArgs, dbNameFromUrl, buildReportRows, toCsv,
} from './quizInterpretationBackfill.js';

interface Case {
  case_id: string;
  input: { answerIds: string[]; scores: Record<string, number>; archetype: string; foodSignal: string | null; experimental: boolean; branchedFrom: string | null };
  stored_v1: { secondaryArchetype: string | null; recommendationMode: string; foodSignalAlignment: string };
  expected_v2_2: { secondaryArchetype: string | null; recommendationMode: string; pairConfidence: string; exploreArchetype: string | null; primaryMargin: number; matchArchetype: string; intensityLean: string | null };
}
const fixture = JSON.parse(readFileSync(
  new URL('../fixtures/quiz_calibration/hoboken-crawl-2026.calibration.json', import.meta.url), 'utf8')
) as { cases: Case[] };

let client: PoolClient;
beforeEach(async () => { client = await db.connect(); await client.query('BEGIN'); });
afterEach(async () => { try { await client.query('ROLLBACK'); } finally { client.release(); } });

async function makeUser(): Promise<string> {
  const r = await client.query(
    `INSERT INTO user_profile (firebase_uid) VALUES ($1) RETURNING id`,
    [`vitest-qsi-${Date.now()}-${Math.random().toString(36).slice(2)}`]
  );
  return r.rows[0].id;
}
async function archetypeId(name: string): Promise<string> {
  const r = await client.query(`SELECT id FROM coffee_archetype WHERE name = $1`, [name]);
  if (!r.rows.length) throw new Error(`archetype '${name}' not in the test database`);
  return r.rows[0].id;
}
async function makeSession(userId: string, ctx: Record<string, unknown> | null, archetype: string, completedAt: Date): Promise<string> {
  const r = await client.query(
    `INSERT INTO quiz_session (user_id, resulting_archetype_id, context_data, completed_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [userId, await archetypeId(archetype), ctx === null ? null : JSON.stringify(ctx), completedAt]
  );
  return r.rows[0].id;
}
const V21 = {
  interpretationVersion: 'v2.1', secondaryArchetype: 'Fruity', secondaryPath: 'near-tie',
  recommendationMode: 'primary_plus_active_secondary', foodSignalAlignment: 'medium',
  pairConfidence: 'high', exploreArchetype: null, exploreReason: null, primaryMargin: 1,
};

describe('saveQuizInterpretation + the current-row index', () => {
  it('inserts a row, and is idempotent per (session, version)', async () => {
    const s = await makeSession(await makeUser(), {}, 'Balanced', new Date());
    expect(await saveQuizInterpretation(client, s, V21, 'scored')).toBe(true);
    expect(await saveQuizInterpretation(client, s, V21, 'scored')).toBe(false);
    const rows = (await client.query(`SELECT * FROM quiz_session_interpretation WHERE quiz_session_id = $1`, [s])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      interpretation_version: 'v2.1', secondary_archetype: 'Fruity', secondary_path: 'near-tie',
      pair_confidence: 'high', is_current: true, computed_by: 'scored', valid_to: null,
    });
  });

  it('rejects a second current row for the same session (partial unique index)', async () => {
    const s = await makeSession(await makeUser(), {}, 'Balanced', new Date());
    await saveQuizInterpretation(client, s, V21, 'scored');
    await client.query('SAVEPOINT two_current');
    await expect(
      saveQuizInterpretation(client, s, { ...V21, interpretationVersion: 'v2.2' }, 'scored')
    ).rejects.toMatchObject({ code: '23505', constraint: 'quiz_session_interpretation_current' });
    await client.query('ROLLBACK TO SAVEPOINT two_current');
    // a non-current history row for another version is fine
    expect(await saveQuizInterpretation(client, s, { ...V21, interpretationVersion: 'v1' }, 'seed', { isCurrent: false })).toBe(true);
  });

  it('rejects an unknown computed_by', async () => {
    const s = await makeSession(await makeUser(), {}, 'Balanced', new Date());
    await client.query('SAVEPOINT bad_by');
    await expect(saveQuizInterpretation(client, s, V21, 'nope' as any)).rejects.toMatchObject({ code: '23514' });
    await client.query('ROLLBACK TO SAVEPOINT bad_by');
  });
});

describe('recordScoredInterpretation (live path, server-side recompute)', () => {
  // case 02 is the branched one (Chocolate & Nutty -> Earthy, gate open): the richest single case.
  const c = fixture.cases[1];

  it('answer ids from the fixture exist in this database', async () => {
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM quiz_answer WHERE id = ANY($1::uuid[])`, [c.input.answerIds]);
    expect(r.rows[0].n).toBe(c.input.answerIds.length);
  });

  it('writes one current scored v2.2 row equal to the fixture, ignoring client-sent interpretation fields', async () => {
    const s = await makeSession(await makeUser(), {
      ...c.input, ...c.stored_v1, pairConfidence: 'low', exploreArchetype: 'Earthy',   // stale/wrong client fields
    }, c.input.archetype, new Date());
    const interp = await recordScoredInterpretation(client, {
      sessionId: s, answerIds: c.input.answerIds, archetype: c.input.archetype, branchedFrom: c.input.branchedFrom,
      branchAnswerCode: 'v7_branch_cn_earthy',
    });
    expect(interp).not.toBeNull();
    const rows = (await client.query(`SELECT * FROM quiz_session_interpretation WHERE quiz_session_id = $1`, [s])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      interpretation_version: 'v2.2', is_current: true, computed_by: 'scored', valid_to: null,
      secondary_archetype: c.expected_v2_2.secondaryArchetype,
      recommendation_mode: c.expected_v2_2.recommendationMode,
      pair_confidence: c.expected_v2_2.pairConfidence,
      explore_archetype: c.expected_v2_2.exploreArchetype,
      primary_margin: c.expected_v2_2.primaryMargin,
      match_archetype: c.expected_v2_2.matchArchetype,
      intensity_lean: c.expected_v2_2.intensityLean,
    });
  });

  it('writes nothing when answerIds is missing (old bundles), and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = await makeSession(await makeUser(), {}, 'Balanced', new Date());
    expect(await recordScoredInterpretation(client, { sessionId: s, answerIds: null, archetype: 'Balanced', branchedFrom: null })).toBeNull();
    expect((await client.query(`SELECT 1 FROM quiz_session_interpretation WHERE quiz_session_id = $1`, [s])).rows).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('GET /results/latest returns the current row as top-level keys, context_data still raw', async () => {
    const userId = await makeUser();
    const uid = (await client.query(`SELECT firebase_uid FROM user_profile WHERE id = $1`, [userId])).rows[0].firebase_uid;
    const s = await makeSession(userId, { ...c.input, ...c.stored_v1 }, c.input.archetype, new Date());
    await recordScoredInterpretation(client, { sessionId: s, answerIds: c.input.answerIds, archetype: c.input.archetype, branchedFrom: c.input.branchedFrom });
    const latest: any = await getLatestQuizResult(client, uid);
    expect(latest.id).toBe(s);
    expect(latest.archetype_name).toBe(c.input.archetype);
    expect(latest.context_data.secondaryArchetype).toBe(c.stored_v1.secondaryArchetype);      // raw, untouched
    expect(latest).toMatchObject({
      source: 'table', interpretationVersion: 'v2.2',
      secondaryArchetype: c.expected_v2_2.secondaryArchetype,
      recommendationMode: c.expected_v2_2.recommendationMode,
      pairConfidence: c.expected_v2_2.pairConfidence,
      exploreArchetype: c.expected_v2_2.exploreArchetype,
      matchArchetype: c.expected_v2_2.matchArchetype,
      intensityLean: c.expected_v2_2.intensityLean,
    });
    expect(Object.keys(latest).some(k => k.startsWith('interp_'))).toBe(false);
  });

  it('a session with no interpretation rows falls back to context_data exactly as before', async () => {
    const userId = await makeUser();
    const uid = (await client.query(`SELECT firebase_uid FROM user_profile WHERE id = $1`, [userId])).rows[0].firebase_uid;
    await makeSession(userId, { secondaryArchetype: 'Fruity', recommendationMode: 'ai_agent', foodSignalAlignment: 'low' }, 'Balanced', new Date());
    const latest: any = await getLatestQuizResult(client, uid);
    expect(latest).toMatchObject({
      source: 'context_data', secondaryArchetype: 'Fruity', recommendationMode: 'ai_agent',
      foodSignalAlignment: 'low', pairConfidence: null, exploreArchetype: null, interpretationVersion: null,
    });
  });

  it('a current row with a NULL secondary does not resurrect the stale v1 secondary from context_data', () => {
    const view = resolveInterpretation(
      { interp_id: 'x', interp_version: 'v2.1', interp_secondary_archetype: null, interp_recommendation_mode: 'primary_only', interp_food_signal_alignment: 'high' },
      { secondaryArchetype: 'Fruity' }
    );
    expect(view.secondaryArchetype).toBeNull();
    expect(view.source).toBe('table');
  });
});

// Each test seeds 39 sessions and plans/writes them over the network (the Auth Proxy), so the 5s default is too short.
describe('backfill script on the 37 crawl fixture sessions', { timeout: 120_000 }, () => {
  // 37 fixture sessions + one with no answerIds (a cross-device match claim) + one post-deploy session that
  // already holds a scored v2.1 row. All inside the rolled-back transaction, alongside whatever real sessions
  // the test database already holds (they are processed too, and rolled back with everything else).
  async function seed() {
    const userId = await makeUser();
    const base = Date.now() - 86_400_000;
    const ids: string[] = [];
    for (const [i, c] of fixture.cases.entries()) {
      ids.push(await makeSession(userId, { ...c.input, ...c.stored_v1 }, c.input.archetype, new Date(base + i * 1000)));
    }
    const claimId = await makeSession(userId, { archetype: 'Balanced', secondaryArchetype: null, recommendationMode: 'primary_only' }, 'Balanced', new Date(base - 5000));
    const scoredId = await makeSession(userId, { ...fixture.cases[0].input, ...fixture.cases[0].stored_v1 }, fixture.cases[0].input.archetype, new Date());
    await saveQuizInterpretation(client, scoredId, { ...V21, secondaryArchetype: 'Chocolate & Nutty' }, 'scored');
    return { ids, claimId, scoredId };
  }

  it('--dry-run (the default) writes nothing and reports the fixture', async () => {
    const { ids } = await seed();
    const before = (await client.query(`SELECT COUNT(*)::int AS n FROM quiz_session_interpretation`)).rows[0].n;
    const report = await runBackfill(client, { apply: false, nested: true });
    const after = (await client.query(`SELECT COUNT(*)::int AS n FROM quiz_session_interpretation`)).rows[0].n;
    expect(after).toBe(before);
    expect(report.mode).toBe('dry-run');
    expect(report.v2Rows).toBeGreaterThanOrEqual(ids.length);
    const cmp = compareToFixture(report.plans, fixture);
    expect(cmp.filter(x => x.agree === true)).toHaveLength(37);
  });

  it('--apply: one current row per session, v2.2 = fixture 37/37, v1 = what context_data held', async () => {
    const { ids, claimId, scoredId } = await seed();
    const runAt = new Date();
    const report = await runBackfill(client, { apply: true, nested: true, runAt });

    const totalSessions = (await client.query(`SELECT COUNT(*)::int AS n FROM quiz_session`)).rows[0].n;
    const current = (await client.query(`SELECT COUNT(*)::int AS n FROM quiz_session_interpretation WHERE is_current`)).rows[0].n;
    expect(current).toBe(totalSessions);
    const dup = await client.query(
      `SELECT quiz_session_id FROM quiz_session_interpretation WHERE is_current GROUP BY 1 HAVING COUNT(*) > 1`);
    expect(dup.rows).toHaveLength(0);

    for (const [i, c] of fixture.cases.entries()) {
      const rows = (await client.query(
        `SELECT * FROM quiz_session_interpretation WHERE quiz_session_id = $1 ORDER BY interpretation_version`, [ids[i]])).rows;
      expect(rows.map(r => r.interpretation_version), c.case_id).toEqual(['v1', 'v2.2']);
      const [v1, v2] = rows;
      // v2.2 = the fixture
      expect({
        secondaryArchetype: v2.secondary_archetype, recommendationMode: v2.recommendation_mode,
        pairConfidence: v2.pair_confidence, exploreArchetype: v2.explore_archetype, primaryMargin: v2.primary_margin,
        matchArchetype: v2.match_archetype, intensityLean: v2.intensity_lean,
      }, c.case_id).toEqual(c.expected_v2_2);
      expect(v2).toMatchObject({ is_current: true, computed_by: 'backfill', valid_to: null });
      // v1 = context_data verbatim, closed at the run timestamp (= v2.2's valid_from)
      expect({
        secondaryArchetype: v1.secondary_archetype, recommendationMode: v1.recommendation_mode,
        foodSignalAlignment: v1.food_signal_alignment,
      }, c.case_id).toEqual(c.stored_v1);
      expect(v1).toMatchObject({ is_current: false, computed_by: 'seed', secondary_path: null, pair_confidence: null });
      expect(new Date(v1.valid_to).getTime()).toBe(runAt.getTime());
      expect(new Date(v2.valid_from).getTime()).toBe(runAt.getTime());
    }

    // no answerIds: v1 only, and it is the current row
    const claim = (await client.query(`SELECT * FROM quiz_session_interpretation WHERE quiz_session_id = $1`, [claimId])).rows;
    expect(claim).toHaveLength(1);
    expect(claim[0]).toMatchObject({ interpretation_version: 'v1', is_current: true, valid_to: null, computed_by: 'seed', recommendation_mode: 'primary_only', food_signal_alignment: 'high' });

    // Prompt 4B: a session whose current row is v2.1 is re-interpreted. The v2.1 row is closed at the run timestamp
    // with its content intact (only valid_to / is_current moved); the v2.2 row is current from that same instant.
    // No v1 seed for it.
    const scored = (await client.query(
      `SELECT * FROM quiz_session_interpretation WHERE quiz_session_id = $1 ORDER BY interpretation_version`, [scoredId])).rows;
    expect(scored.map(r => r.interpretation_version)).toEqual(['v2.1', 'v2.2']);
    expect(scored[0]).toMatchObject({ computed_by: 'scored', secondary_archetype: 'Chocolate & Nutty', is_current: false });
    expect(new Date(scored[0].valid_to).getTime()).toBe(runAt.getTime());
    expect(scored[1]).toMatchObject({ computed_by: 'backfill', is_current: true, valid_to: null });
    expect(new Date(scored[1].valid_from).getTime()).toBe(runAt.getTime());
    expect(scored[1].match_archetype).toBe(fixture.cases[0].expected_v2_2.matchArchetype);
    expect(report.closedRows).toBeGreaterThanOrEqual(1);

    expect(report.v2Rows).toBeGreaterThanOrEqual(37);
    expect(compareToFixture(report.plans, fixture).filter(x => x.agree === true)).toHaveLength(37);
  });

  it('is idempotent: a second --apply inserts nothing', async () => {
    await seed();
    await runBackfill(client, { apply: true, nested: true });
    const n1 = (await client.query(`SELECT COUNT(*)::int AS n FROM quiz_session_interpretation`)).rows[0].n;
    const again = await runBackfill(client, { apply: true, nested: true });
    const n2 = (await client.query(`SELECT COUNT(*)::int AS n FROM quiz_session_interpretation`)).rows[0].n;
    expect(again.sessionsProcessed).toBe(0);
    expect(again.v1Rows + again.v2Rows).toBe(0);
    expect(n2).toBe(n1);
  });

  it('a v1-current session and a v2.2-current session are not touched; the data guard holds', async () => {
    const { claimId } = await seed();
    await runBackfill(client, { apply: true, nested: true });
    const before = (await client.query(`SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) AS m FROM quiz_session_interpretation t`)).rows[0].m;
    const report = await runBackfill(client, { apply: true, nested: true });
    const after = (await client.query(`SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) AS m FROM quiz_session_interpretation t`)).rows[0].m;
    expect(report.sessionsProcessed).toBe(0);
    expect(after).toBe(before);
    expect((await client.query(`SELECT interpretation_version, is_current FROM quiz_session_interpretation WHERE quiz_session_id = $1`, [claimId])).rows)
      .toEqual([{ interpretation_version: 'v1', is_current: true }]);
    expect(report.guard!.before).toEqual(report.guard!.after);
  });

  it('the report: one row per re-interpreted session, with the v2.1 and v2.2 sides and the re-askable thread flag', async () => {
    const userId = await makeUser();
    const c = fixture.cases[0];
    const s = await makeSession(userId, { ...c.input, ...c.stored_v1 }, c.input.archetype, new Date(Date.now() - 3_600_000));
    const asOf = new Date(Date.now() - 1_800_000);
    await saveQuizInterpretation(client, s, { ...V21, exploreArchetype: 'Fruity' }, 'scored', { validFrom: asOf });
    // Liam asked the Fruity thread after that v2.1 row became current.
    const uid = (await client.query(`SELECT firebase_uid FROM user_profile WHERE id = $1`, [userId])).rows[0].firebase_uid;
    const sommelierSession = (await client.query(
      `INSERT INTO sommelier_sessions (uid, intent) VALUES ($1, 'MATCHED') RETURNING id`, [uid])).rows[0].id;
    await client.query(
      `INSERT INTO customer_liam_question (user_id, occurred_at, source, source_id, session_id, turn, message_id, kind, archetype_code, question)
       VALUES ($1, now(), 'liam', $2, $3, 1, 'vitest-msg', 'thread', 'fruity', 'Does a brighter cup ever appeal?')`,
      [userId, `vitest-qsi-${Date.now()}`, sommelierSession]
    );
    const report = await runBackfill(client, { apply: false, nested: true });
    const rows = await buildReportRows(client, report.plans.filter(p => p.sessionId === s));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      quiz_session_id: s, shown_archetype: c.input.archetype, v2_1_explore: 'Fruity',
      v2_2_secondary: c.expected_v2_2.secondaryArchetype, v2_2_pair_confidence: c.expected_v2_2.pairConfidence,
      v2_2_match_archetype: c.expected_v2_2.matchArchetype, explore_thread_already_asked: true, changed: true,
    });
    expect(toCsv(rows).split('\n')[0]).toContain('explore_thread_already_asked');
  });

  it('--limit processes only that many sessions', async () => {
    await seed();
    const report = await runBackfill(client, { apply: false, limit: 5, nested: true });
    expect(report.sessionsProcessed).toBe(5);
  });
});

describe('the branch answer on the live path (Prompt 4B, B.2)', () => {
  const ids = async (codes: string[]) => {
    const r = await client.query(`SELECT answer_code, id FROM quiz_answer WHERE answer_code = ANY($1) AND is_current`, [codes]);
    return codes.map(c => r.rows.find(x => x.answer_code === c)!.id as string);
  };
  const BALANCED_RUN = ['v7_q1_b', 'v7_q2_b', 'v7_q3_b', 'v7_q4_b', 'v7_q5_b', 'v7_q6_b'];   // Balanced 9
  const CN_RUN = ['v7_q1_a', 'v7_q2_a', 'v7_q3_a', 'v7_q4_a', 'v7_q5_a', 'v7_q6_a'];         // Chocolate & Nutty 9

  it('accepts an answer of the branch the server-scored winner triggers', async () => {
    const [fruit] = await ids(['v7_branch_bal_fruit']);
    expect(await resolveBranchAnswer(client, { branchAnswerId: fruit, answerIds: await ids(BALANCED_RUN) }))
      .toEqual({ id: fruit, code: 'v7_branch_bal_fruit' });
  });

  it('refuses (null, warning, no throw) another archetype\'s branch, a main-quiz answer, garbage, and no answerIds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [fruit, q1b, earthy] = await ids(['v7_branch_bal_fruit', 'v7_q1_b', 'v7_branch_cn_earthy']);
    expect(await resolveBranchAnswer(client, { branchAnswerId: fruit, answerIds: await ids(CN_RUN) })).toBeNull();
    expect(await resolveBranchAnswer(client, { branchAnswerId: earthy, answerIds: await ids(BALANCED_RUN) })).toBeNull();
    expect(await resolveBranchAnswer(client, { branchAnswerId: q1b, answerIds: await ids(BALANCED_RUN) })).toBeNull();
    expect(await resolveBranchAnswer(client, { branchAnswerId: "x' OR 1=1", answerIds: await ids(BALANCED_RUN) })).toBeNull();
    expect(await resolveBranchAnswer(client, { branchAnswerId: fruit, answerIds: null })).toBeNull();
    expect(await resolveBranchAnswer(client, { branchAnswerId: null, answerIds: await ids(BALANCED_RUN) })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });

  it('the peach answer: shown Balanced, match Fruity, delicate, secondary Balanced; branch_answer_id on the session', async () => {
    const answerIds = await ids(BALANCED_RUN);
    const [fruit] = await ids(['v7_branch_bal_fruit']);
    const branch = await resolveBranchAnswer(client, { branchAnswerId: fruit, answerIds });
    // Same INSERT shape as saveQuizSession (which runs on the pool, outside this rolled-back transaction).
    const s = (await client.query(
      `INSERT INTO quiz_session (user_id, resulting_archetype_id, context_data, branch_answer_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [await makeUser(), await archetypeId('Balanced'), JSON.stringify({ answerIds }), branch!.id])).rows[0].id;
    await recordScoredInterpretation(client, { sessionId: s, answerIds, archetype: 'Balanced', branchedFrom: null, branchAnswerCode: branch!.code });
    const v = (await client.query(
      `SELECT archetype_name, match_archetype, intensity_lean, secondary_archetype, branch_answer_code, interpretation_version
       FROM v_customer_quiz_current WHERE quiz_session_id = $1`, [s])).rows[0];
    expect(v).toEqual({
      archetype_name: 'Balanced', match_archetype: 'Fruity', intensity_lean: 'delicate', secondary_archetype: 'Balanced',
      branch_answer_code: 'v7_branch_bal_fruit', interpretation_version: 'v2.2',
    });
  });
});

describe('PROFILE_AMBIGUOUS reads the current interpretation', () => {
  const base = { quizTie: false, interpretationVersion: 'v2.1', pairConfidence: 'high', exploreArchetype: null, recommendationMode: 'primary_only', foodSignalAlignment: 'high' };
  it('v2.1: fires on low pair confidence', () => expect(isProfileAmbiguous({ ...base, pairConfidence: 'low' })).toBe(true));
  it('v2.1: fires on a loose thread to explore', () => expect(isProfileAmbiguous({ ...base, exploreArchetype: 'Fruity' })).toBe(true));
  it('v2.1: quiet when high confidence and nothing to explore, whatever the legacy fields say', () => {
    expect(isProfileAmbiguous({ ...base, recommendationMode: 'ai_agent', foodSignalAlignment: 'low' })).toBe(false);
  });
  it('v1 / context_data fallback: the old rule (ai_agent or low)', () => {
    expect(isProfileAmbiguous({ ...base, interpretationVersion: 'v1', recommendationMode: 'ai_agent' })).toBe(true);
    expect(isProfileAmbiguous({ ...base, interpretationVersion: null, foodSignalAlignment: 'low' })).toBe(true);
    expect(isProfileAmbiguous({ ...base, interpretationVersion: null })).toBe(false);
  });
  // Liam L2, Part A (2026-09-28) — quizTie is no longer checked on a v2.1+
  // interpretation: an unresolved near-tie is already surfaced as
  // exploreArchetype = 'A / B' (quizScoring.ts), so re-checking quizTie here
  // too would be redundant, not additive. It stays load-bearing on the
  // context_data fallback path, which has no exploreArchetype hint at all.
  it('a quiz tie fires it only on the context_data fallback, not on a v2.1+ interpretation', () => {
    expect(isProfileAmbiguous({ ...base, quizTie: true })).toBe(false);
    expect(isProfileAmbiguous({ ...base, quizTie: true, interpretationVersion: null })).toBe(true);
  });
});

describe('backfill script safety helpers', () => {
  it('defaults to dry-run and to axisandbloom_test', () => {
    expect(parseArgs([])).toEqual({ apply: false, limit: undefined, expectDb: 'axisandbloom_test' });
  });
  it('--apply, --limit and --expect-db parse; --apply with --dry-run is rejected', () => {
    expect(parseArgs(['--apply', '--limit', '10', '--expect-db', 'axisandbloom'])).toEqual({ apply: true, limit: 10, expectDb: 'axisandbloom' });
    expect(() => parseArgs(['--apply', '--dry-run'])).toThrow();
    expect(() => parseArgs(['--limit', 'x'])).toThrow();
    expect(() => parseArgs(['--wat'])).toThrow();
  });
  it('reads the database name from a connection string', () => {
    expect(dbNameFromUrl('postgresql://u:p@127.0.0.1:5433/axisandbloom_test?sslmode=disable')).toBe('axisandbloom_test');
    expect(dbNameFromUrl('postgresql://u:p@127.0.0.1:5433/axisandbloom')).toBe('axisandbloom');
  });
});
