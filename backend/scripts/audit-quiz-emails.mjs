// Hoboken Crawl quiz-result vs email audit — READ-ONLY.
// backend/src/features/quiz_email_audit/CLAUDE_CODE_PROMPT_QUIZ_EMAIL_AUDIT.md
//
// SELECT-only against prod Postgres, GET-only against Mailchimp. Never writes
// anywhere. Emits backend/tmp/quiz_email_audit_2026-09-20.csv (gitignored —
// contains emails) plus a JSON summary used to compose the closing report.
//
// Usage (from backend/, with DATABASE_URL/NODE_ENV/MAILCHIMP_API_KEY/MAILCHIMP_LIST_ID
// already set in the shell — see axis_and_bloom_local_cloudsql_testing memory):
//   npx tsx scripts/audit-quiz-emails.mjs   (actually run as plain node --experimental, see below)

import { Pool } from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const WINDOW_START = '2026-09-20T13:00:00Z';
const WINDOW_END = '2026-09-22T00:00:00Z';

const connectionString = process.env.DATABASE_URL ?? '';
if (!connectionString) {
  console.error('DATABASE_URL not set.');
  process.exit(1);
}
const db = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

const MC_API_KEY = (process.env.MAILCHIMP_API_KEY ?? '').trim();
const MC_LIST_ID = process.env.MAILCHIMP_LIST_ID ?? '';
const MC_DC = MC_API_KEY.split('-')[1] ?? '';
const MC_ENABLED = Boolean(MC_API_KEY && MC_LIST_ID);

function memberHash(email) {
  return crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
}

