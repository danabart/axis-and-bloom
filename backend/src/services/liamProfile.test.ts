// Liam L1, Part A — one assertion per fixture customer against a checked-in
// expected string, proven end to end (real reads, not mocks) against the C3
// palate fixture. Loads the fixture the same way palateReads.test.ts does
// (owner-authenticated backfill facts, "Vitest"/"vitest-" naming) inside one
// transaction that is ALWAYS rolled back in `finally` — nothing here ever
// persists, win or fail. Duplicates palateReads.test.ts's own loadFixtures()
// (rather than importing it — test files are excluded from that pattern, and
// the L1 brief says both palateReads.test.ts and the fixture JSON stay
// untouched) so this file is fully self-contained.
import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ownerPool, whoAmI, type Tx } from '../db/client.js';
import { record } from './customerFacts.js';
import { loadProfileReads, buildProfileLine } from './liamProfile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures', 'palate');

interface FixtureCoffee {
  name: string; archetype: string; is_slot: boolean;
  dims: Record<string, [number, number]>; descriptors: string[];
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
  lines: FixtureLine[]; questions: FixtureQuestion[]; recommendations: FixtureRecommendation[];
}
interface FixtureFile {
  coffees: Record<string, FixtureCoffee>;
  customers: Record<string, FixtureCustomer>;
  identity_links: Array<{ from: string; to: string; how: string; at: string }>;
}

const fixture: FixtureFile = JSON.parse(readFileSync(path.join(FIXTURES_DIR, 'timelines.json'), 'utf-8'));

const owner = ownerPool();
let tx: Tx;

const profileIdByCid: Record<string, string> = {};
const coffeeIdByKey: Record<string, number> = {};
const realSlotIdByArchetype: Record<string, number> = {};
const orderLineItemIdByFixtureId: Record<string, string> = {};
const dimensionIdByName: Record<string, number> = {};
const householdId = { value: '' };

