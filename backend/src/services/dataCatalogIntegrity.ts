// Data catalog · brief 2, Part B (2026-10-16) — the boot check that keeps
// the data dictionary honest
// (backend/src/features/data_catalog/CLAUDE_CODE_PROMPT_DATA_CATALOG_2_LINT_AND_CATALOG_MD.md).
//
// Report only (Dana, 2026-10-16, replacing the brief's report/strict switch):
// every check is severity 'info', findings go to the boot log and the System
// Health card, and nothing here ever stops the boot. There is no
// CATALOG_LINT_MODE. Same report shape as catalogIntegrity.ts.
//
// Brief 3 (2026-10-16) adds check 5 (one writer, the same finding CI's
// lint:lineage fails on, from the lineage.json shipped in the image) and
// check 6 (dead table candidates, static and observed), both 'info', plus
// the `lineage` section System Health shows.
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import type pg from 'pg';
import { db } from '../db/client.js';
import type { CatalogIntegrityCheck, CatalogIntegrityReport } from './catalogIntegrity.js';
import { getParameters } from './evidenceReads.js';
import { KNOWN_REASON_CHOICES, KNOWN_SPOT_EVENTS, KNOWN_SPOT_EFFECTS } from './matchService.js';
import { listScales } from './cuppingReads.js';
import {
  appWriterModules,
  computeCatalogHash,
  declaredWriterModules,
  fetchCatalogRows,
  fetchTableActivity,
  readLineageJson,
  findUncommentedObjects,
  objectName,
  parseRelationComment,
  readCatalogMdHash,
  type CatalogRow,
} from './dataCatalogQueries.js';

export interface DataCatalogCounts {
  tables: number;
  views: number;
  columns: number;
  unverified: number;
}

export interface DataCatalogLineage {
  available: boolean;           // lineage.json found on this image
  generatedAt: string | null;
  multiWriter: { table: string; modules: string[] }[];       // declared, candidates to consolidate
  undeclared: { table: string; module: string; file: string; line: number }[];
  deadDoors: { table: string; module: string }[];            // declared, no write in code
  deadCandidates: { table: string; static: boolean; observed: boolean }[];
  probes: number;
  statsReset: string | null;    // pg_stat_database, for v_data_table_activity
}

export interface DataCatalogReport extends CatalogIntegrityReport {
  lineage: DataCatalogLineage;
  counts: DataCatalogCounts;
  liveHash: string;
  catalogMdHash: string | null;
  catalogMdPath: string | null;
  // true only when a CATALOG.md was found and its hash differs from the live one
  catalogMdStale: boolean;
}

// CATALOG.md sits at the repo root and is copied into the image root
// (/app/CATALOG.md, next to dist/) by the Dockerfile. From dist/services/
// that is ../../CATALOG.md; from src/services/ in local dev it is
// ../../../CATALOG.md (backend/ has none of its own).
// lineage.json (npm run lint:lineage) sits next to package.json: /app in the
// image, backend/ locally. ../../lineage.json from both dist/services and src/services.
export function defaultLineagePath(): string | null {
  const p = fileURLToPath(new URL('../../lineage.json', import.meta.url));
  return existsSync(p) ? p : null;
}

export function defaultCatalogMdPath(): string | null {
  for (const rel of ['../../CATALOG.md', '../../../CATALOG.md']) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(p)) return p;
  }
  return null;
}

function check(id: number, name: string, findings: string[], expected: string, actualIfAny: (n: number) => string): CatalogIntegrityCheck {
  return {
    id,
    name,
    pass: findings.length === 0,
    expected,
    actual: findings.length === 0 ? expected : actualIfAny(findings.length),
    details: findings,
    severity: 'info',
  };
}

