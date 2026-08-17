import { db } from '../db/client.js';

const ARCHETYPE_LABEL: Record<string, string> = {
  chocolate_nutty: 'Chocolate & Nutty',
  balanced_sweet:  'Balanced & Sweet',
  fruity:          'Fruity',
  earthy:          'Earthy',
  floral:          'Floral',
  experimental:    'Experimental',
};

// Archetype's dominant-dimension bucket width — (target_max - target_min) / N vocabulary
// slots. Shared meaningfulness threshold used by getDialSuggestion and the Phase 5
// hop-suggestion endpoint (a delta smaller than one bucket isn't a distinguishable
// difference on that archetype's own scale). Returns null if any lookup misses.
export async function getArchetypeBucketWidth(archetype: string, dimensionId: number): Promise<number | null> {
  const rangeResult = await db.query(
    `SELECT vc.target_min, vc.target_max
     FROM v_archetype_dimension_comparison vc
     JOIN coffee_dimensions cd ON cd.name = vc.dimension
     WHERE vc.archetype = $1 AND cd.id = $2`,
    [ARCHETYPE_LABEL[archetype], dimensionId]
  );
  if (rangeResult.rowCount === 0) return null;
  const { target_min: targetMin, target_max: targetMax } = rangeResult.rows[0];
  if (targetMin === null || targetMax === null) return null;

  const vocabCountResult = await db.query(
    `SELECT COUNT(*) AS n FROM dial_position_vocabulary WHERE archetype = $1 AND dimension_id = $2`,
    [archetype, dimensionId]
  );
  const n = Number(vocabCountResult.rows[0]?.n ?? 0);
  if (n === 0) return null;

  return (Number(targetMax) - Number(targetMin)) / n;
}

export interface HopConflict {
  conflicting_coffee: string;
  note: string;
}

export interface DialSuggestion {
  suggested_vocabulary_id: number;
  suggested_label: string;
  suggested_sort_order: number;
  avg_score: number;
  session_count: number;
  is_outlier: boolean;
  dimension_name: string;
  hop_conflict?: HopConflict;
}

export interface AvgCuppingScore {
  avg_score: number;
  session_count: number;
}

// Shared by getDialSuggestion, findHopConflict, hop validation, and hop suggestions —
// one query shape for "what does this coffee's merged cupping data say about this dimension."
export async function getAvgCuppingScore(coffeeId: number, dimensionId: number): Promise<AvgCuppingScore | null> {
  const result = await db.query(
    `SELECT ROUND(AVG((csv.value_min + csv.value_max) / 2.0), 2) AS avg_score,
            COUNT(DISTINCT cs.session_coffee_id) AS session_count
     FROM cupping_score_values csv
     JOIN cupping_scores cs ON cs.id = csv.cupping_score_id AND cs.is_merged = true
     JOIN cupping_session_coffees scc ON scc.id = cs.session_coffee_id
     WHERE scc.coffee_id = $1 AND csv.dimension_id = $2`,
    [coffeeId, dimensionId]
  );
  const avgScore = result.rows[0]?.avg_score;
  if (avgScore === null || avgScore === undefined) return null;
  return { avg_score: Number(avgScore), session_count: Number(result.rows[0].session_count) };
}

