import { db } from '../db/client.js';
import type { Tx } from '../db/client.js';
import { getArchetypes } from './catalogReads.js';
import type { ArchetypeCode } from './catalogService.js';

type Runner = Tx | typeof db;

// Website 9 (2026-11-06, D16; Dana's Q1 = C, Q2): how each family of taste
// relates to the customer's own, and the order The Bloom tabs and the Shop
// sections follow. One function, so the order and the labels never disagree;
// catalogReads.getArchetypeOrder is its projection.
//
//   own       the customer's family.
//   adjacent  a family with bridge hops to hers (v_coffee_archetype_adjacency),
//             else one whose cupped profile sits within
//             param('dimension_delta_significant') of hers on every shared
//             dimension (the same threshold that makes the per-coffee pill
//             read "Outside your comfort zone").
//   distant   a family with no hops whose profile is further than that.
//   null      no evidence either way (no hops, and either family has fewer
//             than param('archetype_profile_min_coffees') cupped coffees or no
//             shared dimension): the family is shown with no label.
//
// Family profiles are pooled from cupped coffees only
// (v_archetype_dimension_profile over v_coffee_dimension_range), never from
// archetype_vector / v_archetype_vectors (Dana, 2026-11-06).
//
// Order: own; adjacent by hops (hop_count desc, avg_confidence desc), then
// adjacent by profile (distance asc); distant (distance asc); unlabelled; every
// tie by coffee_archetype.sort_order. No match (guest, unknown or non-flavor
// code): sort_order, no codes.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_9_REVIEW_FIXES.md

export type RelationshipCode = 'own' | 'adjacent' | 'distant';

export interface RelationshipKind {
  code: RelationshipCode;
  zoneCode: string;
  badgeCode: string;
  customerLabel: string;
  zoneLabel: string;
  badgeLabel: string;
  sortOrder: number;
}

export interface ArchetypeRelationship {
  archetype: ArchetypeCode;
  code: RelationshipCode | null;
  /** what decided it: own, bridge hops, the cupped-profile distance, or nothing */
  basis: 'own' | 'hops' | 'profile' | null;
}

export async function getRelationshipKinds(runner: Runner = db): Promise<RelationshipKind[]> {
  const r = await runner.query<{ code: RelationshipCode; zone_code: string; badge_code: string; customer_label: string; zone_label: string; badge_label: string; sort_order: number }>(
    `SELECT code, zone_code, badge_code, customer_label, zone_label, badge_label, sort_order
       FROM coffee_archetype_relationship_kind ORDER BY sort_order`
  );
  return r.rows.map(k => ({
    code: k.code, zoneCode: k.zone_code, badgeCode: k.badge_code, customerLabel: k.customer_label,
    zoneLabel: k.zone_label, badgeLabel: k.badge_label, sortOrder: Number(k.sort_order),
  }));
}

/** Largest |midpoint difference| over the dimensions both families have; null when there is none. */
export function profileDistance(a: Map<number, number>, b: Map<number, number>): number | null {
  let largest: number | null = null;
  for (const [dim, mid] of a) {
    const other = b.get(dim);
    if (other === undefined) continue;
    largest = Math.max(largest ?? 0, Math.abs(mid - other));
  }
  return largest;
}

