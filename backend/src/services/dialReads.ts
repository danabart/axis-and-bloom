// Ella's Bloom Map 1 (2026-11-10), B1 — the one read path of the map: every
// v_dial_* view and the dial_ config tables are read here and nowhere else.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_1_SCHEMA_RULES_PREVIEW.md
//
// Two modes for every computed object: 'preview' (current evidence and the
// current dial_ parameters, workbench only) and 'active' (the active map
// version, its own parameter snapshot). No customer surface reads this in
// brief 1; brief 3's customer API strips the grade.
import { db, type Tx } from '../db/client.js';
import { getParameters } from './evidenceReads.js';
import { listCousinHints } from './roasteryPortalReads.js';

type Runner = Tx | typeof db;
export type MapMode = 'preview' | 'active';
export const MAP_MODES: readonly MapMode[] = ['preview', 'active'];

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function placementPreview(runner: Runner = db) {
  const r = await runner.query(`SELECT * FROM v_dial_placement_preview ORDER BY archetype_code, coffee_name`);
  return r.rows;
}

export async function placementActive(runner: Runner = db) {
  const r = await runner.query(`SELECT * FROM v_dial_placement ORDER BY archetype_code, coffee_name`);
  return r.rows;
}

export async function edgesPreview(runner: Runner = db) {
  const r = await runner.query(`SELECT * FROM v_dial_edge_preview ORDER BY from_coffee_id, relation, distance, to_coffee_id`);
  return r.rows;
}

export async function edges(runner: Runner = db) {
  const r = await runner.query(`SELECT * FROM v_dial_edge ORDER BY from_coffee_id, relation, distance, to_coffee_id`);
  return r.rows;
}

async function hopsFrom(view: 'v_dial_hop_preview' | 'v_dial_hop', coffeeId: number | undefined, runner: Runner) {
  const r = await runner.query(
    `SELECT h.*, f.name AS from_coffee_name, t.name AS to_coffee_name
       FROM ${view} h
       JOIN coffees f ON f.id = h.from_coffee_id
       JOIN coffees t ON t.id = h.to_coffee_id
      WHERE ($1::int IS NULL OR h.from_coffee_id = $1)
      ORDER BY f.name, h.relation, h.rank`,
    [coffeeId ?? null]);
  return r.rows;
}
export const hopsPreview = (coffeeId?: number, runner: Runner = db) => hopsFrom('v_dial_hop_preview', coffeeId, runner);
export const hops = (coffeeId?: number, runner: Runner = db) => hopsFrom('v_dial_hop', coffeeId, runner);

export async function face(runner: Runner = db) {
  const r = await runner.query(`SELECT * FROM v_dial_face ORDER BY archetype_code, ring, coffee_name`);
  return r.rows;
}

export async function versions(runner: Runner = db) {
  const r = await runner.query(
    `SELECT v.id, v.label, s.code AS status, v.reason, v.parameters, v.cut_by, v.cut_at, v.activated_at, v.retired_at,
            (SELECT count(*)::int FROM dial_placement p WHERE p.version_id = v.id) AS n_placements,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('ring', c.ring, 'lo', c.lo, 'hi', c.hi) ORDER BY c.ring), '[]')
               FROM dial_ring_cut c WHERE c.version_id = v.id) AS ring_cuts,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object('size', c.size, 'lo', c.lo, 'hi', c.hi) ORDER BY c.size), '[]')
               FROM dial_size_cut c WHERE c.version_id = v.id) AS size_cuts
       FROM dial_map_version v
       JOIN dial_map_version_status s ON s.id = v.status_id
      ORDER BY v.cut_at DESC, v.id DESC`);
  return r.rows;
}

export async function getVersion(id: number, runner: Runner = db) {
  return (await versions(runner)).find(v => v.id === id) ?? null;
}

export async function wedges(runner: Runner = db) {
  const w = await runner.query(
    `SELECT w.id, w.archetype_code, ca.name AS archetype_name, w.is_center, w.angle_order,
            w.ruler_dimension_id, d.name AS ruler_dimension_name,
            w.side_a_archetype, w.side_b_archetype,
            w.seam_family_note_id, f.descriptor AS seam_family, w.seam_uses_body, w.seam_uses_dark_roast, w.updated_at
       FROM dial_wedge w
       JOIN coffee_archetype ca ON ca.code = w.archetype_code
       LEFT JOIN coffee_dimensions d ON d.id = w.ruler_dimension_id
       LEFT JOIN cupping_note f ON f.id = w.seam_family_note_id
      ORDER BY w.angle_order`);
  const s = await runner.query(`SELECT id, archetype_a, archetype_b, label, is_labelled FROM dial_seam ORDER BY id`);
  return { wedges: w.rows, seams: s.rows };
}

