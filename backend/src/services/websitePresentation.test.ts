// Website 2 (2026-11-04), Part D — presentation data the handoff needs.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_2_PRESENTATION_DATA.md
// Runs on the test DB (vitest.config.ts guard). Fixtures follow
// routes/coffees.test.ts: a Vitest roaster and coffee placed on a free slot
// (never a live one, test/freeSlots.ts), removed in afterAll.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import coffeesRouter from '../routes/coffees.js';
import homeRouter from '../routes/home.js';
import { db } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import { freeSlotsInOneArchetype } from '../test/freeSlots.js';
import { createCoffee, upsertSku, placeCoffee, setSlotPrice, setCoffeePresentation, CatalogError } from './catalogService.js';
import { computeCollectionOfferFromSlots, type Slot } from './coffeeCardReads.js';
import { commerceParam, commerceParamText } from './commerceParameters.js';
import { parseDialSlot } from './homeContentReads.js';

const ACTOR = { actor: 'vitest' };
const OZ = 12;
let server: Server;
let base: string;
let fixture: { coffeeId: number; slotId: number; archetype: string; sortOrder: number };

async function getJson(path: string) {
  const res = await fetch(`${base}${path}`);
  expect(res.status).toBe(200);
  return res.json();
}
async function findCard(coffeeId: number) {
  const body = await getJson('/coffees/cards');
  for (const f of body.families) for (const c of f.cards) if (c.coffeeId === coffeeId) return c;
  return null;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/coffees', coffeesRouter);
  app.use('/api/home', homeRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api`;

  const roaster = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Website2 Roastery', true) RETURNING id`)).rows[0];
  const { result: created } = await createCoffee({ roasterId: roaster.id, name: 'Vitest Website2 Coffee' }, ACTOR);
  const [slot] = await freeSlotsInOneArchetype(1, { archetype: 'floral' });
  await upsertSku({ coffeeId: created.coffeeId, weightOz: OZ, blendName: 'Vitest Website2 Blend', isActive: true }, ACTOR);
  await placeCoffee({ coffeeId: created.coffeeId, slotId: slot.id, role: 'home' }, ACTOR);
  await setSlotPrice({ slotId: slot.id, weightOz: OZ, retailPriceCents: 1800 }, ACTOR);
  fixture = { coffeeId: created.coffeeId, slotId: slot.id, archetype: 'floral', sortOrder: slot.sortOrder };
}, 30000);

