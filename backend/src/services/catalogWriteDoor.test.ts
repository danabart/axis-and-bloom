// Catalog write-door brief (2026-09-30) — retail prices and categories now go
// through catalogService verbs; SKU pause/resume replaces stock tracking.
// Real verbs against the isolated axisandbloom_test database ('Vitest WD'
// fixtures, cleanup in finally/afterAll).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import coffeesRouter from '../routes/coffees.js';
import { db } from '../db/client.js';
import {
  createCoffee, setMatchArchetype, upsertSku, updateCoffee, setCoffeeRetailPrice,
  createCategory, updateCategory, deleteCategory,
} from './catalogService.js';
import { getCategories, getCoffeeRetailPrices } from './catalogReads.js';

const ACTOR = { actor: 'vitest' };
let server: Server;
let baseUrl: string;
let roasterId: string;

async function cleanup() {
  await db.query(`DELETE FROM coffee_category_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest WD%')`);
  await db.query(`DELETE FROM coffee_retail_price WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest WD%')`);
  await db.query(`DELETE FROM coffee_archetype_assignment WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest WD%')`);
  await db.query(`DELETE FROM coffee_sku WHERE coffee_id IN (SELECT id FROM coffees WHERE name LIKE 'Vitest WD%')`);
  await db.query(`DELETE FROM coffees WHERE name LIKE 'Vitest WD%'`);
  await db.query(`DELETE FROM coffee_category WHERE code LIKE 'vitest_wd_%'`);
  await db.query(`DELETE FROM roaster WHERE name LIKE 'Vitest WD%'`);
}

