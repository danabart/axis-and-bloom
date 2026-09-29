import { db } from '../db/client.js';
import type { Tx } from '../db/client.js';
import type { ArchetypeCode } from './catalogService.js';

// ── Catalog Blueprint · brief 3 (2026-09-14) ──────────────────────────────────
// The only place base-table names for the catalog may appear outside
// catalogService.ts. Small typed helpers over the v_coffee_* views so every
// reader stops re-typing the same SELECT. No business logic — filters and
// shapes only. Every function takes an optional `runner` last (defaults to
// the pool `db`) so the service can reuse these inside a transaction later.
// See backend/src/features/catalog_blueprint/
// CLAUDE_CODE_PROMPT_CATALOG_3_READERS_ONTO_VIEWS.md, Part B.

type Runner = Tx | typeof db;

export interface ArchetypeRow {
  code: ArchetypeCode;
  label: string;
  description: string | null;
  sort_order: number;
  has_bloom_dial: boolean;
  is_archetype: boolean;
  dominant_dimension_id: number | null;
  dominant_dimension_name: string | null;
  descriptor_families: string[];
  uuid: string;
}

export interface CoffeeRow {
  id: number;
  name: string;
  origin: string | null;
  blend_or_single: string | null;
  process: string | null;
  roast_level: string | null;
  roast_shade: string | null;
  flavor_descriptors_roaster: string[] | null;
  ai_summary: string | null;
  surprise_note: string | null;
  three_voice_story: string | null;
  story: string | null;
  story_draft: string | null;
  story_published: boolean;
  story_admin_edited: boolean;
  story_generated_at: string | null;
  roaster_id: string | null;
  roaster_name: string | null;
  match_archetype: ArchetypeCode | null;
  match_confidence: string | null;
  match_source: string | null;
  match_session_id: number | null;
  category_codes: string[];
  has_story: boolean;
  is_active: boolean;
  deactivated_at: string | null;
  deactivation_reason: string | null;
}

export interface CoffeeSlotRow {
  assignment_id: number;
  coffee_id: number;
  coffee_name: string;
  roaster_id: string | null;
  slot_id: number;
  placement_archetype: ArchetypeCode;
  sort_order: number;
  slot_name: string | null;
  position_label: string;
  role: 'home' | 'guest';
  priority: number;
  assignment_is_active: boolean;
  coffee_is_active: boolean;
  certified_at: string | null;
  placement_note: string | null;
  match_archetype: ArchetypeCode | null;
  placement_matches_match: boolean;
}

export interface SellableSlotRow {
  slot_id: number;
  archetype: ArchetypeCode;
  sort_order: number;
  slot_name: string | null;
  position_label: string;
  is_landing_default: boolean;
  weight_oz: number;
  coffee_id: number;
  coffee_name: string;
  roaster_id: string | null;
  role: 'home' | 'guest';
  priority: number;
  blend_id: string;
  roaster_sku: string | null;
  shopify_variant_id: string | null;
  retail_price_cents: number;
  size_label: string;
  size_sort_order: number;
}

export interface SellableCandidateRow extends Omit<SellableSlotRow, 'blend_id' | 'retail_price_cents'> {
  roaster_name: string | null;
  assignment_id: number;
  blend_id: string | null;
  retail_price_cents: number | null;
  is_sellable: boolean;
  rank: number;
}

export interface SlotRow {
  id: number;
  archetype: ArchetypeCode;
  sort_order: number;
  name: string;
  position_label: string;
  position_description: string | null;
  dimension_id: number | null;
  is_landing_default: boolean;
  spec_band_lo: number | null;
  spec_band_hi: number | null;
  spec_descriptor_families: string[];
  is_active: boolean;
}

export interface HopRow {
  id: number;
  from_coffee_id: number;
  to_coffee_id: number;
  dimension_id: number;
  direction: 'more' | 'less';
  delta: number | null;
  is_recommended: boolean;
  confidence: 'low' | 'medium' | 'high';
  notes: string | null;
  from_coffee_name: string | null;
  from_coffee_is_active: boolean | null;
  to_coffee_name: string | null;
  to_coffee_is_active: boolean | null;
  from_slot_id: number | null;
  from_archetype: ArchetypeCode | null;
  to_slot_id: number | null;
  to_archetype: ArchetypeCode | null;
  hop_type_derived: 'within_archetype' | 'bridge_archetype' | null;
}

