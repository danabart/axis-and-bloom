// Commerce 1, Part D (2026-10-31) — cartResolver: every cart kind resolves
// with the server's price, a client price that differs (or is missing) is a
// 409, and bag count + shipping come from commerce_parameter. The catalog and
// the parameters are mocked so prices and counts are exact; the real catalog
// reads are covered by blendResolver.test.ts / catalogSizes.test.ts, and the
// whole path against the test DB by checkoutService.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const params: Record<string, number> = { shipping_fee_cents: 595, free_shipping_min_bags: 2 };
vi.mock('./commerceParameters.js', () => ({ commerceParam: async (k: string) => params[k] }));

const slotResolution = vi.fn();
const coffeeBlend = vi.fn();
const collectionOffer = vi.fn();
vi.mock('./blendResolver.js', () => ({
  resolveBlendForSlot: (...a: unknown[]) => slotResolution(...a),
  resolveCoffeeBlend: (...a: unknown[]) => coffeeBlend(...a),
  computeCollectionOffer: (...a: unknown[]) => collectionOffer(...a),
}));
vi.mock('./catalogReads.js', () => ({
  archetypeLabel: async (code: string) => ({ floral: 'Floral', earthy: 'Earthy' } as Record<string, string>)[code] ?? code,
  getCoffeeRetailPrices: async () => [
    { coffee_id: 77, weight_oz: '12', retail_price_cents: 2100 },
    { coffee_id: 78, weight_oz: '80', retail_price_cents: 9900 },
  ],
  getCoffees: async ({ ids }: { ids: number[] }) => ids.map(id => ({ id, name: `Roaster coffee ${id}`, match_archetype: 'earthy' })),
  getHomeSlot: async (id: number) => (id === 77 ? { slot_name: 'Quiet Ember' } : null),
}));
const dbQuery = vi.fn();
vi.mock('../db/client.js', () => ({ db: { query: (...a: unknown[]) => dbQuery(...a) } }));

const { resolveCart, shippingFor, CartError } = await import('./cartResolver.js');

const dialResolved = {
  blend_id: 'sku-dial', coffee_id: 11, coffee_name: 'Roaster name', roaster: 'Roaster', priority: 1, weight_oz: 12,
  roaster_sku: null, shopify_variant_id: null, slot_name: 'Petal Hour', retail_price_cents: 1800, skipped: [],
};

async function expect409(p: Promise<unknown>, code = 'price_changed') {
  const err = await p.then(() => null, e => e);
  expect(err).toBeInstanceOf(CartError);
  expect(err.status).toBe(409);
  expect(err.code).toBe(code);
  return err as InstanceType<typeof CartError>;
}

beforeEach(() => {
  params.shipping_fee_cents = 595; params.free_shipping_min_bags = 2;
  slotResolution.mockResolvedValue(dialResolved);
  coffeeBlend.mockResolvedValue({ blend_id: 'sku-direct', roaster_sku: null, shopify_variant_id: null });
  collectionOffer.mockResolvedValue({
    members: [
      { dialSortOrder: 1, blendId: 'sku-c1', coffeeId: 21, slotName: 'One', shopifyVariantId: null, weightOz: 12, priceCents: 1800 },
      { dialSortOrder: 2, blendId: 'sku-c2', coffeeId: 22, slotName: 'Two', shopifyVariantId: null, weightOz: 12, priceCents: 2000 },
      { dialSortOrder: 3, blendId: 'sku-c3', coffeeId: 23, slotName: 'Three', shopifyVariantId: null, weightOz: 12, priceCents: 2200 },
    ],
    sumCents: 6000, discountedCents: 5400,
  });
  dbQuery.mockResolvedValue({ rows: [{ id: 'sku-legacy', coffee_id: 77, weight_oz: '12' }] });
});