beforeAll(async () => {
  await cleanup();
  roasterId = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest WD Roastery', true) RETURNING id`)).rows[0].id;
  const app = express();
  app.use(express.json());
  app.use('/api/coffees', coffeesRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/coffees`;
}, 20000);

afterAll(async () => {
  await cleanup();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

async function makeCoffee(name: string) {
  const { result } = await createCoffee({ roasterId, name }, ACTOR);
  await setMatchArchetype({ coffeeId: result.coffeeId, archetype: 'earthy', confidence: 'high', source: 'manual' }, ACTOR);
  return result.coffeeId;
}

describe('setCoffeeRetailPrice', () => {
  it('refuses an unknown size (UNKNOWN_SIZE) and writes nothing', async () => {
    const coffeeId = await makeCoffee('Vitest WD Price A');
    await expect(setCoffeeRetailPrice({ coffeeId, weightOz: 48, retailPriceCents: 1000 }, ACTOR))
      .rejects.toMatchObject({ code: 'UNKNOWN_SIZE', status: 400 });
    expect((await getCoffeeRetailPrices({ includeInactive: true })).filter(r => r.coffee_id === coffeeId)).toEqual([]);
  }, 20000);

  it('at 12 oz upserts the price and logs a catalog change row', async () => {
    const coffeeId = await makeCoffee('Vitest WD Price B');
    const { result } = await setCoffeeRetailPrice({ coffeeId, weightOz: 12, retailPriceCents: 1900 }, ACTOR);
    expect(result).toMatchObject({ coffee_id: coffeeId, retail_price_cents: 1900 });
    await setCoffeeRetailPrice({ coffeeId, weightOz: 12, retailPriceCents: 2100 }, ACTOR);
    const prices = (await getCoffeeRetailPrices()).filter(r => r.coffee_id === coffeeId);
    expect(prices.map(p => p.retail_price_cents)).toEqual([2100]);
    const changes = await db.query(
      `SELECT action, before, after FROM catalog_change WHERE entity = 'coffee_retail_price' AND entity_id = $1 ORDER BY occurred_at`, [`${coffeeId}:12`]
    );
    expect(changes.rows.map(r => r.action)).toEqual(['setCoffeeRetailPrice', 'setCoffeeRetailPrice']);
    expect(changes.rows[1].before.retail_price_cents).toBe(1900);
    expect(changes.rows[1].after.retail_price_cents).toBe(2100);
  }, 20000);
});

describe('categories', () => {
  it('create / rename / deactivate; a category with assignments cannot be deleted (409, assignments intact); an unused one can', async () => {
    const { result: cat } = await createCategory({ code: 'vitest_wd_used', label: 'Vitest WD Used' }, ACTOR);
    expect(cat).toMatchObject({ code: 'vitest_wd_used', is_active: true, is_hoppable: false });
    await expect(createCategory({ code: 'vitest_wd_used', label: 'dup' }, ACTOR)).rejects.toMatchObject({ code: 'CATEGORY_EXISTS', status: 409 });

    const coffeeId = await makeCoffee('Vitest WD Tagged');
    await updateCoffee({ coffeeId, categoryCodes: ['vitest_wd_used'] }, ACTOR);
    const countAssignments = async () => Number((await db.query(`SELECT COUNT(*) AS c FROM coffee_category_assignment WHERE category_id = $1`, [cat.id])).rows[0].c);
    expect(await countAssignments()).toBe(1);

    await expect(deleteCategory({ categoryId: cat.id }, ACTOR)).rejects.toMatchObject({ code: 'CATEGORY_IN_USE', status: 409, message: expect.stringContaining('1 coffee') });
    expect(await countAssignments()).toBe(1);
    expect((await getCategories()).some(c => c.id === cat.id)).toBe(true);

    const { result: renamed } = await updateCategory({ categoryId: cat.id, label: 'Vitest WD Renamed', isActive: false }, ACTOR);
    expect(renamed).toMatchObject({ label: 'Vitest WD Renamed', is_active: false });
    await expect(updateCategory({ categoryId: cat.id }, ACTOR)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(updateCategory({ categoryId: 999999, label: 'x' }, ACTOR)).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND', status: 404 });

    const { result: unused } = await createCategory({ code: 'vitest_wd_unused', label: 'Vitest WD Unused' }, ACTOR);
    await deleteCategory({ categoryId: unused.id }, ACTOR);
    expect((await getCategories()).some(c => c.id === unused.id)).toBe(false);
  }, 30000);
});

describe('SKU availability is is_active (no stock)', () => {
  it('pause then resume re-uses the same row (no duplicate), and stock columns are never written', async () => {
    const coffeeId = await makeCoffee('Vitest WD Pause');
    const { result: first } = await upsertSku({ coffeeId, weightOz: 12, isActive: true }, ACTOR);
    const stock = async () => (await db.query(`SELECT quantity_available, safety_stock_buffer, inventory_status FROM coffee_sku WHERE id = $1`, [first.blendId])).rows[0];
    const defaults = await stock();

    const { result: paused } = await upsertSku({ coffeeId, weightOz: 12, isActive: false }, ACTOR);
    expect(paused.blendId).toBe(first.blendId);
    expect((await db.query(`SELECT is_active FROM coffee_sku WHERE id = $1`, [first.blendId])).rows[0].is_active).toBe(false);

    const { result: resumed } = await upsertSku({ coffeeId, weightOz: 12, isActive: true }, ACTOR);
    expect(resumed.blendId).toBe(first.blendId);
    expect(Number((await db.query(`SELECT COUNT(*) AS c FROM coffee_sku WHERE coffee_id = $1`, [coffeeId])).rows[0].c)).toBe(1);
    expect(await stock()).toEqual(defaults);
  }, 30000);
});

describe('GET /api/coffees/other-categories', () => {
  it('serves a tagged, priced, SKU-backed fixture coffee with its 12 oz price, unchanged in shape', async () => {
    const coffeeId = await makeCoffee('Vitest WD Decaf');
    await upsertSku({ coffeeId, weightOz: 12, isActive: true }, ACTOR);
    await updateCoffee({ coffeeId, categoryCodes: ['decaf'] }, ACTOR);
    await setCoffeeRetailPrice({ coffeeId, weightOz: 12, retailPriceCents: 2200 }, ACTOR);

    const rows = await (await fetch(`${baseUrl}/other-categories`)).json();
    const row = rows.find((r: { coffeeId: number }) => r.coffeeId === coffeeId);
    expect(row).toBeTruthy();
    expect(row.categories.map((c: { code: string }) => c.code)).toEqual(['decaf']);
    expect(row.prices).toEqual([{ weightOz: 12, retailPriceCents: 2200, isActive: true, label: '12 oz', isAnchor: true }]);
    expect(row).toMatchObject({ effectivelyActive: true, isUnpriced: false });
  }, 30000);
});
