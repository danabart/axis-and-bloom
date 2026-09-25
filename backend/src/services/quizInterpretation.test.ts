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
  saveQuizInterpretation, recordScoredInterpretation, getLatestQuizResult, resolveInterpretation,
} from './quizSession.js';
import { isProfileAmbiguous } from './sommelierEvaluator.js';
import {
  runBackfill, compareToFixture, parseArgs, dbNameFromUrl,
} from './quizInterpretationBackfill.js';

interface Case {
  case_id: string;
  input: { answerIds: string[]; scores: Record<string, number>; archetype: string; foodSignal: string | null; experimental: boolean; branchedFrom: string | null };
  stored_v1: { secondaryArchetype: string | null; recommendationMode: string; foodSignalAlignment: string };
  expected_v2_1: { secondaryArchetype: string | null; recommendationMode: string; pairConfidence: string; exploreArchetype: string | null; primaryMargin: number };
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

  it('writes one current scored v2.1 row equal to the fixture, ignoring client-sent interpretation fields', async () => {
    const s = await makeSession(await makeUser(), {
      ...c.input, ...c.stored_v1, pairConfidence: 'low', exploreArchetype: 'Earthy',   // stale/wrong client fields
    }, c.input.archetype, new Date());
    const interp = await recordScoredInterpretation(client, {
      sessionId: s, answerIds: c.input.answerIds, archetype: c.input.archetype, branchedFrom: c.input.branchedFrom,
    });
    expect(interp).not.toBeNull();
    const rows = (await client.query(`SELECT * FROM quiz_session_interpretation WHERE quiz_session_id = $1`, [s])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      interpretation_version: 'v2.1', is_current: true, computed_by: 'scored', valid_to: null,
      secondary_archetype: c.expected_v2_1.secondaryArchetype,
      recommendation_mode: c.expected_v2_1.recommendationMode,
      pair_confidence: c.expected_v2_1.pairConfidence,
      explore_archetype: c.expected_v2_1.exploreArchetype,
      primary_margin: c.expected_v2_1.primaryMargin,
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
      source: 'table', interpretationVersion: 'v2.1',
      secondaryArchetype: c.expected_v2_1.secondaryArchetype,
      recommendationMode: c.expected_v2_1.recommendationMode,
      pairConfidence: c.expected_v2_1.pairConfidence,
      exploreArchetype: c.expected_v2_1.exploreArchetype,
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

  it('--apply: one current row per session, v2.1 = fixture 37/37, v1 = what context_data held', async () => {
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
      expect(rows.map(r => r.interpretation_version), c.case_id).toEqual(['v1', 'v2.1']);
      const [v1, v2] = rows;
      // v2.1 = the fixture
      expect({
        secondaryArchetype: v2.secondary_archetype, recommendationMode: v2.recommendation_mode,
        pairConfidence: v2.pair_confidence, exploreArchetype: v2.explore_archetype, primaryMargin: v2.primary_margin,
      }, c.case_id).toEqual(c.expected_v2_1);
      expect(v2).toMatchObject({ is_current: true, computed_by: 'backfill', valid_to: null });
      // v1 = context_data verbatim, closed at the run timestamp (= v2.1's valid_from)
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

    // a session that already holds a scored v2.1 row is skipped entirely: no v1 seed, no second v2.1
    const scored = (await client.query(`SELECT * FROM quiz_session_interpretation WHERE quiz_session_id = $1`, [scoredId])).rows;
    expect(scored).toHaveLength(1);
    expect(scored[0]).toMatchObject({ interpretation_version: 'v2.1', computed_by: 'scored', secondary_archetype: 'Chocolate & Nutty' });

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

  it('--limit processes only that many sessions', async () => {
    await seed();
    const report = await runBackfill(client, { apply: false, limit: 5, nested: true });
    expect(report.sessionsProcessed).toBe(5);
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
  it('a quiz tie fires it on any version', () => {
    expect(isProfileAmbiguous({ ...base, quizTie: true })).toBe(true);
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
