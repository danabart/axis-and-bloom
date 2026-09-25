import { archetypeUuid, archetypeCode, archetypeLabel } from './catalogReads.js';
import { db, type Tx } from '../db/client.js';
import { interpret, type Interpretation } from './quizScoring.js';
import { scoreAnswerIds } from './quizScorer.js';

/**
 * Resolves an archetype display name (e.g. "Balanced"; legacy names such as
 * "Balanced & Sweet" also resolve, via archetypeCode()) to its
 * archetype.id FK and inserts one quiz_session row for the given profile —
 * the exact write GET /api/users/profile, GET /api/users/homepage-state, and
 * GET /api/quiz/results/latest all read from.
 *
 * Extracted out of POST /api/quiz/results (unchanged behavior there — same
 * two statements, same params) so the Pre-Launch Reveal-in-Inbox match-claim
 * path (POST /api/auth/sync) writes through the exact same persistence
 * instead of inventing a parallel store, per that feature's own instruction.
 * Callers own their own context_data shape — a real quiz completion carries
 * scores/answers; a claimed cross-device match doesn't have those and
 * shouldn't fabricate them.
 */
export async function saveQuizSession(
  profileId: string,
  archetypeName: string,
  contextData: Record<string, unknown>
): Promise<{ sessionId: string; archetypeId: string | null }> {
  const archetypeId = await archetypeUuid(archetypeName);

  const sessionResult = await db.query(
    `INSERT INTO quiz_session (user_id, resulting_archetype_id, context_data)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [profileId, archetypeId, JSON.stringify(contextData)]
  );

  return { sessionId: sessionResult.rows[0].id, archetypeId };
}

// ─── Interpretation (SCD Type 2) — quiz interpretation v2.1, brief 2 ─────────
// quiz_session is the immutable fact; quiz_session_interpretation holds one row per session per
// interpretation version, exactly one flagged is_current. Everything below writes ONLY that table.

type Runner = Pick<Tx, 'query'> | typeof db;

export type InterpretationComputedBy = 'scored' | 'seed' | 'backfill';

// Structural input: a v2.1 `Interpretation` satisfies it, and so does a v1 seed built from context_data.
export interface InterpretationInput {
  interpretationVersion: string;
  secondaryArchetype: string | null;
  secondaryPath?: string | null;
  recommendationMode: string;
  foodSignalAlignment: string;
  pairConfidence?: string | null;
  exploreArchetype?: string | null;
  exploreReason?: string | null;
  primaryMargin?: number | null;
}

export interface SaveInterpretationOptions {
  isCurrent?: boolean;          // default true
  validFrom?: Date;             // default now()
  validTo?: Date | null;        // default null (open)
}

/**
 * Inserts one interpretation row. Idempotent per (session, version): returns true if a row was inserted,
 * false if that version already existed. The partial unique index (one is_current per session) is NOT
 * swallowed: a second current row for a session raises, by design.
 */
export async function saveQuizInterpretation(
  client: Runner,
  sessionId: string,
  interp: InterpretationInput,
  computedBy: InterpretationComputedBy,
  opts: SaveInterpretationOptions = {}
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO quiz_session_interpretation
       (quiz_session_id, interpretation_version, secondary_archetype, secondary_path, recommendation_mode,
        food_signal_alignment, pair_confidence, explore_archetype, explore_reason, primary_margin,
        is_current, valid_from, valid_to, computed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, now()), $13, $14)
     ON CONFLICT (quiz_session_id, interpretation_version) DO NOTHING
     RETURNING id`,
    [
      sessionId, interp.interpretationVersion, interp.secondaryArchetype, interp.secondaryPath ?? null,
      interp.recommendationMode, interp.foodSignalAlignment, interp.pairConfidence ?? null,
      interp.exploreArchetype ?? null, interp.exploreReason ?? null, interp.primaryMargin ?? null,
      opts.isCurrent ?? true, opts.validFrom ?? null, opts.validTo ?? null, computedBy,
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

// coffee_archetype.name for a display name, legacy name or code (what scoreAnswerIds() returns and what
// interpret() compares against). Unknown names pass through unchanged.
export async function canonicalArchetypeName(name: string | null | undefined): Promise<string | null> {
  if (!name) return null;
  const code = await archetypeCode(name);
  return code ? archetypeLabel(code) : name;
}

/**
 * Live path (POST /api/quiz/results): recompute the interpretation server-side from answerIds and store it as
 * the current `scored` row. The client's interpretation fields are never trusted for the table, so a stale
 * browser bundle still lands on the server's ruleset. Returns the stored Interpretation, or null when nothing
 * was stored (no answerIds, nothing scoreable, unknown archetype): the read path then falls back to
 * context_data, exactly as before.
 */
export async function recordScoredInterpretation(
  client: Runner,
  input: { sessionId: string; answerIds: unknown; archetype: string; branchedFrom: string | null | undefined }
): Promise<Interpretation | null> {
  if (!Array.isArray(input.answerIds) || !input.answerIds.length) {
    console.warn(`[quiz/interpretation] session ${input.sessionId} has no answerIds — no interpretation row written`);
    return null;
  }
  const scored = await scoreAnswerIds(input.answerIds as string[]);
  const finalArchetype = await canonicalArchetypeName(input.archetype);
  if (!Object.keys(scored.scores).length || !finalArchetype) {
    console.warn(`[quiz/interpretation] session ${input.sessionId} not scoreable — no interpretation row written`);
    return null;
  }
  const interp = interpret({
    ...scored,
    finalArchetype,
    branchedFrom: await canonicalArchetypeName(input.branchedFrom),
  });
  await saveQuizInterpretation(client, input.sessionId, interp, 'scored');
  return interp;
}

// ── Read side: the current row, with context_data as the fallback ────────────

export interface QuizInterpretationView {
  source: 'table' | 'context_data';
  interpretationVersion: string | null;   // null when it came from context_data (pre-table sessions)
  secondaryArchetype: string | null;
  secondaryPath: string | null;
  recommendationMode: string;
  foodSignalAlignment: string;
  pairConfidence: string | null;
  exploreArchetype: string | null;
  exploreReason: string | null;
  primaryMargin: number | null;
}

// For `SELECT ..., <COLUMNS> FROM quiz_session qs <JOIN>`: the current row's columns, aliased interp_*.
export const CURRENT_INTERPRETATION_JOIN =
  `LEFT JOIN quiz_session_interpretation i ON i.quiz_session_id = qs.id AND i.is_current`;
export const CURRENT_INTERPRETATION_COLUMNS = `
  i.id                     AS interp_id,
  i.interpretation_version AS interp_version,
  i.secondary_archetype    AS interp_secondary_archetype,
  i.secondary_path         AS interp_secondary_path,
  i.recommendation_mode    AS interp_recommendation_mode,
  i.food_signal_alignment  AS interp_food_signal_alignment,
  i.pair_confidence        AS interp_pair_confidence,
  i.explore_archetype      AS interp_explore_archetype,
  i.explore_reason         AS interp_explore_reason,
  i.primary_margin         AS interp_primary_margin`;

/**
 * The current interpretation row when the session has one, else the as-scored snapshot in context_data with the
 * old route defaults. Whole-row precedence, not per-column COALESCE: a v2.1 row whose secondary is legitimately
 * NULL (path 'none') must not resurrect the stale v1 secondary from context_data.
 */
export function resolveInterpretation(row: Record<string, any>, ctx: Record<string, any> | null | undefined): QuizInterpretationView {
  if (row.interp_id) {
    return {
      source: 'table',
      interpretationVersion: row.interp_version,
      secondaryArchetype: row.interp_secondary_archetype ?? null,
      secondaryPath: row.interp_secondary_path ?? null,
      recommendationMode: row.interp_recommendation_mode,
      foodSignalAlignment: row.interp_food_signal_alignment,
      pairConfidence: row.interp_pair_confidence ?? null,
      exploreArchetype: row.interp_explore_archetype ?? null,
      exploreReason: row.interp_explore_reason ?? null,
      primaryMargin: row.interp_primary_margin ?? null,
    };
  }
  const c = ctx ?? {};
  return {
    source: 'context_data',
    interpretationVersion: c.interpretationVersion ?? null,
    secondaryArchetype: c.secondaryArchetype ?? null,
    secondaryPath: c.secondaryPath ?? null,
    recommendationMode: c.recommendationMode ?? 'primary_only',
    foodSignalAlignment: c.foodSignalAlignment ?? 'high',
    pairConfidence: c.pairConfidence ?? null,
    exploreArchetype: c.exploreArchetype ?? null,
    exploreReason: c.exploreReason ?? null,
    primaryMargin: c.primaryMargin ?? null,
  };
}

// GET /api/quiz/results/latest, extracted so it is testable without auth: the latest session row exactly as
// before (qs.* + archetype_name, context_data still raw) plus the current interpretation as top-level keys.
export async function getLatestQuizResult(client: Runner, firebaseUid: string): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    `SELECT qs.*, ar.name AS archetype_name, ${CURRENT_INTERPRETATION_COLUMNS}
     FROM quiz_session qs
     JOIN user_profile up ON up.id = qs.user_id
     LEFT JOIN coffee_archetype ar ON ar.id = qs.resulting_archetype_id
     ${CURRENT_INTERPRETATION_JOIN}
     WHERE up.firebase_uid = $1
     ORDER BY qs.completed_at DESC
     LIMIT 1`,
    [firebaseUid]
  );
  const row = result.rows[0];
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!k.startsWith('interp_')) out[k] = v;
  return { ...out, ...resolveInterpretation(row, row.context_data) };
}
