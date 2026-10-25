// Coffee presentation brief 1 (2026-10-23): v_coffee_customer_descriptor's
// presentation columns (signature / accent from the match archetype's
// descriptor_families, strength from evidence, the tier rules), the two caps
// applied by the read, and roasterVoiceReads.getRoasterVoice's roaster-blind
// shape. Every fixture lives inside a rolled-back transaction (withRollback).
// Families are read from the seed (coffee_archetype), never assumed; the
// wheel has no Fig node (the roaster's "Fig" maps to Dried Fruit), so the
// second Dried Fruit fixture uses Raisin, a leaf under it.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import type pg from 'pg';
import { db } from './client.js';
import { withRollback } from '../test/withRollback.js';
import { setParameterInTx } from '../services/evidenceParameterService.js';
import { getCustomerDescriptors, getCustomerDescriptorsAll } from '../services/cuppingReads.js';
import { getRoasterVoice } from '../services/roasterVoiceReads.js';

afterAll(async () => { await db.end(); });

interface Base { roasterId: string; roasterName: string; coffeeId: number; coffeeName: string; cupper: number }
async function base(c: pg.PoolClient, tag: string, archetype: string | null): Promise<Base> {
  const roasterName = `Zzz Presentation Roastery ${tag}`;
  const coffeeName = `Zzz Presentation Coffee ${tag}`;
  const roasterId = (await c.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`, [roasterName])).rows[0].id;
  const coffeeId = (await c.query<{ id: number }>(`INSERT INTO coffees (name, roaster_id, is_active) VALUES ($1, $2, true) RETURNING id`, [coffeeName, roasterId])).rows[0].id;
  if (archetype) await c.query(`INSERT INTO coffee_archetype_assignment (coffee_id, archetype, confidence) VALUES ($1, $2, 'high')`, [coffeeId, archetype]);
  const cupper = (await c.query<{ id: number }>(`INSERT INTO cupper (name) VALUES ($1) RETURNING id`, [`Zzz Presentation Cupper ${tag}`])).rows[0].id;
  return { roasterId, roasterName, coffeeId, coffeeName, cupper };
}
const nodeId = async (c: pg.PoolClient, descriptor: string) =>
  (await c.query<{ id: string }>(`SELECT id FROM cupping_note WHERE descriptor = $1 AND is_active ORDER BY tier LIMIT 1`, [descriptor])).rows[0].id;

async function website(c: pg.PoolClient, b: Base, descriptor: string) {
  await c.query(
    `INSERT INTO roastery_remark (roaster_id, coffee_id, said_by, said_on, channel, topic, remark, cupping_note_id, recorded_by, record_source)
     VALUES ($1, $2, 'Zzz roaster site', '2026-01-05', 'website', 'descriptor', $3, $4, 'vitest', 'test:coffeePresentation')`,
    [b.roasterId, b.coffeeId, descriptor.toLowerCase(), await nodeId(c, descriptor)]);
}
async function remark(c: pg.PoolClient, b: Base, topic: string, text: string, channel = 'website') {
  await c.query(
    `INSERT INTO roastery_remark (roaster_id, coffee_id, said_by, said_on, channel, topic, remark, recorded_by, record_source)
     VALUES ($1, $2, 'Zzz roaster site', '2026-01-05', $3, $4, $5, 'vitest', 'test:coffeePresentation')`,
    [b.roasterId, b.coffeeId, channel, topic, text]);
}
/** The accepted portal note (the 'form' channel). */
async function accepted(c: pg.PoolClient, b: Base, descriptor: string) {
  await c.query(`INSERT INTO roastery_coffee_descriptors (coffee_id, cupping_note_id) VALUES ($1, $2)`, [b.coffeeId, await nodeId(c, descriptor)]);
}
/** A lineup coffee linked to the catalog coffee, with a current (draft) response and ranked notes. */
async function portal(c: pg.PoolClient, b: Base, notes: Array<[number, string]>, answers: { takes_it?: string; anything_else?: string } = {}) {
  const pc = (await c.query<{ id: string }>(`INSERT INTO roastery_portal_coffee (roaster_id, name, coffee_id) VALUES ($1, $2, $3) RETURNING id`,
    [b.roasterId, b.coffeeName, b.coffeeId])).rows[0].id;
  const resp = (await c.query<{ id: string }>(
    `INSERT INTO roastery_portal_response (portal_coffee_id, version, status, takes_it, anything_else) VALUES ($1, 1, 'draft', $2, $3) RETURNING id`,
    [pc, answers.takes_it ?? null, answers.anything_else ?? null])).rows[0].id;
  for (const [rank, descriptor] of notes) {
    await c.query(`INSERT INTO roastery_portal_response_note (response_id, rank, roaster_words, cupping_note_id) VALUES ($1, $2, $3, $4)`,
      [resp, rank, descriptor.toLowerCase(), await nodeId(c, descriptor)]);
  }
}
/** One cupping session on `date` with a cupper row naming `notes` (and a merged row, so the coffee counts as cupped). */
async function session(c: pg.PoolClient, b: Base, date: string, notes: string[]) {
  const sessionId = (await c.query<{ id: number }>(`INSERT INTO cupping_sessions (session_date, record_source) VALUES ($1, 'test:coffeePresentation') RETURNING id`, [date])).rows[0].id;
  const scId = (await c.query<{ id: number }>(`INSERT INTO cupping_session_coffees (session_id, coffee_id) VALUES ($1, $2) RETURNING id`, [sessionId, b.coffeeId])).rows[0].id;
  const cupperRow = (await c.query<{ id: number }>(`INSERT INTO cupping_scores (session_coffee_id, cupper_id, is_merged, scale_code) VALUES ($1, $2, false, 'ab_0_15') RETURNING id`, [scId, b.cupper])).rows[0].id;
  await c.query(`INSERT INTO cupping_scores (session_coffee_id, is_merged, scale_code, merge_rule) VALUES ($1, true, 'ab_0_15', 'union_v1')`, [scId]);
  for (const n of notes) {
    await c.query(`INSERT INTO cupping_score_descriptors (cupping_score_id, cupping_note_id, custom_notes) VALUES ($1, $2, $3)`, [cupperRow, await nodeId(c, n), n.toLowerCase()]);
  }
}
async function view(c: pg.PoolClient, coffeeId: number) {
  return (await c.query(
    `SELECT descriptor, family, is_signature, qualifies, n_roaster_channels, roaster_channels, roaster_rank,
            confirmed_by_cupping, cupping_share::float AS cupping_share, group_order, display_order
       FROM v_coffee_customer_descriptor WHERE coffee_id = $1 ORDER BY display_order NULLS LAST, descriptor`, [coffeeId])).rows;
}

/** The brief's fixture: a chocolate_nutty coffee and the roaster's nodes. */
async function fixtureOne(c: pg.PoolClient, tag: string, answers: { takes_it?: string; anything_else?: string } = {}) {
  const b = await base(c, tag, 'chocolate_nutty');
  await accepted(c, b, 'Chocolate');
  await portal(c, b, [[1, 'Chocolate']], answers);
  for (const d of ['Chocolate', 'Almond', 'Cherry', 'Apple', 'Fruity', 'Dried Fruit']) await website(c, b, d);
  return b;
}

describe('v_coffee_customer_descriptor: signature, accent, strength, tiers (Part A)', () => {
  it('the fixture archetype reads its families from the seed: Nutty / Cocoa on, Fruity off', async () => {
    const families = (await db.query(`SELECT descriptor_families FROM coffee_archetype WHERE code = 'chocolate_nutty'`)).rows[0].descriptor_families;
    expect(families).toContain('Nutty / Cocoa');
    expect(families).not.toContain('Fruity');
  });

  it('Chocolate and Almond signature in that order (channels 2 then 1); Apple, Cherry, Dried Fruit accent alphabetically; Fruity does not qualify', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await fixtureOne(c, 'one');
      const rows = await view(c, b.coffeeId);
      const shown = rows.filter(r => r.qualifies);
      expect(shown.map(r => [r.descriptor, r.is_signature, r.display_order])).toEqual([
        ['Chocolate', true, 1], ['Almond', true, 2], ['Apple', false, 3], ['Cherry', false, 4], ['Dried Fruit', false, 5],
      ]);
      const choc = rows.find(r => r.descriptor === 'Chocolate')!;
      expect(choc).toMatchObject({ n_roaster_channels: 2, roaster_channels: ['form', 'website'], roaster_rank: 1, family: 'Nutty / Cocoa' });
      expect(rows.find(r => r.descriptor === 'Almond')).toMatchObject({ n_roaster_channels: 1, roaster_rank: null });
      expect(rows.find(r => r.descriptor === 'Fruity')).toMatchObject({ qualifies: false, display_order: null, group_order: null });
      expect(rows.find(r => r.descriptor === 'Cherry')).toMatchObject({ family: 'Fruity', group_order: 2 });
    });
  });

  it('a sub-group with a leaf of the same coffee under it does not qualify (Dried Fruit + Raisin)', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'two', 'chocolate_nutty');
      await website(c, b, 'Dried Fruit');
      await website(c, b, 'Raisin');
      const rows = await view(c, b.coffeeId);
      expect(rows.map(r => [r.descriptor, r.qualifies])).toEqual([['Raisin', true], ['Dried Fruit', false]]);
    });
  });

  it('cupping_share is sessions named / total: 0.5 for a node confirmed in 1 of 2 sessions', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await fixtureOne(c, 'share');
      await session(c, b, '2026-01-01', ['Chocolate']);
      await session(c, b, '2026-01-02', []);
      const rows = await view(c, b.coffeeId);
      expect(rows.find(r => r.descriptor === 'Chocolate')).toMatchObject({ confirmed_by_cupping: true, cupping_share: 0.5 });
      expect(rows.find(r => r.descriptor === 'Almond')).toMatchObject({ confirmed_by_cupping: false, cupping_share: null });
    });
  });

  it('a coffee with no match archetype has only signature rows', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await base(c, 'none', null);
      for (const d of ['Chocolate', 'Cherry']) await website(c, b, d);
      expect((await view(c, b.coffeeId)).map(r => r.is_signature)).toEqual([true, true]);
    });
  });
});

describe('getCustomerDescriptors applies the two caps; getCustomerDescriptorsAll says why a row is hidden (A2)', () => {
  it('as seeded: signature and accent within their caps, Fruity left out', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await fixtureOne(c, 'read');
      const read = await getCustomerDescriptors(b.coffeeId, c);
      expect(read.map(r => r.descriptor)).toEqual(['Chocolate', 'Almond', 'Apple', 'Cherry', 'Dried Fruit']);
    });
  });

  it('signature cap 1 leaves Chocolate alone; accent cap 1 leaves the first accent row by display_order', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await fixtureOne(c, 'caps');
      await setParameterInTx(c, { key: 'customer_voice_signature_max', value: 1, note: 'vitest, rolled back' });
      await setParameterInTx(c, { key: 'customer_voice_accent_max', value: 1, note: 'vitest, rolled back' });
      const read = await getCustomerDescriptors(b.coffeeId, c);
      expect(read.map(r => [r.descriptor, r.is_signature])).toEqual([['Chocolate', true], ['Apple', false]]);
      const all = await getCustomerDescriptorsAll(b.coffeeId, c);
      expect(Object.fromEntries(all.map(r => [r.descriptor, r.customer_sees]))).toEqual({
        Chocolate: 'signature', Almond: 'hidden by cap', Apple: 'accent', Cherry: 'hidden by cap', 'Dried Fruit': 'hidden by cap', Fruity: 'hidden by tier',
      });
    });
  });
});

describe('roasterVoiceReads.getRoasterVoice: roaster-blind (Part C)', () => {
  it('never carries the roaster name, coffees.name, coffees.origin, an origin remark or an award text', async () => {
    await withRollback(async ({ client: c }) => {
      const b = await fixtureOne(c, 'voice', { takes_it: 'milk', anything_else: 'Golden Bean awarded in the espresso category' });
      const origin = 'Zzz Kona estate lot 7';
      await c.query(`UPDATE coffees SET origin = $1 WHERE id = $2`, [origin, b.coffeeId]);
      const award = '2023 Golden Bean medal';
      await remark(c, b, 'award', award);
      // coffee presentation brief 4, decision 3: masked, no longer withheld
      await remark(c, b, 'general', 'Winner of a 2023 Golden Bean medal, a classic');   // carries award words: masked
      await remark(c, b, 'general', `${b.roasterName} roasts this one every week`);     // carries the roaster's name: masked
      await remark(c, b, 'general', 'bright and sweet in the cup');
      await remark(c, b, 'origin', 'grown on the slopes by the Zzz family');           // origin topic: never
      await remark(c, b, 'brewing', '18g in, 40g out', 'cupping_table');

      const voice = await getRoasterVoice(b.coffeeId, c);
      const json = JSON.stringify(voice);
      for (const banned of [b.roasterName, b.coffeeName, origin, 'grown on the slopes', award, 'Golden', '2023']) {
        expect(json).not.toContain(banned);
      }
      expect(voice.awards.count).toBe(1);
      expect([...voice.remarks.general].sort()).toEqual(
        ['Winner of a […], a classic', '[…] roasts this one every week', 'bright and sweet in the cup'].sort());
      expect(voice.remarks.brewing).toEqual(['18g in, 40g out']);
      expect(voice.portal).toMatchObject({ takesIt: 'milk', anythingElse: '[…] awarded in the espresso category' });
      expect(voice.masked).toBe(3); // one gap per run of neighbouring tokens
      expect(voice.descriptors.map(d => d.descriptor)).toEqual(['Chocolate', 'Almond', 'Apple', 'Cherry', 'Dried Fruit']);
    });
  });
});
