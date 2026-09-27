// Customer Blueprint C2, Part B — one-time backfill of existing Firestore/SQL
// history into the customer_* fact tables C1 created. Owner-role only
// (refuses to run as ab_app); --dry-run by default, --apply explicit; writes
// only through customerFacts.record.*.backfill() (source:'backfill',
// occurredAt = the source's own timestamp, recordedAt = now). Nothing old is
// touched or removed — this is purely additive reads + fact-table inserts.
//
// Usage:
//   npx tsx scripts/backfillCustomerFacts.ts feedback [--dry-run|--apply] [--expect-db <name>]
//   npx tsx scripts/backfillCustomerFacts.ts brew-profile [--dry-run|--apply] [--expect-db <name>]
//   npx tsx scripts/backfillCustomerFacts.ts dial-events [--dry-run|--apply] [--expect-db <name>]
//
// SAFETY: refuses to run unless the connected database is named exactly
// --expect-db (default 'axisandbloom_test', same convention as
// backfillQuizInterpretation.ts). Pass --expect-db axisandbloom explicitly to
// run against production.
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { ownerPool, whoAmI } from '../src/db/client.js';
import { firestoreDb } from '../src/services/firebase-admin.js';
import { record } from '../src/services/customerFacts.js';

const db = ownerPool();

// ── CLI ──────────────────────────────────────────────────────────────────────
type Subcommand = 'feedback' | 'brew-profile' | 'dial-events';
const SUBCOMMANDS: Subcommand[] = ['feedback', 'brew-profile', 'dial-events'];

function parseArgs(argv: string[]): { subcommand: Subcommand; apply: boolean; expectDb: string } {
  const subcommand = argv[0] as Subcommand;
  if (!SUBCOMMANDS.includes(subcommand)) {
    throw new Error(`First argument must be one of: ${SUBCOMMANDS.join(', ')}`);
  }
  let apply = false, dryRun = false, expectDb = 'axisandbloom_test';
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--expect-db') expectDb = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (apply && dryRun) throw new Error('Pass either --dry-run (default) or --apply, not both');
  return { subcommand, apply, expectDb };
}

function dbNameFromUrl(url: string): string {
  return url.split('?')[0].split('/').pop() ?? '';
}

// ── Proof: row count + md5 of the three tables this backfill reads but never
// writes, plus the Firestore doc counts from Task 0 — unchanged before/after. ─
async function sqlSnapshot() {
  const out: Record<string, { n: number; hash: string }> = {};
  for (const t of ['quiz_session', 'newsletter_subscriber', 'user_flavor_feedback']) {
    const r = await db.query(`SELECT COUNT(*) AS n, md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS hash FROM ${t} x`);
    out[t] = { n: Number(r.rows[0].n), hash: r.rows[0].hash };
  }
  return out;
}

async function firestoreVolumes() {
  const [feedbackSnap, metadataSnap, dialSnap] = await Promise.all([
    firestoreDb.collectionGroup('feedback_events').get(),
    firestoreDb.collectionGroup('metadata').get(),
    firestoreDb.collectionGroup('dial_events').get(),
  ]);
  return {
    feedbackEvents: feedbackSnap.size,
    feedbackEventsSuperseded: feedbackSnap.docs.filter(d => d.data().supersededAt != null).length,
    brewProfileDocs: metadataSnap.docs.filter(d => d.id === 'brew_profile').length,
    dialEvents: dialSnap.size,
  };
}

function printSnapshot(label: string, sql: Awaited<ReturnType<typeof sqlSnapshot>>, fs: Awaited<ReturnType<typeof firestoreVolumes>>) {
  console.log(`\n${label}:`);
  for (const [t, v] of Object.entries(sql)) console.log(`  ${t}: ${v.n} rows, md5 ${v.hash}`);
  console.log(`  Firestore feedback_events: ${fs.feedbackEvents} (${fs.feedbackEventsSuperseded} superseded), brew_profile: ${fs.brewProfileDocs}, dial_events: ${fs.dialEvents}`);
}

