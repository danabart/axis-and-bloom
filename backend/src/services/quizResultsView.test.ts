// Quiz interpretation v2.1, brief 3 — v_subscriber_quiz_results reads the current interpretation row;
// v_quiz_session_interpretation_history; quiz_archetype_canonical(). Runs against axisandbloom_test (guarded by
// vitest.config.ts + src/test/guard.ts). All seeded rows live in a transaction that is ROLLED BACK in afterEach.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PoolClient } from 'pg';
import { db } from '../db/client.js';
import { runBackfill } from './quizInterpretationBackfill.js';

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

// The 28 columns v_subscriber_quiz_results had before brief 3, in order, with the one in-place rename.
const EXISTING_COLUMNS = [
  'email', 'first_name', 'subscribed_at', 'source', 'campaign', 'campaign_attributed_at', 'subscribed',
  'archetype_at_signup', 'food_signal_alignment_at_signup', 'experimental_at_signup', 'primary_archetype',
  'secondary_archetype', 'recommendation_mode', 'food_signal', 'food_signal_alignment', 'experimental', 'decaf',
  'score_chocolate_nutty', 'score_balanced', 'score_fruity', 'score_earthy', 'score_floral', 'score_experimental',
  'scores_json', 'quiz_result_json', 'quiz_completed_at', 'quiz_session_id', 'user_id',
];
const NEW_COLUMNS = [
  'secondary_path', 'pair_confidence', 'explore_archetype', 'explore_reason', 'primary_margin',
  'interpretation_version', 'interpretation_computed_by', 'interpretation_valid_from',
  'secondary_archetype_as_scored', 'recommendation_mode_as_scored', 'food_signal_alignment_as_scored',
  'branched_from', 'food_signal_raw',
];
const HISTORY_COLUMNS = [
  'quiz_session_id', 'user_id', 'completed_at', 'final_archetype', 'branched_from', 'interpretation_version',
  'is_current', 'valid_from', 'valid_to', 'computed_by', 'secondary_archetype', 'secondary_path',
  'recommendation_mode', 'food_signal_alignment', 'pair_confidence', 'explore_archetype', 'explore_reason', 'primary_margin',
];

async function archetypeId(name: string): Promise<string> {
  const r = await client.query(`SELECT id FROM coffee_archetype WHERE name = $1`, [name]);
  if (!r.rows.length) throw new Error(`archetype '${name}' not in the test database`);
  return r.rows[0].id;
}

// One subscriber + user + session per fixture case, completed_at in case order, then the real backfill.
async function seedCrawl(prefix: string) {
  const base = Date.now() - 86_400_000;
  for (const [i, c] of fixture.cases.entries()) {
    const email = `${prefix}-${String(i + 1).padStart(2, '0')}@example.invalid`;
    const user = await client.query(
      `INSERT INTO user_profile (firebase_uid) VALUES ($1) RETURNING id`, [`${prefix}-uid-${i + 1}`]);
    await client.query(
      `INSERT INTO quiz_session (user_id, resulting_archetype_id, context_data, completed_at)
       VALUES ($1, $2, $3, $4)`,
      [user.rows[0].id, await archetypeId(c.input.archetype), JSON.stringify({ ...c.input, ...c.stored_v1 }), new Date(base + i * 1000)]
    );
    await client.query(
      `INSERT INTO newsletter_subscriber (email, user_id, campaign, archetype, confidence) VALUES ($1, $2, 'hoboken-crawl-2026', $3, $4)`,
      [email, user.rows[0].id, i === 0 ? 'Balanced & Sweet' : c.input.archetype, c.stored_v1.foodSignalAlignment]
    );
  }
  await runBackfill(client, { apply: true, nested: true });
}

describe('quiz_archetype_canonical()', () => {
  it('maps the retired names and leaves everything else alone', async () => {
    const r = (await client.query(
      `SELECT quiz_archetype_canonical('Balanced & Sweet') a, quiz_archetype_canonical('Balanced and Sweet') b,
              quiz_archetype_canonical('Fruity & Complex') c, quiz_archetype_canonical('Spicy & Earthy') d,
              quiz_archetype_canonical('Floral') e, quiz_archetype_canonical('Chocolate & Nutty') f,
              quiz_archetype_canonical(NULL) g`)).rows[0];
    expect(r).toEqual({ a: 'Balanced', b: 'Balanced', c: 'Fruity', d: 'Earthy', e: 'Floral', f: 'Chocolate & Nutty', g: null });
  });
  it('is IMMUTABLE', async () => {
    const r = await client.query(`SELECT provolatile FROM pg_proc WHERE proname = 'quiz_archetype_canonical'`);
    expect(r.rows[0].provolatile).toBe('i');
  });
});