export async function firstMatches(runner: Runner = db) {
  const r = await runner.query(
    `SELECT fm.id, fm.archetype_code, l.code AS lane_code, fm.coffee_id, c.name AS coffee_name, c.is_active AS coffee_is_active,
            st.code AS status, fm.notes, fm.decided_by, fm.created_at,
            pv.grade_code AS preview_grade, pv.grade_rank AS preview_grade_rank,
            pa.grade_code AS active_grade, pa.grade_rank AS active_grade_rank,
            param('dial_min_grade_rank_first_match') AS min_grade_rank
       FROM dial_first_match fm
       JOIN dial_lane l ON l.id = fm.lane_id
       JOIN dial_first_match_status st ON st.id = fm.status_id
       JOIN coffees c ON c.id = fm.coffee_id
       LEFT JOIN v_dial_placement_preview pv ON pv.coffee_id = fm.coffee_id
       LEFT JOIN v_dial_placement pa ON pa.coffee_id = fm.coffee_id
      WHERE fm.superseded_at IS NULL
      ORDER BY fm.archetype_code, l.sort_order`);
  return r.rows.map(x => ({
    ...x,
    min_grade_rank: num(x.min_grade_rank),
    // Rev 3 section 8: the grade floor is checked at read time
    meets_grade_floor_preview: x.preview_grade_rank === null ? null : Number(x.preview_grade_rank) >= Number(x.min_grade_rank),
    meets_grade_floor_active: x.active_grade_rank === null ? null : Number(x.active_grade_rank) >= Number(x.min_grade_rank),
  }));
}

/** Current phrase rows, plus the words each family x customer move resolves to (override, else the default row). */
export async function phrases(runner: Runner = db) {
  const rows = (await runner.query(
    `SELECT p.id, p.archetype_code, m.code AS move_code, p.button_label, p.move_line_template, p.edge_phrase, p.decided_by, p.created_at
       FROM dial_hop_phrase p JOIN dial_move m ON m.id = p.move_id
      WHERE p.superseded_at IS NULL
      ORDER BY p.archetype_code NULLS FIRST, m.sort_order`)).rows;
  const resolved = (await runner.query(
    `SELECT w.archetype_code, m.code AS move_code,
            COALESCE(o.button_label, d.button_label) AS button_label,
            COALESCE(o.move_line_template, d.move_line_template) AS move_line_template,
            COALESCE(o.edge_phrase, d.edge_phrase) AS edge_phrase,
            (o.id IS NOT NULL) AS is_override
       FROM dial_wedge w
       CROSS JOIN dial_move m
       LEFT JOIN dial_hop_phrase o ON o.archetype_code = w.archetype_code AND o.move_id = m.id AND o.superseded_at IS NULL
       LEFT JOIN dial_hop_phrase d ON d.archetype_code IS NULL AND d.move_id = m.id AND d.superseded_at IS NULL
      WHERE m.is_customer_move
      ORDER BY w.angle_order, m.sort_order`)).rows;
  return { rows, resolved };
}

/** The dial_ parameters in force for a mode: current rows (preview) or the active version's snapshot. */
export async function parametersInForce(mode: MapMode, runner: Runner = db): Promise<Record<string, number>> {
  if (mode === 'preview') {
    return Object.fromEntries((await getParameters('dial_', runner)).map(x => [x.key, x.value]));
  }
  const r = await runner.query(`SELECT parameters FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`);
  return r.rows[0]?.parameters ?? {};
}

export interface GraphPoint { coffee_id: number; coffee_name: string; archetype_code: string; is_center: boolean; is_sellable: boolean; category_codes: string[] }
export interface HopEdge { from_coffee_id: number; to_coffee_id: number; relation: string; in_hop_set: boolean; to_category_codes: string[] }

