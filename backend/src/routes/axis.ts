import { Router } from 'express';
import { db } from '../db/client.js';

const router = Router();

// GET /api/axis/vectors
// Returns archetype dimension vectors from v_archetype_vectors, grouped by archetype.
router.get('/vectors', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT archetype, dimension, display_order, min_score, ideal_score, max_score
      FROM v_archetype_vectors
      ORDER BY archetype, display_order
    `);

    const map: Record<string, { name: string; dimensions: object[] }> = {};
    for (const row of result.rows) {
      if (!map[row.archetype]) map[row.archetype] = { name: row.archetype, dimensions: [] };
      map[row.archetype].dimensions.push({
        name:         row.dimension,
        displayOrder: Number(row.display_order),
        min:          Number(row.min_score),
        ideal:        Number(row.ideal_score),
        max:          Number(row.max_score),
      });
    }

    res.json({ archetypes: Object.values(map) });
  } catch (err) {
    console.error('[axis/vectors]', err);
    res.status(500).json({ error: 'Failed to load vectors' });
  }
});

export default router;
