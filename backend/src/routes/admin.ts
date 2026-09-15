import { Router } from 'express';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { generateAndStoreSummary, generateAndStoreAllContent } from './coffees.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';
import { recordCuppingSignal, getAvgCuppingScore, getArchetypeBucketWidth, getAvgCuppingScoresBatch } from '../services/dialSuggestion.js';
import { getMarketingConfig, setMarketingConfigValue } from '../features/marketing/reportingConfig.js';
import { DEFAULT_SOMMELIER_CONFIG } from '../db/seeds/sommelier_config_seed.js';
import { checkAggregateAnomaly, getMonthlySpendEstimate } from '../services/sommelierGuards.js';
import { getSommelierConfig, AI_FEATURES, type AiFeature, type AiControls } from '../services/sommelierConfig.js';
import { getBrewProfileCounters } from '../services/brewProfile.js';
import { checkStorySpecificityViolations } from '../services/storyLayer.js';
import { getOrMintCanonicalUniversalToken } from '../services/qrDoor.js';
import { getEffectiveAiControls, envCeilingUsd } from '../services/anthropicGuard.js';
import { runQuizIntegrityChecks } from '../services/quizIntegrity.js';
import { runCatalogIntegrityChecks } from '../services/catalogIntegrity.js';
import {
  CatalogError, type Ctx, type ArchetypeCode,
  createCoffee, updateCoffee, retireCoffee, restoreCoffee,
  setMatchArchetype, placeCoffee, moveCoffee, removeFromSlot, certifyPlacement, previewPlacement, setPriority,
  renameSlot, setSlotSpec, setSlotPrice, setLandingDefault, setArchetypeDescriptorFamilies,
  upsertSku, restockSku, setHop, removeHop,
  deactivateRoastery, reactivateRoastery, buildDeactivationPreview, buildReactivationPreview,
} from '../services/catalogService.js';
import { importCatalog } from '../services/catalogImport.js';
import { getArchetypes, getSlots, getCoffee, getCoffees, getSlotsForCoffee, getHops, getNotSellable, getChanges } from '../services/catalogReads.js';

const router = Router();
router.use(requireAdmin);

// Catalog Blueprint brief 2 (2026-09-14) — every /catalog/* route below maps a
// CatalogError to its status/code 1:1; this is the one place that happens so
// every thin route handler can just `catch (err) { handleCatalogError(err, res); }`.
function handleCatalogError(err: unknown, res: import('express').Response): boolean {
  if (err instanceof CatalogError) {
    res.status(err.status).json({ error: err.code, message: err.message, detail: err.detail });
    return true;
  }
  return false;
}

// ── GET /api/admin/archetypes — RETIRED (Catalog Blueprint brief 4) ──────────
// Replaced by GET /api/admin/catalog/archetypes (v_coffee_archetype) — same
// data, one source, no more hand-typed name<->code CASE map.
router.get('/archetypes', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/archetypes (Catalog Blueprint brief 4)' });
});

// ── GET /api/admin/lookups ────────────────────────────────────────────────────
// Returns all lookup categories as { category, values: [{value, label}][] }
router.get('/lookups', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT category, value, label
       FROM lookup_value
       ORDER BY category, sort_order, label`
    );
    // Group by category
    const grouped = result.rows.reduce<Record<string, { value: string; label: string }[]>>(
      (acc, row) => {
        (acc[row.category] ??= []).push({ value: row.value, label: row.label });
        return acc;
      },
      {}
    );
    res.json(grouped);
  } catch (err) {
    console.error('[admin/lookups]', err);
    res.status(500).json({ error: 'Failed to fetch lookups' });
  }
});

// ── POST /api/admin/lookups ───────────────────────────────────────────────────
// Add or update a value within a category. Upserts on the existing UNIQUE
// (category, value) constraint — same idempotent-upsert spirit already used to
// seed this table in schema.sql. Flavor Intelligence Part 1 Decision #9: so
// future categories/values (origin regions or anything else) don't require a
// code deploy.
router.post('/lookups', async (req, res) => {
  const { category, value, label, sortOrder } = req.body;
  if (!category || !value || !label) {
    res.status(400).json({ error: 'category, value, and label are required' }); return;
  }
  try {
    const result = await db.query(
      `INSERT INTO lookup_value (category, value, label, sort_order)
       VALUES ($1, $2, $3, COALESCE($4, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM lookup_value WHERE category = $1)))
       ON CONFLICT (category, value) DO UPDATE
         SET label = EXCLUDED.label,
             sort_order = COALESCE($4, lookup_value.sort_order)
       RETURNING id, category, value, label, sort_order`,
      [category, value, label, sortOrder ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[admin/lookups POST]', err);
    res.status(500).json({ error: 'Failed to add lookup value' });
  }
});

// ── PATCH /api/admin/lookups/:id ──────────────────────────────────────────────
router.patch('/lookups/:id', async (req, res) => {
  const { id } = req.params;
  const { label, sortOrder } = req.body;
  if (label === undefined && sortOrder === undefined) {
    res.status(400).json({ error: 'label or sortOrder is required' }); return;
  }
  try {
    const result = await db.query(
      `UPDATE lookup_value
       SET label = COALESCE($1, label),
           sort_order = COALESCE($2, sort_order)
       WHERE id = $3
       RETURNING id, category, value, label, sort_order`,
      [label ?? null, sortOrder ?? null, id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Lookup value not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/lookups PATCH]', err);
    res.status(500).json({ error: 'Failed to update lookup value' });
  }
});

// ── DELETE /api/admin/lookups/:id ─────────────────────────────────────────────
// coffees.process/roast_level are plain TEXT (convention-matched, not FKs) so
// deleting a value they reference just removes it from future dropdown options —
// existing coffees keep their stored text. coffees.origin_region_id IS a real FK
// (Decision #7), so deleting a region still assigned to a coffee hits Postgres's
// default RESTRICT and is caught here as a clean 409, same pattern as
// DELETE /api/admin/categories/:id.
router.delete('/lookups/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(`DELETE FROM lookup_value WHERE id = $1 RETURNING id`, [id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Lookup value not found' }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === '23503') {
      res.status(409).json({ error: 'Cannot delete — this value is still assigned to one or more coffees.' });
      return;
    }
    console.error('[admin/lookups DELETE]', err);
    res.status(500).json({ error: 'Failed to delete lookup value' });
  }
});

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
router.get('/stats', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM coffees)                    AS coffees,
        (SELECT COUNT(*) FROM cupping_sessions)           AS sessions,
        (SELECT COUNT(*) FROM cupping_score_descriptors)  AS internal_descriptors,
        (SELECT COUNT(*) FROM roastery_coffee_descriptors)AS roastery_descriptors,
        (SELECT COUNT(*) FROM user_flavor_feedback)     AS client_feedback,
        (SELECT COUNT(*) FROM cupping_note)               AS sca_descriptors
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── GET /api/admin/marketing/config — Marketing dashboard links ──────────────
router.get('/marketing/config', async (_req, res) => {
  try {
    res.json(await getMarketingConfig());
  } catch (err) {
    console.error('[admin/marketing/config]', err);
    res.status(500).json({ error: 'Failed to fetch marketing config' });
  }
});

// ── PATCH /api/admin/marketing/config — set one link at a time ───────────────
router.patch('/marketing/config', async (req, res) => {
  try {
    const { key, value } = req.body;
    res.json(await setMarketingConfigValue(key, value));
  } catch (err) {
    console.error('[admin/marketing/config PATCH]', err);
    const message = err instanceof Error ? err.message : 'Failed to update marketing config';
    res.status(400).json({ error: message });
  }
});

// ── GET /api/admin/coffees — RETIRED (Catalog Blueprint brief 4) ─────────────
// Replaced by GET /api/admin/catalog/coffees (v_coffee + placements + skus +
// category_codes + story flags) — AdminCatalog.tsx's data source now.
router.get('/coffees', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/coffees (Catalog Blueprint brief 4)' });
});

// ── POST /api/admin/coffees ───────────────────────────────────────────────────
router.post('/coffees', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// ── PATCH /api/admin/coffees/:id ──────────────────────────────────────────────
// Partial update for fields not set at creation time. Today only origin_region
// (Flavor Intelligence Part 1 Decision #7 backfill) plus process/roast_level for
// convenience, since they share the same dropdown pattern. All optional/COALESCE —
// omit a field to leave it untouched. origin_region takes the lookup_value.value
// slug (not the numeric id — that's what LookupSelect options carry) and is
// resolved to origin_region_id here; pass null/omit to clear it.
router.patch('/coffees/:id', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// ── GET /api/admin/sessions ───────────────────────────────────────────────────
router.get('/sessions', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT cs.id, cs.session_date, cs.location, cs.brew_method, cs.session_notes,
             COUNT(sc.id) AS coffee_count
      FROM cupping_sessions cs
      LEFT JOIN cupping_session_coffees sc ON sc.session_id = cs.id
      GROUP BY cs.id
      ORDER BY cs.session_date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/sessions]', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// ── POST /api/admin/sessions ──────────────────────────────────────────────────
router.post('/sessions', async (req, res) => {
  const { session_date, brew_method, location, session_notes } = req.body;
  if (!session_date) { res.status(400).json({ error: 'session_date is required' }); return; }
  try {
    const result = await db.query(
      `INSERT INTO cupping_sessions (session_date, brew_method, location, session_notes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [session_date, brew_method || null, location || null, session_notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    console.error('[admin/sessions POST]', err);
    res.status(500).json({ error: 'Failed to create session', detail: err?.message ?? String(err) });
  }
});

// ── DELETE /api/admin/sessions/:id ───────────────────────────────────────────
// Deletes a session and its session_coffee links (CASCADE). Scores must be removed first.
router.delete('/sessions/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM cupping_sessions WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Session not found' }); return;
    }
    res.json({ ok: true, deleted: result.rows[0].id });
  } catch (err) {
    console.error('[admin/sessions DELETE]', err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// ── GET /api/admin/flavor-wheel/:coffeeId ────────────────────────────────────
router.get('/flavor-wheel/:coffeeId', async (req, res) => {
  const { coffeeId } = req.params;
  try {
    const result = await db.query(
      `SELECT coffee_name, wheel_category, wheel_subcategory, descriptor, source,
              COUNT(*) AS mentions, AVG(intensity) AS avg_intensity
       FROM v_collaborative_flavor_wheel
       WHERE coffee_id = $1
       GROUP BY coffee_name, wheel_category, wheel_subcategory, descriptor, source
       ORDER BY wheel_category, mentions DESC`,
      [coffeeId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/flavor-wheel]', err);
    res.status(500).json({ error: 'Failed to fetch flavor wheel' });
  }
});

// ── GET /api/admin/roasters ───────────────────────────────────────────────────
// Always lists every roastery (active and inactive alike — this page is the
// one place that never hides inactive rows, per Decision 4). Roastery
// lifecycle (2026-08-25) adds deactivated_at/deactivation_note and, per
// roaster, real coffee/blend counts split active vs. total.
router.get('/roasters', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT r.id, r.name, r.api_endpoint, r.is_active, r.avg_fulfillment_hours, r.roaster_notes,
              r.address, r.email, r.phone, r.contact_person, r.website, r.created_at,
              r.deactivated_at, r.deactivation_note,
              COALESCE(cc.coffees, 0)        AS coffees,
              COALESCE(cc.active_coffees, 0) AS active_coffees,
              COALESCE(bc.blends, 0)         AS blends,
              COALESCE(bc.active_blends, 0)  AS active_blends
       FROM roaster r
       LEFT JOIN (
         SELECT roaster_id, COUNT(*) AS coffees, COUNT(*) FILTER (WHERE is_active) AS active_coffees
         FROM coffees WHERE roaster_id IS NOT NULL GROUP BY roaster_id
       ) cc ON cc.roaster_id = r.id
       LEFT JOIN (
         SELECT roaster_id, COUNT(*) AS blends, COUNT(*) FILTER (WHERE is_active) AS active_blends
         FROM roaster_blend WHERE roaster_id IS NOT NULL GROUP BY roaster_id
       ) bc ON bc.roaster_id = r.id
       ORDER BY r.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/roasters]', err);
    res.status(500).json({ error: 'Failed to fetch roasters' });
  }
});

