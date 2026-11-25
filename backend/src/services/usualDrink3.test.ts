// Usual Drink 3 (2026-11-25), Part E — black with milk (D2), up to three
// coffees in the kitchen and which one they drink most (D4): the one rule set
// (B1), the Profile save (B2), Liam (B3), v_customer_cupboard_coffee (A6),
// the cupboard_coffee conversion (Part C, Dana's conversion rule of
// 2026-11-25) and check 31 (black alone).
// backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_3_ROUTINE_FIXES.md
//
// Test DB only. Every write sits in a rolled-back transaction (withRollback):
// fact rows are insert-only. Field and value codes are the brief's own.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';

vi.mock('./brewProfile.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./brewProfile.js')>();
  return { ...actual, incrementBrewProfileCounter: vi.fn(async () => undefined) };
});

const { db } = await import('../db/client.js');
const { withRollback } = await import('../test/withRollback.js');
const brew = await import('./brewProfile.js');
const { saveRoutine, recordPostResultCard, brewProfileOptions, RoutineSaveError } = await import('./brewProfileCard.js');
const { record, BrewProfileChangeRejected } = await import('./customerFacts.js');
const reads = await import('./customerReads.js');
const { resolveRemember } = await import('../routes/sommelier.js');
const { planTakesIt, applyTakesIt } = await import('../scripts/usualDrink2TakesIt_2026_11_24.js');
const integrity = await import('./customerIntegrity.js');

vi.setConfig({ testTimeout: 120_000 });
beforeAll(async () => { await brew.loadBrewProfileFields(); });
afterAll(async () => { await brew.loadBrewProfileFields(); await db.end(); });

type C = pg.PoolClient;
const KITCHEN = { field: 'cupboard_coffee', tag: 'ud3' };

