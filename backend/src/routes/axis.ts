import { Router } from 'express';
import { db } from '../db/client.js';
import { getAxisStats } from '../services/axisStatsReads.js';

const router = Router();

// GET /api/axis/vectors was removed by coffee presentation brief 2
// (2026-10-24): its only reader was the frontend's compatibility sentence,
// which now comes from GET /api/coffees/:id/compatibility (the archetype's
// actual coffees, not the archetype_vector seed hypothesis).

// GET /api/axis/adjacency — which archetypes count as "adjacent" for the
// compatibility badge's "Worth exploring" tier. Catalog Blueprint brief 3:
// v_coffee_archetype_adjacency is now derived from v_coffee_hop (both coffees
// active home-placement archetypes, both is_archetype) — this route is now a
// one-line SELECT rather than re-deriving the same join itself. No
// fallback — sparse/empty is the honest current state for a pair with no
// bridge hop authored yet, not an error.
router.get('/adjacency', async (_req, res) => {
  try {
    const result = await db.query<{ archetype_a: string; archetype_b: string }>(
      `SELECT archetype_a, archetype_b FROM v_coffee_archetype_adjacency`
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
// Tier-B aggregate stats for The Axis page (THE_AXIS_REDESIGN_STRATEGY.md §2):
// aggregates and timestamps only. Website 6 (2026-11-05): the SQL lives in
// services/axisStatsReads.getAxisStats (G3.1), which adds `originRegions`.
// A failure answers 500: the old fallback answered 200 with typed numbers
// (29 coffees mapped, "last tightened" = now), which the page then showed as
// fact; the page now hides its live lines instead.
router.get('/stats', async (_req, res) => {
  try {
    res.json(await getAxisStats());
  } catch (err) {
    console.error('[axis/stats]', err);
    res.status(500).json({ error: 'Failed to load the map stats' });
  }
});

export default router;
