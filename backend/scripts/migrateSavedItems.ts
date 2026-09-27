// Customer Blueprint C3, Part B4 — one-time migration of existing Firestore
// saved-item history into the new user_saved_item operating table:
// users/{uid}/liam_saves docs -> kind='recipe'; users/{uid}/dial_events docs
// with trigger='explicit_save' -> kind='dial_slot'. Respects whatever
// removedAt tombstone the existing /remove routes already set. Owner-role
// only (refuses to run as ab_app); --dry-run by default, --apply explicit.
// Firestore is read-only here — nothing is ever deleted or modified there
// (guardrail). The customer_dial_event FACT for each explicit_save is
// already covered by C2's dial-events backfill; this migrates the *saved
// list* (current state), a separate concern.
//
// Idempotent by construction: before each insert, checks whether a row with
// the same (user_id, ref_id, created_at) already exists (the closest thing
// to a natural key available on user_saved_item, which has no source/
// source_id columns — it's an operating table, not a fact) and skips it,
// so a second run never duplicates.
//
// Usage:
//   npx tsx scripts/migrateSavedItems.ts [--dry-run|--apply] [--expect-db <name>]
//
// SAFETY: refuses to run unless the connected database is named exactly
// --expect-db (default 'axisandbloom_test'). Pass --expect-db axisandbloom
// explicitly to run against production.
import 'dotenv/config';
import { ownerPool, whoAmI } from '../src/db/client.js';
import { firestoreDb } from '../src/services/firebase-admin.js';

const db = ownerPool();

function parseArgs(argv: string[]): { apply: boolean; expectDb: string } {
  let apply = false, dryRun = false, expectDb = 'axisandbloom_test';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') apply = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--expect-db') expectDb = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (apply && dryRun) throw new Error('Pass either --dry-run (default) or --apply, not both');
  return { apply, expectDb };
}

function dbNameFromUrl(url: string): string {
  return url.split('?')[0].split('/').pop() ?? '';
}

function tsToDate(ts: unknown, fallback: Date): Date {
  if (ts && typeof (ts as any).toDate === 'function') return (ts as any).toDate();
  return fallback;
}