/** The graph check as a pure function (CTO call 5): BFS from the center over bolder / gentler / different hop-set edges. */
export function computeGraphCheck(points: GraphPoint[], hopRows: HopEdge[], cousinPairs: Array<{ coffee_id: number; cousin_coffee_id: number }>) {
  const byId = new Map(points.map(p => [p.coffee_id, p]));
  const name = (id: number) => byId.get(id)?.coffee_name ?? String(id);
  const moveEdges = hopRows.filter(h => h.in_hop_set && h.relation !== 'sibling');
  const reach = (skipTagged: boolean) => {
    const adj = new Map<number, number[]>();
    for (const e of moveEdges) {
      if (skipTagged && (e.to_category_codes ?? []).length > 0) continue;
      adj.set(e.from_coffee_id, [...(adj.get(e.from_coffee_id) ?? []), e.to_coffee_id]);
    }
    const start = points.filter(p => p.is_center && p.is_sellable).map(p => p.coffee_id);
    const seen = new Set<number>(start);
    const queue = [...start];
    while (queue.length) {
      const id = queue.shift()!;
      for (const n of adj.get(id) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    return seen;
  };
  const reached = reach(false);
  const reachedUntagged = reach(true);
  const sellable = points.filter(p => p.is_sellable);
  const has = (id: number, relation: string) => moveEdges.some(e => e.from_coffee_id === id && e.relation === relation);
  const inHopSet = (a: number, b: number) => hopRows.find(h => h.in_hop_set && h.from_coffee_id === a && h.to_coffee_id === b)?.relation ?? null;
  const placedIds = new Set(points.map(p => p.coffee_id));
  const seenPairs = new Set<string>();
  const cousins = [];
  for (const c of cousinPairs) {
    if (!placedIds.has(c.coffee_id) || !placedIds.has(c.cousin_coffee_id)) continue;
    const key = [c.coffee_id, c.cousin_coffee_id].sort((x, y) => x - y).join('-');
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const ab = inHopSet(c.coffee_id, c.cousin_coffee_id);
    const ba = inHopSet(c.cousin_coffee_id, c.coffee_id);
    cousins.push({ a: name(c.coffee_id), b: name(c.cousin_coffee_id), aToB: ab, bToA: ba, reproduced: ab !== null || ba !== null });
  }
  return {
    centers: points.filter(p => p.is_center).map(p => name(p.coffee_id)),
    sellable: sellable.length,
    reachable: [...reached].map(name).sort(),
    unreachableSellable: sellable.filter(p => !reached.has(p.coffee_id)).map(p => p.coffee_name).sort(),
    reachableWithoutTagged: [...reachedUntagged].map(name).sort(),
    noBolder: sellable.filter(p => !has(p.coffee_id, 'bolder')).map(p => p.coffee_name).sort(),
    noGentler: sellable.filter(p => !p.is_center && !has(p.coffee_id, 'gentler')).map(p => p.coffee_name).sort(),
    noDifferent: sellable.filter(p => !has(p.coffee_id, 'different')).map(p => p.coffee_name).sort(),
    noLiveDirection: sellable.filter(p => !moveEdges.some(e => e.from_coffee_id === p.coffee_id)).map(p => p.coffee_name).sort(),
    cousins,
  };
}

export async function graphCheck(mode: MapMode, runner: Runner = db) {
  const points: GraphPoint[] = mode === 'preview'
    ? (await runner.query(`SELECT coffee_id, coffee_name, archetype_code, is_center, is_sellable, category_codes FROM v_dial_placement_preview WHERE is_placeable`)).rows
    : (await runner.query(`SELECT coffee_id, coffee_name, archetype_code, is_center, is_sellable, category_codes FROM v_dial_placement`)).rows;
  const hopRows: HopEdge[] = (await runner.query(
    `SELECT from_coffee_id, to_coffee_id, relation, in_hop_set, to_category_codes FROM ${mode === 'preview' ? 'v_dial_hop_preview' : 'v_dial_hop'}`)).rows;
  const cousinPairs = (await listCousinHints({ bothInCatalog: true }, runner))
    .map(c => ({ coffee_id: c.coffeeId as number, cousin_coffee_id: c.cousinCoffeeId as number }));
  return { mode, parameters: await parametersInForce(mode, runner), ...computeGraphCheck(points, hopRows, cousinPairs) };
}
