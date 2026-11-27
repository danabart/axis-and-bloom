// Ella's Bloom Map 3 (2026-11-12), Part D — the match door, moves, position
// and trail, the switch and the insert-only guard.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_3_MATCH_AND_CUSTOMER.md
//
// The test DB is a copy of production (refreshed 2026-11-12), so these run on
// version 1 (L0) as Dana cut it. Every write sits in a rolled-back
// transaction (withRollback): decisions are insert-only and could never be
// cleaned up. Expected coffees are read from the map's own views, never typed.
import 'dotenv/config';
import { describe, it, expect, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import * as match from './matchService.js';
import { MatchError, rankMoves, passesTagFilter } from './matchService.js';
import { applyStartRules } from '../scripts/ellaMapStartRules_2026_11_17.js';
import { setSurfaceModelInTx, setCustomerCopyInTx } from './dialPlacementService.js';
import { surfaces, surfaceIsMap } from './dialReads.js';
import { assertMayTurnDialFor, HouseholdError } from './householdService.js';

vi.setConfig({ testTimeout: 240_000 });
afterAll(async () => { await db.end(); });

interface QuizSpec { match: string; secondary?: string | null; lean?: 'delicate' | null; quizDecaf?: boolean }

/** A marked test person with one v2.2 quiz session; returns the profile and session ids. */
async function person(c: pg.PoolClient, q: QuizSpec, userId?: string): Promise<{ userId: string; sessionId: string }> {
  const uid = userId ?? (await c.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Zzz Map3') RETURNING id`, [`zzz-map3-${randomUUID()}`])).rows[0].id;
  const arch = (await c.query<{ id: string }>(`SELECT id FROM coffee_archetype WHERE name = $1`, [q.match])).rows[0].id;
  const sessionId = (await c.query<{ id: string }>(
    `INSERT INTO quiz_session (user_id, resulting_archetype_id, context_data) VALUES ($1, $2, $3) RETURNING id`,
    [uid, arch, JSON.stringify({ archetype: q.match, decaf: q.quizDecaf ?? false })])).rows[0].id;
  await c.query(
    `INSERT INTO quiz_session_interpretation (quiz_session_id, interpretation_version, recommendation_mode, food_signal_alignment, is_current, valid_from, computed_by, match_archetype, intensity_lean, secondary_archetype)
     VALUES ($1, 'v2.2', 'primary_only', 'high', true, now(), 'scored', $2, $3, $4)`,
    [sessionId, q.match, q.lean ?? null, q.secondary ?? null]);
  return { userId: uid, sessionId };
}

/** Ella map 7: the first bag comes from dial_start_rule; enter Data 1 inside the rollback when this database has none yet. */
async function ensureStartRules(c: pg.PoolClient) {
  const n = Number((await c.query(`SELECT count(*) AS n FROM v_dial_start_rule WHERE is_current`)).rows[0].n);
  if (n === 0) await applyStartRules(c as unknown as Parameters<typeof applyStartRules>[0]);
}

const quizDecide = async (c: pg.PoolClient, p: { userId: string; sessionId: string }) => {
  await ensureStartRules(c);
  return match.decide({
    userId: p.userId, trigger: 'quiz_result', move: 'quiz_result', source: 'quiz', sourceId: p.sessionId, quizSessionId: p.sessionId,
  }, c);
};

const placements = async (c: pg.PoolClient) => (await c.query(`SELECT * FROM v_dial_placement`)).rows;
const param = async (c: pg.PoolClient, key: string) =>
  Number((await c.query(`SELECT parameters ->> $1 AS v FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`, [key])).rows[0].v);

/**
 * Ella map 14: a decision (hop, Liam's pick) no longer moves the spot. These fixtures move it the
 * ways that do: positive feedback on a coffee while the spot's coffee is unrated, or a quiz-result
 * decision for a customer with no spot yet (a fixture row; the door needs a qualifying first match).
 */
async function likeIt(c: pg.PoolClient, userId: string, coffeeId: number) {
  await c.query(
    `INSERT INTO customer_feedback_event (user_id, occurred_at, recorded_at, source, source_id, coffee_id, rating, channel)
     VALUES ($1, clock_timestamp(), clock_timestamp(), 'vitest', $2, $3, 5, 'onsite')`, [userId, `zzz-map3-${randomUUID()}`, coffeeId]);
}
async function quizFixture(c: pg.PoolClient, userId: string, coffeeId: number) {
  await c.query(
    `INSERT INTO customer_match_decision (user_id, version_id, move_id, picked_coffee_id, source, source_id)
     SELECT $1, v.id, m.id, $2, 'quiz', $3 FROM dial_map_version v, dial_move m
      WHERE v.activated_at IS NOT NULL AND v.retired_at IS NULL AND m.code = 'quiz_result'`, [userId, coffeeId, `zzz-map3-${randomUUID()}`]);
}

async function expectMatchError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof MatchError && e.code === code);
}