async function profileIdFor(uid: string): Promise<string | null> {
  const r = await db.query<{ id: string }>(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
  return r.rows[0]?.id ?? null;
}

function tsToDate(ts: unknown, fallback: Date): Date {
  if (ts && typeof (ts as any).toDate === 'function') return (ts as any).toDate();
  return fallback;
}

// ── feedback ─────────────────────────────────────────────────────────────────
async function runFeedback(apply: boolean) {
  const feedbackSnap = await firestoreDb.collectionGroup('feedback_events').get();

  let inserted = 0, collided = 0, eventsInserted = 0, descriptorsInserted = 0;
  const skippedNoProfile: string[] = [];
  const skippedNoCoffee: string[] = [];

  // Group by (uid, orderId) to reconstruct supersede chains by createdAt order
  // — each doc with a later sibling for the same order is superseded by it.
  type Doc = { id: string; uid: string; data: FirebaseFirestore.DocumentData };
  const byOrder = new Map<string, Doc[]>();
  for (const doc of feedbackSnap.docs) {
    const uid = doc.ref.parent.parent!.id;
    const orderId = doc.data().orderId ?? `__no_order__:${doc.id}`;
    const key = `${uid}:${orderId}`;
    if (!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key)!.push({ id: doc.id, uid, data: doc.data() });
  }

  const profileCache = new Map<string, string | null>();
  const coffeeCache = new Map<string, number | null>();

  for (const [key, docs] of byOrder) {
    docs.sort((a, b) => tsToDate(a.data.createdAt, new Date(0)).getTime() - tsToDate(b.data.createdAt, new Date(0)).getTime());
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const uid = doc.uid;
      const d = doc.data;

      if (!profileCache.has(uid)) profileCache.set(uid, await profileIdFor(uid));
      const profileId = profileCache.get(uid)!;
      if (!profileId) { if (skippedNoProfile.length < 5) skippedNoProfile.push(doc.id); continue; }

      let coffeeId: number | null = null;
      if (d.blendId) {
        const cacheKey = String(d.blendId);
        if (!coffeeCache.has(cacheKey)) {
          const r = await db.query<{ coffee_id: number }>(`SELECT coffee_id FROM coffee_sku WHERE id = $1`, [d.blendId]);
          coffeeCache.set(cacheKey, r.rows[0]?.coffee_id ?? null);
        }
        coffeeId = coffeeCache.get(cacheKey)!;
      }
      if (!coffeeId) { if (skippedNoCoffee.length < 5) skippedNoCoffee.push(doc.id); continue; }

      const orderId: string | null = d.orderId ?? null;
      const orderLineItemId = orderId ? await orderLineForOrderBackfill(orderId) : null;
      const supersedesId = i > 0 ? await feedbackEventIdForDocId(docs[i - 1].id) : null;
      const channel: 'onsite' | 'sms' = d.source === 'sms' ? 'sms' : 'onsite';
      const occurredAt = tsToDate(d.createdAt, new Date());

      if (apply) {
        const result = await record.feedback.backfill({
          userId: profileId, source: 'backfill', sourceId: doc.id, occurredAt,
          orderLineItemId, coffeeId, rating: d.rating ?? null, expectation: d.expectation ?? null,
          rawText: d.rawText ?? null, channel, supersedesId,
        }, db);
        if (result.inserted) { inserted++; eventsInserted++; } else collided++;

        if (result.id) {
          const tastedNoteIds: string[] = Array.isArray(d.tastedNoteIds) ? d.tastedNoteIds : [];
          const uffNotes = orderId
            ? (await db.query<{ cupping_note_id: string }>(`SELECT DISTINCT cupping_note_id FROM user_flavor_feedback WHERE user_id = $1 AND order_id = $2`, [profileId, orderId])).rows.map(r => r.cupping_note_id)
            : [];
          const allNoteIds = [...new Set([...tastedNoteIds, ...uffNotes])];
          for (const noteId of allNoteIds) {
            const r = await record.feedbackDescriptor.backfill({
              userId: profileId, source: 'backfill', occurredAt, feedbackEventId: result.id, cuppingNoteId: noteId,
            }, db);
            if (r.inserted) descriptorsInserted++;
          }
        }
      } else {
        inserted++; // would-insert count in dry-run
      }
    }
  }

  // user_flavor_feedback rows with no matching Firestore doc (should be none;
  // counted, not assumed). Firestore isn't queryable from SQL, so this is an
  // application-side cross-check: any order_id that has real
  // user_flavor_feedback rows but was never seen as a feedback_events doc's
  // orderId anywhere in Firestore.
  const seenOrderIds = new Set(feedbackSnap.docs.map(d => d.data().orderId).filter(Boolean));
  const uffOrders = await db.query<{ user_id: string; order_id: string; coffee_id: number; created_at: Date }>(
    `SELECT DISTINCT ON (user_id, order_id) user_id, order_id, coffee_id, created_at FROM user_flavor_feedback WHERE order_id IS NOT NULL ORDER BY user_id, order_id, created_at`
  );
  let orphanCount = 0;
  for (const row of uffOrders.rows) {
    if (seenOrderIds.has(row.order_id)) continue;
    orphanCount++;
    if (apply) {
      const result = await record.feedback.backfill({
        userId: row.user_id, source: 'backfill', sourceId: `uff:${row.order_id}`, occurredAt: row.created_at,
        orderLineItemId: await orderLineForOrderBackfill(row.order_id), coffeeId: row.coffee_id, rating: null,
        channel: 'onsite',
      }, db);
      if (result.inserted) { inserted++; eventsInserted++; } else collided++;
    } else {
      inserted++;
    }
  }

  console.log(`\nfeedback ${apply ? '--apply' : '--dry-run'}:`);
  console.log(`  Firestore feedback_events docs read: ${feedbackSnap.size}`);
  console.log(`  user_flavor_feedback orphan orders (no matching Firestore doc): ${orphanCount}`);
  console.log(`  rows that would insert / inserted: ${inserted}`);
  console.log(`  rows that would collide / collided: ${collided}`);
  console.log(`  docs skipped (no profile): ${skippedNoProfile.length}${skippedNoProfile.length ? ` [${skippedNoProfile.join(', ')}]` : ''}`);
  console.log(`  docs skipped (unresolvable coffee): ${skippedNoCoffee.length}${skippedNoCoffee.length ? ` [${skippedNoCoffee.join(', ')}]` : ''}`);
  if (apply) {
    const eventSources = await db.query(`SELECT source, COUNT(*) FROM customer_feedback_event GROUP BY source`);
    const descSources = await db.query(`SELECT source, COUNT(*) FROM customer_feedback_descriptor GROUP BY source`);
    console.log(`  customer_feedback_event by source:`, eventSources.rows);
    console.log(`  customer_feedback_descriptor by source:`, descSources.rows);
    console.log(`  events inserted this run: ${eventsInserted}, descriptors inserted this run: ${descriptorsInserted}`);
  }
}

