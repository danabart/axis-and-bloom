import { firestoreDb } from './firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';

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
  uid: string,
  evaluationId: string,
  fields: Partial<OutcomeFields>
): Promise<void> {
  try {
    const update: Record<string, unknown> = {
      'outcome.outcomeUpdatedAt': FieldValue.serverTimestamp(),
    };
    for (const [key, value] of Object.entries(fields)) {
      update[`outcome.${key}`] = value;
    }
    await firestoreDb
      .doc(`users/${uid}/sommelier_evaluations/${evaluationId}`)
      .update(update);
  } catch (err) {
    console.error('[outcomeTracker] writeOutcome error:', err);
  }
}

export async function updateOrderOutcomes(uid: string, orderedAt: Date): Promise<void> {
  try {
    const sevenDaysAgo = new Date(orderedAt.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(orderedAt.getTime() - 30 * 24 * 60 * 60 * 1000);

    const snap = await firestoreDb
      .collection(`users/${uid}/sommelier_evaluations`)
      .where('sessionStarted', '==', true)
      .where('startedAt', '>=', thirtyDaysAgo)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.outcome?.orderedWithin30Days) continue;
      const sessionAt: Date = data.startedAt?.toDate?.() ?? new Date(0);
      const update: Partial<OutcomeFields> = { orderedWithin30Days: true };
      if (sessionAt >= sevenDaysAgo) update.orderedWithin7Days = true;
      await writeOutcome(uid, doc.id, update);
    }
  } catch (err) {
    // HOME_TASK_9B (S89) — this compound query (sessionStarted EQ + startedAt
    // range) needs a composite index that never existed until S88; already
    // logged with the real error attached (unlike the bare catches S88/S89
    // found and fixed elsewhere), upgraded here to the same distinct,
    // greppable [file:TAG] convention (7d/S85's unmissable-log-tag pattern)
    // for consistency across every index-dependent query in this codebase.
    console.error('[outcomeTracker:INDEX_QUERY_FAILED] updateOrderOutcomes query failed — orderedWithin7Days/30Days not updated', err);
  }
}

export async function checkReturnedToSommelier(uid: string, currentEvaluationId: string): Promise<void> {
  try {
    const snap = await firestoreDb
      .collection(`users/${uid}/sommelier_evaluations`)
      .where('sessionStarted', '==', true)
      .orderBy('startedAt', 'desc')
      .limit(10)
      .get();

    for (const doc of snap.docs) {
      if (doc.id === currentEvaluationId) continue;
      const data = doc.data();
      if (!data.sessionStarted || data.outcome?.returnedToSommelier) continue;
      await writeOutcome(uid, doc.id, { returnedToSommelier: true });
    }
  } catch (err) {
    // HOME_TASK_9B (S89) — same index-dependent query class (sessionStarted
    // EQ + startedAt orderBy DESC) as updateOrderOutcomes above; upgraded to
    // the distinct [file:TAG] convention for consistency.
    console.error('[outcomeTracker:INDEX_QUERY_FAILED] checkReturnedToSommelier query failed — returnedToSommelier not updated', err);
  }
}
