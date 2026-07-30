import { db } from '../db/client.js';
import admin, { firestoreDb } from './firebase-admin.js';

// Daily purge of stale anonymous Firebase identities — see
// backend/src/features/guest_identity/CLAUDE_CODE_PROMPT_GUEST_IDENTITY_FOLLOWUP_NAV_AND_CLEANUP.md
// for the full retention policy and rationale. We are on standard Firebase
// Authentication (not Identity Platform), which never auto-deletes anonymous
// users, so this job is the only thing preventing indefinite accumulation.
const BATCH_SIZE = 500;

interface Candidate {
  firebase_uid: string;
}

export async function purgeStaleAnonymousGuests(): Promise<{ checked: number; purged: number; skipped: number }> {
  // No-quiz candidates: created >7 days ago, never took the quiz, never ordered.
  const noQuizResult = await db.query<Candidate>(
    `SELECT up.firebase_uid
     FROM user_profile up
     WHERE up.created_at < now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM quiz_session qs WHERE qs.user_id = up.id)
       AND NOT EXISTS (SELECT 1 FROM "order" o WHERE o.user_id = up.id)
       AND NOT EXISTS (SELECT 1 FROM user_email ue WHERE ue.user_id = up.id AND ue.is_verified = true)
     LIMIT $1`,
    [BATCH_SIZE]
  );

  // Quiz-taken-but-stale candidates: most recent quiz >90 days ago, never ordered.
  const staleQuizResult = await db.query<Candidate>(
    `SELECT up.firebase_uid
     FROM user_profile up
     JOIN (
       SELECT user_id, MAX(completed_at) AS last_quiz
       FROM quiz_session
       GROUP BY user_id
     ) q ON q.user_id = up.id
     WHERE q.last_quiz < now() - interval '90 days'
       AND NOT EXISTS (SELECT 1 FROM "order" o WHERE o.user_id = up.id)
       AND NOT EXISTS (SELECT 1 FROM user_email ue WHERE ue.user_id = up.id AND ue.is_verified = true)
     LIMIT $1`,
    [BATCH_SIZE]
  );

  const candidates = [...noQuizResult.rows, ...staleQuizResult.rows];
  const checked = candidates.length;
  let purged = 0;
  let skipped = 0;

  for (const { firebase_uid: uid } of candidates) {
    // The SQL candidate query is only a cheap pre-filter — a linked (converted)
    // account keeps the same uid, so "still anonymous" must be checked live
    // against Firebase Admin Auth, never inferred from Postgres alone.
    let stillAnonymous: boolean;
    let existsInAuth = true;
    try {
      const userRecord = await admin.auth().getUser(uid);
      stillAnonymous = (userRecord.providerData?.length ?? 0) === 0;
    } catch (err: any) {
      if (err?.code === 'auth/user-not-found') {
        // Already gone from Firebase Auth — safe to clean up Postgres/Firestore remnants too.
        existsInAuth = false;
        stillAnonymous = true;
      } else {
        console.error('[staleGuestCleanup] getUser failed for', uid, err);
        skipped++;
        continue;
      }
    }

    if (!stillAnonymous) {
      // Linked to a real provider since the SQL snapshot — never touch, even
      // though it matched the candidate query.
      skipped++;
      continue;
    }

    if (existsInAuth) {
      try {
        await admin.auth().deleteUser(uid);
      } catch (err: any) {
        if (err?.code !== 'auth/user-not-found') {
          console.error('[staleGuestCleanup] deleteUser failed for', uid, err);
          skipped++;
          continue;
        }
      }
    }

    try {
      await firestoreDb.recursiveDelete(firestoreDb.doc(`users/${uid}`));
    } catch (err) {
      console.error('[staleGuestCleanup] Firestore recursiveDelete failed for', uid, err);
    }

    try {
      await db.query(`DELETE FROM user_profile WHERE firebase_uid = $1`, [uid]);
      purged++;
    } catch (err) {
      // e.g. an unanticipated FK still referencing this user — log and move on
      // rather than aborting the whole batch.
      console.error('[staleGuestCleanup] Postgres delete failed for', uid, err);
      skipped++;
    }
  }

  console.log(`[staleGuestCleanup] checked=${checked} purged=${purged} skipped=${skipped}`);
  return { checked, purged, skipped };
}
