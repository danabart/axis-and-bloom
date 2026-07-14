import { Router } from 'express';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { generateAndStoreSummary, generateAndStoreAllContent } from './coffees.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';
import { getDialSuggestion, recordCuppingSignal, getAvgCuppingScore, getArchetypeBucketWidth } from '../services/dialSuggestion.js';

const router = Router();
router.use(requireAdmin);

function computeInventoryStatus(quantity: number, buffer: number): string {
  if (quantity <= 0) return 'out_of_stock';
  if (quantity <= buffer) return 'low_stock';
  return 'in_stock';
}

// ── GET /api/admin/archetypes — every archetype_enum value with its human label ─
// and dial_archetype_config.is_archetype flag, driven from the DB rather than a
// hardcoded frontend list. `is_archetype = false` (currently only 'experimental')
// marks it as a legacy category, not a true assignable archetype — frontend
// consumers filter on this to keep it out of new-assignment dropdowns while still
// showing legacy-tagged coffees (e.g. Kopi Safari) in matrix display.
router.get('/archetypes', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT dac.archetype AS value, a.name AS label, dac.is_archetype, dac.has_bloom_dial
      FROM dial_archetype_config dac
      LEFT JOIN archetype a ON a.name = CASE dac.archetype
        WHEN 'chocolate_nutty' THEN 'Chocolate & Nutty'
        WHEN 'balanced_sweet'  THEN 'Balanced & Sweet'
        WHEN 'fruity'          THEN 'Fruity'
        WHEN 'earthy'          THEN 'Earthy'
        WHEN 'floral'          THEN 'Floral'
        WHEN 'experimental'    THEN 'Experimental'
      END
      ORDER BY dac.archetype
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/archetypes GET]', err);
    res.status(500).json({ error: 'Failed to fetch archetypes' });
  }
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

// ── GET /api/admin/coffees ────────────────────────────────────────────────────
router.get('/coffees', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT c.id, c.name, c.roaster, c.origin, c.blend_or_single,
             c.process, c.roast_level, c.flavor_descriptors_roaster,
             c.origin_region_id, lv.label AS origin_region_label, lv.value AS origin_region_value,
             aa.archetype, aa.confidence,
             dap.id       AS dial_position_id,
             dap.vocabulary_id AS dial_vocab_id,
             dap.is_default    AS dial_is_default,
             dpv.sort_order    AS dial_position_sort,
             dpv.label         AS dial_label
      FROM coffees c
      LEFT JOIN lookup_value lv
        ON lv.id = c.origin_region_id
      LEFT JOIN archetype_assignments aa
        ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
      LEFT JOIN dial_archetype_positions dap
        ON dap.coffee_id = c.id AND dap.archetype = aa.archetype
      LEFT JOIN dial_position_vocabulary dpv
        ON dpv.id = dap.vocabulary_id
      ORDER BY c.id DESC
    `);
    // Per-coffee suggestion lookups are fine at this catalogue size (~30 coffees).
    const coffeesWithSuggestions = await Promise.all(
      result.rows.map(async (coffee) => ({
        ...coffee,
        dial_suggestion: await getDialSuggestion(coffee.id),
      }))
    );
    res.json(coffeesWithSuggestions);
  } catch (err) {
    console.error('[admin/coffees]', err);
    res.status(500).json({ error: 'Failed to fetch coffees' });
  }
});

// ── POST /api/admin/coffees ───────────────────────────────────────────────────
router.post('/coffees', async (req, res) => {
  const { name, roaster, origin, blend_or_single, process, roast_level, flavor_descriptors_roaster } = req.body;
  if (!name) { res.status(400).json({ error: 'name is required' }); return; }
  try {
    const result = await db.query(
      `INSERT INTO coffees (name, roaster, origin, blend_or_single, process, roast_level, flavor_descriptors_roaster)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [name, roaster ?? null, origin ?? null, blend_or_single ?? null,
       process ?? null, roast_level ?? null,
       flavor_descriptors_roaster ? flavor_descriptors_roaster.split(',').map((s: string) => s.trim()) : null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[admin/coffees POST]', err);
    res.status(500).json({ error: 'Failed to add coffee' });
  }
});

