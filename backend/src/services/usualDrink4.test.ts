// Usual Drink 4 (2026-11-26), Part D — the richer kitchen list: the seed (B2),
// products read under their brand (Dana's decision 3, a product added after the
// seed included), Liam's list without products (decision 5), the promote and
// retire door (C2), an old typed name resolving on read (C3, labels first:
// decision 2), the product's brand on /map (decision 4), check 34 and the
// admin's typed names (C1). The route's 403 is in routes/brewProfileAdmin.kitchen.test.ts.
// backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_4_PAGE_FIXES_AND_KITCHEN_LIST.md
//
// Test DB only. Every write sits in a rolled-back transaction (withRollback).
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';

vi.mock('./brewProfile.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./brewProfile.js')>();
  return { ...actual, incrementBrewProfileCounter: vi.fn(async () => undefined) };
});

const { db } = await import('../db/client.js');
const { withRollback } = await import('../test/withRollback.js');
const brew = await import('./brewProfile.js');
const { saveRoutine, brewProfileOptions } = await import('./brewProfileCard.js');
const reads = await import('./customerReads.js');
const kitchen = await import('./brewKitchenList.js');
const integrity = await import('./customerIntegrity.js');
const { brewTextParams } = await import('./brewParameters.js');

vi.setConfig({ testTimeout: 120_000 });
beforeAll(async () => { await brew.loadBrewProfileFields(); });
afterAll(async () => { await brew.loadBrewProfileFields(); await db.end(); });

type C = pg.PoolClient;
const cfg = (code: string) => brew.getBrewProfileFieldsConfig()[code];
const codes = (field: string) => cfg(field).values.map(v => v.code);

