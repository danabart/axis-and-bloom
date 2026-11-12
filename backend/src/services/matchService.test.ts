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
import { MatchError, rankMoves, passesTagFilter, firstMatchCell } from './matchService.js';
import { setSurfaceModelInTx, setCustomerCopyInTx } from './dialPlacementService.js';
import { surfaces, surfaceIsMap, wedges as readWedges } from './dialReads.js';
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

const quizDecide = (c: pg.PoolClient, p: { userId: string; sessionId: string }) => match.decide({
  userId: p.userId, trigger: 'quiz_result', move: 'quiz_result', source: 'quiz', sourceId: p.sessionId, quizSessionId: p.sessionId,
}, c);

const placements = async (c: pg.PoolClient) => (await c.query(`SELECT * FROM v_dial_placement`)).rows;
const param = async (c: pg.PoolClient, key: string) =>
  Number((await c.query(`SELECT parameters ->> $1 AS v FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`, [key])).rows[0].v);

async function expectMatchError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof MatchError && e.code === code);
}

describe('decide: quiz result (D1)', () => {
  it('Balanced starts on the center founder pick; a repeat of the session writes one row', async () => {
    await withRollback(async ({ client: c }) => {
      const p = await person(c, { match: 'Balanced' });
      const fm = (await c.query(
        `SELECT fm.coffee_id FROM dial_first_match fm JOIN dial_lane l ON l.id = fm.lane_id JOIN dial_wedge w ON w.archetype_code = fm.archetype_code
          WHERE w.is_center AND l.code = 'side_a' AND fm.superseded_at IS NULL`)).rows[0].coffee_id;
      const a = await quizDecide(c, p);
      expect(a.created).toBe(true);
      expect(a.pickedCoffeeId).toBe(fm);
      const b = await quizDecide(c, p);
      expect(b.created).toBe(false);
      expect(b.decisionId).toBe(a.decisionId);
      const rows = (await c.query(`SELECT inputs FROM customer_match_decision WHERE source = 'quiz' AND source_id = $1`, [p.sessionId])).rows;
      expect(rows.length).toBe(1);
      expect(rows[0].inputs.rule).toBe('founder_pick');
      expect(rows[0].inputs.trigger).toBe('quiz_result');
    });
  });

  it('a delicate result (even Floral) asks for the Fruity wedge on its Floral side (Dana 2026-11-12, decision 2)', async () => {
    await withRollback(async ({ client: c }) => {
      const p = await person(c, { match: 'Floral', lean: 'delicate' });
      const ws = (await readWedges(c)).wedges;
      const fruity = ws.find((w: { archetype_code: string }) => w.archetype_code === 'fruity');
      const floralLane = fruity.side_a_archetype === 'floral' ? 'side_a' : 'side_b';
      expect(firstMatchCell({ matchArchetypeCode: 'floral', intensityLean: 'delicate' }, ws)).toEqual({ archetype: 'fruity', lane: floralLane });
      const d = await quizDecide(c, p);
      const inputs = (await c.query(`SELECT inputs FROM customer_match_decision WHERE id = $1`, [d.decisionId])).rows[0].inputs;
      expect(inputs.asked_cell).toEqual({ archetype: 'fruity', lane: floralLane });
      const picked = (await placements(c)).find(x => x.coffee_id === d.pickedCoffeeId);
      // a fruity coffee when the family has one at the floor, else the center's
      expect(['fruity', ws.find((w: { is_center: boolean }) => w.is_center).archetype_code]).toContain(picked.archetype_code);
    });
  });

  it('no dial_first_match row: the derivable fallback (lowest ring, most hops, asked lane, lowest id); an empty family falls to the center', async () => {
    await withRollback(async ({ client: c }) => {
      // the chocolate cell has no founder pick on L0
      await c.query(`UPDATE dial_first_match SET superseded_at = now() WHERE archetype_code = 'chocolate_nutty' AND superseded_at IS NULL`);
      const floor = await param(c, 'dial_min_grade_rank_first_match');
      const hops = new Map((await c.query(`SELECT from_coffee_id, count(*)::int n FROM v_dial_hop WHERE in_hop_set GROUP BY 1`)).rows.map(r => [r.from_coffee_id, r.n]));
      const eligible = (await placements(c)).filter(x => x.archetype_code === 'chocolate_nutty' && x.is_sellable && x.in_stock && x.grade_rank >= floor && x.category_codes.length === 0)
        .sort((a, b) => a.ring - b.ring || (hops.get(b.coffee_id) ?? 0) - (hops.get(a.coffee_id) ?? 0)
          || Number(b.lane_code === 'middle') - Number(a.lane_code === 'middle') || a.coffee_id - b.coffee_id);
      const p = await person(c, { match: 'Chocolate & Nutty' });
      const d = await quizDecide(c, p);
      const inputs = (await c.query(`SELECT inputs FROM customer_match_decision WHERE id = $1`, [d.decisionId])).rows[0].inputs;
      if (eligible.length) {
        expect(inputs.rule).toBe('derived');
        expect(d.pickedCoffeeId).toBe(eligible[0].coffee_id);
        const cands = (await c.query(`SELECT coffee_id, rank FROM customer_match_candidate WHERE decision_id = $1 ORDER BY rank`, [d.decisionId])).rows;
        expect(cands.map(x => x.coffee_id)).toEqual(eligible.map(x => x.coffee_id));
      } else {
        expect(String(inputs.rule).startsWith('center_')).toBe(true);
      }
      // Earthy: no sellable coffee at the floor on L0, so the center's first match
      const earthy = (await placements(c)).filter(x => x.archetype_code === 'earthy' && x.is_sellable && x.in_stock && x.grade_rank >= floor);
      const e = await quizDecide(c, await person(c, { match: 'Earthy' }));
      const ei = (await c.query(`SELECT inputs FROM customer_match_decision WHERE id = $1`, [e.decisionId])).rows[0].inputs;
      expect(String(ei.rule).startsWith('center_')).toBe(earthy.length === 0);
    });
  });
});

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
      await match.decide({ userId: d.userId, trigger: 'liam', move: 'liam', pickedCoffeeId: (await match.me(p.userId, c)).position!.coffeeId, source: 'liam', sourceId: randomUUID() }, c);
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
        await match.decide({ userId: p.userId, trigger: 'liam', move: 'liam', pickedCoffeeId: edgeCoffee, source: 'liam', sourceId: randomUUID() }, c);
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
  it('the latest decision is the position; a coffee outside the active version keeps the position with is_in_active_version false and a substitute', async () => {
    await withRollback(async ({ client: c }) => {
      const p = await person(c, { match: 'Balanced' });
      const first = await quizDecide(c, p);
      const m = await match.moves(p.userId, c);
      const open = m.moves.find(x => x.move !== 'stay' && !x.edge)!;
      const second = await match.decide({ userId: p.userId, trigger: 'hop', move: open.move, pickedCoffeeId: open.cards[0].coffeeId, source: 'map', sourceId: randomUUID() }, c);
      const me = await match.me(p.userId, c);
      expect(me.position!.coffeeId).toBe(second.pickedCoffeeId);
      expect(me.trail.map(t => t.coffeeId)).toEqual([first.pickedCoffeeId, second.pickedCoffeeId]);
      expect(me.trail[0].moveWord).toBe(me.copy.trail_start);
      expect(me.trail[1].moveWord).toBe(open.label);

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
      await match.decide({ userId: p.userId, trigger: 'liam', move: 'liam', pickedCoffeeId: other, source: 'liam', sourceId: randomUUID() }, c);
      const cur = (await c.query(`SELECT * FROM v_customer_match_current WHERE user_id = $1`, [p.userId])).rows[0];
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
