// Commerce 2, B2 (2026-10-31) — what a subscription ships this cycle, and at
// what price. Read-only; the one owner of two rules:
//
// 1. Which coffee (Dana's decision 4). For each subscription_item with an
//    archetype: the customer's current Bloom Dial position for that archetype
//    (user_bloom_dial_current_position) when commerce_parameter
//    subscription_ships_current_dial_position = 1 and they have one, else the
//    slot chosen at signup; resolved to a sellable coffee and price through
//    the same blendResolver.resolveBlendForSlot the cart uses for a dial line.
//    A slot that resolves to nothing sellable falls back to the archetype's
//    landing default slot (coffee_dial_slot.is_landing_default; Task 0: the
//    brief's "is_default"). A category coffee (no archetype) always ships its
//    signup coffee through the cart's direct path. If nothing resolves, the
//    item is unresolved and the caller charges nothing: never charge for a
//    coffee we cannot name.
//
// 2. The subscription price (decisions 1 and 2, and Dana's no-stacking rule
//    2026-10-31). The pricing-table price of each bag minus the subscription
//    tier by bag count (subscription_discount_pct_1_bag for one bag per
//    delivery, _2plus_bags for two or more); the collection discount never
//    applies. Rounded per bag, so each bag is shown at exactly what it is
//    charged and the total is their sum. Shipping is the one-time rule
//    (cartResolver.shippingFor). applySubscriptionPricing is shared with the
//    first delivery (checkoutService), so the first box and every renewal are
//    priced the same way.
import { db, type Tx } from '../db/client.js';
import { resolveBlendForSlot, resolveCoffeeBlend } from './blendResolver.js';
import { archetypeLabel } from './catalogReads.js';
import { commerceParam } from './commerceParameters.js';
import { directDisplay, retailPriceCents, shippingFor } from './cartResolver.js';

type Runner = Pick<Tx, 'query'>;

/** The subscription tier for a delivery of bagCount bags, in percent. */
export async function subscriptionDiscountPct(bagCount: number): Promise<number> {
  return bagCount >= 2
    ? await commerceParam('subscription_discount_pct_2plus_bags')
    : await commerceParam('subscription_discount_pct_1_bag');
}

/** A bag's price after the subscription tier, rounded to the cent. */
export const discountedUnit = (fullCents: number, pct: number) => Math.round(fullCents * (100 - pct) / 100);

export interface PricedLine {
  /** Pricing-table price per bag, before any discount. */
  fullPriceCents: number;
  quantity: number;
}
export interface SubscriptionPricing<L> {
  lines: Array<L & { unitPriceCents: number; discountCents: number }>;
  bagCount: number;
  /** The percentage applied: the tier plus any extra (Family Household 3: the handover perk, first box only). */
  discountPct: number;
  tierPct: number;
  extraPct: number;
  /** Sum of the per-bag discounts times quantity. */
  discountCents: number;
  subtotalCents: number;
  shippingCents: number;
}

/**
 * Apply the subscription tier to full-price lines (no other discount survives).
 * `extraPct` is added to the tier (Family Household 3, D22: the handover perk on
 * the first box of a handed-over subscription); 0 everywhere else.
 */
export async function applySubscriptionPricing<L extends PricedLine>(lines: L[], extraPct = 0): Promise<SubscriptionPricing<L>> {
  const bagCount = lines.reduce((n, l) => n + l.quantity, 0);
  const tierPct = await subscriptionDiscountPct(bagCount);
  const discountPct = tierPct + extraPct;
  const priced = lines.map(l => {
    const unitPriceCents = discountedUnit(l.fullPriceCents, discountPct);
    return { ...l, unitPriceCents, discountCents: l.fullPriceCents - unitPriceCents };
  });
  return {
    lines: priced,
    bagCount,
    discountPct,
    tierPct,
    extraPct,
    discountCents: priced.reduce((s, l) => s + l.discountCents * l.quantity, 0),
    subtotalCents: priced.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0),
    shippingCents: await shippingFor(bagCount),
  };
}

