import { db, withTransaction, type Tx } from '../db/client.js';
import { getAvgCuppingScore } from './dialSuggestion.js';
import {
  checkActiveAssignmentsValid,
  checkOneActiveHome,
  checkActiveCoffeeMatchAndRoaster,
  checkPlacedNotSellable,
  type CatalogIntegrityCheck,
} from './catalogIntegrity.js';

// ── Catalog Blueprint · brief 2 (2026-09-14) ──────────────────────────────────
// The one place every catalog write happens. See backend/src/features/
// catalog_blueprint/CLAUDE_CODE_PROMPT_CATALOG_2_SERVICE_ROUTES_IMPORT.md.
// Every verb: takes an input object + ctx, runs inside withTransaction,
// returns CatalogWriteResult. routes/admin.ts's /catalog/* endpoints are thin
// wrappers over these — no SQL on a catalog table lives outside this file.

export type ArchetypeCode = 'chocolate_nutty' | 'balanced_sweet' | 'fruity' | 'earthy' | 'floral' | 'experimental';
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type AssignmentSource = 'cupping' | 'manual' | 'import';
export type SlotRole = 'home' | 'guest';

export interface Ctx {
  actor: string; // admin uid, or 'import' / 'system'
}

export type CatalogErrorCode =
  | 'COFFEE_NOT_FOUND' | 'SLOT_NOT_FOUND' | 'ROASTER_NOT_FOUND' | 'COFFEE_INACTIVE' | 'SLOT_INACTIVE'
  | 'HOME_EXISTS' | 'PRIORITY_TAKEN' | 'NOTE_REQUIRED' | 'ALREADY_ASSIGNED' | 'SKU_EXISTS'
  | 'ROASTER_STATE' | 'INVALID_INPUT' | 'SPEC_VIOLATION';

export class CatalogError extends Error {
  status: 400 | 404 | 409;
  code: CatalogErrorCode;
  detail?: unknown;
  constructor(status: 400 | 404 | 409, code: CatalogErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'CatalogError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export type PlacementWarning =
  | { kind: 'band_out_of_spec'; dimension: string; coffeeAvg: number; lo: number | null; hi: number | null }
  | { kind: 'band_no_data'; dimension: string }
  | { kind: 'band_no_spec' }
  | { kind: 'descriptor_off_family'; families: string[]; coffeeTop: string[] }
  | { kind: 'placement_diverges_from_match'; match: string; placement: string }
  // setHop-only warning (Part A1) — not part of the placement guardrail's own
  // vocabulary above, but the same PlacementWarning union per the brief's
  // CatalogWriteResult<T>.warnings shape. hop_type_provisional (the other
  // setHop-only warning) was dropped by Catalog Blueprint brief 5a along with
  // hop_type itself (D3) — there's no stored value left to be provisional about.
  | { kind: 'hop_direction_contradicts_cupping'; fromName: string; toName: string; dimension: string; toIsMore: boolean };

export interface CatalogWriteResult<T = unknown> {
  result: T;
  warnings: PlacementWarning[];
  integrity: CatalogIntegrityCheck[];
}

function computeInventoryStatus(quantity: number, buffer: number): string {
  if (quantity <= 0) return 'out_of_stock';
  if (quantity <= buffer) return 'low_stock';
  return 'in_stock';
}

// ── Shared lookups (throw CatalogError on miss — every verb uses these so the
// 404/409 shape is consistent everywhere) ────────────────────────────────────

interface CoffeeRow { id: number; name: string; is_active: boolean; roaster_id: string | null; }
async function fetchCoffeeRow(tx: Tx, coffeeId: number): Promise<CoffeeRow> {
  const result = await tx.query<CoffeeRow>(`SELECT id, name, is_active, roaster_id FROM coffees WHERE id = $1`, [coffeeId]);
  if (result.rowCount === 0) throw new CatalogError(404, 'COFFEE_NOT_FOUND', `Coffee ${coffeeId} not found`);
  return result.rows[0];
}
async function fetchActiveCoffee(tx: Tx, coffeeId: number): Promise<CoffeeRow> {
  const coffee = await fetchCoffeeRow(tx, coffeeId);
  if (!coffee.is_active) throw new CatalogError(409, 'COFFEE_INACTIVE', `Coffee ${coffeeId} is not active`);
  return coffee;
}

interface SlotRow { id: number; archetype: string; sort_order: number; dimension_id: number | null; is_active: boolean; name: string | null; spec_band_lo: number | null; spec_band_hi: number | null; spec_descriptor_families: string[]; }
async function fetchSlotRow(tx: Tx, slotId: number): Promise<SlotRow> {
  const result = await tx.query<SlotRow>(
    `SELECT id, archetype, sort_order, dimension_id, is_active, name, spec_band_lo, spec_band_hi, spec_descriptor_families
     FROM coffee_dial_slot WHERE id = $1`,
    [slotId]
  );
  if (result.rowCount === 0) throw new CatalogError(404, 'SLOT_NOT_FOUND', `Slot ${slotId} not found`);
  return result.rows[0];
}
async function fetchActiveSlot(tx: Tx, slotId: number): Promise<SlotRow> {
  const slot = await fetchSlotRow(tx, slotId);
  if (!slot.is_active) throw new CatalogError(409, 'SLOT_INACTIVE', `Slot ${slotId} is not active`);
  return slot;
}

interface RoasterRow { id: string; name: string; is_active: boolean; }
async function fetchRoasterRow(tx: Tx, roasterId: string): Promise<RoasterRow> {
  const result = await tx.query<RoasterRow>(`SELECT id, name, is_active FROM roaster WHERE id = $1`, [roasterId]);
  if (result.rowCount === 0) throw new CatalogError(404, 'ROASTER_NOT_FOUND', `Roaster ${roasterId} not found`);
  return result.rows[0];
}

// Checks 4/5/6/8 from catalogIntegrity.ts, scoped to the coffee/slot a verb
// just touched, run inside the same transaction (Part A3).
async function scopedIntegrity(tx: Tx, scope: { coffeeId?: number; slotId?: number }): Promise<CatalogIntegrityCheck[]> {
  // Sequential, not Promise.all — all four checks share this one transaction's
  // single connection, and firing concurrent queries on the same pg Client
  // is deprecated (and fragile) even though pg currently queues them.
  return [
    await checkActiveAssignmentsValid({ ...scope, tx }),
    await checkOneActiveHome({ ...scope, tx }),
    await checkActiveCoffeeMatchAndRoaster({ ...scope, tx }),
    await checkPlacedNotSellable({ ...scope, tx }),
  ];
}

// ── A2. The movement guardrail — evidence layer (D6/N4) ──────────────────────
// Read-only. Runs against `db` when called from previewPlacement (no write in
// flight — a plain read is fine there, per the brief's own note on
// getAvgCuppingScore), and against `tx` when called from inside placeCoffee/
// moveCoffee so it sees the transaction's own uncommitted state.
export async function evaluatePlacement(runner: Tx | typeof db, coffeeId: number, slotId: number): Promise<PlacementWarning[]> {
  const warnings: PlacementWarning[] = [];

  const slotResult = await runner.query<{
    archetype: string; dimension_id: number | null; spec_band_lo: number | null; spec_band_hi: number | null;
    spec_descriptor_families: string[]; dominant_dimension_id: number | null; descriptor_families: string[];
  }>(
    `SELECT s.archetype, s.dimension_id, s.spec_band_lo, s.spec_band_hi, s.spec_descriptor_families,
            a.dominant_dimension_id, a.descriptor_families
     FROM coffee_dial_slot s JOIN archetype a ON a.code = s.archetype
     WHERE s.id = $1`,
    [slotId]
  );
  const slot = slotResult.rows[0];
  if (!slot) throw new CatalogError(404, 'SLOT_NOT_FOUND', `Slot ${slotId} not found`);

  // Band
  const dimensionId = slot.dimension_id ?? slot.dominant_dimension_id;
  if (dimensionId) {
    const dimNameResult = await runner.query<{ name: string }>(`SELECT name FROM coffee_dimensions WHERE id = $1`, [dimensionId]);
    const dimensionName = dimNameResult.rows[0]?.name ?? `dimension #${dimensionId}`;
    if (slot.spec_band_lo == null && slot.spec_band_hi == null) {
      warnings.push({ kind: 'band_no_spec' });
    } else {
      const avg = await getAvgCuppingScore(coffeeId, dimensionId);
      if (!avg) {
        warnings.push({ kind: 'band_no_data', dimension: dimensionName });
      } else {
        const lo = slot.spec_band_lo, hi = slot.spec_band_hi;
        const outOfRange = (lo != null && avg.avg_score < lo) || (hi != null && avg.avg_score > hi);
        if (outOfRange) warnings.push({ kind: 'band_out_of_spec', dimension: dimensionName, coffeeAvg: avg.avg_score, lo, hi });
      }
    }
  }

  // Descriptors
  const families = slot.spec_descriptor_families?.length ? slot.spec_descriptor_families : (slot.descriptor_families ?? []);
  if (families.length) {
    const topResult = await runner.query<{ wheel_category: string }>(
      `SELECT wheel_category FROM v_collaborative_flavor_wheel WHERE coffee_id = $1
       GROUP BY wheel_category ORDER BY COUNT(*) DESC LIMIT 3`,
      [coffeeId]
    );
    if (topResult.rows.length) {
      const top = topResult.rows.map(r => r.wheel_category);
      if (!top.some(t => families.includes(t))) {
        warnings.push({ kind: 'descriptor_off_family', families, coffeeTop: top });
      }
    }
    // no descriptors at all — nothing to judge, no warning
  }

  // Divergence (D1)
  const matchResult = await runner.query<{ archetype: string }>(
    `SELECT archetype FROM archetype_assignments WHERE coffee_id = $1 AND superseded_at IS NULL`, [coffeeId]
  );
  const matchArchetype = matchResult.rows[0]?.archetype;
  if (matchArchetype && matchArchetype !== slot.archetype) {
    warnings.push({ kind: 'placement_diverges_from_match', match: matchArchetype, placement: slot.archetype });
  }

  return warnings;
}

// Structural + evidence layers, insert/reactivate — the part shared by
// placeCoffee and moveCoffee (moveCoffee can't call the public placeCoffee
// since that opens its own transaction; both call this inside one they
// already hold).
export async function placeCoffeeInTx(
  tx: Tx,
  input: { coffeeId: number; slotId: number; role: SlotRole; priority?: number; placementNote?: string; certify?: { by: string; note?: string } },
  ctx: Ctx
): Promise<{ assignmentId: number; warnings: PlacementWarning[] }> {
  await fetchActiveSlot(tx, input.slotId);
  await fetchActiveCoffee(tx, input.coffeeId);

  const existingResult = await tx.query<{ id: number; is_active: boolean }>(
    `SELECT id, is_active FROM coffee_slot_assignment WHERE slot_id = $1 AND coffee_id = $2`,
    [input.slotId, input.coffeeId]
  );
  const existing = existingResult.rows[0];
  if (existing?.is_active) {
    throw new CatalogError(409, 'ALREADY_ASSIGNED', `Coffee ${input.coffeeId} is already assigned to slot ${input.slotId}`);
  }

  if (input.role === 'home') {
    const homeResult = await tx.query(
      `SELECT id FROM coffee_slot_assignment WHERE coffee_id = $1 AND role = 'home' AND is_active = true`,
      [input.coffeeId]
    );
    if ((homeResult.rowCount ?? 0) > 0) {
      throw new CatalogError(409, 'HOME_EXISTS', `Coffee ${input.coffeeId} already has an active home — use moveCoffee`);
    }
  }

  let priority = input.priority;
  if (priority == null) {
    const nextResult = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(priority), 0) + 1 AS next FROM coffee_slot_assignment WHERE slot_id = $1 AND is_active = true`,
      [input.slotId]
    );
    priority = nextResult.rows[0].next;
  } else {
    const takenResult = await tx.query(
      `SELECT id FROM coffee_slot_assignment WHERE slot_id = $1 AND priority = $2 AND is_active = true`,
      [input.slotId, priority]
    );
    if ((takenResult.rowCount ?? 0) > 0) {
      throw new CatalogError(409, 'PRIORITY_TAKEN', `Priority ${priority} is already taken on slot ${input.slotId}`);
    }
  }

  const warnings = await evaluatePlacement(tx, input.coffeeId, input.slotId);
  const blocking = warnings.filter((w): w is Extract<PlacementWarning, { kind: 'band_out_of_spec' | 'descriptor_off_family' }> =>
    w.kind === 'band_out_of_spec' || w.kind === 'descriptor_off_family');
  const note = input.placementNote?.trim() || null;
  if (blocking.length && !note) {
    throw new CatalogError(400, 'NOTE_REQUIRED', `Placement needs a placementNote: ${blocking.map(w => w.kind).join(', ')}`, { warnings: blocking });
  }
  if (blocking.length && process.env.CATALOG_SPEC_HARD_GATE === 'true') {
    throw new CatalogError(409, 'SPEC_VIOLATION', `Placement violates slot spec: ${blocking.map(w => w.kind).join(', ')}`, { warnings: blocking });
  }

  let assignmentId: number;
  if (existing) {
    // Reactivate the inactive row for the same (slot, coffee) — preserves its id.
    await tx.query(
      `UPDATE coffee_slot_assignment
       SET role = $1, priority = $2, is_active = true, deactivated_at = NULL, deactivation_reason = NULL,
           placement_note = $3, created_by = $4, updated_at = now()
       WHERE id = $5`,
      [input.role, priority, note, ctx.actor, existing.id]
    );
    assignmentId = existing.id;
  } else {
    const insertResult = await tx.query<{ id: number }>(
      `INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role, priority, placement_note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.slotId, input.coffeeId, input.role, priority, note, ctx.actor]
    );
    assignmentId = insertResult.rows[0].id;
  }

  if (input.certify) {
    if (typeof input.certify.by !== 'string' || !input.certify.by.trim()) {
      // Deliberately after the insert/update above — Part E's atomicity test
      // relies on this throwing post-write so the whole transaction rolls back.
      throw new CatalogError(400, 'INVALID_INPUT', 'certify.by must be a non-empty string');
    }
    await tx.query(
      `UPDATE coffee_slot_assignment SET certified_at = now(), certified_by = $1, certification_note = $2 WHERE id = $3`,
      [input.certify.by, input.certify.note ?? null, assignmentId]
    );
  }

  return { assignmentId, warnings };
}