// ── POST /api/admin/roasters ──────────────────────────────────────────────────
router.post('/roasters', async (req, res) => {
  const { name, api_endpoint, avg_fulfillment_hours, roaster_notes,
          address, email, phone, contact_person, website } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  try {
    const result = await db.query(
      `INSERT INTO roaster (name, api_endpoint, avg_fulfillment_hours, roaster_notes,
                            address, email, phone, contact_person, website)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [name, api_endpoint || null, avg_fulfillment_hours ? Number(avg_fulfillment_hours) : null,
       roaster_notes || null, address || null, email || null, phone || null,
       contact_person || null, website || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[admin/roasters POST]', err);
    res.status(500).json({ error: 'Failed to add roaster' });
  }
});

// ── PATCH /api/admin/roasters/:id ────────────────────────────────────────────
// Full edit of a roaster record (all fields)
router.patch('/roasters/:id', async (req, res) => {
  const { id } = req.params;
  const { name, api_endpoint, avg_fulfillment_hours, roaster_notes,
          address, email, phone, contact_person, website } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  try {
    const result = await db.query(
      `UPDATE roaster SET
         name = $1, api_endpoint = $2, avg_fulfillment_hours = $3, roaster_notes = $4,
         address = $5, email = $6, phone = $7, contact_person = $8, website = $9,
         updated_at = now()
       WHERE id = $10
       RETURNING *`,
      [name, api_endpoint || null, avg_fulfillment_hours ? Number(avg_fulfillment_hours) : null,
       roaster_notes || null, address || null, email || null, phone || null,
       contact_person || null, website || null, id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Roaster not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/roasters PATCH]', err);
    res.status(500).json({ error: 'Failed to update roaster' });
  }
});

// ─────────────────────────────────────────────
// ROASTERY LIFECYCLE — soft deactivation (2026-08-25)
// The bare PATCH /roasters/:id/toggle above is gone on purpose — a roaster
// flip with no cascade is the bug this section exists to close; see
// backend/src/features/roastery_lifecycle/CLAUDE_CODE_PROMPT_ROASTERY_SOFT_DEACTIVATION.md
// for the full decisions log. coffee_alias and roaster_blend keep their own
// per-row toggles (PATCH /coffee-alias/:id, PATCH /inventory/:id) — those now
// stamp deactivation_reason='manual'.
// Catalog Blueprint brief 2 (2026-09-14): buildDeactivationPreview/
// buildReactivationPreview/deactivateRoastery/reactivateRoastery all moved to
// catalogService.ts verbatim in semantics (plus deactivateRoastery now also
// cascades coffee_slot_assignment) — these three routes are thin wrappers.
// ─────────────────────────────────────────────

// ── GET /api/admin/roasters/:id/deactivation-preview ─────────────────────────
// Read-only, no side effects. ?direction=reactivate switches to "what would
// be restored" for the Reactivate dialog; default is the deactivate preview.
router.get('/roasters/:id/deactivation-preview', async (req, res) => {
  const { id } = req.params;
  try {
    const preview = req.query.direction === 'reactivate'
      ? await buildReactivationPreview(id)
      : await buildDeactivationPreview(id);
    if (!preview) { res.status(404).json({ error: 'Roaster not found' }); return; }
    res.json(preview);
  } catch (err) {
    console.error('[admin/roasters/deactivation-preview]', err);
    res.status(500).json({ error: 'Failed to compute deactivation preview' });
  }
});

// ── POST /api/admin/roasters/:id/deactivate ───────────────────────────────────
router.post('/roasters/:id/deactivate', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const note: string | undefined = typeof req.body?.note === 'string' ? req.body.note : undefined;
  try {
    const { result } = await deactivateRoastery({ roasterId: id, note }, { actor: req.uid ?? 'unknown' });
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/roasters deactivate]', err);
    res.status(500).json({ error: 'Failed to deactivate roastery' });
  }
});

// ── POST /api/admin/roasters/:id/reactivate ───────────────────────────────────
router.post('/roasters/:id/reactivate', async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const { result } = await reactivateRoastery({ roasterId: id }, { actor: req.uid ?? 'unknown' });
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/roasters reactivate]', err);
    res.status(500).json({ error: 'Failed to reactivate roastery' });
  }
});

// ── GET /api/admin/cupping-notes ──────────────────────────────────────────────
// Returns all SCA wheel descriptors grouped for use in a picker
router.get('/cupping-notes', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, wheel_category, wheel_subcategory, descriptor
       FROM cupping_note
       ORDER BY wheel_category, wheel_subcategory, descriptor`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/cupping-notes]', err);
    res.status(500).json({ error: 'Failed to fetch cupping notes' });
  }
});

// ── POST /api/admin/coffees/:id/archetype ────────────────────────────────────
router.post('/coffees/:id/archetype', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// ── DELETE /api/admin/coffees/:id ────────────────────────────────────────────
// Pre-existing hard delete — left as-is, out of scope for roastery lifecycle
// (2026-08-25). The soft path for taking a coffee out of circulation without
// losing its history is POST /roasters/:id/deactivate (whole roastery) or
// PATCH /coffee-alias/:id { is_active: false } (single coffee, manual reason).
router.delete('/coffees/:id', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// ── GET /api/admin/sessions/:id/coffees ──────────────────────────────────────
router.get('/sessions/:id/coffees', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT sc.id AS session_coffee_id, sc.display_order,
              c.id AS coffee_id, c.name, r.name AS roaster, c.origin, c.process, c.roast_level
       FROM cupping_session_coffees sc
       JOIN coffees c ON c.id = sc.coffee_id
       LEFT JOIN roaster r ON r.id = c.roaster_id
       WHERE sc.session_id = $1
       ORDER BY sc.display_order NULLS LAST, c.name`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/sessions coffees GET]', err);
    res.status(500).json({ error: 'Failed to fetch session coffees' });
  }
});

// ── POST /api/admin/sessions/:id/coffees ─────────────────────────────────────
router.post('/sessions/:id/coffees', async (req, res) => {
  const { id } = req.params;
  const { coffee_id } = req.body;
  if (!coffee_id) { res.status(400).json({ error: 'coffee_id is required' }); return; }
  try {
    const orderResult = await db.query(
      `SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM cupping_session_coffees WHERE session_id = $1`,
      [id]
    );
    const result = await db.query(
      `INSERT INTO cupping_session_coffees (session_id, coffee_id, display_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [id, coffee_id, orderResult.rows[0].next_order]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[admin/sessions coffees POST]', err);
    res.status(500).json({ error: 'Failed to add coffee to session' });
  }
});

// ── DELETE /api/admin/sessions/:sessionId/coffees/:scId ──────────────────────
router.delete('/sessions/:sessionId/coffees/:scId', async (req, res) => {
  const { scId } = req.params;
  try {
    await db.query(`DELETE FROM cupping_session_coffees WHERE id = $1`, [scId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/sessions coffees DELETE]', err);
    res.status(500).json({ error: 'Failed to remove coffee from session' });
  }
});

// ── GET /api/admin/dial/slot-aliases — RETIRED (Catalog Blueprint brief 4) ───
// Replaced by GET /api/admin/catalog/slots (coffee_dial_slot.name is the slot
// name now, no separate alias table).
router.get('/dial/slot-aliases', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/slots (Catalog Blueprint brief 4)' });
});

// ── GET /api/admin/dimensions ─────────────────────────────────────────────────
// ── GET /api/admin/coffee-alias — RETIRED (Catalog Blueprint brief 4) ────────
// Replaced by GET /api/admin/catalog/coffees (placements[] from v_coffee_slot).
router.get('/coffee-alias', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/coffees (Catalog Blueprint brief 4)' });
});

// ── POST /api/admin/coffee-alias — create a new alias row ────────────────────
// dial_sort_order is never accepted from the client — it's derived from the
// coffee's current dial_archetype_positions row for the given archetype, same
// single-source-of-truth rule as the GET route above. platform_name is still
// required here (coffee_alias.platform_name is NOT NULL) but is display-inert
// as of Bloom Dial Base Data Part 3 — the slot this row resolves to already has
// a name in dial_slot_alias (every real slot is pre-seeded), so this value is
// stored but never read; renaming the slot afterward uses PATCH .../slot or .../:id.
router.post('/coffee-alias', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// ── PATCH /api/admin/coffee-alias/slot — rename a slot's alias ────────────────
// Registered before /coffee-alias/:id so Express doesn't swallow 'slot' as an ID.
// Bloom Dial Base Data Part 3: the "Slot Name" is a property of the slot itself
// (dial_slot_alias, one row per (archetype, dial_sort_order), globally unique),
// not something fanned out across whichever coffee_alias rows happen to derive
// to it — that per-row fan-out was the source of the duplicate-name/desync
// regression this replaces. Works even for a currently-empty slot (a slot's
// name exists independent of any coffee occupying it).
router.patch('/coffee-alias/slot', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// ── PATCH /api/admin/coffee-alias/:id — update rank, rename, or toggle active ──
// Priority swap uses the same live derivation as GET /coffee-alias (derived
// archetype/position, not the possibly-stale stored coffee_alias columns) to
// find whichever alias currently occupies the target rank within the same slot.
router.patch('/coffee-alias/:id', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// ── GET /api/admin/slot-prices — RETIRED (Catalog Blueprint brief 4) ─────────
// Replaced by GET /api/admin/catalog/slots (prices[] per slot).
router.get('/slot-prices', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/slots (Catalog Blueprint brief 4)' });
});

// ── PATCH /api/admin/slot-prices — upsert one slot+weight price ──────────────
router.patch('/slot-prices', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// ── GET /api/admin/coffee-prices ──────────────────────────────────────────────
// Coffee-keyed counterpart to slot-prices, for Decaf/Half-Caf/Flavored/Experimental
// coffees (no dial slot to key a price off of) — Bloom Dial Base Data Part 3, Phase 6.
// Same "only returns rows that actually exist" contract; unset coffees fall back to
// the $32.00/12oz, $185.00/5lb defaults applied at GET /api/coffees/other-categories.
// Roastery lifecycle (2026-08-25) — defaults to prices for active coffees
// only; ?include_inactive=true also returns rows for inactive ones. The
// frontend already joins this against its own (separately active-filtered)
// coffee list, but filtering here too keeps every admin list consistent.
router.get('/coffee-prices', async (req, res) => {
  const includeInactive = req.query.include_inactive === 'true';
  try {
    const result = await db.query(
      `SELECT crp.coffee_id, crp.weight_oz, crp.retail_price_cents
       FROM coffee_retail_price crp
       JOIN coffees c ON c.id = crp.coffee_id
       ${includeInactive ? '' : 'WHERE c.is_active = true'}
       ORDER BY crp.coffee_id, crp.weight_oz`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/coffee-prices GET]', err);
    res.status(500).json({ error: 'Failed to fetch coffee prices' });
  }
});

// ── PATCH /api/admin/coffee-prices — upsert one coffee+weight price ──────────
router.patch('/coffee-prices', async (req, res) => {
  const { coffeeId, weightOz, retailPriceCents } = req.body;
  if (!Number.isInteger(coffeeId) || !Number.isFinite(weightOz)
    || !Number.isInteger(retailPriceCents) || retailPriceCents < 0) {
    res.status(400).json({ error: 'coffeeId, weightOz, and a non-negative integer retailPriceCents are required' });
    return;
  }
  try {
    const result = await db.query(
      `INSERT INTO coffee_retail_price (coffee_id, weight_oz, retail_price_cents, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (coffee_id, weight_oz)
       DO UPDATE SET retail_price_cents = $3, updated_at = NOW()
       RETURNING coffee_id, weight_oz, retail_price_cents`,
      [coffeeId, weightOz, retailPriceCents]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/coffee-prices PATCH]', err);
    res.status(500).json({ error: 'Failed to update coffee price' });
  }
});

// ── CATEGORIES ─────────────────────────────────────────────────────────────────
// Cross-cutting, orthogonal to archetype (e.g. Decaf, Half-Caf, Experimental) — see
// BLOOM_DIAL_ALLOCATION_SPEC.md §6. Managed from the Coffees page, same as archetype/
// alias. is_hoppable is never accepted here — it's a deliberate, manual DB decision.

// GET /api/admin/categories — all categories (including inactive, so an admin can
// reactivate one), ordered by sort_order
router.get('/categories', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, code, label, description, sort_order, is_active, is_hoppable
       FROM coffee_category ORDER BY sort_order`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/categories GET]', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST /api/admin/categories — create a new category. is_hoppable always defaults
// false here — opening a category to hop creation is a manual DB decision, not
// something exposed to this endpoint.
router.post('/categories', async (req, res) => {
  const { code, label } = req.body;
  if (!code || !label) {
    res.status(400).json({ error: 'code and label are required' }); return;
  }
  try {
    const result = await db.query(
      `INSERT INTO coffee_category (code, label, sort_order)
       VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM coffee_category))
       RETURNING id, code, label, description, sort_order, is_active, is_hoppable`,
      [code, label]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[admin/categories POST]', err);
    res.status(500).json({ error: 'Failed to create category (code may already exist)' });
  }
});

// PATCH /api/admin/categories/:id — rename and/or toggle active (partial update)
router.patch('/categories/:id', async (req, res) => {
  const { id } = req.params;
  const { label, is_active } = req.body;
  if (label !== undefined && (typeof label !== 'string' || !label.trim())) {
    res.status(400).json({ error: 'label must be a non-empty string' }); return;
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    res.status(400).json({ error: 'is_active must be a boolean' }); return;
  }
  if (label === undefined && is_active === undefined) {
    res.status(400).json({ error: 'label or is_active is required' }); return;
  }
  try {
    const result = await db.query(
      `UPDATE coffee_category
       SET label     = COALESCE($1::text, label),
           is_active = COALESCE($2::boolean, is_active)
       WHERE id = $3
       RETURNING id, code, label, description, sort_order, is_active, is_hoppable`,
      [label?.trim() ?? null, is_active ?? null, id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Category not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/categories PATCH]', err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// DELETE /api/admin/categories/:id — remove a category outright. coffee_category_assignment
// rows cascade automatically (ON DELETE CASCADE); a category still referenced by a
// dial_coffee_relationships hop (from_category_id/to_category_id, no cascade there by
// design) is blocked with a clear error instead of silently orphaning the hop.
router.delete('/categories/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(`DELETE FROM coffee_category WHERE id = $1 RETURNING id`, [id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Category not found' }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === '23503') {
      res.status(409).json({ error: 'Cannot delete — this category is still referenced by a hop. Remove the hop first.' });
      return;
    }
    console.error('[admin/categories DELETE]', err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// GET /api/admin/coffee-categories — all category assignments, joined with coffee
// name and category label/code (mirrors GET /api/admin/coffee-alias's shape)
router.get('/coffee-categories', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT cca.id, cca.coffee_id, cca.category_id,
              c.name AS coffee_name, cc.code AS category_code, cc.label AS category_label
       FROM coffee_category_assignment cca
       JOIN coffees c ON c.id = cca.coffee_id
       JOIN coffee_category cc ON cc.id = cca.category_id
       ORDER BY c.name, cc.sort_order`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/coffee-categories GET]', err);
    res.status(500).json({ error: 'Failed to fetch coffee categories' });
  }
});