// ── Archetypes (in-process cache, 60s — labels change once a quarter) ────────

let archetypeCache: { at: number; rows: ArchetypeRow[] } | null = null;
const ARCHETYPE_CACHE_MS = 60_000;

export async function getArchetypes(runner: Runner = db): Promise<ArchetypeRow[]> {
  if (archetypeCache && Date.now() - archetypeCache.at < ARCHETYPE_CACHE_MS) return archetypeCache.rows;
  const result = await runner.query<ArchetypeRow>(`SELECT * FROM v_coffee_archetype ORDER BY sort_order`);
  archetypeCache = { at: Date.now(), rows: result.rows };
  return result.rows;
}

// Never throws in a read path — unknown code falls back to the code itself,
// same "don't break a page over a label" posture as the old ARCHETYPE_LABEL
// maps it replaces.
export async function archetypeLabel(code: string, runner: Runner = db): Promise<string> {
  const rows = await getArchetypes(runner);
  return rows.find(r => r.code === code)?.label ?? code;
}

// Display names that older rows, emails or clients may still send. Codes, not labels,
// on the right-hand side: archetypeCode() is the only place a legacy name is understood.
const LEGACY_LABEL_TO_CODE: Record<string, ArchetypeCode> = {
  'balanced & sweet': 'balanced_sweet',
  'balanced and sweet': 'balanced_sweet',
  'fruity & complex': 'fruity',
};

// Case-insensitive on label ("Chocolate & Nutty"), passthrough on code
// ("chocolate_nutty") — replaces every hand-typed toEnum/ARCHETYPE_NAME_TO_KEY.
export async function archetypeCode(labelOrCode: string, runner: Runner = db): Promise<ArchetypeCode | null> {
  const rows = await getArchetypes(runner);
  const byCode = rows.find(r => r.code === labelOrCode);
  if (byCode) return byCode.code;
  const byLabel = rows.find(r => r.label.toLowerCase() === labelOrCode.toLowerCase());
  if (byLabel) return byLabel.code;
  return LEGACY_LABEL_TO_CODE[labelOrCode.trim().toLowerCase()] ?? null;
}

// Archetype UUID for a display name, legacy name or code — the quiz subsystem's
// FK lookup, so nothing has to key on coffee_archetype.name any more.
export async function archetypeUuid(labelOrCode: string, runner: Runner = db): Promise<string | null> {
  const code = await archetypeCode(labelOrCode, runner);
  if (!code) return null;
  const rows = await getArchetypes(runner);
  return rows.find(r => r.code === code)?.uuid ?? null;
}

// ── Sizes (in-process cache, 60s — same posture as archetype labels) ───────────
// Catalog Sizes + Visibility brief (2026-09-28), Part A. coffee_size is the
// one bag-size list; this is the only file that queries it. pg returns NUMERIC
// as a string, so weight_oz is converted here once and callers get a number.

export interface SizeRow {
  weight_oz: number;
  label: string;
  sort_order: number;
  is_anchor: boolean;
  is_active: boolean;
}

let sizeCache: { at: number; rows: SizeRow[] } | null = null;
const SIZE_CACHE_MS = 60_000;

// Active sizes, in sort_order.
export async function getSizes(runner: Runner = db): Promise<SizeRow[]> {
  if (sizeCache && Date.now() - sizeCache.at < SIZE_CACHE_MS) return sizeCache.rows;
  const result = await runner.query<SizeRow>(
    `SELECT weight_oz, label, sort_order, is_anchor, is_active FROM coffee_size WHERE is_active = true ORDER BY sort_order`
  );
  const rows = result.rows.map(r => ({ ...r, weight_oz: Number(r.weight_oz) }));
  sizeCache = { at: Date.now(), rows };
  return rows;
}

// The anchor size (S2): the one every coffee must have a SKU for, that Liam
// recommends and subscriptions use. Throws if none — integrity check 14 fails
// boot for that state, so this is unreachable in a healthy deploy.
export async function getAnchorSize(runner: Runner = db): Promise<SizeRow> {
  const anchor = (await getSizes(runner)).find(s => s.is_anchor);
  if (!anchor) throw new Error('coffee_size has no active anchor size');
  return anchor;
}

// For tests that change coffee_size within a run.
export function clearSizeCache(): void { sizeCache = null; }

