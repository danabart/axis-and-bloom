// Cupping evidence brief 3, A8 (2026-10-18): the reconciliation views against
// the brief 2 rows on the test DB (refreshed from prod: Joe Coffee s36, Joe
// Bean s37, Utopian s38/s39/s35). Every count is filtered to the three
// roasteries by id; the parameter and stop-word probes run inside a
// rolled-back transaction. Read-only otherwise.
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { db } from './client.js';
import { withRollback } from '../test/withRollback.js';

const JOE_COFFEE = 'f42ad179-9ef4-410a-a92e-464eae1d84ce';
const JOE_BEAN = '19098f5c-99b9-4d7c-90ef-ee33d1e896b7';
const UTOPIAN = 'bbf250d1-e433-4233-a30b-437fe62bcc4a';
const THREE = [JOE_COFFEE, JOE_BEAN, UTOPIAN];
const FLYING_JEWEL = 2891; // placed before brief 2; its assignment predates the basis convention

const EVIDENCE_VIEWS = [
  'v_evidence_dimension', 'v_evidence_descriptor', 'v_evidence_archetype_call', 'v_evidence_archetype',
  'v_evidence_roastery_calibration', 'v_evidence_cupper_calibration', 'v_evidence_coverage', 'v_evidence_unmapped_words',
];

async function rows<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

// Brief 5 (2026-10-21): a test that asserts a session's values names that
// session (36 Joe Coffee, 37 Joe Bean); none reads "the latest session in the
// DB". The views keep each cupper's latest session, so a pinned assertion uses
// a coffee whose rows still come from that session (Blossom, Tiger Stripe:
// cupped only in s37), and the later sessions' effect is tested by coffee id.
const S36 = 36, S37 = 37;
const TIGER_STRIPE = 2914; // one session (s37)
const GEOMETRIC = 2915; // two sessions (s37, then the Balance cupping of 2026-10-21)

describe('v_evidence_dimension (A1)', () => {
  it('Joe Bean Blossom Aroma, session 37: the cuppers disagree (Dana 6, Camila 11)', async () => {
    const r = await rows(
      `SELECT cupper_name, cupper_min::float AS lo, cupper_max::float AS hi, cuppers_agree, flag FROM v_evidence_dimension
        WHERE roaster_id = $1 AND coffee_name = 'Blossom Dark Roast' AND dimension_name = 'Aroma' AND cupper_session_id = $2 ORDER BY cupper_name`, [JOE_BEAN, S37]);
    expect(r.map(x => [x.cupper_name, x.lo, x.hi])).toEqual([['Camila', 11, 11], ['Dana', 6, 6]]);
    expect(r.every(x => x.cuppers_agree === false)).toBe(true);
    expect(r.every(x => ['cuppers_disagree', 'both'].includes(x.flag))).toBe(true);
  });

  it('Joe Bean Tiger Stripe Acidity, session 37: the cuppers agree (Dana 4-6, Camila 3)', async () => {
    const r = await rows(`SELECT cuppers_agree FROM v_evidence_dimension WHERE roaster_id = $1 AND coffee_name = 'Tiger Stripe Espresso' AND dimension_name = 'Acidity' AND cupper_session_id = $2`, [JOE_BEAN, S37]);
    expect(r.length).toBe(2);
    expect(r.every(x => x.cuppers_agree === true)).toBe(true);
  });

  it("Utopian Volo: Camila's word_3 rows convert to 0-5 and the scales name word_3", async () => {
    const r = await rows(`SELECT cupper_scale_code, cupper_min::float AS lo, cupper_max::float AS hi, scale_codes FROM v_evidence_dimension WHERE roaster_id = $1 AND coffee_name = 'Espresso Volo'`, [UTOPIAN]);
    const word = r.filter(x => x.cupper_scale_code === 'word_3');
    expect(word.length).toBeGreaterThan(0);
    for (const x of word) expect([x.lo, x.hi]).toEqual([0, 5]);
    for (const x of r) expect(x.scale_codes).toContain('word_3');
  });

  it('Joe Coffee, session 36: one row per coffee x dimension (one cupper), cuppers_agree null', async () => {
    const [c] = await rows(
      `SELECT count(*)::int AS n, count(DISTINCT (coffee_id, dimension_id))::int AS keys, count(DISTINCT cupper_id)::int AS cuppers,
              count(*) FILTER (WHERE cuppers_agree IS NOT NULL)::int AS agree_set
         FROM v_evidence_dimension WHERE roaster_id = $1 AND cupper_session_id = $2`, [JOE_COFFEE, S36]);
    expect(c.n).toBeGreaterThan(0);
    expect(c.n).toBe(c.keys);
    expect(c.cuppers).toBe(1);
    expect(c.agree_set).toBe(0);
  });

  it('ranks are null where the roaster gave no value or fewer than two coffees have both sides', async () => {
    const [c] = await rows(
      `SELECT count(*) FILTER (WHERE roaster_value_1_5 IS NULL AND (rank_gap IS NOT NULL OR ab_rank_in_lineup IS NOT NULL))::int AS bad_no_value,
              count(*) FILTER (WHERE COALESCE(lineup_n, 0) < 2 AND rank_gap IS NOT NULL)::int AS bad_small
         FROM v_evidence_dimension WHERE roaster_id = ANY($1::uuid[])`, [THREE]);
    expect(c).toEqual({ bad_no_value: 0, bad_small: 0 });
  });
});