// POST /api/admin/coffee-categories — tag a coffee with a category. Keeps its
// path (AdminCoffees.tsx uses it for tagging, which isn't being redesigned)
// but now goes through updateCoffee({ categoryCodes }) semantics (Catalog
// Blueprint brief 2, Part C) — computes the coffee's current full set of
// codes via v_coffee, adds this one, and lets updateCoffee's full-set
// upsert (insert missing / delete removed) do the actual write.
router.post('/coffee-categories', async (req: AuthRequest, res) => {
  const { coffee_id, category_id } = req.body;
  if (!coffee_id || !category_id) {
    res.status(400).json({ error: 'coffee_id and category_id are required' }); return;
  }
  try {
    const catResult = await db.query(`SELECT code FROM coffee_category WHERE id = $1`, [category_id]);
    if (catResult.rowCount === 0) { res.status(404).json({ error: 'Category not found' }); return; }
    const code = catResult.rows[0].code;

    const currentResult = await db.query<{ category_codes: string[] }>(`SELECT category_codes FROM v_coffee WHERE id = $1`, [coffee_id]);
    if (currentResult.rowCount === 0) { res.status(404).json({ error: 'Coffee not found' }); return; }
    const current = currentResult.rows[0].category_codes ?? [];
    if (current.includes(code)) { res.status(409).json({ error: 'Coffee already tagged with this category' }); return; }

    await updateCoffee({ coffeeId: Number(coffee_id), categoryCodes: [...current, code] }, { actor: req.uid ?? 'unknown' });
    const assignmentResult = await db.query(
      `SELECT id, coffee_id, category_id FROM coffee_category_assignment WHERE coffee_id = $1 AND category_id = $2`,
      [coffee_id, category_id]
    );
    res.status(201).json(assignmentResult.rows[0]);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/coffee-categories POST]', err);
    res.status(500).json({ error: 'Failed to tag coffee' });
  }
});

// DELETE /api/admin/coffee-categories/:id — remove one category assignment.
// Same updateCoffee({ categoryCodes }) semantics as the POST above, minus the code.
router.delete('/coffee-categories/:id', async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const assignmentResult = await db.query<{ coffee_id: number; category_id: number }>(
      `SELECT coffee_id, category_id FROM coffee_category_assignment WHERE id = $1`, [id]
    );
    if (assignmentResult.rowCount === 0) { res.status(404).json({ error: 'Assignment not found' }); return; }
    const { coffee_id: coffeeId, category_id: categoryId } = assignmentResult.rows[0];

    const catResult = await db.query<{ code: string }>(`SELECT code FROM coffee_category WHERE id = $1`, [categoryId]);
    const code = catResult.rows[0]?.code;
    const currentResult = await db.query<{ category_codes: string[] }>(`SELECT category_codes FROM v_coffee WHERE id = $1`, [coffeeId]);
    const current = currentResult.rows[0]?.category_codes ?? [];

    await updateCoffee({ coffeeId, categoryCodes: current.filter((c) => c !== code) }, { actor: req.uid ?? 'unknown' });
    res.json({ ok: true });
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/coffee-categories DELETE]', err);
    res.status(500).json({ error: 'Failed to remove category tag' });
  }
});

