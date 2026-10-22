// Cupping evidence, brief 1 (2026-10-18) — the read door for cupping evidence.
// backend/src/features/cupping_evidence/CLAUDE_CODE_PROMPT_CUPPING_EVIDENCE_1_FOUNDATION.md, B3.
//
// Every TS reader of cupping evidence calls these functions; they read the
// views (v_coffee_dimension_range, v_coffee_dimension_history,
// v_coffee_descriptor, v_cupping_scores_readable, v_cupping_score,
// v_cupping_score_descriptor, v_cupping_session, v_cupping_session_coffee)
// and the reference tables (cupper, cupping_scale, cupping_sheet_format,
// cupping_sheet_line), never the six cupping_* evidence tables
// (lint:cupping). Values come out converted to 0 to 15; native values are
// only exposed where Score Entry edits what was written.
import { db, type Tx } from '../db/client.js';

type Runner = Tx | typeof db;

export interface MergedRange {
  coffee_id: number;
  dimension_id: number;
  dimension_name: string;
  value_min: number | null;
  value_max: number | null;
  midpoint: number | null;
  n_scores: number;
  basis: 'merged' | 'unmerged';
  session_id: number;
  session_date: string;
  n_sessions: number;
  all_ab_scale: boolean;
  scale_min_label: string | null;
  scale_max_label: string | null;
  display_order: number | null;
  is_numeric: boolean;
  // Brief 6 (2026-10-21): the range is pooled over every session, weighted by
  // rank and recency; session_id / session_date stay the latest session.
  n_sessions_pooled?: number | null;
  weight_latest_share?: number | null;
  session_weights?: Array<{ session_id: number; session_date: string; weight: number }> | null;
  sessions_disagree?: boolean | null;
  rank_ratio?: number | null;
  half_life_days?: number | null;
}

function toRange(r: Record<string, unknown>): MergedRange {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    coffee_id: Number(r.coffee_id),
    dimension_id: Number(r.dimension_id),
    dimension_name: String(r.dimension_name),
    value_min: num(r.value_min),
    value_max: num(r.value_max),
    midpoint: num(r.midpoint),
    n_scores: Number(r.n_scores),
    basis: r.basis as 'merged' | 'unmerged',
    session_id: Number(r.session_id),
    session_date: r.session_date as string,
    n_sessions: Number(r.n_sessions),
    all_ab_scale: Boolean(r.all_ab_scale),
    scale_min_label: (r.scale_min_label as string | null) ?? null,
    scale_max_label: (r.scale_max_label as string | null) ?? null,
    display_order: num(r.display_order),
    is_numeric: Boolean(r.is_numeric),
    n_sessions_pooled: num(r.n_sessions_pooled),
    weight_latest_share: num(r.weight_latest_share),
    session_weights: (r.session_weights as MergedRange['session_weights']) ?? null,
    sessions_disagree: r.sessions_disagree === null || r.sessions_disagree === undefined ? null : Boolean(r.sessions_disagree),
    rank_ratio: num(r.rank_ratio),
    half_life_days: num(r.half_life_days),
  };
}

const RANGE_SELECT = `
  SELECT r.*, d.scale_min_label, d.scale_max_label, d.display_order, d.is_numeric
  FROM v_coffee_dimension_range r
  JOIN coffee_dimensions d ON d.id = r.dimension_id`;

/** The pooled merged range (or the unmerged fallback) of one coffee on one dimension. */
export async function getMergedRange(coffeeId: number, dimensionId: number, runner: Runner = db): Promise<MergedRange | null> {
  const result = await runner.query(`${RANGE_SELECT} WHERE r.coffee_id = $1 AND r.dimension_id = $2`, [coffeeId, dimensionId]);
  return result.rows[0] ? toRange(result.rows[0]) : null;
}

/** Every dimension of one coffee's latest range, in display order. */
export async function getMergedRanges(coffeeId: number, runner: Runner = db): Promise<MergedRange[]> {
  const result = await runner.query(`${RANGE_SELECT} WHERE r.coffee_id = $1 ORDER BY d.display_order`, [coffeeId]);
  return result.rows.map(toRange);
}

/** Every coffee's latest range (the dial graph's batch read). */
export async function getAllMergedRanges(runner: Runner = db): Promise<MergedRange[]> {
  const result = await runner.query(`${RANGE_SELECT} ORDER BY r.coffee_id, d.display_order`);
  return result.rows.map(toRange);
}

/** Every session's current merged range of one coffee (calibration, repeatability). */
export async function getDimensionHistory(coffeeId: number, runner: Runner = db) {
  const result = await runner.query(
    `SELECT * FROM v_coffee_dimension_history WHERE coffee_id = $1 ORDER BY session_date, session_coffee_id, dimension_id`,
    [coffeeId]
  );
  return result.rows;
}

