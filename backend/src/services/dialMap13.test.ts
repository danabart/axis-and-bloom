// Ella's Bloom Map 13 (2026-11-26), Part D (backend): the /map panel in the
// roaster's terms. GET /api/coffees/:id/roaster-profile gives where it shines
// (the roaster's best method first, then every also-good one in the brew
// lookup's order) and the roaster's own 1 to 5 ratings with the portal's
// labels, never converted; a dimension held back for the coffee's roaster is
// not in it; a coffee with no portal answers has no ratings; no roaster name
// or id anywhere in it. The hold is insert-only with one withdraw and never
// touches the roaster's answers (G2.20). Test DB only; every write inside a
// rolled-back transaction; the route reads the test DB as it stands (the
// script applied there). The panel itself is tested in
// frontend/src/app/components/bloom/map/mapMoreAbout.test.tsx.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_13_LAPTOP_LAYOUT_AND_ROASTER_PROFILE.md
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type pg from 'pg';
import { db, type Tx } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import coffeesRouter from '../routes/coffees.js';
import { getRoasterProfile, roasterRatingMax } from './roasterVoiceReads.js';
import { setParameterInTx } from './evidenceParameterService.js';
import { setDimensionHoldInTx, PortalError } from './roasteryPortalService.js';
import { applyRoasterProfile, planRoasterProfile, HOLDS, COPY } from '../scripts/ellaMapRoasterProfile_2026_11_26.js';

vi.setConfig({ testTimeout: 120_000 });

const tx = (c: pg.PoolClient) => c as unknown as Tx;
const UID = 'zzz-map13-test-admin';
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/coffees', coffeesRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/coffees`;
});
afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await db.end();
});

/** A placed map coffee by its map name, with its portal roaster. */
async function mapCoffee(c: pg.PoolClient | typeof db, name: string) {
  const r = await c.query<{ coffee_id: number; roaster_id: string }>(
    `SELECT p.coffee_id, pc.roaster_id FROM v_dial_placement p
       JOIN v_dial_coffee_availability av ON av.coffee_id = p.coffee_id
       JOIN v_roastery_portal_coffee pc ON pc.coffee_id = p.coffee_id
      WHERE av.map_name = $1`, [name]);
  expect(r.rows).toHaveLength(1);
  return { coffeeId: r.rows[0].coffee_id, roasterId: r.rows[0].roaster_id };
}
const dimId = async (c: pg.PoolClient | typeof db, label: string) =>
  (await c.query<{ dimension_id: number }>(`SELECT dimension_id FROM roastery_portal_dimension WHERE label = $1`, [label])).rows[0].dimension_id;
const answersHash = async (c: pg.PoolClient) =>
  (await c.query<{ h: string }>(`SELECT md5(string_agg(response_id::text || ':' || dimension_id || ':' || value, ',' ORDER BY response_id, dimension_id)) AS h FROM roastery_portal_response_dimension`)).rows[0].h;
const roasterNames = async () => (await db.query<{ name: string }>(`SELECT name FROM roaster`)).rows.map(r => r.name).filter(n => n.length >= 4);

describe('where it shines (call 3)', () => {
  it('Tiger Stripe: the roaster’s best method first, then the also-good ones in the lookup order', async () => {
    const { coffeeId } = await mapCoffee(db, 'Tiger Stripe');
    const p = await getRoasterProfile(coffeeId);
    expect(p.whereItShines).toEqual(['Espresso', 'Pour-over', 'Batch brew / drip', 'Cold brew']);
  });

  it('every map coffee: best first, the rest in lookup sort_order, no repeats, no "Other"', async () => {
    const coffees = (await db.query<{ coffee_id: number }>(`SELECT coffee_id FROM v_dial_placement`)).rows;
    const order = (await db.query<{ label: string }>(
      `SELECT label FROM lookup_value WHERE category = 'roastery_portal_brew_method' ORDER BY sort_order, label`)).rows.map(r => r.label);
    for (const { coffee_id } of coffees) {
      const p = await getRoasterProfile(coffee_id);
      expect(p.whereItShines.length).toBeGreaterThan(0);
      expect(new Set(p.whereItShines).size).toBe(p.whereItShines.length);
      const rest = p.whereItShines.slice(1).map(l => order.indexOf(l));
      expect(rest.every(i => i >= 0)).toBe(true);
      expect(rest).toEqual([...rest].sort((a, b) => a - b));
      expect(p.whereItShines).not.toContain('Other');
    }
  });
});

