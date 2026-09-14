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
  roaster_name_is_fallback: boolean;
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
  hop_type_stored: 'within_archetype' | 'bridge_archetype';
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

// Case-insensitive on label ("Chocolate & Nutty"), passthrough on code
// ("chocolate_nutty") — replaces every hand-typed toEnum/ARCHETYPE_NAME_TO_KEY.
export async function archetypeCode(labelOrCode: string, runner: Runner = db): Promise<ArchetypeCode | null> {
  const rows = await getArchetypes(runner);
  const byCode = rows.find(r => r.code === labelOrCode);
  if (byCode) return byCode.code;
  const byLabel = rows.find(r => r.label.toLowerCase() === labelOrCode.toLowerCase());
  return byLabel?.code ?? null;
}

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
  const result = await runner.query<SellableSlotRow>(`SELECT * FROM v_coffee_sellable_slot ${where} ORDER BY slot_id, weight_oz`, params);
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
      (SELECT COALESCE(MAX(updated_at), '-infinity') FROM roaster_blend),
      (SELECT COALESCE(MAX(updated_at), '-infinity') FROM dial_slot_price)
    )::text AS version
  `);
  return new Date(result.rows[0].version).toISOString();
}