/** The decision-layer descriptors of a coffee (current merged + accepted roaster + customer), with tier. */
export async function getDescriptors(coffeeId: number, runner: Runner = db) {
  const result = await runner.query(
    `SELECT descriptor, wheel_category, wheel_subcategory, tier, n_sources
     FROM v_coffee_descriptor WHERE coffee_id = $1
     ORDER BY n_sources DESC, wheel_category, descriptor`,
    [coffeeId]
  );
  return result.rows;
}

// Cupping evidence brief 6, C2 (2026-10-21): what a customer may hear about a
// coffee: the roaster's words as flavor-wheel nodes (accepted, then the latest
// website capture), then customers'; never our cupping words, which add
// confirmed_by_cupping instead. Every customer-facing surface reads this
// (story, public wheel and feedback chips, lifecycle email, beats, Liam).
export interface CustomerDescriptor {
  node_id: string;
  descriptor: string;
  wheel_category: string | null;
  wheel_subcategory: string | null;
  tier: number;
  voice: 'roaster_accepted' | 'roaster_website' | 'customer';
  rank: number;
  confirmed_by_cupping: boolean;
  cupping_sessions_named: number | null;
  cupping_sessions_total: number | null;
}

/** One coffee's customer voice in display order, capped at param('customer_voice_max_words'). */
export async function getCustomerDescriptors(coffeeId: number, runner: Runner = db): Promise<CustomerDescriptor[]> {
  const result = await runner.query(
    `SELECT node_id, descriptor, wheel_category, wheel_subcategory, tier, voice, rank,
            confirmed_by_cupping, cupping_sessions_named, cupping_sessions_total
       FROM v_coffee_customer_descriptor WHERE coffee_id = $1
      ORDER BY display_order
      LIMIT (SELECT param('customer_voice_max_words'))::int`,
    [coffeeId]
  );
  return result.rows.map((r: any) => ({
    node_id: r.node_id, descriptor: r.descriptor, wheel_category: r.wheel_category, wheel_subcategory: r.wheel_subcategory,
    tier: Number(r.tier), voice: r.voice, rank: Number(r.rank), confirmed_by_cupping: Boolean(r.confirmed_by_cupping),
    cupping_sessions_named: r.cupping_sessions_named === null ? null : Number(r.cupping_sessions_named),
    cupping_sessions_total: r.cupping_sessions_total === null ? null : Number(r.cupping_sessions_total),
  }));
}

/** Overall notes written on a coffee's current score rows, newest session first. */
export async function getOverallNotes(coffeeId: number, runner: Runner = db): Promise<Array<{ overall_notes: string; session_date: string }>> {
  const result = await runner.query<{ overall_notes: string; session_date: string }>(
    `SELECT s.overall_notes, ses.session_date
     FROM v_cupping_score s
     JOIN v_cupping_session ses ON ses.id = s.session_id
     WHERE s.coffee_id = $1 AND s.overall_notes IS NOT NULL
     ORDER BY ses.session_date DESC, s.id DESC`,
    [coffeeId]
  );
  return result.rows;
}

/**
 * Score Entry's detail read for one session coffee, same shape the old route
 * returned ({ scores, values, descriptors }) plus the evidence columns.
 * values.value_min/max are the NATIVE values (what the form edits and saves
 * back on the same scale); converted_min/max are the 0 to 15 reading.
 */
export async function getScoresForSessionCoffee(sessionCoffeeId: number, runner: Runner = db) {
  const [scores, values, descriptors] = await Promise.all([
    runner.query(
      `SELECT id, cupper_id, cupper_name, taster_name, is_merged, overall_notes, scale_code,
              archetype_call, archetype_call_secondary, position_call, slot_call_id, call_note,
              merge_rule, merge_note, created_at
       FROM v_cupping_score WHERE session_coffee_id = $1 ORDER BY is_merged, cupper_name, id`,
      [sessionCoffeeId]
    ),
    runner.query(
      `SELECT score_id AS cupping_score_id, dimension_id, native_min AS value_min, native_max AS value_max,
              notes, raw_value, value_min AS converted_min, value_max AS converted_max, conversion_error
       FROM v_cupping_scores_readable WHERE session_coffee_id = $1`,
      [sessionCoffeeId]
    ),
    runner.query(
      `SELECT cupping_score_id, cupping_note_id, descriptor, tier, intensity, custom_notes
       FROM v_cupping_score_descriptor WHERE session_coffee_id = $1`,
      [sessionCoffeeId]
    ),
  ]);
  return { scores: scores.rows, values: values.rows, descriptors: descriptors.rows };
}