async function profileIdFor(uid: string): Promise<string | null> {
  const r = await db.query<{ id: string }>(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
  return r.rows[0]?.id ?? null;
}

async function alreadyMigrated(userId: string, refId: string, createdAt: Date): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM user_saved_item WHERE user_id = $1 AND ref_id = $2 AND created_at = $3`,
    [userId, refId, createdAt]
  );
  return r.rows.length > 0;
}

async function sqlSnapshot() {
  const r = await db.query(`SELECT COUNT(*)::int AS n FROM user_saved_item`);
  return Number(r.rows[0].n);
}

// ── recipes (liam_saves) ────────────────────────────────────────────────────
async function migrateRecipes(apply: boolean) {
  const snap = await firestoreDb.collectionGroup('liam_saves').get();
  let inserted = 0, skippedExisting = 0, skippedNoProfile = 0;
  const skippedNoProfileUids: string[] = [];
  const profileCache = new Map<string, string | null>();

  for (const doc of snap.docs) {
    const uid = doc.ref.parent.parent!.id;
    if (!profileCache.has(uid)) profileCache.set(uid, await profileIdFor(uid));
    const profileId = profileCache.get(uid)!;
    if (!profileId) { skippedNoProfile++; if (skippedNoProfileUids.length < 5) skippedNoProfileUids.push(uid); continue; }

    const d = doc.data();
    const createdAt = tsToDate(d.createdAt, new Date());
    const removedAt = d.removedAt ? tsToDate(d.removedAt, createdAt) : null;
    const refId = 'liam_recipe';

    if (await alreadyMigrated(profileId, refId, createdAt)) { skippedExisting++; continue; }

    if (apply) {
      await db.query(
        `INSERT INTO user_saved_item (user_id, kind, ref_id, title, payload, created_at, removed_at)
         VALUES ($1, 'recipe', $2, $3, $4, $5, $6)`,
        [profileId, refId, d.title ?? null, JSON.stringify({ body: d.body ?? null, coffeeName: d.coffeeName ?? null }), createdAt, removedAt]
      );
    }
    inserted++;
  }

  console.log(`\nrecipes (liam_saves) ${apply ? '--apply' : '--dry-run'}:`);
  console.log(`  Firestore liam_saves docs read: ${snap.size}`);
  console.log(`  rows that would insert / inserted: ${inserted}`);
  console.log(`  rows skipped (already migrated): ${skippedExisting}`);
  console.log(`  docs skipped (no profile): ${skippedNoProfile}${skippedNoProfileUids.length ? ` [${skippedNoProfileUids.join(', ')}]` : ''}`);
}

// ── dial_slot (dial_events, trigger = explicit_save) ────────────────────────
// No server-side .where('trigger', ...) — a collectionGroup query on this
// field needs a composite index that doesn't exist (confirmed: FAILED_
// PRECONDITION), the same missing-index bug class documented elsewhere in
// this codebase (HOME_TASK_9B/S88/S89). Filtered in JS instead, same fix.
async function migrateDialSlots(apply: boolean) {
  const snap = await firestoreDb.collectionGroup('dial_events').get();
  const explicitSaveDocs = snap.docs.filter(d => d.data().trigger === 'explicit_save');
  let inserted = 0, skippedExisting = 0, skippedNoProfile = 0;
  const skippedNoProfileUids: string[] = [];
  const profileCache = new Map<string, string | null>();

  for (const doc of explicitSaveDocs) {
    const uid = doc.ref.parent.parent!.id;
    if (!profileCache.has(uid)) profileCache.set(uid, await profileIdFor(uid));
    const profileId = profileCache.get(uid)!;
    if (!profileId) { skippedNoProfile++; if (skippedNoProfileUids.length < 5) skippedNoProfileUids.push(uid); continue; }

    const d = doc.data();
    const createdAt = tsToDate(d.createdAt, new Date());
    const removedAt = d.removedAt ? tsToDate(d.removedAt, createdAt) : null;
    const archetype = d.archetype ?? null;
    const dialSortOrder = typeof d.dialSortOrder === 'number' ? d.dialSortOrder : null;
    const refId = `${archetype}:${dialSortOrder}`;

    if (await alreadyMigrated(profileId, refId, createdAt)) { skippedExisting++; continue; }

    if (apply) {
      await db.query(
        `INSERT INTO user_saved_item (user_id, kind, ref_id, title, payload, created_at, removed_at)
         VALUES ($1, 'dial_slot', $2, $3, $4, $5, $6)`,
        [
          profileId, refId,
          typeof d.platformName === 'string' && d.platformName.trim() ? d.platformName.trim() : null,
          JSON.stringify({ archetype, dialSortOrder, coffeeId: Number.isInteger(d.coffeeId) ? d.coffeeId : null, platformName: d.platformName ?? null }),
          createdAt, removedAt,
        ]
      );
    }
    inserted++;
  }

  console.log(`\ndial_slot (dial_events, explicit_save) ${apply ? '--apply' : '--dry-run'}:`);
  console.log(`  Firestore dial_events docs read: ${snap.size} (${explicitSaveDocs.length} explicit_save)`);
  console.log(`  rows that would insert / inserted: ${inserted}`);
  console.log(`  rows skipped (already migrated): ${skippedExisting}`);
  console.log(`  docs skipped (no profile): ${skippedNoProfile}${skippedNoProfileUids.length ? ` [${skippedNoProfileUids.join(', ')}]` : ''}`);
}

async function main() {
  const { apply, expectDb } = parseArgs(process.argv.slice(2));

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
  console.log(`database: ${expectDb} | connected as: ${currentUser} | mode: ${apply ? 'APPLY (writes)' : 'dry-run (writes nothing)'}`);

  const before = await sqlSnapshot();
  console.log(`\nBefore: user_saved_item has ${before} row(s)`);

  await migrateRecipes(apply);
  await migrateDialSlots(apply);

  const after = await sqlSnapshot();
  console.log(`\nAfter: user_saved_item has ${after} row(s)`);

  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
