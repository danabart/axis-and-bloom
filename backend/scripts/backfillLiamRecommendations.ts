// Liam L3, Part F — backfills customer_liam_recommendation rows for
// pre-existing transcripts by detecting alias mentions in Liam's own past
// assistant messages, exactly like recordTurn()'s live "unmarked mention"
// path (liamWriteBack.ts's detectAliases()), never a marker (none existed in
// past transcripts). Dry-run by default; --apply required to actually write.
// Owner role required (customerFacts.ts's .backfill() variant enforces this
// itself — assertOwner() throws under ab_app).
//
//   npx tsx scripts/backfillLiamRecommendations.ts            (dry run)
//   npx tsx scripts/backfillLiamRecommendations.ts --apply    (writes)
//
// Aliases are resolved AS OF NOW (getAliases()), not as of the original
// conversation — a slot's alias may have moved since, so a miss here is
// possible and counted, never guessed at.
import 'dotenv/config';
import { db, ownerPool, whoAmI } from '../src/db/client.js';
import { firestoreDb } from '../src/services/firebase-admin.js';
import { getAliases } from '../src/services/sommelierRag.js';
import { detectAliases, type AliasCandidate } from '../src/services/liamWriteBack.js';
import { record } from '../src/services/customerFacts.js';

const apply = process.argv.includes('--apply');

interface SessionRow {
  id: number;
  uid: string;
  coffee_ids: number[];
  user_id: string | null;
}

interface Candidate {
  sessionId: number;
  seq: number;
  turn: number;
  messageId: string;
  coffeeId: number;
  occurredAt: Date;
  candidateCoffeeIds: number[];
  userId: string;
}

const PROOF_TABLES: Record<string, string> = {
  quiz_session: 'id', newsletter_subscriber: 'email', sommelier_sessions: 'id',
};

async function proofSnapshot(runner: typeof db): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [t, pk] of Object.entries(PROOF_TABLES)) {
    const r = await runner.query<{ n: string; hash: string | null }>(
      `SELECT count(*)::text AS n, md5(COALESCE(string_agg(${pk}::text, ',' ORDER BY ${pk}), '')) AS hash FROM ${t}`
    );
    out[t] = `${r.rows[0].n}:${r.rows[0].hash}`;
  }
  return out;
}