async function customer(c: C, opts: { quiz?: boolean } = {}) {
  const uid = `zzz-ud3-${randomUUID()}`;
  const userId = (await c.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Zzz UD3') RETURNING id`, [uid])).rows[0].id;
  let sessionId: string | null = null;
  if (opts.quiz) sessionId = (await c.query<{ id: string }>(`INSERT INTO quiz_session (user_id, completed_at) VALUES ($1, now()) RETURNING id`, [userId])).rows[0].id;
  return { uid, userId, sessionId: sessionId! };
}
const rows = async (c: C, userId: string, field?: string) => (await c.query(
  `SELECT id::text, field, op, value, source, source_id, customer_words, occurred_at::text AS occurred_at FROM customer_brew_profile_change
   WHERE user_id = $1 AND ($2::text IS NULL OR field = $2) ORDER BY occurred_at, field`, [userId, field ?? null])).rows;
const current = async (c: C, uid: string) => reads.getBrewProfileCurrent(uid, c);
const cfg = (code: string) => brew.getBrewProfileFieldsConfig()[code];
const ev = () => `ev-${randomUUID()}`;
const save = (c: C, uid: string, answers: Array<{ field: string; value: unknown; words?: string }>, cleared: string[] = []) =>
  saveRoutine({ uid, answers, cleared }, ev(), c);
const liamSession = async (c: C, uid: string) =>
  (await c.query<{ id: number }>(`INSERT INTO sommelier_sessions (uid, intent) VALUES ($1, 'MATCHED') RETURNING id`, [uid])).rows[0].id;
/** a row as written before this brief (single value), at a given time */
const oldRow = (c: C, userId: string, field: string, op: string, value: unknown, occurredAt: string, customerWords?: string) =>
  record.brewProfileChange.backfill({
    userId, source: 'onsite', sourceId: `t-${randomUUID()}`, field, op,
    value: value === null ? null : JSON.stringify(value), customerWords, occurredAt,
  }, c);
const kitchenRow = async (c: C, userId: string) => (await c.query(
  `SELECT k.code, k.customer_words FROM v_customer_cupboard_coffee k JOIN v_customer_identity vi ON vi.canonical_user_id = k.canonical_user_id
   WHERE vi.user_id = $1`, [userId])).rows;

describe('rows (Part A)', () => {
  it('black goes with milk; the kitchen takes three; drink most follows the kitchen; the grinder stays one answer', async () => {
    expect(cfg('takes_it').values.find(v => v.code === 'black')).toMatchObject({ label: 'Black', exclusive: false });
    expect(cfg('cupboard_coffee')).toMatchObject({ type: 'array', maxLength: 3 });
    expect(cfg('cupboard_coffee').values.filter(v => v.exclusive).map(v => v.code).sort()).toEqual(['dont_know', 'nothing', 'pods_unknown']);
    expect(cfg('main_cupboard')).toMatchObject({ type: 'enum', valuesFrom: 'cupboard_coffee' });
    expect(cfg('grinder').type).toBe('enum');
    const by = Object.fromEntries((await brewProfileOptions('mirror')).fields.map(f => [f.code, f]));
    expect(by.grinder.prompt).toBe('What do you grind with most?');
    expect(by.main_cupboard.values.map(v => v.code)).toEqual(by.cupboard_coffee.values.map(v => v.code));
    expect((await brewProfileOptions('mirror')).copy.typeahead_remove).toBe('Remove {name}');
  });
});

describe('the one rule set (B1, B2)', () => {
  it('["black","milk"] saves on takes_it', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await save(c, g.uid, [{ field: 'takes_it', value: ['black', 'milk'] }]);
      expect((await current(c, g.uid)).takes_it?.value).toEqual(['black', 'milk']);
    });
  });
  it('the kitchen: three listed save, four are refused, a stand-alone answer with another is refused', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await save(c, g.uid, [{ field: 'cupboard_coffee', value: ['starbucks', 'wawa', 'lavazza'] }]);
      expect((await current(c, g.uid)).cupboard_coffee?.value).toEqual(['starbucks', 'wawa', 'lavazza']);
      await expect(save(c, g.uid, [{ field: 'cupboard_coffee', value: ['starbucks', 'wawa', 'lavazza', 'illy'] }])).rejects.toBeInstanceOf(RoutineSaveError);
      await expect(save(c, g.uid, [{ field: 'cupboard_coffee', value: ['nothing', 'wawa'] }])).rejects.toBeInstanceOf(RoutineSaveError);
      // the door refuses it too, whoever writes
      await expect(record.brewProfileChange({ userId: g.userId, source: 'onsite', sourceId: `t-${randomUUID()}`, field: 'cupboard_coffee', op: 'set', value: JSON.stringify(['pods_unknown', 'wawa']) }, c))
        .rejects.toBeInstanceOf(BrewProfileChangeRejected);
    });
  });
  it('one typed name with listed coffees saves and reads back by the customer\'s words', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await save(c, g.uid, [{ field: 'cupboard_coffee', value: ['starbucks', 'other'], words: 'Zzz Corner Roasters' }]);
      expect((await current(c, g.uid)).cupboard_coffee).toMatchObject({ value: ['starbucks', 'other'], words: 'Zzz Corner Roasters' });
    });
  });
  it('a list holds at most one answer in the customer\'s own words (checkOneWordsValue)', () => {
    const base = cfg('cupboard_coffee');
    const two = { ...base, values: [...base.values, { ...base.values.find(v => v.acceptsWords)!, code: 'zzz_other_2' }] };
    expect(brew.checkOneWordsValue(two, ['other', 'starbucks'])).toBeNull();
    expect(brew.checkOneWordsValue(two, ['other', 'zzz_other_2'])).toMatch(/own words/);
  });
  it('drink most must be among the kitchen answers, and removing that coffee clears it in the same save', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await expect(save(c, g.uid, [{ field: 'cupboard_coffee', value: ['starbucks', 'wawa'] }, { field: 'main_cupboard', value: 'illy' }])).rejects.toBeInstanceOf(RoutineSaveError);
      await save(c, g.uid, [{ field: 'cupboard_coffee', value: ['starbucks', 'wawa', 'illy'] }, { field: 'main_cupboard', value: 'wawa' }]);
      expect((await current(c, g.uid)).main_cupboard?.value).toBe('wawa');
      const r = await save(c, g.uid, [{ field: 'cupboard_coffee', value: ['starbucks', 'illy'] }]);
      expect(r.rows.map(x => `${x.field}:${x.op}`).sort()).toEqual(['cupboard_coffee:set', 'main_cupboard:clear']);
      expect((await current(c, g.uid)).main_cupboard).toBeUndefined();
    });
  });
  it('the card takes several coffees and the follow-up at two', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c, { quiz: true });
      await recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: ['cupboard_coffee', 'main_cupboard'],
        answers: [{ field: 'cupboard_coffee', value: ['starbucks', 'other'], words: 'Zzz Corner Roasters' }, { field: 'main_cupboard', value: 'other' }] }, c);
      const now = await current(c, g.uid);
      expect(now.cupboard_coffee).toMatchObject({ value: ['starbucks', 'other'], words: 'Zzz Corner Roasters' });
      expect(now.main_cupboard?.value).toBe('other');
      expect(await kitchenRow(c, g.userId)).toEqual([{ code: 'other', customer_words: 'Zzz Corner Roasters' }]);
    });
  });
});