router.get('/dimensions', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, description, scale_min_label, scale_max_label,
              scale_min, scale_max, is_numeric, display_order
       FROM coffee_dimensions ORDER BY display_order`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/dimensions]', err);
    res.status(500).json({ error: 'Failed to fetch dimensions' });
  }
});

// ── GET /api/admin/scores/session-coffee/:scId ───────────────────────────────
// Returns all scores for a session_coffee, with their dimension values and descriptors
router.get('/scores/session-coffee/:scId', async (req, res) => {
  const { scId } = req.params;
  try {
    const scores = await db.query(
      `SELECT id, taster_name, is_merged, overall_notes FROM cupping_scores
       WHERE session_coffee_id = $1 ORDER BY created_at`,
      [scId]
    );
    const values = await db.query(
      `SELECT csv.cupping_score_id, csv.dimension_id, csv.value_min, csv.value_max, csv.notes
       FROM cupping_score_values csv
       JOIN cupping_scores cs ON cs.id = csv.cupping_score_id
       WHERE cs.session_coffee_id = $1`,
      [scId]
    );
    const descriptors = await db.query(
      `SELECT csd.cupping_score_id, csd.cupping_note_id, csd.intensity, csd.custom_notes
       FROM cupping_score_descriptors csd
       JOIN cupping_scores cs ON cs.id = csd.cupping_score_id
       WHERE cs.session_coffee_id = $1`,
      [scId]
    );
    res.json({ scores: scores.rows, values: values.rows, descriptors: descriptors.rows });
  } catch (err) {
    console.error('[admin/scores]', err);
    res.status(500).json({ error: 'Failed to fetch scores' });
  }
});

// ── POST /api/admin/scores ────────────────────────────────────────────────────
// Upserts a full score (header + dimension values + descriptors) in one call.
// values: { [dimensionId]: { value_min?, value_max?, notes? } }
// descriptors: [{ cupping_note_id, intensity?, custom_notes? }]
router.post('/scores', async (req, res) => {
  const { session_coffee_id, taster_name, is_merged, overall_notes, values, descriptors } = req.body;
  if (!session_coffee_id || !taster_name) {
    res.status(400).json({ error: 'session_coffee_id and taster_name are required' }); return;
  }
  try {
    // Upsert score header
    const scoreResult = await db.query(
      `INSERT INTO cupping_scores (session_coffee_id, taster_name, is_merged, overall_notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (session_coffee_id, taster_name) DO UPDATE
         SET is_merged = EXCLUDED.is_merged, overall_notes = EXCLUDED.overall_notes
       RETURNING id`,
      [session_coffee_id, taster_name, is_merged ?? false, overall_notes ?? null]
    );
    const scoreId = scoreResult.rows[0].id;

    // Upsert dimension values
    if (values) {
      for (const [dimId, val] of Object.entries(values as Record<string, { value_min?: number; value_max?: number; notes?: string }>)) {
        await db.query(
          `INSERT INTO cupping_score_values (cupping_score_id, dimension_id, value_min, value_max, notes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (cupping_score_id, dimension_id) DO UPDATE
             SET value_min = EXCLUDED.value_min, value_max = EXCLUDED.value_max, notes = EXCLUDED.notes`,
          [scoreId, dimId, val.value_min ?? null, val.value_max ?? null, val.notes ?? null]
        );
      }
    }

    // Replace descriptors
    await db.query(`DELETE FROM cupping_score_descriptors WHERE cupping_score_id = $1`, [scoreId]);
    if (descriptors?.length) {
      for (const d of descriptors as { cupping_note_id: string; intensity?: number; custom_notes?: string }[]) {
        await db.query(
          `INSERT INTO cupping_score_descriptors (cupping_score_id, cupping_note_id, intensity, custom_notes)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [scoreId, d.cupping_note_id, d.intensity ?? null, d.custom_notes ?? null]
        );
      }
    }

    // Non-critical: record the cupping source's dial-position signal (Phase 5 — dormant
    // infra, never writes to the live position). A failure here shouldn't fail the score save.
    if (is_merged) {
      try {
        const scRes = await db.query(
          `SELECT coffee_id FROM cupping_session_coffees WHERE id = $1`,
          [session_coffee_id]
        );
        if (scRes.rows[0]?.coffee_id) {
          await recordCuppingSignal(scRes.rows[0].coffee_id);
        }
      } catch (signalErr) {
        console.error('[admin/scores POST] recordCuppingSignal failed (non-critical)', signalErr);
      }
    }

    res.status(201).json({ id: scoreId });
  } catch (err) {
    console.error('[admin/scores POST]', err);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

// ── DELETE /api/admin/scores/:scoreId ────────────────────────────────────────
// Deletes a cupping score and all its values + descriptors (CASCADE).
router.delete('/scores/:scoreId', async (req, res) => {
  const { scoreId } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM cupping_scores WHERE id = $1 RETURNING id`,
      [scoreId]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Score not found' }); return;
    }
    res.json({ ok: true, deleted: result.rows[0].id });
  } catch (err) {
    console.error('[admin/scores DELETE]', err);
    res.status(500).json({ error: 'Failed to delete score' });
  }
});

// ── POST /api/admin/grant-admin ───────────────────────────────────────────────
// Grant admin role to a user by email address.
// Only callable by an existing admin.
router.post('/grant-admin', async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) { res.status(400).json({ error: 'email is required' }); return; }

  try {
    const result = await db.query(
      `UPDATE user_profile up
       SET user_type_id = (SELECT id FROM user_type WHERE name = 'admin')
       FROM user_email ue
       WHERE up.id = ue.user_id
         AND ue.email_address = $1
       RETURNING up.id`,
      [email.toLowerCase().trim()]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'No user found with that email. They must have logged in at least once.' });
      return;
    }
    res.json({ ok: true, message: `${email} is now an admin` });
  } catch (err) {
    console.error('[admin/grant-admin]', err);
    res.status(500).json({ error: 'Failed to grant admin' });
  }
});

// ── DELETE /api/admin/revoke-admin ────────────────────────────────────────────
// Revoke admin role from a user by email (sets them back to 'customer').
router.delete('/revoke-admin', async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) { res.status(400).json({ error: 'email is required' }); return; }

  try {
    const result = await db.query(
      `UPDATE user_profile up
       SET user_type_id = (SELECT id FROM user_type WHERE name = 'customer')
       FROM user_email ue
       WHERE up.id = ue.user_id
         AND ue.email_address = $1
       RETURNING up.id`,
      [email.toLowerCase().trim()]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'No user found with that email.' });
      return;
    }
    res.json({ ok: true, message: `${email} is now a regular customer` });
  } catch (err) {
    console.error('[admin/revoke-admin]', err);
    res.status(500).json({ error: 'Failed to revoke admin' });
  }
});

// ── POST /api/admin/coffees/:id/refresh-summary ───────────────────────────────
// Kept for backward compatibility. Prefer refresh-content.
router.post('/coffees/:id/refresh-summary', async (req, res) => {
  const { id } = req.params;
  try {
    const summary = await generateAndStoreSummary(id);
    res.json({ summary });
  } catch (err) {
    console.error('[admin/refresh-summary]', err);
    res.status(500).json({ error: 'Failed to refresh summary' });
  }
});

// ── POST /api/admin/coffees/:id/refresh-content ───────────────────────────────
// Force-regenerates all three AI content fields (ai_summary, surprise_note,
// three_voice_story) and updates both Cloud SQL and Firestore.
router.post('/coffees/:id/refresh-content', async (req, res) => {
  const { id } = req.params;
  try {
    const content = await generateAndStoreAllContent(id, { force: true });
    res.json(content);
  } catch (err) {
    console.error('[admin/refresh-content]', err);
    res.status(500).json({ error: 'Failed to refresh content' });
  }
});

// ── PATCH /api/admin/coffees/:id/story ────────────────────────────────────────
// HOME_TASK_5 (§4.4) — edit-in-place. Marks story_admin_edited so bulk
// regenerate (refresh-content, backfill) never overwrites it. Runs the exact
// same specificity check generation uses; a violation is rejected by default
// (409, listing what tripped) — an admin who's confident the check is a false
// positive can pass `force: true` to save anyway, which is logged, not silent.
router.patch('/coffees/:id/story', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { story, force } = req.body ?? {};
  if (typeof story !== 'string' || story.trim().length === 0) {
    res.status(400).json({ error: 'story (non-empty string) required' });
    return;
  }
  try {
    const coffeeResult = await db.query(
      `SELECT c.name, r.name AS roaster FROM coffees c LEFT JOIN roaster r ON r.id = c.roaster_id WHERE c.id = $1`,
      [id]
    );
    if (!coffeeResult.rows.length) { res.status(404).json({ error: 'Coffee not found' }); return; }
    const roasterBlendResult = await db.query(
      `SELECT DISTINCT r.name FROM roaster_blend rb JOIN roaster r ON r.id = rb.roaster_id WHERE rb.coffee_id = $1`,
      [id]
    );
    const roasterNames = [
      ...new Set([coffeeResult.rows[0].roaster, ...roasterBlendResult.rows.map((r: { name: string }) => r.name)].filter((n): n is string => !!n)),
    ];

    const violations = checkStorySpecificityViolations(story, { rawCoffeeName: coffeeResult.rows[0].name ?? null, roasterNames });
    if (violations.length > 0 && !force) {
      res.status(409).json({ error: 'Specificity check failed', violations });
      return;
    }
    if (violations.length > 0 && force) {
      console.warn(`[admin/coffees/:id/story] admin override — saved despite violations for coffee ${id} (uid=${req.uid}): ${violations.join('; ')}`);
    }

    await db.query(
      `UPDATE coffees SET story = $1, story_draft = $1, story_published = true, story_admin_edited = true, story_generated_at = NOW() WHERE id = $2`,
      [story.trim(), id]
    );
    res.json({ ok: true, story: story.trim(), violations });
  } catch (err) {
    console.error('[admin/coffees/:id/story PATCH]', err);
    res.status(500).json({ error: 'Failed to save story' });
  }
});

// ── BLOOM DIAL ────────────────────────────────────────────────────────────────

// ── GET /api/admin/dial/graph — RETIRED (Catalog Blueprint brief 4) ──────────
// Replaced by GET /api/admin/catalog/graph (below the catalogRouter section) —
// one payload replacing this endpoint plus /dial/positions and /dial/navigation.
router.get('/dial/graph', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/graph (Catalog Blueprint brief 4)' });
});

// ── GET /api/admin/dial/positions — RETIRED (Catalog Blueprint brief 4) ──────
// Replaced by GET /api/admin/catalog/graph.
router.get('/dial/positions', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/graph (Catalog Blueprint brief 4)' });
});

// ── GET /api/admin/dial/dimension-config — RETIRED (Catalog Blueprint brief 4) ─
// dial_archetype_config-keyed diagnostic; the dimension name it surfaced is
// now on GET /api/admin/catalog/archetypes (dominant_dimension_name).
router.get('/dial/dimension-config', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Dimension name moved to /api/admin/catalog/archetypes (Catalog Blueprint brief 4)' });
});

// ── GET /api/admin/dial/navigation — RETIRED (Catalog Blueprint brief 4) ─────
// Replaced by GET /api/admin/catalog/graph (hops from v_coffee_hop).
router.get('/dial/navigation', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/graph (Catalog Blueprint brief 4)' });
});

// ── GET /api/admin/dial/hop-suggestions — RETIRED (Catalog Blueprint brief 4) ─
// Moved to GET /api/admin/catalog/hop-suggestions (same logic, now reading
// getArchetypes/getCoffees instead of dial_archetype_config/archetype_assignments
// directly — Task 0 found this route hadn't actually been moved onto the views
// in brief 3 despite that brief's own claim; fixed here per this brief's own
// "grep the kept routes" instruction).
router.get('/dial/hop-suggestions', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/hop-suggestions (Catalog Blueprint brief 4)' });
});

// ── GET /api/admin/dial/archetype-adjacency — RETIRED (Catalog Blueprint brief 4) ─
// Was already view-backed (v_archetype_adjacency) but duplicated the public
// GET /api/axis/adjacency; retired per this brief's explicit list rather than
// kept as a second reader of the same view for no reason.
router.get('/dial/archetype-adjacency', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Use GET /api/axis/adjacency (Catalog Blueprint brief 4)' });
});

// GET /api/admin/dial/consensus/:coffeeId — weighted multi-source consensus (Phase 5, dormant).
// Read-only; not wired into any frontend page. With only 'cupping' weighted above zero
// today this mirrors Phase 3's live suggestion. View renamed to
// v_coffee_dial_position_consensus and re-keyed onto suggested_slot_id by
// Catalog Blueprint brief 5a (A1) — same output columns.
router.get('/dial/consensus/:coffeeId', async (req, res) => {
  const { coffeeId } = req.params;
  try {
    const result = await db.query(
      `SELECT * FROM v_coffee_dial_position_consensus WHERE coffee_id = $1`,
      [coffeeId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/dial/consensus GET]', err);
    res.status(500).json({ error: 'Failed to fetch dial position consensus' });
  }
});

// ── GET /api/admin/dial/vocabulary — RETIRED (Catalog Blueprint brief 4) ─────
// Replaced by GET /api/admin/catalog/slots (name/position_label per slot).
router.get('/dial/vocabulary', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/slots (Catalog Blueprint brief 4)' });
});

// PATCH /api/admin/dial/vocabulary/:id — rename a dial position's label
router.patch('/dial/vocabulary/:id', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// POST /api/admin/dial/positions — add or update a coffee's position on the dial
router.post('/dial/positions', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// PATCH /api/admin/dial/positions/:id — update is_default or vocabulary_id (move left/right)
router.patch('/dial/positions/:id', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// DELETE /api/admin/dial/positions/:id — remove a coffee from the dial
router.delete('/dial/positions/:id', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// POST /api/admin/dial/positions/guest — seam: add a coffee to an adjacent
// archetype's dial without touching its home position. Guest rows never carry
// is_default (dap_guest_not_default CHECK) and never get a separate SKU.
router.post('/dial/positions/guest', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// DELETE /api/admin/dial/positions/guest/:id — remove a seam position. Refuses to
// delete a home row through this path — use DELETE /dial/positions/:id for that.
router.delete('/dial/positions/guest/:id', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// POST /api/admin/dial/relationships — add a hop between two coffees
// Hard-validates logical contradictions (same coffee, missing archetypes, hop_type
// vs. archetype mismatch) before insert. Soft-validates the claimed direction against
// real cupping data when both coffees have it — returns a warning but still saves,
// since cupping data can be sparse or simply not the full picture yet.
router.post('/dial/relationships', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// DELETE /api/admin/dial/relationships/:id — remove a hop
router.delete('/dial/relationships/:id', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// ── GET /api/admin/sommelier/config ──────────────────────────────────────────
router.get('/sommelier/config', async (_req, res) => {
  try {
    const snap = await firestoreDb.doc('config/sommelier').get();
    if (!snap.exists) { res.status(404).json({ error: 'Config not found' }); return; }
    res.json(snap.data());
  } catch (err) {
    console.error('[admin/sommelier/config GET]', err);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// ── PATCH /api/admin/sommelier/config ─────────────────────────────────────────
router.patch('/sommelier/config', async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Request body must be a JSON object' });
    return;
  }

  // Validate weights if present
  const weights = body.confidenceWeights;
  if (weights) {
    const vals = Object.values(weights) as number[];
    if (vals.some((v) => typeof v !== 'number' || v < 0 || v > 1)) {
      res.status(400).json({ error: 'confidenceWeights values must be numbers between 0 and 1' });
      return;
    }
  }

  // Validate thresholds if present
  const thresholds = body.confidenceThresholds;
  if (thresholds) {
    const { medium, high } = thresholds;
    if (medium !== undefined && (typeof medium !== 'number' || medium < 0 || medium > 1)) {
      res.status(400).json({ error: 'confidenceThresholds.medium must be 0–1' });
      return;
    }
    if (high !== undefined && (typeof high !== 'number' || high < 0 || high > 1)) {
      res.status(400).json({ error: 'confidenceThresholds.high must be 0–1' });
      return;
    }
    if (medium !== undefined && high !== undefined && high <= medium) {
      res.status(400).json({ error: 'confidenceThresholds.high must be greater than .medium' });
      return;
    }
  }

  // Validate intent keys if present
  const VALID_INTENTS = ['DISCOVERY_SEEKER', 'PROFILE_AMBIGUOUS', 'TASTE_EVOLUTION', 'RECOMMENDATION_MISS', 'CONVERSION', 'EXPLORATION'];
  if (body.intents) {
    for (const key of Object.keys(body.intents)) {
      if (!VALID_INTENTS.includes(key)) {
        res.status(400).json({ error: `Unknown intent key: ${key}` });
        return;
      }
    }
  }

  try {
    await firestoreDb.doc('config/sommelier').set(
      { ...body, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/sommelier/config PATCH]', err);
    res.status(500).json({ error: 'Failed to update config' });
  }
});

// ── Config source of truth (HOME_TASK_1) ──────────────────────────────────────
// The admin portal's live `config/sommelier` document is canonical. Seed files
// (DEFAULT_SOMMELIER_CONFIG) are for fresh environments only — a seed edit that
// matters must be applied here (S35/S51: seed-only edits shipped inert twice).

interface ConfigDiffEntry {
  path: string;
  seedValue: unknown;
  liveValue: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Deep-compares seed vs. live, collecting one entry per differing leaf path.
// Leaves are primitives and arrays (compared by value, not element-by-element);
// only plain objects are recursed into, so `path` mirrors the dot-notation used
// by config-apply below. Top-level `updatedAt` is ignored on both sides.
function diffSommelierConfig(
  seed: unknown,
  live: unknown,
  prefix: string,
  out: ConfigDiffEntry[]
): void {
  if (isPlainObject(seed) || isPlainObject(live)) {
    const seedObj = isPlainObject(seed) ? seed : {};
    const liveObj = isPlainObject(live) ? live : {};
    const keys = new Set([...Object.keys(seedObj), ...Object.keys(liveObj)]);
    for (const key of keys) {
      if (prefix === '' && key === 'updatedAt') continue;
      const path = prefix ? `${prefix}.${key}` : key;
      diffSommelierConfig(seedObj[key], liveObj[key], path, out);
    }
    return;
  }
  if (JSON.stringify(seed) !== JSON.stringify(live)) {
    out.push({ path: prefix, seedValue: seed, liveValue: live });
  }
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!isPlainObject(acc)) return undefined;
    return acc[key];
  }, obj);
}

// ── GET /api/admin/sommelier/config-drift ─────────────────────────────────────
router.get('/sommelier/config-drift', async (_req, res) => {
  try {
    const snap = await firestoreDb.doc('config/sommelier').get();
    const live = snap.exists ? snap.data() ?? {} : {};
    const diffs: ConfigDiffEntry[] = [];
    diffSommelierConfig(DEFAULT_SOMMELIER_CONFIG, live, '', diffs);
    res.json({ diffs, inSync: diffs.length === 0 });
  } catch (err) {
    console.error('[admin/sommelier/config-drift GET]', err);
    res.status(500).json({ error: 'Failed to compute config drift' });
  }
});

// ── POST /api/admin/sommelier/config-apply ────────────────────────────────────
// Applies exactly the requested dot-paths from DEFAULT_SOMMELIER_CONFIG onto the
// live document. Uses Firestore's dot-notation field-path update, which merges at
// the leaf — sibling keys and any path not listed here are untouched, so a
// live-only key or an unrelated live edit survives.
router.post('/sommelier/config-apply', async (req: AuthRequest, res) => {
  const paths = req.body?.paths;
  if (!Array.isArray(paths) || paths.length === 0 || !paths.every((p) => typeof p === 'string')) {
    res.status(400).json({ error: 'Body must include a non-empty array of string paths' });
    return;
  }

  const updates: Record<string, unknown> = {};
  const appliedPaths: string[] = [];
  const skippedPaths: string[] = [];
  for (const path of paths as string[]) {
    const seedValue = getByPath(DEFAULT_SOMMELIER_CONFIG, path);
    if (seedValue === undefined) {
      skippedPaths.push(path);
      continue;
    }
    updates[path] = seedValue;
    appliedPaths.push(path);
  }

  if (appliedPaths.length === 0) {
    res.status(400).json({ error: 'None of the requested paths exist in the seed config', skippedPaths });
    return;
  }

  try {
    const configRef = firestoreDb.doc('config/sommelier');
    updates.updatedAt = FieldValue.serverTimestamp();
    await configRef.update(updates);

    // config_audit — config/sommelier/audit/{autoId} (4 segments, even — see house convention #6)
    await firestoreDb.collection('config/sommelier/audit').add({
      uid: req.uid ?? null,
      email: req.email ?? null,
      paths: appliedPaths,
      at: FieldValue.serverTimestamp(),
    });

    res.json({ ok: true, appliedPaths, skippedPaths });
  } catch (err) {
    console.error('[admin/sommelier/config-apply POST]', err);
    res.status(500).json({ error: 'Failed to apply config' });
  }
});

// ── AI Operations admin page (2026-08-10) ─────────────────────────────────────
// Both endpoints control Claude/AI spend ONLY — the shared gate in
// anthropicGuard.ts. Never touch the store, quiz flow, checkout, auth, or any
// non-AI data path (scope guard, see backend/src/features/ai_admin/
// ai_ops_admin_page.md).

const AI_OPS_FEATURE_DISPLAY_KEYS = [...AI_FEATURES, 'unattributed'];

function zeroByFeatureCents(): Record<string, number> {
  return Object.fromEntries(AI_OPS_FEATURE_DISPLAY_KEYS.map((k) => [k, 0]));
}

// ── GET /api/admin/ai-ops ──────────────────────────────────────────────────
router.get('/ai-ops', async (_req, res) => {
  try {
    const TREND_DAYS = 14;
    const trendCutoffKey = new Date(Date.now() - (TREND_DAYS - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const spendResult = await db.query<{ date: Date; feature: string; cents: number }>(
      `SELECT date, feature, cents FROM claude_daily_spend WHERE date >= $1 ORDER BY date ASC`,
      [trendCutoffKey]
    );

    const byDateKey = new Map<string, { date: string; totalCents: number; byFeature: Record<string, number> }>();
    for (const row of spendResult.rows) {
      const dateKey = row.date.toISOString().slice(0, 10);
      if (!byDateKey.has(dateKey)) {
        byDateKey.set(dateKey, { date: dateKey, totalCents: 0, byFeature: zeroByFeatureCents() });
      }
      const entry = byDateKey.get(dateKey)!;
      entry.totalCents += row.cents;
      // A feature value outside the known 4 (only possible historical case:
      // pre-migration rows, always 'unattributed') is bucketed under
      // 'unattributed' rather than dropped — the spec's own "may show that as
      // a historical row" instruction.
      const bucket = AI_FEATURES.includes(row.feature as AiFeature) ? row.feature : 'unattributed';
      entry.byFeature[bucket] = (entry.byFeature[bucket] ?? 0) + row.cents;
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    const today = byDateKey.get(todayKey) ?? { date: todayKey, totalCents: 0, byFeature: zeroByFeatureCents() };

    const trend14d = [];
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const dateKey = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      trend14d.push(byDateKey.get(dateKey) ?? { date: dateKey, totalCents: 0, byFeature: zeroByFeatureCents() });
    }

    // Most recent aiControls audit entries — same collection/pattern as
    // config-apply's audit trail (config/sommelier/audit/{autoId}), filtered
    // to this endpoint's own changeType so config-apply's unrelated entries
    // don't show up here. Fetched unfiltered + sliced in JS rather than a
    // where()+orderBy() Firestore query, to avoid needing a composite index
    // for a small, low-volume collection.
    const auditSnap = await firestoreDb.collection('config/sommelier/audit').orderBy('at', 'desc').limit(30).get();
    const recentAudit = auditSnap.docs
      .map((d) => d.data())
      .filter((d) => d.changeType === 'ai_controls')
      .slice(0, 10)
      .map((d) => ({
        uid: d.uid ?? null,
        email: d.email ?? null,
        at: d.at?.toDate?.() ?? null,
        old: d.old ?? null,
        new: d.new ?? null,
      }));

    res.json({
      today,
      trend14d,
      controls: getEffectiveAiControls(),
      envCeilingUsd: envCeilingUsd(),
      envKilled: (process.env.CLAUDE_ENABLED ?? 'true') === 'false',
      recentAudit,
    });
  } catch (err) {
    console.error('[admin/ai-ops GET]', err);
    res.status(500).json({ error: 'Failed to fetch AI ops data' });
  }
});

function validateAiControlsBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object';
  const b = body as Record<string, unknown>;

  if (typeof b.enabled !== 'boolean') return '"enabled" must be a boolean';
  if (typeof b.globalDailyUsd !== 'number' || !Number.isFinite(b.globalDailyUsd) || b.globalDailyUsd < 0) {
    return '"globalDailyUsd" must be a non-negative number';
  }

  if (!b.features || typeof b.features !== 'object') return '"features" must be an object';
  const features = b.features as Record<string, unknown>;

  for (const key of Object.keys(features)) {
    if (!AI_FEATURES.includes(key as AiFeature)) return `Unknown feature key: "${key}"`;
  }
  for (const key of AI_FEATURES) {
    if (!(key in features)) return `Missing feature key: "${key}"`;
    const f = features[key] as Record<string, unknown>;
    if (!f || typeof f !== 'object') return `features.${key} must be an object`;
    if (typeof f.enabled !== 'boolean') return `features.${key}.enabled must be a boolean`;
    if (f.dailyUsd !== null && (typeof f.dailyUsd !== 'number' || !Number.isFinite(f.dailyUsd) || f.dailyUsd < 0)) {
      return `features.${key}.dailyUsd must be null or a non-negative number`;
    }
  }

  return null;
}

// ── PUT /api/admin/ai-ops/controls ─────────────────────────────────────────
// A full validated write of aiControls (not a per-field patch) — the admin UI
// always fetches current state via GET first, so it always has the full
// shape to send back. Server-side min() enforcement mirrors the client's own
// display cap: the working cap can never exceed CLAUDE_GLOBAL_DAILY_USD, full
// stop — that's the whole point of the layering model (the portal is a
// brake, never an accelerator; raising the ceiling itself needs a deploy).
router.put('/ai-ops/controls', async (req: AuthRequest, res) => {
  const validationError = validateAiControlsBody(req.body);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const body = req.body as { enabled: boolean; globalDailyUsd: number; features: Record<AiFeature, { enabled: boolean; dailyUsd: number | null }> };

  const ceilingUsd = envCeilingUsd();
  if (body.globalDailyUsd > ceilingUsd) {
    res.status(400).json({
      error: `globalDailyUsd ($${body.globalDailyUsd}) cannot exceed the deployed ceiling ($${ceilingUsd}). Raising the ceiling itself requires a CLAUDE_GLOBAL_DAILY_USD change + deploy.`,
    });
    return;
  }

  const newControls: AiControls = {
    enabled: body.enabled,
    globalDailyUsd: body.globalDailyUsd,
    features: body.features,
  };

  try {
    const configRef = firestoreDb.doc('config/sommelier');
    const snap = await configRef.get();
    const oldControls = (snap.exists ? snap.data()?.aiControls : null) ?? null;

    await configRef.set({ aiControls: newControls, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    // config_audit — config/sommelier/audit/{autoId} (4 segments, even — see
    // house convention #6), same collection config-apply already writes to.
    await firestoreDb.collection('config/sommelier/audit').add({
      uid: req.uid ?? null,
      email: req.email ?? null,
      changeType: 'ai_controls',
      old: oldControls,
      new: newControls,
      at: FieldValue.serverTimestamp(),
    });

    res.json({ ok: true, controls: newControls });
  } catch (err) {
    console.error('[admin/ai-ops/controls PUT]', err);
    res.status(500).json({ error: 'Failed to update AI controls' });
  }
});

// ── GET /api/admin/sommelier/stats ────────────────────────────────────────────
router.get('/sommelier/stats', async (_req, res) => {
  const PERIOD_DAYS = 30;
  const cutoff = new Date(Date.now() - PERIOD_DAYS * 24 * 60 * 60 * 1000);

  try {
    // Firestore: all evaluations (filter in JS — collectionGroup date index not guaranteed)
    const snap = await firestoreDb.collectionGroup('sommelier_evaluations').get();
    const evals = snap.docs
      .map((d) => d.data())
      .filter((d) => {
        const ts = d.createdAt?.toDate?.();
        return ts ? ts >= cutoff : false;
      });

    const totalEvaluations = evals.length;
    const needsSommelierCount = evals.filter((d) => d.needsSommelier).length;
    const needsSommelierRate = totalEvaluations ? needsSommelierCount / totalEvaluations : 0;

    // Intent distribution
    const INTENT_KEYS = ['DISCOVERY_SEEKER', 'PROFILE_AMBIGUOUS', 'TASTE_EVOLUTION', 'RECOMMENDATION_MISS', 'CONVERSION', 'EXPLORATION'];
    const intentDistribution: Record<string, { count: number; sessionStartedRate: number; avgTurnsUsed: number; orderConversionRate: number }> = {};
    for (const intent of INTENT_KEYS) {
      const intentEvals = evals.filter((d) => d.intent === intent);
      const count = intentEvals.length;
      const sessionStarted = intentEvals.filter((d) => d.sessionStarted).length;
      const completed = intentEvals.filter((d) => d.outcome?.sessionCompleted);
      const avgTurns = completed.length
        ? completed.reduce((s, d) => s + (d.outcome?.turnsUsed ?? 0), 0) / completed.length
        : 0;
      const ordered = intentEvals.filter((d) => d.outcome?.orderedWithin30Days).length;
      intentDistribution[intent] = {
        count,
        sessionStartedRate: count ? sessionStarted / count : 0,
        avgTurnsUsed: Math.round(avgTurns * 10) / 10,
        orderConversionRate: count ? ordered / count : 0,
      };
    }

    // Confidence distribution
    const confidenceDistribution = { low: 0, medium: 0, high: 0 };
    for (const d of evals) {
      const level = d.userStateSnapshot?.behavioralLevel as string | undefined;
      if (level === 'low') confidenceDistribution.low++;
      else if (level === 'medium') confidenceDistribution.medium++;
      else if (level === 'high') confidenceDistribution.high++;
    }

    // Outcome stats (sessions only)
    const sessioned = evals.filter((d) => d.sessionStarted);
    const completionCount = sessioned.filter((d) => d.outcome?.sessionCompleted).length;
    const ordered7 = sessioned.filter((d) => d.outcome?.orderedWithin7Days).length;
    const returned = sessioned.filter((d) => d.outcome?.returnedToSommelier).length;
    const tokenTotals = sessioned.reduce((s, d) => s + (d.outcome?.tokensSpent ?? 0), 0);
    const outcomeStats = {
      sessionCompletionRate: sessioned.length ? completionCount / sessioned.length : 0,
      orderedWithin7DaysRate: sessioned.length ? ordered7 / sessioned.length : 0,
      returnedRate: sessioned.length ? returned / sessioned.length : 0,
      avgTokensPerSession: sessioned.length ? Math.round((tokenTotals / sessioned.length) * 10) / 10 : 0,
    };

    // SQL: token stats
    const tokenResult = await db.query(`
      SELECT
        COALESCE(SUM(lifetime_earned), 0)::int AS total_issued,
        COALESCE(SUM(lifetime_spent), 0)::int  AS total_spent,
        ROUND(AVG(balance)::numeric, 2)        AS avg_balance,
        COUNT(*) FILTER (WHERE balance = 0)::int AS zero_balance_users
      FROM user_tokens
    `);
    const tr = tokenResult.rows[0];
    const tokenStats = {
      totalTokensIssued: Number(tr.total_issued),
      totalTokensSpent: Number(tr.total_spent),
      avgBalancePerUser: Number(tr.avg_balance ?? 0),
      usersWithZeroBalance: Number(tr.zero_balance_users),
    };

    // HOME_TASK_3 (§4.8) — the invisible guard layer's admin-visible half.
    // Counted from token_events (reason IN ('sommelier_turn','usage_log')),
    // the same "a turn happened" signal both the gated and ungated /message
    // paths write — see sommelierGuards.ts.
    const todaysTurnsResult = await db.query(`
      SELECT COUNT(*)::int AS count FROM token_events
      WHERE reason IN ('sommelier_turn', 'usage_log') AND created_at >= date_trunc('day', NOW())
    `);
    const todaysTurns = Number(todaysTurnsResult.rows[0]?.count ?? 0);

    const sevenDayTrendResult = await db.query(`
      SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS count
      FROM token_events
      WHERE reason IN ('sommelier_turn', 'usage_log') AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY day ORDER BY day
    `);
    const sevenDayTrend = sevenDayTrendResult.rows.map((r: { day: Date; count: number }) => ({
      day: r.day.toISOString().slice(0, 10),
      count: Number(r.count),
    }));

    const topUsersResult = await db.query(`
      SELECT uid, COUNT(*)::int AS turn_count
      FROM token_events
      WHERE reason IN ('sommelier_turn', 'usage_log') AND created_at >= date_trunc('month', NOW())
      GROUP BY uid ORDER BY turn_count DESC LIMIT 10
    `);
    const monthlyCeiling = getSommelierConfig()?.guards?.monthlySpendCeilingUsd ?? 5;
    const topUsersByTurnsThisMonth = await Promise.all(
      topUsersResult.rows.map(async (r: { uid: string; turn_count: number }) => {
        const { estimatedUsd } = await getMonthlySpendEstimate(r.uid);
        return {
          uid: r.uid,
          turnCount: Number(r.turn_count),
          estimatedSpendUsd: Math.round(estimatedUsd * 100) / 100,
          overCeiling: estimatedUsd >= monthlyCeiling,
        };
      })
    );

    const capHitsResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM sommelier_sessions WHERE close_reason = 'daily_cap' AND started_at >= $1`,
      [cutoff]
    );
    const capHits = Number(capHitsResult.rows[0]?.count ?? 0);

    const anomaly = await checkAggregateAnomaly();

    const guardStats = {
      todaysTurns,
      sevenDayTrend,
      topUsersByTurnsThisMonth,
      capHits,
      anomaly,
    };

    // HOME_TASK_4 (§4.5 write rule 3) — brew-profile write/failure counts,
    // admin-visible rather than a buried log line.
    const brewProfileStats = await getBrewProfileCounters();

    res.json({
      totalEvaluations,
      needsSommelierRate: Math.round(needsSommelierRate * 1000) / 1000,
      intentDistribution,
      confidenceDistribution,
      outcomeStats: {
        sessionCompletionRate: Math.round(outcomeStats.sessionCompletionRate * 1000) / 1000,
        orderedWithin7DaysRate: Math.round(outcomeStats.orderedWithin7DaysRate * 1000) / 1000,
        returnedRate: Math.round(outcomeStats.returnedRate * 1000) / 1000,
        avgTokensPerSession: outcomeStats.avgTokensPerSession,
      },
      tokenStats,
      guardStats,
      brewProfileStats,
      periodDays: PERIOD_DAYS,
    });
  } catch (err) {
    console.error('[admin/sommelier/stats]', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── POST /api/admin/sommelier/recompute-centroids ─────────────────────────────
// Reads all sommelier_evaluations documents across all users, groups by intent,
// averages feature vectors component-by-component, and writes to config/sommelierCentroids.
router.post('/sommelier/recompute-centroids', async (_req, res) => {
  try {
    const snap = await firestoreDb.collectionGroup('sommelier_evaluations').get();

    const byIntent: Record<string, number[][]> = {};
    const FEATURE_DIM = 13;

    for (const doc of snap.docs) {
      const data = doc.data();
      const intent: string = data.intent;
      const vector: number[] = data.featureVector;
      if (!intent || !Array.isArray(vector) || vector.length !== FEATURE_DIM) continue;
      (byIntent[intent] ??= []).push(vector);
    }

    const centroids: Record<string, unknown> = {};
    for (const [intent, vectors] of Object.entries(byIntent)) {
      const centroid = new Array(FEATURE_DIM).fill(0);
      for (const v of vectors) {
        for (let i = 0; i < FEATURE_DIM; i++) centroid[i] += v[i];
      }
      for (let i = 0; i < FEATURE_DIM; i++) centroid[i] /= vectors.length;
      centroids[intent] = { centroid, sampleCount: vectors.length, updatedAt: FieldValue.serverTimestamp() };
    }

    centroids['computedAt'] = FieldValue.serverTimestamp();
    await firestoreDb.doc('config/sommelierCentroids').set(centroids, { merge: true });

    res.json({ ok: true, intentCounts: Object.fromEntries(Object.entries(byIntent).map(([k, v]) => [k, v.length])) });
  } catch (err) {
    console.error('[admin/sommelier/recompute-centroids]', err);
    res.status(500).json({ error: 'Failed to recompute centroids' });
  }
});

// ── INVENTORY ─────────────────────────────────────────────────────────────────

// ── GET /api/admin/inventory/coffees-lookup — RETIRED (Catalog Blueprint brief 4) ─
// Replaced by GET /api/admin/catalog/coffees (a SKU is created from the coffee
// now — Place-a-coffee or "Manage SKUs" — never a standalone lookup to link
// an orphaned blend to).
router.get('/inventory/coffees-lookup', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/coffees (Catalog Blueprint brief 4)' });
});

// ── GET /api/admin/inventory — RETIRED (Catalog Blueprint brief 4) ───────────
// Replaced by GET /api/admin/catalog/coffees, flattened to SKUs client-side
// (AdminInventory.tsx) — the alias/coffee_alias columns are gone with it.
router.get('/inventory', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/coffees (Catalog Blueprint brief 4)' });
});

router.patch('/inventory/:id', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

router.post('/inventory/:id/restock', (_req, res) => {
  res.status(410).json({ error: 'RETIRED', message: 'Replaced by /api/admin/catalog/* (Catalog Blueprint brief 2)' });
});

// ── HOME_TASK_7E — the QR door's admin surface, simplified (2026-08-04,
// amends 7c). router.use(requireAdmin) above already gates every route in
// this file — no per-route auth check needed here.
//
// Per-coffee minting/export (`/qr/mint/:coffeeId`, `/qr/mint-missing`,
// `/qr/tokens`) is removed: per-coffee tokens are retired from every surface
// (decision #2) — nothing prints them, nothing digital links through them
// anymore, and this admin list was their only remaining consumer. The
// tokens/rows themselves are untouched in the DB (dormant, zero cost); only
// the admin export UI/endpoints for them are gone. Legacy `/b/{token}`
// per-coffee scans still resolve via routes/qr.ts, unchanged.
//
// The universal-tokens endpoint (7c) narrows to decision #0: exactly one
// canonical printed URL, not one per roastery. QR_BASE_URL mirrors
// index.ts's own FRONTEND_URL fallback convention.
const QR_BASE_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

// GET /api/admin/qr/universal-tokens — the ONE printed code, mint-on-first-
// read if 7c's original pass somehow hadn't reached it (idempotent, so a
// second call is a no-op). No separate mint-missing POST needed anymore —
// there's nothing left for an admin to trigger by hand.
router.get('/qr/universal-tokens', async (_req, res) => {
  try {
    const { source, token } = await getOrMintCanonicalUniversalToken();
    res.json({ source, token, url: `${QR_BASE_URL}/b/${token}` });
  } catch (err) {
    console.error('[admin/qr/universal-tokens]', err);
    res.status(500).json({ error: 'Failed to fetch universal QR token' });
  }
});

// ── GET /api/admin/quiz/integrity — Quiz Content Drift Prevention ────────────
// Read-only: runs the same checks the re-asserting seed (schema.sql's V7
// block) is meant to keep passing on every deploy. No auto-fix here —
// anything it can't resolve itself (check #0) is a deliberate human decision.
router.get('/quiz/integrity', async (_req, res) => {
  try {
    const report = await runQuizIntegrityChecks();
    res.json(report);
  } catch (err) {
    console.error('[admin/quiz/integrity]', err);
    res.status(500).json({ error: 'Failed to run quiz integrity checks' });
  }
});

// ── GET /api/admin/catalog/integrity — Catalog Blueprint brief 1 ────────────
// Read-only: see backend/src/services/catalogIntegrity.ts for the 13 checks.
router.get('/catalog/integrity', async (_req, res) => {
  try {
    const report = await runCatalogIntegrityChecks();
    res.json(report);
  } catch (err) {
    console.error('[admin/catalog/integrity]', err);
    res.status(500).json({ error: 'Failed to run catalog integrity checks' });
  }
});

// ── GET /api/admin/system-health — Observability Foundation Part E ──────────
// Read-only aggregate view of the api_event log (see
// backend/src/features/observability/CLAUDE_CODE_PROMPT_OBSERVABILITY_FOUNDATION.md).
// No configuration here by policy -- alert thresholds/routing live in GCP
// Cloud Logging, not this portal. Reuses the AdminAIOps card pattern (plain
// SQL, no new tables) rather than inventing a new one.
router.get('/system-health', async (_req, res) => {
  try {
    const [callTypeResult, clientErrorResult, retentionResult] = await Promise.all([
      db.query<{ call_type: string; total: string; failed: string; never_finished: string }>(
        `SELECT call_type,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE response_status >= 400) AS failed,
                COUNT(*) FILTER (WHERE response_status IS NULL) AS never_finished
         FROM api_event
         WHERE occurred_at >= now() - interval '7 days'
         GROUP BY call_type
         ORDER BY total DESC`
      ),
      db.query<{ signature: string | null; count: string; last_seen: Date }>(
        `SELECT request_body->>'signature' AS signature,
                COUNT(*) AS count,
                MAX(occurred_at) AS last_seen
         FROM api_event
         WHERE call_type = 'POST /api/client-errors'
           AND occurred_at >= now() - interval '7 days'
         GROUP BY request_body->>'signature'
         ORDER BY count DESC
         LIMIT 20`
      ),
      db.query<{ total_rows: string; oldest_row_at: Date | null }>(
        `SELECT COUNT(*) AS total_rows, MIN(occurred_at) AS oldest_row_at FROM api_event`
      ),
    ]);

    res.json({
      callTypes: callTypeResult.rows.map(r => ({
        callType: r.call_type,
        total: Number(r.total),
        failed: Number(r.failed),
        neverFinished: Number(r.never_finished),
      })),
      clientErrorSignatures: clientErrorResult.rows.map(r => ({
        signature: r.signature,
        count: Number(r.count),
        lastSeen: r.last_seen,
      })),
      retention: {
        totalRows: Number(retentionResult.rows[0]?.total_rows ?? 0),
        oldestRowAt: retentionResult.rows[0]?.oldest_row_at ?? null,
      },
    });
  } catch (err) {
    console.error('[admin/system-health]', err);
    res.status(500).json({ error: 'Failed to fetch system health data' });
  }
});

// ─────────────────────────────────────────────
// CATALOG BLUEPRINT · brief 2 (2026-09-14) — /api/admin/catalog/*
// Every handler below is thin: validate -> call the service -> map
// CatalogError -> res.json(result). No SQL on a catalog table lives here —
// see backend/src/services/catalogService.ts. Behind the router-wide
// requireAdmin above, same as every other /api/admin/* route.
// ─────────────────────────────────────────────

const catalogRouter = Router();

catalogRouter.post('/coffees', async (req: AuthRequest, res) => {
  const { roasterId, name, origin, blendOrSingle, process, roastLevel, roastShade, flavorDescriptorsRoaster, categoryCodes } = req.body;
  try {
    const { result } = await createCoffee(
      { roasterId, name, origin, blendOrSingle, process, roastLevel, roastShade, flavorDescriptorsRoaster, categoryCodes },
      { actor: req.uid ?? 'unknown' }
    );
    res.status(201).json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/coffees POST]', err);
    res.status(500).json({ error: 'Failed to create coffee' });
  }
});

catalogRouter.patch('/coffees/:id', async (req: AuthRequest, res) => {
  const { name, origin, blendOrSingle, process, roastLevel, roastShade, flavorDescriptorsRoaster, categoryCodes, originRegion } = req.body;
  try {
    const { result } = await updateCoffee(
      { coffeeId: Number(req.params.id), name, origin, blendOrSingle, process, roastLevel, roastShade, flavorDescriptorsRoaster, categoryCodes, originRegion },
      { actor: req.uid ?? 'unknown' }
    );
    // origin_region_id included for callers resolving the slug (Flavor
    // Intelligence Part 1 Decision #9) — cheap enough to always include.
    const row = await db.query(`SELECT origin_region_id FROM coffees WHERE id = $1`, [req.params.id]);
    res.json({ ...result, origin_region_id: row.rows[0]?.origin_region_id ?? null });
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/coffees PATCH]', err);
    res.status(500).json({ error: 'Failed to update coffee' });
  }
});

