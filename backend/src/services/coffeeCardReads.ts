// Website 2 (2026-11-04) — the customer card's one read, shared by
// GET /api/coffees/cards (Shop all, The Bloom) and GET /api/home/content
// ("This week"). backend/src/features/website_handoff/
// CLAUDE_CODE_PROMPT_WEBSITE_2_PRESENTATION_DATA.md
//
// Nothing here is new business logic. The slot builder, the collection
// preview and the other-categories list moved here unchanged from
// routes/coffees.ts (G3.9: reuse, do not fork); the card adds, per coffee,
// v_coffee_card (hint, milk, photo key, origin region, leads in cup), the
// signature words (cuppingReads.getCustomerDescriptors, the roaster's words
// first) and the roaster-side facts (roasterVoiceReads.getCardFacts: best
// and also-good brews, the award as a flag). A field with no value is left
// out of the card, never sent as a placeholder (D9).
import { resolveCoffeeBlend, collectionRules } from './blendResolver.js';
import {
  archetypeLabel, getArchetypes, getCoffees, getHomeSlot, getSlots, getSellableSlots, getSizes, getAnchorSize,
  getCategoryCoffees, getCoffeeRetailPrices, getCoffeeCardRows, type CoffeeCardRow,
} from './catalogReads.js';
import { getCustomerDescriptors } from './cuppingReads.js';
import { getCardFacts, signatureWords } from './roasterVoiceReads.js';

export interface Slot {
  dialSortOrder: number;
  positionLabel: string;
  description: string | null;
  isActive: boolean;
  platformName: string | null;
  isDefault: boolean;
  prices: { weightOz: number; retailPriceCents: number; label: string; isAnchor: boolean }[];
  coffeeId: number | null;
}

// Shared per-archetype slot builder — used by both /archetypes (the 5 real
// archetypes) and /experimental. One row per coffee_dial_slot (always 4,
// sort_order 1-4); sellability/price/coffeeId come from v_coffee_sellable_slot
// at every active size (coffee_size), independently per size (a slot can be
// sellable at some sizes, all, or none). One query for the archetype, grouped
// here; rows arrive in size sort order.
export async function buildSlotsForArchetype(archetype: string): Promise<Slot[]> {
  const [slots, sellable] = await Promise.all([
    getSlots(archetype),
    getSellableSlots({ archetype }),
  ]);
  const bySlot = new Map<number, typeof sellable>();
  for (const r of sellable) {
    const list = bySlot.get(r.slot_id) ?? [];
    list.push(r);
    bySlot.set(r.slot_id, list);
  }
  const anchor = await getAnchorSize();

  return slots.map(s => {
    const winners = bySlot.get(s.id) ?? [];
    // isActive = any size wins; coffeeId = the anchor-size winner, else the first size (by sort order) that has one.
    const winner = winners.find(r => Number(r.weight_oz) === anchor.weight_oz) ?? winners[0];
    const prices = winners.map(r => ({ weightOz: Number(r.weight_oz), retailPriceCents: r.retail_price_cents, label: r.size_label, isAnchor: Number(r.weight_oz) === anchor.weight_oz }));
    return {
      dialSortOrder: s.sort_order,
      positionLabel: s.position_label,
      description:   s.position_description ?? null,
      isActive:      !!winner,
      platformName:  s.name ?? null,
      isDefault:     s.is_landing_default,
      prices,
      coffeeId:      winner?.coffee_id ?? null,
    };
  });
}

