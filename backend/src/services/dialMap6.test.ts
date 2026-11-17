// Ella's Bloom Map 6 (2026-11-16), Part D: the five-coffee acceptance script on the test DB.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_6_FIVE_COFFEES.md
//
// Every case runs inside withRollback (nothing is left behind). The fixture
// case builds its own "Zzz Map6" roastery and lineup; the real-data case runs
// the approved five and, while they are not yet accepted on this database,
// the brief 5 seed after them.
import 'dotenv/config';
import { describe, it, expect, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { db } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import { applyFiveCoffees, planFiveCoffees, FIVE, type FiveItem } from '../scripts/ellaMapFiveCoffees_2026_11_16.js';
import { planDecidedMap } from '../scripts/ellaMapDecided_2026_11_16.js';

vi.setConfig({ testTimeout: 300_000 });
afterAll(async () => { await db.end(); });

const term = async (c: pg.PoolClient, descriptor: string, category: string) =>
  (await c.query<{ id: string }>(`SELECT id FROM cupping_note WHERE descriptor = $1 AND wheel_category = $2 AND is_active`, [descriptor, category])).rows[0].id;

/** A lineup coffee with no catalog coffee and one submitted response (one note). */
async function lineupCoffee(c: pg.PoolClient, roasterId: string, name: string, words: string, pick: string | null, caffeine: string) {
  const pc = (await c.query<{ id: string }>(
    `INSERT INTO roastery_portal_coffee (roaster_id, name, added_by) VALUES ($1, $2, 'admin') RETURNING id`, [roasterId, name])).rows[0].id;
  const resp = (await c.query<{ id: string }>(
    `INSERT INTO roastery_portal_response (portal_coffee_id, version, status, origin, process_values, roast_level, blend_or_single, caffeine_level)
     VALUES ($1, 1, 'draft', 'Zzz Origin', ARRAY['washed'], 'medium', 'single', $2) RETURNING id`, [pc, caffeine])).rows[0].id;
  await c.query(`INSERT INTO roastery_portal_response_note (response_id, rank, roaster_words, cupping_note_id) VALUES ($1, 1, $2, $3)`, [resp, words, pick]);
  await c.query(`UPDATE roastery_portal_response SET status = 'submitted', submitted_at = now() WHERE id = $1`, [resp]);
  return { pc, resp };
}

/** The response, its notes and its dimensions exactly as stored (G2.20). */
async function snapshot(c: pg.PoolClient, responseId: string) {
  return (await c.query(
    `SELECT to_jsonb(r) AS response,
            (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.rank) FROM roastery_portal_response_note n WHERE n.response_id = r.id) AS notes,
            (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.dimension_id) FROM roastery_portal_response_dimension d WHERE d.response_id = r.id) AS dims
       FROM roastery_portal_response r WHERE r.id = $1`, [responseId])).rows[0];
}

describe('five-coffee acceptance (D)', () => {
  it('creates and links the coffees through acceptResponse, writes no family, slot, SKU or price, a second run creates nothing, the responses stay byte for byte', async () => {
    await withRollback(async (tx) => {
      const c = tx.client;
      const roasterId = (await c.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Zzz Map6 Roastery', true) RETURNING id`)).rows[0].id;
      const vanilla = await term(c, 'Vanilla', 'Sweet');
      const a = await lineupCoffee(c, roasterId, 'Zzz Map6 Pick', 'Walnut, Toffee, Vanilla', vanilla, 'half_caff');
      const b = await lineupCoffee(c, roasterId, 'Zzz Map6 NoPick', 'Fudge, Molasses', null, 'regular');
      const items: FiveItem[] = [
        { key: 'Pick', roaster: 'Zzz Map6 Roastery', lineupName: 'Zzz Map6 Pick', notes: [{ rank: 1, term: 'roaster_pick', expect: { descriptor: 'Vanilla', wheelCategory: 'Sweet' } }] },
        { key: 'NoPick', roaster: 'Zzz Map6 Roastery', lineupName: 'Zzz Map6 NoPick',
          notes: [{ rank: 1, term: { descriptor: 'Chocolate', wheelCategory: 'Nutty / Cocoa' }, expect: { descriptor: 'Chocolate', wheelCategory: 'Nutty / Cocoa' } }] },
      ];
      const before = [await snapshot(c, a.resp), await snapshot(c, b.resp)];

      const first = await applyFiveCoffees(c, 'vitest-no-profile', items);
      expect(first.accepted.map(x => [x.key, x.createdCoffee])).toEqual([['Pick', true], ['NoPick', true]]);
      const ids = first.accepted.map(x => x.coffeeId);
      const coffees = (await c.query(`SELECT id, name, is_active, origin, process, roast_level, blend_or_single, flavor_descriptors_roaster FROM coffees WHERE id = ANY($1::int[]) ORDER BY id`, [ids])).rows;
      expect(coffees.map(x => [x.name, x.is_active, x.origin, x.process, x.roast_level, x.blend_or_single])).toEqual([
        ['Zzz Map6 Pick', true, 'Zzz Origin', 'washed', 'medium', 'single'],
        ['Zzz Map6 NoPick', true, 'Zzz Origin', 'washed', 'medium', 'single'],
      ]);
      expect(coffees[0].flavor_descriptors_roaster).toEqual(['Walnut, Toffee, Vanilla']);
      // linked, one acceptance each with created_coffee, the approved term as the roaster descriptor
      const links = (await c.query(`SELECT id, coffee_id FROM roastery_portal_coffee WHERE id = ANY($1::uuid[]) ORDER BY name DESC`, [[a.pc, b.pc]])).rows;
      expect(links.map(l => l.coffee_id)).toEqual(ids);
      const acc = (await c.query(`SELECT response_id, created_coffee, accepted_by_admin_id FROM roastery_portal_acceptance WHERE response_id = ANY($1::uuid[])`, [[a.resp, b.resp]])).rows;
      expect(acc.length).toBe(2);
      expect(acc.every(x => x.created_coffee === true && x.accepted_by_admin_id === null)).toBe(true);
      const desc = (await c.query(`SELECT d.coffee_id, n.descriptor FROM roastery_coffee_descriptors d JOIN cupping_note n ON n.id = d.cupping_note_id WHERE d.coffee_id = ANY($1::int[]) ORDER BY d.coffee_id`, [ids])).rows;
      expect(desc.map(d => d.descriptor)).toEqual(['Vanilla', 'Chocolate']);
      // caffeine: the half-caff response gives the existing category, the regular one nothing
      const cats = (await c.query(`SELECT a.coffee_id, k.code FROM coffee_category_assignment a JOIN coffee_category k ON k.id = a.category_id WHERE a.coffee_id = ANY($1::int[])`, [ids])).rows;
      expect(cats).toEqual([{ coffee_id: ids[0], code: 'half_caf' }]);
      // no family, slot, SKU, price; no remembered mapping
      for (const [t, col] of [['coffee_archetype_assignment', 'coffee_id'], ['coffee_slot_assignment', 'coffee_id'], ['coffee_sku', 'coffee_id'], ['coffee_retail_price', 'coffee_id']]) {
        expect(Number((await c.query(`SELECT count(*) AS n FROM ${t} WHERE ${col} = ANY($1::int[])`, [ids])).rows[0].n), t).toBe(0); // table names from the literal list above
      }
      expect(Number((await c.query(`SELECT count(*) AS n FROM roastery_portal_note_mapping WHERE normalized_words IN ('walnut, toffee, vanilla', 'fudge, molasses')`)).rows[0].n)).toBe(0);

      // a second run accepts nothing and reports both as linked
      const second = await applyFiveCoffees(c, 'vitest-no-profile', items);
      expect(second.accepted).toEqual([]);
      expect(second.plan.map(p => [p.action, p.linkedCoffeeId])).toEqual([['skip', ids[0]], ['skip', ids[1]]]);
      expect(Number((await c.query(`SELECT count(*) AS n FROM roastery_portal_acceptance WHERE response_id = ANY($1::uuid[])`, [[a.resp, b.resp]])).rows[0].n)).toBe(2);

      // G2.20: the roaster's responses are unchanged
      expect([await snapshot(c, a.resp), await snapshot(c, b.resp)]).toEqual(before);

      // a pick that is not the approved one stops the plan
      const wrong: FiveItem[] = [{ ...items[0], lineupName: 'Zzz Map6 Other', key: 'Other' }];
      await lineupCoffee(c, roasterId, 'Zzz Map6 Other', 'Cherry', await term(c, 'Chocolate', 'Nutty / Cocoa'), 'regular');
      await expect(tx.savepoint(() => planFiveCoffees(c, wrong))).rejects.toThrow(/not the approved Vanilla/);
    });
  });

  it('the approved five: accepted once, then the brief 5 seed adds 5 families, 5 leans, 5 rings and 14 step rows', async () => {
    await withRollback(async (tx) => {
      const c = tx.client;
      const plan = await planFiveCoffees(c);
      expect(plan.map(p => p.key)).toEqual(FIVE.map(f => f.key));
      if (plan.every(p => p.action === 'skip')) return; // already accepted on this database (Part E step 1)
      expect(plan.every(p => p.action === 'accept')).toBe(true);
      // the seed's plan before the acceptance (the test DB may carry earlier acceptance drift, e.g. a changed ring)
      const key = (x: { section: string; subject: string }) => `${x.section}|${x.subject.replace(/ \(\d+\)$/, '')}`;
      const already = new Set((await planDecidedMap(c)).rows.filter(x => x.action === 'write').map(key));
      const r = await applyFiveCoffees(c, 'vitest-no-profile');
      expect(r.accepted.length).toBe(5);
      const seed = await planDecidedMap(c);
      expect(seed.missing).toEqual([]);
      // the writes the five add
      const writes = (s: string) => seed.rows.filter(x => x.section === s && x.action === 'write' && !already.has(key(x))).map(x => x.subject.replace(/ \(\d+\)$/, ''));
      for (const s of ['family', 'lean', 'ring']) {
        expect(writes(s).sort(), s).toEqual(['Brazil', 'D.R. Congo', 'Great Heights', 'Half Moon', 'Indonesia']);
      }
      expect(writes('parameter')).toEqual([]);
      expect(writes('first_match')).toEqual([]);
      expect(writes('step').length).toBe(14);
      expect(new Set(writes('step').map(x => Number(/^#(\d+)/.exec(x)![1])))).toEqual(new Set([3, 4, 9, 10, 13, 17, 18]));
    });
  });
});
