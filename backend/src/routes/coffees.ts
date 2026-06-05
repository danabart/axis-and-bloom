import { Router } from 'express';
import { db } from '../db/client.js';
import { getCoffeeSummary } from '../services/claude.js';

const router = Router();

// ── Shared helper: generate + persist a summary for one coffee ───────────────
export async function generateAndStoreSummary(coffeeId: string | number): Promise<string> {
  const [coffeeResult, dimsResult, descriptorResult] = await Promise.all([
    db.query(
      `SELECT c.name, aa.archetype
       FROM coffees c
       LEFT JOIN archetype_assignments aa ON aa.coffee_id = c.id AND aa.superseded_at IS NULL
       WHERE c.id = $1`,
      [coffeeId]
    ),
    db.query(
      `SELECT d.name AS dimension, d.scale_min_label, d.scale_max_label,
              ROUND(AVG(csv.value_min)::numeric, 1) AS avg_min,
              ROUND(AVG(csv.value_max)::numeric, 1) AS avg_max
       FROM cupping_score_values csv
       JOIN cupping_scores cs  ON cs.id = csv.cupping_score_id
       JOIN session_coffees sc ON sc.id = cs.session_coffee_id
       JOIN dimensions d       ON d.id  = csv.dimension_id
       WHERE sc.coffee_id = $1 AND d.is_numeric = true AND csv.value_min IS NOT NULL
       GROUP BY d.id, d.name, d.scale_min_label, d.scale_max_label, d.display_order
       ORDER BY d.display_order`,
      [coffeeId]
    ),
    db.query(
      `SELECT descriptor, COUNT(*) AS mentions
       FROM v_collaborative_flavor_wheel
       WHERE coffee_id = $1
       GROUP BY descriptor ORDER BY mentions DESC LIMIT 8`,
      [coffeeId]
    ),
  ]);

  if (!coffeeResult.rows.length) throw new Error('Coffee not found');

  const coffee = coffeeResult.rows[0];

  const notesResult = await db.query(
    `SELECT cs.overall_notes FROM cupping_scores cs
     JOIN session_coffees sc ON sc.id = cs.session_coffee_id
     WHERE sc.coffee_id = $1 AND cs.overall_notes IS NOT NULL
     ORDER BY cs.id DESC LIMIT 1`,
    [coffeeId]
  );

  const ARCHETYPE_LABEL: Record<string, string> = {
    chocolate_nutty: 'Chocolate & Nutty', balanced_sweet: 'Balanced & Sweet',
    fruity: 'Fruity', earthy: 'Earthy', floral: 'Floral', experimental: 'Experimental',
  };

  const summary = await getCoffeeSummary({
    coffeeName: coffee.name,
    archetype: coffee.archetype ? (ARCHETYPE_LABEL[coffee.archetype] ?? coffee.archetype) : null,
    dimensions: dimsResult.rows.map((r: any) => ({
      dimension: r.dimension,
      avg_min: Number(r.avg_min),
      avg_max: Number(r.avg_max),
      scale_min_label: r.scale_min_label,
      scale_max_label: r.scale_max_label,
    })),
    topDescriptors: descriptorResult.rows.map((r: any) => r.descriptor),
    overallNotes: notesResult.rows[0]?.overall_notes ?? null,
  });

  await db.query(`UPDATE coffees SET ai_summary = $1 WHERE id = $2`, [summary, coffeeId]);
  return summary;
}

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

// GET /api/coffees/:id/dimensions — numeric dimension ranges from cupping scores
router.get('/:id/dimensions', async (req, res) => {
  const { id } = req.params;
  try {
    const [dimsResult, notesResult] = await Promise.all([
      db.query(
        `SELECT d.name AS dimension,
                d.scale_min_label,
                d.scale_max_label,
                d.display_order,
                ROUND(AVG(csv.value_min)::numeric, 1) AS avg_min,
                ROUND(AVG(csv.value_max)::numeric, 1) AS avg_max,
                COUNT(DISTINCT cs.id) AS session_count
         FROM cupping_score_values csv
         JOIN cupping_scores cs    ON cs.id  = csv.cupping_score_id
         JOIN session_coffees sc   ON sc.id  = cs.session_coffee_id
         JOIN dimensions d         ON d.id   = csv.dimension_id
         WHERE sc.coffee_id = $1
           AND d.is_numeric = true
           AND csv.value_min IS NOT NULL
         GROUP BY d.id, d.name, d.scale_min_label, d.scale_max_label, d.display_order
         ORDER BY d.display_order`,
        [id]
      ),
      db.query(
        `SELECT cs.overall_notes, css.session_date
         FROM cupping_scores cs
         JOIN session_coffees sc   ON sc.id  = cs.session_coffee_id
         JOIN cupping_sessions css ON css.id = sc.session_id
         WHERE sc.coffee_id = $1
           AND cs.overall_notes IS NOT NULL
         ORDER BY css.session_date DESC`,
        [id]
      ),
    ]);
    res.json({ dimensions: dimsResult.rows, notes: notesResult.rows });
  } catch (err) {
    console.error('[coffees/dimensions]', err);
    res.status(500).json({ error: 'Failed to fetch dimension data' });
  }
});

// GET /api/coffees/:id/ai-summary — return cached summary or generate + cache
router.get('/:id/ai-summary', async (req, res) => {
  const { id } = req.params;
  try {
    const cached = await db.query(`SELECT ai_summary FROM coffees WHERE id = $1`, [id]);
    if (cached.rows[0]?.ai_summary) {
      res.json({ summary: cached.rows[0].ai_summary });
      return;
    }
    const summary = await generateAndStoreSummary(id);
    res.json({ summary });
  } catch (err) {
    console.error('[coffees/ai-summary]', err);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

export default router;