// ── PATCH /api/admin/coffees/:id ──────────────────────────────────────────────
// Partial update for fields not set at creation time. Today only origin_region
// (Flavor Intelligence Part 1 Decision #7 backfill) plus process/roast_level for
// convenience, since they share the same dropdown pattern. All optional/COALESCE —
// omit a field to leave it untouched. origin_region takes the lookup_value.value
// slug (not the numeric id — that's what LookupSelect options carry) and is
// resolved to origin_region_id here; pass null/omit to clear it.
router.patch('/coffees/:id', async (req, res) => {
  const { id } = req.params;
  const { process, roast_level, origin_region } = req.body;
  if (process === undefined && roast_level === undefined && origin_region === undefined) {
    res.status(400).json({ error: 'process, roast_level, or origin_region is required' }); return;
  }
  try {
    const result = await db.query(
      `UPDATE coffees
       SET process = COALESCE($1, process),
           roast_level = COALESCE($2, roast_level),
           origin_region_id = CASE WHEN $3::boolean
             THEN (SELECT id FROM lookup_value WHERE category = 'origin_region' AND value = $4)
             ELSE origin_region_id END
       WHERE id = $5
       RETURNING id, process, roast_level, origin_region_id`,
      [process ?? null, roast_level ?? null, origin_region !== undefined, origin_region ?? null, id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Coffee not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/coffees PATCH]', err);
    res.status(500).json({ error: 'Failed to update coffee' });
  }
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
router.get('/roasters', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, api_endpoint, is_active, avg_fulfillment_hours, roaster_notes,
              address, email, phone, contact_person, website, created_at
       FROM roaster
       ORDER BY name`
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

// ── PATCH /api/admin/roasters/:id/toggle ─────────────────────────────────────
router.patch('/roasters/:id/toggle', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `UPDATE roaster SET is_active = NOT is_active, updated_at = now()
       WHERE id = $1 RETURNING id, name, is_active`,
      [id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Roaster not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/roasters PATCH]', err);
    res.status(500).json({ error: 'Failed to toggle roaster' });
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
router.post('/coffees/:id/archetype', async (req, res) => {
  const { id } = req.params;
  const { archetype, confidence, notes, assigned_from_session_id, vocabulary_id, dial_is_default } = req.body;
  if (!archetype || !confidence) {
    res.status(400).json({ error: 'archetype and confidence are required' }); return;
  }
  // 'experimental' is a category (#78), not a true peer archetype — but it still owns its
  // own dial_position_vocabulary/dial_archetype_positions/coffee_alias data (legacy
  // scaffolding from before the categories decoupling), and that's still the only
  // mechanism that places a coffee into the "Experimental" table under Categories on the
  // Coffees page. So assignment stays allowed here, deliberately, until that table gets
  // its own non-archetype placement mechanism — see BLOOM_DIAL_ALLOCATION_SPEC.md §6.
  try {
    await db.query('BEGIN');

    await db.query(
      `UPDATE archetype_assignments SET superseded_at = now()
       WHERE coffee_id = $1 AND superseded_at IS NULL`,
      [id]
    );
    const result = await db.query(
      `INSERT INTO archetype_assignments (coffee_id, archetype, confidence, notes, assigned_from_session_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, archetype, confidence, notes ?? null, assigned_from_session_id ?? null]
    );

    if (vocabulary_id) {
      // Remove only this coffee's existing HOME row (handles archetype change) — guest
      // (is_guest=true) rows belong to the seam path (POST/DELETE /dial/positions/guest)
      // and must survive an archetype re-tag untouched.
      await db.query(`DELETE FROM dial_archetype_positions WHERE coffee_id = $1 AND is_guest = false`, [id]);

      if (dial_is_default) {
        // Clear previous default for same archetype + same roaster (home rows only —
        // a guest row can never be is_default per the dap_guest_not_default CHECK, but
        // is_guest = false here keeps that explicit rather than relying on the CHECK).
        await db.query(`
          UPDATE dial_archetype_positions
          SET is_default = false
          WHERE archetype = $1
            AND is_default = true
            AND is_guest = false
            AND coffee_id IN (
              SELECT c.id FROM coffees c
              WHERE c.roaster = (SELECT roaster FROM coffees WHERE id = $2)
            )
        `, [archetype, id]);
      }

      // ON CONFLICT handles the edge case where the coffee's new home archetype equals
      // an archetype it currently guests on — promotes that row to home (is_guest=false)
      // instead of colliding with the UNIQUE(archetype, coffee_id) key.
      await db.query(
        `INSERT INTO dial_archetype_positions (coffee_id, archetype, vocabulary_id, is_default, is_guest)
         VALUES ($1, $2, $3, $4, false)
         ON CONFLICT (archetype, coffee_id) DO UPDATE
           SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default, is_guest = false`,
        [id, archetype, vocabulary_id, dial_is_default ?? false]
      );
    }

    await db.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('[admin/coffees archetype]', err);
    res.status(500).json({ error: 'Failed to assign archetype' });
  }
});

// ── DELETE /api/admin/coffees/:id ────────────────────────────────────────────
router.delete('/coffees/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM coffees WHERE id = $1 RETURNING id, name`,
      [id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Coffee not found' }); return; }
    res.json({ ok: true, deleted: result.rows[0] });
  } catch (err) {
    console.error('[admin/coffees DELETE]', err);
    res.status(500).json({ error: 'Failed to delete coffee' });
  }
});

// ── GET /api/admin/sessions/:id/coffees ──────────────────────────────────────
router.get('/sessions/:id/coffees', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT sc.id AS session_coffee_id, sc.display_order,
              c.id AS coffee_id, c.name, c.roaster, c.origin, c.process, c.roast_level
       FROM cupping_session_coffees sc
       JOIN coffees c ON c.id = sc.coffee_id
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

// ── GET /api/admin/dimensions ─────────────────────────────────────────────────
// ── GET /api/admin/coffee-alias ──────────────────────────────────────────────
// dial_sort_order/archetype are derived live from dial_archetype_positions /
// archetype_assignments (the single sources of truth — see schema.sql comment
// above coffee_alias) and only fall back to the stored coffee_alias columns
// when a coffee has no live position (e.g. Half-Caf/Decaf, archetype = NULL by design).
router.get('/coffee-alias', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT ca.id, ca.platform_name,
             COALESCE(aa.archetype, ca.archetype)   AS archetype,
             COALESCE(dpv.sort_order, ca.dial_sort_order) AS dial_sort_order,
             ca.coffee_id, ca.priority, ca.is_active,
             c.name AS coffee_name, c.roaster
      FROM coffee_alias ca
      JOIN coffees c ON c.id = ca.coffee_id
      LEFT JOIN dial_archetype_positions dap ON dap.coffee_id = ca.coffee_id AND dap.is_guest = false
      LEFT JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
      LEFT JOIN archetype_assignments aa
        ON aa.coffee_id = ca.coffee_id AND aa.superseded_at IS NULL
      ORDER BY COALESCE(aa.archetype, ca.archetype) NULLS LAST,
               COALESCE(dpv.sort_order, ca.dial_sort_order), ca.priority
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/coffee-alias]', err);
    res.status(500).json({ error: 'Failed to fetch coffee aliases' });
  }
});