describe('the roaster’s ratings (calls 1, 2, 7)', () => {
  it('on the portal’s own 1 to 5 with its labels and order; Mouthfeel held back; never the cupping sheet’s names', async () => {
    const { coffeeId } = await mapCoffee(db, 'Tiger Stripe');
    const p = await getRoasterProfile(coffeeId);
    expect(p.scale).toBe(5); // dial_roaster_rating_max, matching the CHECK (1 to 5)
    expect(p.ratings.map(r => r.label)).toEqual(['Acidity', 'Sweetness', 'Bitterness', 'Body', 'Clarity', 'Finish']);
    expect(p.ratings.find(r => r.label === 'Clarity')).toMatchObject({ lowLabel: 'Clean', highLabel: 'Layered' });
    for (const r of p.ratings) { expect(Number.isInteger(r.value)).toBe(true); expect(r.value).toBeGreaterThanOrEqual(1); expect(r.value).toBeLessThanOrEqual(5); }
    // Tiger Stripe's latest submitted answers (Task 0 item 2), unconverted
    expect(p.ratings.map(r => r.value)).toEqual([4, 4, 3, 5, 4, 4]);
    for (const w of ['Fragrance', 'Aroma', 'Flavor', 'Texture', 'Savory', 'Finish Length', 'Mouthfeel']) {
      expect(p.ratings.map(r => r.label)).not.toContain(w);
    }
  });

  it('the top of the scale is the row dial_roaster_rating_max, not a constant (fix, 2026-11-26)', async () => {
    await withRollback(async ({ client }) => {
      const { coffeeId } = await mapCoffee(client, 'Tiger Stripe');
      await setParameterInTx(tx(client), { key: 'dial_roaster_rating_max', value: 7, adminId: UID });
      expect((await getRoasterProfile(coffeeId, tx(client))).scale).toBe(7);
      // a missing row draws no bars rather than guessing
      await client.query(`UPDATE evidence_parameter SET superseded_at = now() WHERE key = 'dial_roaster_rating_max' AND superseded_at IS NULL`);
      expect(await roasterRatingMax(tx(client))).toBe(0);
    });
  });

  it('a submitted but not accepted response still gives bars (call 2): The Daily', async () => {
    const { coffeeId } = await mapCoffee(db, 'The Daily');
    const accepted = await db.query(
      `SELECT 1 FROM roastery_portal_acceptance a JOIN v_roastery_portal_coffee_hint h ON h.response_id = a.response_id WHERE h.coffee_id = $1`, [coffeeId]);
    expect(accepted.rows).toHaveLength(0);
    expect((await getRoasterProfile(coffeeId)).ratings.length).toBe(6);
  });

  it('a coffee with no portal answers has no ratings and no methods', async () => {
    const none = (await db.query<{ id: number }>(
      `SELECT c.id FROM v_coffee c WHERE NOT EXISTS (SELECT 1 FROM v_roastery_portal_coffee pc WHERE pc.coffee_id = c.id) ORDER BY c.id LIMIT 1`)).rows[0];
    expect(none).toBeTruthy();
    expect(await getRoasterProfile(none.id)).toEqual({ whereItShines: [], scale: await roasterRatingMax(), ratings: [] });
  });
});

