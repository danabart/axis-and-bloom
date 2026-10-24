import { db, withTransaction } from '../db/client.js';
import { getArchetypes, getSlots, getCoffee } from './catalogReads.js';
import { getMergedRange, getAllMergedRanges } from './cuppingReads.js';

// getArchetypeBucketWidth (the archetype_vector targets' range / N slots) was
// removed by coffee presentation brief 3 (2026-10-24, Dana's go): the
// suggestion uses bands only and the admin hop suggestions read
// param('hop_suggestion_gap'). Nothing in this module reads archetype_vector.

export interface HopConflict {
  conflicting_coffee: string;
  note: string;
}

export interface DialSuggestion {
  // Catalog Blueprint brief 3 added this alongside the legacy vocabulary id;
  // brief 5a dropped the vocabulary id (dial_position_vocabulary no longer
  // exists) — this is the only suggested-position id now, and the only thing
  // dial_position_signal.suggested_slot_id is written from.
  // Coffee presentation brief 3 (2026-10-24), decision 2: null, with its
  // label and sort order, when a slot of the archetype has no band.
  suggested_slot_id: number | null;
  suggested_label: string | null;
  suggested_sort_order: number | null;
  avg_score: number;
  session_count: number;
  is_outlier: boolean;
  dimension_name: string;
  hop_conflict?: HopConflict;
  // Cupping evidence brief 1 (Dana, 2026-10-17): what the suggested slot rests
  // on. Since coffee presentation brief 3 the only basis is 'spec_band' (every
  // active slot of the archetype has spec_band_lo/hi); null when there is no
  // suggestion. The archetype_vector fallback is gone.
  basis: string | null;
  /** 'no_band' when an active slot of the archetype lacks spec_band_lo/hi, so nothing is suggested */
  reason: 'no_band' | null;
  /** the sort orders of the active slots without a band, ascending (empty when every slot has one) */
  missingBandSlots: number[];
  /** the archetype's label, for the signal's notes */
  archetype_label: string;
}

export interface AvgCuppingScore {
  avg_score: number;
  session_count: number;
}

export const BASIS_SPEC_BAND = 'spec_band';

/** dial_position_signal.notes when nothing is suggested (decision 2). */
export function noBandNote(missingBandSlots: number[], archetypeLabel: string): string {
  return `no suggestion: slot(s) ${missingBandSlots.join(', ')} of ${archetypeLabel} have no band`;
}

// Shared by getDialSuggestion, findHopConflict, hop validation, and hop suggestions —
// one answer to "what does this coffee's merged cupping data say about this dimension."
// Cupping evidence brief 1 (2026-10-18): the midpoint of the current merged
// range (v_coffee_dimension_range through cuppingReads), converted to 0 to
// 15. Brief 6 (2026-10-21): that range is now pooled over every session,
// weighted by rank and recency (evidence_parameter), not the latest alone.
// session_count = sessions with a current merged row. Unmerged evidence
// (cupper rows only) still answers null, as before.
export async function getAvgCuppingScore(coffeeId: number, dimensionId: number): Promise<AvgCuppingScore | null> {
  const range = await getMergedRange(coffeeId, dimensionId);
  if (!range || range.basis !== 'merged' || range.midpoint === null) return null;
  return { avg_score: range.midpoint, session_count: range.n_sessions };
}

// Batched counterpart to getAvgCuppingScore — same definition, every coffee
// and dimension in one read. Used by the dial graph endpoint (GET
// /api/admin/dial/graph) to annotate every hop's from/to cupping average
// without a query per relationship.
export async function getAvgCuppingScoresBatch(): Promise<Map<string, AvgCuppingScore>> {
  const map = new Map<string, AvgCuppingScore>();
  for (const r of await getAllMergedRanges()) {
    if (r.basis !== 'merged' || r.midpoint === null) continue;
    map.set(`${r.coffee_id}-${r.dimension_id}`, { avg_score: r.midpoint, session_count: r.n_sessions });
  }
  return map;
}

