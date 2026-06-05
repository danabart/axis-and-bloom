import { Router } from 'express';
import { db } from '../db/client.js';

const router = Router();

// GET /api/coffees — public coffee list with current archetype assignment
router.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT c.id, c.name, c.roaster, c.origin, c.process, c.roast_level,
              aa.archetype, aa.confidence
       FROM coffees c
       LEFT JOIN archetype_assignments aa
             ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
       ORDER BY c.name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[coffees]', err);
    res.status(500).json({ error: 'Failed to fetch coffees' });
  }
});

// GET /api/coffees/:id/flavor-wheel — public flavor wheel for one coffee
router.get('/:id/flavor-wheel', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `SELECT coffee_name, wheel_category, wheel_subcategory, descriptor, source,
              COUNT(*) AS mentions, AVG(intensity) AS avg_intensity
       FROM v_collaborative_flavor_wheel
       WHERE coffee_id = $1
       GROUP BY coffee_name, wheel_category, wheel_subcategory, descriptor, source
       ORDER BY wheel_category, mentions DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[coffees/flavor-wheel]', err);
    res.status(500).json({ error: 'Failed to fetch flavor wheel' });
  }
});

export default router;
