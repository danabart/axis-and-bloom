import { db } from '../db/client.js';

export interface SkippedCandidate {
  coffee_name: string;
  roaster: string;
  priority: number;
  reason: 'no active blend at that weight';
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

// Priority-ordered fallback for a Bloom Dial slot (archetype + position): tries each
// coffee_alias-listed coffee in priority order (1 = preferred, set on the Coffees page)
// and returns the first one with an active roaster_blend at the requested weight.
// Live-derives the slot the same way GET /api/admin/coffee-alias does, so a coffee
// moved or re-tagged on the Coffees page is picked up automatically. Never guesses —
// returns null if nothing in the slot is currently fulfillable.
//
// quantity_available is deliberately NOT checked here — this is a drop-ship model,
// inventory quantities are not tracked (see WHAT_WE_BUILT.md #70), so that column
// sits at its schema default of 0 on effectively every row. Gating on it made every
// slot resolve to nothing (confirmed root cause of The Bloom Part 1/2 showing
// "Temporarily unavailable" everywhere — see The Bloom Part 3, Phase A). Fulfillability
// is is_active + a row existing at the requested weight, full stop. orders.ts's
// decrement of quantity_available on order placement is unaffected by this — it just
// no longer gates anything either.
export async function resolveBlendForSlot(
  archetype: string,
  dialSortOrder: number,
  weightOz: number
): Promise<ResolvedBlend | null> {
  const candidatesResult = await db.query(
    `SELECT ca.coffee_id, ca.priority, c.name AS coffee_name, c.roaster
     FROM coffee_alias ca
     JOIN coffees c ON c.id = ca.coffee_id
     LEFT JOIN dial_archetype_positions dap ON dap.coffee_id = ca.coffee_id AND dap.is_guest = false
     LEFT JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
     LEFT JOIN archetype_assignments aa
       ON aa.coffee_id = ca.coffee_id AND aa.superseded_at IS NULL
     -- Bloom Dial Base Data Part 4: dap.archetype (the coffee's actual home dial
     -- position, when one exists) now takes precedence over aa.archetype (its
     -- match archetype). Before this, the archetype match was COALESCE(aa.archetype,
     -- ca.archetype) — silently WRONG for a coffee whose match diverges from its
     -- dial position, which now exists by design (Kopi Safari: match='earthy' for
     -- Liam, but dial position='experimental' via the category tag). Without dap
     -- taking priority, Kopi Safari could never resolve as active on ITS OWN
     -- experimental dial slot, since aa.archetype='earthy' always won the COALESCE.
     -- Safe for every other coffee: when dap exists, dap.archetype and aa.archetype
     -- already agree in the normal (non-category) case, so this changes nothing
     -- for them; the Part 3 category exclusion below is a separate, independent
     -- guard and still applies regardless of this precedence change.
     WHERE COALESCE(dap.archetype, aa.archetype, ca.archetype) = $1
       AND COALESCE(dpv.sort_order, ca.dial_sort_order) = $2
       AND ca.is_active = true
       -- Bloom Dial Base Data Part 3: a coffee tagged Decaf/Half-Caf/Flavored
       -- never fills a flavor-dial slot, even via the legacy coffee_alias.archetype/
       -- dial_sort_order fallback columns — giving these coffees a real
       -- archetype_assignments row (Part 1) made COALESCE(aa.archetype,...) start
       -- matching their stale stored fallback position, which is exactly the
       -- "category coffee squats a real dial slot" regression this excludes.
       AND NOT EXISTS (
         SELECT 1 FROM coffee_category_assignment cca
         JOIN coffee_category cc ON cc.id = cca.category_id
         WHERE cca.coffee_id = ca.coffee_id AND cc.code IN ('decaf', 'half_caf', 'flavored')
       )
       -- Experimental-tagged coffees are excluded the same way, but ONLY when
       -- resolving a REAL flavor archetype's slot — the experimental archetype's
       -- OWN dial is exactly where an Experimental-tagged coffee (e.g. Kopi
       -- Safari) is supposed to resolve (Bloom Dial Base Data Part 4, the
       -- Experimental box). Without this carve-out, the Part 3 exclusion above
       -- would make the Experimental dial permanently unresolvable too.
       AND ($1 = 'experimental' OR NOT EXISTS (
         SELECT 1 FROM coffee_category_assignment cca2
         JOIN coffee_category cc2 ON cc2.id = cca2.category_id
         WHERE cca2.coffee_id = ca.coffee_id AND cc2.code = 'experimental'
       ))
     ORDER BY ca.priority ASC`,
    [archetype, dialSortOrder]
  );

  const skipped: SkippedCandidate[] = [];

  for (const candidate of candidatesResult.rows) {
    const blendResult = await db.query(
      `SELECT id AS blend_id, roaster_sku, shopify_variant_id
       FROM roaster_blend
       WHERE coffee_id = $1 AND weight_oz = $2 AND is_active = true`,
      [candidate.coffee_id, weightOz]
    );
    const blend = blendResult.rows[0];

    if (!blend) {
      skipped.push({
        coffee_name: candidate.coffee_name, roaster: candidate.roaster, priority: candidate.priority,
        reason: 'no active blend at that weight',
      });
      continue;
    }

    return {
      blend_id: blend.blend_id,
      coffee_id: candidate.coffee_id,
      coffee_name: candidate.coffee_name,
      roaster: candidate.roaster,
      priority: candidate.priority,
      weight_oz: weightOz,
      roaster_sku: blend.roaster_sku,
      shopify_variant_id: blend.shopify_variant_id,
      skipped,
    };
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
// claimed collection price. Independently resolves each of the archetype's
// positions — via the exact same resolveBlendForSlot() every other purchase
// path already trusts — trying 12oz first, falling back to 5lb, exactly like
// "the classic" CTA's own per-item weight fallback (§B). A position that
// resolves at neither weight, or has no dial_slot_price row, is simply not a
// member — never guessed at, never included unpriced.
export async function computeCollectionOffer(archetype: string): Promise<CollectionOffer | null> {
  const vocabResult = await db.query(
    `SELECT sort_order FROM dial_position_vocabulary WHERE archetype = $1 ORDER BY sort_order`,
    [archetype]
  );

  const members: CollectionMember[] = [];
  for (const { sort_order } of vocabResult.rows) {
    for (const weightOz of COLLECTION_WEIGHTS_OZ) {
      const resolved = await resolveBlendForSlot(archetype, sort_order, weightOz);
      if (!resolved) continue;
      const priceResult = await db.query(
        `SELECT retail_price_cents FROM dial_slot_price WHERE archetype = $1 AND dial_sort_order = $2 AND weight_oz = $3`,
        [archetype, sort_order, weightOz]
      );
      const priceCents = priceResult.rows[0]?.retail_price_cents;
      if (priceCents == null) continue;
      members.push({ dialSortOrder: sort_order, blendId: resolved.blend_id, shopifyVariantId: resolved.shopify_variant_id, weightOz, priceCents });
      break; // 12oz resolved+priced — don't also try 5lb for this position.
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
export async function resolveCoffeeBlend(coffeeId: number, weightOz: number): Promise<ResolvedCoffeeBlend | null> {
  const result = await db.query(
    `SELECT id AS blend_id, roaster_sku, shopify_variant_id
     FROM roaster_blend
     WHERE coffee_id = $1 AND weight_oz = $2 AND is_active = true`,
    [coffeeId, weightOz]
  );
  return result.rows[0] ?? null;
}