// ── POST /api/admin/coffee-alias — create a new alias row ────────────────────
// dial_sort_order is never accepted from the client — it's derived from the
// coffee's current dial_archetype_positions row for the given archetype, same
// single-source-of-truth rule as the GET route above.
router.post('/coffee-alias', async (req, res) => {
  const { platform_name, archetype, coffee_id, priority } = req.body;
  if (!platform_name || !archetype || !coffee_id) {
    res.status(400).json({ error: 'platform_name, archetype, and coffee_id are required' }); return;
  }
  try {
    const posResult = await db.query(
      `SELECT dpv.sort_order
       FROM dial_archetype_positions dap
       JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
       WHERE dap.coffee_id = $1 AND dap.archetype = $2 AND dap.is_guest = false`,
      [coffee_id, archetype]
    );
    if (posResult.rowCount === 0) {
      res.status(400).json({ error: 'Coffee has no home dial position for this archetype yet' }); return;
    }
    const result = await db.query(
      `INSERT INTO coffee_alias (platform_name, archetype, dial_sort_order, coffee_id, priority)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, platform_name, archetype, dial_sort_order, coffee_id, priority, is_active`,
      [platform_name, archetype, posResult.rows[0].sort_order, coffee_id, priority ?? 1]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[admin/coffee-alias POST]', err);
    res.status(500).json({ error: 'Failed to create alias' });
  }
});

// ── PATCH /api/admin/coffee-alias/slot — rename every alias sharing a slot ────
// Registered before /coffee-alias/:id so Express doesn't swallow 'slot' as an ID.
// The "Slot Name" shown on the Coffees page (aliasMap on the frontend) isn't a
// single row — it's one platform_name value shared by every coffee_alias row
// that currently derives to the same (archetype, position), same live
// derivation as GET /coffee-alias. Renaming "the slot" means renaming all of
// them at once, not just the one row a single coffee happens to own.
router.patch('/coffee-alias/slot', async (req, res) => {
  const { archetype, dial_sort_order, platform_name } = req.body;
  if (!archetype || dial_sort_order === undefined || dial_sort_order === null) {
    res.status(400).json({ error: 'archetype and dial_sort_order are required' }); return;
  }
  if (typeof platform_name !== 'string' || !platform_name.trim()) {
    res.status(400).json({ error: 'platform_name is required' }); return;
  }
  try {
    const result = await db.query(
      `UPDATE coffee_alias ca
       SET platform_name = $3
       WHERE ca.id IN (
         SELECT ca2.id
         FROM coffee_alias ca2
         LEFT JOIN dial_archetype_positions dap2 ON dap2.coffee_id = ca2.coffee_id AND dap2.is_guest = false
         LEFT JOIN dial_position_vocabulary dpv2 ON dpv2.id = dap2.vocabulary_id
         LEFT JOIN archetype_assignments aa2
           ON aa2.coffee_id = ca2.coffee_id AND aa2.superseded_at IS NULL
         WHERE COALESCE(aa2.archetype, ca2.archetype) = $1
           AND COALESCE(dpv2.sort_order, ca2.dial_sort_order) = $2
       )
       RETURNING id, platform_name, coffee_id`,
      [archetype, dial_sort_order, platform_name.trim()]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'No aliases found for that slot' }); return;
    }
    res.json({ ok: true, updated: result.rows });
  } catch (err) {
    console.error('[admin/coffee-alias slot PATCH]', err);
    res.status(500).json({ error: 'Failed to rename slot' });
  }
});