export interface ShipmentLine extends PricedLine {
  itemId: string;
  coffeeSkuId: string;
  coffeeId: number;
  /** House name (slot name, or a category coffee's display name); never a roaster name. */
  displayName: string;
  archetypeLabel: string | null;
  weightOz: number;
  unitPriceCents: number;
  discountCents: number;
  archetype: string | null;
  slotId: number | null;
  dialSortOrder: number | null;
  /** Why this coffee: the dial's current position, the signup slot, the landing default, or the signup coffee. */
  basis: 'dial' | 'signup_slot' | 'landing_default' | 'signup_coffee';
  /** Family Household 3: the member this bag is for (subscription_item.intended_for_user_id); null = the subscriber. */
  intendedForUserId: string | null;
}

/**
 * An item that cannot be named this cycle. `skippable` (Family Household 3,
 * Dana's decision 1): the reason is the drinker (no quiz yet, no longer in the
 * household box), so the rest of the box still ships and this bag is skipped;
 * any other reason keeps today's rule (nothing ships, nothing is charged).
 */
export interface UnresolvedItem { itemId: string; reason: string; skippable?: boolean; drinkerFirstName?: string | null }

export type Shipment =
  | ({ status: 'resolved'; subscriptionId: string; userId: string; skipped: UnresolvedItem[] } & Omit<SubscriptionPricing<ShipmentLine>, 'lines'> & { lines: ShipmentLine[] })
  | { status: 'unresolved'; subscriptionId: string; userId: string; unresolved: UnresolvedItem[] };

interface ItemRow {
  id: string; archetype: string | null; signup_slot_id: number | null; signup_coffee_id: number | null;
  weight_oz: string; quantity: number; intended_for_user_id: string | null;
}

/**
 * Family Household 3 (T2, T3): who a recipient bag is for, read at renewal
 * time: their current archetype (v_customer_quiz_current, self-taken first),
 * their dial for it (v_customer_dial_current, across linked profiles), and
 * whether they are still an active in-box member of the subscription's
 * household. Nothing is copied: every cycle reads the views.
 */
