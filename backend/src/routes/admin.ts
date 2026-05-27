import { Router } from 'express';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';

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
        (SELECT COUNT(*) FROM coffee_roastery_descriptors)AS roastery_descriptors,
        (SELECT COUNT(*) FROM client_flavor_feedback)     AS client_feedback,
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
             aa.archetype, aa.confidence
      FROM coffees c
      LEFT JOIN archetype_assignments aa
        ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
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
      LEFT JOIN session_coffees sc ON sc.session_id = cs.id
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
      [session_date, brew_method ?? 'filter', location ?? null, session_notes ?? null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[admin/sessions POST]', err);
    res.status(500).json({ error: 'Failed to create session' });
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

export default router;
