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
import { listCousinHints, roasterFactsForCoffees } from './roasteryPortalReads.js';

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
  const ctx = await moveLineContext(runner);
  return r.rows.map(h => {
    const line = composeMoveLine(ctx, {
      fromArchetype: h.from_archetype, relation: h.relation, fromName: h.from_coffee_name, toName: h.to_coffee_name,
      deltas: Object.fromEntries(ctx.readings.map(rd => [rd, h[`delta_${rd}`] === null || h[`delta_${rd}`] === undefined ? null : Number(h[`delta_${rd}`])])),
    });
    return { ...h, move_line: line?.text ?? null, deltas_mentioned: line?.mentioned ?? [] };
  });
}

// ── Ella map 2 (2026-11-10): move lines from dial_hop_phrase + dial_delta_phrase ──
// Dana's decision 4: a delta smaller than dial_delta_min_to_mention is not
// mentioned; the mentioned ones are listed in dial_reading order, joined by
// commas, through the family x move template. Ring is carried by the move
// word, never by a delta phrase.
export interface MoveLineContext {
  readings: string[];                                   // dial_reading codes in id order
  phrases: Record<string, Record<'1' | '-1', string>>; // reading -> sign -> phrase
  templates: Record<string, Record<string, string | null>>; // archetype -> move -> template (override, else default)
  /** Ella map 3 (decision 8): archetype -> move -> resolved button label, for {label} in a template */
  labels?: Record<string, Record<string, string>>;
  minToMention: number;
}

export async function moveLineContext(runner: Runner = db): Promise<MoveLineContext> {
  const readings = (await runner.query<{ code: string }>(`SELECT code FROM dial_reading ORDER BY id`)).rows.map(r => r.code);
  const ph = (await runner.query<{ reading: string; sign: number; phrase: string }>(
    `SELECT r.code AS reading, d.sign, p.phrase FROM dial_delta_phrase p
       JOIN dial_reading r ON r.id = p.reading_id JOIN dial_delta_direction d ON d.id = p.direction_id
      WHERE p.superseded_at IS NULL`)).rows;
  const phraseMap: MoveLineContext['phrases'] = {};
  for (const x of ph) (phraseMap[x.reading] ??= {} as Record<'1' | '-1', string>)[String(x.sign) as '1' | '-1'] = x.phrase;
  const templates: MoveLineContext['templates'] = {};
  const labels: MoveLineContext['labels'] = {};
  for (const t of (await phrases(runner)).resolved) {
    (templates[t.archetype_code] ??= {})[t.move_code] = t.move_line_template;
    (labels[t.archetype_code] ??= {})[t.move_code] = t.button_label;
  }
  const min = (await getParameters('dial_delta_min_to_mention', runner)).find(x => x.key === 'dial_delta_min_to_mention')?.value;
  return { readings, phrases: phraseMap, templates, labels, minToMention: min === undefined ? Number.POSITIVE_INFINITY : Number(min) };
}

/** The move line for one hop: the family's template with {label} (the family's button label, Ella map 3), {from}, {to} and the mentioned deltas' words. Null when the move has no template (sibling). */
export function composeMoveLine(ctx: MoveLineContext, hop: {
  fromArchetype: string; relation: string; fromName: string; toName: string; deltas: Record<string, number | null>;
}): { text: string; mentioned: Array<{ reading: string; delta: number; phrase: string }> } | null {
  const template = ctx.templates[hop.fromArchetype]?.[hop.relation] ?? null;
  if (!template) return null;
  const mentioned: Array<{ reading: string; delta: number; phrase: string }> = [];
  for (const reading of ctx.readings) {
    const d = hop.deltas[reading];
    if (d === null || d === undefined || Math.abs(d) < ctx.minToMention || d === 0) continue;
    const phrase = ctx.phrases[reading]?.[d > 0 ? '1' : '-1'];
    if (phrase) mentioned.push({ reading, delta: d, phrase });
  }
  const text = template.replaceAll('{label}', ctx.labels?.[hop.fromArchetype]?.[hop.relation] ?? '').replaceAll('{from}', hop.fromName).replaceAll('{to}', hop.toName)
    .replaceAll('{deltas}', mentioned.map(m => m.phrase).join(', '))
    .replace(/[\s:,]+$/, '');
  return { text, mentioned };
}