// Part 19 §C — cheap DISPLAY-only version of blendResolver's computeCollectionOffer:
// reuses the slots array GET /archetypes and GET /experimental already fetched
// (isActive + prices per position), no extra queries. This is a preview only —
// order-time verification (orders.ts) always calls the DB-fresh version in
// blendResolver.ts instead, which independently re-resolves everything; the two
// are expected to usually agree but are never assumed to, which is the whole
// point of §C's server-side enforcement requirement. Same discount and minimum
// as the authoritative version: collectionRules() reads the commerce_parameter
// rows collection_discount_pct / collection_min_members (Commerce 1, decision C),
// so a rate change is one admin edit and never a deploy.
export async function computeCollectionOfferFromSlots(slots: Slot[], anchorOz: number) {
  const { discountPct, minMembers } = await collectionRules();
  const members: { dialSortOrder: number; weightOz: number; priceCents: number }[] = [];
  for (const s of slots) {
    if (!s.isActive || !s.prices.length) continue;
    const chosen = s.prices.find(p => p.weightOz === anchorOz) ?? s.prices[0];
    members.push({ dialSortOrder: s.dialSortOrder, weightOz: chosen.weightOz, priceCents: chosen.retailPriceCents });
  }
  if (members.length < minMembers) return null;
  const sumCents = members.reduce((sum, m) => sum + m.priceCents, 0);
  const discountedCents = Math.round(sumCents * (1 - discountPct / 100));
  return { memberCount: members.length, sumCents, discountedCents };
}

/** The category coffees (Decaf, Half-Caf, Flavored, Experimental): GET /api/coffees/other-categories' payload. */
export async function getOtherCategoryCoffees() {
  const categoryRows = await getCategoryCoffees(['decaf', 'half_caf', 'flavored', 'experimental']);
  const coffeeIds = [...new Set(categoryRows.map(r => r.coffee_id))];
  const coffees = coffeeIds.length ? await getCoffees({ ids: coffeeIds, active: true }) : [];
  const coffeeMap = new Map(coffees.map(c => [c.id, c]));

  const byCoffee = new Map<number, { categories: { code: string; label: string; sortOrder: number }[] }>();
  for (const row of categoryRows) {
    if (!coffeeMap.has(row.coffee_id)) continue; // inactive (or not found) — excluded, same as the old c.is_active filter
    if (!byCoffee.has(row.coffee_id)) byCoffee.set(row.coffee_id, { categories: [] });
    byCoffee.get(row.coffee_id)!.categories.push({ code: row.category_code, label: row.category_label, sortOrder: row.category_sort_order });
  }

  const sizes = await getSizes();
  const priceRows = await getCoffeeRetailPrices({ includeInactive: true }); // inactive coffees are dropped via coffeeMap above
  const priceMap = new Map<string, number>();
  for (const r of priceRows) priceMap.set(`${r.coffee_id}|${Number(r.weight_oz)}`, r.retail_price_cents);

  const result = [];
  for (const [coffeeId, info] of byCoffee) {
    const coffee = coffeeMap.get(coffeeId)!;
    const homeSlot = await getHomeSlot(coffeeId);
    const prices = [];
    for (const { weight_oz: weightOz, label, is_anchor: isAnchor } of sizes) {
      const cents = priceMap.get(`${coffeeId}|${weightOz}`);
      if (cents === undefined) continue; // unpriced — omit rather than guess
      const blend = await resolveCoffeeBlend(coffeeId, weightOz);
      prices.push({ weightOz, retailPriceCents: cents, isActive: !!blend, label, isAnchor });
    }
    result.push({
      coffeeId,
      displayName: homeSlot?.slot_name ?? coffee.name,
      archetype: coffee.match_archetype,
      archetypeLabel: coffee.match_archetype ? await archetypeLabel(coffee.match_archetype) : null,
      categories: info.categories.sort((a, b) => a.sortOrder - b.sortOrder),
      prices,
      effectivelyActive: prices.some(p => p.isActive),
      isUnpriced: prices.length === 0,
    });
  }

  return result;
}

// ── The card ─────────────────────────────────────────────────────────────────

/** What a card adds to a slot or a category coffee; absent keys mean "no value", the card omits the row. */
export interface CardPresentation {
  signatureNotes: string[];
  hint?: string;
  bestBrew?: string;
  alsoGood: string[];
  milk?: string;
  leadsInCup?: string;
  originRegion?: string;
  hasAward: boolean;
  photoKey?: string;
}

