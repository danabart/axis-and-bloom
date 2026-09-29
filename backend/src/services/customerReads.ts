import { db } from '../db/client.js';
import type { Tx } from '../db/client.js';

// ── Customer Blueprint · brief C1, Part C (2026-09-27); first reads added by
// brief C2, Part A1 (2026-09-27) ──────────────────────────────────────────────
// The only place a customer_* table (or catalog_change) may be SELECTed from
// (lint rule 4 in backend/scripts/lint-customer.mjs enforces this) until C3
// ships its v_customer_*/v_palate_* views. See backend/src/features/
// customer_blueprint/README.md and the two CLAUDE_CODE_PROMPT files.

type Runner = Tx | typeof db;

// The most recent customer_feedback_event row for an order, by occurred_at —
// used only to find what a revision supersedes. Deliberately ignores whether
// that row is itself already superseded (resolving supersede chains properly
// is C3's job, via a view); this is a narrow "what's the latest thing said
// about this order" lookup for the door's own supersedesId field.
export async function latestFeedbackEventForOrder(userId: string, orderId: string, runner: Runner = db): Promise<string | null> {
  const result = await runner.query<{ id: string }>(
    `SELECT cfe.id FROM customer_feedback_event cfe
     JOIN order_line_item li ON li.id = cfe.order_line_item_id
     WHERE cfe.user_id = $1 AND li.order_id = $2
     ORDER BY cfe.occurred_at DESC LIMIT 1`,
    [userId, orderId]
  );
  return result.rows[0]?.id ?? null;
}

// The order's line item id when it has exactly one line, else null (multi-
// line orders leave feedback's coffee attribution ambiguous — Part A1's own
// "multi-line order, line unattributed" warning covers that case).
export async function orderLineForOrder(orderId: string, runner: Runner = db): Promise<string | null> {
  const result = await runner.query<{ id: string }>(`SELECT id FROM order_line_item WHERE order_id = $1`, [orderId]);
  return result.rows.length === 1 ? result.rows[0].id : null;
}

// ── Customer Blueprint · brief C3, Part A (2026-09-27) ────────────────────────
// One typed read per v_customer_*/v_palate_* view. Every function takes a
// Firebase uid (the convention every route already has on hand) and resolves
// it to its canonical_user_id via v_customer_identity first — never the raw
// user_profile.id — so a customer linked under two profiles (D15) reads as
// one everywhere. A uid with no user_profile row (or no canonical row, which
// cannot happen once a profile exists — v_customer_identity has one row per
// profile) returns the same "nothing yet" shape every existing caller already
// handles (null / empty array), never a thrown error.

async function resolveCanonicalUserId(uid: string, runner: Runner = db): Promise<string | null> {
  const result = await runner.query<{ canonical_user_id: string }>(
    `SELECT vci.canonical_user_id
     FROM v_customer_identity vci
     JOIN user_profile up ON up.id = vci.user_id
     WHERE up.firebase_uid = $1`,
    [uid]
  );
  return result.rows[0]?.canonical_user_id ?? null;
}

export interface QuizCurrentRow {
  archetypeName: string | null;
  archetypeCode: string | null;
  secondaryArchetype: string | null;
  secondaryArchetypeCode: string | null;
  branchedFrom: string | null;
  foodSignal: string | null;
  experimental: boolean;
  foodSignalAlignment: string;
  recommendationMode: string;
  pairConfidence: string | null;
  exploreArchetype: string | null;
  exploreReason: string | null;
  interpretationVersion: string | null;
  interpretationSource: 'table' | 'context_data';
  completedAt: Date | null;
  // Liam L3, Part D — when this row's interpretation became current; null on
  // a context_data-fallback row (no interpretation table row at all).
  interpretationValidFrom: Date | null;
  archetypeChangeCount: number;
  quizCount: number;
  archetypeChangedLastTwoQuizzes: boolean;
}