async function customer(c: C) {
  const uid = `zzz-ud4-${randomUUID()}`;
  const userId = (await c.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Zzz UD4') RETURNING id`, [uid])).rows[0].id;
  return { uid, userId };
}
const save = (c: C, uid: string, answers: Array<{ field: string; value: unknown; words?: string }>) =>
  saveRoutine({ uid, answers, cleared: [] }, `ev-${randomUUID()}`, c);
const changeRows = async (c: C, userId: string) => (await c.query(
  `SELECT id::text, op, value, customer_words FROM customer_brew_profile_change WHERE user_id = $1 ORDER BY id`, [userId])).rows;
const kitchenOf = (c: C, userId: string) => reads.getCupboardCoffee({ profileId: userId }, c);

describe('the seed (B1, B2)', () => {
  it('229 brands and 100 products, each product with its brand and the brand kind', async () => {
    const r = (await db.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE b.parent_brand_id IS NOT NULL)::int AS products
       FROM brew_profile_field_value fv JOIN brew_profile_field f ON f.id = fv.field_id
       JOIN brew_cupboard_brand b ON b.field_value_id = fv.id WHERE f.code = 'cupboard_coffee'`)).rows[0];
    expect(r.n).toBeGreaterThanOrEqual(388);
    expect(r.products).toBeGreaterThanOrEqual(100);
    const pike = (await db.query(
      `SELECT pfv.code AS parent, k.code AS kind, pk.code AS parent_kind FROM brew_cupboard_brand b
       JOIN brew_profile_field_value fv ON fv.id = b.field_value_id
       JOIN brew_cupboard_brand pb ON pb.id = b.parent_brand_id JOIN brew_profile_field_value pfv ON pfv.id = pb.field_value_id
       JOIN brew_cupboard_brand_kind k ON k.id = b.brand_kind_id JOIN brew_cupboard_brand_kind pk ON pk.id = pb.brand_kind_id
       WHERE fv.code = 'starbucks_pike_place_roast'`)).rows[0];
    expect(pike).toEqual({ parent: 'starbucks', kind: 'chain', parent_kind: 'chain' });
    expect(cfg('cupboard_coffee').values.find(v => v.code === 'tatte_bakery_and_cafe')).toMatchObject({ label: 'Tatte Bakery & Café', aliases: ['tatte'], pinned: false });
    // decision 1: the CSV's "shoprite" stays on the store brand only
    expect(cfg('cupboard_coffee').values.find(v => v.code === 'bowl_and_basket')!.aliases).toEqual([]);
    expect(cfg('cupboard_coffee').values.find(v => v.code === 'store_brand')!.aliases).toContain('shoprite');
    expect((await integrity.checkUsualDrinkSeedCoverage()).pass).toBe(true);
    expect((await integrity.checkBrewDecompositions()).pass).toBe(true);
    expect((await integrity.checkKitchenProductParents()).pass).toBe(true);
  });

  it('the brew cards sentence is a row', async () => {
    expect((await brewTextParams()).brew_cards_about).toBe('Each card starts from a standard recipe for the way you brew. We adjust it for that coffee and add how you take it.');
  });
});

describe('products are read under their brand (decision 3)', () => {
  it('Starbucks, then its products in their own order, then the next brand; a product added later lands under its brand', async () => {
    const list = codes('cupboard_coffee');
    const at = list.indexOf('starbucks');
    const products = cfg('cupboard_coffee').values.filter(v => v.parentCode === 'starbucks').map(v => v.code);
    expect(products.length).toBe(14);
    expect(list.slice(at + 1, at + 1 + products.length)).toEqual(products);
    expect(products[0]).toBe('starbucks_pike_place_roast');
    expect(list[at + 1 + products.length]).toBe('peets');
    // stored numbers are not rewritten: the existing brands keep 10..64
    expect(cfg('cupboard_coffee').values.find(v => v.code === 'peets')!.sortOrder).toBe(12);
    // the payload the autocomplete reads is in the same order
    const opts = (await brewProfileOptions('mirror')).fields.find(f => f.code === 'cupboard_coffee')!;
    expect(opts.values.map(v => v.code)).toEqual(list.filter(c => cfg('cupboard_coffee').values.find(v => v.code === c)!.isActive));

    await withRollback(async ({ client: c }) => {
      const r = await kitchen.promoteTypedName({ typed: 'zzz starbucks reserve test', label: 'Zzz Starbucks Reserve Test', parentCode: 'starbucks' }, c);
      expect(r.created).toBe(true);
      await brew.loadBrewProfileFields(c);
      const after = codes('cupboard_coffee');
      const s = after.indexOf('starbucks');
      expect(after.slice(s + 1, s + 16)).toEqual([...products, r.code]);
      expect(after[s + 16]).toBe('peets');
    });
    await brew.loadBrewProfileFields();
  });

  it('orderValues alone: a product whose brand is missing keeps its own place', () => {
    const v = (id: number, code: string, sortOrder: number, parentCode: string | null = null) =>
      ({ id, code, label: code, sortOrder, pinned: false, acceptsWords: false, aliases: [], isActive: true, exclusive: false, parentCode });
    expect(brew.orderValues([v(1, 'a', 1), v(2, 'b', 2), v(3, 'a1', 9, 'a'), v(4, 'x1', 3, 'gone')]).map(x => x.code)).toEqual(['a', 'a1', 'b', 'x1']);
  });
});

describe("Liam's field list (decision 5)", () => {
  it('lists the brands, not the products', () => {
    const text = brew.formatBrewProfileFieldList();
    expect(text).toContain('tatte_bakery_and_cafe (Tatte Bakery & Café / tatte)');
    expect(text).toContain('starbucks (Starbucks / sbux)');
    expect(text).not.toContain('starbucks_pike_place_roast');
    // the product is still an allowed value: a stored product validates
    expect(cfg('cupboard_coffee').allowedValues).toContain('starbucks_pike_place_roast');
  });
});

describe('promote and retire (C2)', () => {
  it('one value, one brand row, one alias; twice is once; the label and the brand are checked', async () => {
    await withRollback(async ({ client: c, savepoint }) => {
      const count = async () => (await c.query(
        `SELECT (SELECT count(*)::int FROM brew_profile_field_value) v, (SELECT count(*)::int FROM brew_cupboard_brand) b,
                (SELECT count(*)::int FROM brew_cupboard_brand_alias) a`)).rows[0];
      const before = await count();
      const r = await kitchen.promoteTypedName({ typed: '  Zzz Corner Roasters ', label: 'Zzz Corner Roasters', kindCode: 'specialty' }, c);
      expect(r).toEqual({ created: true, code: 'zzz_corner_roasters' });
      expect(await count()).toEqual({ v: before.v + 1, b: before.b + 1, a: before.a + 1 });
      const row = (await c.query(
        `SELECT fv.label, fv.pinned, fv.accepts_words, fv.is_active, k.code AS kind, b.parent_brand_id, a.alias, f.code AS field
         FROM brew_profile_field_value fv JOIN brew_profile_field f ON f.id = fv.field_id JOIN brew_cupboard_brand b ON b.field_value_id = fv.id
         JOIN brew_cupboard_brand_kind k ON k.id = b.brand_kind_id JOIN brew_cupboard_brand_alias a ON a.brand_id = b.id WHERE fv.code = $1`, [r.code])).rows;
      expect(row).toEqual([{ label: 'Zzz Corner Roasters', pinned: false, accepts_words: false, is_active: true, kind: 'specialty', parent_brand_id: null, alias: 'zzz corner roasters', field: 'cupboard_coffee' }]);
      expect(await kitchen.promoteTypedName({ typed: 'ZZZ CORNER ROASTERS', label: 'Anything', kindCode: 'chain' }, c)).toEqual({ created: false, code: 'zzz_corner_roasters' });
      expect(await count()).toEqual({ v: before.v + 1, b: before.b + 1, a: before.a + 1 });
      // a second entry whose label slugs the same gets its own code
      expect((await kitchen.promoteTypedName({ typed: 'zzz corner roasters!', label: 'Zzz Corner-Roasters', kindCode: 'specialty' }, c)).code).toBe('zzz_corner_roasters_2');
      await expect(savepoint(() => kitchen.promoteTypedName({ typed: 'zzz other', label: 'Starbucks', kindCode: 'chain' }, c))).rejects.toMatchObject({ status: 409 });
      await expect(savepoint(() => kitchen.promoteTypedName({ typed: 'zzz other', label: 'Zzz Other', kindCode: 'nope' }, c))).rejects.toMatchObject({ status: 400 });
      await expect(savepoint(() => kitchen.promoteTypedName({ typed: 'zzz other', label: 'Zzz Other', parentCode: 'starbucks_pike_place_roast' }, c))).rejects.toMatchObject({ status: 400 });
      await expect(savepoint(() => kitchen.promoteTypedName({ typed: '   ', label: 'Zzz Other', kindCode: 'chain' }, c))).rejects.toMatchObject({ status: 400 });
      // a product takes its brand's kind
      const p = await kitchen.promoteTypedName({ typed: 'zzz dunkin test', label: 'Zzz Dunkin Test', parentCode: 'dunkin', kindCode: 'specialty' }, c);
      expect((await c.query(`SELECT k.code FROM brew_cupboard_brand b JOIN brew_profile_field_value fv ON fv.id = b.field_value_id
        JOIN brew_cupboard_brand_kind k ON k.id = b.brand_kind_id WHERE fv.code = $1`, [p.code])).rows[0].code).toBe('chain');
    });
  });

  it('retire hides an entry from the options and keeps it displayable; a fixed answer stays', async () => {
    await withRollback(async ({ client: c, savepoint }) => {
      const { uid, userId } = await customer(c);
      await save(c, uid, [{ field: 'cupboard_coffee', value: ['gregorys_coffee'] }]);
      expect(await kitchen.retireKitchenEntry('gregorys_coffee', c)).toEqual({ retired: true });
      expect(await kitchen.retireKitchenEntry('gregorys_coffee', c)).toEqual({ retired: false });
      await brew.loadBrewProfileFields(c);
      expect(cfg('cupboard_coffee').allowedValues).not.toContain('gregorys_coffee');
      const opts = (await brewProfileOptions('mirror')).fields.find(f => f.code === 'cupboard_coffee')!;
      expect(opts.values.map(v => v.code)).not.toContain('gregorys_coffee');
      expect(cfg('cupboard_coffee').values.find(v => v.code === 'gregorys_coffee')).toMatchObject({ isActive: false, label: 'Gregorys Coffee' });
      expect(await kitchenOf(c, userId)).toMatchObject({ code: 'gregorys_coffee', label: 'Gregorys Coffee' });
      await expect(savepoint(() => kitchen.retireKitchenEntry('other', c))).rejects.toMatchObject({ status: 400 });
      await expect(savepoint(() => kitchen.retireKitchenEntry('zzz_nope', c))).rejects.toMatchObject({ status: 404 });
      // check 34: retiring a brand with products is reported
      await kitchen.retireKitchenEntry('verve', c);
      const ch = await integrity.checkKitchenProductParents({ tx: c });
      expect(ch.pass).toBe(false);
      expect(ch.details).toContain('verve_streetlevel (brand verve): its brand is retired');
    });
    await brew.loadBrewProfileFields();
  });
});

describe('an old typed name resolves on read (C3, decision 2)', () => {
  it('a promoted name reads as the brand for the customer who typed it; their row stays as typed', async () => {
    await withRollback(async ({ client: c }) => {
      const { uid, userId } = await customer(c);
      await save(c, uid, [{ field: 'cupboard_coffee', value: ['other'], words: 'Zzz Promo Roasters' }]);
      const before = await changeRows(c, userId);
      expect(await kitchenOf(c, userId)).toMatchObject({ code: 'other', customerWords: 'Zzz Promo Roasters', brandCode: 'other' });
      const typed = (await reads.getBrewProfileFieldCounts(c)).typedKitchenNames;
      expect(typed).toContainEqual({ words: 'Zzz Promo Roasters', customers: 1 });
      const r = await kitchen.promoteTypedName({ typed: 'zzz promo roasters', label: 'Zzz Promo Roasters Co', kindCode: 'specialty' }, c);
      expect(await kitchenOf(c, userId)).toMatchObject({ code: r.code, label: 'Zzz Promo Roasters Co', brandKind: 'specialty', customerWords: 'Zzz Promo Roasters', brandCode: r.code });
      expect(await changeRows(c, userId)).toEqual(before);
      expect((await reads.getBrewProfileCurrent(uid, c)).cupboard_coffee).toMatchObject({ value: ['other'], words: 'Zzz Promo Roasters' });
      expect((await reads.getBrewProfileFieldCounts(c)).typedKitchenNames.map(t => t.words)).not.toContain('Zzz Promo Roasters');
    });
  });

  it('labels first, then aliases; two matches resolve to nothing', async () => {
    await withRollback(async ({ client: c }) => {
      const kitchenFor = async (words: string) => {
        const { uid, userId } = await customer(c);
        await save(c, uid, [{ field: 'cupboard_coffee', value: ['other'], words }]);
        return (await kitchenOf(c, userId))!.code;
      };
      // "keurig" is an alias of the pods answer and the label of Keurig: the label wins
      expect(await kitchenFor(' Keurig ')).toBe('keurig');
      // no label: the one alias
      expect(await kitchenFor('Dutch Brothers')).toBe('dutch_bros');
      // an alias on two entries resolves to nothing
      await c.query(`INSERT INTO brew_cupboard_brand_alias (brand_id, alias)
        SELECT b.id, 'zzz twice' FROM brew_cupboard_brand b JOIN brew_profile_field_value fv ON fv.id = b.field_value_id WHERE fv.code IN ('wawa', 'illy')`);
      expect(await kitchenFor('zzz twice')).toBe('other');
      // a retired brand is not a match
      await kitchen.retireKitchenEntry('blank_street', c);
      expect(await kitchenFor('Blank Street')).toBe('other');
    });
  });
});

describe("a product reads its brand's kitchen line (decision 4)", () => {
  it('brand_code is the parent for a product and the entry for a brand', async () => {
    await withRollback(async ({ client: c }) => {
      const a = await customer(c);
      await save(c, a.uid, [{ field: 'cupboard_coffee', value: ['starbucks_pike_place_roast'] }]);
      expect(await kitchenOf(c, a.userId)).toMatchObject({ code: 'starbucks_pike_place_roast', label: 'Starbucks Pike Place Roast', brandKind: 'chain', brandCode: 'starbucks' });
      const b = await customer(c);
      await save(c, b.uid, [{ field: 'cupboard_coffee', value: ['illy'] }]);
      expect(await kitchenOf(c, b.userId)).toMatchObject({ code: 'illy', brandCode: 'illy' });
    });
  });
});
