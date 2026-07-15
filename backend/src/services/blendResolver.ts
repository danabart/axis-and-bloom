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
     WHERE COALESCE(aa.archetype, ca.archetype) = $1
       AND COALESCE(dpv.sort_order, ca.dial_sort_order) = $2
       AND ca.is_active = true
       -- Bloom Dial Base Data Part 3: a coffee tagged Decaf/Half-Caf/Flavored/
       -- Experimental never fills a flavor-dial slot, even via the legacy
       -- coffee_alias.archetype/dial_sort_order fallback columns — giving these
       -- coffees a real archetype_assignments row (Part 1) made COALESCE(aa.archetype,...)
       -- start matching their stale stored fallback position, which is exactly
       -- the "category coffee squats a real dial slot" regression this excludes.
       AND NOT EXISTS (
         SELECT 1 FROM coffee_category_assignment cca
         JOIN coffee_category cc ON cc.id = cca.category_id
         WHERE cca.coffee_id = ca.coffee_id AND cc.code IN ('decaf', 'half_caf', 'flavored', 'experimental')
       )
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