// Same load as palateReads.test.ts, condensed (no cupping-note/descriptor
// dedup helper needed here beyond what shared traits require) — see that
// file for the fuller comments on each of these steps and the two real bugs
// (household-line dedup, coffee_slot_price) this mirrors the fix for.
async function loadFixtures(client: Tx): Promise<void> {
  // Household (the fiona/gary scenario) — needed for v_customer_bag_
  // attribution's ladder to fall through to the bag-claim tier for that
  // shared line; without household_id set, both would resolve to "buyer".
  const hh = await client.query<{ id: string }>(`INSERT INTO household (household_name) VALUES ('Vitest Household') RETURNING id`);
  householdId.value = hh.rows[0].id;

  for (const cid of Object.keys(fixture.customers)) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO user_profile (firebase_uid, household_id) VALUES ($1, $2) RETURNING id`,
      [`vitest-${cid}`, cid === 'fiona' || cid === 'gary' ? householdId.value : null]
    );
    profileIdByCid[cid] = r.rows[0].id;
  }

  const dims = await client.query<{ id: number; name: string }>(
    `SELECT id, name FROM coffee_dimensions WHERE name IN ('Acidity', 'Body', 'Sweetness')`
  );
  for (const row of dims.rows) dimensionIdByName[row.name] = row.id;

  const roaster = await client.query<{ id: string }>(`INSERT INTO roaster (name) VALUES ('Vitest Roaster') RETURNING id`);
  const roasterId = roaster.rows[0].id;

  for (const [key, c] of Object.entries(fixture.coffees)) {
    const coffeeResult = await client.query<{ id: number }>(
      `INSERT INTO coffees (name, roaster_id, is_active) VALUES ($1, $2, true) RETURNING id`,
      [c.name, roasterId]
    );
    coffeeIdByKey[key] = coffeeResult.rows[0].id;

    await client.query(
      `INSERT INTO coffee_archetype_assignment (coffee_id, archetype, confidence) VALUES ($1, $2, 'high')`,
      [coffeeIdByKey[key], c.archetype]
    );
    await client.query(
      `INSERT INTO coffee_sku (roaster_id, blend_name, coffee_id, is_active, weight_oz) VALUES ($1, $2, $3, true, 12)`,
      [roasterId, `${c.name} 12oz`, coffeeIdByKey[key]]
    );
  }

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
    return r.rows[0].id;
  }
  for (const [key, c] of Object.entries(fixture.coffees)) {
    const coffeeId = coffeeIdByKey[key];
    const sc = await client.query<{ id: number }>(
      `INSERT INTO cupping_session_coffees (session_id, coffee_id) VALUES ($1, $2) RETURNING id`,
      [sessionId, coffeeId]
    );
    const score = await client.query<{ id: number }>(
      `INSERT INTO cupping_scores (session_coffee_id, taster_name, is_merged) VALUES ($1, 'Vitest Merged', true) RETURNING id`,
      [sc.rows[0].id]
    );
    for (const [dimName, [min, max]] of Object.entries(c.dims)) {
      await client.query(
        `INSERT INTO cupping_score_values (cupping_score_id, dimension_id, value_min, value_max) VALUES ($1, $2, $3, $4)`,
        [score.rows[0].id, dimensionIdByName[dimName], min, max]
      );
    }
    for (const descriptor of c.descriptors) {
      await client.query(
        `INSERT INTO cupping_score_descriptors (cupping_score_id, cupping_note_id) VALUES ($1, $2)`,
        [score.rows[0].id, await noteIdFor(descriptor)]
      );
    }
  }

  const slotArchetypes = [...new Set(Object.values(fixture.coffees).filter(c => c.is_slot).map(c => c.archetype))];
  for (const archetype of slotArchetypes) {
    const slot = await client.query<{ id: number }>(
      `SELECT id FROM coffee_dial_slot WHERE archetype = $1 AND sort_order = 1`,
      [archetype]
    );
    if (!slot.rows.length) throw new Error(`No real coffee_dial_slot found for archetype=${archetype} sort_order=1`);
    realSlotIdByArchetype[archetype] = slot.rows[0].id;
    await client.query(`UPDATE coffee_slot_assignment SET is_active = false WHERE slot_id = $1`, [slot.rows[0].id]);
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

  for (const [cid, cust] of Object.entries(fixture.customers)) {
    if (!cust.quiz) continue;
    const archetypeRow = await client.query<{ id: string }>(`SELECT id FROM coffee_archetype WHERE code = $1`, [cust.quiz.archetype]);
    const secondaryLabel = cust.quiz.secondary
      ? (await client.query<{ name: string }>(`SELECT name FROM coffee_archetype WHERE code = $1`, [cust.quiz.secondary])).rows[0]?.name
      : null;
    await client.query(
      `INSERT INTO quiz_session (user_id, resulting_archetype_id, completed_at, context_data) VALUES ($1, $2, $3, $4)`,
      [profileIdByCid[cid], archetypeRow.rows[0].id, cust.quiz.at, JSON.stringify({ secondaryArchetype: secondaryLabel ?? null })]
    );
  }

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
    const skuResult = await client.query<{ id: string }>(`SELECT id FROM coffee_sku WHERE coffee_id = $1`, [coffeeIdByKey[line.coffee]]);
    const oli = await client.query<{ id: string }>(
      `INSERT INTO order_line_item (order_id, blend_id, order_kind) VALUES ($1, $2, $3) RETURNING id`,
      [orderResult.rows[0].id, skuResult.rows[0].id, line.order_kind]
    );
    orderLineItemIdByFixtureId[line.id] = oli.rows[0].id;
  }

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
  if (currentUser === 'ab_app') throw new Error('liamProfile.test.ts must run under the owner role, not ab_app');
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

// Checked-in expected strings — each independently hand-verified against the
// fixture's own raw data (quiz/lines/feedback in timelines.json) before being
// locked in here: the dimension ranges and descriptor overlaps in "Shared",
// the slot-candidate ordering (re-derived by hand from each coffee's real
// dims against v_palate_slot_candidates' own tiebreak: in_pair, then
// n_dims_overlapping desc, n_dims_disliked_overlap asc, n_dims_compared desc,
// then the real production coffee_dial_slot id for each archetype's own
// sort_order=1 slot — balanced_sweet=3, fruity=7, floral=11, earthy=15,
// experimental=19, chocolate_nutty=24), and the exact dates against each
// line's own order_at. Running this test against real production data first
// caught two real bugs in liamProfile.ts, both fixed there, not papered over
// here: shortDate() rendered a UTC-midnight timestamp as the previous
// calendar day on any negative-UTC-offset machine (missing `timeZone: 'UTC'`
// — Cloud Run itself runs UTC, so this was latent, not yet customer-visible,
// but still wrong); and an already-bought slot candidate with no feedback
// rendered the literal text "[had, null]" instead of "[had]".
describe('buildProfileLine (Liam L1, Part A) — one per C3 fixture customer', () => {
  const cases: Array<{ cid: string; label: string; expected: string }> = [
    {
      cid: 'maya', label: 'Maya (quiz only)',
      expected: [
        'ABOUT THIS CUSTOMER (facts; rebuilt every turn)',
        'Match: Balanced',
        'Bags: quiz only: no bags yet',
      ].join('\n'),
    },
    {
      cid: 'ben', label: 'Ben (one bag)',
      expected: [
        'ABOUT THIS CUSTOMER (facts; rebuilt every turn)',
        'Match: Balanced',
        'Bags: 1 attributed, 1 liked, 0 disliked. Shared: sweetness 10–12, acidity 3–5, body 8–10; brown_sugar or caramel on every bag',
        'Had before: Soft & Smooth (rated 5, Aug 6)',
        'Palate picks (from their bags, in order): Soft & Smooth [had, 5], Quieta Non Movere, Gentle Earth, Clean Fruit, Light Floral Edge',
      ].join('\n'),
    },
    {
      cid: 'carla', label: 'Carla (two bags, same archetype, both liked)',
      expected: [
        'ABOUT THIS CUSTOMER (facts; rebuilt every turn)',
        'Match: Balanced',
        'Bags: 2 attributed, 2 liked, 0 disliked. Shared: sweetness 11–12, acidity 3–4, body 9–10; caramel on every bag',
        'Had before: Soft & Smooth (rated 5, Aug 5); Vitest Coffee B (rated 4, Aug 21)',
        'Palate picks (from their bags, in order): Soft & Smooth [had, 5], Quieta Non Movere, Gentle Earth, Clean Fruit, Light Floral Edge',
      ].join('\n'),
    },
    {
      cid: 'derek', label: 'Derek (crossover archetype)',
      expected: [
        'ABOUT THIS CUSTOMER (facts; rebuilt every turn)',
        'Match: Balanced; second: Fruity',
        'Bags: 2 attributed, 2 liked, 0 disliked.',
        'Had before: Soft & Smooth (rated 5, Aug 4); Clean Fruit (rated 4, Aug 16)',
        'Palate picks (from their bags, in order): Soft & Smooth [had, 5], Clean Fruit [had, 4], Light Floral Edge, Gentle Earth, Quieta Non Movere',
      ].join('\n'),
    },
    {
      cid: 'elena', label: 'Elena (negative feedback)',
      expected: [
        'ABOUT THIS CUSTOMER (facts; rebuilt every turn)',
        'Match: Earthy',
        'Bags: 1 attributed, 0 liked, 1 disliked.',
        'Disliked: Gentle Earth (rated 2)',
        'Had before: Gentle Earth (rated 2, Aug 7)',
        'Palate picks (from their bags, in order): Light Floral Edge, Soft & Smooth, Clean Fruit, Quieta Non Movere',
      ].join('\n'),
    },
    {
      cid: 'fiona', label: 'Fiona (household buyer, quiz only)',
      expected: [
        'ABOUT THIS CUSTOMER (facts; rebuilt every turn)',
        'Match: Chocolate & Nutty',
        'Bags: quiz only: no bags yet',
      ].join('\n'),
    },
    {
      cid: 'gary', label: 'Gary (household member, claims the bag)',
      // No Match line at all — gary's own quiz is null in the fixture; the
      // household's quiz (Fiona's) is not his fact (rule 47).
      expected: [
        'ABOUT THIS CUSTOMER (facts; rebuilt every turn)',
        'Bags: 1 attributed, 1 liked, 0 disliked. Shared: sweetness 9–11, acidity 3–4, body 10–12; cocoa or hazelnut on every bag',
        'Had before: Quieta Non Movere (rated 5, Aug 6)',
        'Palate picks (from their bags, in order): Soft & Smooth, Quieta Non Movere [had, 5], Gentle Earth, Light Floral Edge, Clean Fruit',
      ].join('\n'),
    },
    {
      cid: 'harold', label: 'Harold (subscription renewal)',
      expected: [
        'ABOUT THIS CUSTOMER (facts; rebuilt every turn)',
        'Match: Chocolate & Nutty',
        'Bags: 1 attributed, 0 liked, 0 disliked. Shared: sweetness 9–11, acidity 3–4, body 10–12; cocoa or hazelnut on every bag',
        'Had before: Quieta Non Movere (Aug 31)',
        'Palate picks (from their bags, in order): Quieta Non Movere [had], Soft & Smooth, Gentle Earth, Light Floral Edge, Clean Fruit',
      ].join('\n'),
    },
    {
      cid: 'ivy', label: 'Ivy (followed recommendation)',
      expected: [
        'ABOUT THIS CUSTOMER (facts; rebuilt every turn)',
        'Match: Floral',
        'Bags: 1 attributed, 1 liked, 0 disliked. Shared: sweetness 7–9, acidity 9–11, body 4–6; honey or jasmine on every bag',
        'Had before: Light Floral Edge (rated 5, Aug 14)',
        'Palate picks (from their bags, in order): Light Floral Edge [had, 5], Clean Fruit, Quieta Non Movere, Soft & Smooth, Gentle Earth',
      ].join('\n'),
    },
    {
      cid: 'jade', label: 'Jade (answered thread question)',
      // Jade's real customer_liam_question/reply backfill rows exist in the
      // fixture, but the Open-thread line requires quizCurrent.exploreArchetype
      // (v_customer_quiz_current.explore_archetype), which the fixture's
      // quiz_session.context_data never sets for any of the ten customers —
      // only secondaryArchetype is. So the Open-thread line is untested by
      // this fixture for every customer, Jade included; disclosed, not
      // silently worked around (the fixture is explicitly out of scope to
      // edit for this brief).
      expected: [
        'ABOUT THIS CUSTOMER (facts; rebuilt every turn)',
        'Match: Experimental',
        'Bags: quiz only: no bags yet',
      ].join('\n'),
    },
    {
      cid: 'kira_real', label: 'Kira (guest quiz linked to her real account)',
      // kira_real's own quiz is null; her quiz shows up here only because
      // v_customer_identity resolves the guest->real identity link and
      // v_customer_quiz_current reads across every linked profile — proof
      // this line is read end to end through the canonical id, not just off
      // the raw uid's own profile.
      expected: [
        'ABOUT THIS CUSTOMER (facts; rebuilt every turn)',
        'Match: Fruity',
        'Bags: 1 attributed, 1 liked, 0 disliked. Shared: sweetness 6–8, acidity 11–13, body 3–5; berry or citrus on every bag',
        'Had before: Clean Fruit (rated 5, Aug 10)',
        'Palate picks (from their bags, in order): Clean Fruit [had, 5], Light Floral Edge, Gentle Earth, Soft & Smooth, Quieta Non Movere',
      ].join('\n'),
    },
  ];

  for (const { cid, label, expected } of cases) {
    it(`${cid} — ${label}`, async () => {
      const reads = await loadProfileReads(`vitest-${cid}`, tx);
      const line = buildProfileLine(reads);
      expect(line).toBe(expected);
    });
  }
});
