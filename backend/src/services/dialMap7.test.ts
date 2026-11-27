// Ella's Bloom Map 7 (2026-11-17), Part D: the start rule, the closed side,
// the steps the page reads and the trail.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_7_MATCH_RULE_AND_CUSTOMER_PAGE.md
//
// Every case runs inside withRollback and enters Data 1 itself (the seed
// script's applyStartRules) when the database has no start rule yet. Fixture
// people are marked "Zzz Map7". Coffees are named as Data 1 names them.
import 'dotenv/config';
import { describe, it, expect, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { db, type Tx } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import * as match from './matchService.js';
import { MatchError } from './matchService.js';
import { setStartRuleInTx, DialMapError } from './dialPlacementService.js';
import { setLeanInTx, CatalogError } from './catalogService.js';
import { applyStartRules, planStartRules, DATA_1 } from '../scripts/ellaMapStartRules_2026_11_17.js';

vi.setConfig({ testTimeout: 240_000 });
afterAll(async () => { await db.end(); });

const tx = (c: pg.PoolClient) => c as unknown as Tx;

async function ensureStartRules(c: pg.PoolClient) {
  const n = Number((await c.query(`SELECT count(*) AS n FROM v_dial_start_rule WHERE is_current`)).rows[0].n);
  if (n === 0) await applyStartRules(tx(c));
}

interface Fixture {
  primary: string;                 // coffee_archetype.name of the stored result
  scores: Record<string, number>;  // as stored in context_data.scores (display names)
  branchedFrom?: string | null;
  branchAnswerCode?: string | null; // the current answer row with this code
  completedAt?: string;            // default now
  match?: string | null;           // interpretation's match_archetype (name)
  espresso?: boolean;              // a usual drink with base method espresso
}

/** A marked test person with one quiz session as the fixture says. */
async function person(c: pg.PoolClient, f: Fixture): Promise<{ userId: string; sessionId: string }> {
  const userId = (await c.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Zzz Map7') RETURNING id`, [`zzz-map7-${randomUUID()}`])).rows[0].id;
  const arch = (await c.query<{ id: string }>(`SELECT id FROM coffee_archetype WHERE name = $1`, [f.primary])).rows[0].id;
  const branch = f.branchAnswerCode
    ? (await c.query<{ id: string }>(`SELECT id FROM quiz_answer WHERE answer_code = $1 AND is_current`, [f.branchAnswerCode])).rows[0].id
    : null;
  const sessionId = (await c.query<{ id: string }>(
    `INSERT INTO quiz_session (user_id, resulting_archetype_id, context_data, completed_at, branch_answer_id)
     VALUES ($1, $2, $3, COALESCE($4::timestamptz, timezone('utc', now())), $5) RETURNING id`,
    [userId, arch, JSON.stringify({ archetype: f.primary, scores: f.scores, branchedFrom: f.branchedFrom ?? null }), f.completedAt ?? null, branch])).rows[0].id;
  await c.query(
    `INSERT INTO quiz_session_interpretation (quiz_session_id, interpretation_version, recommendation_mode, food_signal_alignment, is_current, valid_from, computed_by, match_archetype)
     VALUES ($1, 'v2.2', 'primary_only', 'high', true, now(), 'scored', $2)`, [sessionId, f.match ?? f.primary]);
  if (f.espresso) {
    await c.query(
      `INSERT INTO customer_brew_profile_change (user_id, source, source_id, field, value, op) VALUES ($1, 'onsite', $2, 'usual_drink', '["latte"]', 'set')`,
      [userId, `zzz-map7-${randomUUID()}`]);
  }
  return { userId, sessionId };
}

const startOf = async (c: pg.PoolClient, sessionId: string) =>
  (await c.query(`SELECT family_read, rule_id, coffee_name, customer_reason, conditions FROM v_dial_start WHERE quiz_session_id = $1`, [sessionId])).rows[0];
const coffeeOf = (family: string, priority: number) => DATA_1.find(d => d.family === family && d.priority === priority)!.coffee;
const coffeeId = async (c: pg.PoolClient, name: string) =>
  (await c.query<{ coffee_id: number }>(`SELECT coffee_id FROM v_dial_placement WHERE coffee_name = $1`, [name])).rows[0].coffee_id;

const quizDecide = (c: pg.PoolClient, p: { userId: string; sessionId: string }) => match.decide({
  userId: p.userId, trigger: 'quiz_result', move: 'quiz_result', source: 'quiz', sourceId: p.sessionId, quizSessionId: p.sessionId,
}, c);

describe('the start rule (D)', () => {
  it('each row of Data 1 from a fixture session, with the three readings and the espresso row both ways', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureStartRules(c);
      const cases: Array<[string, Fixture, string, string]> = [
        ['Balanced, Fruity above Chocolate & Nutty', { primary: 'Balanced', scores: { 'Balanced & Sweet': 8, Fruity: 1 } }, 'balanced_sweet', coffeeOf('balanced_sweet', 1)],
        ['Balanced, otherwise', { primary: 'Balanced', scores: { 'Balanced & Sweet': 8, 'Chocolate & Nutty': 1 } }, 'balanced_sweet', coffeeOf('balanced_sweet', 9)],
        // decision 3: Floral from the Balanced branch is stored with primary Balanced
        ['Floral from the Balanced branch', { primary: 'Balanced', match: 'Floral', branchAnswerCode: 'v7_branch_bal_floral', scores: { Balanced: 9 } }, 'balanced_sweet', coffeeOf('balanced_sweet', 9)],
        ['C&N, Fruity above Balanced, espresso', { primary: 'Chocolate & Nutty', scores: { 'Chocolate & Nutty': 7, Fruity: 2 }, espresso: true }, 'chocolate_nutty', coffeeOf('chocolate_nutty', 2)],
        ['C&N, Fruity above Balanced, no espresso', { primary: 'Chocolate & Nutty', scores: { 'Chocolate & Nutty': 7, Fruity: 2 } }, 'chocolate_nutty', coffeeOf('chocolate_nutty', 3)],
        ['C&N, otherwise (espresso alone does not count)', { primary: 'Chocolate & Nutty', scores: { 'Chocolate & Nutty': 5, Balanced: 3, Fruity: 1 }, espresso: true }, 'chocolate_nutty', coffeeOf('chocolate_nutty', 9)],
        // decision 4: an old Earthy result reads as its highest raw score
        ['old Earthy, C&N highest, Fruity above Balanced', { primary: 'Earthy', branchedFrom: 'Chocolate & Nutty', completedAt: '2026-10-04T21:17:50Z', scores: { Balanced: 1, 'Chocolate & Nutty': 5, Fruity: 3 } }, 'chocolate_nutty', coffeeOf('chocolate_nutty', 3)],
        ['old Earthy, C&N highest', { primary: 'Earthy', branchedFrom: 'Chocolate & Nutty', completedAt: '2026-10-06T18:59:53Z', scores: { Balanced: 3, 'Chocolate & Nutty': 6 } }, 'chocolate_nutty', coffeeOf('chocolate_nutty', 9)],
        // Dana 2026-11-17, answer 3: a tie goes to the branched-from family, otherwise the center
        ['old Earthy, tie with the branched-from family', { primary: 'Earthy', branchedFrom: 'Chocolate & Nutty', completedAt: '2026-10-05T12:00:00Z', scores: { Balanced: 4, 'Chocolate & Nutty': 4, Fruity: 1 } }, 'chocolate_nutty', coffeeOf('chocolate_nutty', 9)],
        ['old Earthy, tie without it', { primary: 'Earthy', branchedFrom: 'Chocolate & Nutty', completedAt: '2026-10-05T12:00:00Z', scores: { Balanced: 4, 'Chocolate & Nutty': 1, Fruity: 4 } }, 'balanced_sweet', coffeeOf('balanced_sweet', 1)],
        ['new Earthy (dark, smoky)', { primary: 'Earthy', branchAnswerCode: 'v7_branch_cn_earthy', scores: { 'Chocolate & Nutty': 9 } }, 'earthy', coffeeOf('earthy', 9)],
        ['Fruity with some C&N', { primary: 'Fruity', scores: { Fruity: 7, 'Chocolate & Nutty': 2 } }, 'fruity', coffeeOf('fruity', 1)],
        ['Fruity all the way', { primary: 'Fruity', scores: { Fruity: 8, Balanced: 1 } }, 'fruity', coffeeOf('fruity', 9)],
        ['Floral', { primary: 'Floral', branchedFrom: 'Fruity', completedAt: '2026-09-01T12:00:00Z', scores: { Fruity: 9 } }, 'floral', coffeeOf('floral', 9)],
      ];
      for (const [label, f, family, coffee] of cases) {
        const p = await person(c, f);
        const s = await startOf(c, p.sessionId);
        expect([label, s.family_read, s.coffee_name], label).toEqual([label, family, coffee]);
        expect(s.conditions.espresso_at_home, label).toBe(!!f.espresso);
      }
      // the stored result is read, never changed (G2.19, G2.20)
      const p = await person(c, { primary: 'Earthy', branchedFrom: 'Chocolate & Nutty', completedAt: '2026-10-04T00:00:00Z', scores: { 'Chocolate & Nutty': 9 } });
      const before = (await c.query(`SELECT to_jsonb(q) AS q FROM quiz_session q WHERE id = $1`, [p.sessionId])).rows[0].q;
      await quizDecide(c, p);
      expect((await c.query(`SELECT to_jsonb(q) AS q FROM quiz_session q WHERE id = $1`, [p.sessionId])).rows[0].q).toEqual(before);
    });
  });

  it('the decision records the rule row and its facts; no rule row wins -> the center always row; a repeat writes one row', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureStartRules(c);
      const p = await person(c, { primary: 'Chocolate & Nutty', scores: { 'Chocolate & Nutty': 7, Fruity: 2 } });
      const d = await quizDecide(c, p);
      expect(d.pickedCoffeeName).toBe(coffeeOf('chocolate_nutty', 3));
      const inputs = (await c.query(`SELECT inputs FROM customer_match_decision WHERE id = $1`, [d.decisionId])).rows[0].inputs;
      expect(inputs.rule).toBe('start_rule');
      expect(inputs.family_read).toBe('chocolate_nutty');
      expect(inputs.scores).toEqual({ chocolate_nutty: 7, fruity: 2 });
      expect(inputs.conditions.fruity_gt_balanced).toBe(true);
      expect(typeof inputs.rule_id).toBe('number');
      expect((await quizDecide(c, p)).created).toBe(false);
      // a family with no row (Experimental): the fallback
      const x = await person(c, { primary: 'Experimental', scores: { Fruity: 5 } });
      expect((await startOf(c, x.sessionId)).rule_id).toBeNull();
      const e = await quizDecide(c, x);
      expect(e.pickedCoffeeName).toBe(coffeeOf('balanced_sweet', 9));
      expect((await c.query(`SELECT inputs FROM customer_match_decision WHERE id = $1`, [e.decisionId])).rows[0].inputs.rule).toBe('start_fallback');
      // no quiz at all: firstMatchFor falls back too
      const none = await match.firstMatchFor({ quizSessionId: null, matchArchetypeCode: null, matchArchetypeName: null, secondaryArchetypeCode: null, intensityLean: null, decaf: false, decafSource: 'none' }, c);
      expect(none?.coffeeName).toBe(coffeeOf('balanced_sweet', 9));
      // decaf as today (OT-126): no start coffee is decaf, so no first match
      const dec = await match.firstMatchFor({ quizSessionId: p.sessionId, matchArchetypeCode: null, matchArchetypeName: null, secondaryArchetypeCode: null, intensityLean: null, decaf: true, decafSource: 'quiz' }, c);
      expect(dec).toBeNull();
    });
  });

  it('setStartRule supersedes and inserts, a repeat is a no-op, an unplaced coffee is refused; the seed is idempotent', async () => {
    await withRollback(async ({ client: c, savepoint }) => {
      await ensureStartRules(c);
      expect((await planStartRules(tx(c))).rows.filter(r => r.action !== 'unchanged')).toEqual([]);
      const cur = (await c.query(`SELECT * FROM v_dial_start_rule WHERE is_current AND family_code = 'balanced_sweet' AND priority = 9`)).rows[0];
      const other = await coffeeId(c, coffeeOf('chocolate_nutty', 9));
      const input = { familyCode: 'balanced_sweet', priority: 9, conditionCode: 'always', coffeeId: other, adminLabel: 'Otherwise', customerReason: 'A new reason.', adminUid: 'vitest' };
      const r = await setStartRuleInTx(tx(c), input);
      expect(r.unchanged).toBe(false);
      expect(r.supersededId).toBe(cur.id);
      expect((await setStartRuleInTx(tx(c), input)).unchanged).toBe(true);
      const hist = (await c.query(`SELECT id, is_current, coffee_name, customer_reason FROM v_dial_start_rule WHERE family_code = 'balanced_sweet' AND priority = 9 ORDER BY created_at`)).rows;
      expect(hist.map(h => h.is_current)).toEqual([...hist.slice(0, -1).map(() => false), true]);
      expect(hist.at(-1)!.customer_reason).toBe('A new reason.');
      expect(hist.some(h => h.id === cur.id && !h.is_current)).toBe(true);
      // a coffee that is not on the published map
      const unplaced = (await c.query<{ id: number }>(`SELECT id FROM coffees c WHERE NOT EXISTS (SELECT 1 FROM v_dial_placement p WHERE p.coffee_id = c.id) ORDER BY id LIMIT 1`)).rows[0].id;
      await expect(savepoint(() => setStartRuleInTx(tx(c), { ...input, coffeeId: unplaced }))).rejects.toSatisfy((e: unknown) => e instanceof DialMapError && e.code === 'NOT_PLACED');
      await expect(savepoint(() => setStartRuleInTx(tx(c), { ...input, conditionCode: 'nope' }))).rejects.toThrow(/unknown start condition/);
    });
  });
});