export async function runDataCatalogIntegrityChecks(
  opts: { runner?: pg.Pool | pg.PoolClient; catalogMdPath?: string | null; lineagePath?: string | null } = {},
): Promise<DataCatalogReport> {
  const runner = opts.runner ?? db;
  const catalogMdPath = opts.catalogMdPath === undefined ? defaultCatalogMdPath() : opts.catalogMdPath;

  const lineagePath = opts.lineagePath === undefined ? defaultLineagePath() : opts.lineagePath;
  const [uncommented, rows, activity] = await Promise.all([
    findUncommentedObjects(runner), fetchCatalogRows(runner), fetchTableActivity(runner).catch(() => []),
  ]);
  const lineageJson = readLineageJson(lineagePath);
  const relations = rows.filter((r): r is CatalogRow & { comment: string } => r.object_type !== 'column' && r.comment !== null);

  // 1. Every table, view and table column has a comment.
  const c1 = check(1, 'Every table, view and table column has a comment',
    uncommented.map(u => u.object_name), '0 uncommented', n => `${n} uncommented`);

  // 2. No comment starts with UNVERIFIED.
  const c2 = check(2, 'No comment is UNVERIFIED',
    rows.filter(r => r.is_unverified).map(objectName), '0 UNVERIFIED', n => `${n} UNVERIFIED`);

  // 3. Every table and view comment parses into the five fields, allowed Class.
  const c3 = check(3, 'Every table and view comment has Purpose | Class | Writer | Readers | Since with an allowed Class',
    relations.filter(r => !parseRelationComment(r.comment).wellFormed).map(r => r.table_name),
    '0 malformed', n => `${n} malformed`);

  // 4. CATALOG.md matches the live database (decision 4).
  const liveHash = computeCatalogHash(rows);
  const catalogMdHash = catalogMdPath ? readCatalogMdHash(catalogMdPath) : null;
  let c4: CatalogIntegrityCheck;
  if (!catalogMdPath) {
    c4 = { id: 4, name: 'CATALOG.md matches the live database', pass: true, expected: 'hash match',
      actual: 'skipped: CATALOG.md is not present on this image', details: [], severity: 'info' };
  } else if (catalogMdHash === null) {
    c4 = { id: 4, name: 'CATALOG.md matches the live database', pass: false, expected: 'hash match',
      actual: 'CATALOG.md has no catalog-hash footer', details: [catalogMdPath], severity: 'info' };
  } else {
    const match = catalogMdHash === liveHash;
    c4 = { id: 4, name: 'CATALOG.md matches the live database', pass: match, expected: 'hash match',
      actual: match ? 'hash match' : 'CATALOG.md stale',
      details: match ? [] : [`file ${catalogMdHash}`, `live ${liveHash}`], severity: 'info' };
  }

  // 5. One writer (brief 3): the same comparison CI makes (lint:lineage),
  // from the lineage.json shipped in the image against the live Writer fields.
  const declaredByTable = new Map(rows.filter(r => r.object_type === 'table').map(r => [r.table_name, declaredWriterModules(r.writer)]));
  const undeclared: DataCatalogLineage['undeclared'] = [];
  const deadDoors: DataCatalogLineage['deadDoors'] = [];
  const multiWriter: DataCatalogLineage['multiWriter'] = [];
  for (const [table, t] of Object.entries(lineageJson?.tables ?? {})) {
    const declared = declaredByTable.get(table) ?? [];
    const staticMods = [...new Set(t.writers.map(w => w.module))];
    for (const w of t.writers) if (!declared.includes(w.module)) undeclared.push({ table, module: w.module, file: w.file, line: w.lines[0] });
    for (const d of declared) if (!staticMods.includes(d) && !d.startsWith('manual:')) deadDoors.push({ table, module: d });
    const app = appWriterModules(t);
    if (app.length > 1) multiWriter.push({ table, modules: app });
  }
  const C5_NAME = "Every table's writers in code are its declared Writer set (one-writer rule)";
  const c5: CatalogIntegrityCheck = lineageJson
    ? check(5, C5_NAME,
        undeclared.map(u => `${u.table}: ${u.module} (${u.file}:${u.line})`), '0 undeclared writers', n => `${n} undeclared writer(s)`)
    : { id: 5, name: C5_NAME, pass: true, expected: '0 undeclared writers',
        actual: 'skipped: lineage.json is not present on this image', details: [], severity: 'info' };

  // 6. Dead table candidates: no reader in code and no view (static,
  // lineage.json) or nothing touched it in 30+ days (observed, v_data_table_activity).
  const staticDead = new Set(lineageJson?.findings.dead_candidates ?? []);
  const observedDead = new Set(activity.filter(a => a.is_dead_candidate).map(a => a.table_name));
  const deadCandidates = [...new Set([...staticDead, ...observedDead])].sort()
    .map(table => ({ table, static: staticDead.has(table), observed: observedDead.has(table) }));
  const c6 = check(6, 'No dead table candidates (no reader in code, or untouched for 30+ days)',
    deadCandidates.map(d => `${d.table} (${[d.static ? 'static' : null, d.observed ? 'observed' : null].filter(Boolean).join(', ')})`),
    '0 dead candidates', n => `${n} dead candidate(s)`);

  const checks = [c1, c2, c3, c4, c5, c6, ...(await dialMapChecks(runner))];
  return {
    ranAt: new Date().toISOString(),
    allPass: checks.every(c => c.pass),
    checks,
    counts: {
      tables: rows.filter(r => r.object_type === 'table').length,
      views: rows.filter(r => r.object_type === 'view').length,
      columns: rows.filter(r => r.object_type === 'column').length,
      unverified: c2.details!.length,
    },
    liveHash,
    catalogMdHash,
    catalogMdPath,
    catalogMdStale: catalogMdHash !== null && catalogMdHash !== liveHash,
    lineage: {
      available: lineageJson !== null,
      generatedAt: lineageJson?.generated_at ?? null,
      multiWriter: multiWriter.sort((a, b) => a.table.localeCompare(b.table)),
      undeclared,
      deadDoors,
      deadCandidates,
      probes: lineageJson?.probes.length ?? 0,
      statsReset: activity[0]?.stats_reset ? new Date(activity[0].stats_reset).toISOString() : null,
    },
  };
}

