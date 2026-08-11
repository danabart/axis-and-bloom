import { db } from '../db/client.js';

/**
 * Resolves an archetype display name (e.g. "Balanced & Sweet") to its
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
  const archetypeResult = await db.query(`SELECT id FROM archetype WHERE name = $1`, [archetypeName]);
  const archetypeId = archetypeResult.rows[0]?.id ?? null;

  const sessionResult = await db.query(
    `INSERT INTO quiz_session (user_id, resulting_archetype_id, context_data)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [profileId, archetypeId, JSON.stringify(contextData)]
  );

  return { sessionId: sessionResult.rows[0].id, archetypeId };
}
