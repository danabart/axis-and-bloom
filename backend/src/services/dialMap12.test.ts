// Ella's Bloom Map 12 (2026-11-26), Part D: every step card compares to the
// coffee the customer is on ({from}), and the treat answer is a step support
// of its own: step cards only, the last kind (after the reuse pass), only when
// its family is the destination's, never when switched off; the top card and
// the lead never read it. Test DB only, every test inside a rolled-back
// transaction; marked 'Zzz Map12' fixtures. The five pinned pages are in
// dialMap10.test.ts (updated for Ella map 12). The reveal on /map is tested in
// frontend/src/app/components/bloom/map/mapMoreAbout.test.tsx.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_12_STEP_COMPARISONS_AND_REVEAL.md
import { describe, it, expect, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { db, type Tx } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import * as match from './matchService.js';
import { setReasonChoiceInTx, setStepInTx } from './dialPlacementService.js';
import { setParameterInTx } from './evidenceParameterService.js';
import { dialMapChecks } from './dataCatalogIntegrity.js';
import { applyRev2 } from '../scripts/ellaMapReasonsRev2_2026_11_23.js';
import { applyReasons } from '../scripts/ellaMapReasons_2026_11_20.js';
import { applyComparisons, planComparisons, DATA_1, DATA_2, LABEL_TAIL } from '../scripts/ellaMapStepComparisons_2026_11_25.js';

vi.setConfig({ testTimeout: 240_000 });
afterAll(async () => { await db.end(); });

const tx = (c: pg.PoolClient) => c as unknown as Tx;
const TREATS = DATA_2.map(d => d.fact);

async function ensureAll(c: pg.PoolClient) {
  const n = Number((await c.query(`SELECT count(*) AS n FROM v_dial_said_back WHERE is_current`)).rows[0].n);
  if (n === 0) await applyReasons(tx(c), { publishLabel: `zzz map12 test ${randomUUID()}` });
  await applyRev2(tx(c));
  return applyComparisons(tx(c));
}

async function newProfile(c: pg.PoolClient) {
  return (await c.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Zzz Map12') RETURNING id`, [`zzz-map12-${randomUUID()}`])).rows[0].id;
}
const answerId = async (c: pg.PoolClient, code: string) =>
  (await c.query<{ id: string }>(`SELECT id FROM quiz_answer WHERE answer_code = $1 AND is_current`, [code])).rows[0].id;

/** Dana's account as dialMap10 builds it (all Chocolate & Nutty answers, first match on Tiger Stripe with no rule), with the treat answer and feeling given. */
async function danaLike(c: pg.PoolClient, opts: { treat?: string; feeling?: string | null; proxy?: boolean } = {}) {
  const userId = await newProfile(c);
  const arch = (await c.query<{ id: string }>(`SELECT id FROM coffee_archetype WHERE name = 'Chocolate & Nutty'`)).rows[0].id;
  const ids = [] as string[];
  for (const a of ['v7_q1_a', 'v7_q2_a', 'v7_q3_a', 'v7_q4_a', 'v7_q5_a', opts.treat ?? 'v7_q6_c']) ids.push(await answerId(c, a));
  const takenBy = opts.proxy ? await newProfile(c) : null;
  const sessionId = (await c.query<{ id: string }>(
    `INSERT INTO quiz_session (user_id, resulting_archetype_id, context_data, completed_at, branch_answer_id, taken_by_user_id)
     VALUES ($1, $2, $3, timezone('utc', now()), $4, $5) RETURNING id`,
    [userId, arch, JSON.stringify({ archetype: 'Chocolate & Nutty', scores: { 'Chocolate & Nutty': 9 }, branchedFrom: null, answerIds: ids }),
     await answerId(c, 'v7_branch_cn_stay'), takenBy])).rows[0].id;
  await c.query(
    `INSERT INTO quiz_session_interpretation (quiz_session_id, interpretation_version, recommendation_mode, food_signal_alignment, is_current, valid_from, computed_by, match_archetype)
     VALUES ($1, 'v2.2', 'primary_only', 'high', true, now(), 'scored', 'Chocolate & Nutty')`, [sessionId]);
  const feeling = opts.feeling === undefined ? 'happy' : opts.feeling;
  if (feeling) {
    await c.query(`INSERT INTO customer_brew_profile_change (user_id, source, source_id, field, value, op) VALUES ($1, 'onsite', $2, 'coffee_feeling', $3, 'set')`,
      [userId, `zzz-map12-${randomUUID()}`, JSON.stringify(feeling)]);
  }
  const tiger = (await c.query<{ coffee_id: number }>(`SELECT p.coffee_id FROM v_dial_placement p JOIN v_dial_coffee_availability a ON a.coffee_id = p.coffee_id WHERE a.map_name = 'Tiger Stripe'`)).rows[0].coffee_id;
  const version = (await c.query<{ id: number }>(`SELECT id FROM dial_map_version WHERE activated_at IS NOT NULL AND retired_at IS NULL`)).rows[0].id;
  await c.query(
    `INSERT INTO customer_match_decision (user_id, occurred_at, version_id, move_id, picked_coffee_id, source, source_id, inputs)
     SELECT $1, timezone('utc', now()) - interval '1 hour', $2, m.id, $3, 'quiz', $4, $5 FROM dial_move m WHERE m.code = 'quiz_result'`,
    [userId, version, tiger, sessionId, JSON.stringify({ rule: 'derived', quiz: { session_id: sessionId } })]);
  return { userId, sessionId };
}
const page = (c: pg.PoolClient, userId: string) => match.steps(userId, c, { withBasis: true });
const choice = (c: pg.PoolClient, code: string, patch: { sortOrder?: number; isActive?: boolean }) =>
  setReasonChoiceInTx(tx(c), { kindCode: 'step_support', code, ...patch, adminUid: 'zzz-map12' });
const said = async (c: pg.PoolClient, fact: string) =>
  (await c.query<{ says_back: string }>(`SELECT says_back FROM v_dial_said_back WHERE is_current AND source_code = 'quiz_answer' AND fact_code = $1`, [fact])).rows[0].says_back;
const treatOn = (r: match.MapStepsResult) => ({
  top: r.firstBag?.basis?.factCodes.filter(f => TREATS.includes(f)) ?? [],
  lead: r.steps.filter(s => s.isLead).flatMap(s => s.basis!.factCodes).filter(f => TREATS.includes(f)),
  steps: r.steps.filter(s => s.basis!.choice === 'treat').map(s => s.name),
});

describe('step lines compare to the coffee the customer is on ({from})', () => {
  it('every step line is filled with the position\'s map name, on every published step leaving every coffee', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureAll(c);
      const p = await danaLike(c);
      const froms = [...new Set(DATA_1.map(d => d.from))];
      const tos = new Map((await c.query<{ coffee_id: number; map_name: string }>(
        `SELECT p.coffee_id, a.map_name FROM v_dial_placement p JOIN v_dial_coffee_availability a ON a.coffee_id = p.coffee_id`)).rows.map(r => [r.map_name, r.coffee_id]));
      let seen = 0;
      for (const from of froms) {
        // Ella map 14: look at `from` (?at=); nothing is written, and a step decision no longer moves
        // the spot. A coffee this customer may not be shown (the decaf tag filter) is refused for at.
        const r = await match.steps(p.userId, c, { withBasis: true, at: tos.get(from)! }).catch((e: unknown) => {
          if (e instanceof match.MatchError && e.code === 'NOT_ON_MAP') return null;
          throw e;
        });
        if (!r) continue;
        expect(r.position!.name).toBe(from);
        for (const s of r.steps) {
          seen++;
          expect(s.line).not.toContain('{');
          expect(s.text).not.toContain('{');
          expect(s.line).toContain(from);
          // every card's text names it too: the lead after a step is never a start rule's lead line
          expect(s.text).toContain(from);
        }
      }
      expect(seen).toBeGreaterThanOrEqual(30); // decaf steps are filtered by the tag filter for some customers
    });
  }, 900_000); // Ella map 14: one page read per map coffee over the proxy; each read now also folds the spot

  it('the seed writes only the line; a second run writes nothing and publishes nothing; the placements do not move', async () => {
    await withRollback(async ({ client: c }) => {
      const shape = `SELECT coffee_id, archetype_code::text, ring, lane_code, size FROM v_dial_placement ORDER BY coffee_id`;
      const n = Number((await c.query(`SELECT count(*) AS n FROM v_dial_said_back WHERE is_current`)).rows[0].n);
      if (n === 0) await applyReasons(tx(c), { publishLabel: `zzz map12 test ${randomUUID()}` });
      await applyRev2(tx(c));
      const cols = `SELECT from_coffee_id, to_coffee_id, button_word, basis_code, is_shown, move_code, when_line FROM v_dial_step WHERE is_current AND is_shown ORDER BY from_coffee_id, to_coffee_id`;
      const [stepsBefore, placementsBefore] = [JSON.stringify((await c.query(cols)).rows), JSON.stringify((await c.query(shape)).rows)];
      const first = await applyComparisons(tx(c));
      if (first.published) expect(first.published.label).toMatch(new RegExp(`^L\\d+ ${LABEL_TAIL.replace(/[()]/g, '\\$&')}$`));
      expect(JSON.stringify((await c.query(cols)).rows)).toBe(stepsBefore);
      expect(JSON.stringify((await c.query(shape)).rows)).toBe(placementsBefore);
      const lines = new Map((await c.query<{ k: string; customer_line: string }>(
        `SELECT fa.map_name || ' -> ' || ta.map_name AS k, s.customer_line FROM v_dial_step s
           JOIN v_dial_coffee_availability fa ON fa.coffee_id = s.from_coffee_id JOIN v_dial_coffee_availability ta ON ta.coffee_id = s.to_coffee_id
          WHERE s.on_active_map`)).rows.map(r => [r.k, r.customer_line]));
      for (const d of DATA_1) expect(lines.get(`${d.from} -> ${d.to}`)).toBe(d.line);
      const again = await applyComparisons(tx(c));
      expect(again.written).toBe(0);
      expect(again.published).toBeNull();
      expect((await planComparisons(tx(c))).rows.filter(r => r.action === 'write')).toEqual([]);
    });
  });
});