function presentationOf(row: CoffeeCardRow | undefined, facts: Awaited<ReturnType<typeof getCardFacts>>, notes: string[]): CardPresentation {
  const out: CardPresentation = { signatureNotes: notes, alsoGood: facts.alsoGoodBrews, hasAward: facts.hasAward };
  if (row?.hint) out.hint = row.hint;
  if (facts.bestBrew) out.bestBrew = facts.bestBrew;
  if (row?.milk_customer_label) out.milk = row.milk_customer_label;
  if (row?.leads_customer_label) out.leadsInCup = row.leads_customer_label;
  if (row?.origin_region_label) out.originRegion = row.origin_region_label;
  if (row?.photo_asset_key) out.photoKey = row.photo_asset_key;
  return out;
}

/** The presentation of each coffee id, read once per coffee. */
export async function getCardPresentations(coffeeIds: number[]): Promise<Map<number, CardPresentation>> {
  const ids = [...new Set(coffeeIds)];
  const rows = await getCoffeeCardRows(ids);
  const entries = await Promise.all(ids.map(async id => {
    const [facts, descriptors] = await Promise.all([getCardFacts(id), getCustomerDescriptors(id)]);
    return [id, presentationOf(rows.get(id), facts, signatureWords({ descriptors }))] as const;
  }));
  return new Map(entries);
}

export type SlotCard = Slot & { archetype: string; archetypeLabel: string } & Partial<CardPresentation>;

export interface FamilyCards {
  archetype: string;
  archetypeLabel: string;
  sortOrder: number;
  customerWords: string[] | null;
  collectionOffer: Awaited<ReturnType<typeof computeCollectionOfferFromSlots>>;
  cards: SlotCard[];
}

/** One family's four slots as cards (a slot with no coffee keeps its slot fields and no presentation). */
export async function getFamilyCards(code: string): Promise<FamilyCards | null> {
  const archetype = (await getArchetypes()).find(a => a.code === code);
  if (!archetype) return null;
  const slots = await buildSlotsForArchetype(code);
  const presentations = await getCardPresentations(slots.flatMap(s => (s.coffeeId ? [s.coffeeId] : [])));
  return {
    archetype: archetype.code,
    archetypeLabel: archetype.label,
    sortOrder: archetype.sort_order,
    customerWords: archetype.customer_words ?? null,
    collectionOffer: await computeCollectionOfferFromSlots(slots, (await getAnchorSize()).weight_oz),
    cards: slots.map(s => ({
      ...s, archetype: archetype.code, archetypeLabel: archetype.label,
      ...(s.coffeeId ? presentations.get(s.coffeeId) : {}),
    })),
  };
}

/**
 * GET /api/coffees/cards: the five families in sort_order, each with its
 * words, collection offer and four slot cards, then "other": the category
 * coffees (D5). A category coffee's name is its home slot's, else null:
 * never the raw coffee name.
 */
export async function getCoffeeCards() {
  const families = (await getArchetypes()).filter(a => a.is_archetype).sort((a, b) => a.sort_order - b.sort_order);
  const familyCards = await Promise.all(families.map(a => getFamilyCards(a.code)));
  const otherRows = await getOtherCategoryCoffees();
  const presentations = await getCardPresentations(otherRows.map(r => r.coffeeId));
  const other = await Promise.all(otherRows.map(async r => {
    const home = await getHomeSlot(r.coffeeId);
    return {
      coffeeId: r.coffeeId,
      platformName: home?.slot_name ?? null,
      archetype: r.archetype,
      archetypeLabel: r.archetypeLabel,
      categories: r.categories,
      prices: r.prices,
      effectivelyActive: r.effectivelyActive,
      isUnpriced: r.isUnpriced,
      ...presentations.get(r.coffeeId),
    };
  }));
  return { families: familyCards.filter((f): f is FamilyCards => f !== null), other: { cards: other } };
}