catalogRouter.post('/coffees/:id/retire', async (req: AuthRequest, res) => {
  try {
    const { result } = await retireCoffee({ coffeeId: Number(req.params.id), reason: 'manual' }, { actor: req.uid ?? 'unknown' });
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/coffees retire]', err);
    res.status(500).json({ error: 'Failed to retire coffee' });
  }
});

catalogRouter.post('/coffees/:id/restore', async (req: AuthRequest, res) => {
  try {
    const { result } = await restoreCoffee({ coffeeId: Number(req.params.id) }, { actor: req.uid ?? 'unknown' });
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/coffees restore]', err);
    res.status(500).json({ error: 'Failed to restore coffee' });
  }
});

catalogRouter.put('/coffees/:id/match', async (req: AuthRequest, res) => {
  const { archetype, confidence, source, sessionId, notes } = req.body;
  if (!archetype || !confidence || !source) { res.status(400).json({ error: 'INVALID_INPUT', message: 'archetype, confidence, and source are required' }); return; }
  try {
    const { result, warnings } = await setMatchArchetype(
      { coffeeId: Number(req.params.id), archetype, confidence, source, sessionId, notes },
      { actor: req.uid ?? 'unknown' }
    );
    res.json({ ...result, warnings });
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/coffees match]', err);
    res.status(500).json({ error: 'Failed to set match archetype' });
  }
});