describe('view shapes', () => {
  it('v_subscriber_quiz_results keeps every existing column in place; new columns are appended', async () => {
    const r = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'v_subscriber_quiz_results' ORDER BY ordinal_position`);
    const cols = r.rows.map(x => x.column_name);
    expect(cols.slice(0, EXISTING_COLUMNS.length)).toEqual(EXISTING_COLUMNS);
    expect(cols.slice(EXISTING_COLUMNS.length)).toEqual(NEW_COLUMNS);
    expect(cols).not.toContain('confidence_at_signup');
  });
  it('v_quiz_session_interpretation_history has the specified columns', async () => {
    const r = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'v_quiz_session_interpretation_history' ORDER BY ordinal_position`);
    expect(r.rows.map(x => x.column_name)).toEqual(HISTORY_COLUMNS);
  });
});

describe('the 37 crawl subscribers through the views', { timeout: 120_000 }, () => {
  const rowsFor = async (prefix: string) => (await client.query(
    `SELECT * FROM v_subscriber_quiz_results WHERE campaign = 'hoboken-crawl-2026' AND email LIKE $1 ORDER BY quiz_completed_at`,
    [`${prefix}-%`])).rows;

  it('current-row columns = expected_v2_1 and _as_scored columns = stored_v1, 37/37 both ways', async () => {
    await seedCrawl('vitest-qrv');
    const rows = await rowsFor('vitest-qrv');
    expect(rows).toHaveLength(37);
    for (const [i, c] of fixture.cases.entries()) {
      const r = rows[i];
      expect({
        secondaryArchetype: r.secondary_archetype, recommendationMode: r.recommendation_mode,
        pairConfidence: r.pair_confidence, exploreArchetype: r.explore_archetype, primaryMargin: r.primary_margin,
      }, `${c.case_id} current`).toEqual(c.expected_v2_1);
      expect({
        secondaryArchetype: r.secondary_archetype_as_scored, recommendationMode: r.recommendation_mode_as_scored,
        foodSignalAlignment: r.food_signal_alignment_as_scored,
      }, `${c.case_id} as scored`).toEqual(c.stored_v1);
      expect(r.interpretation_version, c.case_id).toBe('v2.1');
      expect(r.interpretation_computed_by, c.case_id).toBe('backfill');
    }
  });

  it('every subscriber with a linked session has an interpretation_version, and no v2.1 row is ai_agent', async () => {
    await seedCrawl('vitest-qrv');
    const missing = await client.query(
      `SELECT COUNT(*)::int AS n FROM v_subscriber_quiz_results WHERE quiz_session_id IS NOT NULL AND interpretation_version IS NULL`);
    expect(missing.rows[0].n).toBe(0);
    const ai = await client.query(
      `SELECT COUNT(*)::int AS n FROM v_subscriber_quiz_results WHERE recommendation_mode = 'ai_agent' AND interpretation_version = 'v2.1'`);
    expect(ai.rows[0].n).toBe(0);
  });

  it('canonicalizes values frozen before the rename, and keeps the raw ones beside them', async () => {
    await seedCrawl('vitest-qrv');
    const first = (await rowsFor('vitest-qrv'))[0];
    expect(first.archetype_at_signup).toBe('Balanced');   // subscriber was written as 'Balanced & Sweet'
    const legacy = (await client.query(
      `SELECT quiz_archetype_canonical(ctx ->> 'secondaryArchetype') AS s FROM (SELECT '{"secondaryArchetype":"Balanced & Sweet"}'::jsonb AS ctx) x`)).rows[0];
    expect(legacy.s).toBe('Balanced');
    const branched = (await rowsFor('vitest-qrv')).find(r => r.branched_from !== null);
    expect(branched, 'a branched crawl case exists').toBeDefined();
    expect(['Chocolate & Nutty', 'Fruity']).toContain(branched!.branched_from);
    expect(branched!.food_signal_raw).toBe(branched!.food_signal);   // current names: raw == canonical
  });

  it('history view: exactly one current row per session, one row per session per version', async () => {
    await seedCrawl('vitest-qrv');
    const dup = await client.query(
      `SELECT quiz_session_id FROM v_quiz_session_interpretation_history WHERE is_current GROUP BY 1 HAVING COUNT(*) > 1`);
    expect(dup.rows).toHaveLength(0);
    const sessions = (await client.query(`SELECT COUNT(*)::int AS n FROM quiz_session`)).rows[0].n;
    const current = (await client.query(`SELECT COUNT(*)::int AS n FROM v_quiz_session_interpretation_history WHERE is_current`)).rows[0].n;
    expect(current).toBe(sessions);
    const perVersion = await client.query(
      `SELECT quiz_session_id, interpretation_version FROM v_quiz_session_interpretation_history GROUP BY 1,2 HAVING COUNT(*) > 1`);
    expect(perVersion.rows).toHaveLength(0);
  });
});