// Batched counterpart to getAvgCuppingScore — identical AVG/join shape (same score
// definition, not a fork), computed for every (coffee, dimension) pair with merged
// cupping data in one query instead of N+1 per-pair calls. Used by the dial graph
// endpoint (GET /api/admin/dial/graph) to annotate every hop's from/to cupping
// average without a query per relationship.
export async function getAvgCuppingScoresBatch(): Promise<Map<string, AvgCuppingScore>> {
  const result = await db.query(
    `SELECT scc.coffee_id, csv.dimension_id,
            ROUND(AVG((csv.value_min + csv.value_max) / 2.0), 2) AS avg_score,
            COUNT(DISTINCT cs.session_coffee_id) AS session_count
     FROM cupping_score_values csv
     JOIN cupping_scores cs ON cs.id = csv.cupping_score_id AND cs.is_merged = true
     JOIN cupping_session_coffees scc ON scc.id = cs.session_coffee_id
     GROUP BY scc.coffee_id, csv.dimension_id`
  );
  const map = new Map<string, AvgCuppingScore>();
  for (const row of result.rows) {
    map.set(`${row.coffee_id}-${row.dimension_id}`, {
      avg_score: Number(row.avg_score),
      session_count: Number(row.session_count),
    });
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
  const hopsResult = await db.query(
    `SELECT
       CASE WHEN dcr.from_coffee_id = $1 THEN dcr.to_coffee_id ELSE dcr.from_coffee_id END AS other_coffee_id,
       CASE WHEN dcr.from_coffee_id = $1 THEN 'from' ELSE 'to' END AS this_side,
       dcr.direction
     FROM dial_coffee_relationships dcr
     WHERE dcr.hop_type = 'within_archetype'
       AND dcr.dimension_id = $2
       AND (dcr.from_coffee_id = $1 OR dcr.to_coffee_id = $1)`,
    [coffeeId, dimensionId]
  );

  for (const hop of hopsResult.rows) {
    const otherCoffeeId: number = hop.other_coffee_id;

    const otherArchResult = await db.query(
      `SELECT 1 FROM archetype_assignments
       WHERE coffee_id = $1 AND archetype = $2 AND superseded_at IS NULL`,
      [otherCoffeeId, archetype]
    );
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
  const archResult = await db.query(
    `SELECT archetype FROM archetype_assignments WHERE coffee_id = $1 AND superseded_at IS NULL`,
    [coffeeId]
  );
  if (archResult.rowCount === 0) return null;
  const archetype: string = archResult.rows[0].archetype;

  const configResult = await db.query(
    `SELECT dac.dominant_dimension_id, dac.is_archetype, cd.name AS dimension_name
     FROM dial_archetype_config dac
     LEFT JOIN coffee_dimensions cd ON cd.id = dac.dominant_dimension_id
     WHERE dac.archetype = $1`,
    [archetype]
  );
  if (configResult.rowCount === 0 || !configResult.rows[0].is_archetype) return null;
  const { dominant_dimension_id: dimensionId, dimension_name: dimensionName } = configResult.rows[0];
  if (!dimensionId) return null;

  const score = await getAvgCuppingScore(coffeeId, dimensionId);
  if (!score) return null;
  const avgScore = score.avg_score;

  const rangeResult = await db.query(
    `SELECT vc.target_min, vc.target_max
     FROM v_archetype_dimension_comparison vc
     JOIN coffee_dimensions cd ON cd.name = vc.dimension
     WHERE vc.archetype = $1 AND cd.id = $2`,
    [ARCHETYPE_LABEL[archetype], dimensionId]
  );
  if (rangeResult.rowCount === 0) return null;
  const { target_min: targetMin, target_max: targetMax } = rangeResult.rows[0];
  if (targetMin === null || targetMax === null) return null;

  const vocabResult = await db.query(
    `SELECT id, sort_order, label
     FROM dial_position_vocabulary
     WHERE archetype = $1 AND dimension_id = $2
     ORDER BY sort_order`,
    [archetype, dimensionId]
  );
  const n = vocabResult.rowCount ?? 0;
  if (n === 0) return null;

  const bucketWidth = (Number(targetMax) - Number(targetMin)) / n;
  const rawBucket = Math.floor((Number(avgScore) - Number(targetMin)) / bucketWidth) + 1;
  const suggestedSortOrder = Math.min(Math.max(rawBucket, 1), n);
  const isOutlier = rawBucket < 1 || rawBucket > n;

  const vocabRow = vocabResult.rows.find(v => v.sort_order === suggestedSortOrder);
  if (!vocabRow) return null;

  const hopConflict = await findHopConflict(coffeeId, archetype, dimensionId, Number(avgScore));

  return {
    suggested_vocabulary_id: vocabRow.id,
    suggested_label: vocabRow.label,
    suggested_sort_order: suggestedSortOrder,
    avg_score: Number(avgScore),
    session_count: score.session_count,
    is_outlier: isOutlier,
    dimension_name: dimensionName,
    ...(hopConflict ? { hop_conflict: hopConflict } : {}),
  };
}

// Phase 5 (dormant infra): records the cupping source's opinion into
// dial_position_signal so it accumulates history as new sessions get merged.
// Never writes to dial_archetype_positions — reuses getDialSuggestion so all
// of its null-guards (no archetype, is_archetype = false, no cupping data,
// no archetype_vector coverage, no vocabulary rows) apply here as no-ops too.
export async function recordCuppingSignal(coffeeId: number): Promise<void> {
  const suggestion = await getDialSuggestion(coffeeId);
  if (!suggestion) return;

  const archResult = await db.query(
    `SELECT archetype FROM archetype_assignments WHERE coffee_id = $1 AND superseded_at IS NULL`,
    [coffeeId]
  );
  const archetype: string | undefined = archResult.rows[0]?.archetype;
  if (!archetype) return;

  const configResult = await db.query(
    `SELECT dominant_dimension_id FROM dial_archetype_config WHERE archetype = $1`,
    [archetype]
  );
  const dimensionId: number | undefined = configResult.rows[0]?.dominant_dimension_id;
  if (!dimensionId) return;

  await db.query('BEGIN');
  try {
    await db.query(
      `UPDATE dial_position_signal
       SET superseded_at = now()
       WHERE coffee_id = $1 AND archetype = $2 AND dimension_id = $3
         AND source = 'cupping' AND superseded_at IS NULL`,
      [coffeeId, archetype, dimensionId]
    );
    await db.query(
      `INSERT INTO dial_position_signal
         (coffee_id, archetype, dimension_id, source, suggested_vocabulary_id, raw_value, sample_size)
       VALUES ($1, $2, $3, 'cupping', $4, $5, $6)`,
      [coffeeId, archetype, dimensionId, suggestion.suggested_vocabulary_id, suggestion.avg_score, suggestion.session_count]
    );
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}