afterAll(async () => {
  await db.query(`DELETE FROM coffee_presentation WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest Website2%')`);
  await db.query(`DELETE FROM coffee_slot_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest Website2%')`);
  await db.query(`DELETE FROM coffee_archetype_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest Website2%')`);
  await db.query(`DELETE FROM coffee_sku WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest Website2%')`);
  if (fixture) await db.query(`DELETE FROM coffee_slot_price WHERE slot_id = $1 AND weight_oz = $2`, [fixture.slotId, OZ]);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest Website2%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest Website2%'`);
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('seeds (WEBSITE 2 block of schema.sql)', () => {
  const schema = readFileSync(fileURLToPath(new URL('../db/schema.sql', import.meta.url)), 'utf8');
  const block = schema.slice(schema.indexOf('-- BEGIN WEBSITE 2 block'), schema.indexOf('-- END WEBSITE 2 block'));

  async function counts(client: { query: typeof db.query }) {
    const q = async (sql: string) => Number((await client.query<{ n: string }>(sql)).rows[0].n);
    return {
      quotes: await q(`SELECT COUNT(*) AS n FROM marketing_home_quote`),
      milk: await q(`SELECT COUNT(*) AS n FROM coffee_milk_recommendation`),
      featured: await q(`SELECT COUNT(*) AS n FROM commerce_parameter WHERE key = 'home_featured_slot'`),
      words: await q(`SELECT COUNT(*) AS n FROM coffee_archetype WHERE customer_words IS NOT NULL`),
    };
  }

  it('running the block twice changes nothing (insert only if missing)', async () => {
    expect(block.length).toBeGreaterThan(100);
    await withRollback(async ({ client }) => {
      const before = await counts(client as any);
      await client.query(block);
      await client.query(block);
      expect(await counts(client as any)).toEqual(before);
    });
  });

  it('seeds the eight quotes, three milk rows, one featured slot and words for the five families only', async () => {
    const c = await counts(db);
    expect(c.quotes).toBeGreaterThanOrEqual(8);
    expect(c.milk).toBe(3);
    expect(c.featured).toBe(1);
    const words = (await db.query<{ code: string; customer_words: string[] | null; is_archetype: boolean }>(
      `SELECT code, customer_words, is_archetype FROM coffee_archetype`)).rows;
    for (const w of words) {
      if (w.is_archetype) expect(w.customer_words).toHaveLength(3);
      else expect(w.customer_words).toBeNull();
    }
    const milk = (await db.query(`SELECT code, portal_takes_it FROM coffee_milk_recommendation ORDER BY sort_order`)).rows;
    expect(milk.map(m => m.portal_takes_it)).toEqual(['black', 'both', 'milk']);
  });

  it('the featured slot defaults to the Chocolate & Nutty landing-default slot', async () => {
    const value = parseDialSlot(await commerceParamText('home_featured_slot'));
    const slot = (await db.query(`SELECT archetype::text AS archetype, sort_order FROM coffee_dial_slot WHERE archetype = 'chocolate_nutty' AND is_landing_default`)).rows[0];
    expect(value).toEqual({ archetype: slot.archetype, sortOrder: slot.sort_order });
  });

  it('customer_words must have exactly three entries', async () => {
    await withRollback(async ({ client, savepoint }) => {
      await expect(savepoint(() => client.query(`UPDATE coffee_archetype SET customer_words = ARRAY['One','Two'] WHERE code = 'floral'`))).rejects.toThrow(/customer_words_three/);
    });
  });
});

describe('v_coffee_card and GET /api/coffees/cards', () => {
  it('a coffee with no presentation row has NULL hint and milk, and its card omits the keys', async () => {
    const row = (await db.query(`SELECT hint, milk_code, photo_asset_key FROM v_coffee_card WHERE coffee_id = $1`, [fixture.coffeeId])).rows[0];
    expect(row).toEqual({ hint: null, milk_code: null, photo_asset_key: null });
    const card = await findCard(fixture.coffeeId);
    expect(card).not.toBeNull();
    for (const key of ['hint', 'milk', 'photoKey', 'bestBrew', 'originRegion']) expect(key in card).toBe(false);
    expect(card.signatureNotes).toEqual([]);
    expect(card.alsoGood).toEqual([]);
  });

  it('exposes the award as a boolean only: no tag label, no remark text, no roaster or raw coffee name', async () => {
    const body = await getJson('/coffees/cards');
    const json = JSON.stringify(body);
    const awardLabel = (await db.query(`SELECT label FROM lookup_value WHERE category = 'coffee_card_tag' AND value = 'award'`)).rows[0]?.label;
    if (awardLabel) expect(json).not.toContain(awardLabel);
    const remarks = (await db.query(`SELECT remark FROM v_roastery_remark WHERE topic = 'award'`)).rows.map(r => String(r.remark));
    for (const r of remarks) expect(json).not.toContain(r);
    expect(json).not.toContain('Vitest Website2 Roastery');
    expect(json).not.toContain('Vitest Website2 Coffee');
    for (const f of body.families) for (const c of f.cards) {
      expect('tags' in c).toBe(false);
      if (c.coffeeId) expect(typeof c.hasAward).toBe('boolean');
    }
    for (const c of body.other.cards) expect(typeof c.hasAward).toBe('boolean');
  });

  it('returns the five families in sort_order with their words', async () => {
    const body = await getJson('/coffees/cards');
    const families = (await db.query(`SELECT code::text, customer_words FROM coffee_archetype WHERE is_archetype ORDER BY sort_order`)).rows;
    expect(body.families.map((f: any) => f.archetype)).toEqual(families.map(f => f.code));
    expect(body.families.map((f: any) => f.customerWords)).toEqual(families.map(f => f.customer_words));
  });

  it("each family's collection price equals the discount rule", async () => {
    const pct = await commerceParam('collection_discount_pct');
    const body = await getJson('/coffees/cards');
    for (const f of body.families) {
      if (!f.collectionOffer) continue;
      expect(f.collectionOffer.discountedCents).toBe(Math.round(f.collectionOffer.sumCents * (1 - pct / 100)));
    }
    const min = await commerceParam('collection_min_members');
    const slot = (i: number): Slot => ({
      dialSortOrder: i, positionLabel: `p${i}`, description: null, isActive: true, platformName: `n${i}`, isDefault: false,
      prices: [{ weightOz: OZ, retailPriceCents: 1000 * i, label: '12 oz', isAnchor: true }], coffeeId: i,
    });
    const enough = Array.from({ length: min }, (_, i) => slot(i + 1));
    const sum = enough.reduce((s, x) => s + x.prices[0].retailPriceCents, 0);
    expect(await computeCollectionOfferFromSlots(enough, OZ)).toEqual({ memberCount: min, sumCents: sum, discountedCents: Math.round(sum * (1 - pct / 100)) });
    expect(await computeCollectionOfferFromSlots(enough.slice(0, min - 1), OZ)).toBeNull();
  });

  it('GET /archetypes carries customerWords', async () => {
    const list = await getJson('/coffees/archetypes');
    for (const a of list) expect(Array.isArray(a.customerWords) ? a.customerWords.length : 3).toBe(3);
  });
});

describe('setCoffeePresentation (the one writer)', () => {
  it('writes one row, is idempotent, and the card shows it', async () => {
    const first = await setCoffeePresentation({ coffeeId: fixture.coffeeId, hint: '  a hint of citrus  ', milkCode: 'either', photoAssetKey: 'shop/vitest' }, ACTOR);
    expect(first.result).toMatchObject({ hint: 'a hint of citrus', milkCode: 'either', photoAssetKey: 'shop/vitest', unchanged: false });
    const again = await setCoffeePresentation({ coffeeId: fixture.coffeeId, hint: 'a hint of citrus', milkCode: 'either', photoAssetKey: 'shop/vitest' }, ACTOR);
    expect(again.result.unchanged).toBe(true);
    const rows = (await db.query(`SELECT COUNT(*)::int AS n FROM coffee_presentation WHERE coffee_id = $1`, [fixture.coffeeId])).rows[0];
    expect(rows.n).toBe(1);
    const card = await findCard(fixture.coffeeId);
    const customerLabel = (await db.query(`SELECT customer_label FROM coffee_milk_recommendation WHERE code = 'either'`)).rows[0].customer_label;
    expect(card).toMatchObject({ hint: 'a hint of citrus', milk: customerLabel, photoKey: 'shop/vitest' });
    const view = (await db.query(`SELECT milk_source FROM v_coffee_card WHERE coffee_id = $1`, [fixture.coffeeId])).rows[0];
    expect(view.milk_source).toBe('editorial');
  });

  it('a field left out keeps its value; blank clears it', async () => {
    await setCoffeePresentation({ coffeeId: fixture.coffeeId, hint: '' }, ACTOR);
    const row = (await db.query(`SELECT hint, photo_asset_key FROM v_coffee_card WHERE coffee_id = $1`, [fixture.coffeeId])).rows[0];
    expect(row).toEqual({ hint: null, photo_asset_key: 'shop/vitest' });
  });

  it('refuses an unknown milk code and an unknown coffee', async () => {
    await expect(setCoffeePresentation({ coffeeId: fixture.coffeeId, milkCode: 'oat' }, ACTOR)).rejects.toBeInstanceOf(CatalogError);
    await expect(setCoffeePresentation({ coffeeId: -1, hint: 'x' }, ACTOR)).rejects.toMatchObject({ code: 'COFFEE_NOT_FOUND' });
  });

  it('is the only writer declared for coffee_presentation', async () => {
    const comments = readFileSync(fileURLToPath(new URL('../db/comments.sql', import.meta.url)), 'utf8');
    const line = comments.split('\n').find(l => l.startsWith('COMMENT ON TABLE coffee_presentation IS'));
    expect(line).toMatch(/\| Writer: catalogService\.setCoffeePresentation \|/);
  });
});

describe('GET /api/coffees/archetypes (Website 3)', () => {
  it('carries each family sort_order, in that order', async () => {
    const body = await getJson('/coffees/archetypes');
    const rows = (await db.query(`SELECT code, sort_order FROM coffee_archetype WHERE is_archetype ORDER BY sort_order`)).rows;
    expect(body.map((a: any) => [a.archetype, a.sortOrder])).toEqual(rows.map(r => [r.code, r.sort_order]));
  });
});

describe('GET /api/home/content', () => {
  it('facts match direct queries', async () => {
    const body = await getJson('/home/content');
    const q = async (sql: string) => Number((await db.query<{ n: string }>(sql)).rows[0].n);
    expect(body.facts).toEqual({
      questions: await q(`SELECT COUNT(*) AS n FROM quiz_question qq JOIN quiz q ON q.id = qq.quiz_id JOIN quiz_type t ON t.id = q.quiz_type_id WHERE q.is_active AND t.name = 'main' AND qq.is_current`),
      dimensions: await q(`SELECT COUNT(DISTINCT r.dimension_id) AS n FROM v_coffee_dimension_range r JOIN coffee_dimensions d ON d.id = r.dimension_id WHERE d.is_numeric AND r.value_min IS NOT NULL AND r.value_max IS NOT NULL`),
      families: await q(`SELECT COUNT(*) AS n FROM coffee_archetype WHERE is_archetype`),
      scaleMin: expect.anything(),
      scaleMax: expect.anything(),
    });
    // Website 3: the score line is the counted numeric dimensions' own scale
    const sc = (await db.query(`SELECT MIN(d.scale_min) AS lo, MAX(d.scale_max) AS hi FROM coffee_dimensions d WHERE d.is_numeric AND d.id IN (SELECT dimension_id FROM v_coffee_dimension_range WHERE value_min IS NOT NULL AND value_max IS NOT NULL)`)).rows[0];
    expect(body.facts.scaleMin).toBe(Number(sc.lo));
    expect(body.facts.scaleMax).toBe(Number(sc.hi));
  });

  it('quotes are the active rows in order; the featured card is the parameter slot', async () => {
    const body = await getJson('/home/content');
    const quotes = (await db.query(`SELECT quote FROM marketing_home_quote WHERE is_active ORDER BY sort_order, id`)).rows.map(r => r.quote);
    expect(body.quotes).toEqual(quotes);
    const slot = parseDialSlot(await commerceParamText('home_featured_slot'))!;
    expect(body.featured.card).toMatchObject({ archetype: slot.archetype, dialSortOrder: slot.sortOrder });
    if (body.featured.card.prices.length) expect(body.featured.price.retailPriceCents).toBe(body.featured.card.prices.find((p: any) => p.isAnchor)?.retailPriceCents ?? body.featured.card.prices[0].retailPriceCents);
    else expect(body.featured.price).toBeNull();
  });
});