// Ella's Bloom Map 1 (2026-11-10), B5: the map's integrity lines, report only
// (G2.18). The codes and keys below are the contract the v_dial_* views and
// dialPlacementService rely on, listed so a missing seed row shows here
// instead of as a silent NULL (param() returns NULL for a missing key).
export const DIAL_SEED_CODES: Record<string, string[]> = {
  dial_lane: ['side_a', 'middle', 'side_b'],
  dial_move: ['quiz_result', 'stay', 'bolder', 'gentler', 'different', 'liam', 'sibling', 'step'],
  dial_evidence_grade: ['A', 'B', 'C', 'D'],
  dial_map_version_status: ['draft', 'active', 'retired'],
  dial_first_match_status: ['founder_pick', 'derived'],
  dial_reading: ['acidity', 'bitterness', 'body', 'sweetness'],
  // Ella map 2 (2026-11-10)
  dial_size: ['1', '2', '3'],
  dial_ring: ['0', '1', '2', '3'],
  dial_delta_direction: ['up', 'down'],
  // Ella map 3 (2026-11-12)
  dial_model: ['lane', 'map'],
  dial_surface: ['customer_face', 'quiz_result', 'profile_trail', 'reorder_email', 'liam_context', 'qr_door', 'axis_stats'],
  // Ella map 5 (2026-11-16)
  dial_step_basis: ['roaster_said', 'recipe_or_ratings', 'our_guess'],
  // Ella map 7 (2026-11-17)
  dial_start_condition: ['always', 'fruity_gt_cn', 'fruity_gt_balanced', 'cn_gt_zero', 'espresso_at_home'],
  // Ella map 9 (2026-11-20)
  dial_said_back_source: ['quiz_answer', 'coffee_feeling', 'cupboard_coffee'],
  // Ella map 10 (2026-11-24)
  dial_reason_choice_kind: ['step_support', 'lead_source'],
  // Ella map 14 (2026-11-27)
  dial_spot_effect: ['sets_spot', 'moves_spot', 'trail_only', 'nothing'],
};
// Ella map 3 (2026-11-12): the dial_customer_copy codes matchService and the pages read
export const DIAL_COPY_CODES = ['start_at_base', 'start_here', 'no_longer_available', 'choose_this', 'see_whole_map', 'trail_title', 'trail_start', 'moved_to', 'email_map_intro',
  // Ella map 7 (2026-11-17): the /map page
  'map_eyebrow', 'map_title_first', 'map_title_after', 'map_intro', 'first_bag_title', 'here_title', 'why_this_one',
  'steps_title', 'steps_hint', 'see_it', 'make_next_bag', 'closing_line',
  'add_first_bag', 'added_to_cart',
  // Ella map 9 (2026-11-20): the personal text (its frames told_us_*, also_said, asked_for, step_* are read by nothing since Ella map 10)
  'founder_pick', 'lead_title', 'others_title', 'kitchen', 'price_add',
  // Ella map 10 (2026-11-24; unread since Ella map 15, kept)
  'no_support',
  // Ella map 15 (2026-11-27): the card tags and the heading while looking
  'tag_same_family', 'tag_joined_by_step', 'tag_leans_to_spot_family', 'tag_other_direction', 'tag_your_spot', 'steps_title_from',
  // Ella map 12 (2026-11-26): the /map button that opens the coffee's panel
  'more_about',
  // Ella map 13 (2026-11-26): the /map panel's headings
  'where_it_shines', 'roaster_rates', 'roaster_rates_caption', 'roaster_words_title', 'notes_title', 'notes_heading',
  // Ella map 14 (2026-11-27): the walk and the trail
  'looking_at_title', 'back_to_spot', 'trail_moved'];