// v_customer_quiz_current — the latest quiz across every linked profile.
export async function getQuizCurrent(uid: string, runner: Runner = db): Promise<QuizCurrentRow | null> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return null;
  const result = await runner.query(`SELECT * FROM v_customer_quiz_current WHERE canonical_user_id = $1`, [canonicalId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    archetypeName: row.archetype_name, archetypeCode: row.archetype_code,
    secondaryArchetype: row.secondary_archetype, secondaryArchetypeCode: row.secondary_archetype_code,
    branchedFrom: row.branched_from, foodSignal: row.food_signal, experimental: row.experimental,
    foodSignalAlignment: row.food_signal_alignment, recommendationMode: row.recommendation_mode,
    pairConfidence: row.pair_confidence, exploreArchetype: row.explore_archetype, exploreReason: row.explore_reason,
    interpretationVersion: row.interpretation_version, interpretationSource: row.interpretation_source, completedAt: row.completed_at,
    interpretationValidFrom: row.interpretation_valid_from,
    archetypeChangeCount: Number(row.archetype_change_count), quizCount: Number(row.quiz_count),
    archetypeChangedLastTwoQuizzes: row.archetype_changed_last_two_quizzes,
  };
}

// routes/sommelier.ts's /start needs the second-latest session's archetype
// (TASTE_EVOLUTION's RAG previousArchetype) — a plain history query across
// every linked profile, not something v_customer_quiz_current (latest only)
// carries.
export async function getPreviousQuizArchetype(uid: string, runner: Runner = db): Promise<string | null> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return null;
  const result = await runner.query<{ archetype_name: string | null }>(
    `SELECT qs.id, ca.name AS archetype_name
     FROM quiz_session qs
     JOIN v_customer_identity vci ON vci.user_id = qs.user_id
     LEFT JOIN coffee_archetype ca ON ca.id = qs.resulting_archetype_id
     WHERE vci.canonical_user_id = $1
     ORDER BY qs.completed_at DESC
     LIMIT 1 OFFSET 1`,
    [canonicalId]
  );
  return result.rows[0]?.archetype_name ?? null;
}

// v_customer_brew_profile, reshaped into the exact BrewProfileDoc shape
// (services/brewProfile.ts) so formatBrewProfileSummary()/getStaleFieldNudge()
// stay untouched.
// source here is the UI-facing label services/brewProfile.ts's BrewProfileDoc
// always used ('conversation' | 'profile_page'), not the fact table's own
// FactSource vocabulary ('onsite'/'liam'/…) — mapped once here so every
// existing reader of this shape (formatBrewProfileSummary, GET
// /api/users/brew-profile) keeps working unchanged. 'liam' (resolveRemember)
// -> 'conversation'; everything else (onsite, backfill) -> 'profile_page'.
export interface BrewProfileFieldEntry {
  value: unknown;
  source: 'conversation' | 'profile_page' | null;
  capturedAt: string | null;
}
function factSourceToBrewProfileSource(factSource: string | null): 'conversation' | 'profile_page' | null {
  if (factSource === null) return null;
  return factSource === 'liam' ? 'conversation' : 'profile_page';
}
export async function getBrewProfileCurrent(uid: string, runner: Runner = db): Promise<Record<string, BrewProfileFieldEntry>> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return {};
  const result = await runner.query<{ field: string; value_jsonb: unknown; captured_at: string; source: string | null }>(
    `SELECT field, value_jsonb, captured_at, source FROM v_customer_brew_profile WHERE canonical_user_id = $1`,
    [canonicalId]
  );
  const doc: Record<string, BrewProfileFieldEntry> = {};
  for (const row of result.rows) {
    doc[row.field] = {
      value: row.value_jsonb,
      source: factSourceToBrewProfileSource(row.source),
      capturedAt: row.captured_at ? new Date(row.captured_at).toISOString() : null,
    };
  }
  return doc;
}

