// One-time script (Profile Part 6, issue A): rebuild users/{uid}/metadata/taste_journey
// archetypeHistory for users whose SQL quiz_session count exceeds their journey-entry
// count. Cause: a since-fixed Firestore path bug silently dropped every taste_journey
// write prior to the fix (see the comment in backend/src/routes/quiz.ts) — SQL is the
// unaffected source of truth for what quizzes actually happened.
//
// Preserves any journey entries that already exist (matched by quizSessionId, keeping
// their real confidenceLevel) and only fills in the SQL sessions missing from the doc.
// Backfilled entries get confidenceLevel: null — that value was never computed for them
// and must not be fabricated. trigger/currentArchetype/evolutionCount/currentStreakCount
// are recomputed from the full merged, chronologically-ordered sequence.
//
// Idempotent: a user is only touched when the doc is missing >=1 SQL session by
// quizSessionId; after backfill every SQL session has a matching entry, so a second run
// is a no-op for that user.
//
// Usage:
//   npx tsx scripts/backfill-taste-journey.ts              (dry run, reports only)
//   npx tsx scripts/backfill-taste-journey.ts --apply       (writes to Firestore)
import 'dotenv/config';
import { firestoreDb, FieldValue } from '../src/services/firebase-admin.js';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../src/db/client.js';

const APPLY = process.argv.includes('--apply');

interface SqlSession {
  id: string;
  completed_at: Date;
  archetype_name: string | null;
}

interface JourneyEntry {
  archetype: string;
  date: Timestamp;
  quizSessionId: string;
  confidenceLevel: 'low' | 'medium' | 'high' | null;
  trigger: 'first_quiz' | 'retake';
}

async function main() {
  const usersResult = await db.query<{ firebase_uid: string; profile_id: string }>(
    `SELECT DISTINCT up.firebase_uid, up.id AS profile_id
     FROM user_profile up
     JOIN quiz_session qs ON qs.user_id = up.id
     WHERE up.firebase_uid IS NOT NULL`
  );

  let usersScanned = 0;
  let usersBackfilled = 0;
  let entriesBackfilled = 0;
  let sessionsSkippedNoArchetype = 0;

  for (const { firebase_uid: uid, profile_id: profileId } of usersResult.rows) {
    usersScanned++;

    const sessionsResult = await db.query<SqlSession>(
      `SELECT qs.id, qs.completed_at, a.name AS archetype_name
       FROM quiz_session qs
       LEFT JOIN archetype a ON a.id = qs.resulting_archetype_id
       WHERE qs.user_id = $1
       ORDER BY qs.completed_at ASC`,
      [profileId]
    );
    const sqlSessions = sessionsResult.rows.filter(s => {
      if (!s.archetype_name) { sessionsSkippedNoArchetype++; return false; }
      return true;
    });
    if (sqlSessions.length === 0) continue;

    const journeyRef = firestoreDb.doc(`users/${uid}/metadata/taste_journey`);
    const journeySnap = await journeyRef.get();
    const existingHistory: any[] = journeySnap.exists ? (journeySnap.data()?.archetypeHistory ?? []) : [];
    const existingBySessionId = new Map<string, any>(
      existingHistory.map(e => [String(e.quizSessionId), e])
    );

    const missingCount = sqlSessions.filter(s => !existingBySessionId.has(String(s.id))).length;
    if (missingCount === 0) continue;

    const merged: JourneyEntry[] = sqlSessions.map((s, i) => {
      const existing = existingBySessionId.get(String(s.id));
      return {
        archetype: s.archetype_name!,
        date: existing?.date ?? Timestamp.fromDate(new Date(s.completed_at)),
        quizSessionId: String(s.id),
        confidenceLevel: existing?.confidenceLevel ?? null,
        trigger: i === 0 ? 'first_quiz' : 'retake',
      };
    });

    let evolutionCount = 1;
    let streak = 1;
    for (let i = 1; i < merged.length; i++) {
      if (merged[i].archetype !== merged[i - 1].archetype) {
        evolutionCount++;
        streak = 1;
      } else {
        streak++;
      }
    }

    console.log(
      `${APPLY ? 'BACKFILL' : '[dry-run]'} uid=${uid} sqlSessions=${sqlSessions.length} ` +
      `existingEntries=${existingHistory.length} missing=${missingCount} ` +
      `-> archetypeHistory=${merged.length} currentArchetype=${merged[merged.length - 1].archetype} ` +
      `evolutionCount=${evolutionCount} currentStreakCount=${streak}`
    );

    usersBackfilled++;
    entriesBackfilled += missingCount;

    if (APPLY) {
      await journeyRef.set({
        currentArchetype: merged[merged.length - 1].archetype,
        currentStreakCount: streak,
        evolutionCount,
        archetypeHistory: merged,
        lastUpdated: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }

  console.log('---');
  console.log(`Mode: ${APPLY ? 'APPLY (wrote to Firestore)' : 'DRY RUN (no writes)'}`);
  console.log(`Users scanned (>=1 quiz session): ${usersScanned}`);
  console.log(`Users needing backfill: ${usersBackfilled}`);
  console.log(`Entries backfilled: ${entriesBackfilled}`);
  console.log(`SQL sessions skipped (no resolved archetype): ${sessionsSkippedNoArchetype}`);
  if (!APPLY && usersBackfilled > 0) {
    console.log('Re-run with --apply to write these changes.');
  }
  console.log('Guest quizzes (never saved to SQL) are unrecoverable and are not represented here.');

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
