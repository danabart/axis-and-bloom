// Ella's Bloom Map 5 (2026-11-16), Part D: the decided map on the test DB.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_5_DECIDED_MAP_AND_ADMIN.md
//
// Every case runs inside withRollback, so nothing is left behind. Fixture
// coffees are "Zzz Map5" rows of a "Zzz Map5 Roastery"; the seed-script case
// runs on the real test-DB catalog (Joe Coffee and Joe Bean) and is rolled back too.
// Expected sizes are read from the parameter rows, never typed from the brief.
import 'dotenv/config';
import { describe, it, expect, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { db } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import { setLeanInTx, setRingInTx } from './catalogService.js';
import { setStepInTx, publishInTx, cutVersionInTx, activateVersionInTx } from './dialPlacementService.js';
import { steps } from './dialReads.js';
import { applyDecidedMap, planDecidedMap, DATA_2 } from '../scripts/ellaMapDecided_2026_11_16.js';

vi.setConfig({ testTimeout: 300_000 });
afterAll(async () => { await db.end(); });

const param = async (c: pg.PoolClient, key: string) => Number((await c.query<{ v: string }>(`SELECT param($1) AS v`, [key])).rows[0].v);
const preview = async (c: pg.PoolClient, id: number) =>
  (await c.query(`SELECT * FROM v_dial_placement_preview WHERE coffee_id = $1`, [id])).rows[0];

async function roastery(c: pg.PoolClient) {
  return (await c.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Zzz Map5 Roastery', true) RETURNING id`)).rows[0].id;
}

/** An uncupped coffee with a family and, optionally, a submitted portal Sweetness rating. */
async function coffee(c: pg.PoolClient, roasterId: string, tag: string, archetype: string, sweetness?: number): Promise<number> {
  const id = (await c.query<{ id: number }>(
    `INSERT INTO coffees (name, roaster_id, is_active) VALUES ($1, $2, true) RETURNING id`, [`Zzz Map5 ${tag}`, roasterId])).rows[0].id;
  await c.query(`INSERT INTO coffee_archetype_assignment (coffee_id, archetype, confidence, source) VALUES ($1, $2, 'low', 'manual')`, [id, archetype]);
  if (sweetness !== undefined) {
    const pc = (await c.query<{ id: string }>(
      `INSERT INTO roastery_portal_coffee (roaster_id, name, coffee_id, added_by) VALUES ($1, $2, $3, 'admin') RETURNING id`,
      [roasterId, `Zzz Map5 ${tag}`, id])).rows[0].id;
    const resp = (await c.query<{ id: string }>(
      `INSERT INTO roastery_portal_response (portal_coffee_id, version, status) VALUES ($1, 1, 'draft') RETURNING id`, [pc])).rows[0].id;
    await c.query(
      `INSERT INTO roastery_portal_response_dimension (response_id, dimension_id, value)
       SELECT $1, dimension_id, $2 FROM dial_reading WHERE code = 'sweetness'`, [resp, sweetness]);
    await c.query(`UPDATE roastery_portal_response SET status = 'submitted', submitted_at = now() WHERE id = $1`, [resp]);
  }
  return id;
}

describe('setStepInTx (D, B1)', () => {
  it('supersedes, keeps one current row per ordered pair, switches is_shown, and refuses a bad step', async () => {
    await withRollback(async (tx) => {
      const c = tx.client;
      const r = await roastery(c);
      const a = await coffee(c, r, 'A', 'fruity'), b = await coffee(c, r, 'B', 'fruity');
      const one = await setStepInTx(c, { fromCoffeeId: a, toCoffeeId: b, buttonWord: 'Bolder', customerLine: 'More body.', basisCode: 'roaster_said' });
      expect(one.unchanged).toBe(false);
      expect((await setStepInTx(c, { fromCoffeeId: a, toCoffeeId: b, buttonWord: 'Bolder', customerLine: 'More body.', basisCode: 'roaster_said' })).unchanged).toBe(true);
      const two = await setStepInTx(c, { fromCoffeeId: a, toCoffeeId: b, buttonWord: 'Fuller', customerLine: 'More body.', basisCode: 'our_guess' });
      expect(two.supersededId).toBe(one.id);
      const back = await setStepInTx(c, { fromCoffeeId: b, toCoffeeId: a, buttonWord: 'Lighter', customerLine: null, basisCode: 'our_guess' });
      const hidden = await setStepInTx(c, { fromCoffeeId: a, toCoffeeId: b, buttonWord: 'Fuller', customerLine: 'More body.', basisCode: 'our_guess', isShown: false });
      expect(hidden.supersededId).toBe(two.id);
      const rows = (await c.query(`SELECT id, is_shown, superseded_at FROM dial_step WHERE from_coffee_id = $1 AND to_coffee_id = $2 ORDER BY id`, [a, b])).rows;
      expect(rows.length).toBe(3);
      expect(rows.filter(x => x.superseded_at === null).map(x => x.id)).toEqual([hidden.id]);
      expect(rows[2].is_shown).toBe(false);
      const current = (await steps('current', c)).filter((s: any) => [a, b].includes(s.from_coffee_id));
      expect(current.map((s: any) => [s.from_coffee_id, s.button_word, s.is_shown])).toEqual(expect.arrayContaining([[a, 'Fuller', false], [b, 'Lighter', true]]));
      expect(current.find((s: any) => s.id === back.id).customer_line).toBeNull();
      await expect(tx.savepoint(() => setStepInTx(c, { fromCoffeeId: a, toCoffeeId: a, buttonWord: 'X', basisCode: 'our_guess' }))).rejects.toThrow(/two different/);
      await expect(tx.savepoint(() => setStepInTx(c, { fromCoffeeId: a, toCoffeeId: b, buttonWord: 'X', basisCode: 'nope' }))).rejects.toThrow(/unknown step basis/);
      await expect(tx.savepoint(() => setStepInTx(c, { fromCoffeeId: a, toCoffeeId: b, buttonWord: '  ', basisCode: 'our_guess' }))).rejects.toThrow(/buttonWord/);
      await expect(tx.savepoint(() => c.query(
        `INSERT INTO dial_step (from_coffee_id, to_coffee_id, button_word, basis_id) SELECT $1, $2, 'Dup', id FROM dial_step_basis LIMIT 1`, [a, b]))).rejects.toThrow(/dial_step_one_current/);
    });
  });
});

describe('setRingInTx (D, B1)', () => {
  it('one current row; ring 0 only for the center family; the calculated ring stored as the suggestion', async () => {
    await withRollback(async (tx) => {
      const c = tx.client;
      const r = await roastery(c);
      const fruit = await coffee(c, r, 'Fruit', 'fruity');
      const center = await coffee(c, r, 'Center', 'balanced_sweet');
      const one = await setRingInTx(c, fruit, 2, { notes: 'vitest', decidedBy: 'vitest' });
      expect((await setRingInTx(c, fruit, 2, { notes: 'vitest' })).unchanged).toBe(true);
      const two = await setRingInTx(c, fruit, 3, { notes: 'vitest' });
      expect(two.before?.id).toBe(one.after.id);
      expect((await c.query(`SELECT count(*)::int AS n FROM coffee_ring_assignment WHERE coffee_id = $1 AND superseded_at IS NULL`, [fruit])).rows[0].n).toBe(1);
      const hist = (await c.query(`SELECT ring, is_current FROM v_coffee_ring_assignment_history WHERE coffee_id = $1 ORDER BY id`, [fruit])).rows;
      expect(hist).toEqual([{ ring: 2, is_current: false }, { ring: 3, is_current: true }]);
      expect(one.after.suggested_ring).toBeNull(); // uncupped: no calculated ring
      await expect(tx.savepoint(() => setRingInTx(c, fruit, 0))).rejects.toThrow(/center family only/);
      await expect(tx.savepoint(() => setRingInTx(c, center, 2))).rejects.toThrow(/ring 0/);
      await expect(tx.savepoint(() => setRingInTx(c, fruit, 4))).rejects.toThrow(/Unknown ring/);
      expect((await setRingInTx(c, center, 0)).unchanged).toBe(false);
      // the database refuses what the service refuses (G2.6)
      await expect(tx.savepoint(() => c.query(
        `INSERT INTO coffee_ring_assignment (coffee_id, ring) VALUES ($1, 0)`, [fruit]))).rejects.toThrow(/center family only/);
      // a cupped coffee stores its calculated ring: Fabricator (test DB) is cupped
      const fab = (await c.query<{ coffee_id: number; calculated_ring: number }>(
        `SELECT coffee_id, calculated_ring FROM v_dial_placement_preview WHERE calculated_ring IS NOT NULL AND NOT is_center ORDER BY coffee_id LIMIT 1`)).rows[0];
      const decided = await setRingInTx(c, fab.coffee_id, fab.calculated_ring === 3 ? 1 : 3);
      expect(decided.after.suggested_ring).toBe(fab.calculated_ring);
    });
  });
});

describe('placement input (D, A4)', () => {
  it('a ring decision wins; an uncupped coffee with three decisions is placeable; size from the roaster rating at each cut; NULL without one', async () => {
    await withRollback(async (tx) => {
      const c = tx.client;
      const r = await roastery(c);
      const cut1 = await param(c, 'dial_size_roaster_cut_1');
      const cut2 = await param(c, 'dial_size_roaster_cut_2');
      const below = await coffee(c, r, 'Below', 'fruity', cut1 - 1);
      const atOne = await coffee(c, r, 'AtOne', 'fruity', cut1);
      const atTwo = await coffee(c, r, 'AtTwo', 'fruity', cut2);
      const none = await coffee(c, r, 'None', 'fruity');

      expect((await preview(c, below)).is_placeable).toBe(false); // family only: not placeable
      await setLeanInTx(c, below, 'side_a');
      expect((await preview(c, below)).is_placeable).toBe(false); // family and lean: still not
      for (const id of [below, atOne, atTwo, none]) {
        await setLeanInTx(c, id, 'middle');
        await setRingInTx(c, id, 2);
      }
      const rows = [];
      for (const id of [below, atOne, atTwo, none]) rows.push(await preview(c, id));
      expect(rows.map(x => x.is_placeable)).toEqual([true, true, true, true]);
      expect(rows.map(x => x.ring)).toEqual([2, 2, 2, 2]);
      expect(rows.map(x => x.size)).toEqual([1, 2, 3, null]);
      expect(rows[0].grade_code).toBe('D');
      expect(rows[0].flags).toEqual(expect.arrayContaining(['ring_decided', 'no_cupping_rows']));
      expect(rows[3].flags).toContain('no_roaster_sweetness');
      expect(rows[0].inputs_used.ring.source).toBe('decision');

      // a cupped coffee: the decision wins over the calculated ring, which stays beside it
      // (the real catalog may already carry ring decisions, so the case picks the decision that differs from both)
      const cupped = (await c.query<{ coffee_id: number; ring: number; calculated_ring: number }>(
        `SELECT coffee_id, ring, calculated_ring FROM v_dial_placement_preview
          WHERE is_placeable AND NOT is_center AND calculated_ring IS NOT NULL ORDER BY coffee_id LIMIT 1`)).rows[0];
      const other = [1, 2, 3].find(x => x !== cupped.ring && x !== cupped.calculated_ring)!;
      await setRingInTx(c, cupped.coffee_id, other);
      const after = await preview(c, cupped.coffee_id);
      expect(after.ring).toBe(other);
      expect(after.calculated_ring).toBe(cupped.calculated_ring);
      expect(after.flags).toContain('ring_decided');

      // the cut copies an uncupped placement and its NULL size
      const v = await cutVersionInTx(c, { label: 'vitest-map5-cut', adminUid: 'vitest' });
      const placed = (await c.query(`SELECT coffee_id, ring, size, flags FROM dial_placement WHERE version_id = $1 AND coffee_id = ANY($2::int[]) ORDER BY coffee_id`,
        [v.versionId, [below, none]])).rows;
      expect(placed.map(p => [p.ring, p.size])).toEqual([[2, 1], [2, null]]);
    });
  });
});

describe('publish (D, B4)', () => {
  it('cuts one version and activates it, retiring the previous; a used label is refused; steps reach the active map only through publish', async () => {
    await withRollback(async (tx) => {
      const c = tx.client;
      const r = await roastery(c);
      const a = await coffee(c, r, 'PA', 'fruity', 3), b = await coffee(c, r, 'PB', 'fruity', 5);
      for (const id of [a, b]) { await setLeanInTx(c, id, 'middle'); await setRingInTx(c, id, 1); }
      const before = (await c.query(`SELECT id FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`)).rows[0]?.id ?? null;
      await setStepInTx(c, { fromCoffeeId: a, toCoffeeId: b, buttonWord: 'Sweeter', basisCode: 'our_guess' });
      const onMap = async () => (await steps('active', c)).filter((s: any) => s.from_coffee_id === a);

      const p1 = await publishInTx(c, { label: 'vitest-map5-p1', reason: 'test', adminUid: 'vitest' });
      expect(p1.retiredVersionId).toBe(before);
      const active = (await c.query(`SELECT id FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`)).rows.map(x => x.id);
      expect(active).toEqual([p1.versionId]);
      expect((await c.query(`SELECT count(*)::int AS n FROM dial_placement WHERE version_id = $1 AND coffee_id = ANY($2::int[])`, [p1.versionId, [a, b]])).rows[0].n).toBe(2);
      expect((await onMap()).map((s: any) => s.button_word)).toEqual(['Sweeter']);

      // hiding the step changes the current row now and the map only after the next publish
      await setStepInTx(c, { fromCoffeeId: a, toCoffeeId: b, buttonWord: 'Sweeter', basisCode: 'our_guess', isShown: false });
      expect((await onMap()).length).toBe(1);
      expect((await steps('current', c)).find((s: any) => s.from_coffee_id === a).is_shown).toBe(false);
      const p2 = await publishInTx(c, { label: 'vitest-map5-p2', reason: 'hide', adminUid: 'vitest' });
      expect(p2.retiredVersionId).toBe(p1.versionId);
      expect((await onMap()).length).toBe(0);
      expect((await steps('current', c)).filter((s: any) => s.from_coffee_id === a).length).toBe(1);

      await expect(tx.savepoint(() => publishInTx(c, { label: 'vitest-map5-p2', reason: 'again' }))).rejects.toThrow(/publish needs a new label/);
      // the manual path still works and is not changed
      const v = await cutVersionInTx(c, { label: 'vitest-map5-manual' });
      await activateVersionInTx(c, v.versionId);
    });
  });
});

describe('seed script (D, B5)', () => {
  it('enters Data 1 to 3 for the coffees that exist, skips the rest with their steps, and a second run writes nothing', async () => {
    await withRollback(async (tx) => {
      const c = tx.client;
      const first = await applyDecidedMap(c);
      // the test DB may already carry the seed (Part E step 1), so the first run's count is not asserted
      const missing = first.plan.missing;
      const present = Object.values(first.plan.coffees).filter(Boolean).length;
      expect(present + missing.length).toBe(18);
      // every step whose two coffees exist is written; the others are skipped
      const pairs = DATA_2.filter(s => first.plan.coffees[s.from] && first.plan.coffees[s.to]);
      const ids = Object.values(first.plan.coffees).filter(Boolean).map(x => x!.id);
      // Ella map 15: later briefs add their own steps between these coffees, so count Data 2's pairs only, both ways
      const from = pairs.flatMap(s => [first.plan.coffees[s.from]!.id, first.plan.coffees[s.to]!.id]);
      const to = pairs.flatMap(s => [first.plan.coffees[s.to]!.id, first.plan.coffees[s.from]!.id]);
      const n = (await c.query(
        `SELECT count(*)::int AS n FROM dial_step d JOIN unnest($1::int[], $2::int[]) AS p(f, t) ON d.from_coffee_id = p.f AND d.to_coffee_id = p.t
          WHERE d.superseded_at IS NULL`, [from, to])).rows[0].n;
      expect(n).toBe(pairs.length * 2);
      expect(first.plan.rows.filter(r => r.section === 'step' && r.action === 'skip').length).toBe((DATA_2.length - pairs.length) * 2);
      // every present coffee is placeable in the preview with its Data 1 ring
      const rows = (await c.query(`SELECT coffee_id, is_placeable, ring FROM v_dial_placement_preview WHERE coffee_id = ANY($1::int[])`, [ids])).rows;
      expect(rows.length).toBe(present);
      expect(rows.every(r => r.is_placeable)).toBe(true);
      expect(Number(await param(c, 'dial_min_grade_rank_first_match'))).toBe(1);

      const again = await applyDecidedMap(c);
      expect(again.written).toBe(0);
      expect(again.plan.rows.filter(r => r.action === 'write')).toEqual([]);
      const plan = await planDecidedMap(c);
      expect(plan.rows.some(r => r.action === 'write')).toBe(false);
    });
  });
});