export interface FeedbackCurrentRow {
  feedbackEventId: string;
  occurredAt: Date;
  orderLineItemId: string | null;
  orderId: string | null;
  coffeeId: number;
  rating: number | null;
  expectation: string | null;
  rawText: string | null;
  channel: string;
  source: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  descriptorNoteIds: string[];
}
// v_customer_feedback_current, optionally scoped to one order line (the
// order-feedback / RECOMMENDATION_MISS call sites only need one row or the
// negative subset — filtered here rather than pulling every row every time).
export async function getFeedbackCurrent(
  uid: string,
  opts: { orderLineItemId?: string; sentiment?: 'positive' | 'negative' | 'neutral' } = {},
  runner: Runner = db
): Promise<FeedbackCurrentRow[]> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return [];
  const conditions = ['vfc.canonical_user_id = $1'];
  const params: unknown[] = [canonicalId];
  if (opts.orderLineItemId) { params.push(opts.orderLineItemId); conditions.push(`vfc.order_line_item_id = $${params.length}`); }
  if (opts.sentiment) {
    if (opts.sentiment === 'positive') conditions.push(`vfc.rating >= 4`);
    else if (opts.sentiment === 'negative') conditions.push(`vfc.rating <= 2`);
    else conditions.push(`(vfc.rating IS NULL OR vfc.rating = 3)`);
  }
  const result = await runner.query(
    `SELECT vfc.*, oli.order_id
     FROM v_customer_feedback_current vfc
     LEFT JOIN order_line_item oli ON oli.id = vfc.order_line_item_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY vfc.occurred_at DESC`,
    params
  );
  return result.rows.map((row: any) => ({
    feedbackEventId: row.feedback_event_id, occurredAt: row.occurred_at, orderLineItemId: row.order_line_item_id,
    orderId: row.order_id ?? null, coffeeId: row.coffee_id, rating: row.rating, expectation: row.expectation,
    rawText: row.raw_text, channel: row.channel, source: row.source, sentiment: row.sentiment,
    descriptorNoteIds: row.descriptor_note_ids ?? [],
  }));
}

export interface TimelineEntry {
  occurredAt: Date;
  kind: string;
  refId: string;
  coffeeId: number | null;
  slotId: number | null;
  archetypeCode: string | null;
  sessionId: number | null;
  detail: Record<string, unknown>;
}
// v_customer_timeline — /flavor-memory's single source now (Part B3).
export async function getTimeline(uid: string, runner: Runner = db): Promise<TimelineEntry[]> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return [];
  const result = await runner.query(`SELECT * FROM v_customer_timeline WHERE canonical_user_id = $1 ORDER BY occurred_at, kind`, [canonicalId]);
  return result.rows.map((row: any) => ({
    occurredAt: row.occurred_at, kind: row.kind, refId: row.ref_id, coffeeId: row.coffee_id, slotId: row.slot_id,
    archetypeCode: row.archetype_code, sessionId: row.session_id, detail: row.detail ?? {},
  }));
}

// ── Part E / Part D — the palate reads ────────────────────────────────────
export async function getPalateEvidence(uid: string, runner: Runner = db): Promise<Record<string, unknown> | null> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return null;
  const result = await runner.query(`SELECT * FROM v_palate_evidence WHERE canonical_user_id = $1`, [canonicalId]);
  return result.rows[0] ?? null;
}

export async function getSharedTraits(uid: string, runner: Runner = db): Promise<Record<string, unknown>[]> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return [];
  const result = await runner.query(`SELECT * FROM v_palate_shared_traits WHERE canonical_user_id = $1`, [canonicalId]);
  return result.rows;
}

export async function getDominantDimensions(uid: string, runner: Runner = db): Promise<Record<string, unknown>[]> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return [];
  const result = await runner.query(`SELECT * FROM v_palate_dominant_dimensions WHERE canonical_user_id = $1`, [canonicalId]);
  return result.rows;
}

export async function getArchetypeSpread(uid: string, runner: Runner = db): Promise<Record<string, unknown>[]> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return [];
  const result = await runner.query(`SELECT * FROM v_palate_archetype_spread WHERE canonical_user_id = $1`, [canonicalId]);
  return result.rows;
}

export async function getThreads(uid: string, runner: Runner = db): Promise<Record<string, unknown>[]> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return [];
  const result = await runner.query(`SELECT * FROM v_palate_threads WHERE canonical_user_id = $1 ORDER BY occurred_at DESC`, [canonicalId]);
  return result.rows;
}

// No uid scoping: recommendation-outcome numbers (Part E) are aggregated
// across every customer, not read per-customer.
export async function getRecommendationOutcomes(runner: Runner = db): Promise<Record<string, unknown>[]> {
  const result = await runner.query(`SELECT * FROM v_palate_recommendation_outcome`);
  return result.rows;
}

export async function getSlotCandidates(uid: string, runner: Runner = db): Promise<Record<string, unknown>[]> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return [];
  const result = await runner.query(`SELECT * FROM v_palate_slot_candidates WHERE canonical_user_id = $1`, [canonicalId]);
  return result.rows;
}