export async function getArchetypeRelationships(matchArchetype: string | null, runner: Runner = db): Promise<ArchetypeRelationship[]> {
  const real = (await getArchetypes(runner)).filter(a => a.is_archetype).sort((a, b) => a.sort_order - b.sort_order);
  const own = real.find(a => a.code === matchArchetype);
  if (!own) return real.map(a => ({ archetype: a.code, code: null, basis: null }));

  const adjacency = await runner.query<{ other: string; hop_count: string; avg_confidence: string | null }>(
    `SELECT CASE WHEN archetype_a::text = $1 THEN archetype_b::text ELSE archetype_a::text END AS other, hop_count, avg_confidence
       FROM v_coffee_archetype_adjacency
      WHERE archetype_a::text = $1 OR archetype_b::text = $1`,
    [own.code]
  );
  const edge = new Map(adjacency.rows.map(r => [r.other, { hops: Number(r.hop_count), confidence: r.avg_confidence === null ? null : Number(r.avg_confidence) }]));

  // cupped-coffee profiles per family, and the two thresholds
  const prof = await runner.query<{ archetype: string; dimension_id: number; avg_midpoint: string; coffee_ids: number[] }>(
    `SELECT archetype::text AS archetype, dimension_id, avg_midpoint, coffee_ids
       FROM v_archetype_dimension_profile`
  );
  const p = (await runner.query<{ min_coffees: string; significant: string }>(
    `SELECT param('archetype_profile_min_coffees') AS min_coffees, param('dimension_delta_significant') AS significant`
  )).rows[0];
  const minCoffees = Number(p.min_coffees), significant = Number(p.significant);
  const profiles = new Map<string, { dims: Map<number, number>; coffees: Set<number> }>();
  for (const row of prof.rows) {
    const f = profiles.get(row.archetype) ?? { dims: new Map(), coffees: new Set<number>() };
    f.dims.set(Number(row.dimension_id), Number(row.avg_midpoint));
    (row.coffee_ids ?? []).forEach(id => f.coffees.add(Number(id)));
    profiles.set(row.archetype, f);
  }
  const usable = (code: string) => {
    const f = profiles.get(code);
    return f && f.coffees.size >= minCoffees ? f.dims : null;
  };
  const ownDims = usable(own.code);

  type Row = ArchetypeRelationship & { sort: number; hops: number; confidence: number | null; distance: number | null };
  const rows: Row[] = real.filter(a => a.code !== own.code).map(a => {
    const e = edge.get(a.code);
    const dims = usable(a.code);
    const distance = ownDims && dims ? profileDistance(ownDims, dims) : null;
    const base = { archetype: a.code, sort: a.sort_order, hops: e?.hops ?? 0, confidence: e?.confidence ?? null, distance };
    if (e) return { ...base, code: 'adjacent', basis: 'hops' };
    if (distance === null) return { ...base, code: null, basis: null };
    return { ...base, code: distance > significant ? 'distant' : 'adjacent', basis: 'profile' };
  });

  const group = (r: Row) => r.basis === 'hops' ? 0 : r.code === 'adjacent' ? 1 : r.code === 'distant' ? 2 : 3;
  const byConfidence = (x: number | null, y: number | null) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : y - x);
  const byDistance = (x: number | null, y: number | null) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y);
  rows.sort((a, b) => group(a) - group(b)
    || (group(a) === 0 ? (b.hops - a.hops || byConfidence(a.confidence, b.confidence)) : 0)
    || (group(a) === 1 || group(a) === 2 ? byDistance(a.distance, b.distance) : 0)
    || a.sort - b.sort);

  return [
    { archetype: own.code, code: 'own', basis: 'own' },
    ...rows.map(({ archetype, code, basis }) => ({ archetype, code, basis })),
  ];
}

export interface ArchetypeOrderPayload {
  order: ArchetypeCode[];
  /** matched customers only: one row per family, in `order` */
  relationships?: Array<{ archetype: ArchetypeCode; code: RelationshipCode | null; customerLabel: string | null }>;
  kinds: RelationshipKind[];
}

/** GET /api/coffees/archetype-order: the order, the relationship per family (matched) and the lookup's words. */
export async function getArchetypeOrderPayload(matchArchetype: string | null, runner: Runner = db): Promise<ArchetypeOrderPayload> {
  const [rels, kinds] = await Promise.all([getArchetypeRelationships(matchArchetype, runner), getRelationshipKinds(runner)]);
  const label = new Map(kinds.map(k => [k.code, k.customerLabel]));
  const matched = rels.some(r => r.code === 'own');
  return {
    order: rels.map(r => r.archetype),
    ...(matched ? { relationships: rels.map(r => ({ archetype: r.archetype, code: r.code, customerLabel: r.code ? label.get(r.code) ?? null : null })) } : {}),
    kinds,
  };
}
