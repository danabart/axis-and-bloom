// Customer Blueprint C3, Part D step 2 — loads the ten-customer read fixture
// (Claude outputs/palate_read_fixture_v1.xlsx, reviewed and decided by Dana,
// 2026-09-27; backend/src/fixtures/palate/timelines.json + expected.json
// derived from that reviewed sheet) under the owner connection, inside one
// transaction that is ALWAYS rolled back in `finally` — nothing here ever
// persists, win or fail. Runs every v_palate_*/v_customer_bag_attribution
// view and asserts against expected.json. The 37-case quiz fixture
// (quizScoring.test.ts) is untouched by this file.
//
// Catalog-side fixtures (coffees, cupping, dial-slot assignment) reuse the
// REAL coffee_dial_slot row for each archetype (one already exists per
// archetype, sort_order 1-4) rather than creating new ones — sort_order is
// capped at 1-4 per archetype by a CHECK constraint, and production already
// occupies those. Any existing 'home' assignment on that slot is deactivated
// for the duration of the transaction so the fixture coffee deterministically
// wins v_coffee_sellable_slot's ranking; this never persists (rollback).
import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ownerPool, whoAmI, type Tx } from '../db/client.js';
import { record } from './customerFacts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures', 'palate');

interface FixtureCoffee {
  name: string;
  archetype: string;
  is_slot: boolean;
  dims: Record<string, [number, number]>;
  descriptors: string[];
}
interface FixtureLine {
  id: string; coffee: string; order_at: string; attribution: string; drinker: string; order_kind: string;
  household_id: string | null; claimed_at: string | null;
  feedback: { rating: number; at: string } | null;
}
interface FixtureQuestion {
  id: string; at: string; kind: string; question: string; reply: string | null; replied_at: string | null;
}
interface FixtureRecommendation {
  id: string; coffee: string; at: string; followed_line_id: string | null; ordered_at: string | null;
}
interface FixtureCustomer {
  name: string;
  quiz: { archetype: string; at: string; secondary: string | null } | null;
  lines: FixtureLine[];
  questions: FixtureQuestion[];
  recommendations: FixtureRecommendation[];
}
interface FixtureFile {
  coffees: Record<string, FixtureCoffee>;
  customers: Record<string, FixtureCustomer>;
  identity_links: Array<{ from: string; to: string; how: string; at: string }>;
  canonical_groups: Record<string, string[]>;
}
interface ExpectedEntry {
  canonical: string; label: string; view: string; summary: string; rows: Record<string, unknown>[];
}

const fixture: FixtureFile = JSON.parse(readFileSync(path.join(FIXTURES_DIR, 'timelines.json'), 'utf-8'));
const expectedEntries: ExpectedEntry[] = JSON.parse(readFileSync(path.join(FIXTURES_DIR, 'expected.json'), 'utf-8'));

const owner = ownerPool();
let tx: Tx;

const profileIdByCid: Record<string, string> = {};
const coffeeIdByKey: Record<string, number> = {};
// expected.json's own coffee_id fields are the coffee NAME ("Vitest Coffee
// F"), not the short fixture key ("F") — resolve through this instead.
const coffeeIdByName: Record<string, number> = {};
const cuppingNoteIdByDescriptor: Record<string, string> = {};
const realSlotIdByArchetype: Record<string, number> = {};
const orderIdByLineId: Record<string, string> = {};
const orderLineItemIdByFixtureId: Record<string, string> = {};
const householdId = { value: '' };
const dimensionIdByName: Record<string, number> = {};