/** Every vocabulary the workbench shows, from the lookups (G4.2: the page types in no label). */
export async function vocabulary(runner: Runner = db) {
  const q = async (sql: string) => (await runner.query(sql)).rows;
  return {
    lanes: await q(`SELECT code, label, customer_label, sort_order FROM dial_lane ORDER BY sort_order`),
    // Ella map 2 (OT-123): dial_lane.label is a template; {side} is the wedge's side archetype name
    laneWords: await q(
      `SELECT w.archetype_code, l.code AS lane_code,
              replace(l.label, '{side}', COALESCE(CASE l.code WHEN 'side_a' THEN sa.name WHEN 'side_b' THEN sb.name END, '')) AS label
         FROM dial_wedge w
         CROSS JOIN dial_lane l
         LEFT JOIN coffee_archetype sa ON sa.code = w.side_a_archetype
         LEFT JOIN coffee_archetype sb ON sb.code = w.side_b_archetype
        ORDER BY w.angle_order, l.sort_order`),
    grades: await q(`SELECT code, label, rank, description FROM dial_evidence_grade ORDER BY rank DESC`),
    moves: await q(`SELECT code, label, is_customer_move, sort_order FROM dial_move ORDER BY sort_order`),
    versionStatuses: await q(`SELECT code, label FROM dial_map_version_status ORDER BY id`),
    firstMatchStatuses: await q(`SELECT code, label FROM dial_first_match_status ORDER BY id`),
    sizes: await q(`SELECT code, label, customer_label FROM dial_size ORDER BY code`),
    rings: await q(`SELECT code, label FROM dial_ring ORDER BY code`),
    // Ella map 5: why a step exists and its line on the admin face
    stepBases: await q(`SELECT code, label, sort_order, line_style FROM dial_step_basis ORDER BY sort_order`),
    // Ella map 7: which leans each family may take (a closed side is never offered), and the start conditions
    wedgeLanes: await q(`SELECT archetype_code, lane_code, toward_archetype, is_open FROM v_dial_wedge_lane ORDER BY archetype_code, sort_order`),
    startConditions: await q(`SELECT code, label, sort_order FROM dial_start_condition ORDER BY sort_order`),
    flags: await q(`SELECT code, label, description FROM dial_flag ORDER BY id`),
    readings: await q(`SELECT code, label, dimension_id FROM dial_reading ORDER BY id`),
    deltaPhrases: await q(
      `SELECT r.code AS reading, d.code AS direction, d.sign, p.phrase FROM dial_delta_phrase p
         JOIN dial_reading r ON r.id = p.reading_id JOIN dial_delta_direction d ON d.id = p.direction_id
        WHERE p.superseded_at IS NULL ORDER BY r.id, d.sign DESC`),
  };
}