// ── PATCH /api/admin/coffee-alias/:id — update rank, rename, or toggle active ──
// Priority swap uses the same live derivation as GET /coffee-alias (derived
// archetype/position, not the possibly-stale stored coffee_alias columns) to
// find whichever alias currently occupies the target rank within the same slot.
router.patch('/coffee-alias/:id', async (req, res) => {
  const { id } = req.params;
  const { priority, platform_name, is_active } = req.body;

  if (priority !== undefined && (!Number.isInteger(priority) || priority < 1)) {
    res.status(400).json({ error: 'priority must be a positive integer' }); return;
  }
  if (platform_name !== undefined && typeof platform_name !== 'string') {
    res.status(400).json({ error: 'platform_name must be a string' }); return;
  }
  if (is_active !== undefined && typeof is_active !== 'boolean') {
    res.status(400).json({ error: 'is_active must be a boolean' }); return;
  }
  if (priority === undefined && platform_name === undefined && is_active === undefined) {
    res.status(400).json({ error: 'priority, platform_name, or is_active is required' }); return;
  }

  try {
    if (typeof priority === 'number') {
      const moverResult = await db.query(
        `SELECT COALESCE(aa.archetype, ca.archetype)         AS live_archetype,
                COALESCE(dpv.sort_order, ca.dial_sort_order)  AS live_sort_order,
                ca.priority                                   AS old_priority
         FROM coffee_alias ca
         LEFT JOIN dial_archetype_positions dap ON dap.coffee_id = ca.coffee_id AND dap.is_guest = false
         LEFT JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
         LEFT JOIN archetype_assignments aa
           ON aa.coffee_id = ca.coffee_id AND aa.superseded_at IS NULL
         WHERE ca.id = $1`,
        [id]
      );
      if (moverResult.rowCount === 0) { res.status(404).json({ error: 'Alias not found' }); return; }
      const { live_archetype: liveArchetype, live_sort_order: liveSortOrder, old_priority: oldPriority } = moverResult.rows[0];

      // Same slot (live archetype + live position) already holding the target priority? Swap instead of overwrite.
      const occupantResult = await db.query(
        `SELECT ca2.id
         FROM coffee_alias ca2
         LEFT JOIN dial_archetype_positions dap2 ON dap2.coffee_id = ca2.coffee_id AND dap2.is_guest = false
         LEFT JOIN dial_position_vocabulary dpv2 ON dpv2.id = dap2.vocabulary_id
         LEFT JOIN archetype_assignments aa2
           ON aa2.coffee_id = ca2.coffee_id AND aa2.superseded_at IS NULL
         WHERE ca2.id <> $1
           AND COALESCE(aa2.archetype, ca2.archetype) IS NOT DISTINCT FROM $2
           AND COALESCE(dpv2.sort_order, ca2.dial_sort_order) IS NOT DISTINCT FROM $3
           AND ca2.priority = $4`,
        [id, liveArchetype, liveSortOrder, priority]
      );

      await db.query('BEGIN');
      try {
        await db.query(`UPDATE coffee_alias SET priority = $1 WHERE id = $2`, [priority, id]);
        if ((occupantResult.rowCount ?? 0) > 0) {
          await db.query(`UPDATE coffee_alias SET priority = $1 WHERE id = $2`, [oldPriority, occupantResult.rows[0].id]);
        }
        await db.query('COMMIT');
      } catch (txErr) {
        await db.query('ROLLBACK');
        throw txErr;
      }
    }

    if (platform_name !== undefined || is_active !== undefined) {
      await db.query(
        `UPDATE coffee_alias
         SET platform_name = COALESCE($1::text, platform_name),
             is_active     = COALESCE($2::boolean, is_active)
         WHERE id = $3`,
        [platform_name ?? null, is_active ?? null, id]
      );
    }

    const result = await db.query(
      `SELECT id, platform_name, priority, archetype, dial_sort_order, coffee_id, is_active
       FROM coffee_alias WHERE id = $1`,
      [id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Alias not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/coffee-alias PATCH]', err);
    res.status(500).json({ error: 'Failed to update alias' });
  }
});

// ── GET /api/admin/slot-prices ────────────────────────────────────────────────
// All explicitly-set slot prices. Slots with no row here fall back to the
// $38.00/12oz, $199.00/5lb defaults applied client-side (AdminCoffees.tsx) and
// at the public-read query level (GET /api/coffees/archetypes) — this endpoint
// only returns rows that actually exist in dial_slot_price.
router.get('/slot-prices', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT archetype, dial_sort_order, weight_oz, retail_price_cents
       FROM dial_slot_price
       ORDER BY archetype, dial_sort_order, weight_oz`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/slot-prices GET]', err);
    res.status(500).json({ error: 'Failed to fetch slot prices' });
  }
});

// ── PATCH /api/admin/slot-prices — upsert one slot+weight price ──────────────
router.patch('/slot-prices', async (req, res) => {
  const { archetype, dialSortOrder, weightOz, retailPriceCents } = req.body;
  if (!archetype || !Number.isInteger(dialSortOrder) || !Number.isFinite(weightOz)
    || !Number.isInteger(retailPriceCents) || retailPriceCents < 0) {
    res.status(400).json({ error: 'archetype, dialSortOrder, weightOz, and a non-negative integer retailPriceCents are required' });
    return;
  }
  try {
    const result = await db.query(
      `INSERT INTO dial_slot_price (archetype, dial_sort_order, weight_oz, retail_price_cents, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (archetype, dial_sort_order, weight_oz)
       DO UPDATE SET retail_price_cents = $4, updated_at = NOW()
       RETURNING archetype, dial_sort_order, weight_oz, retail_price_cents`,
      [archetype, dialSortOrder, weightOz, retailPriceCents]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/slot-prices PATCH]', err);
    res.status(500).json({ error: 'Failed to update slot price' });
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

// POST /api/admin/coffee-categories — tag a coffee with a category
router.post('/coffee-categories', async (req, res) => {
  const { coffee_id, category_id } = req.body;
  if (!coffee_id || !category_id) {
    res.status(400).json({ error: 'coffee_id and category_id are required' }); return;
  }
  try {
    const result = await db.query(
      `INSERT INTO coffee_category_assignment (coffee_id, category_id)
       VALUES ($1, $2)
       ON CONFLICT (coffee_id, category_id) DO NOTHING
       RETURNING id, coffee_id, category_id`,
      [coffee_id, category_id]
    );
    if (result.rowCount === 0) {
      res.status(409).json({ error: 'Coffee already tagged with this category' }); return;
    }
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[admin/coffee-categories POST]', err);
    res.status(500).json({ error: 'Failed to tag coffee' });
  }
});

// DELETE /api/admin/coffee-categories/:id — remove one category assignment
router.delete('/coffee-categories/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM coffee_category_assignment WHERE id = $1 RETURNING id`, [id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Assignment not found' }); return; }
    res.json({ ok: true });
  } catch (err) {
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

// ── BLOOM DIAL ────────────────────────────────────────────────────────────────

// GET /api/admin/dial/positions — all dial positions with coffee + vocabulary detail
router.get('/dial/positions', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT dap.id, dap.archetype, dap.coffee_id, c.name AS coffee,
             cd.name AS dimension, dpv.id AS vocabulary_id,
             dpv.sort_order AS position_sort, dpv.label AS dial_label,
             dap.is_default, dap.is_computed
      FROM dial_archetype_positions dap
      JOIN coffees                  c   ON c.id   = dap.coffee_id
      JOIN dial_position_vocabulary dpv ON dpv.id = dap.vocabulary_id
      JOIN coffee_dimensions        cd  ON cd.id  = dpv.dimension_id
      ORDER BY dap.archetype, dpv.sort_order, c.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/dial/positions GET]', err);
    res.status(500).json({ error: 'Failed to fetch dial positions' });
  }
});

// GET /api/admin/dial/navigation — full hop graph with coffee names
router.get('/dial/navigation', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT dcr.id, dcr.from_coffee_id, fc.name AS from_coffee,
             dcr.to_coffee_id, tc.name AS to_coffee,
             dcr.dimension_id, cd.name AS dimension,
             dcr.direction, dcr.hop_type, dcr.delta,
             dcr.is_recommended, dcr.confidence, dcr.notes
      FROM dial_coffee_relationships dcr
      JOIN coffees           fc ON fc.id  = dcr.from_coffee_id
      JOIN coffees           tc ON tc.id  = dcr.to_coffee_id
      JOIN coffee_dimensions cd ON cd.id  = dcr.dimension_id
      ORDER BY fc.name, cd.name, dcr.direction
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/dial/navigation GET]', err);
    res.status(500).json({ error: 'Failed to fetch dial navigation' });
  }
});