describe('the hold (call 4): a switch per roaster and dimension, beside the roaster’s answers', () => {
  it('withdraw shows the dimension again, a new hold hides it; the roaster’s answers never change', async () => {
    await withRollback(async ({ client }) => {
      const { coffeeId, roasterId } = await mapCoffee(client, 'Tiger Stripe');
      const mouthfeel = await dimId(client, 'Mouthfeel');
      const before = await answersHash(client);
      const labels = async () => (await getRoasterProfile(coffeeId, tx(client))).ratings.map(r => r.label);
      expect(await labels()).not.toContain('Mouthfeel');

      const w = await setDimensionHoldInTx(tx(client), { roasterId, dimensionId: mouthfeel, hold: false, reason: 'zzz test: show again', actorUid: UID });
      expect(w).toMatchObject({ isOpen: false, unchanged: false });
      expect(await labels()).toContain('Mouthfeel');
      expect((await getRoasterProfile(coffeeId, tx(client))).ratings.find(r => r.label === 'Mouthfeel')).toMatchObject({ value: 5, lowLabel: 'Silky', highLabel: 'Grippy' });
      // showing a pair with no open hold changes nothing
      expect(await setDimensionHoldInTx(tx(client), { roasterId, dimensionId: mouthfeel, hold: false, reason: 'again', actorUid: UID })).toMatchObject({ unchanged: true });

      const h = await setDimensionHoldInTx(tx(client), { roasterId, dimensionId: mouthfeel, hold: true, reason: 'zzz test: hide', actorUid: UID });
      expect(h).toMatchObject({ isOpen: true, unchanged: false });
      expect(await setDimensionHoldInTx(tx(client), { roasterId, dimensionId: mouthfeel, hold: true, reason: 'again', actorUid: UID })).toMatchObject({ unchanged: true, holdId: h.holdId });
      expect(await labels()).not.toContain('Mouthfeel');

      // another roaster's hold does not reach this coffee
      const other = await mapCoffee(client, 'The Daily');
      expect(other.roasterId).not.toBe(roasterId);
      const acidity = await dimId(client, 'Acidity');
      await setDimensionHoldInTx(tx(client), { roasterId: other.roasterId, dimensionId: acidity, hold: true, reason: 'zzz test', actorUid: UID });
      expect(await labels()).toContain('Acidity');
      expect((await getRoasterProfile(other.coffeeId, tx(client))).ratings.map(r => r.label)).not.toContain('Acidity');

      expect(await answersHash(client)).toBe(before);
    });
  });

  it('insert-only: an edited reason, a second withdraw and a DELETE all raise', async () => {
    await withRollback(async ({ client, savepoint }) => {
      const id = (await client.query<{ id: number }>(`SELECT id FROM v_roastery_portal_dimension_hold WHERE is_open ORDER BY id LIMIT 1`)).rows[0].id;
      await expect(savepoint(() => client.query(`UPDATE roastery_portal_dimension_hold SET reason = 'x' WHERE id = $1`, [id]))).rejects.toThrow(/insert-only/);
      await expect(savepoint(() => client.query(`DELETE FROM roastery_portal_dimension_hold WHERE id = $1`, [id]))).rejects.toThrow(/insert-only/);
      await client.query(`UPDATE roastery_portal_dimension_hold SET withdrawn_at = now(), withdrawn_by_uid = $2, withdrawn_reason = 'zzz' WHERE id = $1`, [id, UID]);
      await expect(savepoint(() => client.query(`UPDATE roastery_portal_dimension_hold SET withdrawn_reason = 'again' WHERE id = $1`, [id]))).rejects.toThrow(/insert-only/);
    });
  });

  it('refuses a hold with no reason, or on a dimension the portal does not ask', async () => {
    await withRollback(async ({ client, savepoint }) => {
      const { roasterId } = await mapCoffee(client, 'Tiger Stripe');
      const body = await dimId(client, 'Body');
      await expect(savepoint(() => setDimensionHoldInTx(tx(client), { roasterId, dimensionId: body, hold: true, reason: ' ', actorUid: UID }))).rejects.toBeInstanceOf(PortalError);
      const fragrance = (await client.query<{ id: number }>(`SELECT id FROM coffee_dimensions WHERE name = 'Fragrance'`)).rows[0].id;
      await expect(savepoint(() => setDimensionHoldInTx(tx(client), { roasterId, dimensionId: fragrance, hold: true, reason: 'zzz', actorUid: UID }))).rejects.toThrow(/portal dimension/);
    });
  });
});

describe('the script (Part A): copy rows and Mouthfeel held for both map roasters, through the writers', () => {
  it('a second run writes nothing', async () => {
    await withRollback(async ({ client }) => {
      await applyRoasterProfile(tx(client));
      const again = await planRoasterProfile(tx(client));
      expect(again.rows.filter(r => r.action === 'write')).toEqual([]);
      expect(again.rows.filter(r => r.section === 'hold')).toHaveLength(2 * HOLDS.length);
      const copy = new Map((await client.query<{ code: string; text: string }>(`SELECT code, text FROM v_dial_customer_copy`)).rows.map(r => [r.code, r.text]));
      for (const d of COPY) expect(copy.get(d.code)).toBe(d.text);
      expect(copy.get('notes_heading')).toBe('Notes');
      expect(copy.get('roaster_rates_caption')).toBe('Rated by the roaster, against their own coffees.');
    });
  });
});

describe('GET /api/coffees/:id/roaster-profile', () => {
  it('carries only methods, the scale and ratings: no roaster name or id, no respondent, no award', async () => {
    const { coffeeId, roasterId } = await mapCoffee(db, 'Tiger Stripe');
    const res = await fetch(`${baseUrl}/${coffeeId}/roaster-profile`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['ratings', 'scale', 'whereItShines']);
    for (const r of body.ratings) expect(Object.keys(r).sort()).toEqual(['highLabel', 'label', 'lowLabel', 'value']);
    const text = JSON.stringify(body);
    expect(text).not.toContain(roasterId);
    for (const n of await roasterNames()) expect(text).not.toContain(n);
    expect(text.toLowerCase()).not.toMatch(/award|premium|respondent|explore|confidence/);
  });

  it('a bad id is an empty profile, not an error', async () => {
    const body = await (await fetch(`${baseUrl}/abc/roaster-profile`)).json();
    expect(body).toEqual({ whereItShines: [], scale: await roasterRatingMax(), ratings: [] });
  });
});
