// Coffee presentation brief 2 (2026-10-24), Part A — the customer's
// compatibility sentence ("This coffee has slightly more body than your usual
// Chocolate & Nutty profile"), moved from the frontend
// (useCompatibility.getDimensionComparison, which compared a coffee to the
// archetype_vector seed hypothesis) to one backend read that compares a coffee
// to a REFERENCE PROFILE.
// backend/src/features/coffee_presentation/CLAUDE_CODE_PROMPT_COFFEE_PRESENTATION_2.md, decisions 1 to 4.
//
// The reference is swappable and the frontend never chooses it:
//   { kind: 'archetype' }      the pooled midpoints of the archetype's active
//                              coffees (v_archetype_dimension_profile), with the
//                              coffee being compared left out (leave-one-out);
//   { kind: 'customer_bags' }  the customer's own liked bags: declared, not built
//                              (no order data yet), always `not_built`.
// Leave-one-out is recomputed here from the view's coffee_ids against
// v_coffee_dimension_range (one query), rather than a second view column pair:
// the average without the coffee is then exact, not back-derived from a
// rounded mean. Thresholds and the minimum coffee count come from param();
// the archetype label from the archetype read. No number or label is typed here.
import { db, type Tx } from '../db/client.js';
import { getMergedRanges } from './cuppingReads.js';
import { getArchetypes } from './catalogReads.js';

type Runner = Tx | typeof db;

export type ReferenceSpec =
  | { kind: 'archetype'; archetype: string }
  | { kind: 'customer_bags'; canonicalUserId: string };

export interface ReferenceProfile {
  kind: ReferenceSpec['kind'];
  coffee_count: number;
  dimensions: Record<number, { midpoint: number; dimension_name: string; coffee_count: number }>;
}

export type CompareReason = 'ok' | 'below_min_coffees' | 'no_reference' | 'not_built';

export interface Divergence { dimension: string; delta: number; direction: string }

export interface CompareResult {
  sentence: string | null;
  reason: CompareReason;
  coffee_count: number;
  divergences: Divergence[];
}

/**
 * The reference profile, or null when there is none to compare against (an
 * unknown archetype, no cupped coffee in it, or the customer_bags kind, which
 * is not built). `excludeCoffeeId` leaves that coffee out before averaging.
 */
export async function getReferenceProfile(
  reference: ReferenceSpec, opts: { excludeCoffeeId?: number | null } = {}, runner: Runner = db
): Promise<ReferenceProfile | null> {
  if (reference.kind === 'customer_bags') return null;
  const known = (await getArchetypes(runner)).some(a => a.code === reference.archetype);
  if (!known) return null;
  const result = await runner.query<{ dimension_id: number; dimension_name: string; midpoint: string; coffee_ids: number[] }>(
    `SELECT p.dimension_id, p.dimension_name, AVG(r.midpoint) AS midpoint, array_agg(r.coffee_id) AS coffee_ids
       FROM v_archetype_dimension_profile p
       JOIN v_coffee_dimension_range r
         ON r.dimension_id = p.dimension_id AND r.coffee_id = ANY(p.coffee_ids) AND r.midpoint IS NOT NULL
        AND r.coffee_id IS DISTINCT FROM $2
      WHERE p.archetype::text = $1
      GROUP BY p.dimension_id, p.dimension_name`,
    [reference.archetype, opts.excludeCoffeeId ?? null]
  );
  if (!result.rows.length) return null;
  const coffees = new Set<number>();
  const dimensions: ReferenceProfile['dimensions'] = {};
  for (const row of result.rows) {
    row.coffee_ids.forEach(id => coffees.add(Number(id)));
    dimensions[row.dimension_id] = { midpoint: Number(row.midpoint), dimension_name: row.dimension_name, coffee_count: row.coffee_ids.length };
  }
  return { kind: reference.kind, coffee_count: coffees.size, dimensions };
}

/**
 * The compatibility sentence for one coffee against a reference. The three
 * sentence shapes are getDimensionComparison's, word for word; the coffee's
 * midpoints are taken the way the page took them (GET /:id/dimensions rounds
 * each end to one decimal). Renders nothing below
 * param('archetype_profile_min_coffees') reference coffees (counted after the
 * coffee itself is left out).
 */
export async function compareCoffee(coffeeId: number, reference: ReferenceSpec, runner: Runner = db): Promise<CompareResult> {
  const none = (reason: CompareReason, coffee_count = 0): CompareResult => ({ sentence: null, reason, coffee_count, divergences: [] });
  if (reference.kind === 'customer_bags') return none('not_built');

  const profile = await getReferenceProfile(reference, { excludeCoffeeId: coffeeId }, runner);
  if (!profile) return none('no_reference');
  const p = (await runner.query<{ min_coffees: string; slight: string; significant: string }>(
    `SELECT param('archetype_profile_min_coffees') AS min_coffees,
            param('dimension_delta_slight') AS slight, param('dimension_delta_significant') AS significant`
  )).rows[0];
  if (profile.coffee_count < Number(p.min_coffees)) return none('below_min_coffees', profile.coffee_count);

  // a coffee with no numeric cupping range, or none on a dimension the
  // reference has, has nothing to be compared on
  const rows = (await getMergedRanges(coffeeId, runner))
    .filter(r => r.is_numeric && r.value_min !== null && r.value_max !== null && profile.dimensions[r.dimension_id]);
  if (!rows.length) return none('no_reference', profile.coffee_count);

  const slight = Number(p.slight), significant = Number(p.significant);
  const label = (await getArchetypes(runner)).find(a => a.code === reference.archetype)?.label ?? reference.archetype;
  const divergences: Divergence[] = [];
  for (const r of rows) {
    const coffeeMid = (Number(Number(r.value_min).toFixed(1)) + Number(Number(r.value_max).toFixed(1))) / 2;
    const delta = coffeeMid - profile.dimensions[r.dimension_id].midpoint;
    if (Math.abs(delta) < slight) continue;
    const direction = delta > significant ? 'significantly more' : delta > 0 ? 'slightly more'
                    : delta < -significant ? 'significantly less' : 'slightly less';
    divergences.push({ dimension: r.dimension_name.toLowerCase(), delta: Math.round(delta * 100) / 100, direction });
  }

  let sentence: string;
  if (!divergences.length) {
    sentence = `This coffee's profile sits close to your usual ${label} preference.`;
  } else {
    divergences.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const top = divergences.slice(0, 2);
    sentence = top.length === 1
      ? `This coffee has ${top[0].direction} ${top[0].dimension} than your typical ${label} profile.`
      : `This coffee has ${top[0].direction} ${top[0].dimension} and ${top[1].direction} ${top[1].dimension} than your usual ${label} profile.`;
  }
  return { sentence, reason: 'ok', coffee_count: profile.coffee_count, divergences };
}
