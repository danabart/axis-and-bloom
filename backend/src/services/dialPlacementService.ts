// Ella's Bloom Map 1 (2026-11-10), B2 — the one writer of every dial_ table
// (the lookups and the seeded config rows are written by the seed in
// schema.sql). Nothing here updates or deletes a placement or a cut: a
// version's rows are written once, by cutVersion, while it is a draft, and
// the guard trigger on dial_placement / dial_ring_cut / dial_size_cut refuses
// anything else at the database.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_1_SCHEMA_RULES_PREVIEW.md
import { db, withTransaction, type Tx } from '../db/client.js';
import { getParameters } from './evidenceReads.js';

export class DialMapError extends Error {
  constructor(public status: 400 | 404 | 409, public code: string, message: string) {
    super(message);
    this.name = 'DialMapError';
  }
}
const invalid = (message: string) => new DialMapError(400, 'DIAL_MAP_INVALID', message);

export interface CutVersionInput { label: string; reason?: string | null; adminUid?: string | null }
export interface CutVersionResult { versionId: number; label: string; created: boolean; placements: number }

/**
 * Inside a caller's transaction: insert the version as a draft with the
 * snapshot of every current dial_ parameter, its ring and size bands, and one
 * placement per placeable row of v_dial_placement_preview. Idempotent on the
 * label: a second call with a label that exists returns that version and
 * writes nothing.
 */
export async function cutVersionInTx(tx: Tx, input: CutVersionInput): Promise<CutVersionResult> {
  const label = String(input.label ?? '').trim();
  if (!label) throw invalid('label is required');
  const existing = await tx.query<{ id: number }>(`SELECT id FROM dial_map_version WHERE label = $1`, [label]);
  if (existing.rows[0]) return existingResult(tx, existing.rows[0].id, label);

  const params: Record<string, number> = Object.fromEntries((await getParameters('dial_', tx)).map(r => [r.key, r.value]));
  const p = (k: string) => {
    const v = params[k];
    if (v === undefined || v === null) throw invalid(`parameter ${k} is missing; the cut needs every dial_ parameter`);
    return Number(v);
  };
  const [rc1, rc2, sc1, sc2] = [p('dial_ring_cut_1'), p('dial_ring_cut_2'), p('dial_size_cut_1'), p('dial_size_cut_2')];
  if (!(rc1 < rc2)) throw invalid(`dial_ring_cut_1 (${rc1}) must be below dial_ring_cut_2 (${rc2})`);
  if (!(sc1 < sc2)) throw invalid(`dial_size_cut_1 (${sc1}) must be below dial_size_cut_2 (${sc2})`);

  const inserted = await tx.query<{ id: number }>(
    `INSERT INTO dial_map_version (label, status_id, reason, parameters, cut_by)
     SELECT $1, s.id, $2, $3::jsonb, $4 FROM dial_map_version_status s WHERE s.code = 'draft'
     ON CONFLICT (label) DO NOTHING
     RETURNING id`,
    [label, input.reason ?? null, JSON.stringify(params), input.adminUid ?? null]);
  if (!inserted.rows[0]) {
    // a concurrent cut with the same label won; return it
    const again = await tx.query<{ id: number }>(`SELECT id FROM dial_map_version WHERE label = $1`, [label]);
    return existingResult(tx, again.rows[0].id, label);
  }
  const versionId = inserted.rows[0].id;
  await tx.query(
    `INSERT INTO dial_ring_cut (version_id, ring, lo, hi) VALUES ($1, 1, NULL, $2), ($1, 2, $2, $3), ($1, 3, $3, NULL)`,
    [versionId, rc1, rc2]);
  await tx.query(
    `INSERT INTO dial_size_cut (version_id, size, lo, hi) VALUES ($1, 1, NULL, $2), ($1, 2, $2, $3), ($1, 3, $3, NULL)`,
    [versionId, sc1, sc2]);
  const placed = await tx.query(
    `INSERT INTO dial_placement (version_id, coffee_id, archetype_code, is_center, ring, lane_id, size,
                                 ruler_dimension_id, ruler_value, acidity, bitterness, body, sweetness,
                                 lean_assignment_id, suggested_lane_id, suggested_scores, grade_id,
                                 n_sessions, n_cuppers, is_sellable_at_cut, inputs_used, flags)
     SELECT $1, coffee_id, archetype_code, is_center, ring, lane_id, size,
            ruler_dimension_id, ruler_value, acidity, bitterness, body, sweetness,
            lean_assignment_id, suggested_lane_id, suggested_scores, grade_id,
            n_sessions, n_cuppers, is_sellable, inputs_used, flags
       FROM v_dial_placement_preview
      WHERE is_placeable`,
    [versionId]);
  return { versionId, label, created: true, placements: placed.rowCount ?? 0 };
}