async function getMailchimpTag(email) {
  if (!MC_ENABLED) return { tag: null, note: 'MC_ENABLED false' };
  const hash = memberHash(email);
  const url = `https://${MC_DC}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/members/${hash}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}` },
    });
    if (res.status === 404) return { tag: null, note: 'not a member' };
    if (!res.ok) return { tag: null, note: `mailchimp GET ${res.status}` };
    const body = await res.json();
    const tags = (body.tags ?? []).map(t => t.name);
    const archetypeTag = tags.find(t => t.startsWith('archetype:')) ?? null;
    return { tag: archetypeTag, allTags: tags, mergeArchetype: body.merge_fields?.ARCHETYPE ?? null };
  } catch (err) {
    return { tag: null, note: `error: ${err.message}` };
  }
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  console.log('Connecting to prod Postgres (read-only queries only)...');

  // Source of truth: quiz_funnel_event in the crawl window.
  const funnelRes = await db.query(
    `SELECT session_key, event, archetype, created_at
     FROM quiz_funnel_event
     WHERE created_at >= $1 AND created_at < $2
     ORDER BY session_key, created_at`,
    [WINDOW_START, WINDOW_END],
  );
  console.log(`quiz_funnel_event rows in window: ${funnelRes.rows.length}`);

  // Group by session_key
  const sessions = new Map();
  for (const row of funnelRes.rows) {
    if (!sessions.has(row.session_key)) sessions.set(row.session_key, []);
    sessions.get(row.session_key).push(row);
  }

  // Sessions that have an email_submitted row
  const targetSessions = [];
  for (const [sessionKey, rows] of sessions.entries()) {
    const emailSubmitted = rows.filter(r => r.event === 'email_submitted');
    const quizComplete = rows.filter(r => r.event === 'quiz_complete');
    if (emailSubmitted.length === 0) continue;
    targetSessions.push({
      sessionKey,
      quizCompleteRows: quizComplete,
      emailSubmittedRows: emailSubmitted,
    });
  }
  console.log(`Sessions with email_submitted: ${targetSessions.length}`);

  const results = [];
  const notes = [];

  for (const sess of targetSessions) {
    const { sessionKey, quizCompleteRows, emailSubmittedRows } = sess;
    const scoredArchetype = quizCompleteRows[0]?.archetype ?? null;
    const submittedArchetype = emailSubmittedRows[0]?.archetype ?? null;
    const branchMoved = scoredArchetype !== null && submittedArchetype !== null && scoredArchetype !== submittedArchetype;

    // Find the subscribe request(s) in api_event carrying this quizSessionKey.
    const subscribeRes = await db.query(
      `SELECT occurred_at, request_body, response_status
       FROM api_event
       WHERE path IN ('/api/newsletter/subscribe', '/api/newsletter')
         AND request_body->>'quizSessionKey' = $1
       ORDER BY occurred_at ASC`,
      [sessionKey],
    );

    let email = null;
    let subscribeArchetypeSentToBackend = null;
    let subscribeAt = null;
    let subscribeSource = null;
    if (subscribeRes.rows.length > 0) {
      const first = subscribeRes.rows[0];
      email = first.request_body?.email ?? null;
      subscribeArchetypeSentToBackend = first.request_body?.archetype ?? null;
      subscribeAt = first.occurred_at;
      subscribeSource = first.request_body?.source ?? null;
    }

    let emailLogAt = null;
    let emailPredatesCrawl = null;
    let laterSubscribeCalls = 0;
    let laterSubscribeArchetypes = [];
    let subscriberArchetypeNow = null;
    let mailchimpTagNow = null;
    let mailchimpNote = null;

    if (email) {
      const logRes = await db.query(
        `SELECT sent_at FROM transactional_email_log WHERE email = lower($1) AND template = 'quiz_complete_v2'`,
        [email],
      );
      if (logRes.rows.length > 0) {
        emailLogAt = logRes.rows[0].sent_at;
        emailPredatesCrawl = new Date(emailLogAt) < new Date(WINDOW_START);
      }

      // Later writes: every subscribe call for this email (or session key) after the
      // initial submit, through now.
      const afterTs = subscribeAt ?? emailSubmittedRows[0]?.created_at ?? WINDOW_START;
      const laterRes = await db.query(
        `SELECT occurred_at, request_body
         FROM api_event
         WHERE path IN ('/api/newsletter/subscribe', '/api/newsletter')
           AND lower(request_body->>'email') = lower($1)
           AND occurred_at > $2
         ORDER BY occurred_at ASC`,
        [email, afterTs],
      );
      laterSubscribeCalls = laterRes.rows.length;
      laterSubscribeArchetypes = laterRes.rows.map(r => {
        const a = r.request_body?.archetype ?? 'null';
        const qsk = r.request_body?.quizSessionKey ?? 'null';
        const src = r.request_body?.source ?? 'null';
        return `${r.occurred_at.toISOString()}|src=${src}|arch=${a}|qsk=${qsk}`;
      });

      const subRes = await db.query(
        `SELECT archetype FROM newsletter_subscriber WHERE email = lower($1)`,
        [email],
      );
      subscriberArchetypeNow = subRes.rows[0]?.archetype ?? null;

      const mc = await getMailchimpTag(email);
      mailchimpTagNow = mc.tag;
      mailchimpNote = mc.note ?? null;
    } else {
      notes.push(`${sessionKey}: no api_event subscribe row found carrying this quizSessionKey — email undetermined.`);
    }

    // Verdict
    let verdict;
    let verdictReason = '';
    if (!email) {
      verdict = 'UNRESOLVED';
      verdictReason = 'no email resolved from api_event';
    } else if (emailPredatesCrawl) {
      verdict = 'NO_EMAIL_SENT';
      verdictReason = 'transactional_email_log timestamp predates the crawl window — once-per-address guard blocked a Sunday send';
    } else if (subscribeArchetypeSentToBackend && submittedArchetype && subscribeArchetypeSentToBackend !== submittedArchetype
      && !(submittedArchetype === 'Balanced' && subscribeArchetypeSentToBackend === 'Balanced & Sweet')
      && !(submittedArchetype === 'Balanced & Sweet' && subscribeArchetypeSentToBackend === 'Balanced')) {
      verdict = 'EMAIL_WRONG';
      verdictReason = `backend received archetype "${subscribeArchetypeSentToBackend}" for a submit that showed "${submittedArchetype}"`;
    } else if (laterSubscribeCalls > 0) {
      const laterHasDifferentArchetype = laterRowsDiffer(laterSubscribeArchetypes, submittedArchetype);
      if (laterHasDifferentArchetype) {
        verdict = 'ROW_OVERWRITTEN';
        verdictReason = 'a later subscribe call changed the subscriber/tag archetype after the correct email went out';
      } else {
        verdict = 'OK';
      }
    } else {
      verdict = 'OK';
    }

    results.push({
      session_key: sessionKey,
      scored_archetype: scoredArchetype,
      submitted_archetype: submittedArchetype,
      branch_moved: branchMoved,
      email,
      subscribe_archetype_sent_to_backend: subscribeArchetypeSentToBackend,
      subscribe_source: subscribeSource,
      subscribe_at: subscribeAt ? new Date(subscribeAt).toISOString() : '',
      email_log_at: emailLogAt ? new Date(emailLogAt).toISOString() : '',
      email_predates_crawl: emailPredatesCrawl === null ? '' : String(emailPredatesCrawl),
      resend_variant: 'dashboard lookup needed', // Resend API not reachable this session — see Task 0 finding
      later_subscribe_calls: laterSubscribeCalls,
      later_subscribe_archetypes: laterSubscribeArchetypes.join(' ;; '),
      subscriber_archetype_now: subscriberArchetypeNow,
      mailchimp_tag_now: mailchimpTagNow,
      mailchimp_note: mailchimpNote,
      verdict,
      verdict_reason: verdictReason,
    });
  }

  function laterRowsDiffer(laterArr, expected) {
    // laterArr entries look like "ISO|src=x|arch=Y|qsk=Z" — check if any archetype != expected
    for (const entry of laterArr) {
      const m = entry.match(/arch=([^|]*)\|/);
      const arch = m ? m[1] : null;
      if (arch && arch !== 'null' && arch !== expected) return true;
    }
    return false;
  }

  // Write CSV
  const outDir = path.resolve(process.cwd(), 'tmp');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'quiz_email_audit_2026-09-20.csv');
  const columns = [
    'session_key', 'scored_archetype', 'submitted_archetype', 'branch_moved',
    'email', 'subscribe_archetype_sent_to_backend', 'subscribe_source', 'subscribe_at',
    'email_log_at', 'email_predates_crawl', 'resend_variant',
    'later_subscribe_calls', 'later_subscribe_archetypes',
    'subscriber_archetype_now', 'mailchimp_tag_now', 'mailchimp_note',
    'verdict', 'verdict_reason',
  ];
  const lines = [columns.join(',')];
  for (const r of results) {
    lines.push(columns.map(c => csvEscape(r[c])).join(','));
  }
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
  console.log(`Wrote ${results.length} rows to ${outPath}`);

  // Write JSON summary for the closing report
  const summaryPath = path.join(outDir, 'quiz_email_audit_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({ results, notes, windowStart: WINDOW_START, windowEnd: WINDOW_END }, null, 2), 'utf-8');
  console.log(`Wrote summary to ${summaryPath}`);

  await db.end();
}

main().catch(err => { console.error(err); process.exit(1); });