export async function listSessions(runner: Runner = db) {
  const result = await runner.query(`SELECT * FROM v_cupping_session ORDER BY session_date DESC, id DESC`);
  return result.rows;
}

export async function getSession(sessionId: number, runner: Runner = db) {
  const result = await runner.query(`SELECT * FROM v_cupping_session WHERE id = $1`, [sessionId]);
  return result.rows[0] ?? null;
}

export async function listSessionCoffees(sessionId: number, runner: Runner = db) {
  const result = await runner.query(
    `SELECT * FROM v_cupping_session_coffee WHERE session_id = $1 ORDER BY display_order NULLS LAST, name`,
    [sessionId]
  );
  return result.rows;
}

export async function getSessionCoffee(sessionCoffeeId: number, runner: Runner = db) {
  const result = await runner.query(`SELECT * FROM v_cupping_session_coffee WHERE session_coffee_id = $1`, [sessionCoffeeId]);
  return result.rows[0] ?? null;
}

/** Counts for the admin dashboard (current evidence only). */
export async function getCuppingCounts(runner: Runner = db): Promise<{ sessions: number; internal_descriptors: number }> {
  const result = await runner.query(
    `SELECT (SELECT COUNT(*) FROM v_cupping_session) AS sessions,
            (SELECT COUNT(*) FROM v_cupping_score_descriptor) AS internal_descriptors`
  );
  return { sessions: Number(result.rows[0].sessions), internal_descriptors: Number(result.rows[0].internal_descriptors) };
}

// ── Integrity (cupping evidence brief 3, B00) ─────────────────────────────

/**
 * Superseded score rows whose replacement is missing or itself gone: the one
 * evidenceIntegrity check that needs superseded rows, which no view shows.
 */
export async function getSupersededWithoutTarget(runner: Runner = db): Promise<Array<{ id: number; superseded_by_id: number | null }>> {
  const result = await runner.query<{ id: number; superseded_by_id: number | null }>(
    `SELECT cs.id, cs.superseded_by_id FROM cupping_scores cs
      WHERE cs.superseded_at IS NOT NULL
        AND (cs.superseded_by_id IS NULL OR NOT EXISTS (SELECT 1 FROM cupping_scores t WHERE t.id = cs.superseded_by_id))
      ORDER BY cs.id`
  );
  return result.rows;
}

// ── Reference tables (rows, not code) ─────────────────────────────────────

/** The whole SCA wheel (every tier, every family including Other), for loaders that resolve a node by name. */
export async function listWheelNodes(runner: Runner = db): Promise<Array<{ id: string; descriptor: string; tier: number; wheel_category: string; wheel_subcategory: string | null; is_active: boolean }>> {
  const result = await runner.query(
    `SELECT id, descriptor, tier, wheel_category, wheel_subcategory, is_active FROM cupping_note ORDER BY wheel_category, tier, descriptor`
  );
  return result.rows.map(r => ({ ...r, tier: Number(r.tier) }));
}

export async function listCuppers(filter: { activeOnly?: boolean } = {}, runner: Runner = db) {
  const result = await runner.query(
    `SELECT id, name, is_active, since, note FROM cupper ${filter.activeOnly ? 'WHERE is_active' : ''} ORDER BY name`
  );
  return result.rows;
}

export async function listScales(runner: Runner = db) {
  const [scales, steps] = await Promise.all([
    runner.query(`SELECT id, code, label, kind, scale_min, scale_max, note FROM cupping_scale ORDER BY id`),
    runner.query(`SELECT scale_code, raw_label, ab_min, ab_max FROM cupping_scale_step ORDER BY scale_code, ab_min`),
  ]);
  return scales.rows.map(s => ({ ...s, steps: steps.rows.filter(st => st.scale_code === s.code) }));
}

export async function listSheetFormats(runner: Runner = db) {
  const [formats, lines] = await Promise.all([
    runner.query(`SELECT id, code, label, since, note FROM cupping_sheet_format ORDER BY id`),
    runner.query(`SELECT sheet_format, line_label, dimension_id, is_numeric, display_order FROM cupping_sheet_line ORDER BY sheet_format, display_order`),
  ]);
  return formats.rows.map(f => ({ ...f, lines: lines.rows.filter(l => l.sheet_format === f.code) }));
}

export async function getSheetLines(sheetFormat: string, runner: Runner = db) {
  const result = await runner.query(
    `SELECT line_label, dimension_id, is_numeric, display_order FROM cupping_sheet_line WHERE sheet_format = $1 ORDER BY display_order`,
    [sheetFormat]
  );
  return result.rows;
}