// GET /api/admin/dial/hop-suggestions — within-archetype Dial Turn hops computed
// from cupping score deltas between coffee pairs sharing an archetype. Never
// auto-creates a hop — an explicit "Add" click on the frontend does that via the
// existing POST /dial/relationships (same as every other suggestion in this system).
// Cross-archetype (bridge) suggestions are out of scope — see followup prompt.
router.get('/dial/hop-suggestions', async (_req, res) => {
  try {
    const archetypesResult = await db.query(
      `SELECT dac.archetype, dac.dominant_dimension_id, cd.name AS dimension_name
       FROM dial_archetype_config dac
       JOIN coffee_dimensions cd ON cd.id = dac.dominant_dimension_id
       WHERE dac.is_archetype = true`
    );

    const suggestions: Array<{
      from_coffee_id: number; from_coffee_name: string;
      to_coffee_id: number; to_coffee_name: string;
      dimension_id: number; dimension_name: string;
      direction: 'more'; delta: number; archetype: string;
    }> = [];

    for (const { archetype, dominant_dimension_id: dimensionId, dimension_name: dimensionName } of archetypesResult.rows) {
      const bucketWidth = await getArchetypeBucketWidth(archetype, dimensionId);
      if (!bucketWidth) continue;

      const coffeesResult = await db.query(
        `SELECT aa.coffee_id, c.name
         FROM archetype_assignments aa
         JOIN coffees c ON c.id = aa.coffee_id
         WHERE aa.archetype = $1 AND aa.superseded_at IS NULL`,
        [archetype]
      );

      const scored: Array<{ id: number; name: string; avg_score: number }> = [];
      for (const c of coffeesResult.rows) {
        const score = await getAvgCuppingScore(c.coffee_id, dimensionId);
        if (score) scored.push({ id: c.coffee_id, name: c.name, avg_score: score.avg_score });
      }

      for (let i = 0; i < scored.length; i++) {
        for (let j = i + 1; j < scored.length; j++) {
          const delta = Math.abs(scored[j].avg_score - scored[i].avg_score);
          if (delta < bucketWidth) continue;

          const lower = scored[i].avg_score <= scored[j].avg_score ? scored[i] : scored[j];
          const higher = scored[i].avg_score <= scored[j].avg_score ? scored[j] : scored[i];

          const existingResult = await db.query(
            `SELECT 1 FROM dial_coffee_relationships
             WHERE hop_type = 'within_archetype' AND dimension_id = $1
               AND ((from_coffee_id = $2 AND to_coffee_id = $3) OR (from_coffee_id = $3 AND to_coffee_id = $2))`,
            [dimensionId, lower.id, higher.id]
          );
          if ((existingResult.rowCount ?? 0) > 0) continue;

          suggestions.push({
            from_coffee_id: lower.id, from_coffee_name: lower.name,
            to_coffee_id: higher.id, to_coffee_name: higher.name,
            dimension_id: dimensionId, dimension_name: dimensionName,
            direction: 'more', delta: Math.round(delta * 100) / 100, archetype,
          });
        }
      }
    }

    res.json(suggestions);
  } catch (err) {
    console.error('[admin/dial/hop-suggestions GET]', err);
    res.status(500).json({ error: 'Failed to compute hop suggestions' });
  }
});

// GET /api/admin/dial/archetype-adjacency — cross-archetype bridge-hop summary
router.get('/dial/archetype-adjacency', async (_req, res) => {
  try {
    const result = await db.query(`SELECT * FROM v_archetype_adjacency`);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/dial/archetype-adjacency GET]', err);
    res.status(500).json({ error: 'Failed to fetch archetype adjacency' });
  }
});

// GET /api/admin/dial/consensus/:coffeeId — weighted multi-source consensus (Phase 5, dormant).
// Read-only; not wired into any frontend page. With only 'cupping' weighted above zero
// today this mirrors Phase 3's live suggestion.
router.get('/dial/consensus/:coffeeId', async (req, res) => {
  const { coffeeId } = req.params;
  try {
    const result = await db.query(
      `SELECT * FROM v_dial_position_consensus WHERE coffee_id = $1`,
      [coffeeId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/dial/consensus GET]', err);
    res.status(500).json({ error: 'Failed to fetch dial position consensus' });
  }
});

// GET /api/admin/dial/vocabulary — all vocabulary options with dimension name
router.get('/dial/vocabulary', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT dpv.id, dpv.archetype, dpv.sort_order, dpv.label, dpv.dimension_id,
             cd.name AS dimension
      FROM dial_position_vocabulary dpv
      JOIN coffee_dimensions cd ON cd.id = dpv.dimension_id
      ORDER BY dpv.archetype, dpv.sort_order
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/dial/vocabulary GET]', err);
    res.status(500).json({ error: 'Failed to fetch dial vocabulary' });
  }
});

