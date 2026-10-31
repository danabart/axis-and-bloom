// Commerce 2, Part D (2026-10-31) — resolveSubscriptionShipment: which coffee
// a renewal ships (dial row → that slot; no row → the signup slot; switch 0 →
// the signup slot; unsellable → the archetype's landing default; nothing →
// unresolved; a category coffee → its signup coffee) and the price (the
// subscription tier by bag count, per bag, shipping by the one-time rule).
// The subscription, its items and the dial row live in a rolled-back
// transaction on the test DB, against the real seeded coffee_dial_slot rows;
// the sellable-coffee resolution and the parameters are mocked so the
// outcome of each rule is exact.
import 'dotenv/config';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const params: Record<string, number> = {
  subscription_ships_current_dial_position: 1,
  subscription_discount_pct_1_bag: 5,
  subscription_discount_pct_2plus_bags: 10,
  shipping_fee_cents: 595,
  free_shipping_min_bags: 2,
};
vi.mock('./commerceParameters.js', () => ({ commerceParam: async (k: string) => params[k] }));

// Two real coffee ids (the FK): the first plays a sellable category coffee, the second one that is gone.
const categoryCoffee = { sellable: -1, gone: -1 };
// Sellable per (archetype, sort order); a missing key is "nothing sellable".
let sellable: Record<string, { blend_id: string; coffee_id: number; slot_name: string; retail_price_cents: number }> = {};
vi.mock('./blendResolver.js', () => ({
  resolveBlendForSlot: async (archetype: string, sortOrder: number) => {
    const s = sellable[`${archetype}:${sortOrder}`];
    return s ? { ...s, coffee_name: 'roaster coffee', roaster: 'Roaster', priority: 1, weight_oz: 12, roaster_sku: null, shopify_variant_id: null, skipped: [] } : null;
  },
  resolveCoffeeBlend: async (coffeeId: number) => (coffeeId === categoryCoffee.sellable ? { blend_id: '00000000-0000-0000-0000-000000000901', roaster_sku: null, shopify_variant_id: null } : null),
}));
vi.mock('./cartResolver.js', () => ({
  retailPriceCents: async (coffeeId: number) => (coffeeId === categoryCoffee.sellable ? 2400 : null),
  directDisplay: async () => ({ displayName: 'Quiet Decaf', archetype: null }),
  shippingFor: async (bags: number) => (bags >= params.free_shipping_min_bags ? 0 : params.shipping_fee_cents),
}));

const { withRollback } = await import('../test/withRollback.js');
const { resolveSubscriptionShipment, applySubscriptionPricing } = await import('./subscriptionShipment.js');

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

async function slots(tx: Tx, archetype: string) {
  const r = await tx.client.query<{ id: number; sort_order: number; is_landing_default: boolean }>(
    `SELECT id, sort_order, is_landing_default FROM coffee_dial_slot WHERE archetype = $1 ORDER BY sort_order`, [archetype]
  );
  return r.rows;
}