/** A coffee's lean decisions, newest first (v_coffee_lean_assignment_history, the table's one read path). */
export async function leanHistory(coffeeId: number, runner: Runner = db) {
  const r = await runner.query(
    `SELECT * FROM v_coffee_lean_assignment_history WHERE coffee_id = $1 ORDER BY created_at DESC, id DESC`, [coffeeId]);
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
  const s = await runner.query(`SELECT id, archetype_a, archetype_b, label, is_labelled, is_open FROM dial_seam ORDER BY id`);
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

// ── Ella's Bloom Map 3 (2026-11-12): the customer side's reads ──────────────

/** Decision 4: the ranked targets from one coffee on the active map, wherever it is placed and whether or not it is sellable (dial_hop_rows_from). Unfiltered: matchService applies the customer's filters. */
export async function hopsFromCoffee(coffeeId: number, runner: Runner = db) {
  const r = await runner.query(
    `SELECT h.*, f.name AS from_coffee_name, t.name AS to_coffee_name
       FROM dial_hop_rows_from($1) h
       JOIN coffees f ON f.id = h.from_coffee_id
       JOIN coffees t ON t.id = h.to_coffee_id
      ORDER BY h.relation, h.rank`, [coffeeId]);
  return r.rows.map(h => ({
    ...h,
    distance: num(h.distance),
    deltas: { ring: num(h.delta_ring), body: num(h.delta_body), sweetness: num(h.delta_sweetness), acidity: num(h.delta_acidity), bitterness: num(h.delta_bitterness) } as Record<string, number | null>,
  }));
}

/**
 * The customer face of the active map: every placed coffee, without grade,
 * roaster or category tags (B2: tags ride on the card payload only). Ella map 7
 * (decision 7, Dana 2026-11-17: the same map for everyone): every placed coffee
 * is a dot, sellable or not; the page names only the customer's own.
 */
export async function customerFace(runner: Runner = db) {
  const r = await runner.query(
    `SELECT version_id, coffee_id, coffee_name, archetype_code, is_center, ring, lane_code, size, is_sellable
       FROM v_dial_face ORDER BY archetype_code, ring, coffee_name`);
  return r.rows;
}

// ── Ella's Bloom Map 8 (2026-11-18): coffee-grain availability ───────────────
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_8_PRICES_AND_BUYABLE.md

export interface MapCoffee {
  coffee_id: number; map_name: string; is_sellable: boolean; in_stock: boolean;
  weight_oz: number | null; size_label: string | null; price_cents: number | null;
  has_sku: boolean; has_price: boolean; family_code: string | null;
  /** the roaster's own bag notes (coffees.flavor_descriptors_roaster), each element split on commas; [] when none */
  roaster_words: string[];
  /** Ella map 10: the coffee's plain sentence on /map (coffees.map_line); null when not written */
  map_line: string | null;
  /** Ella map 10: the family the placement's quiz branch comes from (dial_wedge.branches_from_code); null for none */
  family_branches_from_code: string | null;
  /** Ella map 15: the family the coffee's lane leans toward (v_dial_wedge_lane.toward_archetype); null in the middle lane */
  lean_family_code: string | null;
}

function wordsOf(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.flatMap(x => String(x).split(',')).map(w => w.trim()).filter(Boolean);
}

/** Per coffee on the active map: its map name, availability, anchor size and price (v_dial_coffee_availability). */
export async function mapCoffees(coffeeIds?: number[], runner: Runner = db): Promise<Map<number, MapCoffee>> {
  const r = await runner.query(
    `SELECT av.coffee_id, av.map_name, (c.is_active AND av.is_sellable) AS is_sellable, av.in_stock,
            av.weight_oz, av.size_label, av.price_cents, av.has_sku, av.has_price,
            p.archetype_code::text AS family_code, p.family_branches_from_code,
            c.flavor_descriptors_roaster AS roaster_words, av.map_line, wl.toward_archetype::text AS lean_family_code
       FROM v_dial_coffee_availability av
       JOIN v_coffee c ON c.id = av.coffee_id
       JOIN v_dial_placement p ON p.coffee_id = av.coffee_id
       LEFT JOIN v_dial_wedge_lane wl ON wl.archetype_code::text = p.archetype_code::text AND wl.lane_id = p.lane_id
      WHERE ($1::int[] IS NULL OR av.coffee_id = ANY($1::int[]))`, [coffeeIds ?? null]);
  return new Map(r.rows.map(x => [x.coffee_id, {
    ...x, weight_oz: x.weight_oz === null ? null : Number(x.weight_oz), roaster_words: wordsOf(x.roaster_words),
  }]));
}

/** The map's name for a coffee on the active map, or null when the coffee is not on it. */
export async function mapName(coffeeId: number, runner: Runner = db): Promise<string | null> {
  return (await mapCoffees([coffeeId], runner)).get(coffeeId)?.map_name ?? null;
}

/** The active version's id and label, or null. */
export async function activeVersion(runner: Runner = db): Promise<{ id: number; label: string } | null> {
  const r = await runner.query<{ id: number; label: string }>(
    `SELECT id, label FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`);
  return r.rows[0] ?? null;
}

/** Every dial_surface row with its model (v_dial_surface). */
export async function surfaces(runner: Runner = db) {
  return (await runner.query(`SELECT id, code, label, model_code, model_label, updated_by, updated_at FROM v_dial_surface ORDER BY id`)).rows;
}

/** Does this surface render the map now? */
export async function surfaceIsMap(code: string, runner: Runner = db): Promise<boolean> {
  const r = await runner.query<{ model_code: string }>(`SELECT model_code FROM v_dial_surface WHERE code = $1`, [code]);
  return r.rows[0]?.model_code === 'map';
}

/** The current customer sentences by code (v_dial_customer_copy). */
export async function customerCopy(runner: Runner = db): Promise<Record<string, string>> {
  const r = await runner.query<{ code: string; text: string }>(`SELECT code, text FROM v_dial_customer_copy`);
  return Object.fromEntries(r.rows.map(x => [x.code, x.text]));
}

/** Every current customer copy row (the workbench). */
export async function customerCopyRows(runner: Runner = db) {
  return (await runner.query(`SELECT id, code, text, decided_by, created_at FROM v_dial_customer_copy ORDER BY id`)).rows;
}

/** The current first-match row for a cell (dial_first_match; the grade floor is checked by the caller). */
export async function firstMatchFor(archetypeCode: string, laneCode: string, runner: Runner = db): Promise<number | null> {
  const r = await runner.query<{ coffee_id: number }>(
    `SELECT fm.coffee_id FROM dial_first_match fm JOIN dial_lane l ON l.id = fm.lane_id
      WHERE fm.archetype_code::text = $1 AND l.code = $2 AND fm.superseded_at IS NULL`, [archetypeCode, laneCode]);
  return r.rows[0]?.coffee_id ?? null;
}

/** dial_move code -> id (the decision log's FK). */
export async function moveIds(runner: Runner = db): Promise<Record<string, number>> {
  const r = await runner.query<{ code: string; id: number }>(`SELECT code, id FROM dial_move`);
  return Object.fromEntries(r.rows.map(x => [x.code, x.id]));
}

/** Per active coffee, how many hops it has (in_hop_set rows of v_dial_hop): the first-match fallback's "most hops first". */
export async function hopCounts(runner: Runner = db): Promise<Map<number, number>> {
  const r = await runner.query<{ from_coffee_id: number; n: number }>(
    `SELECT from_coffee_id, count(*)::int AS n FROM v_dial_hop WHERE in_hop_set GROUP BY from_coffee_id`);
  return new Map(r.rows.map(x => [x.from_coffee_id, x.n]));
}

// ── Ella's Bloom Map 5 (2026-11-16), B2 ───────────────────────────────────────
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_5_DECIDED_MAP_AND_ADMIN.md

export type StepMode = 'current' | 'active';
export const STEP_MODES: readonly StepMode[] = ['current', 'active'];

/**
 * Steps from v_dial_step, the one read for steps. 'current': every current
 * row, shown or not (the admin table). 'active': the steps on the active map
 * (in force at its cut, shown, both coffees placed): the lines on the face.
 * Sorted by basis order, then from, then to.
 */
export async function steps(mode: StepMode = 'current', runner: Runner = db) {
  const where = mode === 'active' ? 'on_active_map' : 'is_current';
  const r = await runner.query(
    `SELECT id, from_coffee_id, from_coffee_name, to_coffee_id, to_coffee_name, button_word, customer_line,
            basis_code, basis_label, line_style, basis_sort_order, is_shown, notes, decided_by, created_at,
            is_current, is_in_active_version, on_active_map, move_code, when_line
       FROM v_dial_step WHERE ${where}
      ORDER BY basis_sort_order, from_coffee_name, to_coffee_name, id`);
  return r.rows;
}

/** A coffee's ring decisions, newest first (v_coffee_ring_assignment_history, the table's one read path). */
export async function ringHistory(coffeeId: number, runner: Runner = db) {
  const r = await runner.query(
    `SELECT * FROM v_coffee_ring_assignment_history WHERE coffee_id = $1 ORDER BY created_at DESC, id DESC`, [coffeeId]);
  return r.rows;
}

/** Decisions written after the active version was cut: what Publish would carry. */
export async function unpublished(runner: Runner = db) {
  const r = await runner.query<{ family: number; lean: number; ring: number; step: number; cut_at: string | null }>(
    `WITH av AS (SELECT cut_at FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL),
          t AS (SELECT COALESCE((SELECT cut_at FROM av), '-infinity'::timestamptz) AS cut_at)
     SELECT (SELECT count(*)::int FROM coffee_archetype_assignment a, t WHERE a.created_at > t.cut_at) AS family,
            (SELECT count(*)::int FROM v_coffee_lean_assignment_history h, t WHERE h.created_at > t.cut_at) AS lean,
            (SELECT count(*)::int FROM v_coffee_ring_assignment_history h, t WHERE h.created_at > t.cut_at) AS ring,
            (SELECT count(*)::int FROM v_dial_step s, t WHERE s.is_current AND s.created_at > t.cut_at) AS step,
            (SELECT cut_at FROM av) AS cut_at`);
  const x = r.rows[0];
  return { ...x, total: x.family + x.lean + x.ring + x.step };
}

/**
 * Everything the decided-map page reads in one call: the active version, its
 * placements, the steps on it, every current step, the current decisions per
 * coffee (the preview), each coffee's roaster notes and 1 to 5 ratings (the
 * latest submitted portal response, read only), and the unpublished count.
 */
export async function decidedMap(runner: Runner = db) {
  const version = (await runner.query(
    `SELECT id, label, reason, cut_at, activated_at FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`)).rows[0] ?? null;
  const placements = (await runner.query(
    `SELECT p.coffee_id, p.coffee_name, p.roaster_name, p.archetype_code, p.is_center, p.ring, p.lane_code, p.size,
            p.is_sellable, p.in_stock, p.flags, p.grade_code
       FROM v_dial_placement p ORDER BY p.archetype_code, p.ring, p.coffee_name`)).rows;
  const decisions = (await runner.query(
    `SELECT coffee_id, coffee_name, roaster_id, roaster_name, archetype_code, is_center, is_placeable, ring, decided_ring, calculated_ring,
            ring_assignment_id, lane_code, decided_lane_code, size, roaster_sweetness, flags
       FROM v_dial_placement_preview ORDER BY archetype_code, coffee_name`)).rows;
  const roaster = await roasterFactsForCoffees(decisions.map(d => d.coffee_id), runner);
  const av = await runner.query(
    `SELECT coffee_id, is_sellable, size_label, price_cents, has_sku, has_price, map_name, map_line
       FROM v_dial_coffee_availability WHERE coffee_id = ANY($1::int[])`, [decisions.map(d => d.coffee_id)]);
  return {
    version,
    availability: av.rows,
    placements,
    activeSteps: await steps('active', runner),
    steps: await steps('current', runner),
    decisions,
    roaster,
    unpublished: await unpublished(runner),
  };
}

// ── Ella's Bloom Map 7 (2026-11-17), B ────────────────────────────────────────
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_7_MATCH_RULE_AND_CUSTOMER_PAGE.md

export interface StartRuleRow {
  id: number; family_code: string; family_name: string; family_order: number | null; priority: number;
  condition_code: string; condition_label: string; also_condition_code: string | null; also_condition_label: string | null;
  coffee_id: number; coffee_name: string; admin_label: string; customer_reason: string; notes: string | null;
  decided_by: string | null; created_at: string; superseded_at: string | null; is_current: boolean;
  /** Ella map 9 (A3): the first bag's personal line and its lead */
  coffee_line: string | null; lead_to_coffee_id: number | null; lead_to_coffee_name: string | null;
  lead_line: string | null; lead_quote_family_code: string | null;
  /** Ella map 10 (A4): the family each condition is about (dial_start_condition.family_code) */
  condition_family_code: string | null; also_condition_family_code: string | null;
}
const START_RULE_COLS = `id, family_code, family_name, family_order, priority, condition_code, condition_label,
  also_condition_code, also_condition_label, coffee_id, coffee_name, admin_label, customer_reason, notes,
  decided_by, created_at, superseded_at, is_current, coffee_line, lead_to_coffee_id, lead_to_coffee_name, lead_line, lead_quote_family_code,
  condition_family_code, also_condition_family_code`;

/** The start rule (v_dial_start_rule): current rows in family then priority order; with history, every row, newest first within a (family, priority). */
export async function startRules(opts: { history?: boolean } = {}, runner: Runner = db): Promise<StartRuleRow[]> {
  const r = await runner.query<StartRuleRow>(
    `SELECT ${START_RULE_COLS} FROM v_dial_start_rule ${opts.history ? '' : 'WHERE is_current'}
      ORDER BY family_order NULLS LAST, family_code, priority, created_at DESC, id DESC`);
  return r.rows;
}

/** A quiz session's first bag (v_dial_start): the winning rule row, or rule_id null when none wins; null when the session has no row. */
export async function startForSession(quizSessionId: string, runner: Runner = db) {
  const r = await runner.query(
    `SELECT quiz_session_id, family_read, scores, conditions, rule_id, priority, condition_code, also_condition_code,
            coffee_id, coffee_name, admin_label, customer_reason,
            branched_from_code, coffee_line, lead_to_coffee_id, lead_line, lead_quote_family_code,
            condition_family_code, also_condition_family_code
       FROM v_dial_start WHERE quiz_session_id = $1`, [quizSessionId]);
  return r.rows[0] ?? null;
}

/** The fallback when no rule row wins: the center family's current row with the given condition code (the brief: Balanced's always row). */
export async function startFallback(conditionCode: string, runner: Runner = db): Promise<StartRuleRow | null> {
  const r = await runner.query<StartRuleRow>(
    `SELECT ${START_RULE_COLS} FROM v_dial_start_rule r
      WHERE r.is_current AND r.condition_code = $1 AND r.also_condition_code IS NULL
        AND r.family_code = (SELECT archetype_code::text FROM dial_wedge WHERE is_center)
      ORDER BY r.priority LIMIT 1`, [conditionCode]);
  return r.rows[0] ?? null;
}

/** The steps on the active map leaving one coffee (v_dial_step, on_active_map), in basis order then word. */
export async function stepsFrom(coffeeId: number, runner: Runner = db) {
  const r = await runner.query(
    `SELECT id, from_coffee_id, to_coffee_id, to_coffee_name, button_word, customer_line, basis_sort_order, move_code
       FROM v_dial_step WHERE on_active_map AND from_coffee_id = $1
      ORDER BY basis_sort_order, button_word, to_coffee_name, id`, [coffeeId]);
  return r.rows as Array<{ id: number; from_coffee_id: number; to_coffee_id: number; to_coffee_name: string; button_word: string; customer_line: string | null; basis_sort_order: number; move_code: string | null }>;
}

/** Ella map 16: one published, shown step on the active map (v_dial_step on_active_map). */
export interface ActiveStep { id: number; from_coffee_id: number; to_coffee_id: number; to_coffee_name: string; button_word: string; basis_sort_order: number; move_code: string | null }

/**
 * Every step on the active map, keyed (from, to), in step-card order (basis
 * order, then word, then the destination's name, then id): the step pairs the
 * brief 15 tag (joined_by_step) and the brief 16 distance from the spot read.
 */
export async function activeStepWords(runner: Runner = db): Promise<Map<string, ActiveStep>> {
  const r = await runner.query<ActiveStep>(
    `SELECT id, from_coffee_id, to_coffee_id, to_coffee_name, button_word, basis_sort_order, move_code
       FROM v_dial_step WHERE on_active_map
      ORDER BY basis_sort_order, button_word, to_coffee_name, id`);
  return new Map(r.rows.map(x => [`${x.from_coffee_id}>${x.to_coffee_id}`, x]));
}

/** May a coffee of this family lean this way (v_dial_wedge_lane)? Null when the family or lane is unknown. */
export async function laneIsOpen(archetypeCode: string, laneCode: string, runner: Runner = db): Promise<boolean | null> {
  const r = await runner.query<{ is_open: boolean }>(
    `SELECT is_open FROM v_dial_wedge_lane WHERE archetype_code::text = $1 AND lane_code = $2`, [archetypeCode, laneCode]);
  return r.rows[0]?.is_open ?? null;
}

// ── Ella's Bloom Map 9 (2026-11-20), B2 ───────────────────────────────────────
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_9_PERSONAL_REASONS.md

export interface SaidBackRow { id: number; source_code: string; fact_code: string; says_back: string; /** Ella map 10: the direction it argues for */ move_code: string | null }

/** The current quoted phrases (v_dial_said_back), keyed `${source}:${fact}`. A fact with no key is never quoted (no row, or is_quoted false). */
export async function saidBack(runner: Runner = db): Promise<Map<string, SaidBackRow>> {
  const r = await runner.query<SaidBackRow>(
    `SELECT id, source_code, fact_code, says_back, move_code FROM v_dial_said_back WHERE is_current AND is_quoted`);
  return new Map(r.rows.map(x => [`${x.source_code}:${x.fact_code}`, x]));
}

/** Every fact the map could say back, with its phrase (v_dial_said_back_fact): the admin table. */
export async function saidBackFacts(runner: Runner = db) {
  const r = await runner.query(
    `SELECT source_code, fact_code, fact_label, context, context_group, q_number, weight, is_quotable, said_back_id, says_back, is_quoted, move_code
       FROM v_dial_said_back_fact
      ORDER BY source_order, context_group, q_number NULLS LAST, fact_order, fact_code`);
  return r.rows;
}

/** Every said-back row, current and superseded, newest first (the admin history). */
export async function saidBackHistory(runner: Runner = db) {
  return (await runner.query(
    `SELECT id, source_code, fact_code, says_back, is_quoted, move_code, decided_by, created_at, superseded_at, is_current
       FROM v_dial_said_back ORDER BY source_code, fact_code, created_at DESC, id DESC`)).rows;
}

export interface QuizAnswerRow {
  answer_code: string; is_branch: boolean; q_number: number; weight: number; family_code: string | null; is_self_taken: boolean;
  /** Ella map 12: the answer's food signal (quiz_answer.resulting_archetype_id), for every answer; the treat step support reads it */
  resulting_family_code: string | null;
}

/** One quiz session's answers (v_dial_quiz_answer): the branch answer first, then question weight high to low, then question number. */
export async function quizAnswers(quizSessionId: string, runner: Runner = db): Promise<QuizAnswerRow[]> {
  const r = await runner.query(
    `SELECT answer_code, is_branch, q_number, weight, family_code, is_self_taken, resulting_family_code
       FROM v_dial_quiz_answer WHERE quiz_session_id = $1
      ORDER BY is_branch DESC, weight DESC, q_number, answer_code`, [quizSessionId]);
  return r.rows.map(x => ({ ...x, weight: Number(x.weight) }));
}

// ── Ella's Bloom Map 10 (2026-11-24), B2 ──────────────────────────────────────
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_10_REASONS_REV2.md

export interface ReasonChoiceRow {
  id: number; kind_code: string; kind_label: string; kind_order: number; code: string; label: string;
  sort_order: number; is_active: boolean; decided_by: string | null; created_at: string; superseded_at: string | null; is_current: boolean;
}

/** How a /map card is chosen (v_dial_reason_choice): current rows in kind then sort order; with history, every row, newest first within a (kind, code). */
export async function reasonChoices(opts: { history?: boolean } = {}, runner: Runner = db): Promise<ReasonChoiceRow[]> {
  const r = await runner.query<ReasonChoiceRow>(
    `SELECT id, kind_code, kind_label, kind_order, code, label, sort_order, is_active, decided_by, created_at, superseded_at, is_current
       FROM v_dial_reason_choice ${opts.history ? '' : 'WHERE is_current'}
      ORDER BY kind_order, kind_code, sort_order, code, created_at DESC, id DESC`);
  return r.rows;
}

// ── Ella's Bloom Map 14 (2026-11-27), B: what moves a spot ───────────────────
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_14_SPOT_AND_WALK.md

export interface SpotEventConfigRow {
  id: number; code: string; label: string; effect_code: string; effect_label: string; effect_order: number;
  trail_word: string | null; sort_order: number; is_active: boolean; decided_by: string | null;
  created_at: string; superseded_at: string | null; is_current: boolean;
}

/** What moves a spot (v_dial_spot_event): current rows in sort order; with history, every row, newest first within a code. */
export async function spotEvents(opts: { history?: boolean } = {}, runner: Pick<typeof db, 'query'> = db): Promise<SpotEventConfigRow[]> {
  const r = await runner.query(
    `SELECT id, code, label, effect_code, effect_label, effect_order, trail_word, sort_order, is_active, decided_by, created_at, superseded_at, is_current
       FROM v_dial_spot_event ${opts.history ? '' : 'WHERE is_current'}
      ORDER BY sort_order, code, created_at DESC, id DESC`);
  return r.rows as SpotEventConfigRow[];
}

/** /admin/map "What moves a spot": the event rows and the effects they may have. */
export async function spotEventConfig(opts: { history?: boolean } = {}, runner: Pick<typeof db, 'query'> = db) {
  return { events: await spotEvents(opts, runner), effects: await spotEffects(runner) };
}

/** The effects an event may have (dial_spot_effect), for the admin's choice. */
export async function spotEffects(runner: Pick<typeof db, 'query'> = db): Promise<Array<{ code: string; label: string; sort_order: number }>> {
  const r = await runner.query(`SELECT code, label, sort_order FROM dial_spot_effect ORDER BY sort_order`);
  return r.rows as Array<{ code: string; label: string; sort_order: number }>;
}

/** dial_move code -> the code of its opposite move (bolder <-> gentler); moves without one are absent. Read by nothing since Ella map 10 (step_against retired). */
export async function moveOpposites(runner: Runner = db): Promise<Map<string, string>> {
  const r = await runner.query<{ code: string; opposite: string }>(
    `SELECT m.code, o.code AS opposite FROM dial_move m JOIN dial_move o ON o.id = m.opposite_move_id`);
  return new Map(r.rows.map(x => [x.code, x.opposite]));
}