describe('v_evidence_descriptor (A2)', () => {
  it('Joe Coffee Benchmark: Sweet, Nutty / Cocoa and Spices named by a cupper', async () => {
    const r = await rows(`SELECT family, named_by_cuppers FROM v_evidence_descriptor WHERE roaster_id = $1 AND coffee_name = 'Benchmark' AND named_by_ab`, [JOE_COFFEE]);
    const families = r.map(x => x.family);
    for (const f of ['Sweet', 'Nutty / Cocoa', 'Spices']) expect(families).toContain(f);
    for (const x of r) expect(x.named_by_cuppers.length).toBeGreaterThan(0);
  });

  it('Joe Coffee Feminista: Fruity from the tier-2 Berry node', async () => {
    const r = await rows(`SELECT named_by_ab FROM v_evidence_descriptor WHERE roaster_id = $1 AND coffee_name LIKE 'Cafè Feminista%' AND family = 'Fruity'`, [JOE_COFFEE]);
    expect(r).toEqual([{ named_by_ab: true }]);
  });

  it('named_by_roaster_form only where a current submitted response exists', async () => {
    const [c] = await rows(
      `SELECT count(*)::int AS bad FROM v_evidence_descriptor d
        WHERE d.roaster_id = ANY($1::uuid[]) AND d.named_by_roaster_form
          AND NOT EXISTS (SELECT 1 FROM v_roastery_portal_coffee_hint h WHERE h.coffee_id = d.coffee_id)`, [THREE]);
    expect(c.bad).toBe(0);
  });

  it('Utopian Union: no family named by the roaster alone (website only, no form); every A&B family is extra unless the website names it', async () => {
    const r = await rows(`SELECT family, named_by_ab, named_by_roaster_form, named_by_roaster_website, hit, miss, extra FROM v_evidence_descriptor WHERE roaster_id = $1 AND coffee_name = 'Union'`, [UTOPIAN]);
    expect(r.length).toBeGreaterThan(0);
    for (const x of r) {
      expect(x.miss).toBe(false);
      if (x.named_by_ab) expect(x.extra).toBe(!x.named_by_roaster_website && !x.named_by_roaster_form);
    }
  });

  it('Joe Bean Tiger Stripe: the website names Fruity (a miss unless a cupper or the form did)', async () => {
    const [x] = await rows(`SELECT named_by_ab, named_by_roaster_form, named_by_roaster_website, miss, hit FROM v_evidence_descriptor WHERE roaster_id = $1 AND coffee_name = 'Tiger Stripe Espresso' AND family = 'Fruity'`, [JOE_BEAN]);
    expect(x.named_by_roaster_website).toBe(true);
    expect(x.miss).toBe(!x.named_by_ab);
    expect(x.hit).toBe(x.named_by_ab);
  });

  it('named_by_roaster_website is set for coffees of all three roasteries', async () => {
    const r = await rows(`SELECT DISTINCT roaster_id FROM v_evidence_descriptor WHERE roaster_id = ANY($1::uuid[]) AND named_by_roaster_website`, [THREE]);
    expect(r.length).toBe(3);
  });
});