export async function placeCoffee(
  input: { coffeeId: number; slotId: number; role: SlotRole; priority?: number; placementNote?: string; certify?: { by: string; note?: string } },
  ctx: Ctx
): Promise<CatalogWriteResult<{ assignmentId: number }>> {
  return withTransaction(async (tx) => {
    const { assignmentId, warnings } = await placeCoffeeInTx(tx, input, ctx);
    const integrity = await scopedIntegrity(tx, { coffeeId: input.coffeeId, slotId: input.slotId });
    console.info('[catalog] placeCoffee', { actor: ctx.actor, coffeeId: input.coffeeId, slotId: input.slotId, role: input.role, warnings: warnings.map(w => w.kind) });
    return { result: { assignmentId }, warnings, integrity };
  });
}

// addGuest = placeCoffee with role='guest', kept as its own name for
// call-site readability (Part A1). Delegates to the public placeCoffee.
export async function addGuest(
  input: { coffeeId: number; slotId: number; priority?: number; placementNote?: string; certify?: { by: string; note?: string } },
  ctx: Ctx
): Promise<CatalogWriteResult<{ assignmentId: number }>> {
  return placeCoffee({ ...input, role: 'guest' }, ctx);
}

export async function moveCoffee(
  input: { coffeeId: number; toSlotId: number; priority?: number; placementNote?: string; certify?: { by: string; note?: string } },
  ctx: Ctx
): Promise<CatalogWriteResult<{ assignmentId: number }>> {
  return withTransaction(async (tx) => {
    await fetchActiveCoffee(tx, input.coffeeId);
    const homeResult = await tx.query<{ id: number }>(
      `SELECT id FROM coffee_slot_assignment WHERE coffee_id = $1 AND role = 'home' AND is_active = true`,
      [input.coffeeId]
    );
    if (homeResult.rowCount) {
      await tx.query(
        `UPDATE coffee_slot_assignment SET is_active = false, deactivated_at = now(), deactivation_reason = 'moved', updated_at = now() WHERE id = $1`,
        [homeResult.rows[0].id]
      );
    }
    const { assignmentId, warnings } = await placeCoffeeInTx(
      tx,
      { coffeeId: input.coffeeId, slotId: input.toSlotId, role: 'home', priority: input.priority, placementNote: input.placementNote, certify: input.certify },
      ctx
    );
    const integrity = await scopedIntegrity(tx, { coffeeId: input.coffeeId, slotId: input.toSlotId });
    console.info('[catalog] moveCoffee', { actor: ctx.actor, coffeeId: input.coffeeId, toSlotId: input.toSlotId, warnings: warnings.map(w => w.kind) });
    return { result: { assignmentId }, warnings, integrity };
  });
}

