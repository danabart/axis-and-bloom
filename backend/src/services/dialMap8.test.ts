// Ella's Bloom Map 8 (2026-11-18), Part D: the map's availability rule at
// coffee grain, a map coffee bought as a direct line, the price check, the
// seed script twice and a switched-off size.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_8_PRICES_AND_BUYABLE.md
//
// Every case runs inside withRollback. The services under test read the
// global pool (resolveCart, the catalog reads), so db.query is routed to the
// rollback client while a case runs; nothing is committed. Each case enters
// Data 1 and Data 2 itself (the seed script's applyPrices, idempotent).
// Fixture coffees are marked "Zzz Map8".
import 'dotenv/config';
import { describe, it, expect, afterAll, vi } from 'vitest';
import type pg from 'pg';

const route = vi.hoisted(() => ({ client: null as null | { query: (...a: unknown[]) => unknown } }));
vi.mock('../db/client.js', async importOriginal => {
  const real = await importOriginal<typeof import('../db/client.js')>();
  const db = new Proxy(real.db, {
    get(target, key) {
      if (key === 'query' && route.client) return route.client.query.bind(route.client);
      const v = Reflect.get(target, key, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return { ...real, db };
});

const { db } = await import('../db/client.js');
type Tx = import('../db/client.js').Tx;
const { withRollback } = await import('../test/withRollback.js');
const { resolveCart, CartError } = await import('./cartResolver.js');
const { clearSizeCache, getPriceMismatches } = await import('./catalogReads.js');
const { checkSlotRetailPriceAgree } = await import('./catalogIntegrity.js');
const { setSizeActiveInTx, updateCoffeeInTx, CatalogError } = await import('./catalogService.js');
const { applyPrices, planPrices, DATA_1, DATA_2 } = await import('../scripts/ellaMapPrices_2026_11_18.js');
const dialReads = await import('./dialReads.js');

vi.setConfig({ testTimeout: 240_000 });
afterAll(async () => { await db.end(); });

const tx = (c: pg.PoolClient) => c as unknown as Tx;

/** Runs fn in a rolled-back transaction with every global db.query routed to it, Data 1 and 2 entered. */
async function inMap8<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  return withRollback(async ({ client }) => {
    route.client = client;
    clearSizeCache();
    try {
      await applyPrices(tx(client));
      clearSizeCache();
      return await fn(client);
    } finally {
      route.client = null;
      clearSizeCache();
    }
  });
}

const idOf = async (c: pg.PoolClient, name: string) =>
  (await c.query<{ id: number }>(`SELECT id FROM coffees WHERE name = $1 AND is_active AND id IN (SELECT coffee_id FROM v_dial_placement)`, [name])).rows[0].id;
const availability = async (c: pg.PoolClient, coffeeId: number) =>
  (await c.query(`SELECT * FROM v_dial_coffee_availability WHERE coffee_id = $1`, [coffeeId])).rows[0];

/** A marked fixture coffee of a real roaster, with the given SKU, price and category. */
async function fixtureCoffee(c: pg.PoolClient, o: { sku?: boolean; price?: number | null; category?: string }) {
  const roasterId = (await c.query<{ id: string }>(`SELECT id FROM roaster WHERE name = 'Joe Coffee Company'`)).rows[0].id;
  const id = (await c.query<{ id: number }>(
    `INSERT INTO coffees (name, roaster_id, is_active) VALUES ($1, $2, true) RETURNING id`, [`Zzz Map8 ${Date.now()}-${Math.random()}`, roasterId])).rows[0].id;
  if (o.sku) await c.query(`INSERT INTO coffee_sku (roaster_id, coffee_id, blend_name, weight_oz, is_active) VALUES ($1, $2, 'Zzz Map8', 12, true)`, [roasterId, id]);
  if (o.price != null) await c.query(`INSERT INTO coffee_retail_price (coffee_id, weight_oz, retail_price_cents) VALUES ($1, 12, $2)`, [id, o.price]);
  if (o.category) {
    await c.query(`INSERT INTO coffee_category_assignment (coffee_id, category_id) SELECT $1, id FROM coffee_category WHERE code = $2`, [id, o.category]);
  }
  return id;
}

describe('the map availability rule at coffee grain (A1)', () => {
  it('buyable with an active SKU and a retail price at the anchor size; not without either; decaf is buyable', async () => {
    await inMap8(async c => {
      const both = await fixtureCoffee(c, { sku: true, price: 2900 });
      const noPrice = await fixtureCoffee(c, { sku: true, price: null });
      const noSku = await fixtureCoffee(c, { sku: false, price: 2900 });
      const decaf = await fixtureCoffee(c, { sku: true, price: 2900, category: 'decaf' });
      expect(await availability(c, both)).toMatchObject({ is_sellable: true, in_stock: true, has_sku: true, has_price: true, price_cents: 2900, size_label: '12 oz' });
      expect(await availability(c, noPrice)).toMatchObject({ is_sellable: false, in_stock: true, has_sku: true, has_price: false });
      expect(await availability(c, noSku)).toMatchObject({ is_sellable: false, in_stock: false, has_sku: false, has_price: true });
      expect(await availability(c, decaf)).toMatchObject({ is_sellable: true });

      // a paused SKU or an inactive coffee is not buyable
      await c.query(`UPDATE coffee_sku SET is_active = false WHERE coffee_id = $1`, [both]);
      expect((await availability(c, both)).is_sellable).toBe(false);
      await c.query(`UPDATE coffee_sku SET is_active = true WHERE coffee_id = $1`, [both]);
      await c.query(`UPDATE coffees SET is_active = false WHERE id = $1`, [both]);
      expect((await availability(c, both)).is_sellable).toBe(false);
    });
  });

  it('after Data 1 every map coffee is buyable at its Data 1 price, under its Data 2 name', async () => {
    await inMap8(async c => {
      const map = await dialReads.mapCoffees(undefined, tx(c));
      expect(map.size).toBe(DATA_1.length);
      for (const d of DATA_1) {
        const row = map.get(await idOf(c, d.name))!;
        expect(row, d.name).toMatchObject({ is_sellable: true, price_cents: d.cents, weight_oz: 12 });
        expect(row.map_name).toBe(DATA_2.find(s => s.name === d.name)?.shortName ?? d.name);
      }
      expect(map.get(await idOf(c, 'Benchmark'))!.roaster_words.length).toBeGreaterThan(0);
    });
  });
});

describe('a map coffee bought as a direct line (B2)', () => {
  it('a coffee with no slot and one that also holds a slot: the pricing-table price, the map name; a stale price is refused', async () => {
    await inMap8(async c => {
      const daily = await idOf(c, 'The Daily');
      const laFamilia = await idOf(c, 'Colombia La Familia Guarnizo');
      const tiger = await idOf(c, 'Tiger Stripe Espresso');
      const village = await idOf(c, 'The Village');
      const feminista = await idOf(c, 'Cafè Feminista: Montze Olvera');
      const cart = await resolveCart([
        { coffeeId: daily, weightOz: 12, quantity: 1, priceCents: 2900 },
        { coffeeId: laFamilia, weightOz: 12, quantity: 1, priceCents: 2900 },
        { coffeeId: tiger, weightOz: 12, quantity: 1, priceCents: 3200 },
        { coffeeId: village, weightOz: 12, quantity: 1, priceCents: 3200 },
        { coffeeId: feminista, weightOz: 12, quantity: 1, priceCents: 2900 },
      ]);
      expect(cart.lines.map(l => [l.displayName, l.unitPriceCents, l.source])).toEqual([
        ['The Daily', 2900, 'direct'], ['La Familia', 2900, 'direct'], ['Tiger Stripe', 3200, 'direct'],
        ['The Village', 3200, 'direct'], ['Cafè Feminista', 2900, 'direct'],
      ]);
      // two coffees on one slot no longer share its house name
      expect(new Set(cart.lines.map(l => l.displayName)).size).toBe(5);
      expect(JSON.stringify(cart)).not.toMatch(/Joe Coffee|Joe Bean|Clean Fruit|Light Floral Edge|Coado/);

      const err = await resolveCart([{ coffeeId: daily, weightOz: 12, quantity: 1, priceCents: 3200 }]).then(() => null, e => e);
      expect(err).toBeInstanceOf(CartError);
      expect(err).toMatchObject({ status: 409, code: 'price_changed' });
    });
  });

  it('the old Bloom page dial line keeps its slot house name', async () => {
    await inMap8(async c => {
      const slot = (await c.query(`SELECT archetype, sort_order, slot_name, retail_price_cents FROM v_coffee_sellable_slot WHERE coffee_name = 'Benchmark' AND weight_oz = 12`)).rows[0];
      const cart = await resolveCart([{ archetype: slot.archetype, dialSortOrder: slot.sort_order, weightOz: 12, quantity: 1, priceCents: slot.retail_price_cents }]);
      expect(cart.lines[0]).toMatchObject({ displayName: slot.slot_name, source: 'dial', unitPriceCents: 2900 });
    });
  });

  it('a switched-off size is refused with the existing "unavailable" message', async () => {
    await inMap8(async c => {
      const daily = await idOf(c, 'The Daily');
      const roasterId = (await c.query<{ roaster_id: string }>(`SELECT roaster_id FROM coffees WHERE id = $1`, [daily])).rows[0].roaster_id;
      await setSizeActiveInTx(tx(c), { weightOz: 32, isActive: true }, { actor: 'vitest' });
      await c.query(`INSERT INTO coffee_sku (roaster_id, coffee_id, blend_name, weight_oz, is_active) VALUES ($1, $2, 'Zzz Map8 2 lb', 32, true)`, [roasterId, daily]);
      await c.query(`INSERT INTO coffee_retail_price (coffee_id, weight_oz, retail_price_cents) VALUES ($1, 32, 6500)`, [daily]);
      const on = await resolveCart([{ coffeeId: daily, weightOz: 32, quantity: 1, priceCents: 6500 }]);
      expect(on.lines[0]).toMatchObject({ weightOz: 32, unitPriceCents: 6500 });

      await setSizeActiveInTx(tx(c), { weightOz: 32, isActive: false }, { actor: 'vitest' });
      const err = await resolveCart([{ coffeeId: daily, weightOz: 32, quantity: 1, priceCents: 6500 }]).then(() => null, e => e);
      expect(err).toBeInstanceOf(CartError);
      expect(err).toMatchObject({ status: 409, code: 'unavailable' });
      expect(err.message).toBe('This coffee is not currently available at 32oz');
      // the anchor cannot be switched off; the size row is kept
      await expect(setSizeActiveInTx(tx(c), { weightOz: 12, isActive: false }, { actor: 'vitest' })).rejects.toBeInstanceOf(CatalogError);
      expect((await c.query(`SELECT count(*)::int AS n FROM coffee_size`)).rows[0].n).toBe(3);
    });
  });
});

describe('the price check (A3)', () => {
  it('clean after Data 1; lists a coffee whose winning slot price and retail price differ', async () => {
    await inMap8(async c => {
      expect(await getPriceMismatches(tx(c))).toEqual([]);
      expect((await checkSlotRetailPriceAgree({ tx: tx(c) })).pass).toBe(true);
      const benchmark = await idOf(c, 'Benchmark');
      await c.query(`UPDATE coffee_retail_price SET retail_price_cents = 3100 WHERE coffee_id = $1 AND weight_oz = 12`, [benchmark]);
      const check = await checkSlotRetailPriceAgree({ tx: tx(c) });
      expect(check).toMatchObject({ id: 15, pass: false, severity: 'info' });
      expect(check.details).toEqual([expect.stringContaining('Benchmark')]);
      expect(check.details![0]).toContain('$29.00');
      expect(check.details![0]).toContain('$31.00');
      // The Village sits second on a $29.00 slot it does not win: not compared (Dana's answer 1)
      expect(check.details!.some(d => d.includes('The Village'))).toBe(false);
    });
  });
});

describe('the seed script (B3)', () => {
  it('writes the plan once, then nothing; never a 2 lb or 5 lb price', async () => {
    await withRollback(async ({ client: c }) => {
      route.client = c;
      try {
        // back to the state before this brief, inside the rollback
        const ids = (await c.query<{ coffee_id: number }>(`SELECT DISTINCT coffee_id FROM v_dial_placement`)).rows.map(r => r.coffee_id);
        await c.query(`DELETE FROM coffee_retail_price WHERE coffee_id = ANY($1::int[])`, [ids]);
        await c.query(`UPDATE coffees SET short_name = NULL WHERE id = ANY($1::int[])`, [ids]);
        await c.query(`UPDATE coffee_size SET is_active = true`);
        clearSizeCache();
        const priceRowsBefore = Number((await c.query(`SELECT count(*) AS n FROM coffee_retail_price WHERE weight_oz <> 12`)).rows[0].n);
        const changeIdsBefore = (await c.query(`SELECT id FROM catalog_change WHERE changed_by = 'script:ellaMapPrices_2026_11_18'`)).rows.map(r => r.id);

        const first = await applyPrices(tx(c));
        clearSizeCache();
        expect(first.plan.missing).toEqual([]);
        expect(first.plan.writes.price).toHaveLength(18);
        expect(first.plan.writes.shortName).toHaveLength(7);
        expect(first.plan.writes.sizesOff).toEqual([32, 80]);
        expect(first.after.rows.every(r => r.action === 'unchanged')).toBe(true);

        const second = await applyPrices(tx(c));
        expect(second.written).toBe(0);
        expect((await planPrices(tx(c))).rows.filter(r => r.action === 'write')).toEqual([]);
        expect(Number((await c.query(`SELECT count(*) AS n FROM coffee_retail_price WHERE weight_oz <> 12`)).rows[0].n)).toBe(priceRowsBefore);
        expect((await c.query(`SELECT weight_oz::int AS w, is_active FROM coffee_size ORDER BY 1`)).rows)
          .toEqual([{ w: 12, is_active: true }, { w: 32, is_active: false }, { w: 80, is_active: false }]);
        // every map coffee has one active 12 oz SKU; each SKU the seed made has a minted code and no cost
        const skus = (await c.query(`SELECT coffee_id, roaster_sku, cost_to_us FROM coffee_sku WHERE coffee_id = ANY($1::int[]) AND is_active AND weight_oz = 12`, [ids])).rows;
        expect(skus).toHaveLength(18);
        const made = await c.query(`SELECT after->>'roaster_sku' AS code, after->>'cost_to_us' AS cost FROM catalog_change WHERE changed_by = 'script:ellaMapPrices_2026_11_18' AND action = 'upsertSku' AND NOT (id = ANY($1::uuid[]))`, [changeIdsBefore]);
        expect(made.rows).toHaveLength(first.plan.writes.sku.length);
        for (const m of made.rows) { expect(m.code).toMatch(/^AB-\d{4,}$/); expect(m.cost).toBeNull(); }
      } finally {
        route.client = null;
        clearSizeCache();
      }
    });
  });

  it('a short name is trimmed, cannot be blank or carry the roaster name, and null clears it', async () => {
    await inMap8(async c => {
      const daily = await idOf(c, 'The Daily');
      await updateCoffeeInTx(tx(c), { coffeeId: daily, shortName: '  Daily  ' });
      expect((await availability(c, daily)).map_name).toBe('Daily');
      await expect(updateCoffeeInTx(tx(c), { coffeeId: daily, shortName: ' ' })).rejects.toBeInstanceOf(CatalogError);
      await expect(updateCoffeeInTx(tx(c), { coffeeId: daily, shortName: 'Joe Coffee Company Daily' })).rejects.toBeInstanceOf(CatalogError);
      await updateCoffeeInTx(tx(c), { coffeeId: daily, shortName: null });
      expect((await availability(c, daily)).map_name).toBe('The Daily');
    });
  });
});
