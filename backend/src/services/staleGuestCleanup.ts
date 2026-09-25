import { db } from '../db/client.js';
import admin, { firestoreDb } from './firebase-admin.js';

// Daily purge of stale anonymous Firebase identities — see
// backend/src/features/guest_identity/CLAUDE_CODE_PROMPT_GUEST_IDENTITY_FOLLOWUP_NAV_AND_CLEANUP.md
// for the original retention policy. We are on standard Firebase
// Authentication (not Identity Platform), which never auto-deletes anonymous
// users, so this job is the only thing preventing indefinite accumulation.
//
// Quiz Resync Fix Part D2 (2026-09-25, Dana's decision) — identity yes, data
// no. The two candidate rules below are unchanged, but what gets deleted now
// depends on which one matched:
//   - Never completed a quiz, 7 days old ("empty" guest): unchanged. There is
//     no data behind this identity worth keeping — the Firebase Auth record,
//     the Firestore users/{uid} tree, and the user_profile row (cascading to
//     anything hanging off it) all go, exactly as before.
//   - Completed a quiz, 90 days since their last quiz_session.completed_at
//     ("identity-only" guest): only the Firebase Auth record is deleted —
//     the anonymous identity stops being resumable. No Firestore
//     recursiveDelete, no Postgres DELETE. user_profile, quiz_session,
//     quiz_funnel_event, and newsletter_subscriber rows all survive
//     untouched; only the ability to sign back in as that specific anonymous
//     uid is gone. Raw data is never deleted — mirrors the api_event
//     decision in api_event_log/REPLAY.md.
const BATCH_SIZE = 500;

interface Candidate {
  firebase_uid: string;
}

type CandidateKind = 'empty' | 'identityOnly';

export async function purgeStaleAnonymousGuests(): Promise<{
  checked: number;
  purgedEmpty: number;
  purgedIdentityOnly: number;
  skipped: number;
}> {
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
  // Mutually exclusive with noQuizResult by construction — a row here always
  // has at least one quiz_session, which noQuizResult's NOT EXISTS excludes.
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

  const candidates: { firebase_uid: string; kind: CandidateKind }[] = [
    ...noQuizResult.rows.map(r => ({ firebase_uid: r.firebase_uid, kind: 'empty' as const })),
    ...staleQuizResult.rows.map(r => ({ firebase_uid: r.firebase_uid, kind: 'identityOnly' as const })),
  ];
  const checked = candidates.length;
  let purgedEmpty = 0;
  let purgedIdentityOnly = 0;
  let skipped = 0;

  for (const { firebase_uid: uid, kind } of candidates) {
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
        // Already gone from Firebase Auth — safe to finish this uid's own
        // branch below (empty: clean up Postgres/Firestore remnants too;
        // identityOnly: nothing further to do, the identity is already gone).
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

    if (kind === 'identityOnly') {
      // Identity gone; every row of data stays — no Firestore, no Postgres.
      purgedIdentityOnly++;
      continue;
    }

    try {
      await firestoreDb.recursiveDelete(firestoreDb.doc(`users/${uid}`));
    } catch (err) {
      console.error('[staleGuestCleanup] Firestore recursiveDelete failed for', uid, err);
    }

    try {
      await db.query(`DELETE FROM user_profile WHERE firebase_uid = $1`, [uid]);
      purgedEmpty++;
    } catch (err) {
      // e.g. an unanticipated FK still referencing this user — log and move on
      // rather than aborting the whole batch.
      console.error('[staleGuestCleanup] Postgres delete failed for', uid, err);
      skipped++;
    }
  }

  console.log(`[staleGuestCleanup] checked=${checked} purgedEmpty=${purgedEmpty} purgedIdentityOnly=${purgedIdentityOnly} skipped=${skipped}`);
  return { checked, purgedEmpty, purgedIdentityOnly, skipped };
}
