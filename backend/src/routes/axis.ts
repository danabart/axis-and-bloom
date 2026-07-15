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

// GET /api/axis/adjacency — which archetypes count as "adjacent" for the
// compatibility badge's "Worth exploring" tier. Reads v_archetype_adjacency —
// the same hop-derived, admin-curated view already shown on the Bloom Dial
// admin page (AdminDial.tsx) and used by Liam's RAG bridge-hop logic
// (sommelierRag.ts's 'alternatives'/'discovery' focus types query the
// underlying dial_coffee_relationships directly) — not the separate
// archetype_relationship table, which is unused (confirmed 0 rows in
// production; superseded by the real, actively-curated hop graph). Already
// archetype_enum-keyed and symmetric-safe (LEAST/GREATEST pair), so both
// directions are added to the result map. No fallback — sparse/empty is the
// honest current state for a pair with no bridge hop authored yet, not an error.
router.get('/adjacency', async (_req, res) => {
  try {
    const result = await db.query(`SELECT archetype_a, archetype_b FROM v_archetype_adjacency`);

    const adjacency: Record<string, string[]> = {};
    for (const row of result.rows) {
      (adjacency[row.archetype_a] ??= []).push(row.archetype_b);
      (adjacency[row.archetype_b] ??= []).push(row.archetype_a);
    }

    res.json({ adjacency });
  } catch (err) {
    console.error('[axis/adjacency]', err);
    res.json({ adjacency: {} });
  }
});

// GET /api/axis/stats
// Tier-B aggregate stats for The Axis V2 page (data-journey redesign,
// THE_AXIS_REDESIGN_STRATEGY.md §2). Response is aggregates and timestamps
// ONLY — no coffee IDs/names, no coordinates, no dimension data. This is the
// live-layer feed for the map's counters; it must never leak enough to
// reconstruct positions or scoring.
const ARCHETYPE_DISPLAY: Record<string, string> = {
  fruity: 'Fruity',
  floral: 'Floral',
  balanced_sweet: 'Balanced & Sweet',
  chocolate_nutty: 'Chocolate & Nutty',
  earthy: 'Earthy',
};

const STATS_FALLBACK = {
  coffeesMapped: 29,
  archetypes: Object.entries(ARCHETYPE_DISPLAY).map(([key, name]) => ({ key, name, coffeeCount: 0 })),
  connectionCount: 0,
  regionAdjacency: [] as { a: string; b: string; connections: number }[],
  experimentalCount: 0,
  bloomNotesThisMonth: 0,
  positionsRefinedThisQuarter: 0,
  lastTightenedAt: new Date().toISOString(),
};

router.get('/stats', async (_req, res) => {
  try {
    const [
      coffeesMappedResult,
      archetypeResult,
      connectionResult,
      adjacencyResult,
      experimentalResult,
      bloomNotesResult,
      positionsRefinedResult,
      lastTightenedResult,
    ] = await Promise.all([
      db.query(`SELECT COUNT(DISTINCT coffee_id) AS count FROM archetype_assignments WHERE superseded_at IS NULL`),
      db.query(`
        SELECT aa.archetype, COUNT(DISTINCT aa.coffee_id) AS coffee_count
        FROM archetype_assignments aa
        JOIN dial_archetype_config dac ON dac.archetype = aa.archetype
        WHERE aa.superseded_at IS NULL AND dac.is_archetype = true
        GROUP BY aa.archetype
      `),
      db.query(`
        SELECT COUNT(DISTINCT LEAST(from_coffee_id, to_coffee_id) || ':' || GREATEST(from_coffee_id, to_coffee_id)) AS count
        FROM dial_coffee_relationships
      `),
      db.query(`SELECT archetype_a, archetype_b, hop_count FROM v_archetype_adjacency`),
      db.query(`
        SELECT COUNT(DISTINCT cca.coffee_id) AS count
        FROM coffee_category_assignment cca
        JOIN coffee_category cc ON cc.id = cca.category_id
        WHERE cc.code = 'experimental'
      `),
      db.query(`SELECT COUNT(*) AS count FROM user_flavor_feedback WHERE created_at >= date_trunc('month', now())`),
      db.query(`SELECT COUNT(DISTINCT coffee_id) AS count FROM dial_position_signal WHERE computed_at >= date_trunc('quarter', now())`),
      db.query(`
        SELECT GREATEST(
          (SELECT MAX(created_at) FROM dial_coffee_relationships),
          (SELECT MAX(created_at) FROM archetype_assignments WHERE superseded_at IS NULL),
          (SELECT MAX(computed_at) FROM dial_position_signal)
        ) AS last_tightened
      `),
    ]);

    const archetypes = Object.entries(ARCHETYPE_DISPLAY).map(([key, name]) => {
      const row = archetypeResult.rows.find((r: { archetype: string }) => r.archetype === key);
      return { key, name, coffeeCount: row ? Number(row.coffee_count) : 0 };
    });

    const regionAdjacency = adjacencyResult.rows.map((r: { archetype_a: string; archetype_b: string; hop_count: string }) => ({
      a: r.archetype_a,
      b: r.archetype_b,
      connections: Number(r.hop_count),
    }));

    res.json({
      coffeesMapped: Number(coffeesMappedResult.rows[0]?.count ?? STATS_FALLBACK.coffeesMapped),
      archetypes,
      connectionCount: Number(connectionResult.rows[0]?.count ?? STATS_FALLBACK.connectionCount),
      regionAdjacency,
      experimentalCount: Number(experimentalResult.rows[0]?.count ?? STATS_FALLBACK.experimentalCount),
      bloomNotesThisMonth: Number(bloomNotesResult.rows[0]?.count ?? STATS_FALLBACK.bloomNotesThisMonth),
      positionsRefinedThisQuarter: Number(positionsRefinedResult.rows[0]?.count ?? STATS_FALLBACK.positionsRefinedThisQuarter),
      lastTightenedAt: lastTightenedResult.rows[0]?.last_tightened ?? STATS_FALLBACK.lastTightenedAt,
    });
  } catch (err) {
    console.error('[axis/stats]', err);
    res.json(STATS_FALLBACK);
  }
});

export default router;