describe('v_customer_cupboard_coffee (A6) and its readers', () => {
  it('the main coffee; the only coffee; no row for several with no main; a stored single value reads as before', async () => {
    await withRollback(async ({ client: c }) => {
      const main = await customer(c);
      await save(c, main.uid, [{ field: 'cupboard_coffee', value: ['starbucks', 'wawa'] }, { field: 'main_cupboard', value: 'wawa' }]);
      expect(await kitchenRow(c, main.userId)).toEqual([{ code: 'wawa', customer_words: null }]);
      const only = await customer(c);
      await save(c, only.uid, [{ field: 'cupboard_coffee', value: ['illy'] }]);
      expect(await kitchenRow(c, only.userId)).toEqual([{ code: 'illy', customer_words: null }]);
      const several = await customer(c);
      await save(c, several.uid, [{ field: 'cupboard_coffee', value: ['illy', 'wawa'] }]);
      expect(await kitchenRow(c, several.userId)).toEqual([]);
      const old = await customer(c);
      await oldRow(c, old.userId, 'cupboard_coffee', 'set', 'other', '2026-11-01 10:00:00+00', 'Zzz Old Roaster');
      expect(await kitchenRow(c, old.userId)).toEqual([{ code: 'other', customer_words: 'Zzz Old Roaster' }]);
    });
  });
  it('getCupboardCoffee (the /map said-back) reads a one-coffee customer unchanged', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await oldRow(c, g.userId, 'cupboard_coffee', 'set', 'counter_culture', '2026-11-01 10:00:00+00');
      const before = await reads.getCupboardCoffee({ uid: g.uid }, c);
      expect(before).toMatchObject({ code: 'counter_culture', brandKind: 'specialty', customerWords: null });
      await applyTakesIt(c, KITCHEN);
      expect(await reads.getCupboardCoffee({ uid: g.uid }, c)).toMatchObject({ code: 'counter_culture', brandKind: 'specialty', customerWords: null });
    });
  });
});

describe('Liam on the kitchen (B3)', () => {
  it('each brand is added under the cap; the stand-alone answers replace the list', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      const s = await liamSession(c, g.uid);
      for (const [turn, brand] of ['starbucks', 'wawa', 'illy', 'lavazza'].entries()) {
        await resolveRemember(g.uid, [{ field: 'cupboard_coffee', rawValue: brand }], s, turn + 1, c);
      }
      expect((await current(c, g.uid)).cupboard_coffee?.value).toEqual(['starbucks', 'wawa', 'illy']); // the fourth is over the cap
      await resolveRemember(g.uid, [{ field: 'cupboard_coffee', rawValue: 'nothing' }], s, 9, c);
      expect((await current(c, g.uid)).cupboard_coffee?.value).toEqual(['nothing']);
    });
  });
  it('a marker with words replaces the typed name; a set over the list keeps the stored words', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      const s = await liamSession(c, g.uid);
      await resolveRemember(g.uid, [{ field: 'cupboard_coffee', rawValue: 'other|Café du Monde' }], s, 1, c);
      await resolveRemember(g.uid, [{ field: 'cupboard_coffee', rawValue: 'starbucks' }], s, 2, c);
      expect((await current(c, g.uid)).cupboard_coffee).toMatchObject({ value: ['other', 'starbucks'], words: 'Café du Monde' });
      await resolveRemember(g.uid, [{ field: 'cupboard_coffee', rawValue: 'other|Zzz Corner Roasters' }], s, 3, c);
      expect((await current(c, g.uid)).cupboard_coffee).toMatchObject({ value: ['other', 'starbucks'], words: 'Zzz Corner Roasters' });
      // the same words again are already known
      const n = (await rows(c, g.userId, 'cupboard_coffee')).length;
      await resolveRemember(g.uid, [{ field: 'cupboard_coffee', rawValue: 'other|Zzz Corner Roasters' }], s, 4, c);
      expect(await rows(c, g.userId, 'cupboard_coffee')).toHaveLength(n);

      // over a single stored typed-in coffee (before Part C) the [old, new] set keeps its words
      const h = await customer(c);
      const t = await liamSession(c, h.uid);
      await oldRow(c, h.userId, 'cupboard_coffee', 'set', 'other', '2026-11-01 10:00:00+00', 'Zzz Old Roaster');
      await resolveRemember(h.uid, [{ field: 'cupboard_coffee', rawValue: 'wawa' }], t, 1, c);
      expect((await current(c, h.uid)).cupboard_coffee).toMatchObject({ value: ['other', 'wawa'], words: 'Zzz Old Roaster' });
    });
  });
});

