// Ella's Bloom Map 1 (2026-11-10), Part D — the map rules on fixtures.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_1_SCHEMA_RULES_PREVIEW.md
//
// Every fixture lives in a rolled-back transaction (withRollback): cupping
// rows and map versions are immutable once committed. Inside it the real
// catalog coffees are set inactive, so the map holds only the fixture's
// coffees and every rank is the fixture's own. Expected numbers are read
// from the current parameter rows, never typed from the brief.
import 'dotenv/config';
import { describe, it, expect, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { db } from '../db/client.js';
import { withRollback, type RollbackTx } from '../test/withRollback.js';
import { freeSlots } from '../test/freeSlots.js';
import { setParameterInTx } from './evidenceParameterService.js';
import { setLeanInTx } from './catalogService.js';
import { cutVersionInTx, activateVersionInTx } from './dialPlacementService.js';
import { graphCheck, computeGraphCheck } from './dialReads.js';

// fixtures are many round trips to the Cloud SQL test DB
vi.setConfig({ testTimeout: 240_000 });
afterAll(async () => { await db.end(); });

type Dim = 'acidity' | 'bitterness' | 'body' | 'sweetness';
interface CoffeeSpec {
  tag: string;
  archetype: string;
  values: Partial<Record<Dim, number>>;
  sessions?: number;            // merged sessions (default 1)
  cuppers?: string[];           // scale per cupper in every session (default one ab_0_15 cupper)
  sampleNote?: string | null;   // on every sample
  sampleNotes?: Array<string | null>; // per session, overrides sampleNote
  sellable?: boolean;           // default true
  portalWords?: string;         // one portal note, as the roasters typed it
}

const param = async (c: pg.PoolClient, key: string) => Number((await c.query<{ v: string }>(`SELECT param($1) AS v`, [key])).rows[0].v);

async function isolate(c: pg.PoolClient) {
  await c.query(`UPDATE coffees SET is_active = false WHERE is_active`);
  const roasterId = (await c.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Zzz Map Roastery', true) RETURNING id`)).rows[0].id;
  return roasterId;
}

let seq = 0;
async function coffee(c: pg.PoolClient, roasterId: string, spec: CoffeeSpec): Promise<number> {
  const coffeeId = (await c.query<{ id: number }>(
    `INSERT INTO coffees (name, roaster_id, is_active) VALUES ($1, $2, true) RETURNING id`, [`Zzz Map ${spec.tag}`, roasterId])).rows[0].id;
  await c.query(`INSERT INTO coffee_archetype_assignment (coffee_id, archetype, confidence, source) VALUES ($1, $2, 'medium', 'manual')`,
    [coffeeId, spec.archetype]);
  const dims = (await c.query<{ code: Dim; dimension_id: number }>(`SELECT code, dimension_id FROM dial_reading`)).rows;
  const cupperScales = spec.cuppers ?? ['ab_0_15'];
  const cupperIds: number[] = [];
  for (let i = 0; i < cupperScales.length; i++) {
    cupperIds.push((await c.query<{ id: number }>(`INSERT INTO cupper (name) VALUES ($1) RETURNING id`, [`Zzz Map Cupper ${spec.tag} ${i}`])).rows[0].id);
  }
  for (let s = 0; s < (spec.sessions ?? 1); s++) {
    const sessionId = (await c.query<{ id: number }>(
      `INSERT INTO cupping_sessions (session_date, record_source) VALUES ($1, 'test:dialMap') RETURNING id`,
      [`2026-0${1 + (s % 9)}-1${seq++ % 9}`])).rows[0].id;
    const scId = (await c.query<{ id: number }>(
      `INSERT INTO cupping_session_coffees (session_id, coffee_id, sample_note) VALUES ($1, $2, $3) RETURNING id`,
      [sessionId, coffeeId, spec.sampleNotes ? spec.sampleNotes[s] ?? null : spec.sampleNote ?? null])).rows[0].id;
    for (let i = 0; i < cupperIds.length; i++) {
      await c.query(`INSERT INTO cupping_scores (session_coffee_id, cupper_id, is_merged, scale_code) VALUES ($1, $2, false, $3)`,
        [scId, cupperIds[i], cupperScales[i]]);
    }
    const merged = (await c.query<{ id: number }>(
      `INSERT INTO cupping_scores (session_coffee_id, is_merged, scale_code, merge_rule) VALUES ($1, true, 'ab_0_15', 'union_v1') RETURNING id`,
      [scId])).rows[0].id;
    for (const d of dims) {
      const v = spec.values[d.code];
      if (v === undefined) continue;
      await c.query(`INSERT INTO cupping_score_values (cupping_score_id, dimension_id, value_min, value_max, raw_value) VALUES ($1, $2, $3, $3, $4)`,
        [merged, d.dimension_id, v, String(v)]);
    }
  }
  if (spec.sellable ?? true) {
    const [slot] = await freeSlots({}, c);
    await c.query(`INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role) VALUES ($1, $2, 'home')`, [slot.id, coffeeId]);
    await c.query(`INSERT INTO coffee_slot_price (slot_id, weight_oz, retail_price_cents) VALUES ($1, 12, 2900)`, [slot.id]);
    await c.query(`INSERT INTO coffee_sku (coffee_id, roaster_id, blend_name, weight_oz, is_active) VALUES ($1, $2, $3, 12, true)`,
      [coffeeId, roasterId, `Zzz Map ${spec.tag}`]);
  }
  if (spec.portalWords) {
    const pc = (await c.query<{ id: string }>(
      `INSERT INTO roastery_portal_coffee (roaster_id, name, coffee_id, added_by) VALUES ($1, $2, $3, 'admin') RETURNING id`,
      [roasterId, `Zzz Map ${spec.tag}`, coffeeId])).rows[0].id;
    const resp = (await c.query<{ id: string }>(
      `INSERT INTO roastery_portal_response (portal_coffee_id, version, status) VALUES ($1, 1, 'draft') RETURNING id`, [pc])).rows[0].id;
    await c.query(`INSERT INTO roastery_portal_response_note (response_id, rank, roaster_words) VALUES ($1, 1, $2)`, [resp, spec.portalWords]);
    await c.query(`UPDATE roastery_portal_response SET status = 'submitted', submitted_at = now() WHERE id = $1`, [resp]);
  }
  return coffeeId;
}

const preview = async (c: pg.PoolClient, id: number) =>
  (await c.query(`SELECT * FROM v_dial_placement_preview WHERE coffee_id = $1`, [id])).rows[0];

describe('ring banding (D1)', () => {
  it('values at, under and over each cut land in the right ring; the center is 0; no ruler value is not placeable', async () => {
    await withRollback(async ({ client: c }) => {
      const r = await isolate(c);
      const rc1 = await param(c, 'dial_ring_cut_1');
      const rc2 = await param(c, 'dial_ring_cut_2');
      const cases: Array<[number, number]> = [[rc1 - 0.01, 1], [rc1, 2], [rc1 + 0.01, 2], [rc2 - 0.01, 2], [rc2, 3], [rc2 + 0.01, 3]];
      for (const [i, [v, ring]] of cases.entries()) {
        const id = await coffee(c, r, { tag: `band${i}`, archetype: 'chocolate_nutty', values: { bitterness: v, sweetness: 5 } });
        const p = await preview(c, id);
        expect(p.is_placeable).toBe(true);
        expect(p.ring).toBe(ring);
      }
      const center = await coffee(c, r, { tag: 'center', archetype: 'balanced_sweet', values: { bitterness: rc2 + 2, acidity: 1, sweetness: 5 } });
      const pc = await preview(c, center);
      expect(pc.ring).toBe(0);
      expect(pc.flags).toContain('center_ruler_ring_2_plus');
      const noRuler = await coffee(c, r, { tag: 'noruler', archetype: 'fruity', values: { bitterness: 3, sweetness: 5 } });
      const pn = await preview(c, noRuler);
      expect(pn.is_placeable).toBe(false);
      expect(pn.ring).toBeNull();
      expect(pn.flags).toContain('no_ruler_value');
      const near = await coffee(c, r, { tag: 'near', archetype: 'chocolate_nutty', values: { bitterness: rc1 - 0.1, sweetness: 5 } });
      expect((await preview(c, near)).flags).toContain('ruler_near_cut');
    });
  });
});

describe('lean (D2)', () => {
  it('no decision: middle with a flag; a decision beats the suggestion; setLean twice supersedes once; the stored suggestion is the preview\'s', async () => {
    await withRollback(async ({ client: c }) => {
      const r = await isolate(c);
      const base = await param(c, 'dial_suggest_body_cut_base');
      // the center reads the chocolate seam on side A: full body pulls it there
      const id = await coffee(c, r, { tag: 'lean', archetype: 'balanced_sweet', values: { acidity: 1, bitterness: 1, body: base + 1, sweetness: 5 } });
      const before = await preview(c, id);
      expect(before.lane_code).toBe('middle');
      expect(before.decided_lane_code).toBeNull();
      expect(before.flags).toContain('no_lean_decision');
      expect(before.suggested_lane_code).toBe('side_a');

      const first = await setLeanInTx(c, id, 'side_b', { notes: 'test', decidedBy: 'vitest' });
      expect(first.unchanged).toBe(false);
      expect(first.after.suggested_lane_id).toBe(before.suggested_lane_id);
      expect(first.after.suggested_scores).toEqual(before.suggested_scores);
      const after = await preview(c, id);
      expect(after.lane_code).toBe('side_b');
      expect(after.flags).toContain('suggestion_differs');
      expect(after.flags).not.toContain('no_lean_decision');

      const again = await setLeanInTx(c, id, 'side_b', { notes: 'test', decidedBy: 'vitest' });
      expect(again.unchanged).toBe(true);
      await setLeanInTx(c, id, 'side_a', { notes: 'changed', decidedBy: 'vitest' });
      const rows = (await c.query(`SELECT superseded_at FROM coffee_lean_assignment WHERE coffee_id = $1`, [id])).rows;
      expect(rows.length).toBe(2);
      expect(rows.filter(x => x.superseded_at === null).length).toBe(1);
    });
  });

  it('portal words are read by split, in the roaster\'s order (Dana 2026-11-10, decision 1)', async () => {
    await withRollback(async ({ client: c }) => {
      const r = await isolate(c);
      const id = await coffee(c, r, { tag: 'words', archetype: 'chocolate_nutty', values: { bitterness: 3 }, portalWords: 'Chocolate, Pear, Milk Duds' });
      const i = (await c.query(`SELECT * FROM v_dial_placement_input WHERE coffee_id = $1`, [id])).rows[0];
      expect(i.portal_words.map((w: any) => w.word)).toEqual(['Chocolate', 'Pear', 'Milk Duds']);
      expect(i.portal_family_pos_named).toEqual({ 'Nutty / Cocoa': 1, Fruity: 2 });
      expect(i.unmapped_portal_words).toEqual(['Milk Duds']);
      // C&N side A is the fruit seam: a later fruit word reads dial_suggest_word_later
      const later = await param(c, 'dial_suggest_word_later');
      const p = await preview(c, id);
      expect(Number(p.suggested_scores.side_a.words)).toBe(later);
    });
  });
});

describe('grade (D3)', () => {
  it('A, B, C, D from sessions and cuppers; the provisional pattern; a non-ab_0_15 cupper counts half', async () => {
    await withRollback(async ({ client: c }) => {
      const r = await isolate(c);
      const [sa, ca, sb] = [await param(c, 'dial_grade_sessions_for_a'), await param(c, 'dial_grade_cuppers_for_a'), await param(c, 'dial_grade_sessions_for_b')];
      const v = { acidity: 5, sweetness: 5 };
      const ab = (n: number) => Array(Math.ceil(n)).fill('ab_0_15');
      const a = await coffee(c, r, { tag: 'gA', archetype: 'fruity', values: v, sessions: sa, cuppers: ab(ca) });
      const b = await coffee(c, r, { tag: 'gB', archetype: 'fruity', values: v, sessions: sb, cuppers: ['ab_0_15'] });
      const cc = await coffee(c, r, { tag: 'gC', archetype: 'fruity', values: v, sessions: 1, cuppers: ['ab_0_15'] });
      const half = await coffee(c, r, { tag: 'gHalf', archetype: 'fruity', values: v, sessions: 1, cuppers: ['ab_0_15', 'grid_0_5'] });
      const d = await coffee(c, r, { tag: 'gD', archetype: 'fruity', values: v, sessions: sa, cuppers: ab(ca), sampleNote: 'Last cup of the day' });
      expect((await preview(c, a)).grade_code).toBe('A');
      expect((await preview(c, b)).grade_code).toBe('B');
      expect((await preview(c, cc)).grade_code).toBe('C');
      const ph = await preview(c, half);
      expect(Number(ph.n_cuppers)).toBe(1.5);
      expect(ph.grade_code).toBe(1.5 >= await param(c, 'dial_grade_cuppers_for_b') ? 'B' : 'C');
      const pd = await preview(c, d);
      expect(pd.grade_code).toBe('D');
      expect(pd.flags).toContain('provisional');
      expect(pd.is_placeable).toBe(true); // its pooled values still place it
    });
  });

  it('a provisional session followed by a clean one gives the grade of the clean rows (Dana 2026-11-10, deviation 8)', async () => {
    await withRollback(async ({ client: c }) => {
      const r = await isolate(c);
      const v = { acidity: 5, sweetness: 5 };
      const two = ['ab_0_15', 'ab_0_15'];
      const mixed = await coffee(c, r, { tag: 'gMixed', archetype: 'fruity', values: v, sessions: 2, cuppers: two,
        sampleNotes: ['last cup of the day; provisional', null] });
      const clean = await coffee(c, r, { tag: 'gClean', archetype: 'fruity', values: v, sessions: 1, cuppers: two });
      const pm = await preview(c, mixed);
      const pc = await preview(c, clean);
      expect(pm.n_sessions).toBe(1);
      expect(Number(pm.n_cuppers)).toBe(2);
      expect(pm.grade_code).toBe(pc.grade_code);
      expect(pm.grade_code).not.toBe('D');
      expect(pm.flags).toContain('provisional');
    });
  });
});

/** Five sellable placements: center (lean side_a = chocolate_nutty), C&N ring 1 (lean side_a = fruity) and ring 3, fruity ring 1, floral ring 1 (no Body). */
async function five(tx: RollbackTx) {
  const c = tx.client;
  const r = await isolate(c);
  const rc1 = await param(c, 'dial_ring_cut_1');
  const rc2 = await param(c, 'dial_ring_cut_2');
  const two = ['ab_0_15', 'ab_0_15'];
  const ids = {
    center: await coffee(c, r, { tag: 'center', archetype: 'balanced_sweet', values: { acidity: 1, bitterness: 1, body: 5, sweetness: 6 }, cuppers: two }),
    cn1: await coffee(c, r, { tag: 'cn1', archetype: 'chocolate_nutty', values: { bitterness: rc1 - 1, body: 6, sweetness: 5 }, cuppers: two }),
    cn3: await coffee(c, r, { tag: 'cn3', archetype: 'chocolate_nutty', values: { bitterness: rc2 + 1, body: 8, sweetness: 3 }, cuppers: two }),
    fr1: await coffee(c, r, { tag: 'fr1', archetype: 'fruity', values: { acidity: rc1 - 1, body: 5, sweetness: 7 }, cuppers: two }),
    fl1: await coffee(c, r, { tag: 'fl1', archetype: 'floral', values: { acidity: rc1 - 1, sweetness: 7 }, cuppers: two }),
  };
  await setLeanInTx(c, ids.center, 'side_a', { decidedBy: 'vitest' });
  await setLeanInTx(c, ids.cn1, 'side_a', { decidedBy: 'vitest' });
  return ids;
}

describe('edges (D4)', () => {
  it('the Rev 3 section 4 relations both ways, distance over shared readings, adjacency rank', async () => {
    await withRollback(async (tx) => {
      const c = tx.client;
      const ids = await five(tx);
      const edges = (await c.query(`SELECT * FROM v_dial_edge_preview`)).rows;
      const e = (a: number, b: number) => edges.find(x => x.from_coffee_id === a && x.to_coffee_id === b);
      expect(edges.length).toBe(20);
      expect(e(ids.cn1, ids.cn3).relation).toBe('bolder');
      expect(e(ids.cn3, ids.cn1).relation).toBe('gentler');
      expect(e(ids.center, ids.cn1).relation).toBe('bolder');      // the wedge on the center's lean side
      expect(e(ids.center, ids.fr1).relation).toBe('different');
      expect(e(ids.center, ids.fr1).adjacency_rank).toBe(1);        // from the center every wedge is 1
      expect(e(ids.cn1, ids.center).relation).toBe('gentler');
      expect(e(ids.fl1, ids.center).relation).toBe('gentler');
      expect(e(ids.cn1, ids.fr1).relation).toBe('different');
      expect(e(ids.cn1, ids.fr1).adjacency_rank).toBe(0);           // cn1 leans to fruity
      expect(e(ids.cn3, ids.fr1).adjacency_rank).toBe(1);           // cn3 middle: a neighbour
      expect(e(ids.cn1, ids.fl1).adjacency_rank).toBe(2);           // floral is opposite C&N
      expect(e(ids.fr1, ids.fl1).adjacency_rank).toBe(1);
      // floral has no Body: the body term is left out, never imputed
      const [wr, ws, wl] = [await param(c, 'dial_w_ring'), await param(c, 'dial_w_sweet'), await param(c, 'dial_w_lane')];
      const d = e(ids.cn1, ids.fl1);
      expect(d.delta_body).toBeNull();
      expect(Number(d.distance)).toBeCloseTo(wr * 0 + ws * 2 + wl, 4);  // ring 1 to 1, sweetness 5 to 7, side_a vs middle
    });
  });
});

describe('hops and the graph check (D5)', () => {
  it('cap and grade floor respected; a direction with no target is absent; graphCheck reports reachability and dead ends', async () => {
    await withRollback(async (tx) => {
      const c = tx.client;
      const ids = await five(tx);
      await setParameterInTx(c, { key: 'dial_cap_different', value: 1, note: 'vitest' });
      const hops = (await c.query(`SELECT * FROM v_dial_hop_preview WHERE in_hop_set`)).rows;
      const from = (id: number, rel: string) => hops.filter(h => h.from_coffee_id === id && h.relation === rel);
      expect(from(ids.cn1, 'different').length).toBe(1);
      expect(from(ids.cn1, 'different')[0].to_coffee_id).toBe(ids.fr1);   // adjacency 0 first
      expect(from(ids.cn3, 'bolder').length).toBe(0);                     // the edge state is the absence
      expect(from(ids.cn1, 'bolder')[0].to_coffee_id).toBe(ids.cn3);

      const gc = await graphCheck('preview', c);
      expect(gc.reachable.length).toBe(5);
      expect(gc.unreachableSellable).toEqual([]);
      expect(gc.noBolder).toContain('Zzz Map cn3');
      expect(gc.parameters.dial_cap_different).toBe(1);
    });
  });

  it('a grade below the hop-target floor is no target', async () => {
    await withRollback(async (tx) => {
      const c = tx.client;
      const r = await isolate(c);
      const center = await coffee(c, r, { tag: 'c', archetype: 'balanced_sweet', values: { acidity: 1, bitterness: 1, sweetness: 6 }, cuppers: ['ab_0_15', 'ab_0_15'] });
      const prov = await coffee(c, r, { tag: 'p', archetype: 'fruity', values: { acidity: 5, sweetness: 6 }, sampleNote: 'last cup of the day' });
      const rows = (await c.query(`SELECT * FROM v_dial_hop_preview WHERE from_coffee_id = $1`, [center])).rows;
      expect(rows.some(h => h.to_coffee_id === prov)).toBe(false);
      expect((await c.query(`SELECT 1 FROM v_dial_edge_preview WHERE from_coffee_id = $1 AND to_coffee_id = $2`, [center, prov])).rowCount).toBe(1);
      const gc = await graphCheck('preview', c);
      expect(gc.unreachableSellable).toEqual(['Zzz Map p']);
    });
  });

  it('computeGraphCheck: BFS over move edges only (siblings never connect), tagged targets dropped for the untagged run, cousins', () => {
    const pts = [
      { coffee_id: 1, coffee_name: 'C', archetype_code: 'balanced_sweet', is_center: true, is_sellable: true, category_codes: [] },
      { coffee_id: 2, coffee_name: 'X', archetype_code: 'fruity', is_center: false, is_sellable: true, category_codes: [] },
      { coffee_id: 3, coffee_name: 'Y', archetype_code: 'fruity', is_center: false, is_sellable: true, category_codes: ['decaf'] },
      { coffee_id: 4, coffee_name: 'Z', archetype_code: 'fruity', is_center: false, is_sellable: true, category_codes: [] },
    ];
    const hop = (f: number, t: number, relation: string, tags: string[] = []) => ({ from_coffee_id: f, to_coffee_id: t, relation, in_hop_set: true, to_category_codes: tags });
    const g = computeGraphCheck(pts, [hop(1, 2, 'different'), hop(2, 3, 'bolder', ['decaf']), hop(2, 4, 'sibling')], [{ coffee_id: 2, cousin_coffee_id: 3 }, { coffee_id: 3, cousin_coffee_id: 2 }]);
    expect(g.reachable).toEqual(['C', 'X', 'Y']);
    expect(g.unreachableSellable).toEqual(['Z']);
    expect(g.reachableWithoutTagged).toEqual(['C', 'X']);
    expect(g.cousins).toEqual([{ a: 'X', b: 'Y', aToB: 'bolder', bToA: null, reproduced: true }]);
  });
});

describe('versions (D6)', () => {
  it('cutVersion twice with one label: one version, one placement set; activate leaves one active; placements cannot change', async () => {
    await withRollback(async (tx) => {
      const c = tx.client;
      await five(tx);
      const placeable = Number((await c.query(`SELECT count(*) AS n FROM v_dial_placement_preview WHERE is_placeable`)).rows[0].n);
      const one = await cutVersionInTx(c, { label: 'vitest-v1', reason: 'test', adminUid: 'vitest' });
      const two = await cutVersionInTx(c, { label: 'vitest-v1', reason: 'again', adminUid: 'vitest' });
      expect(one.created).toBe(true);
      expect(two.created).toBe(false);
      expect(two.versionId).toBe(one.versionId);
      expect(one.placements).toBe(placeable);
      expect(Number((await c.query(`SELECT count(*) AS n FROM dial_placement WHERE version_id = $1`, [one.versionId])).rows[0].n)).toBe(placeable);
      expect((await c.query(`SELECT ring FROM dial_ring_cut WHERE version_id = $1 ORDER BY ring`, [one.versionId])).rows.map(x => x.ring)).toEqual([1, 2, 3]);
      const snap = (await c.query(`SELECT parameters FROM dial_map_version WHERE id = $1`, [one.versionId])).rows[0].parameters;
      expect(snap.dial_ring_cut_1).toBe(await param(c, 'dial_ring_cut_1'));

      await activateVersionInTx(c, one.versionId);
      const v2 = await cutVersionInTx(c, { label: 'vitest-v2', adminUid: 'vitest' });
      const act = await activateVersionInTx(c, v2.versionId);
      expect(act.retiredVersionId).toBe(one.versionId);
      const active = (await c.query(`SELECT id FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`)).rows;
      expect(active.map(x => x.id)).toEqual([v2.versionId]);
      await expect(tx.savepoint(() => activateVersionInTx(c, one.versionId))).rejects.toThrow(/only a draft/);

      await expect(tx.savepoint(() => c.query(`UPDATE dial_placement SET ring = 0 WHERE version_id = $1`, [v2.versionId]))).rejects.toThrow(/insert-only/);
      await expect(tx.savepoint(() => c.query(`DELETE FROM dial_placement WHERE version_id = $1`, [v2.versionId]))).rejects.toThrow(/insert-only/);
      await expect(tx.savepoint(() => c.query(
        `INSERT INTO dial_ring_cut (version_id, ring, lo, hi) VALUES ($1, 1, NULL, 1)`, [v2.versionId]))).rejects.toThrow(/not a draft|dial_ring_cut_one/);
      await expect(tx.savepoint(() => c.query(`DELETE FROM dial_map_version WHERE id = $1`, [v2.versionId]))).rejects.toThrow(/never deleted/);
    });
  });
});

describe('parameters (D7)', () => {
  it('changing dial_ring_cut_1 changes the preview rings, not the active version\'s placements', async () => {
    await withRollback(async (tx) => {
      const c = tx.client;
      const ids = await five(tx);
      const v = await cutVersionInTx(c, { label: 'vitest-param', adminUid: 'vitest' });
      await activateVersionInTx(c, v.versionId);
      const ringBefore = (await preview(c, ids.cn1)).ring;
      expect(ringBefore).toBe(1);
      const cn1Bitterness = Number((await preview(c, ids.cn1)).ruler_value);
      await setParameterInTx(c, { key: 'dial_ring_cut_1', value: cn1Bitterness - 0.5, note: 'vitest' });
      expect((await preview(c, ids.cn1)).ring).toBe(2);
      const active = (await c.query(`SELECT ring FROM v_dial_placement WHERE coffee_id = $1`, [ids.cn1])).rows[0];
      expect(active.ring).toBe(1);
      expect((await c.query(`SELECT 1 FROM v_dial_face WHERE coffee_id = $1 AND ring = 1`, [ids.cn1])).rowCount).toBe(1);
    });
  });
});