describe('v_evidence_archetype (A3)', () => {
  it('Blossom, session 37: Dana earthy, Camila no call; catalog earthy low; the flag follows the form proposal', async () => {
    const calls = await rows(
      `SELECT c.cupper_name, c.archetype_call FROM v_evidence_archetype_call c JOIN v_coffee vc ON vc.id = c.coffee_id
        WHERE vc.roaster_id = $1 AND vc.name = 'Blossom Dark Roast' AND c.session_id = $2 ORDER BY c.cupper_name`, [JOE_BEAN, S37]);
    expect(calls).toEqual([{ cupper_name: 'Camila', archetype_call: null }, { cupper_name: 'Dana', archetype_call: 'earthy' }]);
    const [a] = await rows(`SELECT cupper_calls, catalog_archetype, catalog_confidence, roaster_form_proposal, flag FROM v_evidence_archetype WHERE roaster_id = $1 AND coffee_name = 'Blossom Dark Roast'`, [JOE_BEAN]);
    expect(a.cupper_calls).toEqual({ Dana: 'earthy', Camila: null });
    expect([a.catalog_archetype, a.catalog_confidence]).toEqual(['earthy', 'low']);
    expect(a.flag).toBe(a.roaster_form_proposal && a.roaster_form_proposal !== 'earthy' ? 'roaster_disagrees' : 'none');
  });

  it('Union: no call from either cupper, no merged call, catalog balanced_sweet low', async () => {
    const [a] = await rows(`SELECT n_cuppers_called::int, merged_call, catalog_archetype, catalog_confidence FROM v_evidence_archetype WHERE roaster_id = $1 AND coffee_name = 'Union'`, [UTOPIAN]);
    expect(a).toEqual({ n_cuppers_called: 0, merged_call: null, catalog_archetype: 'balanced_sweet', catalog_confidence: 'low' });
  });

  it('La Familia: Dana balanced_sweet, catalog floral, basis present', async () => {
    const [a] = await rows(`SELECT cupper_calls, catalog_archetype, basis FROM v_evidence_archetype WHERE roaster_id = $1 AND coffee_name = 'Colombia La Familia Guarnizo'`, [JOE_COFFEE]);
    expect(a.cupper_calls).toEqual({ Dana: 'balanced_sweet' });
    expect(a.catalog_archetype).toBe('floral');
    expect(a.basis).toMatch(/^basis: /);
  });

  it('every brief 2 coffee has a basis', async () => {
    const r = await rows(
      `SELECT coffee_name, flag FROM v_evidence_archetype
        WHERE roaster_id = ANY($1::uuid[]) AND coffee_id <> $2`, [THREE, FLYING_JEWEL]);
    expect(r.length).toBe(21);
    expect(r.filter(x => x.flag === 'no_basis')).toEqual([]);
  });

  it('evidence newer than the decision: false for a coffee cupped once (Tiger Stripe), true for one cupped again after it (Geometric)', async () => {
    const r = await rows(
      `SELECT coffee_id, evidence_newer_than_decision FROM v_evidence_archetype WHERE coffee_id = ANY($1::int[]) ORDER BY coffee_id`, [[TIGER_STRIPE, GEOMETRIC]]);
    expect(r).toEqual([{ coffee_id: TIGER_STRIPE, evidence_newer_than_decision: false }, { coffee_id: GEOMETRIC, evidence_newer_than_decision: true }]);
  });
});

describe('v_evidence_roastery_calibration (A4)', () => {
  it("Joe Bean: n below param('spearman_min_n') everywhere, so inverted is null and the note says so", async () => {
    const r = await rows(`SELECT n, inverted, note, rank_corr FROM v_evidence_roastery_calibration WHERE roaster_id = $1`, [JOE_BEAN]);
    expect(r.length).toBeGreaterThan(0);
    const [{ min_n }] = await rows<{ min_n: string }>(`SELECT param('spearman_min_n') AS min_n`);
    for (const x of r) {
      expect(Number(x.n)).toBeLessThan(Number(min_n));
      expect(x.inverted).toBeNull();
      expect(x.note).toBe('n too small');
    }
  });

  it("rank_corr is null below param('rank_corr_min_n')", async () => {
    const [{ min_n }] = await rows<{ min_n: string }>(`SELECT param('rank_corr_min_n') AS min_n`);
    const r = await rows(`SELECT n, rank_corr FROM v_evidence_roastery_calibration WHERE roaster_id = ANY($1::uuid[]) AND n < $2`, [THREE, Number(min_n)]);
    for (const x of r) expect(x.rank_corr).toBeNull();
    const computed = await rows(`SELECT 1 FROM v_evidence_roastery_calibration WHERE roaster_id = $1 AND rank_corr IS NOT NULL`, [JOE_BEAN]);
    expect(computed.length).toBeGreaterThan(0);
  });

  it("superseding spearman_min_n to 3 changes the output with no view change", async () => {
    await withRollback(async ({ client }) => {
      await client.query(`UPDATE evidence_parameter SET superseded_at = now() WHERE key = 'spearman_min_n' AND superseded_at IS NULL`);
      await client.query(`INSERT INTO evidence_parameter (key, value, note) VALUES ('spearman_min_n', 3, 'vitest probe, rolled back')`);
      const r = (await client.query(`SELECT inverted, note FROM v_evidence_roastery_calibration WHERE roaster_id = $1 AND rank_corr IS NOT NULL`, [JOE_BEAN])).rows;
      expect(r.length).toBeGreaterThan(0);
      for (const x of r) {
        expect(x.note).toBeNull();
        expect(typeof x.inverted).toBe('boolean');
      }
    });
  });

  it('Joe Coffee: the archetype crosstab lines our merged calls up against their form proposals', async () => {
    const [x] = await rows(`SELECT archetype_crosstab FROM v_evidence_roastery_calibration WHERE roaster_id = $1 LIMIT 1`, [JOE_COFFEE]);
    expect(Object.keys(x.archetype_crosstab).length).toBeGreaterThan(0);
  });
});