// Dial Turn (within_archetype) hops make an ordering claim — direction 'more' means
// to_coffee has more of dimension_id than from_coffee — that the cupping-based
// suggestion also makes a claim about. Cross-checks the two, informational only.
// Returns the first conflicting hop found, or undefined if none / nothing to check.
async function findHopConflict(
  coffeeId: number,
  archetype: string,
  dimensionId: number,
  thisAvgScore: number
): Promise<HopConflict | undefined> {
  // hop_type (stored) dropped by Catalog Blueprint brief 5a (D3) — v_coffee_hop's
  // hop_type_derived (computed live from each endpoint's current home
  // placement) replaces it here, same 'within_archetype' filter.
  const hopsResult = await db.query(
    `SELECT
       CASE WHEN vch.from_coffee_id = $1 THEN vch.to_coffee_id ELSE vch.from_coffee_id END AS other_coffee_id,
       CASE WHEN vch.from_coffee_id = $1 THEN 'from' ELSE 'to' END AS this_side,
       vch.direction
     FROM v_coffee_hop vch
     WHERE vch.hop_type_derived = 'within_archetype'
       AND vch.dimension_id = $2
       AND (vch.from_coffee_id = $1 OR vch.to_coffee_id = $1)`,
    [coffeeId, dimensionId]
  );

  for (const hop of hopsResult.rows) {
    const otherCoffeeId: number = hop.other_coffee_id;

    const otherArchResult = await db.query(
      `SELECT 1 FROM coffee_archetype_assignment aa
       JOIN coffees c ON c.id = aa.coffee_id
       WHERE aa.coffee_id = $1 AND aa.archetype = $2 AND aa.superseded_at IS NULL AND c.is_active = true`,
      [otherCoffeeId, archetype]
    );
    // Roastery lifecycle (2026-08-25): also skips a hop partner that's since
    // gone inactive (its roastery deactivated) — same treatment as "drifted
    // to a different archetype" below, since either way it's no longer a
    // live conflict to raise.
    if (otherArchResult.rowCount === 0) continue; // other coffee has since drifted to a different archetype

    const otherScore = await getAvgCuppingScore(otherCoffeeId, dimensionId);
    if (!otherScore) continue; // no data to compare

    // direction 'more' means to_coffee > from_coffee on this dimension.
    const expectedToIsMore = hop.direction === 'more';
    const thisIsMore = hop.this_side === 'from'
      ? otherScore.avg_score > thisAvgScore
      : thisAvgScore > otherScore.avg_score;

    if (thisIsMore !== expectedToIsMore) {
      const otherCoffeeResult = await db.query(`SELECT name FROM coffees WHERE id = $1`, [otherCoffeeId]);
      return {
        conflicting_coffee: otherCoffeeResult.rows[0]?.name ?? `coffee #${otherCoffeeId}`,
        note: 'Dial Turn data suggests this should be positioned differently relative to '
          + (otherCoffeeResult.rows[0]?.name ?? `coffee #${otherCoffeeId}`)
          + ' than the cupping-based suggestion indicates.',
      };
    }
  }

  return undefined;
}

// Computed live, never persisted or auto-applied. Every step that can fail to
// find a row returns null rather than guessing — see BLOOM_DIAL_ALLOCATION_SPEC.md §3.
export async function getDialSuggestion(coffeeId: number): Promise<DialSuggestion | null> {
  // Catalog Blueprint brief 3: archetype via getCoffee().match_archetype (D1)
  // instead of a raw archetype_assignments query; dominant dimension +
  // is_archetype via getArchetypes() (v_coffee_archetype) instead of a raw
  // dial_archetype_config query.
  const coffee = await getCoffee(coffeeId);
  const archetype = coffee?.match_archetype ?? undefined;
  if (!archetype) return null;

  const archetypeRow = (await getArchetypes()).find((a) => a.code === archetype);
  if (!archetypeRow || !archetypeRow.is_archetype) return null;
  const dimensionId = archetypeRow.dominant_dimension_id;
  const dimensionName = archetypeRow.dominant_dimension_name;
  if (!dimensionId || !dimensionName) return null;

  const score = await getAvgCuppingScore(coffeeId, dimensionId);
  if (!score) return null;
  const avgScore = score.avg_score;

  // Slot count/labels now come from this archetype's dial slots
  // (coffee_dial_slot, via getSlots) rather than dial_position_vocabulary —
  // the two have a 1:1 correspondence, one dial position per slot.
  const slots = await getSlots(archetype);
  const n = slots.length;
  if (n === 0) return null;

  // Cupping evidence brief 1, decision 8 (Dana, 2026-10-17): band-first. When
  // every active slot of the archetype carries spec_band_lo/hi, the suggestion
  // is the slot whose band contains the midpoint (the nearest band when none
  // does, flagged as an outlier). Coffee presentation brief 3 (2026-10-24),
  // decision 2 ("show only data we have, including bands"): otherwise there is
  // no suggestion, reason 'no_band' with the slots that lack one. The
  // archetype_vector fallback (the May 2026 targets split evenly across the
  // slots) is gone; the pooled midpoint is still returned, as evidence.
  const active = slots.filter((s) => s.is_active);
  if (active.length === 0) return null;
  const missingBandSlots = active
    .filter((s) => s.spec_band_lo === null || s.spec_band_hi === null)
    .map((s) => s.sort_order)
    .sort((a, b) => a - b);

  let suggestedSlot: (typeof slots)[number] | null = null;
  let isOutlier = false;
  if (missingBandSlots.length === 0) {
    const distance = (s: (typeof active)[number]) =>
      avgScore < Number(s.spec_band_lo) ? Number(s.spec_band_lo) - avgScore
        : avgScore > Number(s.spec_band_hi) ? avgScore - Number(s.spec_band_hi) : 0;
    const ranked = [...active].sort((a, b) => distance(a) - distance(b) || a.sort_order - b.sort_order);
    suggestedSlot = ranked[0];
    isOutlier = distance(suggestedSlot) > 0;
  }

  const hopConflict = await findHopConflict(coffeeId, archetype, dimensionId, Number(avgScore));

  return {
    suggested_slot_id: suggestedSlot?.id ?? null,
    suggested_label: suggestedSlot?.position_label ?? null,
    suggested_sort_order: suggestedSlot?.sort_order ?? null,
    avg_score: Number(avgScore),
    session_count: score.session_count,
    is_outlier: isOutlier,
    dimension_name: dimensionName,
    basis: suggestedSlot ? BASIS_SPEC_BAND : null,
    reason: suggestedSlot ? null : 'no_band',
    missingBandSlots,
    archetype_label: archetypeRow.label,
    ...(hopConflict ? { hop_conflict: hopConflict } : {}),
  };
}