export async function removeFromSlot(
  input: { coffeeId: number; slotId: number; reason: 'manual' | 'moved' },
  ctx: Ctx
): Promise<CatalogWriteResult<{ assignmentId: number }>> {
  return withTransaction(async (tx) => {
    const result = await tx.query<{ id: number }>(
      `UPDATE coffee_slot_assignment SET is_active = false, deactivated_at = now(), deactivation_reason = $1, updated_at = now()
       WHERE coffee_id = $2 AND slot_id = $3 AND is_active = true RETURNING id`,
      [input.reason, input.coffeeId, input.slotId]
    );
    if (!result.rowCount) throw new CatalogError(404, 'COFFEE_NOT_FOUND', `No active assignment for coffee ${input.coffeeId} on slot ${input.slotId}`);
    const integrity = await scopedIntegrity(tx, { coffeeId: input.coffeeId, slotId: input.slotId });
    console.info('[catalog] removeFromSlot', { actor: ctx.actor, coffeeId: input.coffeeId, slotId: input.slotId, reason: input.reason });
    return { result: { assignmentId: result.rows[0].id }, warnings: [], integrity };
  });
}

export async function setPriority(input: { slotId: number; ordered: number[] }, ctx: Ctx): Promise<CatalogWriteResult<{ slotId: number }>> {
  return withTransaction(async (tx) => {
    const activeResult = await tx.query<{ id: number; coffee_id: number }>(
      `SELECT id, coffee_id FROM coffee_slot_assignment WHERE slot_id = $1 AND is_active = true`,
      [input.slotId]
    );
    const activeCoffeeIds = new Set(activeResult.rows.map(r => r.coffee_id));
    const orderedSet = new Set(input.ordered);
    const everyActiveListedOnce = activeCoffeeIds.size === orderedSet.size
      && [...activeCoffeeIds].every(id => orderedSet.has(id));
    if (!everyActiveListedOnce) {
      throw new CatalogError(400, 'INVALID_INPUT', 'ordered must list every active assignment on the slot exactly once');
    }

    // Two-phase (avoids tripping coffee_slot_assignment_one_active_per_priority
    // mid-way): a large temp offset first (unique via id, still satisfying the
    // priority >= 1 CHECK — a negative temp value, tried first, does not),
    // then the final 1..n order.
    for (const row of activeResult.rows) {
      await tx.query(`UPDATE coffee_slot_assignment SET priority = $1 WHERE id = $2`, [100000 + row.id, row.id]);
    }
    for (let i = 0; i < input.ordered.length; i++) {
      const row = activeResult.rows.find(r => r.coffee_id === input.ordered[i])!;
      await tx.query(`UPDATE coffee_slot_assignment SET priority = $1, updated_at = now() WHERE id = $2`, [i + 1, row.id]);
    }

    const integrity = await scopedIntegrity(tx, { slotId: input.slotId });
    console.info('[catalog] setPriority', { actor: ctx.actor, slotId: input.slotId, ordered: input.ordered });
    return { result: { slotId: input.slotId }, warnings: [], integrity };
  });
}

// Internal — shared by the public certifyPlacement below and catalogImport.ts,
// which composes several verbs' core logic inside one transaction (dry-run
// support needs everything in one BEGIN/ROLLBACK).
export async function certifyPlacementInTx(tx: Tx, input: { coffeeId: number; slotId: number; by: string; note?: string }): Promise<{ assignmentId: number }> {
  if (!input.by?.trim()) throw new CatalogError(400, 'INVALID_INPUT', 'by is required');
  const result = await tx.query<{ id: number }>(
    `UPDATE coffee_slot_assignment SET certified_at = now(), certified_by = $1, certification_note = $2, updated_at = now()
     WHERE coffee_id = $3 AND slot_id = $4 AND is_active = true RETURNING id`,
    [input.by, input.note ?? null, input.coffeeId, input.slotId]
  );
  if (!result.rowCount) throw new CatalogError(404, 'COFFEE_NOT_FOUND', `No active assignment for coffee ${input.coffeeId} on slot ${input.slotId}`);
  return { assignmentId: result.rows[0].id };
}

export async function certifyPlacement(input: { coffeeId: number; slotId: number; by: string; note?: string }, ctx: Ctx): Promise<CatalogWriteResult<{ assignmentId: number }>> {
  return withTransaction(async (tx) => {
    const { assignmentId } = await certifyPlacementInTx(tx, input);
    const integrity = await scopedIntegrity(tx, { coffeeId: input.coffeeId, slotId: input.slotId });
    console.info('[catalog] certifyPlacement', { actor: ctx.actor, coffeeId: input.coffeeId, slotId: input.slotId });
    return { result: { assignmentId }, warnings: [], integrity };
  });
}

// ── A2.3 Blast radius — informational, no writes ──────────────────────────────
export interface PlacementPreview {
  warnings: PlacementWarning[];
  hopsAffected: Array<{ hopId: number; fromDerived: string | null; toDerived: string | null }>;
  userPositionCounts: Record<number, number>;
  targetSlot: { hasName: boolean; has12ozPrice: boolean };
  coffeeHas12ozSku: boolean;
  occupants: Array<{ coffeeId: number; coffeeName: string; role: string; priority: number }>;
}

async function hopsAffectedByMove(coffeeId: number, role: SlotRole, targetArchetype: string) {
  // Guests never own the home used to derive hop_type — only a home move can
  // change any hop's derived type.
  if (role !== 'home') return [];
  const hopsResult = await db.query<{
    id: number; from_coffee_id: number; to_coffee_id: number;
    hop_type_derived: string | null; from_archetype: string | null; to_archetype: string | null;
  }>(
    `SELECT id, from_coffee_id, to_coffee_id, hop_type_derived, from_archetype, to_archetype
     FROM v_coffee_hop WHERE from_coffee_id = $1 OR to_coffee_id = $1`,
    [coffeeId]
  );
  const changed: Array<{ hopId: number; fromDerived: string | null; toDerived: string | null }> = [];
  for (const h of hopsResult.rows) {
    const otherArchetype = h.from_coffee_id === coffeeId ? h.to_archetype : h.from_archetype;
    const newDerived = otherArchetype == null ? null : (otherArchetype === targetArchetype ? 'within_archetype' : 'bridge_archetype');
    if (newDerived !== h.hop_type_derived) changed.push({ hopId: h.id, fromDerived: h.hop_type_derived, toDerived: newDerived });
  }
  return changed;
}

export async function previewPlacement(input: { coffeeId: number; slotId: number; role: SlotRole }): Promise<PlacementPreview> {
  const slotRow = (await db.query<{ archetype: string; name: string | null }>(
    `SELECT archetype, name FROM coffee_dial_slot WHERE id = $1`, [input.slotId]
  )).rows[0];
  if (!slotRow) throw new CatalogError(404, 'SLOT_NOT_FOUND', `Slot ${input.slotId} not found`);

  const warnings = await evaluatePlacement(db, input.coffeeId, input.slotId);
  const hopsAffected = await hopsAffectedByMove(input.coffeeId, input.role, slotRow.archetype);

  const sourceHomeResult = await db.query<{ slot_id: number }>(
    `SELECT slot_id FROM coffee_slot_assignment WHERE coffee_id = $1 AND role = 'home' AND is_active = true`, [input.coffeeId]
  );
  const sourceSlotId = sourceHomeResult.rows[0]?.slot_id ?? null;
  const slotIdsToCount = sourceSlotId && sourceSlotId !== input.slotId ? [input.slotId, sourceSlotId] : [input.slotId];
  const userPosResult = await db.query<{ slot_id: number; c: string }>(
    `SELECT slot_id, COUNT(*) AS c FROM user_bloom_dial_current_position WHERE slot_id = ANY($1::int[]) GROUP BY slot_id`,
    [slotIdsToCount]
  );
  const userPositionCounts: Record<number, number> = {};
  for (const sid of slotIdsToCount) userPositionCounts[sid] = 0;
  for (const row of userPosResult.rows) userPositionCounts[row.slot_id] = Number(row.c);

  const priceRow = await db.query(`SELECT 1 FROM dial_slot_price WHERE slot_id = $1 AND weight_oz = 12`, [input.slotId]);
  const skuRow = await db.query(`SELECT 1 FROM roaster_blend WHERE coffee_id = $1 AND weight_oz = 12 AND is_active = true`, [input.coffeeId]);

  const occupantsResult = await db.query<{ coffee_id: number; coffee_name: string; role: string; priority: number }>(
    `SELECT coffee_id, coffee_name, role, priority FROM v_coffee_slot
     WHERE slot_id = $1 AND assignment_is_active = true ORDER BY (role = 'home') DESC, priority`,
    [input.slotId]
  );

  return {
    warnings,
    hopsAffected,
    userPositionCounts,
    targetSlot: { hasName: slotRow.name != null, has12ozPrice: (priceRow.rowCount ?? 0) > 0 },
    coffeeHas12ozSku: (skuRow.rowCount ?? 0) > 0,
    occupants: occupantsResult.rows.map(r => ({ coffeeId: r.coffee_id, coffeeName: r.coffee_name, role: r.role, priority: r.priority })),
  };
}

