import { db } from '../db/client.js';

// Customer Blueprint C3, Part B6 — sommelier_evaluation (SQL) replaces
// Firestore users/{uid}/sommelier_evaluations. `outcome` stays a JSONB blob
// (merged via ||, same shallow-merge shape the old Firestore `outcome.*`
// dotted-path update produced) so its field set doesn't need its own schema.

export interface OutcomeFields {
  sessionCompleted?: boolean;
  turnsUsed?: number;
  tokensSpent?: number;
  orderedWithin7Days?: boolean;
  orderedWithin30Days?: boolean;
  feedbackAfterSession?: 'positive' | 'negative' | 'neutral';
  returnedToSommelier?: boolean;
}

export async function writeOutcome(
  _uid: string,
  evaluationId: string,
  fields: Partial<OutcomeFields>
): Promise<void> {
  try {
    const patch = { ...fields, outcomeUpdatedAt: new Date().toISOString() };
    await db.query(
      `UPDATE sommelier_evaluation SET outcome = outcome || $2::jsonb, updated_at = now() WHERE id = $1`,
      [evaluationId, JSON.stringify(patch)]
    );
  } catch (err) {
    console.error('[outcomeTracker] writeOutcome error:', err);
  }
}

export async function updateOrderOutcomes(uid: string, orderedAt: Date): Promise<void> {
  try {
    const sevenDaysAgo = new Date(orderedAt.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(orderedAt.getTime() - 30 * 24 * 60 * 60 * 1000);

    const rows = await db.query<{ id: string; started_at: string | null }>(
      `SELECT se.id, se.started_at
       FROM sommelier_evaluation se
       JOIN user_profile up ON up.id = se.user_id
       WHERE up.firebase_uid = $1 AND se.session_started = true AND se.started_at >= $2
         AND COALESCE((se.outcome ->> 'orderedWithin30Days')::boolean, false) = false`,
      [uid, thirtyDaysAgo]
    );

    for (const row of rows.rows) {
      const sessionAt = row.started_at ? new Date(row.started_at) : new Date(0);
      const update: Partial<OutcomeFields> = { orderedWithin30Days: true };
      if (sessionAt >= sevenDaysAgo) update.orderedWithin7Days = true;
      await writeOutcome(uid, row.id, update);
    }
  } catch (err) {
    console.error('[outcomeTracker] updateOrderOutcomes query failed — orderedWithin7Days/30Days not updated', err);
  }
}

export async function checkReturnedToSommelier(uid: string, currentEvaluationId: string): Promise<void> {
  try {
    const rows = await db.query<{ id: string; outcome: Record<string, unknown> | null }>(
      `SELECT se.id, se.outcome
       FROM sommelier_evaluation se
       JOIN user_profile up ON up.id = se.user_id
       WHERE up.firebase_uid = $1 AND se.session_started = true
       ORDER BY se.started_at DESC
       LIMIT 10`,
      [uid]
    );

    for (const row of rows.rows) {
      if (row.id === currentEvaluationId) continue;
      if (row.outcome?.returnedToSommelier) continue;
      await writeOutcome(uid, row.id, { returnedToSommelier: true });
    }
  } catch (err) {
    console.error('[outcomeTracker] checkReturnedToSommelier query failed — returnedToSommelier not updated', err);
  }
}