catalogRouter.post('/coffees/:id/placements', async (req: AuthRequest, res) => {
  const { slotId, role, priority, placementNote, certify } = req.body;
  if (!slotId || (role !== 'home' && role !== 'guest')) { res.status(400).json({ error: 'INVALID_INPUT', message: 'slotId and role (home|guest) are required' }); return; }
  try {
    const { result, warnings } = await placeCoffee(
      { coffeeId: Number(req.params.id), slotId, role, priority, placementNote, certify },
      { actor: req.uid ?? 'unknown' }
    );
    res.status(201).json({ ...result, warnings });
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/coffees placements POST]', err);
    res.status(500).json({ error: 'Failed to place coffee' });
  }
});

catalogRouter.post('/coffees/:id/move', async (req: AuthRequest, res) => {
  const { toSlotId, priority, placementNote, certify } = req.body;
  if (!toSlotId) { res.status(400).json({ error: 'INVALID_INPUT', message: 'toSlotId is required' }); return; }
  try {
    const { result, warnings } = await moveCoffee(
      { coffeeId: Number(req.params.id), toSlotId, priority, placementNote, certify },
      { actor: req.uid ?? 'unknown' }
    );
    res.json({ ...result, warnings });
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/coffees move]', err);
    res.status(500).json({ error: 'Failed to move coffee' });
  }
});

