// Website 2 (2026-11-04) — the content Home shows that is data, not layout:
// the "In numbers" facts (computed), the survey quotes (marketing_home_quote)
// and the "This week" coffee (commerce_parameter home_featured_slot, its card
// and price from coffeeCardReads, the same read Shop all uses). D10, D13, D14:
// no fulfilment or timing text anywhere in this payload.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_2_PRESENTATION_DATA.md
import { db } from '../db/client.js';
import { getArchetypes } from './catalogReads.js';
import { commerceParamText } from './commerceParameters.js';
import { getFamilyCards, type SlotCard } from './coffeeCardReads.js';

export interface HomeFacts {
  /** current questions of the active main quiz */
  questions: number;
  /** numeric dimensions with a pooled range on at least one active coffee */
  dimensions: number;
  /** coffee_archetype rows that are real families (is_archetype) */
  families: number;
  /** Website 3 (2026-11-05): the score line of those same numeric dimensions
   * (coffee_dimensions.scale_min / scale_max), so Home's "0 to 15" is read, not typed; null when none counted */
  scaleMin: number | null;
  scaleMax: number | null;
}

export async function getHomeFacts(): Promise<HomeFacts> {
  const [q, d, archetypes] = await Promise.all([
    db.query<{ n: string }>(
      `SELECT COUNT(*) AS n
         FROM quiz_question qq
         JOIN quiz q ON q.id = qq.quiz_id AND q.is_active
         JOIN quiz_type qt ON qt.id = q.quiz_type_id AND qt.name = 'main'
        WHERE qq.is_current`),
    db.query<{ n: string; scale_min: string | null; scale_max: string | null }>(
      `SELECT COUNT(DISTINCT cd.id) AS n, MIN(cd.scale_min) AS scale_min, MAX(cd.scale_max) AS scale_max
         FROM coffee_dimensions cd
        WHERE cd.is_numeric
          AND cd.id IN (SELECT r.dimension_id FROM v_coffee_dimension_range r
                         WHERE r.value_min IS NOT NULL AND r.value_max IS NOT NULL)`),
    getArchetypes(),
  ]);
  return {
    questions: Number(q.rows[0]?.n ?? 0),
    dimensions: Number(d.rows[0]?.n ?? 0),
    families: archetypes.filter(a => a.is_archetype).length,
    scaleMin: d.rows[0]?.scale_min == null ? null : Number(d.rows[0].scale_min),
    scaleMax: d.rows[0]?.scale_max == null ? null : Number(d.rows[0].scale_max),
  };
}

export async function getHomeQuotes(): Promise<string[]> {
  const r = await db.query<{ quote: string }>(
    `SELECT quote FROM marketing_home_quote WHERE is_active ORDER BY sort_order, id`);
  return r.rows.map(row => row.quote);
}

/** The parameter's value parsed: `archetype_code:sort_order` (Format: dial slot, checked by commerceParameters). */
export function parseDialSlot(value: string): { archetype: string; sortOrder: number } | null {
  const m = /^([a-z_]+):(\d+)$/.exec(value.trim());
  return m ? { archetype: m[1], sortOrder: Number(m[2]) } : null;
}

export interface HomeFeatured {
  card: SlotCard;
  /** the anchor size's price (coffee_slot_price via the slot), null when the slot has no coffee or no price */
  price: { weightOz: number; retailPriceCents: number; label: string } | null;
}

/** The "This week" card, or null when the parameter names no slot that exists. */
export async function getHomeFeatured(): Promise<HomeFeatured | null> {
  const slot = parseDialSlot(await commerceParamText('home_featured_slot'));
  if (!slot) {
    console.warn('[home/content] home_featured_slot is not archetype_code:sort_order; no featured coffee');
    return null;
  }
  const family = await getFamilyCards(slot.archetype);
  const card = family?.cards.find(c => c.dialSortOrder === slot.sortOrder) ?? null;
  if (!card) {
    console.warn(`[home/content] home_featured_slot ${slot.archetype}:${slot.sortOrder} names no dial slot; no featured coffee`);
    return null;
  }
  const anchor = card.prices.find(p => p.isAnchor) ?? card.prices[0] ?? null;
  return {
    card,
    price: anchor ? { weightOz: anchor.weightOz, retailPriceCents: anchor.retailPriceCents, label: anchor.label } : null,
  };
}

export async function getHomeContent() {
  const [facts, quotes, featured] = await Promise.all([getHomeFacts(), getHomeQuotes(), getHomeFeatured()]);
  return { facts, quotes, featured };
}