// PATCH /api/admin/dial/vocabulary/:id — rename a dial position's label
router.patch('/dial/vocabulary/:id', async (req, res) => {
  const { id } = req.params;
  const { label } = req.body;
  if (typeof label !== 'string' || !label.trim()) {
    res.status(400).json({ error: 'label must be a non-empty string' }); return;
  }
  try {
    const result = await db.query(
      `UPDATE dial_position_vocabulary SET label = $1 WHERE id = $2
       RETURNING id, archetype, sort_order, label, dimension_id`,
      [label.trim(), id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Vocabulary entry not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/dial/vocabulary PATCH]', err);
    res.status(500).json({ error: 'Failed to update vocabulary entry' });
  }
});

// POST /api/admin/dial/positions — add or update a coffee's position on the dial
router.post('/dial/positions', async (req, res) => {
  const { archetype, coffee_id, vocabulary_id, is_default } = req.body;
  if (!archetype || !coffee_id || !vocabulary_id) {
    res.status(400).json({ error: 'archetype, coffee_id, and vocabulary_id are required' }); return;
  }
  try {
    const result = await db.query(
      `INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (archetype, coffee_id) DO UPDATE
         SET vocabulary_id = EXCLUDED.vocabulary_id, is_default = EXCLUDED.is_default
       RETURNING id`,
      [archetype, coffee_id, vocabulary_id, is_default ?? false]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[admin/dial/positions POST]', err);
    res.status(500).json({ error: 'Failed to save dial position' });
  }
});

// PATCH /api/admin/dial/positions/:id — update is_default or vocabulary_id (move left/right)
router.patch('/dial/positions/:id', async (req, res) => {
  const { id } = req.params;
  const { is_default, vocabulary_id } = req.body;
  if (is_default === undefined && vocabulary_id === undefined) {
    res.status(400).json({ error: 'is_default or vocabulary_id required' }); return;
  }
  try {
    if (typeof is_default === 'boolean') {
      if (is_default) {
        // Clear existing default for same archetype + same roaster before promoting new one
        await db.query(`
          UPDATE dial_archetype_positions
          SET is_default = false
          WHERE archetype = (SELECT archetype FROM dial_archetype_positions WHERE id = $1)
            AND is_default = true
            AND coffee_id IN (
              SELECT c.id FROM coffees c
              WHERE c.roaster = (
                SELECT c2.roaster FROM coffees c2
                JOIN dial_archetype_positions dap ON dap.coffee_id = c2.id
                WHERE dap.id = $1
              )
            )
        `, [id]);
      }
      const result = await db.query(
        `UPDATE dial_archetype_positions SET is_default = $1 WHERE id = $2 RETURNING id`,
        [is_default, id]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: 'Position not found' }); return; }
    }
    if (typeof vocabulary_id === 'number') {
      const moverResult = await db.query(
        `SELECT dap.archetype, dap.vocabulary_id AS old_vocabulary_id, c.roaster
         FROM dial_archetype_positions dap
         JOIN coffees c ON c.id = dap.coffee_id
         WHERE dap.id = $1`,
        [id]
      );
      if (moverResult.rowCount === 0) { res.status(404).json({ error: 'Position not found' }); return; }
      const { archetype, old_vocabulary_id, roaster } = moverResult.rows[0];

      // Same archetype + same roaster already occupies the target slot? Swap instead of overwrite.
      const occupantResult = await db.query(
        `SELECT dap.id
         FROM dial_archetype_positions dap
         JOIN coffees c ON c.id = dap.coffee_id
         WHERE dap.archetype = $1 AND dap.vocabulary_id = $2 AND c.roaster = $3 AND dap.id <> $4`,
        [archetype, vocabulary_id, roaster, id]
      );

      await db.query('BEGIN');
      try {
        await db.query(
          `UPDATE dial_archetype_positions SET vocabulary_id = $1 WHERE id = $2`,
          [vocabulary_id, id]
        );
        if ((occupantResult.rowCount ?? 0) > 0) {
          await db.query(
            `UPDATE dial_archetype_positions SET vocabulary_id = $1 WHERE id = $2`,
            [old_vocabulary_id, occupantResult.rows[0].id]
          );
        }
        await db.query('COMMIT');
      } catch (txErr) {
        await db.query('ROLLBACK');
        throw txErr;
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/dial/positions PATCH]', err);
    res.status(500).json({ error: 'Failed to update position' });
  }
});

// DELETE /api/admin/dial/positions/:id — remove a coffee from the dial
router.delete('/dial/positions/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM dial_archetype_positions WHERE id = $1 RETURNING id`, [id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Position not found' }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/dial/positions DELETE]', err);
    res.status(500).json({ error: 'Failed to delete position' });
  }
});