async function existingResult(tx: Tx, versionId: number, label: string): Promise<CutVersionResult> {
  const n = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM dial_placement WHERE version_id = $1`, [versionId]);
  return { versionId, label, created: false, placements: n.rows[0].n };
}

export async function cutVersion(input: CutVersionInput): Promise<CutVersionResult> {
  const result = await withTransaction(tx => cutVersionInTx(tx, input));
  console.info('[ella-map] cutVersion', { label: result.label, versionId: result.versionId, created: result.created, placements: result.placements, actor: input.adminUid ?? null });
  return result;
}

/**
 * Inside a caller's transaction: retire the active version (if any) and make
 * this draft the active one. Refuses a version that is not a draft.
 */
export async function activateVersionInTx(tx: Tx, versionId: number): Promise<{ versionId: number; retiredVersionId: number | null }> {
  const v = await tx.query<{ id: number; status: string }>(
    `SELECT v.id, s.code AS status FROM dial_map_version v JOIN dial_map_version_status s ON s.id = v.status_id
      WHERE v.id = $1 FOR UPDATE OF v`, [versionId]);
  if (!v.rows[0]) throw new DialMapError(404, 'VERSION_NOT_FOUND', `Map version ${versionId} not found`);
  if (v.rows[0].status !== 'draft') throw new DialMapError(409, 'VERSION_NOT_DRAFT', `Map version ${versionId} is ${v.rows[0].status}; only a draft can be activated`);
  const retired = await tx.query<{ id: number }>(
    `UPDATE dial_map_version SET status_id = (SELECT id FROM dial_map_version_status WHERE code = 'retired'), retired_at = now()
      WHERE activated_at IS NOT NULL AND retired_at IS NULL
      RETURNING id`);
  await tx.query(
    `UPDATE dial_map_version SET status_id = (SELECT id FROM dial_map_version_status WHERE code = 'active'), activated_at = now()
      WHERE id = $1`, [versionId]);
  return { versionId, retiredVersionId: retired.rows[0]?.id ?? null };
}

export async function activateVersion(versionId: number, adminUid?: string | null) {
  const result = await withTransaction(tx => activateVersionInTx(tx, versionId));
  console.info('[ella-map] activateVersion', { ...result, actor: adminUid ?? null });
  return result;
}

export interface SetWedgeInput {
  rulerDimensionId?: number | null; sideAArchetype?: string; sideBArchetype?: string; angleOrder?: number;
  seamFamilyNoteId?: string | null; seamUsesBody?: boolean; seamUsesDarkRoast?: boolean;
}

/** Edit a wedge's map config in place (an operating config row; the CHECKs keep it coherent). */
export async function setWedge(archetypeCode: string, input: SetWedgeInput, adminUid?: string | null) {
  const sets: string[] = [];
  const values: unknown[] = [archetypeCode];
  const add = (col: string, v: unknown, cast = '') => { values.push(v); sets.push(`${col} = $${values.length}${cast}`); };
  if (input.rulerDimensionId !== undefined) add('ruler_dimension_id', input.rulerDimensionId);
  if (input.sideAArchetype !== undefined) add('side_a_archetype', input.sideAArchetype, '::archetype_enum');
  if (input.sideBArchetype !== undefined) add('side_b_archetype', input.sideBArchetype, '::archetype_enum');
  if (input.angleOrder !== undefined) add('angle_order', input.angleOrder);
  if (input.seamFamilyNoteId !== undefined) add('seam_family_note_id', input.seamFamilyNoteId, '::uuid');
  if (input.seamUsesBody !== undefined) add('seam_uses_body', input.seamUsesBody);
  if (input.seamUsesDarkRoast !== undefined) add('seam_uses_dark_roast', input.seamUsesDarkRoast);
  if (!sets.length) throw invalid('nothing to change');
  try {
    const r = await db.query(
      `UPDATE dial_wedge SET ${sets.join(', ')}, updated_at = now() WHERE archetype_code = $1::text::archetype_enum RETURNING *`, values);
    if (!r.rows[0]) throw new DialMapError(404, 'WEDGE_NOT_FOUND', `No map wedge for ${archetypeCode}`);
    console.info('[ella-map] setWedge', { archetypeCode, fields: Object.keys(input), actor: adminUid ?? null });
    return r.rows[0];
  } catch (err: any) {
    if (err instanceof DialMapError) throw err;
    if (['23514', '23505', '23503', '22P02'].includes(err?.code)) throw invalid(err.message);
    throw err;
  }
}

export interface SetFirstMatchInput { archetypeCode: string; laneCode: string; coffeeId: number; statusCode?: string; notes?: string | null; adminUid?: string | null }

/** Supersede the current first match of (family, lane) and insert the new one; a no-op when nothing changes. */
export async function setFirstMatchInTx(tx: Tx, input: SetFirstMatchInput) {
  const lane = await tx.query<{ id: number }>(`SELECT id FROM dial_lane WHERE code = $1`, [input.laneCode]);
  if (!lane.rows[0]) throw invalid(`unknown lane ${input.laneCode}`);
  const status = await tx.query<{ id: number }>(`SELECT id FROM dial_first_match_status WHERE code = $1`, [input.statusCode ?? 'founder_pick']);
  if (!status.rows[0]) throw invalid(`unknown first-match status ${input.statusCode}`);
  const coffee = await tx.query(`SELECT id FROM coffees WHERE id = $1 AND is_active`, [input.coffeeId]);
  if (!coffee.rows[0]) throw new DialMapError(404, 'COFFEE_NOT_FOUND', `No active coffee ${input.coffeeId}`);
  const arch = await tx.query(`SELECT 1 FROM dial_wedge WHERE archetype_code::text = $1`, [input.archetypeCode]);
  if (!arch.rows[0]) throw invalid(`${input.archetypeCode} is not a map family`);
  // Ella map 2 (Dana 2026-11-10, decision 1): refused at write under the
  // grade floor; dialReads.firstMatches keeps the read-time check too, since
  // a grade can drop after the row was written.
  const floor = await tx.query<{ grade_code: string | null; grade_rank: number | null; min_rank: string | null; name: string }>(
    `SELECT pv.grade_code, pv.grade_rank, param('dial_min_grade_rank_first_match') AS min_rank, c.name
       FROM coffees c LEFT JOIN v_dial_placement_preview pv ON pv.coffee_id = c.id WHERE c.id = $1`, [input.coffeeId]);
  const f = floor.rows[0];
  const minRank = Number(f.min_rank);
  if (f.grade_rank === null || Number(f.grade_rank) < minRank) {
    const floorCode = (await tx.query<{ code: string }>(`SELECT code FROM dial_evidence_grade WHERE rank = $1`, [minRank])).rows[0]?.code ?? String(minRank);
    throw new DialMapError(409, 'BELOW_GRADE_FLOOR',
      f.grade_code === null
        ? `${f.name} has no placement in the preview, so it has no grade; a first match needs grade ${floorCode} or better`
        : `${f.name} is grade ${f.grade_code}; a first match needs grade ${floorCode} or better (dial_min_grade_rank_first_match)`);
  }
  const cur = await tx.query<{ id: number; coffee_id: number; status_id: number; notes: string | null }>(
    `SELECT id, coffee_id, status_id, notes FROM dial_first_match
      WHERE archetype_code::text = $1 AND lane_id = $2 AND superseded_at IS NULL FOR UPDATE`, [input.archetypeCode, lane.rows[0].id]);
  const c = cur.rows[0];
  if (c && c.coffee_id === input.coffeeId && c.status_id === status.rows[0].id && (c.notes ?? null) === (input.notes ?? null)) {
    return { id: c.id, unchanged: true };
  }
  if (c) await tx.query(`UPDATE dial_first_match SET superseded_at = now() WHERE id = $1`, [c.id]);
  const ins = await tx.query<{ id: number }>(
    `INSERT INTO dial_first_match (archetype_code, lane_id, coffee_id, status_id, notes, decided_by)
     VALUES ($1::text::archetype_enum, $2, $3, $4, $5, $6) RETURNING id`,
    [input.archetypeCode, lane.rows[0].id, input.coffeeId, status.rows[0].id, input.notes ?? null, input.adminUid ?? null]);
  return { id: ins.rows[0].id, unchanged: false, supersededId: c?.id ?? null };
}
export const setFirstMatch = (input: SetFirstMatchInput) => withTransaction(tx => setFirstMatchInTx(tx, input));

export interface SetHopPhraseInput {
  archetypeCode: string | null; moveCode: string; buttonLabel: string;
  moveLineTemplate?: string | null; edgePhrase?: string | null; adminUid?: string | null;
}

/** Supersede the current phrase of (family or default, move) and insert the new one; a no-op when nothing changes. */
export async function setHopPhraseInTx(tx: Tx, input: SetHopPhraseInput) {
  const label = String(input.buttonLabel ?? '').trim();
  if (!label) throw invalid('buttonLabel is required');
  const move = await tx.query<{ id: number }>(`SELECT id FROM dial_move WHERE code = $1`, [input.moveCode]);
  if (!move.rows[0]) throw invalid(`unknown move ${input.moveCode}`);
  if (input.archetypeCode !== null) {
    const arch = await tx.query(`SELECT 1 FROM dial_wedge WHERE archetype_code::text = $1`, [input.archetypeCode]);
    if (!arch.rows[0]) throw invalid(`${input.archetypeCode} is not a map family`);
  }
  const cur = await tx.query<{ id: number; button_label: string; move_line_template: string | null; edge_phrase: string | null }>(
    `SELECT id, button_label, move_line_template, edge_phrase FROM dial_hop_phrase
      WHERE archetype_code::text IS NOT DISTINCT FROM $1 AND move_id = $2 AND superseded_at IS NULL FOR UPDATE`,
    [input.archetypeCode, move.rows[0].id]);
  const c = cur.rows[0];
  const template = input.moveLineTemplate ?? null;
  const edge = input.edgePhrase ?? null;
  if (c && c.button_label === label && c.move_line_template === template && c.edge_phrase === edge) return { id: c.id, unchanged: true };
  if (c) await tx.query(`UPDATE dial_hop_phrase SET superseded_at = now() WHERE id = $1`, [c.id]);
  const ins = await tx.query<{ id: number }>(
    `INSERT INTO dial_hop_phrase (archetype_code, move_id, button_label, move_line_template, edge_phrase, decided_by)
     VALUES ($1::text::archetype_enum, $2, $3, $4, $5, $6) RETURNING id`,
    [input.archetypeCode, move.rows[0].id, label, template, edge, input.adminUid ?? null]);
  return { id: ins.rows[0].id, unchanged: false, supersededId: c?.id ?? null };
}
export const setHopPhrase = (input: SetHopPhraseInput) => withTransaction(tx => setHopPhraseInTx(tx, input));