// D1 (the first match by family and lean, Ella map 3) is retired with the code
// rule: the first bag is dial_start_rule since Ella map 7, tested in dialMap7.test.ts.

describe('decide: hops (D2)', () => {
  it('a coffee outside the move set is refused; stay re-picks the position; a beat tap takes the top-ranked coffee', async () => {
    await withRollback(async ({ client: c }) => {
      const p = await person(c, { match: 'Balanced' });
      const first = await quizDecide(c, p);
      const m = await match.moves(p.userId, c);
      const open = m.moves.find(x => x.move !== 'stay' && !x.edge)!;
      const outside = (await placements(c)).find(x => !open.cards.some(k => k.coffeeId === x.coffee_id) && x.coffee_id !== first.pickedCoffeeId)!;
      await expectMatchError(match.decide({ userId: p.userId, trigger: 'hop', move: open.move, pickedCoffeeId: outside.coffee_id, source: 'map', sourceId: randomUUID() }, c), 'NOT_IN_MOVE_SET');

      const stay = await match.decide({ userId: p.userId, trigger: 'hop', move: 'stay', source: 'map', sourceId: randomUUID() }, c);
      expect(stay.pickedCoffeeId).toBe(first.pickedCoffeeId);
      expect(stay.created).toBe(true);

      const beat = await match.decide({ userId: p.userId, trigger: 'hop', move: open.move, pickTopRanked: true, source: 'beat', sourceId: `zzz:${open.move}` }, c);
      expect(beat.pickedCoffeeId).toBe(open.cards[0].coffeeId);
      const go = (await c.query(`SELECT from_coffee_id, inputs FROM customer_match_decision WHERE id = $1`, [beat.decisionId])).rows[0];
      expect(go.from_coffee_id).toBe(first.pickedCoffeeId);
      expect(go.inputs.picked_by).toBe('top_ranked_at_click');
    });
  });

  it('forMemberId: refused without permission; with it the actor is recorded (G2.19, the dial is open)', async () => {
    const house = (await db.query(
      `SELECT a.user_id AS actor, b.member_id, b.user_id AS member_user
         FROM v_household_membership a JOIN v_household_membership b ON b.household_id = a.household_id AND b.member_id <> a.member_id
        WHERE a.may_turn_dials AND a.status_code = 'active' AND b.status_code = 'active' LIMIT 1`)).rows[0];
    const stranger = (await db.query(
      `SELECT up.id FROM user_profile up WHERE NOT EXISTS (SELECT 1 FROM v_household_membership m WHERE m.user_id = up.id) LIMIT 1`)).rows[0].id;
    if (house) {
      await expect(assertMayTurnDialFor(stranger, house.member_id)).rejects.toBeInstanceOf(HouseholdError);
      const ok = await assertMayTurnDialFor(house.actor, house.member_id);
      expect(ok.userId).toBe(house.member_user);
      await withRollback(async ({ client: c }) => {
        const p = await person(c, { match: 'Balanced' }, house.member_user);
        await ensureStartRules(c);
        const d = await match.decide({ userId: ok.userId, actorUserId: house.actor, trigger: 'quiz_result', move: 'quiz_result', source: 'quiz', sourceId: p.sessionId, quizSessionId: p.sessionId }, c);
        const row = (await c.query(`SELECT user_id, actor_user_id FROM customer_match_decision WHERE id = $1`, [d.decisionId])).rows[0];
        expect(row).toEqual({ user_id: house.member_user, actor_user_id: house.actor });
        const me = await match.me(house.member_user, c);
        expect(me.position?.byOther).toBe(true);
      });
    } else {
      await expect(assertMayTurnDialFor(stranger, randomUUID())).rejects.toBeInstanceOf(HouseholdError);
    }
  });
});