describe('the closed side (D)', () => {
  it('Earthy toward Floral and Floral toward Earthy are closed: no lean there; the dead-end first matches are retired', async () => {
    await withRollback(async ({ client: c, savepoint }) => {
      const closed = (await c.query(`SELECT archetype_code::text AS a, lane_code AS l, toward_archetype::text AS t FROM v_dial_wedge_lane WHERE NOT is_open ORDER BY 1`)).rows;
      expect(closed).toEqual([{ a: 'earthy', l: 'side_b', t: 'floral' }, { a: 'floral', l: 'side_b', t: 'earthy' }]);
      for (const { a, l } of closed) {
        const coffee = (await c.query<{ coffee_id: number }>(`SELECT coffee_id FROM v_dial_placement_preview WHERE archetype_code::text = $1 LIMIT 1`, [a])).rows[0].coffee_id;
        await expect(savepoint(() => setLeanInTx(tx(c), coffee, l, { notes: 'vitest' })))
          .rejects.toSatisfy((e: unknown) => e instanceof CatalogError && e.code === 'CLOSED_SIDE');
      }
      // an open side still saves
      const earthy = (await c.query<{ coffee_id: number }>(`SELECT coffee_id FROM v_dial_placement_preview WHERE archetype_code::text = 'earthy' LIMIT 1`)).rows[0].coffee_id;
      await setLeanInTx(tx(c), earthy, 'side_a', { notes: 'vitest' });
      // A2: the seed retires the first-match picks on the closed sides, and they stay in the history
      await ensureStartRules(c);
      const fm = (await c.query(
        `SELECT fm.archetype_code::text AS a, l.code AS l, fm.superseded_at IS NULL AS current FROM dial_first_match fm JOIN dial_lane l ON l.id = fm.lane_id
          WHERE (fm.archetype_code::text, l.code) IN (('earthy', 'side_b'), ('floral', 'side_b'))`)).rows;
      expect(fm.length).toBeGreaterThan(0);
      expect(fm.every(x => !x.current)).toBe(true);
    });
  });
});

