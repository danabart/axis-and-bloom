// Quiz Resync Fix Part C (2026-09-25) — one-time correction of the
// newsletter_subscriber rows the recognized-guest resync bug drifted during
// the Hoboken Crawl, plus the three uncampaigned crawl-day signups Dana
// called crawl participants. --dry-run (default) never writes anything —
// not to Postgres, not to Mailchimp. --apply requires Dana's explicit go and
// backs up every row it's about to touch first (see backupBeforeApply()).
//
// Note on the brief's own text: it says "restricted to subscribed_at >=
// '2026-09-19'" — newsletter_subscriber has no subscribed_at column; the
// closest real column is created_at (when the row was first written), used
// here instead. Flagged, not silently substituted.
//
// Usage (from backend/, with DATABASE_URL/MAILCHIMP_API_KEY/MAILCHIMP_LIST_ID
// set — see axis_and_bloom_local_cloudsql_testing memory):
//   npx tsx scripts/correct-subscriber-archetypes.ts              (dry run, default)
//   npx tsx scripts/correct-subscriber-archetypes.ts --dry-run    (same, explicit)
//   npx tsx scripts/correct-subscriber-archetypes.ts --apply      (writes — Dana's go only)
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { db } from '../src/db/client.js';
import { toArchetypeSlug, syncMailchimpMember, memberHash, MC_ENABLED } from '../src/features/marketing/mailchimp.js';

const APPLY = process.argv.includes('--apply');
const CUTOVER_CREATED_AT = '2026-09-19T00:00:00Z';
const BACKUP_TABLE = 'newsletter_subscriber_backup_20260925';
const BACKUP_JSON_PATH = path.resolve('tmp', 'subscriber_backup_20260925.json');

// Dana's call, 2026-09-24 audit closing report — the three uncampaigned
// crawl-day signups treated as crawl participants for attribution purposes.
const CAMPAIGN_BACKFILL_EMAILS = ['katelyn.chen@yahoo.com', 'superwawa729@hotmail.com', 'rayraycola6@gmail.com'];
const CAMPAIGN_BACKFILL_SLUG = 'hoboken-crawl-2026';

// Dana's call, 2026-09-25 — of the 3 older (pre-window) mismatches this
// script reports but does not auto-apply, two independently investigated
// (per-email: subscriber archetype, latest quiz_session archetype/date, and
// whether the Balanced-carrying api_event subscribe call's session key has
// zero quiz_complete/quiz_final rows at all) and confirmed to match the
// exact resync-bug signature: chloerosem@gmail.com (qsk 3d00807c…, zero
// funnel rows) and marchon.bea@gmail.com (qsk 7fa3b0bb…, zero funnel rows).
// The third, danabar.mail+dana-try-3@gmail.com, was investigated and found
// genuinely more ambiguous (one of its two Balanced-carrying sessions DOES
// have a quiz_complete row, just for a different archetype, Chocolate &
// Nutty) — and per Dana directly, it's her own manual testing, not real
// subscriber data. Deliberately excluded from this correction.
const OLDER_WINDOW_APPROVED_EMAILS = ['chloerosem@gmail.com', 'marchon.bea@gmail.com'];

interface MismatchRow {
  email: string;
  user_id: string;
  subscriber_archetype: string | null;
  latest_session_archetype: string;
  created_at: string;
}