describe('moves (D3)', () => {
  type H = Parameters<typeof rankMoves>[0][number];
  const hop = (to: number, relation: string, o: Partial<H> = {}): H => ({
    from_coffee_id: 1, to_coffee_id: to, from_archetype: 'balanced_sweet', to_archetype: 'fruity', relation, rank: 1, distance: to,
    adjacency_rank: 1, to_in_stock: true, to_category_codes: [], from_coffee_name: 'A', to_coffee_name: `C${to}`, deltas: {}, ...o,
  });

  it('decaf sees decaf only, nobody else does; out of stock drops; the cap applies after the filters; the center ranks the quiz secondary first', () => {
    const rows = [
      hop(10, 'different', { to_category_codes: ['decaf'] }),
      hop(11, 'different', { to_in_stock: false }),
      hop(12, 'different', { to_archetype: 'floral' }),
      hop(13, 'different'), hop(14, 'different'), hop(15, 'different', { to_archetype: 'chocolate_nutty' }),
      hop(20, 'bolder', { to_category_codes: ['decaf'] }), hop(21, 'bolder'),
    ];
    const plain = rankMoves(rows, { decaf: false, isCenter: true, secondaryArchetypeCode: null, capDifferent: 3 });
    expect(plain.different.map(h => h.to_coffee_id)).toEqual([12, 13, 14]);
    expect(plain.bolder.map(h => h.to_coffee_id)).toEqual([21]);
    const decaf = rankMoves(rows, { decaf: true, isCenter: true, secondaryArchetypeCode: null, capDifferent: 3 });
    expect(decaf.different.map(h => h.to_coffee_id)).toEqual([10]);
    expect(decaf.bolder.map(h => h.to_coffee_id)).toEqual([20]);
    const second = rankMoves(rows, { decaf: false, isCenter: true, secondaryArchetypeCode: 'chocolate_nutty', capDifferent: 3 });
    expect(second.different.map(h => h.to_coffee_id)).toEqual([15, 12, 13]);
    expect(second.different.map(h => h.rank)).toEqual([1, 2, 3]);
    const notCenter = rankMoves(rows, { decaf: false, isCenter: false, secondaryArchetypeCode: 'chocolate_nutty', capDifferent: 3 });
    expect(notCenter.different[0].to_coffee_id).toBe(12);
    expect(passesTagFilter(['decaf'], false)).toBe(false);
    expect(passesTagFilter([], true)).toBe(false);
  });

  it('on L0: a decaf customer (quiz flag, no brew profile) meets only edges or decaf cards; an out-of-stock target disappears; an edge carries its phrase', async () => {
    await withRollback(async ({ client: c }) => {
      const d = await person(c, { match: 'Balanced', quizDecaf: true });
      await quizDecide(c, d).catch(() => undefined); // no decaf coffee may qualify as a first match
      const ctx = await match.customerContext(d.userId, null, c);
      expect(ctx.decaf).toBe(true);
      expect(ctx.decafSource).toBe('quiz');

      const p = await person(c, { match: 'Balanced' });
      await quizDecide(c, p);
      // decaf customer placed on the same position as p: every card is decaf-tagged or the move is at its edge
      // (Ella map 14: a fixture quiz-result row; Liam's pick no longer moves a spot)
      await quizFixture(c, d.userId, (await match.me(p.userId, c)).position!.coffeeId);
      const dm = await match.moves(d.userId, c);
      const tagOf = new Map((await placements(c)).map(x => [x.coffee_id, x.category_codes as string[]]));
      for (const m of dm.moves.filter(x => x.move !== 'stay')) {
        for (const card of m.cards) expect(tagOf.get(card.coffeeId)).toContain('decaf');
        if (m.cards.length === 0) expect(m.edge).toBe(true);
      }

      const before = await match.moves(p.userId, c);
      const diff = before.moves.find(x => x.move === 'different')!;
      expect(diff.cards.length).toBeGreaterThan(0);
      expect(diff.cards.length).toBeLessThanOrEqual(await param(c, 'dial_cap_different'));
      const gone = diff.cards[0].coffeeId;
      await c.query(`UPDATE coffee_sku SET is_active = false WHERE coffee_id = $1`, [gone]);
      const after = await match.moves(p.userId, c);
      expect(after.moves.find(x => x.move === 'different')!.cards.some(k => k.coffeeId === gone)).toBe(false);

      // an edge: a placed coffee with no bolder target (graph check's noBolder on L0)
      const edgeCoffee = (await c.query(
        `SELECT p.coffee_id FROM v_dial_placement p WHERE p.is_sellable AND p.in_stock AND NOT p.is_center AND p.category_codes = '{}'
            AND NOT EXISTS (SELECT 1 FROM v_dial_hop h WHERE h.from_coffee_id = p.coffee_id AND h.relation = 'bolder')
          ORDER BY p.coffee_id LIMIT 1`)).rows[0]?.coffee_id;
      if (edgeCoffee) {
        await likeIt(c, p.userId, edgeCoffee); // Ella map 14: positive feedback moves the (unrated) spot there
        const e = await match.moves(p.userId, c);
        const b = e.moves.find(x => x.move === 'bolder')!;
        expect(b.edge).toBe(true);
        expect(b.edgePhrase).toBeTruthy();
        expect(b.label).toBeTruthy();
      }
      // every move's label comes from dial_hop_phrase for the position's family
      expect(before.moves.map(x => x.move)).toEqual(['stay', 'bolder', 'gentler', 'different']);
      for (const m of before.moves) expect(m.label).toBeTruthy();
      for (const card of diff.cards) expect(card.moveLine).toMatch(new RegExp(`^${diff.label} than `));
    });
  });
});