async function loadFixtures(client: Tx): Promise<void> {
  // 1. Household (for the fiona/gary scenario).
  const hh = await client.query<{ id: string }>(`INSERT INTO household (household_name) VALUES ('Vitest Household') RETURNING id`);
  householdId.value = hh.rows[0].id;

  // 2. user_profile per raw fixture customer id. firebase_uid must be unique;
  // "vitest-<cid>" is stable and obviously a fixture.
  for (const cid of Object.keys(fixture.customers)) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO user_profile (firebase_uid, household_id) VALUES ($1, $2) RETURNING id`,
      [`vitest-${cid}`, cid === 'fiona' || cid === 'gary' ? householdId.value : null]
    );
    profileIdByCid[cid] = r.rows[0].id;
  }

  // 3. Dimension ids (already seeded — just look them up).
  const dims = await client.query<{ id: number; name: string }>(`SELECT id, name FROM coffee_dimensions WHERE name IN ('Acidity', 'Body', 'Sweetness')`);
  for (const row of dims.rows) dimensionIdByName[row.name] = row.id;

  // 4. Roaster + coffees + coffee_sku + archetype assignment.
  const roaster = await client.query<{ id: string }>(`INSERT INTO roaster (name) VALUES ('Vitest Roaster') RETURNING id`);
  const roasterId = roaster.rows[0].id;

  for (const [key, c] of Object.entries(fixture.coffees)) {
    const coffeeResult = await client.query<{ id: number }>(
      `INSERT INTO coffees (name, roaster_id, is_active) VALUES ($1, $2, true) RETURNING id`,
      [c.name, roasterId]
    );
    const coffeeId = coffeeResult.rows[0].id;
    coffeeIdByKey[key] = coffeeId;
    coffeeIdByName[c.name] = coffeeId;

    await client.query(
      `INSERT INTO coffee_archetype_assignment (coffee_id, archetype, confidence) VALUES ($1, $2, 'high')`,
      [coffeeId, c.archetype]
    );

    await client.query(
      `INSERT INTO coffee_sku (roaster_id, blend_name, coffee_id, is_active, weight_oz) VALUES ($1, $2, $3, true, 12)`,
      [roasterId, `${c.name} 12oz`, coffeeId]
    );
  }

  // 5. Cupping: one merged score row per coffee, one value per dimension.
  const session = await client.query<{ id: number }>(`INSERT INTO cupping_sessions (session_date) VALUES (now()) RETURNING id`);
  const sessionId = session.rows[0].id;

  const noteCache: Record<string, string> = {};
  async function noteIdFor(descriptor: string): Promise<string> {
    if (noteCache[descriptor]) return noteCache[descriptor];
    const r = await client.query<{ id: string }>(
      `INSERT INTO cupping_note (wheel_category, wheel_subcategory, descriptor) VALUES ('Vitest', 'Vitest', $1) RETURNING id`,
      [descriptor]
    );
    noteCache[descriptor] = r.rows[0].id;
    cuppingNoteIdByDescriptor[descriptor] = r.rows[0].id;
    return r.rows[0].id;
  }

  for (const [key, c] of Object.entries(fixture.coffees)) {
    const coffeeId = coffeeIdByKey[key];
    const sc = await client.query<{ id: number }>(
      `INSERT INTO cupping_session_coffees (session_id, coffee_id) VALUES ($1, $2) RETURNING id`,
      [sessionId, coffeeId]
    );
    const sessionCoffeeId = sc.rows[0].id;
    const score = await client.query<{ id: number }>(
      `INSERT INTO cupping_scores (session_coffee_id, taster_name, is_merged) VALUES ($1, 'Vitest Merged', true) RETURNING id`,
      [sessionCoffeeId]
    );
    const cuppingScoreId = score.rows[0].id;

    for (const [dimName, [min, max]] of Object.entries(c.dims)) {
      await client.query(
        `INSERT INTO cupping_score_values (cupping_score_id, dimension_id, value_min, value_max) VALUES ($1, $2, $3, $4)`,
        [cuppingScoreId, dimensionIdByName[dimName], min, max]
      );
    }
    for (const descriptor of c.descriptors) {
      const noteId = await noteIdFor(descriptor);
      await client.query(
        `INSERT INTO cupping_score_descriptors (cupping_score_id, cupping_note_id) VALUES ($1, $2)`,
        [cuppingScoreId, noteId]
      );
    }
  }

  // 6. Dial-slot assignment: reuse the REAL sort_order=1 slot per archetype;
  // deactivate any existing assignment on it for the duration of this
  // transaction so the fixture coffee deterministically wins the ranking.
  const slotArchetypes = [...new Set(Object.values(fixture.coffees).filter(c => c.is_slot).map(c => c.archetype))];
  for (const archetype of slotArchetypes) {
    const slot = await client.query<{ id: number }>(
      `SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = 1`,
      [archetype]
    );
    if (!slot.rows.length) throw new Error(`No real coffee_dial_slot found for archetype=${archetype} sort_order=1 — fixture assumption broken`);
    realSlotIdByArchetype[archetype] = slot.rows[0].id;
    await client.query(`UPDATE coffee_slot_assignment SET is_active = false WHERE slot_id = $1`, [slot.rows[0].id]);
    // v_coffee_sellable_slot (which v_palate_slot_candidates joins through)
    // requires a coffee_slot_price row at (slot_id, weight_oz) with a
    // non-null retail_price_cents for is_sellable — none exists at 12oz for
    // these real slots in a fresh test DB.
    await client.query(
      `INSERT INTO coffee_slot_price (slot_id, weight_oz, retail_price_cents) VALUES ($1, 12, 1800)
       ON CONFLICT (slot_id, weight_oz) DO UPDATE SET retail_price_cents = EXCLUDED.retail_price_cents`,
      [slot.rows[0].id]
    );
  }
  for (const [key, c] of Object.entries(fixture.coffees)) {
    if (!c.is_slot) continue;
    await client.query(
      `INSERT INTO coffee_slot_assignment (slot_id, coffee_id, role, priority, is_active) VALUES ($1, $2, 'home', 1, true)`,
      [realSlotIdByArchetype[c.archetype], coffeeIdByKey[key]]
    );
  }

  // 7. quiz_session per customer with a quiz.
  for (const [cid, cust] of Object.entries(fixture.customers)) {
    if (!cust.quiz) continue;
    const archetypeRow = await client.query<{ id: string }>(`SELECT id FROM coffee_archetype WHERE code = $1`, [cust.quiz.archetype]);
    const secondaryLabel = cust.quiz.secondary
      ? (await client.query<{ name: string }>(`SELECT name FROM coffee_archetype WHERE code = $1`, [cust.quiz.secondary])).rows[0]?.name
      : null;
    await client.query(
      `INSERT INTO quiz_session (user_id, resulting_archetype_id, completed_at, context_data)
       VALUES ($1, $2, $3, $4)`,
      [profileIdByCid[cid], archetypeRow.rows[0].id, cust.quiz.at,
       JSON.stringify({ secondaryArchetype: secondaryLabel ?? null })]
    );
  }

  // 8. Orders + order_line_item. A line can appear under more than one
  // customer's `lines` array (the household scenario: OL_household_1 is
  // listed under both Fiona — the buyer — and Gary — the drinker who claims
  // and rates it) — the JSON represents that as one line entry per involved
  // party's perspective, not one row per order. Dedup by line.id first so
  // the order/line-item is created exactly once, attributed to whichever
  // owner is NOT the drinker (the buyer); a single-owner line has buyer ===
  // drinker, matching every non-household customer.
  interface UniqueLine extends FixtureLine { ownerCids: string[] }
  const uniqueLinesById = new Map<string, UniqueLine>();
  for (const [cid, cust] of Object.entries(fixture.customers)) {
    for (const line of cust.lines) {
      const existing = uniqueLinesById.get(line.id);
      if (existing) {
        existing.ownerCids.push(cid);
        if (!existing.feedback && line.feedback) existing.feedback = line.feedback;
      } else {
        uniqueLinesById.set(line.id, { ...line, ownerCids: [cid] });
      }
    }
  }
  const uniqueLines = [...uniqueLinesById.values()];

  for (const line of uniqueLines) {
    const buyerCid = line.ownerCids.find(c => c !== line.drinker) ?? line.ownerCids[0];
    const orderResult = await client.query<{ id: string }>(
      `INSERT INTO "order" (user_id, household_id, created_at) VALUES ($1, $2, $3) RETURNING id`,
      [profileIdByCid[buyerCid], line.household_id ? householdId.value : null, line.order_at]
    );
    const orderId = orderResult.rows[0].id;
    orderIdByLineId[line.id] = orderId;

    const skuResult = await client.query<{ id: string }>(`SELECT id FROM coffee_sku WHERE coffee_id = $1`, [coffeeIdByKey[line.coffee]]);
    const intendedForUserId = null; // never set in this fixture (D7's own buyer-branch test covers the default path)
    const oli = await client.query<{ id: string }>(
      `INSERT INTO order_line_item (order_id, blend_id, intended_for_user_id, order_kind) VALUES ($1, $2, $3, $4) RETURNING id`,
      [orderId, skuResult.rows[0].id, intendedForUserId, line.order_kind]
    );
    orderLineItemIdByFixtureId[line.id] = oli.rows[0].id;
  }

  // 9. Facts: feedback, bag claims, liam recommendations/questions/replies,
  // identity links — all via customerFacts.record.*.backfill() (owner-only),
  // same door every other backfill in this Blueprint uses. Feedback/claims
  // are recorded once per unique line, attributed to the drinker (who is
  // who actually rated/claimed the bag), not the buyer.
  let turn = 0;
  for (const line of uniqueLines) {
    if (line.feedback) {
      await record.feedback.backfill({
        userId: profileIdByCid[line.drinker], source: 'backfill', sourceId: `${line.id}:feedback`,
        occurredAt: new Date(line.feedback.at), orderLineItemId: orderLineItemIdByFixtureId[line.id],
        coffeeId: coffeeIdByKey[line.coffee], rating: line.feedback.rating, channel: 'onsite',
      }, client);
    }
    if (line.claimed_at) {
      await record.bagClaim.backfill({
        userId: profileIdByCid[line.drinker], source: 'backfill', sourceId: `${line.id}:claim`,
        occurredAt: new Date(line.claimed_at), coffeeId: coffeeIdByKey[line.coffee],
        orderLineItemId: orderLineItemIdByFixtureId[line.id],
      }, client);
    }
  }
  for (const [cid, cust] of Object.entries(fixture.customers)) {
    for (const q of cust.questions) {
      turn++;
      await record.liamQuestion.backfill({
        userId: profileIdByCid[cid], source: 'backfill', sourceId: q.id,
        occurredAt: new Date(q.at), sessionId: 1, turn, messageId: `${q.id}:msg`,
        kind: q.kind as 'thread' | 'palate' | 'brew', question: q.question,
      }, client);
      if (q.reply) {
        const questionRow = await client.query<{ id: string }>(`SELECT id FROM customer_liam_question WHERE source_id = $1`, [q.id]);
        await record.liamReply.backfill({
          userId: profileIdByCid[cid], source: 'backfill', sourceId: `${q.id}:reply`,
          occurredAt: new Date(q.replied_at ?? q.at), questionId: questionRow.rows[0].id, reply: q.reply, messageId: `${q.id}:reply:msg`,
        }, client);
      }
    }
    for (const rec of cust.recommendations) {
      turn++;
      const coffeeId = coffeeIdByKey[rec.coffee];
      await record.liamRecommendation.backfill({
        userId: profileIdByCid[cid], source: 'backfill', sourceId: rec.id,
        occurredAt: new Date(rec.at), sessionId: 1, turn, messageId: `${rec.id}:msg`,
        coffeeId, candidateCoffeeIds: [coffeeId],
      }, client);
    }
  }
  for (const link of fixture.identity_links) {
    await record.identityLink.backfill({
      userId: profileIdByCid[link.from], source: 'backfill', sourceId: `${link.from}:${link.to}`,
      occurredAt: new Date(link.at), fromUserId: profileIdByCid[link.from], toUserId: profileIdByCid[link.to],
      how: link.how as 'email_match' | 'household_claim' | 'admin',
    }, client);
  }
}

beforeAll(async () => {
  tx = await owner.connect();
  const currentUser = await whoAmI(tx);
  if (currentUser === 'ab_app') throw new Error('palateReads.test.ts must run under the owner role, not ab_app');
  await tx.query('BEGIN');
  await loadFixtures(tx);
}, 60000);

afterAll(async () => {
  if (tx) {
    await tx.query('ROLLBACK').catch(() => {});
    tx.release();
  }
  await owner.end();
});

describe('palate read fixture (Customer Blueprint C3, Part D)', () => {
  for (const entry of expectedEntries) {
    const { canonical, label, view } = entry;

    it(`${view} — ${canonical} (${label})`, async () => {
      await tx.query('SAVEPOINT test_case');
      try {
        await runCase();
      } finally {
        await tx.query('ROLLBACK TO SAVEPOINT test_case');
        await tx.query('RELEASE SAVEPOINT test_case');
      }

      async function runCase() {
      if (view === 'v_customer_bag_attribution') {
        // Keyed by order_line_item_id, not canonical_user_id — resolved via
        // the buyer profile's own placed lines instead.
        const lineIds = fixture.customers[canonical].lines.map(l => orderLineItemIdByFixtureId[l.id]);
        const rows = await tx.query(
          `SELECT * FROM v_customer_bag_attribution WHERE order_line_item_id = ANY($1::uuid[])`,
          [lineIds]
        );
        expect(rows.rows).toHaveLength(entry.rows.length);
        for (const expectedRow of entry.rows) {
          const actual = rows.rows.find(r => r.order_line_item_id === orderLineItemIdByFixtureId[expectedRow.order_line_item_id as string]);
          expect(actual, `missing row for ${expectedRow.order_line_item_id}`).toBeDefined();
          expect(actual.coffee_id).toBe(coffeeIdByName[expectedRow.coffee_id as string]);
          expect(actual.order_kind).toBe(expectedRow.order_kind);
          expect(actual.attribution).toBe(expectedRow.attribution);
          expect(actual.drinker_user_id).toBe(profileIdByCid[expectedRow.drinker_user_id as string]);
        }
        return;
      }

      const result = await tx.query(`SELECT * FROM ${view} WHERE canonical_user_id = $1`, [profileIdByCid[canonical]]);

      if (view === 'v_palate_evidence') {
        expect(result.rows).toHaveLength(entry.rows.length ? 1 : 0);
        if (entry.rows.length) {
          const expectedRow = entry.rows[0];
          const actual = result.rows[0];
          expect(Number(actual.n_attributed_lines)).toBe(expectedRow.n_attributed_lines);
          expect(Number(actual.n_distinct_coffees)).toBe(expectedRow.n_distinct_coffees);
          expect(Number(actual.n_feedback_positive)).toBe(expectedRow.n_feedback_positive);
          expect(Number(actual.n_feedback_negative)).toBe(expectedRow.n_feedback_negative);
          expect(Number(actual.n_recommendations)).toBe(expectedRow.n_recommendations);
          expect(Number(actual.n_questions_asked)).toBe(expectedRow.n_questions_asked);
          expect(Number(actual.n_questions_answered)).toBe(expectedRow.n_questions_answered);
          expect(actual.has_quiz).toBe(expectedRow.has_quiz);
        }
        return;
      }

      if (view === 'v_palate_shared_traits') {
        expect(result.rows).toHaveLength(entry.rows.length);
        for (const expectedRow of entry.rows) {
          // Match on trait_label, not trait_key: for kind='dimension' the
          // view's own trait_key is the numeric dimension_id (see
          // schema.sql's v_palate_shared_traits), while expected.json's
          // trait_key is the dimension's name — trait_label is the name in
          // both, for dimension and descriptor rows alike.
          const actual = result.rows.find(r => r.trait_label === expectedRow.trait_label && r.kind === expectedRow.kind);
          expect(actual, `missing trait ${expectedRow.kind}/${expectedRow.trait_label}`).toBeDefined();
          if (expectedRow.kind === 'dimension') {
            expect(Number(actual.value_min)).toBe(expectedRow.value_min);
            expect(Number(actual.value_max)).toBe(expectedRow.value_max);
            expect(actual.overlaps).toBe(expectedRow.overlaps);
          }
          expect(Number(actual.n_coffees)).toBe(expectedRow.n_coffees);
        }
        return;
      }

      if (view === 'v_palate_dominant_dimensions') {
        expect(result.rows).toHaveLength(entry.rows.length);
        for (const expectedRow of entry.rows) {
          const actual = result.rows.find(r => r.dimension_name === expectedRow.dimension_name);
          expect(actual, `missing dimension ${expectedRow.dimension_name}`).toBeDefined();
          expect(Number(actual.mean_midpoint)).toBeCloseTo(expectedRow.mean_midpoint as number, 3);
          expect(Number(actual.n_coffees)).toBe(expectedRow.n_coffees);
          expect(Number(actual.n_liked)).toBe(expectedRow.n_liked);
          expect(Number(actual.n_disliked)).toBe(expectedRow.n_disliked);
        }
        return;
      }

      if (view === 'v_palate_archetype_spread') {
        expect(result.rows).toHaveLength(entry.rows.length);
        for (const expectedRow of entry.rows) {
          const actual = result.rows.find(r => r.match_archetype === expectedRow.match_archetype);
          expect(actual, `missing archetype ${expectedRow.match_archetype}`).toBeDefined();
          expect(Number(actual.n_coffees)).toBe(expectedRow.n_coffees);
          expect(Number(actual.n_positive)).toBe(expectedRow.n_positive);
          expect(Number(actual.n_negative)).toBe(expectedRow.n_negative);
        }
        return;
      }

      if (view === 'v_palate_threads') {
        expect(result.rows).toHaveLength(entry.rows.length);
        for (const expectedRow of entry.rows) {
          const actual = result.rows.find(r => r.question === expectedRow.question);
          expect(actual, `missing question ${expectedRow.question}`).toBeDefined();
          expect(actual.status).toBe(expectedRow.status);
          expect(actual.reply).toBe(expectedRow.reply);
        }
        return;
      }

      if (view === 'v_palate_recommendation_outcome') {
        expect(result.rows).toHaveLength(entry.rows.length);
        for (const expectedRow of entry.rows) {
          const actual = result.rows.find(r => r.coffee_id === coffeeIdByName[expectedRow.coffee_id as string]);
          expect(actual, `missing recommendation for ${expectedRow.coffee_id}`).toBeDefined();
          if (expectedRow.days_to_order !== null) {
            expect(Number(actual.days_to_order)).toBeCloseTo(expectedRow.days_to_order as number, 1);
          } else {
            expect(actual.days_to_order).toBeNull();
          }
          expect(actual.feedback_rating).toBe(expectedRow.feedback_rating);
        }
        return;
      }

      if (view === 'v_palate_slot_candidates') {
        expect(result.rows).toHaveLength(entry.rows.length);
        // Per-row values (order-independent check first).
        for (const expectedRow of entry.rows) {
          const actual = result.rows.find(r => r.coffee_id === coffeeIdByName[expectedRow.coffee_id as string]);
          expect(actual, `missing slot candidate ${expectedRow.coffee_id}`).toBeDefined();
          expect(Number(actual.n_dims_overlapping)).toBe(expectedRow.n_dims_overlapping);
          expect(Number(actual.n_dims_compared)).toBe(expectedRow.n_dims_compared);
          expect(Number(actual.n_dims_disliked_overlap)).toBe(expectedRow.n_dims_disliked_overlap);
          expect(actual.in_pair).toBe(expectedRow.in_pair);
          expect(actual.already_bought).toBe(expectedRow.already_bought);
          expect(actual.last_rating).toBe(expectedRow.last_rating);
        }
        // Order check: re-derive the expected sort using the REAL slot ids
        // just resolved (rule 4's tiebreak needs them; the JSON fixture
        // can't know them in advance — see the file header).
        const expectedOrder = [...entry.rows].sort((a: any, b: any) => {
          const bySlot = (r: any) => realSlotIdByArchetype[r.slot_archetype as string];
          if (a.in_pair !== b.in_pair) return a.in_pair ? -1 : 1;
          if (a.n_dims_overlapping !== b.n_dims_overlapping) return b.n_dims_overlapping - a.n_dims_overlapping;
          if (a.n_dims_disliked_overlap !== b.n_dims_disliked_overlap) return a.n_dims_disliked_overlap - b.n_dims_disliked_overlap;
          if (a.n_dims_compared !== b.n_dims_compared) return b.n_dims_compared - a.n_dims_compared;
          return bySlot(a) - bySlot(b);
        });
        const actualOrderCoffeeIds = result.rows.map(r => r.coffee_id);
        const expectedOrderCoffeeIds = expectedOrder.map((r: any) => coffeeIdByName[r.coffee_id as string]);
        expect(actualOrderCoffeeIds).toEqual(expectedOrderCoffeeIds);
        return;
      }

      throw new Error(`No assertion branch written for view ${view}`);
      }
    });
  }
});