export interface Drinker { canonicalUserId: string; firstName: string | null; archetype: string | null; dialSlotId: number | null; inBox: boolean }
export async function readDrinker(userId: string, householdId: string | null, runner: Runner = db): Promise<Drinker | null> {
  const r = await runner.query<{ canonical_user_id: string; first_name: string | null; archetype_code: string | null; slot_id: number | null; in_box: boolean }>(
    `SELECT vci.canonical_user_id, up.first_name, qc.archetype_code::text AS archetype_code, dc.slot_id,
            ($2::uuid IS NULL OR EXISTS (
              SELECT 1 FROM v_household_membership vm
              JOIN v_customer_identity mv ON mv.user_id = vm.user_id
              WHERE vm.household_id = $2 AND vm.status_code = 'active' AND vm.in_house_box
                AND mv.canonical_user_id = vci.canonical_user_id)) AS in_box
     FROM v_customer_identity vci
     JOIN user_profile up ON up.id = vci.user_id
     LEFT JOIN v_customer_quiz_current qc ON qc.canonical_user_id = vci.canonical_user_id
     LEFT JOIN v_customer_dial_current dc ON dc.canonical_user_id = vci.canonical_user_id AND dc.archetype = qc.archetype_code
     WHERE vci.user_id = $1`, [userId, householdId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return { canonicalUserId: row.canonical_user_id, firstName: row.first_name, archetype: row.archetype_code, dialSlotId: row.slot_id, inBox: row.in_box };
}
interface SlotRow { id: number; archetype: string; sort_order: number }

async function slotById(id: number, runner: Runner): Promise<SlotRow | null> {
  return (await runner.query<SlotRow>(`SELECT id, archetype, sort_order FROM coffee_dial_slot WHERE id = $1`, [id])).rows[0] ?? null;
}

type ResolvedItemLine = Omit<ShipmentLine, 'unitPriceCents' | 'discountCents'>;

/**
 * Family Household 3: the coffee for a drinker, by the same rule a renewal
 * uses (their current archetype, then their dial for it, then the signup slot
 * when it is in that archetype, then the landing default). Shared by the
 * renewal (recipient items) and Build the house box (B7), so the cart and the
 * renewal agree. A drinker reason is skippable (decision 1).
 */
export async function resolveDrinkerLine(
  itemId: string, drinkerUserId: string, householdId: string | null, weightOz: number, quantity: number,
  followDial: boolean, signupSlotId: number | null, runner: Runner = db,
): Promise<ResolvedItemLine | UnresolvedItem> {
  const d = await readDrinker(drinkerUserId, householdId, runner);
  const name = d?.firstName ?? 'A household member';
  if (!d || !d.inBox) return { itemId, reason: `${name} is no longer in the household box`, skippable: true, drinkerFirstName: d?.firstName ?? null };
  if (!d.archetype) return { itemId, reason: `${name}: no quiz yet`, skippable: true, drinkerFirstName: d.firstName };
  const candidates: Array<{ slotId: number; basis: ShipmentLine['basis'] }> = [];
  if (followDial && d.dialSlotId) candidates.push({ slotId: d.dialSlotId, basis: 'dial' });
  if (signupSlotId) candidates.push({ slotId: signupSlotId, basis: 'signup_slot' });
  const r = await walkSlots(itemId, d.archetype, candidates, weightOz, quantity, runner);
  return 'reason' in r ? r : { ...r, intendedForUserId: drinkerUserId };
}

/** Try candidate slots in order, then the archetype's landing default; the first sellable one wins. */
async function walkSlots(
  itemId: string, archetype: string, candidates: Array<{ slotId: number; basis: ShipmentLine['basis'] }>,
  weightOz: number, quantity: number, runner: Runner,
): Promise<ResolvedItemLine | UnresolvedItem> {
  const landing = (await runner.query<{ id: number }>(
    `SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND is_landing_default = true`, [archetype]
  )).rows[0];
  if (landing) candidates = [...candidates, { slotId: landing.id, basis: 'landing_default' }];
  const tried: string[] = [];
  const seen = new Set<number>();
  for (const c of candidates) {
    if (seen.has(c.slotId)) continue;
    seen.add(c.slotId);
    const slot = await slotById(c.slotId, runner);
    if (!slot || slot.archetype !== archetype) { tried.push(`slot ${c.slotId} (${c.basis}): not in ${archetype}`); continue; }
    const resolved = await resolveBlendForSlot(slot.archetype, slot.sort_order, weightOz);
    if (!resolved) { tried.push(`slot ${c.slotId} (${c.basis}): nothing sellable at ${weightOz} oz`); continue; }
    return {
      itemId, coffeeSkuId: resolved.blend_id, coffeeId: resolved.coffee_id, displayName: resolved.slot_name ?? 'Coffee',
      archetypeLabel: await archetypeLabel(slot.archetype), weightOz, quantity,
      fullPriceCents: resolved.retail_price_cents, archetype: slot.archetype, slotId: slot.id, dialSortOrder: slot.sort_order,
      basis: c.basis, intendedForUserId: null,
    };
  }
  return { itemId, reason: `${archetype}: ${tried.join('; ') || 'no slot to try'}` };
}

async function resolveItem(item: ItemRow, userId: string, followDial: boolean, runner: Runner, householdId: string | null = null): Promise<ResolvedItemLine | UnresolvedItem> {
  const weightOz = Number(item.weight_oz);

  // Family Household 3: a bag for a member follows that member (T2, T3).
  if (item.intended_for_user_id) {
    return resolveDrinkerLine(item.id, item.intended_for_user_id, householdId, weightOz, item.quantity, followDial, item.signup_slot_id, runner);
  }

  if (!item.archetype) {
    const coffeeId = item.signup_coffee_id!;
    const blend = await resolveCoffeeBlend(coffeeId, weightOz);
    const cents = blend ? await retailPriceCents(coffeeId, weightOz) : null;
    if (!blend || cents === null) return { itemId: item.id, reason: `category coffee ${coffeeId} is not sellable at ${weightOz} oz` };
    const { displayName, archetype } = await directDisplay(coffeeId);
    return {
      itemId: item.id, coffeeSkuId: blend.blend_id, coffeeId, displayName,
      archetypeLabel: archetype ? await archetypeLabel(archetype) : null, weightOz, quantity: item.quantity,
      fullPriceCents: cents, archetype: null, slotId: null, dialSortOrder: null, basis: 'signup_coffee', intendedForUserId: null,
    };
  }

  // Candidate slots in order: the dial's current position (when the rule is
  // on and there is one), the signup slot, the archetype's landing default.
  const candidates: Array<{ slotId: number; basis: ShipmentLine['basis'] }> = [];
  if (followDial) {
    const dial = (await runner.query<{ slot_id: number | null }>(
      `SELECT slot_id FROM user_bloom_dial_current_position WHERE user_id = $1 AND archetype = $2`, [userId, item.archetype]
    )).rows[0];
    if (dial?.slot_id) candidates.push({ slotId: dial.slot_id, basis: 'dial' });
  }
  if (item.signup_slot_id) candidates.push({ slotId: item.signup_slot_id, basis: 'signup_slot' });
  return walkSlots(item.id, item.archetype, candidates, weightOz, item.quantity, runner);
}

/**
 * What the subscription ships this cycle and what it costs before tax. Live
 * items only (ended_at IS NULL). Unresolved when an item cannot be named for a
 * reason that is not its drinker (nothing ships); a drinker-skippable item is
 * left out of this cycle and the rest ships, priced (tier, shipping) on what
 * ships (Family Household 3, decision 1); unresolved when nothing is left.
 */
export async function resolveSubscriptionShipment(subscriptionId: string, runner: Runner = db): Promise<Shipment> {
  const sub = (await runner.query<{ id: string; user_id: string; household_id: string | null }>(
    `SELECT id, user_id, household_id FROM subscription WHERE id = $1`, [subscriptionId]
  )).rows[0];
  if (!sub) throw new Error(`subscription ${subscriptionId} not found`);
  const items = (await runner.query<ItemRow>(
    `SELECT id, archetype, signup_slot_id, signup_coffee_id, weight_oz, quantity, intended_for_user_id FROM subscription_item
     WHERE subscription_id = $1 AND ended_at IS NULL ORDER BY created_at, id`, [subscriptionId]
  )).rows;
  if (!items.length) return { status: 'unresolved', subscriptionId, userId: sub.user_id, unresolved: [{ itemId: '-', reason: 'the subscription has no items' }] };

  const followDial = (await commerceParam('subscription_ships_current_dial_position')) === 1;
  const lines: Array<Omit<ShipmentLine, 'unitPriceCents' | 'discountCents'>> = [];
  const unresolved: UnresolvedItem[] = [];
  for (const item of items) {
    const r = await resolveItem(item, sub.user_id, followDial, runner, sub.household_id);
    if ('reason' in r) unresolved.push(r); else lines.push(r);
  }
  const blocking = unresolved.filter(u => !u.skippable);
  if (blocking.length || !lines.length) return { status: 'unresolved', subscriptionId, userId: sub.user_id, unresolved };

  const pricing = await applySubscriptionPricing(lines);
  return { status: 'resolved', subscriptionId, userId: sub.user_id, skipped: unresolved, ...pricing, lines: pricing.lines as ShipmentLine[] };
}
