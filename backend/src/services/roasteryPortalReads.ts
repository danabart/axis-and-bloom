// Roastery Portal (2026-10-05) — the read path. Typed reads over the three
// views (v_roastery_portal_coffee / _current_response / _progress), the
// vocabulary bundle the partner page builds every chip group from, and the
// admin-side lists. Writes live in exactly one place:
// services/roasteryPortalService.ts. Nothing here touches the catalog.
//
// Brief: backend/src/features/roastery_portal/CLAUDE_CODE_PROMPT_ROASTERY_PORTAL_1.md

import type { Pool, PoolClient } from 'pg';
import { db } from '../db/client.js';

type Runner = Pool | PoolClient;

export interface LookupOption { value: string; label: string }

export interface PortalDimension {
  dimensionId: number;
  label: string;
  lowLabel: string;
  highLabel: string;
}

export interface PortalArchetype { code: string; label: string; sortOrder: number }

export interface WheelDescriptor { id: string; descriptor: string }
export interface WheelSubcategory { name: string | null; descriptors: WheelDescriptor[] }
export interface WheelCategory { name: string; subcategories: WheelSubcategory[] }

export interface PortalVocabulary {
  process: LookupOption[];
  roastLevel: LookupOption[];
  blendOrSingle: LookupOption[];
  brewMethods: LookupOption[];
  availability: LookupOption[];
  notice: LookupOption[];
  similar: LookupOption[];
  takesIt: LookupOption[];
  roastIntent: LookupOption[];
  blendRotation: LookupOption[];
  caffeine: LookupOption[];
  decafProcess: LookupOption[];
  certification: LookupOption[];
  dimensions: PortalDimension[];
  archetypes: PortalArchetype[];
  wheel: WheelCategory[];
}

// ── Vocabulary (in-process cache, 60s — same posture as catalogReads) ────────
const VOCAB_TTL_MS = 60_000;
let vocabCache: { at: number; value: PortalVocabulary } | null = null;

async function lookup(runner: Runner, category: string): Promise<LookupOption[]> {
  const r = await runner.query<LookupOption>(
    `SELECT value, label FROM lookup_value WHERE category = $1 ORDER BY sort_order, label`,
    [category]
  );
  return r.rows;
}

async function loadVocabulary(runner: Runner): Promise<PortalVocabulary> {
  const [process, roastLevel, blendOrSingle, brewMethods, availability, notice, similar, takesIt,
    roastIntent, blendRotation, caffeine, decafProcess, certification] = await Promise.all([
    lookup(runner, 'process'),
    lookup(runner, 'roast_level'),
    lookup(runner, 'blend_or_single'),
    lookup(runner, 'roastery_portal_brew_method'),
    lookup(runner, 'roastery_portal_availability'),
    lookup(runner, 'roastery_portal_notice'),
    lookup(runner, 'roastery_portal_similar'),
    lookup(runner, 'roastery_portal_takes_it'),
    lookup(runner, 'roastery_portal_roast_intent'),
    lookup(runner, 'roastery_portal_blend_rotation'),
    lookup(runner, 'roastery_portal_caffeine'),
    lookup(runner, 'roastery_portal_decaf_process'),
    lookup(runner, 'roastery_portal_certification'),
  ]);

  const dims = await runner.query<{ dimension_id: number; label: string; low_label: string; high_label: string }>(
    `SELECT dimension_id, label, low_label, high_label
     FROM roastery_portal_dimension WHERE is_active ORDER BY sort_order, dimension_id`
  );

  const arch = await runner.query<{ code: string; label: string; sort_order: number }>(
    `SELECT code, label, sort_order FROM v_coffee_archetype ORDER BY sort_order`
  );

  // The wheel: active cupping_note rows, defects ('Other') excluded, grouped
  // category -> subcategory -> descriptor. A null subcategory (e.g. Floral /
  // Black Tea) is its own un-named group, kept in place.
  const notes = await runner.query<{ id: string; wheel_category: string; wheel_subcategory: string | null; descriptor: string }>(
    `SELECT id, wheel_category, wheel_subcategory, descriptor
     FROM cupping_note
     WHERE is_active AND wheel_category <> 'Other'
     ORDER BY wheel_category, wheel_subcategory NULLS LAST, descriptor`
  );
  const wheel: WheelCategory[] = [];
  for (const n of notes.rows) {
    let cat = wheel.find(c => c.name === n.wheel_category);
    if (!cat) { cat = { name: n.wheel_category, subcategories: [] }; wheel.push(cat); }
    let sub = cat.subcategories.find(s => s.name === n.wheel_subcategory);
    if (!sub) { sub = { name: n.wheel_subcategory, descriptors: [] }; cat.subcategories.push(sub); }
    sub.descriptors.push({ id: n.id, descriptor: n.descriptor });
  }

  return {
    process, roastLevel, blendOrSingle, brewMethods, availability, notice, similar, takesIt,
    roastIntent, blendRotation, caffeine, decafProcess, certification,
    dimensions: dims.rows.map(d => ({ dimensionId: d.dimension_id, label: d.label, lowLabel: d.low_label, highLabel: d.high_label })),
    archetypes: arch.rows.map(a => ({ code: a.code, label: a.label, sortOrder: a.sort_order })),
    wheel,
  };
}

/** `fresh: true` bypasses the cache — used by the lineup editors (rare) so a
 * vocabulary change is never validated against a stale list. Always runs on the
 * pool (parallel queries), never on a transaction client. */
export async function getVocabulary(opts: { fresh?: boolean } = {}): Promise<PortalVocabulary> {
  if (!opts.fresh && vocabCache && Date.now() - vocabCache.at < VOCAB_TTL_MS) return vocabCache.value;
  const value = await loadVocabulary(db);
  vocabCache = { at: Date.now(), value };
  return value;
}

// ── Link / roastery ──────────────────────────────────────────────────────────
export interface PortalLinkContext {
  linkId: string;
  roasterId: string;
  roasteryName: string;
  contactName: string | null;
  contactEmail: string | null;
}

/** The one gate for the whole partner surface: an unknown OR revoked token
 * both resolve to null, so callers can answer them identically. */
