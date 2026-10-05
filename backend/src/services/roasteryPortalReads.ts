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
  const [process, roastLevel, blendOrSingle, brewMethods, availability, notice, similar, takesIt] = await Promise.all([
    lookup(runner, 'process'),
    lookup(runner, 'roast_level'),
    lookup(runner, 'blend_or_single'),
    lookup(runner, 'roastery_portal_brew_method'),
    lookup(runner, 'roastery_portal_availability'),
    lookup(runner, 'roastery_portal_notice'),
    lookup(runner, 'roastery_portal_similar'),
    lookup(runner, 'roastery_portal_takes_it'),
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
  const r = await runner.query(`SELECT * FROM roastery_portal_response WHERE id = $1`, [responseId]);
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
}

function mapLineupResponse(x: any): LineupResponse {
  return {
    id: x.id, version: x.version, status: x.status, typicalNotice: x.typical_notice,
    similarWhenOut: x.similar_when_out, anythingElse: x.anything_else,
    lastSavedByName: x.last_saved_by_name, submittedByName: x.submitted_by_name,
    updatedAt: x.updated_at, submittedAt: x.submitted_at,
  };
}

const LINEUP_RESPONSE_SELECT = `
  SELECT lr.*, sv.name AS last_saved_by_name, sb.name AS submitted_by_name
  FROM roastery_portal_lineup_response lr
  LEFT JOIN roastery_portal_respondent sv ON sv.id = lr.last_saved_by_respondent_id
  LEFT JOIN roastery_portal_respondent sb ON sb.id = lr.submitted_by_respondent_id`;

/** The open draft if one exists, else the latest submitted version. */
export async function getCurrentLineupResponse(roasterId: string, runner: Runner = db): Promise<LineupResponse | null> {
  const r = await runner.query(
    `${LINEUP_RESPONSE_SELECT} WHERE lr.roaster_id = $1 ORDER BY (lr.status = 'draft') DESC, lr.version DESC LIMIT 1`,
    [roasterId]
  );
  return r.rows[0] ? mapLineupResponse(r.rows[0]) : null;
}

export async function listLineupResponseVersions(roasterId: string, runner: Runner = db): Promise<LineupResponse[]> {
  const r = await runner.query(`${LINEUP_RESPONSE_SELECT} WHERE lr.roaster_id = $1 ORDER BY lr.version DESC`, [roasterId]);
  return r.rows.map(mapLineupResponse);
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
