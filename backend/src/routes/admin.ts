import { Router } from 'express';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { generateAndStoreSummary, generateAndStoreAllContent } from './coffees.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';

const router = Router();
router.use(requireAdmin);

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
             aa.archetype, aa.confidence,
             dap.id       AS dial_position_id,
             dap.vocabulary_id AS dial_vocab_id,
             dap.is_default    AS dial_is_default,
             dpv.sort_order    AS dial_position_sort,
             dpv.label         AS dial_label
      FROM coffees c
      LEFT JOIN archetype_assignments aa
        ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
      LEFT JOIN dial_archetype_positions dap
        ON dap.coffee_id = c.id AND dap.archetype = aa.archetype
      LEFT JOIN dial_position_vocabulary dpv
        ON dpv.id = dap.vocabulary_id
      ORDER BY c.id DESC
    `);
    res.json(result.rows);
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
      // Remove all existing dial positions for this coffee (handles archetype change)
      await db.query(`DELETE FROM dial_archetype_positions WHERE coffee_id = $1`, [id]);

      if (dial_is_default) {
        // Clear previous default for same archetype + same roaster
        await db.query(`
          UPDATE dial_archetype_positions
          SET is_default = false
          WHERE archetype = $1
            AND is_default = true
            AND coffee_id IN (
              SELECT c.id FROM coffees c
              WHERE c.roaster = (SELECT roaster FROM coffees WHERE id = $2)
            )
        `, [archetype, id]);
      }

      await db.query(
        `INSERT INTO dial_archetype_positions (coffee_id, archetype, vocabulary_id, is_default)
         VALUES ($1, $2, $3, $4)`,
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
      const result = await db.query(
        `UPDATE dial_archetype_positions SET vocabulary_id = $1 WHERE id = $2 RETURNING id`,
        [vocabulary_id, id]
      );
      if (result.rowCount === 0) { res.status(404).json({ error: 'Position not found' }); return; }
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

// POST /api/admin/dial/relationships — add a hop between two coffees
router.post('/dial/relationships', async (req, res) => {
  const { from_coffee_id, to_coffee_id, dimension_id, direction, hop_type, delta, is_recommended, confidence, notes } = req.body;
  if (!from_coffee_id || !to_coffee_id || !dimension_id || !direction || !hop_type) {
    res.status(400).json({ error: 'from_coffee_id, to_coffee_id, dimension_id, direction, and hop_type are required' }); return;
  }
  try {
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
    res.status(201).json(result.rows[0]);
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

export default router;