export async function getActiveLinkByToken(token: string): Promise<PortalLinkContext | null> {
  if (typeof token !== 'string' || token.length < 32 || token.length > 200) return null;
  const r = await db.query(
    `SELECT l.id, l.roaster_id, r.name AS roaster_name, l.contact_name, l.contact_email
     FROM roastery_portal_link l JOIN roaster r ON r.id = l.roaster_id
     WHERE l.token = $1 AND l.revoked_at IS NULL`,
    [token]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    linkId: row.id, roasterId: row.roaster_id, roasteryName: row.roaster_name,
    contactName: row.contact_name, contactEmail: row.contact_email,
  };
}

export async function getRespondent(roasterId: string, respondentId: string, runner: Runner = db) {
  const r = await runner.query(
    `SELECT id, name, email FROM roastery_portal_respondent WHERE id = $1 AND roaster_id = $2`,
    [respondentId, roasterId]
  );
  return r.rows[0] as { id: string; name: string; email: string } | undefined;
}

// ── Lineup ───────────────────────────────────────────────────────────────────
export interface LineupRow {
  portalCoffeeId: string;
  name: string;
  coffeeId: number | null;
  origin: string | null;
  processValues: string[];
  roastLevel: string | null;
  blendOrSingle: string | null;
  isDecaf: boolean | null;
  prefillSource: string | null;
  addedBy: string;
  sortOrder: number;
  isActive: boolean;
  state: 'not_started' | 'in_progress' | 'submitted';
  hasOpenDraft: boolean;
  sectionsAnswered: number;
  currentVersion: number | null;
  lastSavedAt: string | null;
  lastSavedByName: string | null;
  submittedAt: string | null;
  submittedByName: string | null;
  submittedVersionCount: number;
  hasUnmappedNotes: boolean;
}

function mapLineupRow(r: any): LineupRow {
  return {
    portalCoffeeId: r.portal_coffee_id, name: r.name, coffeeId: r.coffee_id,
    origin: r.origin, processValues: r.process_values ?? [], roastLevel: r.roast_level,
    blendOrSingle: r.blend_or_single, isDecaf: r.is_decaf, prefillSource: r.prefill_source,
    addedBy: r.added_by, sortOrder: r.sort_order, isActive: r.is_active,
    state: r.state, hasOpenDraft: r.has_open_draft, sectionsAnswered: r.sections_answered,
    currentVersion: r.current_version, lastSavedAt: r.last_saved_at, lastSavedByName: r.last_saved_by_name,
    submittedAt: r.submitted_at, submittedByName: r.submitted_by_name,
    submittedVersionCount: r.submitted_version_count, hasUnmappedNotes: r.has_unmapped_notes,
  };
}

const LINEUP_SELECT = `
  SELECT c.portal_coffee_id, c.name, c.coffee_id, c.origin, c.process_values, c.roast_level,
         c.blend_or_single, c.is_decaf, c.prefill_source, c.added_by, c.sort_order, c.is_active,
         p.state, p.has_open_draft, p.sections_answered, p.current_version, p.last_saved_at,
         p.last_saved_by_name, p.submitted_at, p.submitted_by_name, p.submitted_version_count,
         p.has_unmapped_notes
  FROM v_roastery_portal_coffee c
  JOIN v_roastery_portal_progress p ON p.portal_coffee_id = c.portal_coffee_id`;

export async function getLineup(roasterId: string, opts: { includeInactive?: boolean } = {}, runner: Runner = db): Promise<LineupRow[]> {
  const r = await runner.query(
    `${LINEUP_SELECT}
     WHERE c.roaster_id = $1 ${opts.includeInactive ? '' : 'AND c.is_active'}
     ORDER BY c.is_active DESC, c.sort_order, c.name`,
    [roasterId]
  );
  return r.rows.map(mapLineupRow);
}

/** One lineup coffee, scoped to a roastery. null when it belongs to another
 * roastery (callers answer that exactly like "not found"). */
export async function getLineupCoffee(roasterId: string, portalCoffeeId: string, runner: Runner = db): Promise<LineupRow | null> {
  const r = await runner.query(
    `${LINEUP_SELECT} WHERE c.roaster_id = $1 AND c.portal_coffee_id = $2`,
    [roasterId, portalCoffeeId]
  );
  return r.rows[0] ? mapLineupRow(r.rows[0]) : null;
}

// ── A response (one version) with its three child sets ───────────────────────
export interface ResponseNote { rank: number; roasterWords: string; cuppingNoteId: string | null; descriptor: string | null; wheelCategory: string | null }

export interface PortalResponse {
  id: string;
  portalCoffeeId: string;
  version: number;
  status: 'draft' | 'submitted';
  origin: string | null;
  processValues: string[];
  roastLevel: string | null;
  blendOrSingle: string | null;
  isDecaf: boolean | null;
  proposedArchetype: string | null;
  dominantDimensionId: number | null;
  takesIt: string | null;
  brewNotes: string | null;
  availability: string | null;
  typicalNotice: string | null;
  expectedAvailability: string | null;
  similarWhenOut: string | null;
  closestCousinPortalCoffeeId: string | null;
  whatChanges: string | null;
  anythingElse: string | null;
  additivesPresent: boolean | null;
  additivesDetail: string | null;
  roastIntent: string | null;
  blendComponents: string | null;
  blendRotation: string | null;
  /** The effective caffeine answer: the new column, else derived from the deprecated is_decaf (by the view). */
  caffeineLevel: string | null;
  decafProcess: string | null;
  certifications: string[];
  lastSavedByName: string | null;
  lastSavedByRespondentId: string | null;
  submittedByName: string | null;
  submittedByRespondentId: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  notes: ResponseNote[];
  dimensions: Record<string, number>;
  bestBrew: string | null;
  alsoGoodBrews: string[];
}