async function main(): Promise<void> {
  const runner: typeof db = apply ? ownerPool() : db;
  if (apply) {
    const currentUser = await whoAmI(runner);
    if (currentUser === 'ab_app') throw new Error('backfillLiamRecommendations --apply must run under the owner role, not ab_app');
  }

  const before = await proofSnapshot(runner);

  const sessionsResult = await runner.query<{ id: number; uid: string; coffee_ids: unknown; user_id: string | null }>(
    `SELECT ss.id, ss.uid, ss.context_data -> 'coffeeIds' AS coffee_ids, up.id AS user_id
     FROM sommelier_sessions ss
     LEFT JOIN user_profile up ON up.firebase_uid = ss.uid
     WHERE jsonb_typeof(ss.context_data -> 'coffeeIds') = 'array'
       AND jsonb_array_length(ss.context_data -> 'coffeeIds') > 0`
  );

  const sessions: SessionRow[] = sessionsResult.rows.map(r => ({
    id: r.id, uid: r.uid, coffee_ids: (r.coffee_ids as number[]) ?? [], user_id: r.user_id,
  }));

  let messagesScanned = 0;
  let sessionsNoProfile = 0;
  const aliasesUnresolvedCoffeeIds = new Set<number>();
  const candidates: Candidate[] = [];

  for (const session of sessions) {
    if (!session.user_id) { sessionsNoProfile++; continue; }

    const aliasMap = await getAliases(session.coffee_ids, runner);
    const aliasCandidates: AliasCandidate[] = session.coffee_ids
      .filter(id => aliasMap.has(id))
      .map(id => ({ coffeeId: id, alias: aliasMap.get(id)! }));
    for (const id of session.coffee_ids) if (!aliasMap.has(id)) aliasesUnresolvedCoffeeIds.add(id);
    if (!aliasCandidates.length) continue;

    // No .where('role', ...) — a composite index would be needed for
    // role+seq together; every other reader in this codebase (routes/
    // sommelier.ts's GET /:sessionId/messages) also just orders by seq and
    // filters role in JS, so this matches existing practice rather than
    // requesting a new Firestore index for a one-off script.
    const snap = await firestoreDb
      .collection(`users/${session.uid}/sommelier_sessions/${session.id}/messages`)
      .orderBy('seq')
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.role !== 'assistant') continue;
      messagesScanned++;
      const content = data.content as string | undefined;
      if (!content) continue;
      const seq = Number(data.seq ?? 0);
      const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
      const detectedIds = detectAliases(content, aliasCandidates);
      for (const coffeeId of detectedIds) {
        candidates.push({
          sessionId: session.id, seq, turn: Math.floor(seq / 2), messageId: doc.id,
          coffeeId, occurredAt: createdAt, candidateCoffeeIds: session.coffee_ids, userId: session.user_id,
        });
      }
    }
  }

  // Collision check — a prior run (or overlapping live write-back under a
  // different source) already holding this exact (source, source_id).
  let collisions = 0;
  let wouldInsert = 0;
  if (candidates.length) {
    const sourceIds = candidates.map(c => `${c.sessionId}:${c.seq}:detected:${c.coffeeId}`);
    const existing = await runner.query<{ source_id: string }>(
      `SELECT source_id FROM customer_liam_recommendation WHERE source = 'backfill_detected' AND source_id = ANY($1::text[])`,
      [sourceIds]
    );
    const existingSet = new Set(existing.rows.map(r => r.source_id));
    for (const c of candidates) {
      const sourceId = `${c.sessionId}:${c.seq}:detected:${c.coffeeId}`;
      if (existingSet.has(sourceId)) collisions++; else wouldInsert++;
    }

    if (apply) {
      let inserted = 0;
      for (const c of candidates) {
        const sourceId = `${c.sessionId}:${c.seq}:detected:${c.coffeeId}`;
        const result = await record.liamRecommendation.backfill({
          userId: c.userId, source: 'backfill_detected', sourceId,
          occurredAt: c.occurredAt, sessionId: c.sessionId, turn: c.turn, messageId: c.messageId,
          coffeeId: c.coffeeId, candidateCoffeeIds: c.candidateCoffeeIds, palateReadVersion: null, detected: true,
        }, runner);
        if (result.inserted) inserted++;
      }
      console.log(`Applied: ${inserted} rows inserted.`);
    }
  }

  const after = await proofSnapshot(runner);
  const proofOk = JSON.stringify(before) === JSON.stringify(after);

  console.log(`\n${apply ? 'APPLY' : 'DRY RUN'} — Liam L3 backfill`);
  console.log(`sessions with coffeeIds: ${sessions.length}`);
  console.log(`sessions with no user_profile row: ${sessionsNoProfile}`);
  console.log(`messages scanned: ${messagesScanned}`);
  console.log(`rows that would insert: ${wouldInsert}`);
  console.log(`collisions (already recorded): ${collisions}`);
  console.log(`coffee ids with no resolvable alias (as of now): ${aliasesUnresolvedCoffeeIds.size}${aliasesUnresolvedCoffeeIds.size ? ' -> ' + [...aliasesUnresolvedCoffeeIds].join(', ') : ''}`);
  console.log(`proof (quiz_session/newsletter_subscriber/sommelier_sessions untouched): ${proofOk ? 'PASS' : 'FAIL'}`);
  if (!proofOk) {
    console.log('  before:', before);
    console.log('  after: ', after);
  }

  if (apply) await runner.end();
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