catalogRouter.delete('/coffees/:id/placements/:slotId', async (req: AuthRequest, res) => {
  const reason = req.query.reason === 'moved' ? 'moved' : 'manual';
  try {
    const { result } = await removeFromSlot(
      { coffeeId: Number(req.params.id), slotId: Number(req.params.slotId), reason },
      { actor: req.uid ?? 'unknown' }
    );
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/coffees placements DELETE]', err);
    res.status(500).json({ error: 'Failed to remove placement' });
  }
});

catalogRouter.post('/coffees/:id/placements/:slotId/certify', async (req: AuthRequest, res) => {
  const { by, note } = req.body;
  if (!by) { res.status(400).json({ error: 'INVALID_INPUT', message: 'by is required' }); return; }
  try {
    const { result } = await certifyPlacement(
      { coffeeId: Number(req.params.id), slotId: Number(req.params.slotId), by, note },
      { actor: req.uid ?? 'unknown' }
    );
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/coffees certify]', err);
    res.status(500).json({ error: 'Failed to certify placement' });
  }
});

catalogRouter.get('/placement-preview', async (req, res) => {
  const coffeeId = Number(req.query.coffeeId);
  const slotId = Number(req.query.slotId);
  const role = req.query.role === 'guest' ? 'guest' : 'home';
  if (!coffeeId || !slotId) { res.status(400).json({ error: 'INVALID_INPUT', message: 'coffeeId and slotId are required' }); return; }
  try {
    const preview = await previewPlacement({ coffeeId, slotId, role });
    res.json(preview);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/placement-preview]', err);
    res.status(500).json({ error: 'Failed to compute placement preview' });
  }
});

catalogRouter.put('/slots/:slotId/priorities', async (req: AuthRequest, res) => {
  const { ordered } = req.body;
  if (!Array.isArray(ordered)) { res.status(400).json({ error: 'INVALID_INPUT', message: 'ordered must be an array of coffee ids' }); return; }
  try {
    const { result } = await setPriority({ slotId: Number(req.params.slotId), ordered }, { actor: req.uid ?? 'unknown' });
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/slots priorities]', err);
    res.status(500).json({ error: 'Failed to set priorities' });
  }
});

catalogRouter.patch('/slots/:slotId', async (req: AuthRequest, res) => {
  const { name, positionLabel, positionDescription } = req.body;
  try {
    const { result } = await renameSlot({ slotId: Number(req.params.slotId), name, positionLabel, positionDescription }, { actor: req.uid ?? 'unknown' });
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/slots PATCH]', err);
    res.status(500).json({ error: 'Failed to rename slot' });
  }
});

catalogRouter.put('/slots/:slotId/spec', async (req: AuthRequest, res) => {
  const { bandLo, bandHi, descriptorFamilies } = req.body;
  try {
    const { result } = await setSlotSpec({ slotId: Number(req.params.slotId), bandLo, bandHi, descriptorFamilies }, { actor: req.uid ?? 'unknown' });
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/slots spec]', err);
    res.status(500).json({ error: 'Failed to set slot spec' });
  }
});

catalogRouter.put('/slots/:slotId/prices', async (req: AuthRequest, res) => {
  const { weightOz, retailPriceCents } = req.body;
  try {
    const { result } = await setSlotPrice({ slotId: Number(req.params.slotId), weightOz, retailPriceCents }, { actor: req.uid ?? 'unknown' });
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/slots prices]', err);
    res.status(500).json({ error: 'Failed to set slot price' });
  }
});

catalogRouter.post('/slots/:slotId/landing-default', async (req: AuthRequest, res) => {
  try {
    const { result } = await setLandingDefault({ slotId: Number(req.params.slotId) }, { actor: req.uid ?? 'unknown' });
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/slots landing-default]', err);
    res.status(500).json({ error: 'Failed to set landing default' });
  }
});

catalogRouter.put('/coffees/:id/skus', async (req: AuthRequest, res) => {
  const { weightOz, blendName, roasterSku, shopifyVariantId, costToUs, quantityAvailable, safetyStockBuffer, isActive } = req.body;
  if (!weightOz) { res.status(400).json({ error: 'INVALID_INPUT', message: 'weightOz is required' }); return; }
  try {
    const { result } = await upsertSku(
      { coffeeId: Number(req.params.id), weightOz, blendName, roasterSku, shopifyVariantId, costToUs, quantityAvailable, safetyStockBuffer, isActive },
      { actor: req.uid ?? 'unknown' }
    );
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/coffees skus]', err);
    res.status(500).json({ error: 'Failed to upsert SKU' });
  }
});

catalogRouter.post('/skus/:blendId/restock', async (req: AuthRequest, res) => {
  const quantity = Number(req.body.quantity);
  try {
    const { result } = await restockSku({ blendId: req.params.blendId, quantity }, { actor: req.uid ?? 'unknown' });
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/skus restock]', err);
    res.status(500).json({ error: 'Failed to restock SKU' });
  }
});

catalogRouter.post('/hops', async (req: AuthRequest, res) => {
  const { fromCoffeeId, toCoffeeId, dimensionId, direction, delta, isRecommended, confidence, notes } = req.body;
  if (!fromCoffeeId || !toCoffeeId || !dimensionId || !direction) {
    res.status(400).json({ error: 'INVALID_INPUT', message: 'fromCoffeeId, toCoffeeId, dimensionId, and direction are required' }); return;
  }
  try {
    const { result, warnings } = await setHop(
      { fromCoffeeId, toCoffeeId, dimensionId, direction, delta, isRecommended, confidence, notes },
      { actor: req.uid ?? 'unknown' }
    );
    res.status(201).json({ ...result, warnings });
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/hops POST]', err);
    res.status(500).json({ error: 'Failed to save hop' });
  }
});

catalogRouter.delete('/hops/:id', async (req: AuthRequest, res) => {
  try {
    const { result } = await removeHop({ hopId: Number(req.params.id) }, { actor: req.uid ?? 'unknown' });
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/hops DELETE]', err);
    res.status(500).json({ error: 'Failed to remove hop' });
  }
});

catalogRouter.post('/import', async (req: AuthRequest, res) => {
  const apply = req.query.apply === 'true';
  const mode = req.body?.mode === 'skip_existing' ? 'skip_existing' : undefined;
  try {
    const report = await importCatalog(req.body, { dryRun: !apply, actor: req.uid ?? 'unknown', mode });
    res.json(report);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/import]', err);
    res.status(500).json({ error: 'Import failed' });
  }
});

// ── Catalog Blueprint brief 4, Part A — admin reads, all view-backed ─────────

catalogRouter.get('/archetypes', async (_req, res) => {
  try {
    res.json(await getArchetypes());
  } catch (err) {
    console.error('[admin/catalog/archetypes]', err);
    res.status(500).json({ error: 'Failed to fetch archetypes' });
  }
});

catalogRouter.get('/slots', async (req, res) => {
  const archetype = typeof req.query.archetype === 'string' ? req.query.archetype : undefined;
  try {
    const slots = await getSlots(archetype);
    const slotIds = slots.map(s => s.id);
    const [occupantsResult, sellableResult, pricesResult] = await Promise.all([
      db.query(`
        SELECT vcs.*, r.name AS roaster_name
        FROM v_coffee_slot vcs
        LEFT JOIN roaster r ON r.id = vcs.roaster_id
        WHERE vcs.assignment_is_active = true AND vcs.slot_id = ANY($1::int[])
      `, [slotIds]),
      db.query(`SELECT DISTINCT ON (slot_id) slot_id, coffee_id FROM v_coffee_sellable_slot WHERE weight_oz = 12 AND slot_id = ANY($1::int[])`, [slotIds]),
      db.query(`SELECT slot_id, weight_oz, retail_price_cents FROM dial_slot_price WHERE slot_id = ANY($1::int[]) ORDER BY slot_id, weight_oz`, [slotIds]),
    ]);
    const occupantsBySlot = new Map<number, unknown[]>();
    for (const row of occupantsResult.rows) {
      if (!occupantsBySlot.has(row.slot_id)) occupantsBySlot.set(row.slot_id, []);
      occupantsBySlot.get(row.slot_id)!.push(row);
    }
    const sellableBySlot = new Map<number, number>(sellableResult.rows.map((r: { slot_id: number; coffee_id: number }) => [r.slot_id, r.coffee_id]));
    const pricesBySlot = new Map<number, unknown[]>();
    for (const row of pricesResult.rows) {
      if (!pricesBySlot.has(row.slot_id)) pricesBySlot.set(row.slot_id, []);
      pricesBySlot.get(row.slot_id)!.push({ weight_oz: row.weight_oz, retail_price_cents: row.retail_price_cents });
    }
    res.json(slots.map(slot => ({
      ...slot,
      occupants: occupantsBySlot.get(slot.id) ?? [],
      sellable_12oz: sellableBySlot.has(slot.id),
      sellable_12oz_coffee_id: sellableBySlot.get(slot.id) ?? null,
      prices: pricesBySlot.get(slot.id) ?? [],
    })));
  } catch (err) {
    console.error('[admin/catalog/slots]', err);
    res.status(500).json({ error: 'Failed to fetch slots' });
  }
});