async function hydrateResponse(row: any, runner: Runner): Promise<PortalResponse> {
  const [notes, dims, brew] = await Promise.all([
    runner.query(
      `SELECT n.rank, n.roaster_words, n.cupping_note_id, cn.descriptor, cn.wheel_category
       FROM roastery_portal_response_note n
       LEFT JOIN cupping_note cn ON cn.id = n.cupping_note_id
       WHERE n.response_id = $1 ORDER BY n.rank`, [row.id]),
    runner.query(`SELECT dimension_id, value FROM roastery_portal_response_dimension WHERE response_id = $1`, [row.id]),
    runner.query(`SELECT brew_method, role FROM roastery_portal_response_brew WHERE response_id = $1 ORDER BY brew_method`, [row.id]),
  ]);
  const names = await runner.query(
    `SELECT id, name FROM roastery_portal_respondent WHERE id = ANY($1::uuid[])`,
    [[row.last_saved_by_respondent_id, row.submitted_by_respondent_id].filter(Boolean)]
  );
  const nameOf = (id: string | null) => (id ? names.rows.find((n: any) => n.id === id)?.name ?? null : null);
  return {
    id: row.id, portalCoffeeId: row.portal_coffee_id, version: row.version, status: row.status,
    origin: row.origin, processValues: row.process_values ?? [], roastLevel: row.roast_level,
    blendOrSingle: row.blend_or_single, isDecaf: row.is_decaf, proposedArchetype: row.proposed_archetype,
    dominantDimensionId: row.dominant_dimension_id, takesIt: row.takes_it, brewNotes: row.brew_notes,
    availability: row.availability, typicalNotice: row.typical_notice, expectedAvailability: row.expected_availability,
    similarWhenOut: row.similar_when_out, closestCousinPortalCoffeeId: row.closest_cousin_portal_coffee_id,
    whatChanges: row.what_changes, anythingElse: row.anything_else,
    additivesPresent: row.additives_present, additivesDetail: row.additives_detail, roastIntent: row.roast_intent,
    blendComponents: row.blend_components, blendRotation: row.blend_rotation, caffeineLevel: row.caffeine_level,
    decafProcess: row.decaf_process, certifications: row.certifications ?? [],
    lastSavedByName: nameOf(row.last_saved_by_respondent_id), lastSavedByRespondentId: row.last_saved_by_respondent_id,
    submittedByName: nameOf(row.submitted_by_respondent_id), submittedByRespondentId: row.submitted_by_respondent_id,
    createdAt: row.created_at, updatedAt: row.updated_at, submittedAt: row.submitted_at,
    notes: notes.rows.map((n: any) => ({
      rank: n.rank, roasterWords: n.roaster_words, cuppingNoteId: n.cupping_note_id,
      descriptor: n.descriptor, wheelCategory: n.wheel_category,
    })),
    dimensions: Object.fromEntries(dims.rows.map((d: any) => [String(d.dimension_id), d.value])),
    bestBrew: brew.rows.find((b: any) => b.role === 'best')?.brew_method ?? null,
    alsoGoodBrews: brew.rows.filter((b: any) => b.role === 'also_good').map((b: any) => b.brew_method),
  };
}

/** The open draft if one exists, else the latest submitted version. */
export async function getCurrentResponse(portalCoffeeId: string, runner: Runner = db): Promise<PortalResponse | null> {
  const r = await runner.query(`SELECT * FROM v_roastery_portal_current_response WHERE portal_coffee_id = $1`, [portalCoffeeId]);
  return r.rows[0] ? hydrateResponse(r.rows[0], runner) : null;
}

export async function getResponseById(responseId: string, runner: Runner = db): Promise<PortalResponse | null> {
  const r = await runner.query(`SELECT * FROM v_roastery_portal_response WHERE id = $1`, [responseId]);
  return r.rows[0] ? hydrateResponse(r.rows[0], runner) : null;
}

export interface ResponseVersionSummary {
  id: string; version: number; status: 'draft' | 'submitted';
  submittedAt: string | null; submittedByName: string | null; updatedAt: string;
}

export async function listResponseVersions(portalCoffeeId: string, runner: Runner = db): Promise<ResponseVersionSummary[]> {
  const r = await runner.query(
    `SELECT r.id, r.version, r.status, r.submitted_at, r.updated_at, s.name AS submitted_by_name
     FROM roastery_portal_response r
     LEFT JOIN roastery_portal_respondent s ON s.id = r.submitted_by_respondent_id
     WHERE r.portal_coffee_id = $1 ORDER BY r.version DESC`,
    [portalCoffeeId]
  );
  return r.rows.map((x: any) => ({
    id: x.id, version: x.version, status: x.status, submittedAt: x.submitted_at,
    submittedByName: x.submitted_by_name, updatedAt: x.updated_at,
  }));
}

// ── Lineup-wide answers ──────────────────────────────────────────────────────
export interface LineupResponse {
  id: string;
  version: number;
  status: 'draft' | 'submitted';
  typicalNotice: string | null;
  similarWhenOut: string | null;
  anythingElse: string | null;
  lastSavedByName: string | null;
  submittedByName: string | null;
  updatedAt: string;
  submittedAt: string | null;
  /** "Which of these do you sell most?": up to three of the roastery's own lineup coffees, in order. */
  bestSellers: { portalCoffeeId: string; name: string; rank: number }[];
}

function mapLineupResponse(x: any): LineupResponse {
  return {
    id: x.id, version: x.version, status: x.status, typicalNotice: x.typical_notice,
    similarWhenOut: x.similar_when_out, anythingElse: x.anything_else,
    lastSavedByName: x.last_saved_by_name, submittedByName: x.submitted_by_name,
    updatedAt: x.updated_at, submittedAt: x.submitted_at, bestSellers: [],
  };
}

async function withBestSellers(list: LineupResponse[], runner: Runner): Promise<LineupResponse[]> {
  if (list.length === 0) return list;
  const r = await runner.query(
    `SELECT b.lineup_response_id, b.portal_coffee_id, b.rank, pc.name
     FROM roastery_portal_lineup_response_best_seller b JOIN roastery_portal_coffee pc ON pc.id = b.portal_coffee_id
     WHERE b.lineup_response_id = ANY($1::uuid[]) ORDER BY b.rank`,
    [list.map(l => l.id)]
  );
  for (const l of list) l.bestSellers = r.rows.filter((x: any) => x.lineup_response_id === l.id).map((x: any) => ({ portalCoffeeId: x.portal_coffee_id, name: x.name, rank: x.rank }));
  return list;
}