// POST /api/admin/dial/positions/guest — seam: add a coffee to an adjacent
// archetype's dial without touching its home position. Guest rows never carry
// is_default (dap_guest_not_default CHECK) and never get a separate SKU.
router.post('/dial/positions/guest', async (req, res) => {
  const { coffee_id, archetype, vocabulary_id } = req.body;
  if (!coffee_id || !archetype || !vocabulary_id) {
    res.status(400).json({ error: 'coffee_id, archetype, and vocabulary_id are required' }); return;
  }
  try {
    const homeResult = await db.query(
      `SELECT archetype FROM archetype_assignments WHERE coffee_id = $1 AND superseded_at IS NULL`,
      [coffee_id]
    );
    const homeArchetype: string | undefined = homeResult.rows[0]?.archetype;
    if (homeArchetype === archetype) {
      res.status(400).json({ error: 'That archetype is this coffee\'s home archetype — use the archetype/position editor for a home move, not a seam.' }); return;
    }

    const result = await db.query(
      `INSERT INTO dial_archetype_positions (archetype, coffee_id, vocabulary_id, is_default, is_guest)
       VALUES ($1, $2, $3, false, true)
       RETURNING id`,
      [archetype, coffee_id, vocabulary_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err?.code === '23505') { res.status(409).json({ error: 'This coffee already has a position on that archetype\'s dial' }); return; }
    console.error('[admin/dial/positions/guest POST]', err);
    res.status(500).json({ error: 'Failed to add guest position' });
  }
});

// DELETE /api/admin/dial/positions/guest/:id — remove a seam position. Refuses to
// delete a home row through this path — use DELETE /dial/positions/:id for that.
router.delete('/dial/positions/guest/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM dial_archetype_positions WHERE id = $1 AND is_guest = true RETURNING id`, [id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Guest position not found' }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/dial/positions/guest DELETE]', err);
    res.status(500).json({ error: 'Failed to delete guest position' });
  }
});

// POST /api/admin/dial/relationships — add a hop between two coffees
// Hard-validates logical contradictions (same coffee, missing archetypes, hop_type
// vs. archetype mismatch) before insert. Soft-validates the claimed direction against
// real cupping data when both coffees have it — returns a warning but still saves,
// since cupping data can be sparse or simply not the full picture yet.
router.post('/dial/relationships', async (req, res) => {
  const { from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, delta, is_recommended, confidence, notes } = req.body;
  if (!from_coffee_id || !to_coffee_id || !dimension_id || !direction || !hop_type) {
    res.status(400).json({ error: 'from_coffee_id, to_coffee_id, dimension_id, direction, and hop_type are required' }); return;
  }
  if (from_coffee_id === to_coffee_id) {
    res.status(400).json({ error: 'A hop needs two different coffees.' }); return;
  }
  if (hop_type === 'category_hop') {
    res.status(400).json({ error: 'category_hop creation is not supported here — category-endpoint hops (e.g. a coffee to the Experimental category) are SQL-seed only.' }); return;
  }
  try {
    const archResult = await db.query(
      `SELECT coffee_id, archetype FROM archetype_assignments
       WHERE coffee_id IN ($1, $2) AND superseded_at IS NULL`,
      [from_coffee_id, to_coffee_id]
    );
    const fromArchetype: string | undefined = archResult.rows.find(r => r.coffee_id === from_coffee_id)?.archetype;
    const toArchetype: string | undefined = archResult.rows.find(r => r.coffee_id === to_coffee_id)?.archetype;

    if (!fromArchetype || !toArchetype) {
      res.status(400).json({ error: 'Both coffees need an archetype assigned before a hop can be added.' }); return;
    }
    if (hop_type === 'within_archetype' && fromArchetype !== toArchetype) {
      res.status(400).json({
        error: `Dial Turn hops must connect two coffees in the same archetype — these are tagged ${fromArchetype} and ${toArchetype}.`,
      }); return;
    }
    if (hop_type === 'bridge_archetype' && fromArchetype === toArchetype) {
      res.status(400).json({
        error: `Hop relationships must connect two different archetypes — both these coffees are tagged ${fromArchetype}.`,
      }); return;
    }

    const result = await db.query(
      `INSERT INTO dial_coffee_relationships
         (from_coffee_id, to_coffee_id, dimension_id, direction, delta, hop_type, is_recommended, confidence, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (from_coffee_id, to_coffee_id, dimension_id, direction) DO NOTHING
       RETURNING id`,
      [from_coffee_id, to_coffee_id, dimension_id,
       direction, delta ?? null, hop_type,
       is_recommended ?? false, confidence ?? 'medium', notes ?? null]
    );
    if (result.rowCount === 0) {
      res.status(409).json({ error: 'A relationship with this from/to/dimension/direction already exists' }); return;
    }

    // Soft validation — direction vs. real cupping data, and vs. an existing opposite-direction
    // hop between the same pair. Neither blocks the save; both are independent checks.
    const warnings: string[] = [];

    const [fromScore, toScore] = await Promise.all([
      getAvgCuppingScore(from_coffee_id, dimension_id),
      getAvgCuppingScore(to_coffee_id, dimension_id),
    ]);
    if (fromScore && toScore) {
      const toIsMore = toScore.avg_score > fromScore.avg_score;
      const claimedToIsMore = direction === 'more';
      if (toIsMore !== claimedToIsMore) {
        const namesResult = await db.query(
          `SELECT id, name FROM coffees WHERE id IN ($1, $2)`,
          [from_coffee_id, to_coffee_id]
        );
        const fromName = namesResult.rows.find(r => r.id === from_coffee_id)?.name ?? `coffee #${from_coffee_id}`;
        const toName = namesResult.rows.find(r => r.id === to_coffee_id)?.name ?? `coffee #${to_coffee_id}`;
        const dimResult = await db.query(`SELECT name FROM coffee_dimensions WHERE id = $1`, [dimension_id]);
        const dimensionName = dimResult.rows[0]?.name ?? `dimension #${dimension_id}`;
        warnings.push(`Cupping data suggests this is backwards — ${toName} currently scores ${toIsMore ? 'higher' : 'lower'} than ${fromName} on ${dimensionName} per existing sessions.`);
      }
    }

    // Existing opposite-direction hop between the same pair + dimension — warn, don't block
    // (the exact duplicate case is already caught by the unique constraint / 409 above).
    const oppositeResult = await db.query(
      `SELECT id FROM dial_coffee_relationships
       WHERE from_coffee_id = $1 AND to_coffee_id = $2 AND dimension_id = $3 AND direction <> $4`,
      [from_coffee_id, to_coffee_id, dimension_id, direction]
    );
    if ((oppositeResult.rowCount ?? 0) > 0) {
      warnings.push('A hop already exists between these two coffees on this dimension with the opposite direction.');
    }

    res.status(201).json({ ...result.rows[0], ...(warnings.length ? { warning: warnings.join(' ') } : {}) });
  } catch (err) {
    console.error('[admin/dial/relationships POST]', err);
    res.status(500).json({ error: 'Failed to save relationship' });
  }
});