export const DIAL_PARAMETER_KEYS = [
  // Ella map 15: the family_lean and own_family supports take the opposite direction last
  'dial_step_opposite_last',
  'dial_ring_cut_1', 'dial_ring_cut_2', 'dial_size_cut_1', 'dial_size_cut_2', 'dial_cut_margin_flag',
  'dial_w_ring', 'dial_w_body', 'dial_w_sweet', 'dial_w_lane', 'dial_cap_different',
  'dial_min_grade_rank_first_match', 'dial_min_grade_rank_hop_target',
  'dial_grade_sessions_for_b', 'dial_grade_cuppers_for_b', 'dial_grade_sessions_for_a', 'dial_grade_cuppers_for_a',
  'dial_lean_promotion_n', 'dial_suggest_w_words', 'dial_suggest_w_body', 'dial_suggest_body_cut_light',
  'dial_suggest_body_cut_base', 'dial_suggest_word_pos1', 'dial_suggest_word_later', 'dial_suggest_dark_roast_add',
  'dial_suggest_threshold', 'dial_delta_min_to_mention',
  'dial_size_roaster_cut_1', 'dial_size_roaster_cut_2', // Ella map 5
  'dial_earthy_branch_reworded_on', // Ella map 7
  'dial_quote_family_answers', 'dial_quote_other_answers', 'dial_away_max_points', // Ella map 9 (the last two read by nothing since Ella map 10; the rows stay)
  'dial_step_reuse_answer', // Ella map 10 follow-up (2026-11-25)
  'dial_roaster_rating_max', // Ella map 13 fix (2026-11-26): the top of the roaster's scale on /map
  'dial_spot_reorder_count', 'dial_spot_skip_disliked_lead', 'dial_spot_not_lead_when_looking', // Ella map 14 (2026-11-27)
];