const LINEUP_RESPONSE_SELECT = `
  SELECT lr.*, sv.name AS last_saved_by_name, sb.name AS submitted_by_name
  FROM roastery_portal_lineup_response lr
  LEFT JOIN roastery_portal_respondent sv ON sv.id = lr.last_saved_by_respondent_id
  LEFT JOIN roastery_portal_respondent sb ON sb.id = lr.submitted_by_respondent_id`;

/** The open draft if one exists, else the latest submitted version. */
export async function getCurrentLineupResponse(roasterId: string, runner: Runner = db): Promise<LineupResponse | null> {
  const r = await runner.query(
    `SELECT lr.*, sv.name AS last_saved_by_name, sb.name AS submitted_by_name
     FROM v_roastery_portal_lineup_current_response lr
     LEFT JOIN roastery_portal_respondent sv ON sv.id = lr.last_saved_by_respondent_id
     LEFT JOIN roastery_portal_respondent sb ON sb.id = lr.submitted_by_respondent_id
     WHERE lr.roaster_id = $1`,
    [roasterId]
  );
  return r.rows[0] ? (await withBestSellers([mapLineupResponse(r.rows[0])], runner))[0] : null;
}

export async function listLineupResponseVersions(roasterId: string, runner: Runner = db): Promise<LineupResponse[]> {
  const r = await runner.query(`${LINEUP_RESPONSE_SELECT} WHERE lr.roaster_id = $1 ORDER BY lr.version DESC`, [roasterId]);
  return withBestSellers(r.rows.map(mapLineupResponse), runner);
}

// ── Admin: roasteries, links ─────────────────────────────────────────────────
export interface AdminRoasterySummary {
  roasterId: string;
  name: string;
  isActive: boolean;
  activeLinkCount: number;
  lastLinkOpenedAt: string | null;
  coffeesTotal: number;
  coffeesSubmitted: number;
  lastActivityAt: string | null;
}

export async function listRoasteriesWithProgress(opts: { includeInactive?: boolean } = {}): Promise<AdminRoasterySummary[]> {
  const r = await db.query(
    `SELECT ro.id, ro.name, ro.is_active,
            (SELECT count(*) FROM roastery_portal_link l WHERE l.roaster_id = ro.id AND l.revoked_at IS NULL)::int AS active_link_count,
            (SELECT max(l.last_opened_at) FROM roastery_portal_link l WHERE l.roaster_id = ro.id) AS last_link_opened_at,
            (SELECT count(*) FROM v_roastery_portal_progress p WHERE p.roaster_id = ro.id AND p.is_active)::int AS coffees_total,
            (SELECT count(*) FROM v_roastery_portal_progress p WHERE p.roaster_id = ro.id AND p.is_active AND p.state = 'submitted')::int AS coffees_submitted,
            GREATEST(
              (SELECT max(p.last_saved_at) FROM v_roastery_portal_progress p WHERE p.roaster_id = ro.id),
              (SELECT max(p.submitted_at) FROM v_roastery_portal_progress p WHERE p.roaster_id = ro.id),
              (SELECT max(lr.updated_at) FROM roastery_portal_lineup_response lr WHERE lr.roaster_id = ro.id),
              (SELECT max(l.last_opened_at) FROM roastery_portal_link l WHERE l.roaster_id = ro.id)
            ) AS last_activity_at
     FROM roaster ro
     WHERE ${opts.includeInactive ? 'true' : 'ro.is_active'}
     ORDER BY ro.is_active DESC, ro.name`
  );
  return r.rows.map((x: any) => ({
    roasterId: x.id, name: x.name, isActive: x.is_active, activeLinkCount: x.active_link_count,
    lastLinkOpenedAt: x.last_link_opened_at, coffeesTotal: x.coffees_total,
    coffeesSubmitted: x.coffees_submitted, lastActivityAt: x.last_activity_at,
  }));
}

export interface AdminLinkRow {
  id: string; roasterId: string; token: string; contactName: string | null; contactEmail: string | null;
  createdAt: string; lastOpenedAt: string | null; revokedAt: string | null;
}

export async function listLinks(roasterId: string): Promise<AdminLinkRow[]> {
  const r = await db.query(
    `SELECT id, roaster_id, token, contact_name, contact_email, created_at, last_opened_at, revoked_at
     FROM roastery_portal_link WHERE roaster_id = $1 ORDER BY created_at DESC`,
    [roasterId]
  );
  return r.rows.map((x: any) => ({
    id: x.id, roasterId: x.roaster_id, token: x.token, contactName: x.contact_name, contactEmail: x.contact_email,
    createdAt: x.created_at, lastOpenedAt: x.last_opened_at, revokedAt: x.revoked_at,
  }));
}

export async function getRoasterBasics(roasterId: string): Promise<{ id: string; name: string; isActive: boolean } | null> {
  const r = await db.query(`SELECT id, name, is_active FROM roaster WHERE id = $1`, [roasterId]);
  return r.rows[0] ? { id: r.rows[0].id, name: r.rows[0].name, isActive: r.rows[0].is_active } : null;
}

/** Read-only: the roastery's own catalog coffees, for the "link to a catalog
 * coffee" picker. */
export async function listCatalogCoffeesForRoaster(roasterId: string): Promise<{ id: number; name: string; isActive: boolean }[]> {
  const r = await db.query(
    `SELECT id, name, is_active FROM coffees WHERE roaster_id = $1 ORDER BY is_active DESC, name`,
    [roasterId]
  );
  return r.rows.map((x: any) => ({ id: x.id, name: x.name, isActive: x.is_active }));
}


// ═════════════════════════════════════════════════════════════════════════════
// Part 2 (2026-10-05): accepting submitted answers into the catalog. Everything
// below is read-only. The write path is roasteryPortalService.acceptResponse,
// which goes through catalogService. Portal data is evidence; catalog data is
// what Dana decided.
// ═════════════════════════════════════════════════════════════════════════════