describe('position and trail (D4)', () => {
  // Ella map 14 (2026-11-27): the spot is the fold over the customer's events, not the latest decision.
  it('a hop is recorded and moves nothing; positive feedback moves the spot; a coffee outside the active version keeps the spot with is_in_active_version false and a substitute', async () => {
    await withRollback(async ({ client: c }) => {
      const p = await person(c, { match: 'Balanced' });
      const first = await quizDecide(c, p);
      const m = await match.moves(p.userId, c);
      const open = m.moves.find(x => x.move !== 'stay' && !x.edge)!;
      const second = await match.decide({ userId: p.userId, trigger: 'hop', move: open.move, pickedCoffeeId: open.cards[0].coffeeId, source: 'map', sourceId: randomUUID() }, c);
      expect((await match.me(p.userId, c)).position!.coffeeId).toBe(first.pickedCoffeeId);
      await likeIt(c, p.userId, second.pickedCoffeeId);
      const me = await match.me(p.userId, c);
      expect(me.position!.coffeeId).toBe(second.pickedCoffeeId);
      expect(me.trail.map(t => t.coffeeId)).toEqual([first.pickedCoffeeId, second.pickedCoffeeId]);
      expect(me.trail.map(t => t.move)).toEqual(['founders_pick', 'feedback_positive']);
      expect(me.trail[1].moved).toBe(true);

      // a coffee placed only in an older (draft) version: copy a placed coffee's row onto an unplaced coffee
      const src = (await c.query(`SELECT p.* FROM dial_placement p JOIN v_dial_placement a ON a.placement_id = p.id WHERE NOT a.is_center AND a.is_sellable ORDER BY a.ring, a.coffee_id LIMIT 1`)).rows[0];
      const other = (await c.query(`SELECT id FROM coffees c WHERE NOT EXISTS (SELECT 1 FROM v_dial_placement p WHERE p.coffee_id = c.id) ORDER BY id LIMIT 1`)).rows[0].id;
      const draft = (await c.query(
        `INSERT INTO dial_map_version (label, status_id, reason, parameters, cut_by)
         SELECT 'zzz-map3-old', s.id, 'test', v.parameters, 'vitest' FROM dial_map_version v, dial_map_version_status s
          WHERE v.activated_at IS NOT NULL AND v.retired_at IS NULL AND s.code = 'draft' RETURNING id`)).rows[0].id;
      await c.query(
        `INSERT INTO dial_placement (version_id, coffee_id, archetype_code, is_center, ring, lane_id, size, ruler_dimension_id, ruler_value,
                                     acidity, bitterness, body, sweetness, grade_id, n_sessions, n_cuppers, is_sellable_at_cut, inputs_used, flags)
         SELECT $1, $2, archetype_code, is_center, ring, lane_id, size, ruler_dimension_id, ruler_value,
                acidity, bitterness, body, sweetness, grade_id, n_sessions, n_cuppers, is_sellable_at_cut, inputs_used, flags
           FROM dial_placement WHERE id = $3`, [draft, other, src.id]);
      // Ella map 14: the spot moves there by positive feedback (equal ratings move, F1); its decision columns are then NULL
      await likeIt(c, p.userId, other);
      const cur = (await c.query(`SELECT m.* FROM v_customer_match_current m JOIN v_customer_identity v ON v.canonical_user_id = m.canonical_user_id WHERE v.user_id = $1`, [p.userId])).rows[0];
      expect(cur.decision_id).toBeNull();
      expect(cur.spot_event_code).toBe('feedback_positive');
      expect(cur.coffee_id).toBe(other);
      expect(cur.is_in_active_version).toBe(false);
      expect(cur.placement_version_id).toBe(draft);
      expect(cur.archetype_code).toBe(src.archetype_code);
      const after = await match.me(p.userId, c);
      expect(after.position!.available).toBe(false);
      const mv = await match.moves(p.userId, c);
      expect(mv.position!.substitute).not.toBeNull();
      expect(mv.position!.sentence).toContain(mv.position!.substitute!.name);
      expect(after.trail.at(-1)!.onActiveMap).toBe(false); // not placed on the active version
    });
  });
});

