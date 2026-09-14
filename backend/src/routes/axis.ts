import { Router } from 'express';
import { db } from '../db/client.js';
import { getArchetypes } from '../services/catalogReads.js';

const router = Router();

// GET /api/axis/vectors
// Returns archetype dimension vectors from v_archetype_vectors, grouped by
// archetype. Unchanged this brief — target-range data, not a placement
// question, and v_archetype_vectors itself isn't touched by Part A.
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
// compatibility badge's "Worth exploring" tier. Catalog Blueprint brief 3:
// v_archetype_adjacency is now derived from v_coffee_hop (both coffees
// active home-placement archetypes, both is_archetype) — this route is now a
// one-line SELECT rather than re-deriving the same join itself. No
// fallback — sparse/empty is the honest current state for a pair with no
// bridge hop authored yet, not an error.
router.get('/adjacency', async (_req, res) => {
  try {
    const result = await db.query<{ archetype_a: string; archetype_b: string }>(
      `SELECT archetype_a, archetype_b FROM v_archetype_adjacency`
    );

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
//
// Catalog Blueprint brief 3 — archetype counts now come from
// v_coffee.match_archetype (D1: the Axis page reasons about match, not
// placement) instead of a raw archetype_assignments join; hop counts from
// v_coffee_hop (both coffees active) instead of a raw dial_coffee_relationships
// + archetype_assignments join. No hardcoded archetype display-name literals
// anywhere in this file (lint rule 4) — the emergency fallback below uses a
// humanized CODE, not the real business label, since a query failure here
// means getArchetypes() would likely fail too.
function humanizeArchetypeCode(code: string): string {
  return code.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}
const FALLBACK_ARCHETYPE_CODES = ['fruity', 'floral', 'balanced_sweet', 'chocolate_nutty', 'earthy'];

const STATS_FALLBACK = {
  coffeesMapped: 29,
  archetypes: FALLBACK_ARCHETYPE_CODES.map((key) => ({ key, name: humanizeArchetypeCode(key), coffeeCount: 0 })),
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
      db.query(`SELECT COUNT(*) AS count FROM v_coffee WHERE is_active = true AND match_archetype IS NOT NULL`),
      db.query(`
        SELECT vc.match_archetype AS archetype, COUNT(*) AS coffee_count
        FROM v_coffee vc
        JOIN v_coffee_archetype vca ON vca.code = vc.match_archetype
        WHERE vc.is_active = true AND vca.is_archetype = true
        GROUP BY vc.match_archetype
      `),
      db.query(`
        SELECT COUNT(DISTINCT LEAST(from_coffee_id, to_coffee_id) || ':' || GREATEST(from_coffee_id, to_coffee_id)) AS count
        FROM v_coffee_hop
        WHERE from_coffee_is_active = true AND to_coffee_is_active = true
      `),
      db.query(`SELECT archetype_a, archetype_b, hop_count FROM v_archetype_adjacency`),
      db.query(`SELECT COUNT(*) AS count FROM v_coffee WHERE is_active = true AND category_codes && ARRAY['experimental']`),
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

    const realArchetypes = (await getArchetypes()).filter((a) => a.is_archetype);
    const archetypes = realArchetypes.map((a) => {
      const row = archetypeResult.rows.find((r: { archetype: string }) => r.archetype === a.code);
      return { key: a.code, name: a.label, coffeeCount: row ? Number(row.coffee_count) : 0 };
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
