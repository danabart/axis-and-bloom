// Website 6 (2026-11-05): The Axis page's live numbers, moved out of
// routes/axis.ts (G3.1: routes call services, services own SQL) with every
// existing field unchanged, plus `originRegions` for the hero's origin list.
// Tier-B aggregates and timestamps ONLY (THE_AXIS_REDESIGN_STRATEGY.md §2): no
// coffee ids or names, no coordinates, no dimension data; nothing here may
// leak enough to reconstruct positions or scoring.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_6_THE_AXIS.md
import { db, type Tx } from '../db/client.js';
import { getArchetypes } from './catalogReads.js';

type Runner = Tx | typeof db;

export interface AxisStats {
  coffeesMapped: number;
  archetypes: { key: string; name: string; coffeeCount: number }[];
  connectionCount: number;
  regionAdjacency: { a: string; b: string; connections: number }[];
  experimentalCount: number;
  bloomNotesThisMonth: number;
  positionsRefinedThisQuarter: number;
  lastTightenedAt: string | null;
  /** Sellable coffees per origin region (v_axis_origin_region_count), lookup order; regions with none are absent. */
  originRegions: { label: string; coffeeCount: number }[];
}

export async function getAxisStats(runner: Runner = db): Promise<AxisStats> {
  const [
    coffeesMappedResult,
    archetypeResult,
    connectionResult,
    adjacencyResult,
    experimentalResult,
    bloomNotesResult,
    positionsRefinedResult,
    lastTightenedResult,
    regionResult,
  ] = await Promise.all([
    // Catalog Blueprint brief 3: archetype counts from v_coffee.match_archetype
    // (D1: the Axis page reasons about match, not placement); hops from v_coffee_hop.
    runner.query(`SELECT COUNT(*) AS count FROM v_coffee WHERE is_active = true AND match_archetype IS NOT NULL`),
    runner.query(`
      SELECT vc.match_archetype AS archetype, COUNT(*) AS coffee_count
      FROM v_coffee vc
      JOIN v_coffee_archetype vca ON vca.code = vc.match_archetype
      WHERE vc.is_active = true AND vca.is_archetype = true
      GROUP BY vc.match_archetype
    `),
    runner.query(`
      SELECT COUNT(DISTINCT LEAST(from_coffee_id, to_coffee_id) || ':' || GREATEST(from_coffee_id, to_coffee_id)) AS count
      FROM v_coffee_hop
      WHERE from_coffee_is_active = true AND to_coffee_is_active = true
    `),
    runner.query(`SELECT archetype_a, archetype_b, hop_count FROM v_coffee_archetype_adjacency`),
    runner.query(`SELECT COUNT(*) AS count FROM v_coffee WHERE is_active = true AND category_codes && ARRAY['experimental']`),
    runner.query(`SELECT COUNT(*) AS count FROM user_flavor_feedback WHERE created_at >= date_trunc('month', now())`),
    runner.query(`SELECT COUNT(DISTINCT coffee_id) AS count FROM dial_position_signal WHERE computed_at >= date_trunc('quarter', now())`),
    runner.query(`
      SELECT GREATEST(
        (SELECT MAX(created_at) FROM coffee_hop),
        (SELECT MAX(created_at) FROM coffee_archetype_assignment WHERE superseded_at IS NULL),
        (SELECT MAX(computed_at) FROM dial_position_signal)
      ) AS last_tightened
    `),
    runner.query<{ region_label: string; coffee_count: number }>(
      `SELECT region_label, coffee_count FROM v_axis_origin_region_count ORDER BY sort_order, region_label`
    ),
  ]);

  const realArchetypes = (await getArchetypes(runner)).filter(a => a.is_archetype);
  const archetypes = realArchetypes.map(a => {
    const row = archetypeResult.rows.find((r: { archetype: string }) => r.archetype === a.code);
    return { key: a.code, name: a.label, coffeeCount: row ? Number(row.coffee_count) : 0 };
  });

  const count = (r: { rows: { count?: string | number }[] }) => Number(r.rows[0]?.count ?? 0);
  const last = lastTightenedResult.rows[0]?.last_tightened as Date | string | null | undefined;

  return {
    coffeesMapped: count(coffeesMappedResult),
    archetypes,
    connectionCount: count(connectionResult),
    regionAdjacency: adjacencyResult.rows.map((r: { archetype_a: string; archetype_b: string; hop_count: string }) => ({
      a: r.archetype_a, b: r.archetype_b, connections: Number(r.hop_count),
    })),
    experimentalCount: count(experimentalResult),
    bloomNotesThisMonth: count(bloomNotesResult),
    positionsRefinedThisQuarter: count(positionsRefinedResult),
    lastTightenedAt: last ? new Date(last).toISOString() : null,
    originRegions: regionResult.rows.map(r => ({ label: r.region_label, coffeeCount: Number(r.coffee_count) })),
  };
}
