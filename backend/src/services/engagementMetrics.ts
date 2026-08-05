// HOME_TASK_9 (§7) — the strategy doc's five engagement metrics, written as
// actual queries for the first time. "A metric that isn't a query yet isn't
// a metric" (the task's own words) — before this file, none of these five
// existed anywhere as a runnable query; admin stats had no source to read
// from. Exported so GET /api/admin/sommelier/stats (or any future admin
// surface) can adopt them directly rather than reimplementing the SQL.
//
// The §7 engagement definition itself: "a QR scan, a beat answered with one
// word, a brew card viewed or edited, a chat turn" — every query below reads
// from one or more of those four event sources (qr_scan_event, beat_event,
// brew_card_view_event + user_brew_card.updated_at, sommelier_sessions).
import { db } from '../db/client.js';
import { firestoreDb } from './firebase-admin.js';

// 1. Per-bag engagement rate — fraction of brew cards ("bags," per the
// strategy doc's own bag=card framing) with at least one interaction across
// any of the four engagement channels.
export async function getPerBagEngagementRate() {
  const result = await db.query(`
    WITH bag_engagement AS (
      SELECT
        c.id AS card_id,
        EXISTS (SELECT 1 FROM qr_scan_event q WHERE q.coffee_id = c.coffee_id AND q.user_id = c.user_id) AS has_scan,
        EXISTS (SELECT 1 FROM beat_event b WHERE b.coffee_id = c.coffee_id AND b.user_id = c.user_id AND b.responded_at IS NOT NULL) AS has_beat_response,
        EXISTS (SELECT 1 FROM brew_card_view_event v WHERE v.card_id = c.id) AS has_view,
        (c.revision > 1) AS has_edit
      FROM user_brew_card c
    )
    SELECT
      COUNT(*) AS total_bags,
      COUNT(*) FILTER (WHERE has_scan OR has_beat_response OR has_view OR has_edit) AS engaged_bags,
      ROUND(
        COUNT(*) FILTER (WHERE has_scan OR has_beat_response OR has_view OR has_edit)::numeric
        / NULLIF(COUNT(*), 0), 4
      ) AS engagement_rate
    FROM bag_engagement
  `);
  return result.rows[0];
}

// 2. Engaged-bag vs un-engaged-bag reorder rate — of customers with more
// than one order, what fraction of their *next* order was for a coffee whose
// prior bag was engaged vs. not. Directional, not causal (per §4.10 — no
// control group exists).
export async function getEngagedVsUnengagedReorderRate() {
  const result = await db.query(`
    WITH bag_engagement AS (
      SELECT c.user_id, c.coffee_id,
        (EXISTS (SELECT 1 FROM qr_scan_event q WHERE q.coffee_id = c.coffee_id AND q.user_id = c.user_id)
         OR EXISTS (SELECT 1 FROM beat_event b WHERE b.coffee_id = c.coffee_id AND b.user_id = c.user_id AND b.responded_at IS NOT NULL)
         OR EXISTS (SELECT 1 FROM brew_card_view_event v WHERE v.card_id = c.id)
         OR c.revision > 1) AS engaged
      FROM user_brew_card c
    ),
    orders_per_user_coffee AS (
      SELECT o.user_id, oli.blend_id, rb.coffee_id, COUNT(*) AS order_count
      FROM "order" o
      JOIN order_line_item oli ON oli.order_id = o.id
      JOIN roaster_blend rb ON rb.id = oli.blend_id
      GROUP BY o.user_id, oli.blend_id, rb.coffee_id
    )
    SELECT
      be.engaged,
      COUNT(*) AS bag_count,
      ROUND(AVG((opuc.order_count > 1)::int)::numeric, 4) AS reorder_rate
    FROM bag_engagement be
    LEFT JOIN orders_per_user_coffee opuc ON opuc.user_id = be.user_id AND opuc.coffee_id = be.coffee_id
    GROUP BY be.engaged
  `);
  return result.rows;
}

// 3. Repeat-question rate, falling — fraction of a session's topic-router
// log entries (context_data.topicLog, Task 2) that repeat a topic already
// seen earlier in the *same* session. Falling over time is what "brew cards
// are working" (§3.2's success inversion) looks like in this number.
export async function getRepeatQuestionRate() {
  const sessions = await db.query(
    `SELECT id, context_data FROM sommelier_sessions WHERE context_data->'topicLog' IS NOT NULL`
  );
  let totalTopicTurns = 0;
  let repeatTopicTurns = 0;
  for (const row of sessions.rows) {
    const topicLog: Array<{ topic: string | null }> = row.context_data?.topicLog ?? [];
    const seen = new Set<string>();
    for (const entry of topicLog) {
      if (!entry.topic) continue;
      totalTopicTurns++;
      if (seen.has(entry.topic)) repeatTopicTurns++;
      seen.add(entry.topic);
    }
  }
  return {
    sessionsWithTopicLog: sessions.rows.length,
    totalTopicTurns,
    repeatTopicTurns,
    repeatQuestionRate: totalTopicTurns ? Math.round((repeatTopicTurns / totalTopicTurns) * 10000) / 10000 : null,
  };
}

// 4. Brew-profile fill rate — fraction of users with a real, non-empty
// users/{uid}/metadata/brew_profile document (any captured field) out of
// all users who have ever started a sommelier session (the denominator that
// actually could have filled one in).
export async function getBrewProfileFillRate() {
  const sessionUidsResult = await db.query(`SELECT DISTINCT uid FROM sommelier_sessions`);
  const sessionUids: string[] = sessionUidsResult.rows.map((r: { uid: string }) => r.uid);
  if (!sessionUids.length) return { totalEligibleUsers: 0, filledUsers: 0, fillRate: null };

  let filledUsers = 0;
  for (const uid of sessionUids) {
    const doc = await firestoreDb.doc(`users/${uid}/metadata/brew_profile`).get();
    if (doc.exists && Object.keys(doc.data() ?? {}).some(k => k !== 'updatedAt')) filledUsers++;
  }
  return {
    totalEligibleUsers: sessionUids.length,
    filledUsers,
    fillRate: Math.round((filledUsers / sessionUids.length) * 10000) / 10000,
  };
}

// 5. Topic distribution — the module-commissioning signal (§4.3: "demand
// data writes the long tail, not a content plan"). Aggregates every
// context_data.topicLog entry across all sessions by topic.
export async function getTopicDistribution() {
  const sessions = await db.query(
    `SELECT context_data FROM sommelier_sessions WHERE context_data->'topicLog' IS NOT NULL`
  );
  const counts: Record<string, number> = {};
  let nullTopicCount = 0;
  for (const row of sessions.rows) {
    const topicLog: Array<{ topic: string | null }> = row.context_data?.topicLog ?? [];
    for (const entry of topicLog) {
      if (!entry.topic) { nullTopicCount++; continue; }
      counts[entry.topic] = (counts[entry.topic] ?? 0) + 1;
    }
  }
  return { counts, nullTopicCount };
}