// DELETE /api/admin/dial/relationships/:id — remove a hop
router.delete('/dial/relationships/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM dial_coffee_relationships WHERE id = $1 RETURNING id`, [id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Relationship not found' }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin/dial/relationships DELETE]', err);
    res.status(500).json({ error: 'Failed to delete relationship' });
  }
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

// Must be declared before /:id routes so Express doesn't swallow 'coffees-lookup' as an ID.
router.get('/inventory/coffees-lookup', async (_req, res) => {
  try {
    const result = await db.query(`SELECT id, name, roaster FROM coffees ORDER BY name`);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/inventory coffees-lookup]', err);
    res.status(500).json({ error: 'Failed to fetch coffees' });
  }
});

router.get('/inventory', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT
        rb.id, rb.blend_name, rb.coffee_id, c.name AS coffee_name, c.roaster,
        rb.weight_oz, rb.roaster_sku, rb.shopify_variant_id, rb.is_active,
        rb.quantity_available, rb.safety_stock_buffer,
        rb.inventory_status, rb.inventory_last_synced_at, rb.last_restocked_at,
        ca.id         AS alias_id,
        ca.platform_name AS alias_name,
        ca.priority   AS alias_rank
      FROM roaster_blend rb
      LEFT JOIN coffees c ON c.id = rb.coffee_id
      LEFT JOIN LATERAL (
        SELECT id, platform_name, priority
        FROM coffee_alias
        WHERE coffee_id = rb.coffee_id AND is_active = true
        ORDER BY priority
        LIMIT 1
      ) ca ON true
      ORDER BY
        (rb.coffee_id IS NULL) DESC,
        CASE
          WHEN rb.quantity_available <= 0 THEN 0
          WHEN rb.quantity_available <= rb.safety_stock_buffer THEN 1
          ELSE 2
        END,
        COALESCE(c.name, rb.blend_name), rb.weight_oz
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[admin/inventory]', err);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

router.patch('/inventory/:id', async (req, res) => {
  const { id } = req.params;
  const { quantity_available, safety_stock_buffer, coffee_id, is_active, shopify_variant_id, roaster_sku } = req.body;
  try {
    const current = await db.query(
      `SELECT quantity_available, safety_stock_buffer FROM roaster_blend WHERE id = $1`, [id]
    );
    if (current.rows.length === 0) { res.status(404).json({ error: 'Blend not found' }); return; }

    const nextQty    = quantity_available  ?? current.rows[0].quantity_available;
    const nextBuffer = safety_stock_buffer ?? current.rows[0].safety_stock_buffer;
    const status     = computeInventoryStatus(nextQty, nextBuffer);

    const result = await db.query(
      `UPDATE roaster_blend
       SET quantity_available   = $1,
           safety_stock_buffer  = $2,
           coffee_id            = COALESCE($3, coffee_id),
           inventory_status     = $4,
           is_active            = COALESCE($5, is_active),
           shopify_variant_id   = COALESCE($6, shopify_variant_id),
           roaster_sku          = COALESCE($7, roaster_sku)
       WHERE id = $8
       RETURNING id, blend_name, coffee_id, quantity_available, safety_stock_buffer,
                 inventory_status, is_active, shopify_variant_id, roaster_sku, last_restocked_at`,
      [nextQty, nextBuffer, coffee_id ?? null, status,
       is_active ?? null, shopify_variant_id ?? null, roaster_sku ?? null, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/inventory PATCH]', err);
    res.status(500).json({ error: 'Failed to update inventory' });
  }
});

router.post('/inventory/:id/restock', async (req, res) => {
  const { id } = req.params;
  const amt = Number(req.body.amount);
  if (!Number.isFinite(amt) || amt <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  try {
    const current = await db.query(`SELECT quantity_available, safety_stock_buffer FROM roaster_blend WHERE id = $1`, [id]);
    if (current.rows.length === 0) { res.status(404).json({ error: 'Blend not found' }); return; }
    const nextQty = current.rows[0].quantity_available + amt;
    const status  = computeInventoryStatus(nextQty, current.rows[0].safety_stock_buffer);

    const result = await db.query(
      `UPDATE roaster_blend
       SET quantity_available = $1,
           inventory_status   = $2,
           last_restocked_at  = timezone('utc', now())
       WHERE id = $3
       RETURNING id, blend_name, coffee_id, quantity_available, safety_stock_buffer, inventory_status, last_restocked_at`,
      [nextQty, status, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[admin/inventory restock]', err);
    res.status(500).json({ error: 'Failed to restock' });
  }
});

export default router;
