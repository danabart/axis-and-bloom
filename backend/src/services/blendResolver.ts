import { db } from '../db/client.js';
import { getSlots, getSellableCandidates, getSellableSlots } from './catalogReads.js';

// Catalog Blueprint · brief 3 (2026-09-14) — rebuilt onto the views
// (v_coffee_sellable_candidate / v_coffee_sellable_slot) via catalogReads.ts.
// Signature and ResolvedBlend/SkippedCandidate shapes unchanged, so every
// caller (checkout, admin previews, the collection offer below) keeps
// working untouched. The category exclusions (decaf/half_caf/flavored never
// fill a flavor slot; experimental-tagged coffees only fill the experimental
// dial) and the coffee_alias-based lookup are gone — the candidate view owns
// both now. Guests resolve once every home candidate is gone or skipped
// (D5), which the old coffee_alias-priority chain never did.

export interface SkippedCandidate {
  coffee_name: string;
  roaster: string;
  priority: number;
  reason: 'no active blend at that weight' | 'no price at that weight';
}

export interface ResolvedBlend {
  blend_id: string;
  coffee_id: number;
  coffee_name: string;
  roaster: string;
  priority: number;
  weight_oz: number;
  roaster_sku: string | null;
  shopify_variant_id: string | null;
  skipped: SkippedCandidate[];
}

// Priority-ordered fallback for a Bloom Dial slot (archetype + position): the
// candidate list is v_coffee_sellable_candidate at (slotId, weightOz),
// ordered home-first then priority (rank); the first is_sellable row wins.
// quantity_available is deliberately never checked (drop-ship model, see the
// original WHAT_WE_BUILT.md #70 note this carries forward) — fulfillability
// is is_active + an active blend + a price, full stop.
export async function resolveBlendForSlot(
  archetype: string,
  dialSortOrder: number,
  weightOz: number,
  opts: { excludeCoffeeIds?: number[] } = {}
): Promise<ResolvedBlend | null> {
  const excludeCoffeeIds = new Set(opts.excludeCoffeeIds ?? []);
  const slots = await getSlots(archetype);
  const slot = slots.find(s => s.sort_order === dialSortOrder);
  if (!slot) return null;

  const candidates = (await getSellableCandidates(slot.id, weightOz)).filter(c => !excludeCoffeeIds.has(c.coffee_id));

  const skipped: SkippedCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.is_sellable) {
      return {
        blend_id: candidate.blend_id!,
        coffee_id: candidate.coffee_id,
        coffee_name: candidate.coffee_name,
        roaster: candidate.roaster_name ?? '',
        priority: candidate.priority,
        weight_oz: weightOz,
        roaster_sku: candidate.roaster_sku,
        shopify_variant_id: candidate.shopify_variant_id,
        skipped,
      };
    }
    skipped.push({
      coffee_name: candidate.coffee_name,
      roaster: candidate.roaster_name ?? '',
      priority: candidate.priority,
      reason: candidate.blend_id == null ? 'no active blend at that weight' : 'no price at that weight',
    });
  }

  return null;
}

// Part 19 §C — "the collection" (whole-archetype bundle, 10% off). ONE constant,
// defined here and nowhere else, so backend verification and (indirectly, via
// what the API returns) frontend display can never drift apart — the frontend
// never computes this percentage itself, it only ever displays the cents value
// this module already discounted (see coffees.ts's computeCollectionOfferFromSlots
// and GET /archetypes's `collectionOffer` field).
export const COLLECTION_DISCOUNT = 0.10;
// A "set" of fewer than this reads wrong (Dana's own framing) — also the floor
// below which the collection CTA is hidden entirely.
export const COLLECTION_MIN_MEMBERS = 3;
const COLLECTION_WEIGHTS_OZ = [12, 80]; // try 12oz first per member, else 5lb — same fallback order as "the classic" (§B).

export interface CollectionMember {
  dialSortOrder: number;
  blendId: string;
  shopifyVariantId: string | null;
  weightOz: number;
  priceCents: number;
}
export interface CollectionOffer {
  members: CollectionMember[];
  sumCents: number;
  discountedCents: number;
}

// Part 19 §C — the SOURCE OF TRUTH for a collection's price: re-derived fresh
// from live DB state (never trusts anything the client sent), used by
// orders.ts at order-creation time to verify (never just accept) a client's
// claimed collection price. Reads getSellableSlots per weight (brief 3) —
// each already-resolved, already-priced slot from the view, no separate
// resolve-then-price-lookup pass needed.
export async function computeCollectionOffer(archetype: string): Promise<CollectionOffer | null> {
  const members: CollectionMember[] = [];
  const seenSortOrders = new Set<number>();
  for (const weightOz of COLLECTION_WEIGHTS_OZ) {
    const sellable = await getSellableSlots({ archetype, weightOz });
    for (const slot of sellable) {
      if (seenSortOrders.has(slot.sort_order)) continue; // 12oz already resolved+priced this position
      members.push({
        dialSortOrder: slot.sort_order, blendId: slot.blend_id, shopifyVariantId: slot.shopify_variant_id,
        weightOz, priceCents: slot.retail_price_cents,
      });
      seenSortOrders.add(slot.sort_order);
    }
  }

  if (members.length < COLLECTION_MIN_MEMBERS) return null;
  const sumCents = members.reduce((sum, m) => sum + m.priceCents, 0);
  const discountedCents = Math.round(sumCents * (1 - COLLECTION_DISCOUNT));
  return { members, sumCents, discountedCents };
}

export interface ResolvedCoffeeBlend {
  blend_id: string;
  roaster_sku: string | null;
  shopify_variant_id: string | null;
}

// Direct coffee->blend resolution for coffees with no dial position (Decaf/Half-Caf/
// Flavored/Experimental category coffees — Bloom Dial Base Data Part 3, Phase 6).
// No priority-fallback chain needed here (unlike resolveBlendForSlot) — a category
// coffee is a single specific product, not a dial slot with multiple roaster options.
// Same "is_active + a row exists at this weight, full stop" fulfillability rule as
// resolveBlendForSlot — quantity_available is never checked (drop-ship model).
// Not moved onto a view — this reads coffees/roaster_blend directly by coffee_id,
// which isn't a slot/placement question at all (D2: an owned-coffee lookup).
export async function resolveCoffeeBlend(coffeeId: number, weightOz: number): Promise<ResolvedCoffeeBlend | null> {
  const result = await db.query(
    `SELECT rb.id AS blend_id, rb.roaster_sku, rb.shopify_variant_id
     FROM coffee_sku rb
     JOIN coffees c ON c.id = rb.coffee_id
     WHERE rb.coffee_id = $1 AND rb.weight_oz = $2 AND rb.is_active = true AND c.is_active = true`,
    [coffeeId, weightOz]
  );
  return result.rows[0] ?? null;
}