/** lowercased, trimmed, inner whitespace collapsed: the key of a remembered mapping. */
export function normalizeWords(words: string): string {
  return words.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ── Admin lineup (acceptance state + the dominant-dimension marker) ──────────
export interface AdminLineupRow extends LineupRow {
  acceptedVersion: number | null;
  acceptedAt: string | null;
  changedSinceAccept: boolean;
  latestSubmittedVersion: number | null;
  roasterDimensionLabel: string | null;
  ourDimensionName: string | null;
  dimensionMatches: boolean | null;
  /** Part 3, display only: from the latest SUBMITTED version. Never a label or an ingredients statement. */
  additivesPresent: boolean;
  additivesDetail: string | null;
  blendRecipeChanges: boolean;
}

/** The partner page's lineup rows must not carry acceptance state, so the admin
 * gets its own read (the public getLineup is unchanged). */
export async function getAdminLineup(roasterId: string, runner: Runner = db): Promise<AdminLineupRow[]> {
  const base = await getLineup(roasterId, { includeInactive: true }, runner);
  if (base.length === 0) return [];
  const ids = base.map(b => b.portalCoffeeId);
  const extra = await runner.query(
    `SELECT p.portal_coffee_id, p.accepted_version, p.accepted_at, p.changed_since_accept, p.latest_submitted_version,
            h.dominant_dimension_label, m.our_dimension_name, m.matches,
            p.additives_present, p.additives_detail, p.blend_recipe_changes
     FROM v_roastery_portal_progress p
     JOIN v_roastery_portal_coffee c ON c.portal_coffee_id = p.portal_coffee_id
     LEFT JOIN v_roastery_portal_coffee_hint h ON h.coffee_id = c.coffee_id AND h.portal_coffee_id = p.portal_coffee_id
     LEFT JOIN v_roastery_portal_dimension_match m ON m.coffee_id = h.coffee_id
     WHERE p.portal_coffee_id = ANY($1::uuid[])`,
    [ids]
  );
  const byId = new Map<string, any>(extra.rows.map((r: any) => [r.portal_coffee_id, r]));
  return base.map(b => {
    const e = byId.get(b.portalCoffeeId);
    return {
      ...b,
      acceptedVersion: e?.accepted_version ?? null,
      acceptedAt: e?.accepted_at ?? null,
      changedSinceAccept: e?.changed_since_accept ?? false,
      latestSubmittedVersion: e?.latest_submitted_version ?? null,
      roasterDimensionLabel: e?.dominant_dimension_label ?? null,
      ourDimensionName: e?.our_dimension_name ?? null,
      dimensionMatches: e?.matches ?? null,
      additivesPresent: e?.additives_present ?? false,
      additivesDetail: e?.additives_detail ?? null,
      blendRecipeChanges: e?.blend_recipe_changes === true,
    };
  });
}

// ── Hints ────────────────────────────────────────────────────────────────────
export interface CoffeeHint {
  coffeeId: number;
  portalCoffeeId: string;
  responseId: string;
  version: number;
  submittedAt: string;
  respondentName: string | null;
  proposedArchetype: string | null;
  dominantDimensionId: number | null;
  dominantDimensionLabel: string | null;
  dimensions: { dimension_id: number; label: string; low_label: string; high_label: string; value: number }[];
  match: DimensionMatch | null;
}

export interface DimensionMatch {
  roasterDimensionId: number | null;
  roasterDimensionName: string | null;
  ourDimensionId: number | null;
  ourDimensionName: string | null;
  ourSource: 'slot' | 'match_archetype' | null;
  ourSlotName: string | null;
  matches: boolean | null;
  range: { min: number; max: number; nScores: number; basis: string | null } | null;
}

function mapMatch(m: any): DimensionMatch {
  return {
    roasterDimensionId: m.roaster_dimension_id, roasterDimensionName: m.roaster_dimension_name,
    ourDimensionId: m.our_dimension_id, ourDimensionName: m.our_dimension_name, ourSource: m.our_source,
    ourSlotName: m.our_slot_name, matches: m.matches,
    range: m.range_min != null ? { min: Number(m.range_min), max: Number(m.range_max), nScores: Number(m.range_n_scores), basis: m.range_basis } : null,
  };
}

export async function getCoffeeHint(coffeeId: number, opts: { slotId?: number } = {}, runner: Runner = db): Promise<(CoffeeHint & { matchForSlot: DimensionMatch | null }) | null> {
  const h = await runner.query(`SELECT * FROM v_roastery_portal_coffee_hint WHERE coffee_id = $1`, [coffeeId]);
  const row = h.rows[0];
  if (!row) return null;
  const m = await runner.query(`SELECT * FROM v_roastery_portal_dimension_match WHERE coffee_id = $1`, [coffeeId]);
  let matchForSlot: DimensionMatch | null = null;
  if (opts.slotId !== undefined) {
    // Against the slot being chosen: its own dimension, else its archetype's dominant one
    // (the same rule the placement guardrail uses). The comparison is the one SQL function.
    const sm = await runner.query(
      `SELECT s.name AS slot_name, COALESCE(s.dimension_id, a.dominant_dimension_id) AS our_dim, od.name AS our_name,
              roastery_portal_dimension_matches($2::int, COALESCE(s.dimension_id, a.dominant_dimension_id)) AS matches
       FROM coffee_dial_slot s
       JOIN coffee_archetype a ON a.code = s.archetype
       LEFT JOIN coffee_dimensions od ON od.id = COALESCE(s.dimension_id, a.dominant_dimension_id)
       WHERE s.id = $1`,
      [opts.slotId, row.dominant_dimension_id]
    );
    const r = sm.rows[0];
    if (r) {
      matchForSlot = {
        roasterDimensionId: row.dominant_dimension_id, roasterDimensionName: row.dominant_dimension_label,
        ourDimensionId: r.our_dim, ourDimensionName: r.our_name, ourSource: 'slot', ourSlotName: r.slot_name,
        matches: r.matches, range: m.rows[0] ? mapMatch(m.rows[0]).range : null,
      };
    }
  }
  return {
    coffeeId: row.coffee_id, portalCoffeeId: row.portal_coffee_id, responseId: row.response_id, version: row.version,
    submittedAt: row.submitted_at, respondentName: row.respondent_name, proposedArchetype: row.proposed_archetype,
    dominantDimensionId: row.dominant_dimension_id, dominantDimensionLabel: row.dominant_dimension_label,
    dimensions: row.dimensions ?? [], match: m.rows[0] ? mapMatch(m.rows[0]) : null, matchForSlot,
  };
}

export interface CousinHint {
  responseId: string; version: number; portalCoffeeId: string; coffeeName: string; coffeeId: number | null;
  dominantDimensionLabel: string | null; cousinPortalCoffeeId: string; cousinName: string; cousinCoffeeId: number | null;
  cousinDominantDimensionLabel: string | null; whatChanges: string | null; submittedAt: string;
}

export async function listCousinHints(opts: { bothInCatalog?: boolean } = {}, runner: Runner = db): Promise<CousinHint[]> {
  const r = await runner.query(
    `SELECT * FROM v_roastery_portal_cousin_hint
     ${opts.bothInCatalog ? 'WHERE coffee_id IS NOT NULL AND cousin_coffee_id IS NOT NULL' : ''}
     ORDER BY submitted_at DESC`
  );
  return r.rows.map((x: any) => ({
    responseId: x.response_id, version: x.version, portalCoffeeId: x.portal_coffee_id, coffeeName: x.coffee_name,
    coffeeId: x.coffee_id, dominantDimensionLabel: x.dominant_dimension_label, cousinPortalCoffeeId: x.cousin_portal_coffee_id,
    cousinName: x.cousin_name, cousinCoffeeId: x.cousin_coffee_id, cousinDominantDimensionLabel: x.cousin_dominant_dimension_label,
    whatChanges: x.what_changes, submittedAt: x.submitted_at,
  }));
}

// ── Remembered mappings ──────────────────────────────────────────────────────
export interface NoteMapping {
  id: string; normalizedWords: string; cuppingNoteId: string; descriptor: string; wheelCategory: string;
  createdAt: string; supersededAt: string | null;
}

export async function listNoteMappings(opts: { includeSuperseded?: boolean } = {}, runner: Runner = db): Promise<NoteMapping[]> {
  const r = await runner.query(
    `SELECT m.id, m.normalized_words, m.cupping_note_id, cn.descriptor, cn.wheel_category, m.created_at, m.superseded_at
     FROM roastery_portal_note_mapping m JOIN cupping_note cn ON cn.id = m.cupping_note_id
     ${opts.includeSuperseded ? '' : 'WHERE m.superseded_at IS NULL'}
     ORDER BY m.normalized_words, m.created_at DESC`
  );
  return r.rows.map((x: any) => ({
    id: x.id, normalizedWords: x.normalized_words, cuppingNoteId: x.cupping_note_id, descriptor: x.descriptor,
    wheelCategory: x.wheel_category, createdAt: x.created_at, supersededAt: x.superseded_at,
  }));
}

/** Active remembered terms for a set of words (any roastery). Suggestions only. */
export async function getMappingSuggestions(words: string[], runner: Runner = db): Promise<Map<string, { cuppingNoteId: string; descriptor: string; wheelCategory: string }>> {
  const keys = [...new Set(words.map(normalizeWords).filter(Boolean))];
  const out = new Map<string, { cuppingNoteId: string; descriptor: string; wheelCategory: string }>();
  if (!keys.length) return out;
  const r = await runner.query(
    `SELECT m.normalized_words, m.cupping_note_id, cn.descriptor, cn.wheel_category
     FROM roastery_portal_note_mapping m JOIN cupping_note cn ON cn.id = m.cupping_note_id AND cn.is_active
     WHERE m.superseded_at IS NULL AND m.normalized_words = ANY($1::text[])`,
    [keys]
  );
  for (const x of r.rows) out.set(x.normalized_words, { cuppingNoteId: x.cupping_note_id, descriptor: x.descriptor, wheelCategory: x.wheel_category });
  return out;
}

// ── Acceptance log ───────────────────────────────────────────────────────────
export interface AcceptanceRow {
  id: string; responseId: string; version: number; portalCoffeeId: string; coffeeId: number; createdCoffee: boolean;
  applied: unknown; acceptedAt: string;
}

export async function listAcceptances(portalCoffeeId: string, runner: Runner = db): Promise<AcceptanceRow[]> {
  const r = await runner.query(
    `SELECT a.id, a.response_id, r.version, a.portal_coffee_id, a.coffee_id, a.created_coffee, a.applied, a.accepted_at
     FROM roastery_portal_acceptance a JOIN roastery_portal_response r ON r.id = a.response_id
     WHERE a.portal_coffee_id = $1 ORDER BY a.accepted_at DESC`,
    [portalCoffeeId]
  );
  return r.rows.map((x: any) => ({
    id: x.id, responseId: x.response_id, version: x.version, portalCoffeeId: x.portal_coffee_id, coffeeId: x.coffee_id,
    createdCoffee: x.created_coffee, applied: x.applied, acceptedAt: x.accepted_at,
  }));
}

// ── The acceptance preview ───────────────────────────────────────────────────
export interface PreviewNote {
  rank: number;
  roasterWords: string;
  roasterPick: { cuppingNoteId: string; descriptor: string; wheelCategory: string } | null;
  suggestion: { cuppingNoteId: string; descriptor: string; wheelCategory: string } | null;
  /** What the form presets: the roaster's pick, else the remembered suggestion, else nothing. */
  defaultCuppingNoteId: string | null;
  defaultFromSuggestion: boolean;
  alreadyActive: boolean;
}

export interface PreviewBasic {
  field: 'origin' | 'process' | 'roastLevel' | 'blendOrSingle' | 'caffeine';
  catalogValue: string | null;
  roasterValue: string | null;
  roasterValues: string[];
  differs: boolean;
  /** caffeine only: false when the matching category code does not exist (then it is display only). */
  applicable?: boolean;
}

export interface AcceptancePreview {
  response: { id: string; portalCoffeeId: string; version: number; submittedAt: string | null; submittedByName: string | null; roasteryName: string };
  coffee: {
    exists: boolean; coffeeId: number | null; name: string; roasterId: string;
    willCreate: { name: string; roasterName: string } | null;
  };
  visibleToCustomers: boolean;
  basics: PreviewBasic[];
  notes: PreviewNote[];
  currentActive: { descriptorId: number; cuppingNoteId: string; descriptor: string; wheelCategory: string; notes: string | null }[];
  retiring: { descriptorId: number; cuppingNoteId: string; descriptor: string }[];
  /** Part 3: everything else the roaster added, display only. Nothing here is ever applied. */
  extras: {
    roastIntent: string | null; caffeineLevel: string | null; decafProcess: string | null; certifications: string[];
    additivesPresent: boolean | null; additivesDetail: string | null;
    blendComponents: string | null; blendRotation: string | null; blendRecipeChanges: boolean;
    /** "Contains added ingredients: ..." when the roaster said something is added; null otherwise. */
    additivesNotice: string | null;
  };
  hints: {
    proposedArchetype: string | null;
    dimensions: { dimension_id: number; label: string; low_label: string; high_label: string; value: number }[];
    cousin: { name: string; coffeeId: number | null; whatChanges: string | null } | null;
    dominant: DimensionMatch & { roasterLabel: string | null };
  };
}

export async function previewAcceptance(responseId: string, runner: Runner = db): Promise<AcceptancePreview | null> {
  const rr = await runner.query(
    `SELECT r.*, pc.roaster_id, pc.name AS coffee_name, pc.coffee_id, pc.is_active AS lineup_active, ro.name AS roaster_name,
            sub.name AS submitted_by_name
     FROM roastery_portal_response r
     JOIN roastery_portal_coffee pc ON pc.id = r.portal_coffee_id
     JOIN roaster ro ON ro.id = pc.roaster_id
     LEFT JOIN roastery_portal_respondent sub ON sub.id = r.submitted_by_respondent_id
     WHERE r.id = $1`,
    [responseId]
  );
  const row = rr.rows[0];
  if (!row || row.status !== 'submitted') return null;
  const response = await getResponseById(responseId, runner);
  if (!response) return null;

  const coffeeId: number | null = row.coffee_id;
  let catalog: any = null;
  let visible = false;
  let currentActive: AcceptancePreview['currentActive'] = [];
  if (coffeeId !== null) {
    catalog = (await runner.query(`SELECT name, origin, process, roast_level, blend_or_single, category_codes FROM v_coffee WHERE id = $1`, [coffeeId])).rows[0] ?? null;
    visible = (await runner.query(`SELECT is_visible FROM v_coffee_visibility_summary WHERE coffee_id = $1`, [coffeeId])).rows[0]?.is_visible === true;
    currentActive = (await runner.query(
      `SELECT d.id, d.cupping_note_id, cn.descriptor, cn.wheel_category, d.notes
       FROM roastery_coffee_descriptors d JOIN cupping_note cn ON cn.id = d.cupping_note_id
       WHERE d.coffee_id = $1 AND d.is_active ORDER BY d.id`, [coffeeId]
    )).rows.map((d: any) => ({ descriptorId: d.id, cuppingNoteId: d.cupping_note_id, descriptor: d.descriptor, wheelCategory: d.wheel_category, notes: d.notes }));
  }

  const basics: PreviewBasic[] = [
    { field: 'origin', catalogValue: catalog?.origin ?? null, roasterValue: response.origin, roasterValues: [], differs: false },
    { field: 'process', catalogValue: catalog?.process ?? null, roasterValue: response.processValues[0] ?? null, roasterValues: response.processValues, differs: false },
    { field: 'roastLevel', catalogValue: catalog?.roast_level ?? null, roasterValue: response.roastLevel, roasterValues: [], differs: false },
    { field: 'blendOrSingle', catalogValue: catalog?.blend_or_single ?? null, roasterValue: response.blendOrSingle, roasterValues: [], differs: false },
  ];
  // Caffeine (part 3): "Category: Decaf" / "Category: Half-caff", applied through the existing category codes
  // only. The roaster saying Regular (or nothing) offers nothing to apply; a missing category code makes it display only.
  const codes = new Set((await runner.query(`SELECT code FROM coffee_category`)).rows.map((x: any) => x.code as string));
  const caffeineCode = response.caffeineLevel === 'decaf' ? 'decaf' : response.caffeineLevel === 'half_caff' ? 'half_caf' : null;
  const currentCaffeineCode = (catalog?.category_codes as string[] | undefined)?.find(c => c === 'decaf' || c === 'half_caf') ?? null;
  basics.push({
    field: 'caffeine', catalogValue: currentCaffeineCode,
    roasterValue: caffeineCode, roasterValues: [], differs: caffeineCode !== currentCaffeineCode,
    applicable: caffeineCode !== null && codes.has(caffeineCode),
  });
  for (const b of basics) if (b.field !== 'caffeine') b.differs = (b.roasterValue ?? null) !== (b.catalogValue ?? null);

  const suggestions = await getMappingSuggestions(response.notes.map(n => n.roasterWords), runner);
  const activeTerms = new Set(currentActive.map(c => c.cuppingNoteId));
  const wheel = response.notes.map(n => n.cuppingNoteId).filter((x): x is string => !!x);
  const pickInfo = new Map<string, { descriptor: string; wheelCategory: string }>();
  if (wheel.length) {
    const pk = await runner.query(`SELECT id, descriptor, wheel_category FROM cupping_note WHERE id = ANY($1::uuid[])`, [wheel]);
    for (const x of pk.rows) pickInfo.set(x.id, { descriptor: x.descriptor, wheelCategory: x.wheel_category });
  }
  const notes: PreviewNote[] = response.notes.map(n => {
    const pickRaw = n.cuppingNoteId ? pickInfo.get(n.cuppingNoteId) : undefined;
    const roasterPick = n.cuppingNoteId && pickRaw ? { cuppingNoteId: n.cuppingNoteId, ...pickRaw } : null;
    const sug = suggestions.get(normalizeWords(n.roasterWords)) ?? null;
    const suggestion = sug && (!roasterPick || roasterPick.cuppingNoteId !== sug.cuppingNoteId) ? sug : null;
    const defaultCuppingNoteId = roasterPick?.cuppingNoteId ?? suggestion?.cuppingNoteId ?? null;
    return {
      rank: n.rank, roasterWords: n.roasterWords, roasterPick, suggestion, defaultCuppingNoteId,
      defaultFromSuggestion: !roasterPick && !!suggestion,
      alreadyActive: defaultCuppingNoteId !== null && activeTerms.has(defaultCuppingNoteId),
    };
  });
  const defaultSet = new Set(notes.map(n => n.defaultCuppingNoteId).filter((x): x is string => !!x));
  const retiring = currentActive
    .filter(c => !defaultSet.has(c.cuppingNoteId))
    .map(c => ({ descriptorId: c.descriptorId, cuppingNoteId: c.cuppingNoteId, descriptor: c.descriptor }));

  // Hints: read-only, never applied.
  const dims = await runner.query(
    `SELECT rd.dimension_id, d.label, d.low_label, d.high_label, rd.value
     FROM roastery_portal_response_dimension rd JOIN roastery_portal_dimension d ON d.dimension_id = rd.dimension_id
     WHERE rd.response_id = $1 ORDER BY d.sort_order`, [responseId]
  );
  let cousin: AcceptancePreview['hints']['cousin'] = null;
  if (response.closestCousinPortalCoffeeId) {
    const c = await runner.query(`SELECT name, coffee_id FROM roastery_portal_coffee WHERE id = $1`, [response.closestCousinPortalCoffeeId]);
    if (c.rows[0]) cousin = { name: c.rows[0].name, coffeeId: c.rows[0].coffee_id, whatChanges: response.whatChanges };
  }
  const roasterDimLabel = response.dominantDimensionId
    ? (await runner.query(`SELECT label FROM roastery_portal_dimension WHERE dimension_id = $1`, [response.dominantDimensionId])).rows[0]?.label ?? null
    : null;
  let dominant: DimensionMatch = {
    roasterDimensionId: response.dominantDimensionId, roasterDimensionName: roasterDimLabel, ourDimensionId: null,
    ourDimensionName: null, ourSource: null, ourSlotName: null, matches: null, range: null,
  };
  if (coffeeId !== null) {
    // Ours comes from the one view; the comparison and the range are recomputed for THIS response's dimension.
    const m = (await runner.query(`SELECT * FROM v_roastery_portal_dimension_match WHERE coffee_id = $1`, [coffeeId])).rows[0];
    if (m) {
      const cmp = await runner.query(`SELECT roastery_portal_dimension_matches($1::int, $2::int) AS matches`, [response.dominantDimensionId, m.our_dimension_id]);
      const rng = response.dominantDimensionId
        ? (await runner.query(`SELECT value_min, value_max, n_scores, basis FROM v_coffee_dimension_range WHERE coffee_id = $1 AND dimension_id = $2`, [coffeeId, response.dominantDimensionId])).rows[0]
        : null;
      dominant = {
        roasterDimensionId: response.dominantDimensionId, roasterDimensionName: roasterDimLabel,
        ourDimensionId: m.our_dimension_id, ourDimensionName: m.our_dimension_name, ourSource: m.our_source,
        ourSlotName: m.our_slot_name, matches: cmp.rows[0].matches,
        range: rng ? { min: Number(rng.value_min), max: Number(rng.value_max), nScores: Number(rng.n_scores), basis: rng.basis } : null,
      };
    }
  }

  return {
    response: {
      id: responseId, portalCoffeeId: row.portal_coffee_id, version: row.version, submittedAt: row.submitted_at,
      submittedByName: row.submitted_by_name, roasteryName: row.roaster_name,
    },
    coffee: {
      exists: coffeeId !== null, coffeeId, name: catalog?.name ?? row.coffee_name, roasterId: row.roaster_id,
      willCreate: coffeeId === null ? { name: row.coffee_name, roasterName: row.roaster_name } : null,
    },
    visibleToCustomers: visible,
    basics, notes, currentActive, retiring,
    extras: {
      roastIntent: response.roastIntent, caffeineLevel: response.caffeineLevel, decafProcess: response.decafProcess,
      certifications: response.certifications, additivesPresent: response.additivesPresent,
      additivesDetail: response.additivesPresent ? response.additivesDetail : null,
      blendComponents: response.blendComponents, blendRotation: response.blendRotation,
      blendRecipeChanges: response.blendOrSingle === 'blend' && (response.blendRotation === 'rotates_same_profile' || response.blendRotation === 'seasonal'),
      additivesNotice: response.additivesPresent
        ? `Contains added ingredients: ${response.additivesDetail ?? 'not specified'}. Check the ingredients statement on the bag.` : null,
    },
    hints: { proposedArchetype: response.proposedArchetype, dimensions: dims.rows, cousin, dominant: { ...dominant, roasterLabel: roasterDimLabel } },
  };
}

// ── What the submit notification needs ───────────────────────────────────────
/** All admins' addresses, resolved at send time (no hardcoded or configured address). */
export async function listAdminEmails(runner: Runner = db): Promise<string[]> {
  const r = await runner.query(
    `SELECT DISTINCT lower(ue.email_address) AS email
     FROM user_profile up
     JOIN user_type ut ON ut.id = up.user_type_id AND ut.name = 'admin'
     JOIN user_email ue ON ue.user_id = up.id
     WHERE ue.email_address IS NOT NULL
     ORDER BY 1`
  );
  return r.rows.map((x: any) => x.email);
}

export async function getSubmissionContext(responseId: string, runner: Runner = db): Promise<{
  roasteryName: string; coffeeName: string; roasterId: string; portalCoffeeId: string; submittedByName: string | null; version: number;
} | null> {
  const r = await runner.query(
    `SELECT ro.name AS roastery_name, pc.name AS coffee_name, pc.roaster_id, pc.id AS portal_coffee_id, r.version, sub.name AS submitted_by_name
     FROM roastery_portal_response r
     JOIN roastery_portal_coffee pc ON pc.id = r.portal_coffee_id
     JOIN roaster ro ON ro.id = pc.roaster_id
     LEFT JOIN roastery_portal_respondent sub ON sub.id = r.submitted_by_respondent_id
     WHERE r.id = $1`, [responseId]
  );
  const x = r.rows[0];
  return x ? { roasteryName: x.roastery_name, coffeeName: x.coffee_name, roasterId: x.roaster_id, portalCoffeeId: x.portal_coffee_id, submittedByName: x.submitted_by_name, version: x.version } : null;
}