async function getMailchimpTags(email: string): Promise<string[] | null> {
  if (!MC_ENABLED) return null;
  const MC_API_KEY = (process.env.MAILCHIMP_API_KEY ?? '').trim();
  const MC_DC = MC_API_KEY.split('-')[1] ?? '';
  const MC_LIST_ID = process.env.MAILCHIMP_LIST_ID ?? '';
  const hash = memberHash(email);
  const res = await fetch(`https://${MC_DC}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/members/${hash}`, {
    headers: { Authorization: `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { tags?: { name: string }[] };
  return (body.tags ?? []).map(t => t.name);
}

async function findMismatches(): Promise<{ inWindow: MismatchRow[]; older: MismatchRow[] }> {
  const result = await db.query<MismatchRow>(
    `SELECT ns.email, ns.user_id, ns.archetype AS subscriber_archetype, ca.name AS latest_session_archetype, ns.created_at
     FROM newsletter_subscriber ns
     JOIN user_profile up ON up.id = ns.user_id
     JOIN LATERAL (
       SELECT resulting_archetype_id FROM quiz_session
       WHERE user_id = up.id AND resulting_archetype_id IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1
     ) latest ON true
     JOIN coffee_archetype ca ON ca.id = latest.resulting_archetype_id
     WHERE ns.archetype IS NOT NULL
       AND (ns.archetype IS DISTINCT FROM ca.name)
     ORDER BY ns.created_at`,
  );
  // Slug comparison (not raw name) — the Balanced/"Balanced & Sweet" rename
  // must not show up as a false mismatch.
  const realMismatches = result.rows.filter(
    r => toArchetypeSlug(r.subscriber_archetype ?? '') !== toArchetypeSlug(r.latest_session_archetype),
  );
  const inWindow = realMismatches.filter(r => new Date(r.created_at) >= new Date(CUTOVER_CREATED_AT));
  const older = realMismatches.filter(r => new Date(r.created_at) < new Date(CUTOVER_CREATED_AT));
  return { inWindow, older };
}

async function backupBeforeApply(emails: string[]): Promise<void> {
  const existing = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_name = $1`,
    [BACKUP_TABLE],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    const backedUpEmails = await db.query<{ email: string }>(`SELECT email FROM ${BACKUP_TABLE}`);
    const backedUpSet = new Set(backedUpEmails.rows.map(r => r.email));
    const sameSet = emails.length === backedUpSet.size && emails.every(e => backedUpSet.has(e));
    if (!sameSet) {
      throw new Error(
        `${BACKUP_TABLE} already exists with a different row set — refusing to run. ` +
        `This guards against the script being re-run on top of itself by accident.`
      );
    }
    console.log(`${BACKUP_TABLE} already exists with the same row set — reusing it, not re-creating.`);
    return;
  }
  await db.query(
    `CREATE TABLE ${BACKUP_TABLE} AS SELECT *, now() AS backed_up_at FROM newsletter_subscriber WHERE email = ANY($1::text[])`,
    [emails],
  );
  console.log(`Created ${BACKUP_TABLE} with ${emails.length} row(s).`);

  const rows = await db.query(`SELECT * FROM ${BACKUP_TABLE}`);
  const withTags = [];
  for (const row of rows.rows) {
    withTags.push({ ...row, mailchimp_tags_at_backup: await getMailchimpTags(row.email) });
  }
  fs.mkdirSync(path.dirname(BACKUP_JSON_PATH), { recursive: true });
  fs.writeFileSync(BACKUP_JSON_PATH, JSON.stringify(withTags, null, 2), 'utf-8');
  console.log(`Wrote ${BACKUP_JSON_PATH}`);
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writing to Postgres + Mailchimp)' : 'DRY RUN (no writes)'}`);
  console.log(`Cutover: created_at >= ${CUTOVER_CREATED_AT} (brief's own "subscribed_at" has no matching column — see header comment)`);
  console.log('---');

  const { inWindow, older } = await findMismatches();

  console.log(`Mismatches within window (${inWindow.length}):`);
  for (const r of inWindow) {
    console.log(`  ${r.email}: subscriber="${r.subscriber_archetype}" -> latest quiz_session="${r.latest_session_archetype}" (created_at=${r.created_at})`);
  }
  if (older.length) {
    console.log(`\nOlder mismatches, report-only by default (${older.length}):`);
    for (const r of older) {
      const approved = OLDER_WINDOW_APPROVED_EMAILS.includes(r.email);
      console.log(`  ${r.email}: subscriber="${r.subscriber_archetype}" -> latest quiz_session="${r.latest_session_archetype}" (created_at=${r.created_at}) ${approved ? '— APPROVED 2026-09-25, included in this correction (see OLDER_WINDOW_APPROVED_EMAILS)' : '— NOT included'}`);
    }
  }

  // Dana's decision (2026-09-25), per-email investigated: the primary
  // window's set-match check below stays strict against only the original
  // 6 — OLDER_WINDOW_APPROVED_EMAILS is a separate, explicitly reviewed
  // addition, never silently folded into "the window."
  const toCorrect = [...inWindow, ...older.filter(r => OLDER_WINDOW_APPROVED_EMAILS.includes(r.email))];

  const EXPECTED = ['thyago.teixeira10@gmail.com', 'suzie.houska@yahoo.com', 'maryanndetrizio@gmail.com', 'hannahnyrie@yahoo.com', 'katelyn.chen@yahoo.com', 'superwawa729@hotmail.com'];
  const actualSet = new Set(inWindow.map(r => r.email));
  const expectedSet = new Set(EXPECTED);
  const setsMatch = actualSet.size === expectedSet.size && [...actualSet].every(e => expectedSet.has(e));
  console.log(`\nExpected set match (exactly the 6 named in the brief): ${setsMatch ? 'YES' : 'NO — STOP, do not apply until reconciled'}`);
  if (!setsMatch) {
    console.log(`  Expected: ${EXPECTED.join(', ')}`);
    console.log(`  Actual:   ${[...actualSet].join(', ')}`);
  }
  console.log(`Total rows this run will correct (6 window + ${OLDER_WINDOW_APPROVED_EMAILS.length} approved older): ${toCorrect.length}`);

  console.log('\n--- Mailchimp tags now (read-only GET) ---');
  for (const r of toCorrect) {
    const tags = await getMailchimpTags(r.email);
    console.log(`  ${r.email}: ${tags ? tags.join(', ') : '(MC disabled or member not found)'}`);
  }

  console.log('\n--- Campaign backfill preview (Part 3) ---');
  const campaignResult = await db.query<{ email: string; campaign: string | null }>(
    `SELECT email, campaign FROM newsletter_subscriber WHERE email = ANY($1::text[])`,
    [CAMPAIGN_BACKFILL_EMAILS],
  );
  for (const row of campaignResult.rows) {
    const willChange = row.campaign === null;
    console.log(`  ${row.email}: campaign now="${row.campaign ?? 'null'}" -> ${willChange ? `WOULD SET "${CAMPAIGN_BACKFILL_SLUG}"` : 'unchanged (campaign already set)'}`);
  }

  if (!setsMatch) {
    console.log('\nStopping — the mismatch set does not match the brief\'s expected six. Not applying.');
    await db.end();
    return;
  }

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply (after Dana\'s explicit go) to write these changes.');
    await db.end();
    return;
  }

  // ── --apply path ──
  const allEmails = [...toCorrect.map(r => r.email)];
  await backupBeforeApply(allEmails);

  await db.query('BEGIN');
  try {
    for (const r of toCorrect) {
      await db.query(
        `UPDATE newsletter_subscriber SET archetype = $1 WHERE email = $2`,
        [r.latest_session_archetype, r.email],
      );
      console.log(`Updated ${r.email}: archetype -> "${r.latest_session_archetype}"`);
    }
    for (const email of CAMPAIGN_BACKFILL_EMAILS) {
      const result = await db.query(
        `UPDATE newsletter_subscriber SET campaign = $1, campaign_attributed_at = created_at
         WHERE email = $2 AND campaign IS NULL RETURNING email`,
        [CAMPAIGN_BACKFILL_SLUG, email],
      );
      if (result.rowCount) console.log(`Campaign backfilled: ${email}`);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }

  // Mailchimp: activate archetype:<slug>, inactivate every other archetype:*
  // (syncMailchimpMember + its own replace-not-add computeTagUpdates does this).
  for (const r of toCorrect) {
    const email = r.email;
    const firstNameResult = await db.query<{ first_name: string | null }>(`SELECT first_name FROM newsletter_subscriber WHERE email = $1`, [email]);
    await syncMailchimpMember(email, firstNameResult.rows[0]?.first_name ?? '', { archetype: r.latest_session_archetype });
  }
  for (const email of CAMPAIGN_BACKFILL_EMAILS) {
    const firstNameResult = await db.query<{ first_name: string | null }>(`SELECT first_name FROM newsletter_subscriber WHERE email = $1`, [email]);
    await syncMailchimpMember(email, firstNameResult.rows[0]?.first_name ?? '', { campaign: CAMPAIGN_BACKFILL_SLUG });
  }

  console.log('\n--- After state ---');
  for (const r of toCorrect) {
    const after = await db.query(`SELECT archetype FROM newsletter_subscriber WHERE email = $1`, [r.email]);
    const tags = await getMailchimpTags(r.email);
    console.log(`  ${r.email}: archetype="${after.rows[0]?.archetype}", tags=${tags ? tags.join(', ') : 'n/a'}`);
  }

  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