describe('resolveCart — every kind, server-priced', () => {
  it('dial: the slot house name and the server price; never the roaster coffee name', async () => {
    const cart = await resolveCart([{ archetype: 'floral', dialSortOrder: 1, weightOz: 12, quantity: 1, priceCents: 1800 }]);
    expect(cart.lines).toEqual([expect.objectContaining({
      coffeeSkuId: 'sku-dial', coffeeId: 11, displayName: 'Petal Hour', archetypeLabel: 'Floral',
      unitPriceCents: 1800, discountCents: 0, source: 'dial', archetype: 'floral', dialSortOrder: 1, quantity: 1,
    })]);
    expect(JSON.stringify(cart)).not.toContain('Roaster');
  });

  it('dial: a changed price is 409 with the existing wording', async () => {
    const err = await expect409(resolveCart([{ archetype: 'floral', dialSortOrder: 1, weightOz: 12, quantity: 1, priceCents: 1700 }]));
    expect(err.message).toBe("Petal Hour's price has changed — expected $18.00, got $17.00. Refresh your cart and try again.");
    await expect409(resolveCart([{ archetype: 'floral', dialSortOrder: 1, weightOz: 12, quantity: 1 }])); // missing price
  });

  it('dial: no sellable roaster is 409 unavailable', async () => {
    slotResolution.mockResolvedValue(null);
    await expect409(resolveCart([{ archetype: 'floral', dialSortOrder: 1, weightOz: 12, priceCents: 1800 }]), 'unavailable');
  });

  it('direct: coffee_retail_price at that weight, the home slot name else the coffee name', async () => {
    const cart = await resolveCart([{ coffeeId: 77, weightOz: 12, quantity: 2, priceCents: 2100 }]);
    expect(cart.lines[0]).toMatchObject({ coffeeSkuId: 'sku-direct', displayName: 'Quiet Ember', unitPriceCents: 2100, source: 'direct', archetypeLabel: 'Earthy' });
    await expect409(resolveCart([{ coffeeId: 77, weightOz: 12, quantity: 1, priceCents: 1999 }]));
    await expect409(resolveCart([{ coffeeId: 99, weightOz: 12, quantity: 1, priceCents: 2100 }]), 'unavailable'); // unpriced
  });

  it('collection: one line per member, discounted so the members sum to the verified price exactly', async () => {
    const cart = await resolveCart([{ collection: true, archetype: 'earthy', quantity: 1, priceCents: 5400 }]);
    expect(cart.lines.map(l => l.source)).toEqual(['collection', 'collection', 'collection']);
    expect(cart.lines.reduce((s, l) => s + l.unitPriceCents, 0)).toBe(5400);
    expect(cart.lines.map(l => l.unitPriceCents + l.discountCents)).toEqual([1800, 2000, 2200]);
    const err = await expect409(resolveCart([{ collection: true, archetype: 'earthy', quantity: 1, priceCents: 6000 }]));
    expect(err.message).toBe("The earthy Collection's price has changed — expected $54.00, got $60.00. Refresh your cart and try again.");
  });

  it('legacy blendId: priced like a direct coffee at the SKU weight', async () => {
    const cart = await resolveCart([{ blendId: 'sku-legacy', quantity: 1, priceCents: 2100 }]);
    expect(cart.lines[0]).toMatchObject({ coffeeSkuId: 'sku-legacy', unitPriceCents: 2100, displayName: 'Quiet Ember' });
    await expect409(resolveCart([{ blendId: 'sku-legacy', quantity: 1, priceCents: 100 }]));
  });

  it('rejects an empty cart, a bad quantity and an item of no kind', async () => {
    await expect(resolveCart([])).rejects.toMatchObject({ status: 400 });
    await expect(resolveCart([{ coffeeId: 77, weightOz: 12, quantity: 0, priceCents: 2100 }])).rejects.toMatchObject({ code: 'invalid_quantity' });
    await expect(resolveCart([{ quantity: 1 }])).rejects.toMatchObject({ code: 'invalid_item' });
  });
});

describe('bag count and shipping from commerce_parameter', () => {
  it('1 bag pays the fee, 2 bags ship free', async () => {
    const one = await resolveCart([{ archetype: 'floral', dialSortOrder: 1, weightOz: 12, quantity: 1, priceCents: 1800 }]);
    expect(one).toMatchObject({ bagCount: 1, shippingCents: 595, subtotalCents: 1800 });
    const two = await resolveCart([{ archetype: 'floral', dialSortOrder: 1, weightOz: 12, quantity: 2, priceCents: 1800 }]);
    expect(two).toMatchObject({ bagCount: 2, shippingCents: 0, subtotalCents: 3600 });
  });

  it('a collection of 3 counts 3 bags (free); an 80 oz bag still counts 1 (fee)', async () => {
    expect((await resolveCart([{ collection: true, archetype: 'earthy', quantity: 1, priceCents: 5400 }])).shippingCents).toBe(0);
    coffeeBlend.mockResolvedValue({ blend_id: 'sku-80', roaster_sku: null, shopify_variant_id: null });
    const big = await resolveCart([{ coffeeId: 78, weightOz: 80, quantity: 1, priceCents: 9900 }]);
    expect(big).toMatchObject({ bagCount: 1, shippingCents: 595 });
  });

  it('reads the parameters, so a changed fee or threshold applies without a deploy', async () => {
    params.shipping_fee_cents = 700; params.free_shipping_min_bags = 3;
    expect(await shippingFor(2)).toBe(700);
    expect(await shippingFor(3)).toBe(0);
  });
});