async function orderLineForOrderBackfill(orderId: string): Promise<string | null> {
  const r = await db.query<{ id: string }>(`SELECT id FROM order_line_item WHERE order_id = $1`, [orderId]);
  return r.rows.length === 1 ? r.rows[0].id : null;
}

async function feedbackEventIdForDocId(docId: string): Promise<string | null> {
  const r = await db.query<{ id: string }>(`SELECT id FROM customer_feedback_event WHERE source = 'backfill' AND source_id = $1`, [docId]);
  return r.rows[0]?.id ?? null;
}

// ── brew-profile ─────────────────────────────────────────────────────────────
async function runBrewProfile(apply: boolean) {
  const metadataSnap = await firestoreDb.collectionGroup('metadata').get();
  const brewProfileDocs = metadataSnap.docs.filter(d => d.id === 'brew_profile');

  let inserted = 0, collided = 0, fellThroughToNow = 0;
  const skippedNoProfile: string[] = [];
  const skippedUnknownField: string[] = [];
  const profileCache = new Map<string, string | null>();

  for (const doc of brewProfileDocs) {
    const uid = doc.ref.parent.parent!.id;
    if (!profileCache.has(uid)) profileCache.set(uid, await profileIdFor(uid));
    const profileId = profileCache.get(uid)!;
    if (!profileId) { if (skippedNoProfile.length < 5) skippedNoProfile.push(uid); continue; }

    const data = doc.data();
    const docUpdatedAt = tsToDate(data.updatedAt, new Date());
    for (const [field, entry] of Object.entries(data)) {
      if (field === 'updatedAt' || !entry || typeof entry !== 'object') continue;
      const e = entry as { value?: unknown; source?: string; capturedAt?: unknown };
      const KNOWN_FIELDS = ['brew_methods', 'grinder', 'takes_it', 'decaf_constraint', 'aversions'];
      if (!KNOWN_FIELDS.includes(field)) { if (skippedUnknownField.length < 5) skippedUnknownField.push(`${uid}:${field}`); continue; }

      let occurredAt: Date;
      if (e.capturedAt) occurredAt = tsToDate(e.capturedAt, docUpdatedAt);
      else if (data.updatedAt) occurredAt = docUpdatedAt;
      else { occurredAt = new Date(); fellThroughToNow++; }

      const originalSource = e.source === 'conversation' ? 'conversation' : 'profile_page';
      const capturedEpoch = Math.floor(occurredAt.getTime() / 1000);
      const sourceId = `${uid}:${field}:${originalSource}:${capturedEpoch}`;

      if (apply) {
        const result = await record.brewProfileChange.backfill({
          userId: profileId, source: 'backfill', sourceId, occurredAt,
          field: field as any, op: 'set', value: JSON.stringify(e.value ?? null),
        }, db);
        if (result.inserted) inserted++; else collided++;
      } else {
        inserted++;
      }
    }
  }

  console.log(`\nbrew-profile ${apply ? '--apply' : '--dry-run'}:`);
  console.log(`  Firestore brew_profile docs read: ${brewProfileDocs.length}`);
  console.log(`  rows that would insert / inserted: ${inserted}`);
  console.log(`  rows that would collide / collided: ${collided}`);
  console.log(`  fields with no capturedAt and no doc updatedAt (used now()): ${fellThroughToNow}`);
  console.log(`  docs skipped (no profile): ${skippedNoProfile.length}${skippedNoProfile.length ? ` [${skippedNoProfile.join(', ')}]` : ''}`);
  console.log(`  fields skipped (unknown field): ${skippedUnknownField.length}${skippedUnknownField.length ? ` [${skippedUnknownField.join(', ')}]` : ''}`);
  if (apply) {
    const sources = await db.query(`SELECT source, COUNT(*) FROM customer_brew_profile_change GROUP BY source`);
    console.log(`  customer_brew_profile_change by source:`, sources.rows);
  }
}