catalogRouter.get('/coffees', async (req, res) => {
  const includeInactive = req.query.include_inactive === 'true';
  const roasterId = typeof req.query.roaster_id === 'string' ? req.query.roaster_id : undefined;
  const matchArchetype = typeof req.query.match_archetype === 'string' ? req.query.match_archetype : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
  try {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (!includeInactive) clauses.push('is_active = true');
    if (roasterId) { params.push(roasterId); clauses.push(`roaster_id = $${params.length}`); }
    if (matchArchetype) { params.push(matchArchetype); clauses.push(`match_archetype = $${params.length}`); }
    if (q) { params.push(`%${q}%`); clauses.push(`name ILIKE $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const coffeesResult = await db.query(`SELECT * FROM v_coffee ${where} ORDER BY name`, params);
    const coffeeIds: number[] = coffeesResult.rows.map((c: { id: number }) => c.id);
    const [placementsResult, skusResult] = await Promise.all([
      db.query(`SELECT * FROM v_coffee_slot WHERE assignment_is_active = true AND coffee_id = ANY($1::int[])`, [coffeeIds]),
      db.query(`SELECT * FROM roaster_blend WHERE coffee_id = ANY($1::int[]) ORDER BY coffee_id, weight_oz`, [coffeeIds]),
    ]);
    const placementsByCoffee = new Map<number, unknown[]>();
    for (const row of placementsResult.rows) {
      if (!placementsByCoffee.has(row.coffee_id)) placementsByCoffee.set(row.coffee_id, []);
      placementsByCoffee.get(row.coffee_id)!.push(row);
    }
    const skusByCoffee = new Map<number, unknown[]>();
    for (const row of skusResult.rows) {
      if (!skusByCoffee.has(row.coffee_id)) skusByCoffee.set(row.coffee_id, []);
      skusByCoffee.get(row.coffee_id)!.push(row);
    }
    res.json(coffeesResult.rows.map((c: { id: number }) => ({
      ...c,
      placements: placementsByCoffee.get(c.id) ?? [],
      skus: skusByCoffee.get(c.id) ?? [],
    })));
  } catch (err) {
    console.error('[admin/catalog/coffees GET]', err);
    res.status(500).json({ error: 'Failed to fetch coffees' });
  }
});

catalogRouter.get('/coffees/:id', async (req, res) => {
  const coffeeId = Number(req.params.id);
  try {
    const coffee = await getCoffee(coffeeId);
    if (!coffee) { res.status(404).json({ error: 'COFFEE_NOT_FOUND' }); return; }

    // Cupping summary — the coffee's match archetype's own dominant dimension,
    // same score definition getAvgCuppingScore/getDialSuggestion use everywhere.
    let cupping: { dimension_id: number; dimension_name: string; avg_score: number; session_count: number } | null = null;
    if (coffee.match_archetype) {
      const archetypeRow = (await getArchetypes()).find(a => a.code === coffee.match_archetype);
      if (archetypeRow?.dominant_dimension_id) {
        const score = await getAvgCuppingScore(coffeeId, archetypeRow.dominant_dimension_id);
        if (score) {
          cupping = {
            dimension_id: archetypeRow.dominant_dimension_id,
            dimension_name: archetypeRow.dominant_dimension_name ?? '',
            avg_score: score.avg_score, session_count: score.session_count,
          };
        }
      }
    }

    const [placements, skus, hops, recentChanges] = await Promise.all([
      getSlotsForCoffee(coffeeId),
      db.query(`SELECT * FROM roaster_blend WHERE coffee_id = $1 ORDER BY weight_oz`, [coffeeId]),
      getHops({ coffeeId }),
      getChanges({ limit: 20, coffeeId }),
    ]);
    res.json({ ...coffee, placements, skus: skus.rows, hops, cupping, recentChanges });
  } catch (err) {
    console.error('[admin/catalog/coffees/:id]', err);
    res.status(500).json({ error: 'Failed to fetch coffee' });
  }
});

// GET /api/admin/catalog/graph — what AdminDial needs in one payload: every
// slot (all archetypes) with its active occupants, plus every hop between two
// active coffees (v_coffee_hop) with a batched avg cupping score per endpoint
// (same score definition getAvgCuppingScoresBatch uses on the old /dial/graph).
// Replaces /dial/graph + /dial/positions + /dial/navigation together.
catalogRouter.get('/graph', async (_req, res) => {
  try {
    const [archetypes, slots, allOccupants, hops, avgScores] = await Promise.all([
      getArchetypes(),
      getSlots(),
      // v_coffee_slot exposes roaster_id, not a name — joined here rather
      // than added to the view (Don'ts: no schema changes beyond Part A).
      db.query(`
        SELECT vcs.*, r.name AS roaster_name
        FROM v_coffee_slot vcs
        LEFT JOIN roaster r ON r.id = vcs.roaster_id
        WHERE vcs.assignment_is_active = true
      `),
      getHops(),
      getAvgCuppingScoresBatch(),
    ]);
    const realArchetypes = archetypes.filter(a => a.is_archetype);

    // dimensions: every dominant dimension configured on a real archetype,
    // unioned with every dimension actually used by a hop — never a literal
    // id list. platform_name (coffee_dimensions) is the real display name
    // (e.g. "Brightness" for "Acidity") the old /dial/graph also preferred.
    const dimensionIds = new Set<number>();
    for (const a of realArchetypes) if (a.dominant_dimension_id) dimensionIds.add(a.dominant_dimension_id);
    for (const h of hops) dimensionIds.add(h.dimension_id);
    const dimensionsResult = dimensionIds.size
      ? await db.query<{ id: number; name: string; platform_name: string | null }>(
          `SELECT id, name, platform_name FROM coffee_dimensions WHERE id = ANY($1::int[]) ORDER BY id`,
          [[...dimensionIds]]
        )
      : { rows: [] as { id: number; name: string; platform_name: string | null }[] };
    const dimensions = dimensionsResult.rows.map(d => ({ id: d.id, name: d.name, platformAxis: d.platform_name ?? d.name }));

    const occupantsBySlot = new Map<number, unknown[]>();
    for (const row of allOccupants.rows) {
      if (!occupantsBySlot.has(row.slot_id)) occupantsBySlot.set(row.slot_id, []);
      occupantsBySlot.get(row.slot_id)!.push(row);
    }
    const slotsWithOccupants = slots.map(slot => ({ ...slot, occupants: occupantsBySlot.get(slot.id) ?? [] }));
    const hopsBetweenActive = hops
      .filter(h => h.from_coffee_is_active && h.to_coffee_is_active)
      .map(h => ({
        ...h,
        fromAvgScore: avgScores.get(`${h.from_coffee_id}-${h.dimension_id}`)?.avg_score ?? null,
        toAvgScore: avgScores.get(`${h.to_coffee_id}-${h.dimension_id}`)?.avg_score ?? null,
      }));
    res.json({
      dimensions,
      archetypes: realArchetypes.map(a => ({ archetype: a.code, label: a.label, dominantDimensionId: a.dominant_dimension_id })),
      slots: slotsWithOccupants,
      hops: hopsBetweenActive,
    });
  } catch (err) {
    console.error('[admin/catalog/graph]', err);
    res.status(500).json({ error: 'Failed to fetch catalog graph' });
  }
});

// GET /api/admin/catalog/hop-suggestions — moved from /dial/hop-suggestions
// (Task 0 found it hadn't actually moved onto the views in brief 3 despite
// that brief's own claim to the contrary — fixed here). Same within-archetype
// Dial Turn logic: cupping score deltas between coffee pairs sharing an
// archetype, never auto-creating a hop.
catalogRouter.get('/hop-suggestions', async (_req, res) => {
  try {
    const archetypes = (await getArchetypes()).filter(a => a.is_archetype && a.dominant_dimension_id);

    const suggestions: Array<{
      from_coffee_id: number; from_coffee_name: string;
      to_coffee_id: number; to_coffee_name: string;
      dimension_id: number; dimension_name: string;
      direction: 'more'; delta: number; archetype: string;
    }> = [];

    for (const a of archetypes) {
      const dimensionId = a.dominant_dimension_id!;
      const bucketWidth = await getArchetypeBucketWidth(a.code, dimensionId);
      if (!bucketWidth) continue;

      // Roastery lifecycle — never suggest a hop touching an inactive coffee.
      const coffees = await getCoffees({ matchArchetype: a.code, active: true });

      const scored: Array<{ id: number; name: string; avg_score: number }> = [];
      for (const c of coffees) {
        const score = await getAvgCuppingScore(c.id, dimensionId);
        if (score) scored.push({ id: c.id, name: c.name, avg_score: score.avg_score });
      }

      for (let i = 0; i < scored.length; i++) {
        for (let j = i + 1; j < scored.length; j++) {
          const delta = Math.abs(scored[j].avg_score - scored[i].avg_score);
          if (delta < bucketWidth) continue;

          const lower = scored[i].avg_score <= scored[j].avg_score ? scored[i] : scored[j];
          const higher = scored[i].avg_score <= scored[j].avg_score ? scored[j] : scored[i];

          // hop_type (stored) dropped by Catalog Blueprint brief 5a (D3) —
          // v_coffee_hop.hop_type_derived replaces it; both coffees here
          // already come from the same matchArchetype pool, so a hop between
          // them is inherently within-archetype by current placement too.
          const existingResult = await db.query(
            `SELECT 1 FROM v_coffee_hop
             WHERE hop_type_derived = 'within_archetype' AND dimension_id = $1
               AND ((from_coffee_id = $2 AND to_coffee_id = $3) OR (from_coffee_id = $3 AND to_coffee_id = $2))`,
            [dimensionId, lower.id, higher.id]
          );
          if ((existingResult.rowCount ?? 0) > 0) continue;

          suggestions.push({
            from_coffee_id: lower.id, from_coffee_name: lower.name,
            to_coffee_id: higher.id, to_coffee_name: higher.name,
            dimension_id: dimensionId, dimension_name: a.dominant_dimension_name ?? '',
            direction: 'more', delta: Math.round(delta * 100) / 100, archetype: a.code,
          });
        }
      }
    }

    res.json(suggestions);
  } catch (err) {
    console.error('[admin/catalog/hop-suggestions]', err);
    res.status(500).json({ error: 'Failed to compute hop suggestions' });
  }
});

// GET /api/admin/catalog/not-sellable — Part D.
catalogRouter.get('/not-sellable', async (_req, res) => {
  try {
    res.json(await getNotSellable());
  } catch (err) {
    console.error('[admin/catalog/not-sellable]', err);
    res.status(500).json({ error: 'Failed to fetch not-sellable slots' });
  }
});

// GET /api/admin/catalog/changes — Part D.
catalogRouter.get('/changes', async (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const coffeeId = req.query.coffee_id !== undefined ? Number(req.query.coffee_id) : undefined;
  const slotId = req.query.slot_id !== undefined ? Number(req.query.slot_id) : undefined;
  try {
    res.json(await getChanges({ limit, coffeeId, slotId }));
  } catch (err) {
    console.error('[admin/catalog/changes]', err);
    res.status(500).json({ error: 'Failed to fetch catalog changes' });
  }
});

// PUT /api/admin/catalog/archetypes/:code/descriptor-families — the one new
// write verb this brief adds (Don'ts §3).
catalogRouter.put('/archetypes/:code/descriptor-families', async (req: AuthRequest, res) => {
  const { families } = req.body;
  if (!Array.isArray(families) || !families.every((f) => typeof f === 'string')) {
    res.status(400).json({ error: 'INVALID_INPUT', message: 'families must be an array of strings' }); return;
  }
  try {
    const { result } = await setArchetypeDescriptorFamilies(
      { code: req.params.code as ArchetypeCode, families },
      { actor: req.uid ?? 'unknown' }
    );
    res.json(result);
  } catch (err) {
    if (handleCatalogError(err, res)) return;
    console.error('[admin/catalog/archetypes descriptor-families]', err);
    res.status(500).json({ error: 'Failed to set descriptor families' });
  }
});

router.use('/catalog', catalogRouter);

export default router;
