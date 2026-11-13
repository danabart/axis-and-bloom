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
            -- Family Household 1 (2026-11-07): other active members, from v_household_membership.
            (SELECT COUNT(*) FROM v_household_membership other
              JOIN v_household_membership me ON me.household_id = other.household_id
               AND me.user_id = $1 AND me.status_code = 'active'
              WHERE other.status_code = 'active' AND other.user_id <> $1) AS household_members`,
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

export interface SubscriptionCurrent { status: string; sponsored: boolean; label?: string }
// Rev 2: status and sponsored only. next_delivery_date and frequency_days are
// never written; price and payment are not Liam's to say. Commerce 3 (OT-62):
// label is subscription_status.customer_label, the words Liam says ("Payment
// needs a look", never the code past_due).
export async function getSubscriptionCurrent(uid: string, runner: Runner = db): Promise<SubscriptionCurrent | null> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return null;
  const r = await runner.query<{ status: string; sponsored: boolean; label: string | null }>(
    `SELECT s.status, (s.company_gift_id IS NOT NULL OR s.sponsored_expires_at IS NOT NULL) AS sponsored, st.customer_label AS label
       FROM subscription s JOIN v_customer_identity vci ON vci.user_id = s.user_id
       LEFT JOIN subscription_status st ON st.code = s.status
      WHERE vci.canonical_user_id = $1
      ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
      LIMIT 1`,
    [canonicalId]
  );
  return r.rows[0] ? { status: r.rows[0].status, sponsored: r.rows[0].sponsored, label: r.rows[0].label ?? r.rows[0].status } : null;
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

// ── Family Household 2 (2026-11-07) ────────────────────────────────────────
// The two household reads of customer_* facts (lint:customer rule 4 keeps every
// such read in this file).

export interface DialTurnByOther {
  dial_event_id: string; occurred_at: string; archetype_code: string; slot_name: string | null;
  actor_first_name: string | null; undone: boolean; is_current: boolean;
}
/**
 * D27: dial turns someone else made for this person (actor_user_id set), across
 * their linked profiles, newest first. `is_current`: the turn's slot is still
 * the person's position for that archetype and no later dial event exists;
 * `undone`: a dial_turn_undone household event names it.
 */
export async function getDialTurnsByOthers(userId: string, runner: Runner = db): Promise<DialTurnByOther[]> {
  const r = await runner.query<DialTurnByOther>(
    `WITH me AS (SELECT canonical_user_id FROM v_customer_identity WHERE user_id = $1)
     SELECT cde.id AS dial_event_id, cde.occurred_at, cde.archetype_code::text AS archetype_code, cds.name AS slot_name,
            actor.first_name AS actor_first_name,
            EXISTS (SELECT 1 FROM household_event e JOIN household_event_kind k ON k.id = e.kind_id AND k.code = 'dial_turn_undone'
                     WHERE e.detail ->> 'dial_event_id' = cde.id::text) AS undone,
            (dc.slot_id IS NOT DISTINCT FROM cde.slot_id
             AND NOT EXISTS (SELECT 1 FROM customer_dial_event later
                               JOIN v_customer_identity lv ON lv.user_id = later.user_id
                              WHERE lv.canonical_user_id = (SELECT canonical_user_id FROM me)
                                AND later.archetype_code = cde.archetype_code AND later.occurred_at > cde.occurred_at)) AS is_current
     FROM customer_dial_event cde
     JOIN v_customer_identity vci ON vci.user_id = cde.user_id AND vci.canonical_user_id = (SELECT canonical_user_id FROM me)
     LEFT JOIN coffee_dial_slot cds ON cds.id = cde.slot_id
     LEFT JOIN user_profile actor ON actor.id = cde.actor_user_id
     LEFT JOIN v_customer_dial_current dc ON dc.canonical_user_id = vci.canonical_user_id AND dc.archetype = cde.archetype_code
     WHERE cde.actor_user_id IS NOT NULL
     ORDER BY cde.occurred_at DESC
     LIMIT 50`, [userId]
  );
  return r.rows;
}

/** D25: the household_claim link written when this member's join link was accepted (latest), and whether it is undone. */
export async function getHouseholdClaimLink(memberId: string, runner: Runner = db): Promise<{ id: string; from_user_id: string; to_user_id: string; unlinked: boolean } | null> {
  const r = await runner.query<{ id: string; from_user_id: string; to_user_id: string; unlinked: boolean }>(
    `SELECT cil.id, cil.from_user_id, cil.to_user_id,
            EXISTS (SELECT 1 FROM customer_identity_unlink u WHERE u.link_id = cil.id) AS unlinked
     FROM customer_identity_link cil
     JOIN household_invitation hi ON cil.source_id = 'household_invitation:' || hi.id::text
     WHERE hi.member_id = $1 AND cil.how = 'household_claim'
     ORDER BY cil.occurred_at DESC LIMIT 1`, [memberId]
  );
  return r.rows[0] ?? null;
}


// ── Ella's Bloom Map 3 (2026-11-12): the match decision log's reads ─────────
// Keyed by user_profile.id (a household member may have no sign-in of their
// own); every read folds to the canonical user (v_customer_identity).

export interface MatchCurrentRow {
  canonicalUserId: string; decisionId: string; userId: string; actorUserId: string | null; occurredAt: string;
  decidedVersionId: number; moveCode: string; source: string; coffeeId: number; coffeeName: string;
  isInActiveVersion: boolean; placementVersionId: number | null; archetypeCode: string | null; isCenter: boolean | null;
  ring: number | null; laneCode: string | null; size: number | null; isSellable: boolean; inStock: boolean;
}

async function canonicalOfProfile(profileId: string, runner: Runner): Promise<string | null> {
  const r = await runner.query<{ canonical_user_id: string }>(
    `SELECT canonical_user_id FROM v_customer_identity WHERE user_id = $1`, [profileId]);
  return r.rows[0]?.canonical_user_id ?? null;
}

/** The position (v_customer_match_current) for a profile, or null before the first decision. */
export async function getMatchCurrent(profileId: string, runner: Runner = db): Promise<MatchCurrentRow | null> {
  const canonical = await canonicalOfProfile(profileId, runner);
  if (!canonical) return null;
  const r = await runner.query(`SELECT * FROM v_customer_match_current WHERE canonical_user_id = $1`, [canonical]);
  const x = r.rows[0];
  if (!x) return null;
  return {
    canonicalUserId: x.canonical_user_id, decisionId: x.decision_id, userId: x.user_id, actorUserId: x.actor_user_id,
    occurredAt: x.occurred_at, decidedVersionId: x.decided_version_id, moveCode: x.move_code, source: x.source,
    coffeeId: x.coffee_id, coffeeName: x.coffee_name, isInActiveVersion: x.is_in_active_version,
    placementVersionId: x.placement_version_id, archetypeCode: x.archetype_code, isCenter: x.is_center,
    ring: x.ring, laneCode: x.lane_code, size: x.size, isSellable: x.is_sellable, inStock: x.in_stock,
  };
}

/** Every decision for a profile's canonical user, in order (v_customer_match_trail). */
export async function getMatchTrail(profileId: string, runner: Runner = db) {
  const canonical = await canonicalOfProfile(profileId, runner);
  if (!canonical) return [];
  const r = await runner.query(
    `SELECT decision_id, step, occurred_at, move_code, actor_user_id, user_id, from_coffee_id, picked_coffee_id, picked_coffee_name,
            version_id, version_label, source, active_archetype_code, active_is_center, active_ring, active_lane_code, active_size
       FROM v_customer_match_trail WHERE canonical_user_id = $1 ORDER BY step`, [canonical]);
  return r.rows;
}

/** The decision a (source, source_id) wrote, for the idempotent re-select. */
export async function getMatchDecisionBySource(source: string, sourceId: string, runner: Runner = db) {
  const r = await runner.query(
    `SELECT decision_id, user_id, move_code, picked_coffee_id, picked_coffee_name, version_id, occurred_at
       FROM v_customer_match_trail WHERE source = $1 AND source_id = $2`, [source, sourceId]);
  return r.rows[0] ?? null;
}

/** Recent decisions with their candidates (the workbench's Decisions card); one profile's when given. */
export async function getMatchDecisions(opts: { profileId?: string | null; limit: number }, runner: Runner = db) {
  const canonical = opts.profileId ? await canonicalOfProfile(opts.profileId, runner) : null;
  if (opts.profileId && !canonical) return [];
  const d = await runner.query(
    `SELECT t.decision_id, t.canonical_user_id, t.user_id, t.actor_user_id, t.occurred_at, t.step, t.move_code, t.source, t.source_id,
            t.version_label, t.from_coffee_id, f.name AS from_coffee_name, t.picked_coffee_id, t.picked_coffee_name, t.inputs
       FROM v_customer_match_trail t
       LEFT JOIN coffees f ON f.id = t.from_coffee_id
      WHERE ($1::uuid IS NULL OR t.canonical_user_id = $1)
      ORDER BY t.occurred_at DESC, t.created_at DESC
      LIMIT $2`, [canonical, opts.limit]);
  const ids = d.rows.map(x => x.decision_id);
  const c = ids.length ? await runner.query(
    `SELECT mc.decision_id, mc.coffee_id, co.name AS coffee_name, m.code AS move_code, mc.rank, mc.distance
       FROM customer_match_candidate mc
       JOIN coffees co ON co.id = mc.coffee_id
       JOIN dial_move m ON m.id = mc.move_id
      WHERE mc.decision_id = ANY($1::uuid[])
      ORDER BY m.sort_order, mc.rank`, [ids]) : { rows: [] as Array<Record<string, unknown>> };
  return d.rows.map(x => ({ ...x, candidates: c.rows.filter(y => y.decision_id === x.decision_id) }));
}

export interface MatchQuizContext {
  quizSessionId: string; userId: string; takenByUserId: string | null;
  matchArchetypeName: string | null; matchArchetypeCode: string | null;
  secondaryArchetypeName: string | null; secondaryArchetypeCode: string | null;
  intensityLean: string | null; quizDecaf: boolean;
}

/** One quiz session's match layer (the current interpretation), names mapped to codes through coffee_archetype. */
export async function getMatchQuizContext(quizSessionId: string, runner: Runner = db): Promise<MatchQuizContext | null> {
  const r = await runner.query(
    `SELECT qs.id, qs.user_id, qs.taken_by_user_id,
            COALESCE(i.match_archetype, ca.name) AS match_name, cm.code AS match_code,
            i.secondary_archetype AS secondary_name, cs.code AS secondary_code,
            i.intensity_lean, COALESCE((qs.context_data ->> 'decaf')::boolean, false) AS quiz_decaf
       FROM quiz_session qs
       LEFT JOIN quiz_session_interpretation i ON i.quiz_session_id = qs.id AND i.is_current
       LEFT JOIN coffee_archetype ca ON ca.id = qs.resulting_archetype_id
       LEFT JOIN coffee_archetype cm ON cm.name = COALESCE(i.match_archetype, ca.name)
       LEFT JOIN coffee_archetype cs ON cs.name = i.secondary_archetype
      WHERE qs.id = $1`, [quizSessionId]);
  const x = r.rows[0];
  if (!x) return null;
  return {
    quizSessionId: x.id, userId: x.user_id, takenByUserId: x.taken_by_user_id,
    matchArchetypeName: x.match_name, matchArchetypeCode: x.match_code,
    secondaryArchetypeName: x.secondary_name, secondaryArchetypeCode: x.secondary_code,
    intensityLean: x.intensity_lean, quizDecaf: x.quiz_decaf === true,
  };
}

/** The current quiz session (v_customer_quiz_current's choice: self-taken first, then recency) for a profile's canonical user. */
export async function getCurrentQuizSessionId(profileId: string, runner: Runner = db): Promise<string | null> {
  const canonical = await canonicalOfProfile(profileId, runner);
  if (!canonical) return null;
  const r = await runner.query<{ quiz_session_id: string }>(
    `SELECT quiz_session_id FROM v_customer_quiz_current WHERE canonical_user_id = $1`, [canonical]);
  return r.rows[0]?.quiz_session_id ?? null;
}

/** Decision 1: the brew profile's decaf setting for a profile (v_customer_brew_profile), or null when never stated. */
export async function getBrewDecafByProfile(profileId: string, runner: Runner = db): Promise<boolean | null> {
  const canonical = await canonicalOfProfile(profileId, runner);
  if (!canonical) return null;
  const r = await runner.query<{ value_jsonb: unknown }>(
    `SELECT value_jsonb FROM v_customer_brew_profile WHERE canonical_user_id = $1 AND field = 'decaf_constraint'`, [canonical]);
  if (!r.rows[0]) return null;
  const v = r.rows[0].value_jsonb;
  return v === true || v === 'true';
}

// ── Usual Drink 1 (2026-11-12): the three new brew-profile fields ────────────
// Reads through v_customer_usual_drink / v_customer_cupboard_coffee /
// v_customer_coffee_feeling (lookups joined regardless of is_active, A4).
// Callers in Usual Drink 1: the admin stats row only; not Liam's
// recommendation, not the map, not the dial (D5).
export interface UsualDrinkRow {
  fieldValueId: number; code: string; label: string; baseMethod: string; dilution: string; milk: string;
  isHomeDrink: boolean; customerWords: string | null; capturedAt: string | null; source: string | null; quizSessionId: string | null;
}
export async function getUsualDrinks(uid: string, runner: Runner = db): Promise<UsualDrinkRow[]> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return [];
  const r = await runner.query(
    `SELECT field_value_id, code, label, base_method, dilution, milk, is_home_drink, customer_words, captured_at, source, quiz_session_id
     FROM v_customer_usual_drink WHERE canonical_user_id = $1 ORDER BY field_value_id`, [canonicalId]);
  return r.rows.map(x => ({
    fieldValueId: x.field_value_id, code: x.code, label: x.label, baseMethod: x.base_method, dilution: x.dilution, milk: x.milk,
    isHomeDrink: x.is_home_drink, customerWords: x.customer_words, capturedAt: x.captured_at ? new Date(x.captured_at).toISOString() : null,
    source: x.source, quizSessionId: x.quiz_session_id,
  }));
}

export interface CupboardCoffeeRow {
  fieldValueId: number; code: string; label: string; brandKind: string; roasterId: string | null;
  customerWords: string | null; capturedAt: string | null; source: string | null; quizSessionId: string | null;
}
export async function getCupboardCoffee(uid: string, runner: Runner = db): Promise<CupboardCoffeeRow | null> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return null;
  const x = (await runner.query(
    `SELECT field_value_id, code, label, brand_kind, roaster_id, customer_words, captured_at, source, quiz_session_id
     FROM v_customer_cupboard_coffee WHERE canonical_user_id = $1`, [canonicalId])).rows[0];
  return x ? {
    fieldValueId: x.field_value_id, code: x.code, label: x.label, brandKind: x.brand_kind, roasterId: x.roaster_id,
    customerWords: x.customer_words, capturedAt: x.captured_at ? new Date(x.captured_at).toISOString() : null, source: x.source, quizSessionId: x.quiz_session_id,
  } : null;
}

export interface CoffeeFeelingRow {
  fieldValueId: number; code: string; label: string; moveCode: string; capturedAt: string | null; source: string | null; quizSessionId: string | null;
}
export async function getCoffeeFeeling(uid: string, runner: Runner = db): Promise<CoffeeFeelingRow | null> {
  const canonicalId = await resolveCanonicalUserId(uid, runner);
  if (!canonicalId) return null;
  const x = (await runner.query(
    `SELECT field_value_id, code, label, move_code, captured_at, source, quiz_session_id
     FROM v_customer_coffee_feeling WHERE canonical_user_id = $1`, [canonicalId])).rows[0];
  return x ? {
    fieldValueId: x.field_value_id, code: x.code, label: x.label, moveCode: x.move_code,
    capturedAt: x.captured_at ? new Date(x.captured_at).toISOString() : null, source: x.source, quizSessionId: x.quiz_session_id,
  } : null;
}

export interface BrewProfileFieldCounts {
  /** per field: customers with a value; declined rows and customers; coverage over quiz-sourced rows (set / (set + declined)) */
  fields: Array<{ field: string; customersWithValue: number; declinedRows: number; declinedCustomers: number; quizSet: number; quizDeclined: number; coverage: number | null }>;
  drinks: Array<{ code: string; label: string; customers: number }>;
  baseMethods: Array<{ code: string; customers: number }>;
  brands: Array<{ code: string; label: string; customers: number }>;
  brandKinds: Array<{ code: string; customers: number }>;
  feelings: Array<{ code: string; label: string; moveCode: string; customers: number }>;
  otherWords: Array<{ field: string; words: string; occurredAt: string; source: string }>;
  cardEvents: Array<{ event: string; n: number }>;
}
/** The admin stats row (Part D): one read over the views and customer_brew_profile_change (declines, words). */
export async function getBrewProfileFieldCounts(runner: Runner = db): Promise<BrewProfileFieldCounts> {
  const [fields, drinks, methods, brands, kinds, feelings, words, events] = await Promise.all([
    runner.query(
      `WITH c AS (
         SELECT vi.canonical_user_id, c.field, c.op, c.source FROM customer_brew_profile_change c
         JOIN v_customer_identity vi ON vi.user_id = c.user_id
       )
       SELECT f.field,
              (SELECT count(*)::int FROM v_customer_brew_profile b WHERE b.field = f.field) AS customers_with_value,
              count(*) FILTER (WHERE c.op = 'declined')::int AS declined_rows,
              count(DISTINCT c.canonical_user_id) FILTER (WHERE c.op = 'declined')::int AS declined_customers,
              count(*) FILTER (WHERE c.source = 'quiz' AND c.op = 'set')::int AS quiz_set,
              count(*) FILTER (WHERE c.source = 'quiz' AND c.op = 'declined')::int AS quiz_declined
       FROM (SELECT DISTINCT field FROM c UNION SELECT DISTINCT field FROM v_customer_brew_profile) f
       LEFT JOIN c ON c.field = f.field
       GROUP BY f.field ORDER BY f.field`),
    runner.query(`SELECT code, label, count(DISTINCT canonical_user_id)::int AS customers FROM v_customer_usual_drink GROUP BY code, label ORDER BY customers DESC, code`),
    runner.query(`SELECT base_method AS code, count(DISTINCT canonical_user_id)::int AS customers FROM v_customer_usual_drink GROUP BY base_method ORDER BY customers DESC, code`),
    runner.query(`SELECT code, label, count(*)::int AS customers FROM v_customer_cupboard_coffee GROUP BY code, label ORDER BY customers DESC, code`),
    runner.query(`SELECT brand_kind AS code, count(*)::int AS customers FROM v_customer_cupboard_coffee GROUP BY brand_kind ORDER BY customers DESC, code`),
    runner.query(`SELECT code, label, move_code, count(*)::int AS customers FROM v_customer_coffee_feeling GROUP BY code, label, move_code ORDER BY customers DESC, code`),
    runner.query(`SELECT field, customer_words AS words, occurred_at, source FROM customer_brew_profile_change WHERE customer_words IS NOT NULL ORDER BY occurred_at DESC LIMIT 100`),
    runner.query(`SELECT event, count(*)::int AS n FROM quiz_funnel_event WHERE event LIKE 'post\_result\_%' GROUP BY event ORDER BY event`),
  ]);
  return {
    fields: fields.rows.map(r => ({
      field: r.field, customersWithValue: r.customers_with_value, declinedRows: r.declined_rows, declinedCustomers: r.declined_customers,
      quizSet: r.quiz_set, quizDeclined: r.quiz_declined,
      coverage: r.quiz_set + r.quiz_declined > 0 ? Math.round((r.quiz_set / (r.quiz_set + r.quiz_declined)) * 1000) / 1000 : null,
    })),
    drinks: drinks.rows, baseMethods: methods.rows, brands: brands.rows, brandKinds: kinds.rows,
    feelings: feelings.rows.map(r => ({ code: r.code, label: r.label, moveCode: r.move_code, customers: r.customers })),
    otherWords: words.rows.map(r => ({ field: r.field, words: r.words, occurredAt: new Date(r.occurred_at).toISOString(), source: r.source })),
    cardEvents: events.rows,
  };
}

/**
 * Usual Drink 1 (D13): the purge guard's predicate, kept here so the one read
 * path for customer_* stays this file (lint-customer rule 4). `alias` is the
 * caller's user_profile alias, a fixed identifier from code, never input.
 */
export function hasBrewProfileFactsSql(alias: string): string {
  if (!/^[a-z_]+$/.test(alias)) throw new Error('hasBrewProfileFactsSql: alias must be a plain identifier');
  return `EXISTS (SELECT 1 FROM customer_brew_profile_change cbpc_guard WHERE cbpc_guard.user_id = ${alias}.id)`;
}