export interface RecentDialActivityRow {
  archetypeCode: string | null;
  eventType: string;
  dialSortOrder: number | null;
}
// customer_dial_event, most recent first — lint rule 4 requires this table's
// SELECT to live here, not in routes/sommelier.ts directly.
export async function getRecentDialActivity(uid: string, limit = 30, runner: Runner = db): Promise<RecentDialActivityRow[]> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return [];
  const result = await runner.query<{ archetype_code: string | null; event_type: string; dial_sort_order: number | null }>(
    `SELECT cde.archetype_code, cde.event_type, cds.sort_order AS dial_sort_order
     FROM customer_dial_event cde
     JOIN v_customer_identity vci ON vci.user_id = cde.user_id
     LEFT JOIN coffee_dial_slot cds ON cds.id = cde.slot_id
     WHERE vci.canonical_user_id = $1
     ORDER BY cde.occurred_at DESC
     LIMIT $2`,
    [canonicalId, limit]
  );
  return result.rows.map(row => ({ archetypeCode: row.archetype_code, eventType: row.event_type, dialSortOrder: row.dial_sort_order }));
}

// ── Liam L1, Part C (2026-09-28) ───────────────────────────────────────────
// One timestamp: the latest occurred_at across every one of this customer's
// fact tables, through identity — quiz sessions, order lines (via the same
// v_customer_bag_attribution join v_customer_timeline's own 'order_line' arm
// uses), feedback, brew changes, dial events, bag claims, every Liam fact
// (recommendation/question/reply/action) and identity links themselves. Used
// by routes/sommelier.ts to decide whether a session's cached RAG slice is
// stale — a fact that landed after the slice was built means the palate
// picks it fed on may now be wrong. Null when the customer has no facts yet
// (a brand-new profile) — never a default timestamp.
export async function getFactsWatermark(uid: string, runner: Runner = db): Promise<Date | null> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return null;
  const result = await runner.query<{ watermark: Date | null }>(
    `SELECT MAX(occurred_at) AS watermark FROM (
       SELECT qs.completed_at AS occurred_at FROM quiz_session qs
         JOIN v_customer_identity vci ON vci.user_id = qs.user_id WHERE vci.canonical_user_id = $1
       UNION ALL
       SELECT o.created_at FROM order_line_item oli
         JOIN "order" o ON o.id = oli.order_id
         JOIN v_customer_bag_attribution vba ON vba.order_line_item_id = oli.id
         JOIN v_customer_identity vci ON vci.user_id = vba.drinker_user_id WHERE vci.canonical_user_id = $1
       UNION ALL
       SELECT cfe.occurred_at FROM customer_feedback_event cfe
         JOIN v_customer_identity vci ON vci.user_id = cfe.user_id WHERE vci.canonical_user_id = $1
       UNION ALL
       SELECT cbpc.occurred_at FROM customer_brew_profile_change cbpc
         JOIN v_customer_identity vci ON vci.user_id = cbpc.user_id WHERE vci.canonical_user_id = $1
       UNION ALL
       SELECT cde.occurred_at FROM customer_dial_event cde
         JOIN v_customer_identity vci ON vci.user_id = cde.user_id WHERE vci.canonical_user_id = $1
       UNION ALL
       SELECT cbc.occurred_at FROM customer_bag_claim cbc
         JOIN v_customer_identity vci ON vci.user_id = cbc.user_id WHERE vci.canonical_user_id = $1
       UNION ALL
       SELECT clr.occurred_at FROM customer_liam_recommendation clr
         JOIN v_customer_identity vci ON vci.user_id = clr.user_id WHERE vci.canonical_user_id = $1
       UNION ALL
       SELECT clq.occurred_at FROM customer_liam_question clq
         JOIN v_customer_identity vci ON vci.user_id = clq.user_id WHERE vci.canonical_user_id = $1
       UNION ALL
       SELECT clrep.occurred_at FROM customer_liam_reply clrep
         JOIN v_customer_identity vci ON vci.user_id = clrep.user_id WHERE vci.canonical_user_id = $1
       UNION ALL
       SELECT cla.occurred_at FROM customer_liam_action cla
         JOIN v_customer_identity vci ON vci.user_id = cla.user_id WHERE vci.canonical_user_id = $1
       UNION ALL
       SELECT cil.occurred_at FROM customer_identity_link cil
         JOIN v_customer_identity vci ON vci.user_id = cil.user_id WHERE vci.canonical_user_id = $1
     ) all_facts`,
    [canonicalId]
  );
  return result.rows[0]?.watermark ?? null;
}