describe('the treat: step cards only, last, its family, switchable', () => {
  it('used where nothing else supports a step and its family matches; never on the top card or the lead', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureAll(c);
      const p = await danaLike(c);
      const r = await page(c, p.userId);
      expect(treatOn(r)).toEqual({ top: [], lead: [], steps: ['Geometric'] });
      const g = r.steps.find(s => s.name === 'Geometric')!;
      expect(g.basis!.factCodes).toEqual(['v7_q6_c']);
      expect(g.text.startsWith(await said(c, 'v7_q6_c'))).toBe(true);
      // a step another kind supports never takes the treat, even with the treat row first
      await choice(c, 'treat', { sortOrder: 0 });
      expect(treatOn(await page(c, p.userId))).toEqual({ top: [], lead: [], steps: ['Geometric'] });
    });
  });

  it('only when its family is the destination\'s: a treat for another family gives no_support', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureAll(c);
      const noSupport = (await c.query<{ text: string }>(`SELECT text FROM v_dial_customer_copy WHERE code = 'no_support'`)).rows[0].text;
      const p = await danaLike(c, { treat: 'v7_q6_a' }); // the treat for Chocolate & Nutty; Geometric is Fruity
      const r = await page(c, p.userId);
      expect(treatOn(r).steps).toEqual([]);
      expect(r.steps.find(s => s.name === 'Geometric')!.text.startsWith(noSupport)).toBe(true);
    });
  });

  it('after the reuse pass: an answer already used on the page comes first; with reuse off, the treat', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureAll(c);
      // "different" argues for Geometric's direction: with reuse on, the feeling (used by the lead) supports it again
      const p = await danaLike(c, { feeling: 'different' });
      const r = await page(c, p.userId);
      expect(treatOn(r).steps).toEqual([]);
      await setParameterInTx(tx(c), { key: 'dial_step_reuse_answer', value: 0, adminId: 'zzz-map12' });
      const off = await page(c, p.userId);
      const g = off.steps.find(s => s.name === 'Geometric')!;
      // the lead (The Waverly) takes the feeling; Geometric has no unused answer: the treat
      expect(off.steps.find(s => s.isLead)!.name).toBe('The Waverly');
      expect(r.steps.find(s => s.name === 'Geometric')!.basis!.factCodes).toEqual(['different']); // with reuse on, the feeling again
      expect(g.basis!.choice).toBe('treat');
    });
  });

  it('switched off on /admin/map, gone on the next read; every other kind off leaves no lead, and the treat still only on steps', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureAll(c);
      const p = await danaLike(c);
      await choice(c, 'treat', { isActive: false });
      expect(treatOn(await page(c, p.userId)).steps).toEqual([]);
      await choice(c, 'treat', { isActive: true });
      for (const code of ['family_and_direction', 'family', 'direction']) await choice(c, code, { isActive: false });
      const r = await page(c, p.userId);
      // strongest_support finds nothing (it never reads the treat): no lead
      expect(r.steps.some(s => s.isLead)).toBe(false);
      expect(treatOn(r)).toEqual({ top: [], lead: [], steps: ['Geometric'] });
    });
  });

  it('a quiz taken by someone else gives no treat (G2.19); check 15 knows the code', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureAll(c);
      const p = await danaLike(c, { proxy: true });
      const r = await page(c, p.userId);
      expect([...(r.firstBag?.basis?.factCodes ?? []), ...r.steps.flatMap(s => s.basis!.factCodes)].filter(f => f.startsWith('v7_'))).toEqual([]);
      expect((await dialMapChecks(c)).find(k => k.id === 15)!.pass).toBe(true);
    });
  });

  it('a step line with no {from} reads as written (the admin may write one)', async () => {
    await withRollback(async ({ client: c }) => {
      await ensureAll(c);
      const p = await danaLike(c);
      const r = await page(c, p.userId);
      const g = r.steps.find(s => s.name === 'Geometric')!;
      const row = (await c.query<{ from_coffee_id: number; basis_code: string }>(`SELECT from_coffee_id, basis_code FROM v_dial_step WHERE id = $1`, [g.stepId])).rows[0];
      await setStepInTx(tx(c), { fromCoffeeId: row.from_coffee_id, toCoffeeId: g.coffeeId, buttonWord: g.word, customerLine: 'Zzz plain line.', basisCode: row.basis_code, adminUid: 'zzz-map12' });
      // an unpublished line does not reach the page (brief 9: through Publish)
      expect((await page(c, p.userId)).steps.find(s => s.name === 'Geometric')!.line).toBe(g.line);
    });
  });
});