describe('the page reads (D)', () => {
  // Ella map 14 (2026-11-27): a step decision is still recorded through the door, and no longer moves the
  // spot; looking at the coffee (at) composes its steps; positive feedback on it moves the spot (the
  // spot's coffee is unrated); the trail is the spot's history.
  it('steps returns the published steps leaving the position and no calculated move; a step choice is recorded and moves nothing; the trail is the spot history', async () => {
    await withRollback(async ({ client: c, savepoint }) => {
      await ensureStartRules(c);
      const p = await person(c, { primary: 'Balanced', scores: { Balanced: 9 } });
      await quizDecide(c, p);
      const before = await match.steps(p.userId, c);
      expect(before.position?.name).toBe(coffeeOf('balanced_sweet', 9));
      expect(before.position?.hasBag).toBe(false);
      expect(before.firstBag?.reason).toBe(DATA_1.find(d => d.family === 'balanced_sweet' && d.priority === 9)!.customerReason);
      // Ella map 8: a step is named by the map's name (short name, else the coffee's name)
      const published = (await c.query(`SELECT a.map_name AS to_coffee_name, s.button_word FROM v_dial_step s JOIN v_dial_coffee_availability a ON a.coffee_id = s.to_coffee_id WHERE s.on_active_map AND s.from_coffee_id = $1`, [before.position!.coffeeId])).rows;
      expect(before.steps.map(s => s.name).sort()).toEqual(published.map(x => x.to_coffee_name).sort());
      expect(Object.keys(before)).toEqual(['position', 'firstBag', 'steps', 'copy', 'spot', 'lookingAt', 'startCoffeeId']); // Ella map 14: spot, lookingAt, startCoffeeId
      for (const s of before.steps) expect(Object.keys(s).sort()).toEqual(['coffeeId', 'familyLabel', 'isLead', 'line', 'name', 'notes', 'price', 'stepId', 'text', 'word']); // Ella map 8: familyLabel; Ella map 9: isLead, text
      // a coffee that is not a step is refused
      const notAStep = (await c.query<{ coffee_id: number }>(
        `SELECT coffee_id FROM v_dial_placement WHERE coffee_id <> ALL($1::int[]) AND coffee_id <> $2 AND category_codes = '{}' LIMIT 1`,
        [before.steps.map(s => s.coffeeId), before.position!.coffeeId])).rows[0].coffee_id;
      await expect(savepoint(() => match.decide({ userId: p.userId, trigger: 'hop', move: 'step', pickedCoffeeId: notAStep, source: 'map', sourceId: randomUUID() }, c)))
        .rejects.toSatisfy((e: unknown) => e instanceof MatchError && e.code === 'NOT_A_STEP');
      // choose the step with the word Bolder
      const bolder = before.steps.find(s => s.word === 'Bolder')!;
      const d = await match.decide({ userId: p.userId, trigger: 'hop', move: 'step', pickedCoffeeId: bolder.coffeeId, source: 'map', sourceId: randomUUID() }, c);
      expect(d.pickedCoffeeId).toBe(bolder.coffeeId);
      const after = await match.steps(p.userId, c);
      expect(after.position?.coffeeId).toBe(before.position!.coffeeId);
      expect(after.position?.hasBag).toBe(false);
      expect(after.firstBag?.labelCode).toBe(before.firstBag?.labelCode);
      // looking at it: its own steps, "Looking at"
      const look = await match.steps(p.userId, c, { at: bolder.coffeeId });
      expect(look.firstBag?.labelCode).toBe('looking_at_title');
      const next = (await c.query(`SELECT a.map_name AS to_coffee_name FROM v_dial_step s JOIN v_dial_coffee_availability a ON a.coffee_id = s.to_coffee_id WHERE s.on_active_map AND s.from_coffee_id = $1`, [bolder.coffeeId])).rows.map(x => x.to_coffee_name).sort();
      expect(look.steps.map(s => s.name).sort()).toEqual(next);
      // positive feedback on it moves the spot (the spot's coffee is unrated); the trail: the Founder's pick, then the customer's words
      await c.query(
        `INSERT INTO customer_feedback_event (user_id, occurred_at, recorded_at, source, source_id, coffee_id, rating, raw_text, channel)
         VALUES ($1, clock_timestamp(), clock_timestamp(), 'vitest', $2, $3, 4, 'Lovely with milk.', 'onsite')`,
        [p.userId, randomUUID(), bolder.coffeeId]);
      const me = await match.me(p.userId, c);
      expect(me.trail.map(t => [t.name, t.moveWord])).toEqual([[before.position!.name, "Founder's pick"], [bolder.name, 'You said']]);
      expect(me.trail[1].line).toBe('Lovely with milk.');
      expect(me.trail[1].moved).toBe(true);
      expect(me.position?.coffeeId).toBe(bolder.coffeeId);
      expect(me.firstBag).toBeNull();
      expect((await match.steps(p.userId, c)).firstBag?.labelCode).toBe('here_title');
    });
  });
});