// Phase 5 (dormant infra): records the cupping source's opinion into
// dial_position_signal so it accumulates history as new sessions get merged.
// Never writes to coffee_slot_assignment — reuses getDialSuggestion so all
// of its null-guards (no archetype, is_archetype = false, no cupping data,
// no active slot) apply here too.
//
// Cupping evidence brief 1 (2026-10-18): called only by
// cuppingService.refreshDialSignal (lint:cupping). Every call first
// supersedes the coffee's current cupping signal(s), whatever archetype they
// were recorded under (an archetype change must not leave the old one
// current), then inserts the new one when getDialSuggestion answers; with
// { retract: true }, or when it answers null, it inserts nothing.
// notes carries the suggestion's basis.
// Coffee presentation brief 3 (2026-10-24), decision 2: a 'no_band' answer is
// still recorded (the pooled midpoint is evidence) with suggested_slot_id
// NULL and notes "no suggestion: slot(s) <n, n> of <archetype> have no band".
export async function recordCuppingSignal(coffeeId: number, opts: { retract?: boolean } = {}): Promise<void> {
  const suggestion = opts.retract ? null : await getDialSuggestion(coffeeId);

  let archetype: string | undefined;
  let dimensionId: number | undefined;
  if (suggestion) {
    // Catalog Blueprint brief 3: same getCoffee/getArchetypes resolution
    // getDialSuggestion above already used, instead of raw archetype_assignments
    // / dial_archetype_config queries.
    const coffee = await getCoffee(coffeeId);
    archetype = coffee?.match_archetype ?? undefined;
    dimensionId = archetype
      ? (await getArchetypes()).find((a) => a.code === archetype)?.dominant_dimension_id ?? undefined
      : undefined;
  }
  // Cupping evidence brief 6, decision 4 (2026-10-21): the midpoint is the
  // pooled one (same read as before); the notes say what it was pooled from.
  const range = suggestion && dimensionId ? await getMergedRange(coffeeId, dimensionId) : null;
  const head = suggestion
    ? suggestion.reason === 'no_band' ? noBandNote(suggestion.missingBandSlots, suggestion.archetype_label) : suggestion.basis
    : null;
  const notes = suggestion
    ? range && range.n_sessions_pooled
      ? `${head}; pooled ${range.n_sessions_pooled} sessions (ratio ${range.rank_ratio}, half-life ${range.half_life_days} d), latest s${range.session_id}`
      : head
    : null;

  // Catalog Blueprint brief 2 (2026-09-14) — last pool-level BEGIN/COMMIT in
  // the codebase, moved onto withTransaction (backend/src/db/client.ts,
  // brief 1) once the retired admin.ts handlers stopped using the pattern.
  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE dial_position_signal
       SET superseded_at = now()
       WHERE coffee_id = $1 AND source = 'cupping' AND superseded_at IS NULL`,
      [coffeeId]
    );
    if (!suggestion || !archetype || !dimensionId) return;
    await tx.query(
      `INSERT INTO dial_position_signal
         (coffee_id, archetype, dimension_id, source, suggested_slot_id, raw_value, sample_size, notes)
       VALUES ($1, $2, $3, 'cupping', $4, $5, $6, $7)`,
      [coffeeId, archetype, dimensionId, suggestion.suggested_slot_id, suggestion.avg_score, suggestion.session_count, notes]
    );
  });
}