async function fixture(tx: Tx, items: Array<{ archetype: string | null; slotSort?: number; coffeeId?: number; quantity?: number }>) {
  const userId = (await tx.client.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Sub') RETURNING id`, [`vitest-ship-${Date.now()}-${Math.random()}`]
  )).rows[0].id;
  const subId = (await tx.client.query<{ id: string }>(
    `INSERT INTO subscription (user_id, kind, status, frequency_weeks, frequency_days, next_delivery_date)
     VALUES ($1, 'paid', 'active', 2, 14, CURRENT_DATE) RETURNING id`, [userId]
  )).rows[0].id;
  for (const it of items) {
    const slotId = it.archetype && it.slotSort
      ? (await tx.client.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`, [it.archetype, it.slotSort])).rows[0].id
      : null;
    await tx.client.query(
      `INSERT INTO subscription_item (subscription_id, archetype, signup_slot_id, signup_coffee_id, weight_oz, quantity, display_name_at_signup)
       VALUES ($1, $2, $3, $4, 12, $5, 'signup name')`,
      [subId, it.archetype, slotId, it.coffeeId ?? null, it.quantity ?? 1]
    );
  }
  return { userId, subId };
}

async function setDial(tx: Tx, userId: string, archetype: string, sortOrder: number) {
  await tx.client.query(
    `INSERT INTO user_bloom_dial_current_position (user_id, archetype, slot_id)
     VALUES ($1, $2, (SELECT id FROM coffee_dial_slot WHERE archetype = $2 AND sort_order = $3))`, [userId, archetype, sortOrder]
  );
}

const sell = (archetype: string, sort: number, cents = 2900) => {
  sellable[`${archetype}:${sort}`] = { blend_id: `00000000-0000-0000-0000-00000000${String(sort).padStart(4, '0')}`, coffee_id: 100 + sort, slot_name: `${archetype} slot ${sort}`, retail_price_cents: cents };
};

beforeEach(() => {
  sellable = {};
  params.subscription_ships_current_dial_position = 1;
});

describe('resolveSubscriptionShipment: which coffee', () => {
  it('a current dial position for the archetype → that slot', () => withRollback(async tx => {
    sell('floral', 1); sell('floral', 3);
    const { userId, subId } = await fixture(tx, [{ archetype: 'floral', slotSort: 1 }]);
    await setDial(tx, userId, 'floral', 3);
    const s = await resolveSubscriptionShipment(subId, tx.client);
    expect(s.status).toBe('resolved');
    if (s.status !== 'resolved') return;
    expect(s.lines[0]).toMatchObject({ basis: 'dial', dialSortOrder: 3, displayName: 'floral slot 3' });
  }));

  it('no dial row → the signup slot', () => withRollback(async tx => {
    sell('floral', 1); sell('floral', 3);
    const { subId } = await fixture(tx, [{ archetype: 'floral', slotSort: 1 }]);
    const s = await resolveSubscriptionShipment(subId, tx.client);
    expect(s.status === 'resolved' && s.lines[0]).toMatchObject({ basis: 'signup_slot', dialSortOrder: 1 });
  }));

  it('switch subscription_ships_current_dial_position = 0 → the signup slot, even with a dial row', () => withRollback(async tx => {
    sell('floral', 1); sell('floral', 3);
    const { userId, subId } = await fixture(tx, [{ archetype: 'floral', slotSort: 1 }]);
    await setDial(tx, userId, 'floral', 3);
    params.subscription_ships_current_dial_position = 0;
    const s = await resolveSubscriptionShipment(subId, tx.client);
    expect(s.status === 'resolved' && s.lines[0]).toMatchObject({ basis: 'signup_slot', dialSortOrder: 1 });
  }));

  it('the chosen slot has nothing sellable → the landing default slot', () => withRollback(async tx => {
    const landing = (await slots(tx, 'floral')).find(r => r.is_landing_default)!;
    const other = (await slots(tx, 'floral')).find(r => !r.is_landing_default)!;
    sell('floral', landing.sort_order);
    const { subId } = await fixture(tx, [{ archetype: 'floral', slotSort: other.sort_order }]);
    const s = await resolveSubscriptionShipment(subId, tx.client);
    expect(s.status === 'resolved' && s.lines[0]).toMatchObject({ basis: 'landing_default', dialSortOrder: landing.sort_order });
  }));

  it('nothing sellable anywhere → unresolved, with the reason (never a coffee we cannot name)', () => withRollback(async tx => {
    const { subId } = await fixture(tx, [{ archetype: 'floral', slotSort: 1 }]);
    const s = await resolveSubscriptionShipment(subId, tx.client);
    expect(s.status).toBe('unresolved');
    if (s.status === 'unresolved') expect(s.unresolved[0].reason).toMatch(/floral: .*nothing sellable/);
  }));

  it('a category coffee (no archetype) ships its signup coffee; one that is gone is unresolved', () => withRollback(async tx => {
    const ids = (await tx.client.query<{ id: number }>(`SELECT id FROM coffees ORDER BY id LIMIT 2`)).rows.map(r => r.id);
    [categoryCoffee.sellable, categoryCoffee.gone] = ids;
    const ok = await fixture(tx, [{ archetype: null, coffeeId: categoryCoffee.sellable }]);
    const s = await resolveSubscriptionShipment(ok.subId, tx.client);
    expect(s.status === 'resolved' && s.lines[0]).toMatchObject({ basis: 'signup_coffee', displayName: 'Quiet Decaf', fullPriceCents: 2400, archetype: null });
    const gone = await fixture(tx, [{ archetype: null, coffeeId: categoryCoffee.gone }]);
    expect((await resolveSubscriptionShipment(gone.subId, tx.client)).status).toBe('unresolved');
  }));
});

describe('subscription pricing', () => {
  it('one bag: 5% off per bag, shipping charged', () => withRollback(async tx => {
    sell('floral', 1, 2900);
    const { subId } = await fixture(tx, [{ archetype: 'floral', slotSort: 1 }]);
    const s = await resolveSubscriptionShipment(subId, tx.client);
    expect(s.status === 'resolved' && s).toMatchObject({ bagCount: 1, discountPct: 5, subtotalCents: 2755, discountCents: 145, shippingCents: 595 });
  }));

  it('two bags: 10% off every bag and free shipping', () => withRollback(async tx => {
    sell('floral', 1, 2900);
    const { subId } = await fixture(tx, [{ archetype: 'floral', slotSort: 1, quantity: 2 }]);
    const s = await resolveSubscriptionShipment(subId, tx.client);
    expect(s.status === 'resolved' && s).toMatchObject({ bagCount: 2, discountPct: 10, subtotalCents: 5220, discountCents: 580, shippingCents: 0 });
    expect(s.status === 'resolved' && s.lines[0]).toMatchObject({ unitPriceCents: 2610, discountCents: 290, fullPriceCents: 2900 });
  }));

  it('applySubscriptionPricing rounds per bag, so each bag is shown at what it is charged', async () => {
    const p = await applySubscriptionPricing([{ fullPriceCents: 2155, quantity: 1 }]);
    expect(p.lines[0]).toMatchObject({ unitPriceCents: 2047, discountCents: 108 }); // 2155 × 0.95 = 2047.25
    expect(p.subtotalCents).toBe(2047);
  });
});