export async function dialMapChecks(runner: pg.Pool | pg.PoolClient): Promise<CatalogIntegrityCheck[]> {
  const versions = (await runner.query<{ id: number; label: string; status: string; is_active: boolean }>(
    `SELECT v.id, v.label, s.code AS status, (v.activated_at IS NOT NULL AND v.retired_at IS NULL) AS is_active
       FROM dial_map_version v JOIN dial_map_version_status s ON s.id = v.status_id`)).rows;
  const active = versions.filter(v => v.is_active);
  const c7 = check(7, 'Ella map: at most one active map version, its status matching its dates',
    [
      ...(active.length > 1 ? [`${active.length} active versions: ${active.map(v => v.label).join(', ')}`] : []),
      ...versions.filter(v => v.is_active !== (v.status === 'active')).map(v => `${v.label}: status ${v.status} but ${v.is_active ? 'active' : 'not active'} by its dates`),
    ],
    active.length ? `one active (${active[0].label})` : 'none active', n => `${n} finding(s)`);

  const gone = (await runner.query<{ coffee_name: string; version_label: string }>(
    `SELECT coffee_name, version_label FROM v_dial_placement WHERE NOT coffee_is_active ORDER BY coffee_name`)).rows;
  const c8 = check(8, "Ella map: every active-version placement's coffee is still active",
    gone.map(g => `${g.coffee_name} (${g.version_label})`), '0 placements on inactive coffees', n => `${n} placement(s) on inactive coffees`);

  const missingSeeds: string[] = [];
  for (const [table, codes] of Object.entries(DIAL_SEED_CODES)) {
    const have = new Set((await runner.query<{ code: string | number }>(`SELECT code FROM ${table}`)).rows.map(r => String(r.code))); // table from the allow-list above (G3.2)
    for (const code of codes) if (!have.has(code)) missingSeeds.push(`${table}.${code}`);
  }
  const extra = (await runner.query<{ finding: string }>(
    `SELECT 'dial_wedge for ' || ca.code AS finding FROM coffee_archetype ca
      WHERE ca.is_archetype AND NOT EXISTS (SELECT 1 FROM dial_wedge w WHERE w.archetype_code = ca.code)
     UNION ALL
     SELECT 'dial_provisional_sample_pattern (empty)' WHERE NOT EXISTS (SELECT 1 FROM dial_provisional_sample_pattern)
     UNION ALL
     SELECT 'dial_dark_roast_level (empty)' WHERE NOT EXISTS (SELECT 1 FROM dial_dark_roast_level)`)).rows.map(r => r.finding);
  const weighted = new Set((await runner.query<{ scale_code: string }>(`SELECT scale_code FROM dial_cupper_scale_weight`)).rows.map(r => r.scale_code));
  for (const s of await listScales(runner)) if (!weighted.has(s.code)) extra.push(`dial_cupper_scale_weight for ${s.code}`);
  // Ella map 2: a delta phrase per reading x direction, and a dial_flag row for every flag code the preview emits
  const more = (await runner.query<{ finding: string }>(
    `SELECT 'dial_delta_phrase for ' || r.code || ' ' || d.code AS finding
       FROM dial_reading r CROSS JOIN dial_delta_direction d
      WHERE NOT EXISTS (SELECT 1 FROM dial_delta_phrase p WHERE p.reading_id = r.id AND p.direction_id = d.id AND p.superseded_at IS NULL)
     UNION ALL
     SELECT DISTINCT 'dial_flag for ' || f.code
       FROM v_dial_placement_preview pv CROSS JOIN LATERAL unnest(pv.flags) AS f(code)
      WHERE NOT EXISTS (SELECT 1 FROM dial_flag df WHERE df.code = f.code)`)).rows.map(r => r.finding);
  extra.push(...more);
  // Ella map 3: every customer sentence the map reads has a current row
  const copyCodes = new Set((await runner.query<{ code: string }>(`SELECT code FROM v_dial_customer_copy`)).rows.map(r => r.code));
  for (const code of DIAL_COPY_CODES) if (!copyCodes.has(code)) extra.push(`dial_customer_copy for ${code}`);
  const c9 = check(9, 'Ella map: every map lookup seed is present', [...missingSeeds, ...extra], '0 missing', n => `${n} missing`);

  const haveKeys = new Set((await getParameters('dial_', runner)).map(r => r.key));
  const c10 = check(10, 'Ella map: every dial_ parameter key is present',
    DIAL_PARAMETER_KEYS.filter(k => !haveKeys.has(k)), `${DIAL_PARAMETER_KEYS.length} keys present`, n => `${n} key(s) missing`);

  // Ella map 3 (B6): spots stranded off the active map, and a surface on the map with no active version.
  // Ella map 14 (Dana 2026-11-27, item 5): a spot set by an order or feedback has no decided
  // version, so the check counts every spot on a coffee not placed in the active version.
  const stranded = (await runner.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM v_customer_match_current WHERE NOT is_in_active_version`)).rows[0].n;
  const surfacesWithoutMap = (await runner.query<{ code: string }>(
    `SELECT code FROM v_dial_surface
      WHERE model_code = 'map' AND NOT EXISTS (SELECT 1 FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL)
      ORDER BY code`)).rows.map(r => `dial_surface ${r.code} is on the map with no active version`);
  const c11 = check(11, 'Ella map: positions stay on the active map; a map surface has an active version',
    [...(stranded ? [`${stranded} spot(s) on a coffee not placed in the active version`] : []), ...surfacesWithoutMap],
    '0 findings', n => `${n} finding(s)`);

  // Ella map 9 (A8): what we say back. A phrase for a fact that is no longer
  // current; a quotable answer of the active quiz with no phrase (it is then
  // never quoted; a current row with is_quoted false counts as covered: never
  // quoted on purpose); a start rule whose lead is not a current shown step
  // from its coffee.
  const orphan = (await runner.query<{ finding: string }>(
    `SELECT sb.source_code || ' ' || sb.fact_code AS finding FROM v_dial_said_back sb
      WHERE sb.is_current AND NOT EXISTS (SELECT 1 FROM v_dial_said_back_fact f WHERE f.source_code = sb.source_code AND f.fact_code = sb.fact_code)
      ORDER BY 1`)).rows.map(r => r.finding);
  const c12 = check(12, 'Ella map: every said-back phrase names a current answer or brew value', orphan, '0 orphan phrases', n => `${n} phrase(s) for no current fact`);
  const unsaid = (await runner.query<{ finding: string }>(
    `SELECT f.context_group || ' ' || f.fact_code AS finding FROM v_dial_said_back_fact f
      WHERE f.source_code = 'quiz_answer' AND f.is_quotable AND f.said_back_id IS NULL ORDER BY 1`)).rows.map(r => r.finding);
  const c13 = check(13, 'Ella map: every quotable answer of the active quiz has a said-back row', unsaid, '0 answers without a row', n => `${n} answer(s) never quoted`);
  const badLead = (await runner.query<{ finding: string }>(
    `SELECT r.family_name || ' #' || r.priority || ': ' || r.coffee_name || ' -> ' || r.lead_to_coffee_name AS finding
       FROM v_dial_start_rule r
      WHERE r.is_current AND r.lead_to_coffee_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM v_dial_step s WHERE s.is_current AND s.is_shown AND s.from_coffee_id = r.coffee_id AND s.to_coffee_id = r.lead_to_coffee_id)
      ORDER BY 1`)).rows.map(r => r.finding);
  const c14 = check(14, "Ella map: every start rule's lead is a current shown step from its first bag", badLead, '0 findings', n => `${n} lead(s) off the steps`);
  // Ella map 10 (A7): a reason-choice code the service does not know (it is
  // skipped at read); a coffee on the active map with no map_line. A quoted
  // phrase with no direction is fine (NULL = argues for none).
  const choiceRows = (await runner.query<{ kind_code: string; code: string; is_active: boolean }>(
    `SELECT kind_code, code, is_active FROM v_dial_reason_choice WHERE is_current ORDER BY kind_order, sort_order, code`)).rows;
  const unknownChoices = choiceRows.filter(r => !(KNOWN_REASON_CHOICES[r.kind_code] ?? []).includes(r.code))
    .map(r => `${r.kind_code} ${r.code}${r.is_active ? '' : ' (off)'}`);
  const c15 = check(15, 'Ella map: every reason choice is one the service knows', unknownChoices,
    `${choiceRows.length} choice row(s), all known`, n => `${n} unknown choice(s), skipped`);
  const noLine = (await runner.query<{ coffee_name: string }>(
    `SELECT p.coffee_name FROM v_dial_placement p JOIN v_dial_coffee_availability av ON av.coffee_id = p.coffee_id
      WHERE av.map_line IS NULL ORDER BY p.coffee_name`)).rows.map(r => r.coffee_name);
  const c16 = check(16, 'Ella map: every coffee on the active map has a map_line', noLine, '0 coffees without one', n => `${n} coffee(s) without a map_line`);
  // Ella map 14 (A, Dana 2026-11-27): what moves a spot. A spot event row whose
  // code the views do not produce, or whose effect the fold does not know (it has
  // no effect); a code the views produce with no current row (that event has no
  // effect); the two rating limits missing or overlapping.
  const spotRows = (await runner.query<{ code: string; effect_code: string; is_active: boolean }>(
    `SELECT code, effect_code, is_active FROM v_dial_spot_event WHERE is_current ORDER BY sort_order, code`)).rows;
  const spotFindings = [
    ...spotRows.filter(r => !(KNOWN_SPOT_EVENTS as readonly string[]).includes(r.code)).map(r => `spot event ${r.code}${r.is_active ? '' : ' (off)'} is not one the views produce`),
    ...spotRows.filter(r => !(KNOWN_SPOT_EFFECTS as readonly string[]).includes(r.effect_code)).map(r => `spot event ${r.code} has an unknown effect ${r.effect_code}`),
    ...KNOWN_SPOT_EVENTS.filter(c => !spotRows.some(r => r.code === c)).map(c => `no current spot event row for ${c}`),
  ];
  const limits = new Map((await getParameters('feedback_', runner)).map(p => [p.key, Number(p.value)]));
  const pos = limits.get('feedback_positive_min_rating');
  const neg = limits.get('feedback_negative_max_rating');
  if (pos === undefined) spotFindings.push('parameter feedback_positive_min_rating is missing');
  if (neg === undefined) spotFindings.push('parameter feedback_negative_max_rating is missing');
  if (pos !== undefined && neg !== undefined && !(neg < pos)) spotFindings.push(`feedback_negative_max_rating (${neg}) is not below feedback_positive_min_rating (${pos})`);
  const c17 = check(17, 'Ella map: every spot event is one the views produce; the rating limits are set and apart', spotFindings,
    `${spotRows.length} spot event row(s), all known; limits ${neg ?? '?'} < ${pos ?? '?'}`, n => `${n} finding(s)`);
  return [c7, c8, c9, c10, c11, c12, c13, c14, c15, c16, c17];
}

// Boot log lines: one summary line, then one line per check with findings,
// naming at most LOG_CAP objects (the full list is in System Health).
export const LOG_CAP = 50;
export function formatDataCatalogLog(report: DataCatalogReport): string[] {
  const c = report.counts;
  const lines = [`[data-catalog] report only: ${c.tables} tables, ${c.views} views, ${c.columns} columns; ` +
    `${report.checks.filter(k => !k.pass).length} of ${report.checks.length} checks with findings`];
  for (const k of report.checks) {
    if (k.pass && !k.actual.startsWith('skipped')) continue;
    const d = k.details ?? [];
    const shown = d.slice(0, LOG_CAP).join(', ');
    lines.push(`[data-catalog] check #${k.id} ${k.name}: ${k.actual}${d.length ? ` — ${shown}${d.length > LOG_CAP ? ` (+${d.length - LOG_CAP} more)` : ''}` : ''}`);
  }
  return lines;
}
