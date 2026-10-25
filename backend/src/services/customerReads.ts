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
  // Interpretation v2.2 (Prompt 4B): where on the Bloom Dial they are matched (never null: = archetypeName before
  // v2.2), the lean ('delicate' | null) and the raw branch answer. Carried through; nothing acts on them yet.
  matchArchetype: string | null;
  matchArchetypeCode: string | null;
  intensityLean: string | null;
  branchAnswerCode: string | null;
}

// A secondary equal to the shown archetype says nothing (a branch-match customer is shown Balanced with secondary
// Balanced, match Fruity/Floral). Every reader that prints or pairs "primary + secondary" goes through this, so no
// one reads "Balanced; second: Balanced" (Prompt 4B, Part B.4).
export function distinctSecondary(shown: string | null | undefined, secondary: string | null | undefined): string | null {
  return secondary && secondary !== shown ? secondary : null;
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
    matchArchetype: row.match_archetype ?? null, matchArchetypeCode: row.match_archetype_code ?? null,
    intensityLean: row.intensity_lean ?? null, branchAnswerCode: row.branch_answer_code ?? null,
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
       -- Liam sees everything brief Rev 2, Part B (2026-10-24): the new
       -- block lines rebuild mid-session when any of these move.
       UNION ALL
       SELECT o.created_at FROM "order" o
         JOIN v_customer_identity vci ON vci.user_id = o.user_id WHERE vci.canonical_user_id = $1
       UNION ALL
       SELECT COALESCE(s.updated_at, s.created_at) FROM subscription s
         JOIN v_customer_identity vci ON vci.user_id = s.user_id WHERE vci.canonical_user_id = $1
       UNION ALL
       SELECT GREATEST(usi.created_at, COALESCE(usi.removed_at, usi.created_at)) FROM user_saved_item usi
         JOIN v_customer_identity vci ON vci.user_id = usi.user_id WHERE vci.canonical_user_id = $1
       UNION ALL
       SELECT ubc.updated_at FROM user_brew_card ubc
         JOIN v_customer_identity vci ON vci.user_id = ubc.user_id WHERE vci.canonical_user_id = $1
     ) all_facts`,
    [canonicalId]
  );
  return result.rows[0]?.watermark ?? null;
}

// ── Liam sees everything brief Rev 2, Part B (2026-10-24) ──────────────────
// The ABOUT THIS CUSTOMER block's new reads. Each resolves through
// v_customer_identity (every linked profile), selects only what its line
// prints, and returns nothing a customer would not expect Liam to say back:
// no street address, no payment data, no internal ids beyond the coffee id
// the block turns into an alias. Order and subscription reads live here
// (not in routes) so Brief 3's gate reuses them. Read-only.

export interface CustomerIdentity {
  firstName: string | null;
  memberSince: Date | null;   // earliest created_at across linked profiles
  householdMembers: number;   // other profiles in the same household (0 = none)
}
export async function getCustomerIdentity(uid: string, runner: Runner = db): Promise<CustomerIdentity | null> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return null;
  const r = await runner.query<{ first_name: string | null; member_since: Date | null; household_members: string }>(
    `SELECT (SELECT up.first_name FROM user_profile up WHERE up.id = $1) AS first_name,
            (SELECT MIN(up.created_at) FROM user_profile up JOIN v_customer_identity vci ON vci.user_id = up.id
              WHERE vci.canonical_user_id = $1) AS member_since,
            (SELECT COUNT(*) FROM user_profile other
              WHERE other.household_id IS NOT NULL
                AND other.household_id = (SELECT household_id FROM user_profile WHERE id = $1)
                AND other.id <> $1) AS household_members`,
    [canonicalId]
  );
  const row = r.rows[0];
  const firstName = row?.first_name?.trim() || null;
  return { firstName, memberSince: row?.member_since ?? null, householdMembers: Number(row?.household_members ?? 0) };
}

export interface QuizHistoryEntry { archetypeName: string; completedAt: Date }
/** Completed, scored quizzes across linked profiles, newest first (the current one included). */
export async function getQuizHistory(uid: string, limit: number, runner: Runner = db): Promise<QuizHistoryEntry[]> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return [];
  const r = await runner.query<{ archetype_name: string; completed_at: Date }>(
    `SELECT ca.name AS archetype_name, qs.completed_at
       FROM quiz_session qs
       JOIN v_customer_identity vci ON vci.user_id = qs.user_id
       JOIN coffee_archetype ca ON ca.id = qs.resulting_archetype_id
      WHERE vci.canonical_user_id = $1 AND qs.completed_at IS NOT NULL
      ORDER BY qs.completed_at DESC
      LIMIT $2`,
    [canonicalId, limit]
  );
  return r.rows.map(x => ({ archetypeName: x.archetype_name, completedAt: x.completed_at }));
}

export interface RecentOrderLine { coffeeId: number | null; weightOz: number | null; quantity: number }
export interface RecentOrder { createdAt: Date; lines: RecentOrderLine[] }
export interface RecentOrders {
  recent: RecentOrder[];                        // newest first, up to `limit`
  olderCount: number;                           // orders beyond `limit`
  olderArchetypeCounts: Record<string, number>; // match archetype code -> line count, older orders only
}
// Rev 2: what was ordered and when, nothing else. fulfillment_status is
// written 'pending' at checkout and never updated, there is no tracking
// column and nothing writes roastery_shipment_details, so no status, tracking
// or delivery date is selected here (a later brief adds one once lineage.json
// names a writer).
export async function getRecentOrders(uid: string, limit: number, runner: Runner = db): Promise<RecentOrders> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return { recent: [], olderCount: 0, olderArchetypeCounts: {} };
  const r = await runner.query<{ order_id: string; created_at: Date; coffee_id: number | null; weight_oz: string | null; quantity: number | null; match_archetype: string | null; rn: string }>(
    `WITH orders AS (
       SELECT o.id, o.created_at, ROW_NUMBER() OVER (ORDER BY o.created_at DESC, o.id) AS rn
         FROM "order" o JOIN v_customer_identity vci ON vci.user_id = o.user_id
        WHERE vci.canonical_user_id = $1)
     SELECT o.id AS order_id, o.created_at, sku.coffee_id, sku.weight_oz, oli.quantity, c.match_archetype, o.rn
       FROM orders o
       LEFT JOIN order_line_item oli ON oli.order_id = o.id
       LEFT JOIN coffee_sku sku ON sku.id = oli.blend_id
       LEFT JOIN v_coffee c ON c.id = sku.coffee_id
      ORDER BY o.rn, oli.created_at`,
    [canonicalId]
  );
  const recent: RecentOrder[] = [];
  const byOrder = new Map<string, RecentOrder>();
  const olderOrders = new Set<string>();
  const olderArchetypeCounts: Record<string, number> = {};
  for (const row of r.rows) {
    if (Number(row.rn) > limit) {
      olderOrders.add(row.order_id);
      if (row.match_archetype) olderArchetypeCounts[row.match_archetype] = (olderArchetypeCounts[row.match_archetype] ?? 0) + 1;
      continue;
    }
    let order = byOrder.get(row.order_id);
    if (!order) { order = { createdAt: row.created_at, lines: [] }; byOrder.set(row.order_id, order); recent.push(order); }
    if (row.quantity !== null) {
      order.lines.push({ coffeeId: row.coffee_id, weightOz: row.weight_oz === null ? null : Number(row.weight_oz), quantity: row.quantity });
    }
  }
  return { recent, olderCount: olderOrders.size, olderArchetypeCounts };
}

export interface SubscriptionCurrent { status: string; sponsored: boolean }
// Rev 2: status and sponsored only. next_delivery_date and frequency_days are
// never written; price and payment are not Liam's to say.
export async function getSubscriptionCurrent(uid: string, runner: Runner = db): Promise<SubscriptionCurrent | null> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return null;
  const r = await runner.query<{ status: string; sponsored: boolean }>(
    `SELECT s.status, (s.company_gift_id IS NOT NULL OR s.sponsored_expires_at IS NOT NULL) AS sponsored
       FROM subscription s JOIN v_customer_identity vci ON vci.user_id = s.user_id
      WHERE vci.canonical_user_id = $1
      ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
      LIMIT 1`,
    [canonicalId]
  );
  return r.rows[0] ? { status: r.rows[0].status, sponsored: r.rows[0].sponsored } : null;
}

// Liam answer layer (2026-10-25), Part B step 4 — "how much is it?" after a
// pick: the coffee(s) of the session's latest recommended turn, the only
// reader of customer_liam_recommendation outside the views. Keyed by the
// session, not the customer (the gate resolves within one conversation).
// More than one id means the last turn named several: the caller treats
// that as ambiguous and sends the turn to the model.
export async function getLastRecommendation(sessionId: number, runner: Runner = db): Promise<number[]> {
  const r = await runner.query<{ coffee_id: number }>(
    `SELECT DISTINCT clr.coffee_id FROM customer_liam_recommendation clr
      WHERE clr.session_id = $1 AND clr.coffee_id IS NOT NULL
        AND clr.turn = (SELECT MAX(turn) FROM customer_liam_recommendation WHERE session_id = $1 AND coffee_id IS NOT NULL)`,
    [sessionId]
  );
  return r.rows.map(x => x.coffee_id);
}

/** City and state of the default shipping address (never the street). */
export async function getShipsTo(uid: string, runner: Runner = db): Promise<{ city: string | null; state: string | null } | null> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return null;
  const r = await runner.query<{ city: string | null; state: string | null }>(
    `SELECT a.city, a.state
       FROM address a JOIN v_customer_identity vci ON vci.user_id = a.user_id
      WHERE vci.canonical_user_id = $1 AND a.address_type::text = 'shipping'
      ORDER BY a.is_default DESC, a.updated_at DESC NULLS LAST
      LIMIT 1`,
    [canonicalId]
  );
  const row = r.rows[0];
  return row && (row.city || row.state) ? { city: row.city, state: row.state } : null;
}

export interface SavedDialItem { archetype: string | null; dialSortOrder: number | null; coffeeId: number | null; savedAt: Date }
/** Live (not removed) dial-slot saves from the profile's flavor memory, newest first, one per slot. */
export async function getSavedCoffees(uid: string, runner: Runner = db): Promise<SavedDialItem[]> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return [];
  const r = await runner.query<{ archetype: string | null; dial_sort_order: number | null; coffee_id: number | null; created_at: Date }>(
    `SELECT DISTINCT ON (usi.ref_id)
            usi.payload->>'archetype' AS archetype,
            NULLIF(usi.payload->>'dialSortOrder', '')::int AS dial_sort_order,
            NULLIF(usi.payload->>'coffeeId', '')::int AS coffee_id,
            usi.created_at
       FROM user_saved_item usi JOIN v_customer_identity vci ON vci.user_id = usi.user_id
      WHERE vci.canonical_user_id = $1 AND usi.kind = 'dial_slot' AND usi.removed_at IS NULL
      ORDER BY usi.ref_id, usi.created_at DESC`,
    [canonicalId]
  );
  return r.rows
    .map(x => ({ archetype: x.archetype, dialSortOrder: x.dial_sort_order, coffeeId: x.coffee_id, savedAt: x.created_at }))
    .sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime());
}

export interface BrewCardCurrent { coffeeId: number; method: string; ratio: string | null; grindLabel: string | null; tempC: number | null }
/** The current brew card per coffee and method. */
export async function getBrewCardsCurrent(uid: string, runner: Runner = db): Promise<BrewCardCurrent[]> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return [];
  const r = await runner.query<{ coffee_id: number; method: string; params: Record<string, unknown> | null }>(
    `SELECT DISTINCT ON (ubc.coffee_id, ubc.method) ubc.coffee_id, ubc.method, ubc.params
       FROM user_brew_card ubc JOIN v_customer_identity vci ON vci.user_id = ubc.user_id
      WHERE vci.canonical_user_id = $1
      ORDER BY ubc.coffee_id, ubc.method, ubc.updated_at DESC`,
    [canonicalId]
  );
  return r.rows.map(x => ({
    coffeeId: x.coffee_id, method: x.method,
    ratio: typeof x.params?.ratio === 'string' ? x.params.ratio : null,
    grindLabel: typeof x.params?.grindLabel === 'string' ? x.params.grindLabel : null,
    tempC: typeof x.params?.tempC === 'number' ? x.params.tempC : null,
  }));
}

export interface LiamSessionHistory {
  sessionId: number;
  at: Date;
  recommendedCoffeeIds: number[];
  answers: string[]; // the customer's recorded reply text to Liam's questions, in order
}
/** The last `limit` earlier sessions with a recorded recommendation or answered question (L3 write-back facts), newest first. */
export async function getLiamHistory(uid: string, limit: number, excludeSessionId: number | null = null, runner: Runner = db): Promise<LiamSessionHistory[]> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return [];
  const r = await runner.query<{ session_id: number; at: Date; recommended: number[] | null; answers: string[] | null }>(
    `WITH recs AS (
       SELECT clr.session_id, clr.occurred_at, clr.coffee_id
         FROM customer_liam_recommendation clr JOIN v_customer_identity vci ON vci.user_id = clr.user_id
        WHERE vci.canonical_user_id = $1 AND clr.session_id IS NOT NULL),
     replies AS (
       SELECT clq.session_id, clrep.occurred_at, clrep.reply
         FROM customer_liam_reply clrep
         JOIN customer_liam_question clq ON clq.id = clrep.question_id
         JOIN v_customer_identity vci ON vci.user_id = clrep.user_id
        WHERE vci.canonical_user_id = $1 AND clq.session_id IS NOT NULL),
     sessions AS (
       SELECT session_id, MAX(occurred_at) AS at FROM (
         SELECT session_id, occurred_at FROM recs UNION ALL SELECT session_id, occurred_at FROM replies) s
        WHERE ($2::int IS NULL OR session_id <> $2)
        GROUP BY session_id
        ORDER BY MAX(occurred_at) DESC
        LIMIT $3)
     SELECT s.session_id, s.at,
            (SELECT array_agg(DISTINCT r.coffee_id) FROM recs r WHERE r.session_id = s.session_id AND r.coffee_id IS NOT NULL) AS recommended,
            (SELECT array_agg(p.reply ORDER BY p.occurred_at) FROM replies p WHERE p.session_id = s.session_id AND p.reply IS NOT NULL) AS answers
       FROM sessions s ORDER BY s.at DESC`,
    [canonicalId, excludeSessionId, limit]
  );
  return r.rows.map(x => ({ sessionId: x.session_id, at: x.at, recommendedCoffeeIds: x.recommended ?? [], answers: x.answers ?? [] }));
}