describe('surfaces and the quiz door (D5)', () => {
  it('every surface is lane by seed; setSurfaceModel flips one row; the door writes whatever quiz_result says', async () => {
    const rows = await surfaces();
    expect(rows.map((r: { code: string }) => r.code).sort()).toEqual(
      ['axis_stats', 'customer_face', 'liam_context', 'profile_trail', 'qr_door', 'quiz_result', 'reorder_email']);
    expect(rows.every((r: { model_code: string }) => r.model_code === 'lane')).toBe(true);
    await withRollback(async ({ client: c }) => {
      expect(await surfaceIsMap('quiz_result', c)).toBe(false);
      const d = await quizDecide(c, await person(c, { match: 'Balanced' }));
      expect(d.created).toBe(true);
      const flip = await setSurfaceModelInTx(c, 'quiz_result', 'map', 'vitest');
      expect(flip.unchanged).toBe(false);
      expect(await surfaceIsMap('quiz_result', c)).toBe(true);
      expect(await surfaceIsMap('profile_trail', c)).toBe(false);
      expect((await setSurfaceModelInTx(c, 'quiz_result', 'map', 'vitest')).unchanged).toBe(true);
      // customer copy supersedes
      const a = await setCustomerCopyInTx(c, { code: 'start_here', text: 'Zzz {coffee}', adminUid: 'vitest' });
      expect(a.unchanged).toBe(false);
      expect((await c.query(`SELECT count(*)::int n FROM dial_customer_copy WHERE code = 'start_here' AND superseded_at IS NULL`)).rows[0].n).toBe(1);
    });
  });
});

describe('insert-only (D6)', () => {
  it('UPDATE and DELETE on a decision or a candidate raise', async () => {
    await withRollback(async ({ client: c, savepoint }) => {
      const p = await person(c, { match: 'Chocolate & Nutty' });
      const d = await quizDecide(c, p);
      await expect(savepoint(() => c.query(`UPDATE customer_match_decision SET inputs = '{}' WHERE id = $1`, [d.decisionId]))).rejects.toThrow(/insert-only/);
      await expect(savepoint(() => c.query(`DELETE FROM customer_match_decision WHERE id = $1`, [d.decisionId]))).rejects.toThrow(/insert-only/);
      await expect(savepoint(() => c.query(`DELETE FROM customer_match_candidate WHERE decision_id = $1`, [d.decisionId]))).rejects.toThrow(/insert-only/);
    });
  });
});