describe('the cupboard_coffee conversion (Part C)', () => {
  it('a single value becomes [value] 1 µs later with its words, source_id ud3; old row untouched; twice is once', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await oldRow(c, g.userId, 'cupboard_coffee', 'set', 'other', '2026-11-14 20:47:29.892949+00', 'Zzz Old Roaster');
      const before = await rows(c, g.userId, 'cupboard_coffee');
      expect((await planTakesIt(c, KITCHEN)).filter(p => p.userId === g.userId)).toMatchObject([{ action: 'convert', value: 'other', customerWords: 'Zzz Old Roaster' }]);
      await applyTakesIt(c, KITCHEN);
      const after = await rows(c, g.userId, 'cupboard_coffee');
      expect(after).toHaveLength(2);
      expect(after[0]).toEqual(before[0]);
      expect(after[1]).toMatchObject({ op: 'set', source: 'backfill', source_id: `ud3:cupboard_coffee:${g.userId}`, value: '["other"]',
        customer_words: 'Zzz Old Roaster', occurred_at: '2026-11-14 20:47:29.89295+00' });
      expect((await current(c, g.uid)).cupboard_coffee).toMatchObject({ value: ['other'], words: 'Zzz Old Roaster' });
      expect(await kitchenRow(c, g.userId)).toEqual([{ code: 'other', customer_words: 'Zzz Old Roaster' }]);
      expect((await planTakesIt(c, KITCHEN)).filter(p => p.userId === g.userId)).toEqual([]);
      await applyTakesIt(c, KITCHEN);
      expect(await rows(c, g.userId, 'cupboard_coffee')).toHaveLength(2);
    });
  });
  it('Dana 2026-11-25: a later declined row is ignored (converted); a later clear is not converted', async () => {
    await withRollback(async ({ client: c }) => {
      const declined = await customer(c);
      await oldRow(c, declined.userId, 'cupboard_coffee', 'set', 'wawa', '2026-11-01 10:00:00+00');
      await record.brewProfileChange.backfill({ userId: declined.userId, source: 'quiz', sourceId: `t-${randomUUID()}`, field: 'cupboard_coffee', op: 'declined', value: null, occurredAt: '2026-11-02 10:00:00+00' }, c);
      const cleared = await customer(c);
      await oldRow(c, cleared.userId, 'cupboard_coffee', 'set', 'wawa', '2026-11-01 10:00:00+00');
      await oldRow(c, cleared.userId, 'cupboard_coffee', 'clear', null, '2026-11-02 10:00:00+00');
      const plan = await planTakesIt(c, KITCHEN);
      expect(plan.filter(p => p.userId === declined.userId)).toMatchObject([{ action: 'convert', value: 'wawa' }]);
      expect(plan.filter(p => p.userId === cleared.userId)).toEqual([]);
      await applyTakesIt(c, KITCHEN);
      expect((await current(c, declined.uid)).cupboard_coffee?.value).toEqual(['wawa']);
      expect((await current(c, cleared.uid)).cupboard_coffee).toBeUndefined();
      expect(await rows(c, cleared.userId, 'cupboard_coffee')).toHaveLength(2);
    });
  });
  it('the defaults are still brief 2\'s takes_it run', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await oldRow(c, g.userId, 'takes_it', 'set', 'milk', '2026-10-01 10:00:00+00');
      await applyTakesIt(c);
      expect((await rows(c, g.userId, 'takes_it')).at(-1)).toMatchObject({ source_id: `ud2:takes_it:${g.userId}`, value: '["milk"]' });
    });
  });
});

describe('integrity (B4, check 31 per Dana 2026-11-25)', () => {
  it('seed coverage passes with main_cupboard', async () => {
    expect(integrity.USUAL_DRINK_SEED_CODES.brew_profile_field).toContain('main_cupboard');
    expect((await integrity.checkUsualDrinkSeedCoverage()).pass).toBe(true);
  });
  it('check 31 flags black only when black is the only answer and every drink has milk', async () => {
    await withRollback(async ({ client: c }) => {
      const alone = await customer(c);
      await save(c, alone.uid, [{ field: 'usual_drink', value: ['latte'] }, { field: 'takes_it', value: ['black'] }]);
      const withMilk = await customer(c);
      await save(c, withMilk.uid, [{ field: 'usual_drink', value: ['latte'] }, { field: 'takes_it', value: ['black', 'milk'] }]);
      const canon = async (userId: string) => (await c.query<{ c: string }>(`SELECT canonical_user_id::text AS c FROM v_customer_identity WHERE user_id = $1`, [userId])).rows[0].c;
      const details = (await integrity.checkTakesItVsUsualDrink({ tx: c })).details ?? [];
      const [a, w] = [await canon(alone.userId), await canon(withMilk.userId)];
      expect(details).toContain(`${a}: takes it black but every drink has milk`);
      expect(details.some(d => d.startsWith(w))).toBe(false);
    });
  });
  it('check 33 covers cupboard_coffee', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await oldRow(c, g.userId, 'cupboard_coffee', 'set', 'wawa', new Date().toISOString());
      expect((await integrity.checkArrayFieldsHoldArrays({ tx: c })).details?.some(d => d.endsWith(': cupboard_coffee'))).toBe(true);
    });
  });
});