describe('v_evidence_cupper_calibration (A5)', () => {
  it('Dana has rows blind (Joe Bean) and not blind (Joe Coffee, Utopian C)', async () => {
    const r = await rows(`SELECT DISTINCT is_blind FROM v_evidence_cupper_calibration WHERE cupper_name = 'Dana' ORDER BY 1`);
    expect(r.map(x => x.is_blind)).toEqual([false, true]);
  });

  it('only ab_0_15 rows count toward n (word_3 and grid_0_5 are left out)', async () => {
    const [c] = await rows(
      `SELECT (SELECT COALESCE(sum(n), 0)::int FROM v_evidence_cupper_calibration WHERE cupper_name = 'Camila' AND dimension_name = 'Sweetness') AS view_n,
              (SELECT count(*)::int FROM v_cupping_scores_readable r WHERE r.cupper_name = 'Camila' AND r.dimension = 'Sweetness'
                 AND NOT r.is_merged AND r.scale_code = 'ab_0_15' AND r.value_min IS NOT NULL) AS ab_rows`);
    expect(c.view_n).toBe(c.ab_rows);
  });

  it("against the roaster: mean absolute rank gap (never negative) and rank correlation null below param('rank_corr_min_n')", async () => {
    const [{ min_n }] = await rows<{ min_n: string }>(`SELECT param('rank_corr_min_n') AS min_n`);
    const r = await rows(`SELECT n_with_roaster, mean_abs_gap_to_roaster_rank, rank_corr_to_roaster FROM v_evidence_cupper_calibration WHERE cupper_name IN ('Dana', 'Camila')`);
    expect(r.some(x => Number(x.n_with_roaster) > 0 && x.mean_abs_gap_to_roaster_rank !== null && Number(x.mean_abs_gap_to_roaster_rank) > 0)).toBe(true);
    for (const x of r) {
      if (x.mean_abs_gap_to_roaster_rank !== null) expect(Number(x.mean_abs_gap_to_roaster_rank)).toBeGreaterThanOrEqual(0);
      if (Number(x.n_with_roaster) < Number(min_n)) expect(x.rank_corr_to_roaster).toBeNull();
    }
    const cols = (await rows<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'v_evidence_cupper_calibration'`)).map(c => c.column_name);
    expect(cols).not.toContain('mean_signed_gap_to_roaster_rank');
  });

  it('no control sample yet for the A&B cuppers', async () => {
    const r = await rows(`SELECT n_control FROM v_evidence_cupper_calibration WHERE cupper_name IN ('Dana', 'Camila')`);
    expect(r.length).toBeGreaterThan(0);
    for (const x of r) expect(Number(x.n_control)).toBe(0);
  });

  it('repeat cupping: Tiger Stripe has one session, Geometric two, and a repeat gives the cuppers a repeatability', async () => {
    const r = await rows(`SELECT coffee_id, n_sessions::int FROM v_evidence_coverage WHERE coffee_id = ANY($1::int[]) ORDER BY coffee_id`, [[TIGER_STRIPE, GEOMETRIC]]);
    expect(r).toEqual([{ coffee_id: TIGER_STRIPE, n_sessions: 1 }, { coffee_id: GEOMETRIC, n_sessions: 2 }]);
    const rep = await rows(`SELECT 1 FROM v_evidence_cupper_calibration WHERE cupper_name IN ('Dana', 'Camila') AND n_repeat > 0 AND repeatability IS NOT NULL`);
    expect(rep.length).toBeGreaterThan(0);
  });
});

describe('v_evidence_coverage (A6)', () => {
  it('every brief 2 coffee has at least two sources; the four placed Joe Coffee coffees are placed', async () => {
    const r = await rows(`SELECT coffee_id, coffee_name, n_sources, is_placed FROM v_evidence_coverage WHERE roaster_id = ANY($1::uuid[])`, [THREE]);
    expect(r.length).toBe(22);
    expect(r.filter(x => x.n_sources < 2)).toEqual([]);
    const placed = r.filter(x => x.is_placed).map(x => x.coffee_name).sort();
    expect(placed).toEqual(expect.arrayContaining(['Benchmark', 'Cafè Feminista: Montze Olvera', 'Colombia La Familia Guarnizo', 'The Village']));
  });

  it('Flying Jewel shows its cupping and its website remarks', async () => {
    const [x] = await rows(`SELECT n_cuppers, has_merged, has_remark_website FROM v_evidence_coverage WHERE coffee_id = $1`, [FLYING_JEWEL]);
    expect(Number(x.n_cuppers)).toBeGreaterThan(0);
    expect(x.has_merged).toBe(true);
    expect(x.has_remark_website).toBe(true);
  });
});

describe('v_evidence_unmapped_words (A7)', () => {
  it('lists the unmapped words and leaves out mapped words and stop words', async () => {
    const words = (await rows<{ word: string }>(`SELECT DISTINCT word FROM v_evidence_unmapped_words`)).map(x => x.word);
    for (const w of ['white floral', 'orange blossom', 'ube halo halo', 'happy', 'bbq chips']) expect(words).toContain(w);
    // honeycomb and mango puree are mapped (brief 2 loader); berries maps to Berry (cupper); sweet is a stop word
    for (const w of ['honeycomb', 'mango puree', 'berries', 'sweet']) expect(words).not.toContain(w);
    expect(words.filter(w => w.startsWith('~'))).toEqual([]);
  });

  it('a new stop word removes the word with no view change', async () => {
    await withRollback(async ({ client }) => {
      await client.query(`INSERT INTO evidence_stop_word (word, note) VALUES ('happy', 'vitest probe, rolled back')`);
      const r = (await client.query(`SELECT 1 FROM v_evidence_unmapped_words WHERE word = 'happy'`)).rows;
      expect(r).toEqual([]);
    });
  });
});

describe('every evidence view', () => {
  it('is readable by reporting_ro', async () => {
    for (const v of EVIDENCE_VIEWS) {
      const [x] = await rows<{ ok: boolean }>(`SELECT has_table_privilege('reporting_ro', $1, 'SELECT') AS ok`, [v]);
      expect(x.ok, v).toBe(true);
    }
  });

  it('reads no cupping_*, roastery_portal_*, roastery_remark or customer_feedback_* base table', async () => {
    const r = await rows<{ view: string; base: string }>(
      `SELECT DISTINCT c.relname AS view, t.relname AS base
         FROM pg_class c
         JOIN pg_rewrite rw ON rw.ev_class = c.oid
         JOIN pg_depend dp ON dp.objid = rw.oid AND dp.classid = 'pg_rewrite'::regclass AND dp.refclassid = 'pg_class'::regclass
         JOIN pg_class t ON t.oid = dp.refobjid AND t.relkind = 'r'
        WHERE c.relname = ANY($1::text[])
          AND (t.relname LIKE 'cupping\\_%' OR t.relname LIKE 'roastery\\_portal\\_%' OR t.relname = 'roastery_remark' OR t.relname LIKE 'customer\\_feedback\\_%')`,
      [EVIDENCE_VIEWS]);
    expect(r).toEqual([]);
  });

  it('names no cupper, holds no threshold literal and never matches wheel_category text', async () => {
    const cuppers = (await rows<{ name: string }>(`SELECT name FROM cupper`)).map(x => x.name.toLowerCase());
    for (const v of EVIDENCE_VIEWS) {
      const [{ def }] = await rows<{ def: string }>(`SELECT pg_get_viewdef($1::regclass, true) AS def`, [v]);
      const lower = def.toLowerCase();
      for (const name of cuppers) expect(lower.includes(`'${name}'`), `${v} names ${name}`).toBe(false);
      for (const literal of [/>=\s*5\b/, />\s*2\b/, /-0\.5/]) expect(literal.test(def), `${v} ${literal}`).toBe(false);
      expect(/wheel_(sub)?category/.test(lower), `${v} wheel_category`).toBe(false);
    }
    const columns = (await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = ANY($1::text[])`, [EVIDENCE_VIEWS])).map(x => x.column_name.toLowerCase());
    for (const name of cuppers) expect(columns.filter(c => c.includes(name)), `column named after ${name}`).toEqual([]);
  });
});