// ── dial-events ──────────────────────────────────────────────────────────────
async function runDialEvents(apply: boolean) {
  const dialSnap = await firestoreDb.collectionGroup('dial_events').get();

  let inserted = 0, collided = 0;
  const skippedNoProfile: string[] = [];
  const profileCache = new Map<string, string | null>();

  for (const doc of dialSnap.docs) {
    const uid = doc.ref.parent.parent!.id;
    if (!profileCache.has(uid)) profileCache.set(uid, await profileIdFor(uid));
    const profileId = profileCache.get(uid)!;
    if (!profileId) { if (skippedNoProfile.length < 5) skippedNoProfile.push(doc.id); continue; }

    const d = doc.data();
    const occurredAt = tsToDate(d.createdAt, new Date());
    let slotId: number | null = null;
    if (d.archetype && Number.isInteger(d.dialSortOrder)) {
      const r = await db.query<{ id: number }>(`SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = $2`, [d.archetype, d.dialSortOrder]);
      slotId = r.rows[0]?.id ?? null;
    }

    if (apply) {
      const result = await record.dialEvent.backfill({
        userId: profileId, source: 'backfill', sourceId: doc.id, occurredAt,
        eventType: d.trigger, slotId, coffeeId: Number.isInteger(d.coffeeId) ? d.coffeeId : null, archetypeCode: d.archetype ?? null,
      }, db);
      if (result.inserted) inserted++; else collided++;
    } else {
      inserted++;
    }
  }

  console.log(`\ndial-events ${apply ? '--apply' : '--dry-run'}:`);
  console.log(`  Firestore dial_events docs read: ${dialSnap.size}`);
  console.log(`  rows that would insert / inserted: ${inserted}`);
  console.log(`  rows that would collide / collided: ${collided}`);
  console.log(`  docs skipped (no profile): ${skippedNoProfile.length}${skippedNoProfile.length ? ` [${skippedNoProfile.join(', ')}]` : ''}`);
  if (apply) {
    const sources = await db.query(`SELECT source, COUNT(*) FROM customer_dial_event GROUP BY source`);
    console.log(`  customer_dial_event by source:`, sources.rows);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { subcommand, apply, expectDb } = parseArgs(process.argv.slice(2));

  const url = process.env.DATABASE_URL ?? '';
  const urlDb = dbNameFromUrl(url);
  if (urlDb !== expectDb) {
    console.error(`REFUSING: DATABASE_URL points at database '${urlDb || '(unset)'}', expected '${expectDb}'. Nothing was connected to.`);
    process.exit(3);
  }

  const currentUser = await whoAmI(db);
  if (currentUser === 'ab_app') {
    console.error(`REFUSING: connected as ab_app. Backfills run under the owner role.`);
    process.exit(3);
  }
  console.log(`database: ${expectDb} | connected as: ${currentUser} | mode: ${apply ? 'APPLY (writes)' : 'dry-run (writes nothing)'} | subcommand: ${subcommand}`);

  const before = { sql: await sqlSnapshot(), fs: await firestoreVolumes() };
  printSnapshot('Before', before.sql, before.fs);

  if (subcommand === 'feedback') await runFeedback(apply);
  else if (subcommand === 'brew-profile') await runBrewProfile(apply);
  else if (subcommand === 'dial-events') await runDialEvents(apply);

  const after = { sql: await sqlSnapshot(), fs: await firestoreVolumes() };
  printSnapshot('After', after.sql, after.fs);

  for (const t of ['quiz_session', 'newsletter_subscriber', 'user_flavor_feedback'] as const) {
    if (before.sql[t].n !== after.sql[t].n || before.sql[t].hash !== after.sql[t].hash) {
      console.error(`PROOF FAILED: ${t} changed (this backfill must never write it)`);
      process.exit(4);
    }
  }
  if (JSON.stringify(before.fs) !== JSON.stringify(after.fs)) {
    console.error('PROOF FAILED: Firestore doc counts changed (this backfill must never write Firestore)');
    process.exit(4);
  }
  console.log('\nProof: quiz_session / newsletter_subscriber / user_flavor_feedback / Firestore doc counts unchanged.');

  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
