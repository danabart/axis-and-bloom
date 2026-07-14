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