// ── Coffee lifecycle ───────────────────────────────────────────────────────

export interface CreateCoffeeInput {
  roasterId: string; name: string; origin?: string; blendOrSingle?: string; process?: string;
  roastLevel?: string; roastShade?: string; flavorDescriptorsRoaster?: string[]; categoryCodes?: string[];
}
async function applyCategoryCodes(tx: Tx, coffeeId: number, categoryCodes: string[]) {
  const catResult = await tx.query<{ id: number; code: string }>(`SELECT id, code FROM coffee_category WHERE code = ANY($1::text[])`, [categoryCodes]);
  const unknown = categoryCodes.filter(c => !catResult.rows.some(r => r.code === c));
  if (unknown.length) throw new CatalogError(400, 'INVALID_INPUT', `Unknown category codes: ${unknown.join(', ')}`);
  const catIds = catResult.rows.map(r => r.id);
  await tx.query(`DELETE FROM coffee_category_assignment WHERE coffee_id = $1 AND category_id <> ALL($2::int[])`, [coffeeId, catIds.length ? catIds : [0]]);
  for (const catId of catIds) {
    await tx.query(`INSERT INTO coffee_category_assignment (coffee_id, category_id) VALUES ($1, $2) ON CONFLICT (coffee_id, category_id) DO NOTHING`, [coffeeId, catId]);
  }
}

export async function createCoffeeInTx(tx: Tx, input: CreateCoffeeInput): Promise<{ coffeeId: number }> {
  if (!input.name?.trim()) throw new CatalogError(400, 'INVALID_INPUT', 'name is required');
  if (!input.roasterId) throw new CatalogError(400, 'INVALID_INPUT', 'roasterId is required');
  const roaster = await fetchRoasterRow(tx, input.roasterId);
  if (!roaster.is_active) throw new CatalogError(409, 'ROASTER_STATE', `Roaster ${roaster.name} is not active`);

  const dupeResult = await tx.query(
    `SELECT id FROM coffees WHERE roaster_id = $1 AND lower(trim(name)) = lower(trim($2)) AND is_active = true`,
    [input.roasterId, input.name]
  );
  if ((dupeResult.rowCount ?? 0) > 0) {
    throw new CatalogError(409, 'INVALID_INPUT', `A coffee named "${input.name}" already exists for ${roaster.name}`);
  }

  // coffees.roaster (free text) dropped by Catalog Blueprint brief 5a — roasterId is the only identity now.
  const insertResult = await tx.query<{ id: number }>(
    `INSERT INTO coffees (name, roaster_id, origin, blend_or_single, process, roast_level, roast_shade, flavor_descriptors_roaster, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true) RETURNING id`,
    [input.name, input.roasterId, input.origin ?? null, input.blendOrSingle ?? null,
     input.process ?? null, input.roastLevel ?? null, input.roastShade ?? null, input.flavorDescriptorsRoaster ?? null]
  );
  const coffeeId = insertResult.rows[0].id;
  if (input.categoryCodes?.length) await applyCategoryCodes(tx, coffeeId, input.categoryCodes);
  return { coffeeId };
}

export async function createCoffee(input: CreateCoffeeInput, ctx: Ctx): Promise<CatalogWriteResult<{ coffeeId: number }>> {
  return withTransaction(async (tx) => {
    const { coffeeId } = await createCoffeeInTx(tx, input);
    console.info('[catalog] createCoffee', { actor: ctx.actor, coffeeId, roasterId: input.roasterId });
    return { result: { coffeeId }, warnings: [], integrity: [] };
  });
}

export interface UpdateCoffeeInput {
  coffeeId: number; name?: string; origin?: string; blendOrSingle?: string; process?: string;
  roastLevel?: string; roastShade?: string; flavorDescriptorsRoaster?: string[]; categoryCodes?: string[];
  // originRegion: not in the brief's own field list, added to preserve the
  // retired PATCH /coffees/:id's origin_region resolution (Flavor
  // Intelligence Part 1 Decision #9) — metadata only, same as everything
  // else here, so it belongs on this verb rather than losing a feature on
  // retirement. `null` clears it; `undefined` leaves it untouched.
  originRegion?: string | null;
}
export async function updateCoffee(input: UpdateCoffeeInput, ctx: Ctx): Promise<CatalogWriteResult<{ coffeeId: number }>> {
  return withTransaction(async (tx) => {
    await fetchCoffeeRow(tx, input.coffeeId);
    const setOriginRegion = input.originRegion !== undefined;
    await tx.query(
      `UPDATE coffees SET
         name = COALESCE($1, name), origin = COALESCE($2, origin), blend_or_single = COALESCE($3, blend_or_single),
         process = COALESCE($4, process), roast_level = COALESCE($5, roast_level), roast_shade = COALESCE($6, roast_shade),
         flavor_descriptors_roaster = COALESCE($7, flavor_descriptors_roaster),
         origin_region_id = CASE WHEN $9::boolean
           THEN (SELECT id FROM lookup_value WHERE category = 'origin_region' AND value = $10)
           ELSE origin_region_id END
       WHERE id = $8`,
      [input.name ?? null, input.origin ?? null, input.blendOrSingle ?? null, input.process ?? null,
       input.roastLevel ?? null, input.roastShade ?? null, input.flavorDescriptorsRoaster ?? null, input.coffeeId,
       setOriginRegion, input.originRegion ?? null]
    );
    if (input.categoryCodes !== undefined) await applyCategoryCodes(tx, input.coffeeId, input.categoryCodes);
    const integrity = await scopedIntegrity(tx, { coffeeId: input.coffeeId });
    console.info('[catalog] updateCoffee', { actor: ctx.actor, coffeeId: input.coffeeId });
    return { result: { coffeeId: input.coffeeId }, warnings: [], integrity };
  });
}

export async function retireCoffee(input: { coffeeId: number; reason: 'manual' }, ctx: Ctx): Promise<CatalogWriteResult<{ assignments: number; blends: number }>> {
  return withTransaction(async (tx) => {
    const updateResult = await tx.query<{ id: number }>(
      `UPDATE coffees SET is_active = false, deactivated_at = now(), deactivation_reason = $1 WHERE id = $2 AND is_active = true RETURNING id`,
      [input.reason, input.coffeeId]
    );
    if (!updateResult.rowCount) {
      const coffee = await fetchCoffeeRow(tx, input.coffeeId); // throws COFFEE_NOT_FOUND if truly missing
      throw new CatalogError(409, 'COFFEE_INACTIVE', `Coffee ${coffee.id} is already inactive`);
    }
    const assignmentsResult = await tx.query(
      `UPDATE coffee_slot_assignment SET is_active = false, deactivated_at = now(), deactivation_reason = 'manual', updated_at = now()
       WHERE coffee_id = $1 AND is_active = true RETURNING id`,
      [input.coffeeId]
    );
    const blendsResult = await tx.query(
      `UPDATE roaster_blend SET is_active = false, deactivated_at = now(), deactivation_reason = 'manual', updated_at = now()
       WHERE coffee_id = $1 AND is_active = true RETURNING id`,
      [input.coffeeId]
    );
    const integrity = await scopedIntegrity(tx, { coffeeId: input.coffeeId });
    console.info('[catalog] retireCoffee', { actor: ctx.actor, coffeeId: input.coffeeId, assignments: assignmentsResult.rowCount, blends: blendsResult.rowCount });
    return { result: { assignments: assignmentsResult.rowCount ?? 0, blends: blendsResult.rowCount ?? 0 }, warnings: [], integrity };
  });
}

export async function restoreCoffee(input: { coffeeId: number }, ctx: Ctx): Promise<CatalogWriteResult<{ blends: number }>> {
  return withTransaction(async (tx) => {
    const coffeeResult = await tx.query<{ id: number }>(
      `UPDATE coffees SET is_active = true, deactivated_at = NULL, deactivation_reason = NULL
       WHERE id = $1 AND deactivation_reason = 'manual' RETURNING id`,
      [input.coffeeId]
    );
    if (!coffeeResult.rowCount) throw new CatalogError(404, 'COFFEE_NOT_FOUND', `No manually-retired coffee ${input.coffeeId} found`);
    // Placements are NOT restored (N3) — re-place deliberately through placeCoffee/the importer.
    const blendsResult = await tx.query(
      `UPDATE roaster_blend SET is_active = true, deactivated_at = NULL, deactivation_reason = NULL, updated_at = now()
       WHERE coffee_id = $1 AND deactivation_reason = 'manual' RETURNING id`,
      [input.coffeeId]
    );
    const integrity = await scopedIntegrity(tx, { coffeeId: input.coffeeId });
    console.info('[catalog] restoreCoffee', { actor: ctx.actor, coffeeId: input.coffeeId, blends: blendsResult.rowCount });
    return { result: { blends: blendsResult.rowCount ?? 0 }, warnings: [], integrity };
  });
}