// ── Coffees ──────────────────────────────────────────────────────────────────

export async function getCoffee(coffeeId: number, runner: Runner = db): Promise<CoffeeRow | null> {
  const result = await runner.query<CoffeeRow>(`SELECT * FROM v_coffee WHERE id = $1`, [coffeeId]);
  return result.rows[0] ?? null;
}

export async function getCoffees(
  filter: { active?: boolean; matchArchetype?: string; ids?: number[] } = {},
  runner: Runner = db
): Promise<CoffeeRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.active !== undefined) { params.push(filter.active); clauses.push(`is_active = $${params.length}`); }
  if (filter.matchArchetype !== undefined) { params.push(filter.matchArchetype); clauses.push(`match_archetype = $${params.length}`); }
  if (filter.ids !== undefined) { params.push(filter.ids); clauses.push(`id = ANY($${params.length}::int[])`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await runner.query<CoffeeRow>(`SELECT * FROM v_coffee ${where} ORDER BY name`, params);
  return result.rows;
}

export async function getHomeSlot(coffeeId: number, runner: Runner = db): Promise<CoffeeSlotRow | null> {
  const result = await runner.query<CoffeeSlotRow>(
    `SELECT * FROM v_coffee_slot WHERE coffee_id = $1 AND role = 'home' AND assignment_is_active = true AND coffee_is_active = true`,
    [coffeeId]
  );
  return result.rows[0] ?? null;
}

export async function getSlotsForCoffee(coffeeId: number, runner: Runner = db): Promise<CoffeeSlotRow[]> {
  const result = await runner.query<CoffeeSlotRow>(
    `SELECT * FROM v_coffee_slot WHERE coffee_id = $1 AND assignment_is_active = true ORDER BY (role = 'home') DESC, priority`,
    [coffeeId]
  );
  return result.rows;
}

// Batch variant of getSlotsForCoffee — sommelierRag.ts's getAliases() needs
// "this coffee's best active slot" for many coffees at once without an N+1.
export async function getSlotsForCoffees(coffeeIds: number[], runner: Runner = db): Promise<CoffeeSlotRow[]> {
  if (!coffeeIds.length) return [];
  const result = await runner.query<CoffeeSlotRow>(
    `SELECT * FROM v_coffee_slot WHERE coffee_id = ANY($1::int[]) AND assignment_is_active = true ORDER BY coffee_id, (role = 'home') DESC, priority`,
    [coffeeIds]
  );
  return result.rows;
}

// ── Sellable slots ───────────────────────────────────────────────────────────

export async function getSellableSlots(
  filter: { archetype?: string; weightOz?: number; slotId?: number } = {},
  runner: Runner = db
): Promise<SellableSlotRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.archetype !== undefined) { params.push(filter.archetype); clauses.push(`archetype = $${params.length}`); }
  if (filter.weightOz !== undefined) { params.push(filter.weightOz); clauses.push(`weight_oz = $${params.length}`); }
  if (filter.slotId !== undefined) { params.push(filter.slotId); clauses.push(`slot_id = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await runner.query<SellableSlotRow>(`SELECT * FROM v_coffee_sellable_slot ${where} ORDER BY slot_id, size_sort_order`, params);
  return result.rows;
}

export async function getSellableCandidates(slotId: number, weightOz: number, runner: Runner = db): Promise<SellableCandidateRow[]> {
  const result = await runner.query<SellableCandidateRow>(
    `SELECT * FROM v_coffee_sellable_candidate WHERE slot_id = $1 AND weight_oz = $2 ORDER BY rank`,
    [slotId, weightOz]
  );
  return result.rows;
}

// ── Slots ────────────────────────────────────────────────────────────────────

export async function getSlots(archetype?: string, runner: Runner = db): Promise<SlotRow[]> {
  const result = archetype
    ? await runner.query<SlotRow>(`SELECT * FROM coffee_dial_slot WHERE archetype = $1 ORDER BY sort_order`, [archetype])
    : await runner.query<SlotRow>(`SELECT * FROM coffee_dial_slot ORDER BY archetype, sort_order`);
  return result.rows;
}

// Plain lookup of the prices set per slot (base table, same precedent as
// getSlots() on coffee_dial_slot) — the admin slot cards render one input per
// active size and need the raw price, not just the winner's.
export async function getSlotPrices(slotIds: number[], runner: Runner = db): Promise<Array<{ slot_id: number; weight_oz: number; retail_price_cents: number }>> {
  if (!slotIds.length) return [];
  const result = await runner.query<{ slot_id: number; weight_oz: string; retail_price_cents: number }>(
    `SELECT slot_id, weight_oz, retail_price_cents FROM coffee_slot_price WHERE slot_id = ANY($1::int[]) ORDER BY slot_id, weight_oz`,
    [slotIds]
  );
  return result.rows.map(r => ({ ...r, weight_oz: Number(r.weight_oz) }));
}

// ── Hops ─────────────────────────────────────────────────────────────────────

export async function getHops(
  filter: { coffeeId?: number; fromCoffeeId?: number | number[]; direction?: 'more' | 'less'; recommendedOnly?: boolean } = {},
  runner: Runner = db
): Promise<HopRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.coffeeId !== undefined) {
    params.push(filter.coffeeId);
    clauses.push(`(from_coffee_id = $${params.length} OR to_coffee_id = $${params.length})`);
  }
  if (filter.fromCoffeeId !== undefined) {
    const ids = Array.isArray(filter.fromCoffeeId) ? filter.fromCoffeeId : [filter.fromCoffeeId];
    params.push(ids);
    clauses.push(`from_coffee_id = ANY($${params.length}::int[])`);
  }
  if (filter.direction !== undefined) { params.push(filter.direction); clauses.push(`direction = $${params.length}`); }
  if (filter.recommendedOnly) clauses.push(`is_recommended = true`);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await runner.query<HopRow>(`SELECT * FROM v_coffee_hop ${where}`, params);
  return result.rows;
}

// ── Visibility (admin diagnostic) ─────────────────────────────────────────────
// Catalog Sizes + Visibility brief (2026-09-28), Part B/D. "Visible to
// customers" (S3) = the coffee wins at least one of its placements (home or
// guest) at at least one active size. All of it is v_coffee_visibility /
// v_coffee_visibility_summary; this section only groups those rows for the
// admin UI and orders the reason flags (presentation, no rule of its own).

export type VisibilityReason =
  | 'coffee_inactive' | 'slot_inactive_or_unnamed' | 'category_excluded'
  | 'no_active_sku' | 'no_slot_price' | 'outranked';

interface VisibilityRow {
  coffee_id: number; coffee_name: string; assignment_id: number; slot_id: number;
  archetype: ArchetypeCode; sort_order: number; slot_name: string | null;
  role: 'home' | 'guest'; priority: number;
  weight_oz: string | number; size_label: string; size_sort_order: number; is_anchor_size: boolean;
  is_winner: boolean; winner_coffee_id: number | null; winner_coffee_name: string | null;
  slot_inactive_or_unnamed: boolean; coffee_inactive: boolean; category_excluded: boolean;
  no_active_sku: boolean; no_slot_price: boolean; outranked: boolean;
}

// Why a placement is not winning at one size. Root causes first: an inactive
// coffee / slot or an excluded category explains everything else, and a
// missing SKU is reported before a missing price (fix the SKU first).
function visibilityReasons(r: VisibilityRow): VisibilityReason[] {
  if (r.is_winner) return [];
  if (r.coffee_inactive) return ['coffee_inactive'];
  if (r.slot_inactive_or_unnamed) return ['slot_inactive_or_unnamed'];
  if (r.category_excluded) return ['category_excluded'];
  if (r.no_active_sku) return ['no_active_sku'];
  if (r.no_slot_price) return ['no_slot_price'];
  if (r.outranked) return ['outranked'];
  return [];
}

export interface VisibilitySize {
  weightOz: number;
  label: string;
  isAnchor: boolean;
  isWinner: boolean;
  reasons: VisibilityReason[];
  winnerCoffeeId: number | null;
  winnerCoffeeName: string | null;
}

export interface VisibilityPlacement {
  assignmentId: number;
  slotId: number;
  archetype: ArchetypeCode;
  sortOrder: number;
  slotName: string | null;
  role: 'home' | 'guest';
  priority: number;
  sizes: VisibilitySize[];
}

export interface CoffeeVisibility {
  coffeeId: number;
  isVisible: boolean;
  isPlaced: boolean;
  visibleSlotCount: number;
  placements: VisibilityPlacement[];
}

function toVisibilitySize(r: VisibilityRow): VisibilitySize {
  return {
    weightOz: Number(r.weight_oz), label: r.size_label, isAnchor: r.is_anchor_size, isWinner: r.is_winner,
    reasons: visibilityReasons(r), winnerCoffeeId: r.winner_coffee_id, winnerCoffeeName: r.winner_coffee_name,
  };
}

const VISIBILITY_ORDER = `ORDER BY coffee_id, (role = 'home') DESC, priority, slot_id, size_sort_order`;

// One entry per coffee (all coffees when coffeeIds is omitted, including
// unplaced and inactive ones), keyed by coffee id.
export async function getCoffeeVisibility(coffeeIds?: number[], runner: Runner = db): Promise<Map<number, CoffeeVisibility>> {
  const params: unknown[] = [];
  const where = coffeeIds ? (params.push(coffeeIds), `WHERE coffee_id = ANY($1::int[])`) : '';
  const [summary, rows] = await Promise.all([
    runner.query<{ coffee_id: number; is_visible: boolean; is_placed: boolean; visible_slot_count: string }>(
      `SELECT coffee_id, is_visible, is_placed, visible_slot_count FROM v_coffee_visibility_summary ${where}`, params
    ),
    runner.query<VisibilityRow>(`SELECT * FROM v_coffee_visibility ${where} ${VISIBILITY_ORDER}`, params),
  ]);
  const out = new Map<number, CoffeeVisibility>();
  for (const s of summary.rows) {
    out.set(s.coffee_id, {
      coffeeId: s.coffee_id, isVisible: s.is_visible, isPlaced: s.is_placed,
      visibleSlotCount: Number(s.visible_slot_count), placements: [],
    });
  }
  const byAssignment = new Map<number, VisibilityPlacement>();
  for (const r of rows.rows) {
    let placement = byAssignment.get(r.assignment_id);
    if (!placement) {
      placement = {
        assignmentId: r.assignment_id, slotId: r.slot_id, archetype: r.archetype, sortOrder: r.sort_order,
        slotName: r.slot_name, role: r.role, priority: r.priority, sizes: [],
      };
      byAssignment.set(r.assignment_id, placement);
      out.get(r.coffee_id)?.placements.push(placement);
    }
    placement.sizes.push(toVisibilitySize(r));
  }
  return out;
}

export interface SlotVisibilitySize {
  weightOz: number;
  label: string;
  winnerCoffeeId: number | null;
  winnerCoffeeName: string | null;
  // When nobody wins: the slot's top-ranked occupant (home first, then
  // priority) and why it is not showing. Null when the slot has no occupant
  // (or somebody wins).
  topOccupant: { coffeeId: number; coffeeName: string; reasons: VisibilityReason[] } | null;
}

export interface SlotVisibility {
  slotId: number;
  isVisible: boolean;
  sizes: SlotVisibilitySize[];
}

// Per slot, per active size: who wins (v_coffee_visibility's winner columns,
// i.e. v_coffee_sellable_slot) and, when nobody does, why. Slots with no
// active placement have no rows in the view; they get every size with no
// winner and no occupant.
export async function getSlotVisibility(slotIds?: number[], runner: Runner = db): Promise<Map<number, SlotVisibility>> {
  const params: unknown[] = [];
  const where = slotIds ? (params.push(slotIds), `WHERE slot_id = ANY($1::int[])`) : '';
  const [sizes, rows] = await Promise.all([
    getSizes(runner),
    runner.query<VisibilityRow>(
      `SELECT * FROM v_coffee_visibility ${where} ORDER BY slot_id, size_sort_order, (role = 'home') DESC, priority`, params
    ),
  ]);
  const bySlot = new Map<number, Map<number, VisibilityRow>>();
  for (const r of rows.rows) {
    const perSize = bySlot.get(r.slot_id) ?? new Map<number, VisibilityRow>();
    const key = Number(r.weight_oz);
    if (!perSize.has(key)) perSize.set(key, r); // first row per slot x size = top occupant
    bySlot.set(r.slot_id, perSize);
  }
  const out = new Map<number, SlotVisibility>();
  const ids = slotIds ?? [...bySlot.keys()];
  for (const slotId of ids) {
    const perSize = bySlot.get(slotId);
    const slotSizes: SlotVisibilitySize[] = sizes.map(sz => {
      const top = perSize?.get(sz.weight_oz);
      return {
        weightOz: sz.weight_oz, label: sz.label,
        winnerCoffeeId: top?.winner_coffee_id ?? null, winnerCoffeeName: top?.winner_coffee_name ?? null,
        topOccupant: top && top.winner_coffee_id == null
          ? { coffeeId: top.coffee_id, coffeeName: top.coffee_name, reasons: visibilityReasons(top) }
          : null,
      };
    });
    out.set(slotId, { slotId, isVisible: slotSizes.some(s => s.winnerCoffeeId != null), sizes: slotSizes });
  }
  return out;
}

// Placements that are active but win at no size — the "placed but not visible
// to customers" diagnostic (integrity check 8, GET /catalog/not-sellable).
export interface NotSellableRow {
  slot_id: number;
  archetype: ArchetypeCode;
  sort_order: number;
  slot_name: string | null;
  coffee_id: number;
  coffee_name: string;
  role: 'home' | 'guest';
  reasons: VisibilityReason[];
  sizes: Array<{ weight_oz: number; label: string; reasons: VisibilityReason[] }>;
}

export async function getNotSellable(filter: { slotId?: number; coffeeId?: number } = {}, runner: Runner = db): Promise<NotSellableRow[]> {
  const result = await runner.query<VisibilityRow>(
    `SELECT v.* FROM v_coffee_visibility v
     WHERE ($1::int IS NULL OR v.slot_id = $1) AND ($2::int IS NULL OR v.coffee_id = $2)
       AND NOT EXISTS (SELECT 1 FROM v_coffee_visibility w WHERE w.assignment_id = v.assignment_id AND w.is_winner)
     ORDER BY v.archetype, v.sort_order, (v.role = 'home') DESC, v.priority, v.size_sort_order`,
    [filter.slotId ?? null, filter.coffeeId ?? null]
  );
  const rows = new Map<number, NotSellableRow>();
  for (const r of result.rows) {
    let row = rows.get(r.assignment_id);
    if (!row) {
      row = {
        slot_id: r.slot_id, archetype: r.archetype, sort_order: r.sort_order, slot_name: r.slot_name,
        coffee_id: r.coffee_id, coffee_name: r.coffee_name, role: r.role, reasons: [], sizes: [],
      };
      rows.set(r.assignment_id, row);
    }
    const reasons = visibilityReasons(r);
    row.sizes.push({ weight_oz: Number(r.weight_oz), label: r.size_label, reasons });
    for (const reason of reasons) if (!row.reasons.includes(reason)) row.reasons.push(reason);
  }
  return [...rows.values()];
}

// Winning slots per archetype per size — integrity check 9's data.
export async function getVisibleSlotCounts(runner: Runner = db): Promise<Array<{ archetype: string; weight_oz: number; label: string; count: number }>> {
  const result = await runner.query<{ archetype: string; weight_oz: string; label: string; count: string }>(
    `SELECT archetype, weight_oz, size_label AS label, COUNT(DISTINCT slot_id) AS count
     FROM v_coffee_sellable_slot GROUP BY archetype, weight_oz, size_label, size_sort_order
     ORDER BY archetype, size_sort_order`
  );
  return result.rows.map(r => ({ archetype: r.archetype, weight_oz: Number(r.weight_oz), label: r.label, count: Number(r.count) }));
}

// Anchor count plus any weight present in the three price/SKU tables but
// missing from coffee_size — integrity check 14's data.
export async function getSizeIntegrity(runner: Runner = db): Promise<{ anchorCount: number; orphanWeights: Array<{ table: string; weight_oz: number }> }> {
  const [anchor, orphans] = await Promise.all([
    runner.query<{ count: string }>(`SELECT COUNT(*) AS count FROM coffee_size WHERE is_anchor = true AND is_active = true`),
    runner.query<{ tbl: string; weight_oz: string }>(
      `SELECT 'coffee_sku' AS tbl, weight_oz FROM coffee_sku WHERE weight_oz NOT IN (SELECT weight_oz FROM coffee_size)
       UNION SELECT 'coffee_slot_price', weight_oz FROM coffee_slot_price WHERE weight_oz NOT IN (SELECT weight_oz FROM coffee_size)
       UNION SELECT 'coffee_retail_price', weight_oz FROM coffee_retail_price WHERE weight_oz NOT IN (SELECT weight_oz FROM coffee_size)`
    ),
  ]);
  return {
    anchorCount: Number(anchor.rows[0].count),
    orphanWeights: orphans.rows.map(r => ({ table: r.tbl, weight_oz: Number(r.weight_oz) })),
  };
}

// ── Catalog changes feed (admin diagnostic) ───────────────────────────────────

export interface ChangeRow {
  at: string;
  actor: string | null;
  verb: string;
  method: string;
  path: string;
  status: number | null;
  coffee_id: number | null;
  slot_id: number | null;
  error: unknown;
}

// api_event rows never carry a coffee_id/slot_id column (Part D: "nothing new
// is stored") — parsed from the route path (…/coffees/:id/…, …/slots/:id/…)
// and, as a fallback, the request body's own coffeeId/slotId/toSlotId fields
// (placements/move send the target as a body field, not a path segment).
function parsePathId(path: string, segment: string): number | null {
  const match = path.match(new RegExp(`/${segment}/(\\d+)`));
  return match ? Number(match[1]) : null;
}

const CHANGES_FETCH_CAP = 500;

// Catalog Blueprint brief 4, Part D — every mutating call under
// /api/admin/catalog/*, newest first. No new storage: api_event already
// captures every mutating request (middleware/apiEventLog.ts); this just
// reads and reshapes it.
export async function getChanges(
  filter: { limit?: number; coffeeId?: number; slotId?: number } = {},
  runner: Runner = db
): Promise<ChangeRow[]> {
  const limit = filter.limit ?? 100;
  const result = await runner.query<{
    occurred_at: string; call_type: string; method: string; path: string;
    firebase_uid: string | null; response_status: number | null;
    response_error: unknown; request_body: Record<string, unknown> | null;
  }>(
    `SELECT occurred_at, call_type, method, path, firebase_uid, response_status, response_error, request_body
     FROM api_event
     WHERE path LIKE '/api/admin/catalog/%' AND method <> 'GET'
     ORDER BY occurred_at DESC
     LIMIT $1`,
    [CHANGES_FETCH_CAP]
  );

  const rows = result.rows.map((r): ChangeRow => {
    const body = r.request_body ?? {};
    const coffeeId = parsePathId(r.path, 'coffees')
      ?? (typeof body.coffeeId === 'number' ? body.coffeeId : null);
    const slotId = parsePathId(r.path, 'slots')
      ?? (typeof body.slotId === 'number' ? body.slotId : typeof body.toSlotId === 'number' ? body.toSlotId : null);
    return {
      at: r.occurred_at, actor: r.firebase_uid, verb: r.call_type, method: r.method, path: r.path,
      status: r.response_status, coffee_id: coffeeId, slot_id: slotId, error: r.response_error,
    };
  });

  const filtered = rows.filter((r) =>
    (filter.coffeeId === undefined || r.coffee_id === filter.coffeeId)
    && (filter.slotId === undefined || r.slot_id === filter.slotId)
  );
  return filtered.slice(0, limit);
}

// ── Catalog version — the Liam snapshot key ───────────────────────────────────
// GREATEST(updated_at) across the tables a placement/price/SKU/slot change
// touches. `coffees` itself has no updated_at column (Don'ts: no schema
// changes beyond Part A) — created_at/deactivated_at stand in for it, which
// covers createCoffee and retire/restoreCoffee but not a bare updateCoffee
// metadata edit with no activation-state change; acceptable since a metadata
// edit alone doesn't change what Liam would recommend or name.
export async function getCatalogVersion(runner: Runner = db): Promise<string> {
  const result = await runner.query<{ version: string }>(`
    SELECT GREATEST(
      (SELECT COALESCE(MAX(updated_at), '-infinity') FROM coffee_slot_assignment),
      (SELECT COALESCE(MAX(updated_at), '-infinity') FROM coffee_dial_slot),
      (SELECT COALESCE(MAX(created_at), '-infinity') FROM coffees),
      (SELECT COALESCE(MAX(deactivated_at), '-infinity') FROM coffees),
      (SELECT COALESCE(MAX(updated_at), '-infinity') FROM coffee_sku),
      (SELECT COALESCE(MAX(updated_at), '-infinity') FROM coffee_slot_price)
    )::text AS version
  `);
  return new Date(result.rows[0].version).toISOString();
}