// ── Match archetype (D1) ──────────────────────────────────────────────────

export interface SetMatchArchetypeInput {
  coffeeId: number; archetype: ArchetypeCode; confidence: ConfidenceLevel; source: AssignmentSource;
  sessionId?: number; notes?: string;
}
export async function setMatchArchetypeInTx(tx: Tx, input: SetMatchArchetypeInput): Promise<{ coffeeId: number; warnings: PlacementWarning[] }> {
  await fetchCoffeeRow(tx, input.coffeeId);
  const currentResult = await tx.query<{ id: number; archetype: string; confidence: string }>(
    `SELECT id, archetype, confidence FROM archetype_assignments WHERE coffee_id = $1 AND superseded_at IS NULL`,
    [input.coffeeId]
  );
  const current = currentResult.rows[0];
  const isNoOp = current && current.archetype === input.archetype && current.confidence === input.confidence;
  if (!isNoOp) {
    if (current) await tx.query(`UPDATE archetype_assignments SET superseded_at = now() WHERE id = $1`, [current.id]);
    await tx.query(
      `INSERT INTO archetype_assignments (coffee_id, archetype, confidence, source, assigned_from_session_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.coffeeId, input.archetype, input.confidence, input.source, input.sessionId ?? null, input.notes ?? null]
    );
  }

  const warnings: PlacementWarning[] = [];
  const homeResult = await tx.query<{ archetype: string }>(
    `SELECT cds.archetype FROM coffee_slot_assignment csa JOIN coffee_dial_slot cds ON cds.id = csa.slot_id
     WHERE csa.coffee_id = $1 AND csa.role = 'home' AND csa.is_active = true`,
    [input.coffeeId]
  );
  if (homeResult.rowCount && homeResult.rows[0].archetype !== input.archetype) {
    warnings.push({ kind: 'placement_diverges_from_match', match: input.archetype, placement: homeResult.rows[0].archetype });
  }
  return { coffeeId: input.coffeeId, warnings };
}

export async function setMatchArchetype(input: SetMatchArchetypeInput, ctx: Ctx): Promise<CatalogWriteResult<{ coffeeId: number }>> {
  return withTransaction(async (tx) => {
    const { coffeeId, warnings } = await setMatchArchetypeInTx(tx, input);
    const integrity = await scopedIntegrity(tx, { coffeeId });
    console.info('[catalog] setMatchArchetype', { actor: ctx.actor, coffeeId, archetype: input.archetype, warnings: warnings.map(w => w.kind) });
    return { result: { coffeeId }, warnings, integrity };
  });
}

// Catalog Blueprint brief 4 — the only new write verb this brief adds
// (Don'ts §3). Validates every requested family against the real,
// currently-seeded DISTINCT wheel_category values in cupping_note (D6's own
// vocabulary, never a hardcoded list) — an unrecognized family is a 400, not
// a silently-accepted typo. schema.sql's own descriptor_families seed is
// guarded by descriptor_families_seeded_at (Part A) so this write survives
// the next boot instead of being silently reset back to the seed default.
export async function setArchetypeDescriptorFamilies(
  input: { code: ArchetypeCode; families: string[] },
  ctx: Ctx
): Promise<CatalogWriteResult<{ code: ArchetypeCode; families: string[] }>> {
  return withTransaction(async (tx) => {
    const wheelResult = await tx.query<{ wheel_category: string }>(
      `SELECT DISTINCT wheel_category FROM cupping_note WHERE wheel_category IS NOT NULL`
    );
    const validFamilies = new Set(wheelResult.rows.map((r) => r.wheel_category));
    const unknown = input.families.filter((f) => !validFamilies.has(f));
    if (unknown.length) {
      throw new CatalogError(400, 'INVALID_INPUT', `Unknown descriptor family/families: ${unknown.join(', ')}`, { validFamilies: [...validFamilies] });
    }
    const updateResult = await tx.query<{ code: string }>(
      `UPDATE archetype SET descriptor_families = $2, descriptor_families_seeded_at = now() WHERE code = $1 RETURNING code`,
      [input.code, input.families]
    );
    // ArchetypeCode is a closed, statically-known enum — this is unreachable
    // in practice, but every verb in this file guards its lookup the same way.
    if (updateResult.rowCount === 0) throw new CatalogError(400, 'INVALID_INPUT', `Unknown archetype code ${input.code}`);
    console.info('[catalog] setArchetypeDescriptorFamilies', { actor: ctx.actor, code: input.code, families: input.families });
    return { result: { code: input.code, families: input.families }, warnings: [], integrity: [] };
  });
}

// ── SKUs ───────────────────────────────────────────────────────────────────

export interface UpsertSkuInput {
  coffeeId: number; weightOz: number; blendName?: string; roasterSku?: string; shopifyVariantId?: string;
  costToUs?: number; quantityAvailable?: number; safetyStockBuffer?: number; isActive?: boolean;
}
export async function upsertSkuInTx(tx: Tx, input: UpsertSkuInput): Promise<{ blendId: string }> {
    const coffee = await fetchCoffeeRow(tx, input.coffeeId);
    if (!coffee.roaster_id) throw new CatalogError(409, 'ROASTER_STATE', `Coffee ${input.coffeeId} has no roaster_id set`);
    if (!Number.isFinite(input.weightOz) || input.weightOz <= 0) throw new CatalogError(400, 'INVALID_INPUT', 'weightOz must be a positive number');

    const existingResult = await tx.query<{ id: string; quantity_available: number; safety_stock_buffer: number }>(
      `SELECT id, quantity_available, safety_stock_buffer FROM roaster_blend WHERE coffee_id = $1 AND weight_oz = $2 AND is_active = true`,
      [input.coffeeId, input.weightOz]
    );
    let blendId: string;
    if (existingResult.rowCount) {
      const existing = existingResult.rows[0];
      const qty = input.quantityAvailable ?? existing.quantity_available;
      const buffer = input.safetyStockBuffer ?? existing.safety_stock_buffer;
      const updateResult = await tx.query<{ id: string }>(
        `UPDATE roaster_blend SET
           blend_name = COALESCE($1, blend_name), roaster_sku = COALESCE($2, roaster_sku),
           shopify_variant_id = COALESCE($3, shopify_variant_id), cost_to_us = COALESCE($4, cost_to_us),
           quantity_available = $5, safety_stock_buffer = $6, inventory_status = $7,
           is_active = COALESCE($8, is_active), updated_at = now()
         WHERE id = $9 RETURNING id`,
        [input.blendName ?? null, input.roasterSku ?? null, input.shopifyVariantId ?? null, input.costToUs ?? null,
         qty, buffer, computeInventoryStatus(qty, buffer), input.isActive ?? null, existing.id]
      );
      blendId = updateResult.rows[0].id;
    } else {
      const qty = input.quantityAvailable ?? 0;
      const buffer = input.safetyStockBuffer ?? 2;
      const insertResult = await tx.query<{ id: string }>(
        `INSERT INTO roaster_blend (roaster_id, coffee_id, blend_name, weight_oz, roaster_sku, shopify_variant_id, cost_to_us, quantity_available, safety_stock_buffer, inventory_status, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [coffee.roaster_id, input.coffeeId, input.blendName ?? coffee.name, input.weightOz, input.roasterSku ?? null,
         input.shopifyVariantId ?? null, input.costToUs ?? null, qty, buffer, computeInventoryStatus(qty, buffer), input.isActive ?? true]
      );
      blendId = insertResult.rows[0].id;
    }
    return { blendId };
}

export async function upsertSku(input: UpsertSkuInput, ctx: Ctx): Promise<CatalogWriteResult<{ blendId: string }>> {
  return withTransaction(async (tx) => {
    const { blendId } = await upsertSkuInTx(tx, input);
    const integrity = await scopedIntegrity(tx, { coffeeId: input.coffeeId });
    console.info('[catalog] upsertSku', { actor: ctx.actor, coffeeId: input.coffeeId, weightOz: input.weightOz, blendId });
    return { result: { blendId }, warnings: [], integrity };
  });
}

export async function restockSku(input: { blendId: string; quantity: number }, ctx: Ctx): Promise<CatalogWriteResult<{ blendId: string; quantityAvailable: number }>> {
  return withTransaction(async (tx) => {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new CatalogError(400, 'INVALID_INPUT', 'quantity must be a positive number');
    const current = await tx.query<{ quantity_available: number; safety_stock_buffer: number }>(
      `SELECT quantity_available, safety_stock_buffer FROM roaster_blend WHERE id = $1`, [input.blendId]
    );
    if (!current.rowCount) throw new CatalogError(404, 'INVALID_INPUT', `SKU ${input.blendId} not found`);
    const nextQty = Number(current.rows[0].quantity_available) + input.quantity;
    const status = computeInventoryStatus(nextQty, current.rows[0].safety_stock_buffer);
    await tx.query(
      `UPDATE roaster_blend SET quantity_available = $1, inventory_status = $2, last_restocked_at = timezone('utc', now()), updated_at = now() WHERE id = $3`,
      [nextQty, status, input.blendId]
    );
    console.info('[catalog] restockSku', { actor: ctx.actor, blendId: input.blendId, quantity: input.quantity });
    return { result: { blendId: input.blendId, quantityAvailable: nextQty }, warnings: [], integrity: [] };
  });
}

// ── Slots ────────────────────────────────────────────────────────────────────

export async function renameSlot(input: { slotId: number; name?: string; positionLabel?: string; positionDescription?: string }, ctx: Ctx): Promise<CatalogWriteResult<{ slotId: number }>> {
  return withTransaction(async (tx) => {
    if (input.name === undefined && input.positionLabel === undefined && input.positionDescription === undefined) {
      throw new CatalogError(400, 'INVALID_INPUT', 'name, positionLabel, or positionDescription is required');
    }
    try {
      const result = await tx.query<{ id: number }>(
        `UPDATE coffee_dial_slot SET name = COALESCE($1, name), position_label = COALESCE($2, position_label),
                position_description = COALESCE($3, position_description), updated_at = now()
         WHERE id = $4 RETURNING id`,
        [input.name ?? null, input.positionLabel ?? null, input.positionDescription ?? null, input.slotId]
      );
      if (!result.rowCount) throw new CatalogError(404, 'SLOT_NOT_FOUND', `Slot ${input.slotId} not found`);
    } catch (err: any) {
      if (err?.code === '23505') throw new CatalogError(409, 'INVALID_INPUT', 'That name is already used by another slot');
      throw err;
    }
    const integrity = await scopedIntegrity(tx, { slotId: input.slotId });
    console.info('[catalog] renameSlot', { actor: ctx.actor, slotId: input.slotId });
    return { result: { slotId: input.slotId }, warnings: [], integrity };
  });
}

export async function setSlotSpec(input: { slotId: number; bandLo?: number | null; bandHi?: number | null; descriptorFamilies?: string[] }, ctx: Ctx): Promise<CatalogWriteResult<{ slotId: number }>> {
  return withTransaction(async (tx) => {
    if (input.bandLo != null && input.bandHi != null && input.bandLo > input.bandHi) {
      throw new CatalogError(400, 'INVALID_INPUT', 'bandLo must be <= bandHi');
    }
    if (input.descriptorFamilies?.length) {
      const known = await tx.query<{ wheel_category: string }>(`SELECT DISTINCT wheel_category FROM cupping_note`);
      const knownSet = new Set(known.rows.map(r => r.wheel_category));
      const unknown = input.descriptorFamilies.filter(f => !knownSet.has(f));
      if (unknown.length) throw new CatalogError(400, 'INVALID_INPUT', `Unknown descriptor families (not real wheel_category values): ${unknown.join(', ')}`);
    }
    const setBandLo = input.bandLo !== undefined;
    const setBandHi = input.bandHi !== undefined;
    const setFamilies = input.descriptorFamilies !== undefined;
    try {
      const result = await tx.query<{ id: number }>(
        `UPDATE coffee_dial_slot SET
           spec_band_lo = CASE WHEN $1::boolean THEN $2 ELSE spec_band_lo END,
           spec_band_hi = CASE WHEN $3::boolean THEN $4 ELSE spec_band_hi END,
           spec_descriptor_families = CASE WHEN $5::boolean THEN $6 ELSE spec_descriptor_families END,
           updated_at = now()
         WHERE id = $7 RETURNING id`,
        [setBandLo, input.bandLo ?? null, setBandHi, input.bandHi ?? null, setFamilies, input.descriptorFamilies ?? null, input.slotId]
      );
      if (!result.rowCount) throw new CatalogError(404, 'SLOT_NOT_FOUND', `Slot ${input.slotId} not found`);
    } catch (err: any) {
      if (err?.code === '23514') throw new CatalogError(400, 'INVALID_INPUT', 'bandLo must be <= bandHi');
      throw err;
    }
    const integrity = await scopedIntegrity(tx, { slotId: input.slotId });
    console.info('[catalog] setSlotSpec', { actor: ctx.actor, slotId: input.slotId });
    return { result: { slotId: input.slotId }, warnings: [], integrity };
  });
}

export async function setSlotPriceInTx(tx: Tx, input: { slotId: number; weightOz: number; retailPriceCents: number }): Promise<{ slotId: number; weightOz: number }> {
  if (!Number.isFinite(input.weightOz) || input.weightOz <= 0 || !Number.isInteger(input.retailPriceCents) || input.retailPriceCents < 0) {
    throw new CatalogError(400, 'INVALID_INPUT', 'weightOz and a non-negative integer retailPriceCents are required');
  }
  await fetchSlotRow(tx, input.slotId); // validates the slot exists
  // Catalog Blueprint brief 5a dropped dial_slot_price's legacy archetype/
  // dial_sort_order columns — slot_id is the only key now.
  await tx.query(
    `INSERT INTO dial_slot_price (slot_id, weight_oz, retail_price_cents)
     VALUES ($1, $2, $3)
     ON CONFLICT (slot_id, weight_oz) DO UPDATE SET retail_price_cents = EXCLUDED.retail_price_cents, updated_at = now()`,
    [input.slotId, input.weightOz, input.retailPriceCents]
  );
  return { slotId: input.slotId, weightOz: input.weightOz };
}

export async function setSlotPrice(input: { slotId: number; weightOz: number; retailPriceCents: number }, ctx: Ctx): Promise<CatalogWriteResult<{ slotId: number; weightOz: number }>> {
  return withTransaction(async (tx) => {
    const result = await setSlotPriceInTx(tx, input);
    const integrity = await scopedIntegrity(tx, { slotId: input.slotId });
    console.info('[catalog] setSlotPrice', { actor: ctx.actor, slotId: input.slotId, weightOz: input.weightOz });
    return { result, warnings: [], integrity };
  });
}

export async function setLandingDefault(input: { slotId: number }, ctx: Ctx): Promise<CatalogWriteResult<{ slotId: number }>> {
  return withTransaction(async (tx) => {
    const slot = await fetchSlotRow(tx, input.slotId);
    await tx.query(`UPDATE coffee_dial_slot SET is_landing_default = false, updated_at = now() WHERE archetype = $1 AND is_landing_default = true`, [slot.archetype]);
    await tx.query(`UPDATE coffee_dial_slot SET is_landing_default = true, updated_at = now() WHERE id = $1`, [input.slotId]);
    const integrity = await scopedIntegrity(tx, { slotId: input.slotId });
    console.info('[catalog] setLandingDefault', { actor: ctx.actor, slotId: input.slotId });
    return { result: { slotId: input.slotId }, warnings: [], integrity };
  });
}

// ── Hops ─────────────────────────────────────────────────────────────────────

export interface SetHopInput {
  fromCoffeeId: number; toCoffeeId: number; dimensionId: number; direction: 'more' | 'less';
  delta?: number; isRecommended?: boolean; confidence?: ConfidenceLevel; notes?: string;
}
export async function setHop(input: SetHopInput, ctx: Ctx): Promise<CatalogWriteResult<{ hopId: number }>> {
  return withTransaction(async (tx) => {
    if (input.fromCoffeeId === input.toCoffeeId) throw new CatalogError(400, 'INVALID_INPUT', 'A hop needs two different coffees');
    await fetchCoffeeRow(tx, input.fromCoffeeId);
    await fetchCoffeeRow(tx, input.toCoffeeId);

    const warnings: PlacementWarning[] = [];

    // Catalog Blueprint brief 5a (D3) dropped the stored hop_type column
    // entirely — v_coffee_hop.hop_type_derived (computed live from each
    // endpoint's current home placement) is the only hop type now, so this
    // no longer needs to compute or write one.
    const upsertResult = await tx.query<{ id: number }>(
      `INSERT INTO dial_coffee_relationships (from_coffee_id, to_coffee_id, dimension_id, direction, delta, is_recommended, confidence, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO UPDATE SET
         delta = EXCLUDED.delta, is_recommended = EXCLUDED.is_recommended,
         confidence = EXCLUDED.confidence, notes = EXCLUDED.notes
       RETURNING id`,
      [input.fromCoffeeId, input.toCoffeeId, input.dimensionId, input.direction, input.delta ?? null,
       input.isRecommended ?? false, input.confidence ?? 'medium', input.notes ?? null]
    );
    const hopId = upsertResult.rows[0].id;

    // Soft validation ported from the retired POST /dial/relationships — warn,
    // never block, when direction contradicts real cupping data.
    const [fromScore, toScore] = await Promise.all([
      getAvgCuppingScore(input.fromCoffeeId, input.dimensionId),
      getAvgCuppingScore(input.toCoffeeId, input.dimensionId),
    ]);
    if (fromScore && toScore) {
      const toIsMore = toScore.avg_score > fromScore.avg_score;
      const claimedToIsMore = input.direction === 'more';
      if (toIsMore !== claimedToIsMore) {
        const namesResult = await tx.query<{ id: number; name: string }>(`SELECT id, name FROM coffees WHERE id = ANY($1::int[])`, [[input.fromCoffeeId, input.toCoffeeId]]);
        const fromName = namesResult.rows.find(r => r.id === input.fromCoffeeId)?.name ?? `coffee #${input.fromCoffeeId}`;
        const toName = namesResult.rows.find(r => r.id === input.toCoffeeId)?.name ?? `coffee #${input.toCoffeeId}`;
        const dimResult = await tx.query<{ name: string }>(`SELECT name FROM coffee_dimensions WHERE id = $1`, [input.dimensionId]);
        const dimensionName = dimResult.rows[0]?.name ?? `dimension #${input.dimensionId}`;
        warnings.push({ kind: 'hop_direction_contradicts_cupping', fromName, toName, dimension: dimensionName, toIsMore });
      }
    }

    console.info('[catalog] setHop', { actor: ctx.actor, hopId, from: input.fromCoffeeId, to: input.toCoffeeId, warnings: warnings.map(w => w.kind) });
    return { result: { hopId }, warnings, integrity: [] };
  });
}

export async function removeHop(input: { hopId: number }, ctx: Ctx): Promise<CatalogWriteResult<{ hopId: number }>> {
  return withTransaction(async (tx) => {
    const result = await tx.query<{ id: number }>(`DELETE FROM dial_coffee_relationships WHERE id = $1 RETURNING id`, [input.hopId]);
    if (!result.rowCount) throw new CatalogError(404, 'INVALID_INPUT', `Hop ${input.hopId} not found`);
    console.info('[catalog] removeHop', { actor: ctx.actor, hopId: input.hopId });
    return { result: { hopId: input.hopId }, warnings: [], integrity: [] };
  });
}

// ── Roastery lifecycle (moved verbatim in semantics from admin.ts L684/L740,
// plus the coffee_slot_assignment cascade addition) ───────────────────────────

const PREVIEW_WEIGHT_OZ = 12;

// Would `slotId` still resolve at 12oz if every coffee belonging to
// `excludeRoasterId` were removed from consideration? Mirrors
// v_coffee_sellable_slot's own candidate logic (active assignment + active
// coffee not from the excluded roaster + active 12oz SKU + a 12oz price),
// since the view itself has no parameter for "excluding a roaster."
async function wouldSlotStaySellableExcluding(roasterId: string, slotId: number): Promise<boolean> {
  const result = await db.query(
    `SELECT 1
     FROM coffee_slot_assignment csa
     JOIN v_coffee vc ON vc.id = csa.coffee_id AND vc.is_active = true AND vc.roaster_id IS DISTINCT FROM $2
     JOIN roaster_blend rb ON rb.coffee_id = vc.id AND rb.is_active = true AND rb.weight_oz = $3
     JOIN dial_slot_price dsp ON dsp.slot_id = csa.slot_id AND dsp.weight_oz = $3
     WHERE csa.slot_id = $1 AND csa.is_active = true
     LIMIT 1`,
    [slotId, roasterId, PREVIEW_WEIGHT_OZ]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function buildDeactivationPreview(roasterId: string) {
  const roasterResult = await db.query<{ id: string; name: string; is_active: boolean }>(`SELECT id, name, is_active FROM roaster WHERE id = $1`, [roasterId]);
  if (roasterResult.rowCount === 0) return null;
  const roaster = roasterResult.rows[0];

  // Catalog Blueprint brief 4 — home archetype + guest count via
  // coffee_slot_assignment/coffee_dial_slot (placement, D1) instead of
  // dial_archetype_positions. is_default is now the slot's own
  // is_landing_default (whether this coffee's home happens to sit on the
  // archetype's landing-default slot), not a per-coffee flag.
  const coffeesResult = await db.query(
    `SELECT c.id, c.name, c.is_active, homeSlot.archetype AS home_archetype, homeSlot.is_landing_default AS is_default,
            (SELECT COUNT(*) FROM coffee_slot_assignment g WHERE g.coffee_id = c.id AND g.role = 'guest' AND g.is_active = true) AS guest_positions
     FROM coffees c
     LEFT JOIN (
       SELECT csa.coffee_id, cds.archetype, cds.is_landing_default
       FROM coffee_slot_assignment csa
       JOIN coffee_dial_slot cds ON cds.id = csa.slot_id
       WHERE csa.role = 'home' AND csa.is_active = true
     ) homeSlot ON homeSlot.coffee_id = c.id
     WHERE c.roaster_id = $1
     ORDER BY c.name`,
    [roasterId]
  );

  const blendsResult = await db.query(
    `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_active) AS active FROM roaster_blend WHERE roaster_id = $1`,
    [roasterId]
  );
  // Replaces the old aliasesResult (coffee_alias) — placements, not aliases,
  // are the placement fact now (D1).
  const placementsResult = await db.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE csa.is_active) AS active,
       COUNT(*) FILTER (WHERE csa.is_active AND csa.role = 'home') AS homes,
       COUNT(*) FILTER (WHERE csa.is_active AND csa.role = 'guest') AS guests
     FROM coffee_slot_assignment csa
     JOIN coffees c ON c.id = csa.coffee_id
     WHERE c.roaster_id = $1`,
    [roasterId]
  );

  // slotsGoingEmpty — Catalog Blueprint brief 2: switched from
  // resolveBlendForSlot (legacy reader, blendResolver.ts) to
  // v_coffee_sellable_slot, per this brief's Part A1. Only a slot that
  // resolves TODAY via v_coffee_sellable_slot and would stop resolving with
  // this roastery's coffees excluded counts as "going empty."
  const sellableNowResult = await db.query<{ slot_id: number; archetype: string; sort_order: number; slot_name: string; roaster_id: string | null }>(
    `SELECT slot_id, archetype, sort_order, slot_name, roaster_id FROM v_coffee_sellable_slot WHERE weight_oz = ${PREVIEW_WEIGHT_OZ}`
  );
  const slotsGoingEmpty: Array<{ archetype: string; dialSortOrder: number; platformName: string }> = [];
  for (const row of sellableNowResult.rows) {
    if (row.roaster_id !== roasterId) continue; // current occupant isn't this roastery's — unaffected
    const staysSellable = await wouldSlotStaySellableExcluding(roasterId, row.slot_id);
    if (!staysSellable) slotsGoingEmpty.push({ archetype: row.archetype, dialSortOrder: row.sort_order, platformName: row.slot_name });
  }

  // archetypesLosingDefault — Catalog Blueprint brief 4: landing default is a
  // slot property (coffee_dial_slot.is_landing_default), so "loses its
  // default" now means "this archetype's landing-default slot's current
  // sellable occupant belongs to this roastery" — v_coffee_sellable_slot
  // already resolves to exactly one winner per (slot, weight), no HAVING
  // bool_and grouping trick needed like the old per-coffee is_default did.
  const defaultResult = await db.query(
    `SELECT cds.archetype
     FROM coffee_dial_slot cds
     JOIN v_coffee_sellable_slot vcs ON vcs.slot_id = cds.id AND vcs.weight_oz = ${PREVIEW_WEIGHT_OZ}
     WHERE cds.is_landing_default = true AND vcs.roaster_id = $1`,
    [roasterId]
  );

  const coffeeIds: number[] = coffeesResult.rows.map((r) => r.id);
  const hopsResult = await db.query(
    `SELECT COUNT(*) AS count FROM dial_coffee_relationships
     WHERE from_coffee_id = ANY($1::int[]) OR to_coffee_id = ANY($1::int[])`,
    [coffeeIds.length ? coffeeIds : [0]]
  );

  const openOrdersResult = await db.query(
    `SELECT COUNT(*) AS count FROM order_line_item oli
     JOIN roaster_blend rb ON rb.id = oli.blend_id
     JOIN "order" o ON o.id = oli.order_id
     WHERE rb.roaster_id = $1 AND o.fulfillment_status NOT IN ('delivered', 'cancelled')`,
    [roasterId]
  );

  const subscribersResult = await db.query(
    `SELECT COUNT(DISTINCT s.user_id) AS count
     FROM subscription s
     JOIN LATERAL (
       SELECT oli.blend_id
       FROM order_line_item oli
       JOIN "order" o ON o.id = oli.order_id
       WHERE o.user_id = s.user_id
       ORDER BY o.created_at DESC
       LIMIT 1
     ) last_line ON true
     JOIN roaster_blend rb ON rb.id = last_line.blend_id
     WHERE s.status = 'active' AND rb.roaster_id = $1`,
    [roasterId]
  );

  const alreadyInactiveCoffees = coffeesResult.rows.filter((r) => r.is_active === false).length;
  const alreadyInactiveBlends = Number(blendsResult.rows[0].total) - Number(blendsResult.rows[0].active);
  const alreadyInactivePlacements = Number(placementsResult.rows[0].total) - Number(placementsResult.rows[0].active);

  return {
    roaster: { id: roaster.id, name: roaster.name, isActive: roaster.is_active },
    coffees: coffeesResult.rows.map((r) => ({
      id: r.id, name: r.name, isActive: r.is_active,
      homeArchetype: r.home_archetype, isDefault: r.is_default ?? false, guestPositions: Number(r.guest_positions),
    })),
    blends: { total: Number(blendsResult.rows[0].total), active: Number(blendsResult.rows[0].active) },
    placements: {
      total: Number(placementsResult.rows[0].total), active: Number(placementsResult.rows[0].active),
      homes: Number(placementsResult.rows[0].homes), guests: Number(placementsResult.rows[0].guests),
    },
    slotsGoingEmpty,
    archetypesLosingDefault: defaultResult.rows.map((r) => r.archetype),
    hopsGoingDark: Number(hopsResult.rows[0].count),
    openOrderLines: Number(openOrdersResult.rows[0].count),
    activeSubscribersOnTheseSlots: Number(subscribersResult.rows[0].count),
    alreadyManuallyInactive: { coffees: alreadyInactiveCoffees, blends: alreadyInactiveBlends, placements: alreadyInactivePlacements },
  };
}

export async function buildReactivationPreview(roasterId: string) {
  const roasterResult = await db.query(`SELECT id, name, is_active, deactivated_at FROM roaster WHERE id = $1`, [roasterId]);
  if (roasterResult.rowCount === 0) return null;
  const roaster = roasterResult.rows[0];

  if (!roaster.deactivated_at) {
    return {
      roaster: { id: roaster.id, name: roaster.name, isActive: roaster.is_active },
      coffees: [], blends: { toRestore: 0 },
    };
  }

  const coffeesResult = await db.query(
    `SELECT id, name FROM coffees WHERE roaster_id = $1 AND deactivation_reason = 'roaster' AND deactivated_at >= $2 ORDER BY name`,
    [roasterId, roaster.deactivated_at]
  );
  const blendsResult = await db.query(
    `SELECT COUNT(*) AS count FROM roaster_blend WHERE roaster_id = $1 AND deactivation_reason = 'roaster' AND deactivated_at >= $2`,
    [roasterId, roaster.deactivated_at]
  );
  // Catalog Blueprint brief 4 — no coffee_alias read here any more. There is
  // no placements equivalent to count: coffee_slot_assignment is deliberately
  // never restored on reactivation (N3, unchanged this brief) — placements
  // are re-created deliberately through placeCoffee/the importer, so this
  // preview has nothing to report for them.
  return {
    roaster: { id: roaster.id, name: roaster.name, isActive: roaster.is_active },
    coffees: coffeesResult.rows,
    blends: { toRestore: Number(blendsResult.rows[0].count) },
  };
}

export async function deactivateRoastery(input: { roasterId: string; note?: string }, ctx: Ctx) {
  const preview = await buildDeactivationPreview(input.roasterId);
  if (!preview) throw new CatalogError(404, 'ROASTER_NOT_FOUND', `Roaster ${input.roasterId} not found`);
  if (!preview.roaster.isActive) throw new CatalogError(409, 'ROASTER_STATE', 'This roastery is already inactive');

  return withTransaction(async (tx) => {
    const roasterUpdate = await tx.query(
      `UPDATE roaster SET is_active = false, deactivated_at = now(), deactivation_note = $2, updated_at = now()
       WHERE id = $1 AND is_active = true RETURNING id`,
      [input.roasterId, input.note ?? null]
    );
    if (roasterUpdate.rowCount === 0) throw new CatalogError(409, 'ROASTER_STATE', 'This roastery is already inactive');

    const coffeesUpdate = await tx.query(
      `UPDATE coffees SET is_active = false, deactivated_at = now(), deactivation_reason = 'roaster'
       WHERE roaster_id = $1 AND is_active = true RETURNING id`,
      [input.roasterId]
    );
    const blendsUpdate = await tx.query(
      `UPDATE roaster_blend SET is_active = false, deactivated_at = now(), deactivation_reason = 'roaster', updated_at = now()
       WHERE roaster_id = $1 AND is_active = true RETURNING id`,
      [input.roasterId]
    );
    // coffee_alias cascade removed — the table itself was dropped by Catalog
    // Blueprint brief 5a.
    const assignmentsUpdate = await tx.query(
      `UPDATE coffee_slot_assignment SET is_active = false, deactivated_at = now(), deactivation_reason = 'roaster', updated_at = now()
       WHERE coffee_id IN (SELECT id FROM coffees WHERE roaster_id = $1) AND is_active = true RETURNING id`,
      [input.roasterId]
    );

    const applied = {
      coffees: coffeesUpdate.rowCount ?? 0, blends: blendsUpdate.rowCount ?? 0,
      assignments: assignmentsUpdate.rowCount ?? 0,
    };
    console.info('[catalog] deactivateRoastery', { actor: ctx.actor, roasterId: input.roasterId, applied });
    return { result: { ...preview, applied }, warnings: [], integrity: [] };
  });
}

export async function reactivateRoastery(input: { roasterId: string }, ctx: Ctx) {
  return withTransaction(async (tx) => {
    const roasterResult = await tx.query(`SELECT id, name, is_active, deactivated_at FROM roaster WHERE id = $1`, [input.roasterId]);
    if (roasterResult.rowCount === 0) throw new CatalogError(404, 'ROASTER_NOT_FOUND', `Roaster ${input.roasterId} not found`);
    const roaster = roasterResult.rows[0];
    if (roaster.is_active) throw new CatalogError(409, 'ROASTER_STATE', 'This roastery is already active');

    const cutoff = roaster.deactivated_at;
    const coffeesUpdate = await tx.query(
      `UPDATE coffees SET is_active = true, deactivated_at = NULL, deactivation_reason = NULL
       WHERE roaster_id = $1 AND deactivation_reason = 'roaster' AND deactivated_at >= $2 RETURNING id`,
      [input.roasterId, cutoff]
    );
    const blendsUpdate = await tx.query(
      `UPDATE roaster_blend SET is_active = true, deactivated_at = NULL, deactivation_reason = NULL, updated_at = now()
       WHERE roaster_id = $1 AND deactivation_reason = 'roaster' AND deactivated_at >= $2 RETURNING id`,
      [input.roasterId, cutoff]
    );
    // coffee_alias cascade removed — the table itself was dropped by Catalog
    // Blueprint brief 5a. coffee_slot_assignment is deliberately NOT restored
    // (N3) — placements are re-created deliberately through placeCoffee/the
    // importer.
    const roasterUpdate = await tx.query(
      `UPDATE roaster SET is_active = true, deactivated_at = NULL, deactivation_note = NULL, updated_at = now() WHERE id = $1 RETURNING id, name, is_active`,
      [input.roasterId]
    );

    const restored = { coffees: coffeesUpdate.rowCount ?? 0, blends: blendsUpdate.rowCount ?? 0 };
    console.info('[catalog] reactivateRoastery', { actor: ctx.actor, roasterId: input.roasterId, restored });
    return { result: { roaster: roasterUpdate.rows[0], restored }, warnings: [], integrity: [] };
  });
}
