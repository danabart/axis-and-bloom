// Usual Drink 2 (2026-11-24), Part E — the routine: the one rule set (B1),
// the Profile's one save (saveRoutine, B2), Liam's exclusive and single-value
// cases (B5/B6, Dana's Task 0 answer 2), the takes_it conversion (Part C), the
// brew-card sentence, the words view (A8), the payload (B4) and the seed lists.
// backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_2_ROUTINE_AND_PROFILE.md
//
// Usual Drink 3 (2026-11-25, D2/D4): black goes with milk and the kitchen takes
// up to three coffees, so the exclusive cases run on the kitchen's stand-alone
// answers (nothing, dont_know) and kitchen answers are lists.
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
const { saveRoutine, recordPostResultCard, brewProfileOptions, RoutineSaveError, PostResultCardError } = await import('./brewProfileCard.js');
const { record, BrewProfileChangeRejected } = await import('./customerFacts.js');
const reads = await import('./customerReads.js');
const { resolveRemember } = await import('../routes/sommelier.js');
const { planTakesIt, applyTakesIt } = await import('../scripts/usualDrink2TakesIt_2026_11_24.js');
const { takesItSentence } = await import('./brewCard.js');
const integrity = await import('./customerIntegrity.js');

vi.setConfig({ testTimeout: 120_000 });
beforeAll(async () => { await brew.loadBrewProfileFields(); });
afterAll(async () => { await brew.loadBrewProfileFields(); await db.end(); });

type C = pg.PoolClient;

async function customer(c: C, opts: { quiz?: boolean } = {}) {
  const uid = `zzz-ud2-${randomUUID()}`;
  const userId = (await c.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name) VALUES ($1, 'Zzz UD2') RETURNING id`, [uid])).rows[0].id;
  let sessionId: string | null = null;
  if (opts.quiz) sessionId = (await c.query<{ id: string }>(`INSERT INTO quiz_session (user_id, completed_at) VALUES ($1, now()) RETURNING id`, [userId])).rows[0].id;
  return { uid, userId, sessionId: sessionId! };
}
const rows = async (c: C, userId: string, field?: string) => (await c.query(
  `SELECT id::text, field, op, value, source, source_id, customer_words, occurred_at::text AS occurred_at FROM customer_brew_profile_change
   WHERE user_id = $1 AND ($2::text IS NULL OR field = $2) ORDER BY occurred_at, field`, [userId, field ?? null])).rows;
const current = async (c: C, uid: string) => reads.getBrewProfileCurrent(uid, c);
const cfg = (code: string) => brew.getBrewProfileFieldsConfig()[code];
const liamSession = async (c: C, uid: string) =>
  (await c.query<{ id: number }>(`INSERT INTO sommelier_sessions (uid, intent) VALUES ($1, 'MATCHED') RETURNING id`, [uid])).rows[0].id;
const setRaw = (c: C, userId: string, field: string, value: unknown, occurredAt?: string) => occurredAt
  ? record.brewProfileChange.backfill({ userId, source: 'onsite', sourceId: `t-${randomUUID()}`, field, op: 'set', value: JSON.stringify(value), occurredAt }, c)
  : record.brewProfileChange({ userId, source: 'onsite', sourceId: `t-${randomUUID()}`, field, op: 'set', value: JSON.stringify(value) }, c);

describe('the one rule set (B1)', () => {
  it('(a) an exclusive value stands alone, in the validator and at the door', async () => {
    expect(brew.validateFullValue(cfg('cupboard_coffee'), ['wawa', 'starbucks']).ok).toBe(true);
    expect(brew.validateFullValue(cfg('cupboard_coffee'), ['nothing']).ok).toBe(true);
    expect(brew.validateFullValue(cfg('cupboard_coffee'), ['nothing', 'wawa']).ok).toBe(false);
    expect(brew.validateFullValue(cfg('takes_it'), ['milk_and_sugar']).ok).toBe(false); // retired: off the pickers
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await expect(setRaw(c, g.userId, 'cupboard_coffee', ['dont_know', 'wawa'])).rejects.toBeInstanceOf(BrewProfileChangeRejected);
    });
  });
  it('(b) a values_from answer must be one of two or more source answers', () => {
    const md = cfg('main_drink');
    expect(md.valuesFrom).toBe('usual_drink');
    expect(brew.checkValuesFrom(md, 'latte', ['latte', 'espresso'])).toBeNull();
    expect(brew.checkValuesFrom(md, 'pod', ['latte', 'espresso'])).toMatch(/one of/);
    expect(brew.checkValuesFrom(md, 'latte', ['latte'])).toMatch(/two or more/);
    expect(brew.fieldApplies(md, ['latte'])).toBe(false);
    expect(brew.fieldApplies(md, ['latte', 'espresso'])).toBe(true);
    expect(brew.fieldApplies(cfg('takes_it'), undefined)).toBe(true);
  });
});

describe('the payload (B4)', () => {
  it('groups, valuesFrom, exclusive, the card flag and limits', async () => {
    const mirror = await brewProfileOptions('mirror');
    const by = Object.fromEntries(mirror.fields.map(f => [f.code, f]));
    expect(by.usual_drink.group?.code).toBe('make');
    expect(by.main_drink.valuesFrom).toBe('usual_drink');
    expect(by.main_drink.values.map(v => v.code)).toEqual(by.usual_drink.values.map(v => v.code));
    expect(by.takes_it.values.find(v => v.code === 'black')?.exclusive).toBe(false);
    expect(by.cupboard_coffee.values.find(v => v.code === 'nothing')?.exclusive).toBe(true);
    expect(by.takes_it.values.map(v => v.code)).not.toContain('milk_and_sugar');
    expect(by.takes_it.displayLabels.milk_and_sugar).toBeTruthy();
    expect(mirror.limits.typeaheadMaxRows).toBe(6);
    expect(mirror.copy.routine_save_error).toBeTruthy();
    expect((await brewProfileOptions('card')).fields.map(f => f.code)).toEqual(['usual_drink', 'main_drink', 'cupboard_coffee', 'main_cupboard', 'cupboard_roast', 'coffee_feeling']);
  });
  it('the card refuses a dependent it did not offer, accepts it at two drinks', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c, { quiz: true });
      await expect(recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: ['usual_drink', 'main_drink'], answers: [{ field: 'usual_drink', value: ['latte'] }] }, c))
        .rejects.toSatisfy((e: unknown) => e instanceof PostResultCardError && e.code === 'FIELD_NOT_OFFERED');
      await expect(recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: ['usual_drink', 'main_drink'], answers: [{ field: 'usual_drink', value: ['latte', 'espresso'] }, { field: 'main_drink', value: 'pod' }] }, c))
        .rejects.toSatisfy((e: unknown) => e instanceof PostResultCardError && e.code === 'INVALID_ANSWER');
      await recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: ['usual_drink', 'main_drink'], answers: [{ field: 'usual_drink', value: ['latte', 'espresso'] }, { field: 'main_drink', value: 'latte' }] }, c);
      expect((await current(c, g.uid)).main_drink?.value).toBe('latte');
    });
  });
});

describe('saveRoutine (B2)', () => {
  it('unchanged writes nothing, a change writes one row, same apiEventId twice writes once', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      const first = await saveRoutine({ uid: g.uid, answers: [{ field: 'takes_it', value: ['milk', 'sugar'] }, { field: 'cupboard_roast', value: 'medium' }], cleared: [] }, `ev-${randomUUID()}`, c);
      expect(first.rows.map(r => r.field).sort()).toEqual(['cupboard_roast', 'takes_it']);
      const same = await saveRoutine({ uid: g.uid, answers: [{ field: 'takes_it', value: ['milk', 'sugar'] }, { field: 'cupboard_roast', value: 'medium' }], cleared: [] }, `ev-${randomUUID()}`, c);
      expect(same.rows).toEqual([]);
      const ev = `ev-${randomUUID()}`;
      const change = await saveRoutine({ uid: g.uid, answers: [{ field: 'takes_it', value: ['milk', 'sugar'] }, { field: 'cupboard_roast', value: 'dark' }], cleared: [] }, ev, c);
      expect(change.rows).toEqual([{ field: 'cupboard_roast', op: 'set', inserted: true }]);
      expect(change.rows.length).toBe(1);
      const before = (await rows(c, g.userId)).length;
      // a retry of that request (same apiEventId) writes nothing more, whatever it carries: the source_id is taken
      const retry = await saveRoutine({ uid: g.uid, answers: [{ field: 'cupboard_roast', value: 'light' }], cleared: [] }, ev, c);
      expect(retry.rows).toEqual([{ field: 'cupboard_roast', op: 'set', inserted: false }]);
      const after = await rows(c, g.userId, 'cupboard_roast');
      expect((await rows(c, g.userId)).length).toBe(before);
      expect(after.filter(r => r.source_id === `${ev}:cupboard_roast:set`)).toHaveLength(1);
      expect((await current(c, g.uid)).cupboard_roast?.value).toBe('dark');
      expect(after.every(r => r.source === 'onsite')).toBe(true);
    });
  });
  it('no apiEventId: the fallback source_id makes a double submit inside the minute one row', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await saveRoutine({ uid: g.uid, answers: [{ field: 'cupboard_roast', value: 'light' }], cleared: [] }, undefined, c);
      // a double submit: both requests read the old value, so the second one tries the same insert
      const r = await record.brewProfileChange({
        userId: g.userId, source: 'onsite', field: 'cupboard_roast', op: 'set', value: JSON.stringify('light'),
        sourceId: (await import('./brewProfileCard.js')).brewProfileFallbackSourceId(g.uid, 'cupboard_roast', 'set', ['light', null]),
      }, c);
      expect(r.inserted).toBe(false);
      expect(await rows(c, g.userId, 'cupboard_roast')).toHaveLength(1);
    });
  });
  it('a cleared field gets a clear row; an empty array clears; nothing stored means nothing to clear', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await saveRoutine({ uid: g.uid, answers: [{ field: 'takes_it', value: ['milk'] }, { field: 'cupboard_roast', value: 'dark' }], cleared: [] }, `ev-${randomUUID()}`, c);
      const r = await saveRoutine({ uid: g.uid, answers: [{ field: 'takes_it', value: [] }], cleared: ['cupboard_roast', 'grinder'] }, `ev-${randomUUID()}`, c);
      expect(r.rows.map(x => `${x.field}:${x.op}`).sort()).toEqual(['cupboard_roast:clear', 'takes_it:clear']);
      const now = await current(c, g.uid);
      expect(now.takes_it).toBeUndefined();
      expect(now.cupboard_roast).toBeUndefined();
    });
  });
  it('a source change that drops the most-days drink clears it in the same save', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await saveRoutine({ uid: g.uid, answers: [{ field: 'usual_drink', value: ['latte', 'espresso'] }, { field: 'main_drink', value: 'latte' }], cleared: [] }, `ev-${randomUUID()}`, c);
      expect((await current(c, g.uid)).main_drink?.value).toBe('latte');
      const r = await saveRoutine({ uid: g.uid, answers: [{ field: 'usual_drink', value: ['espresso', 'pod'] }], cleared: [] }, `ev-${randomUUID()}`, c);
      expect(r.rows.map(x => `${x.field}:${x.op}`).sort()).toEqual(['main_drink:clear', 'usual_drink:set']);
      expect((await current(c, g.uid)).main_drink).toBeUndefined();
      // down to one drink: most days no longer applies and is refused
      await expect(saveRoutine({ uid: g.uid, answers: [{ field: 'usual_drink', value: ['pod'] }, { field: 'main_drink', value: 'pod' }], cleared: [] }, `ev-${randomUUID()}`, c))
        .rejects.toBeInstanceOf(RoutineSaveError);
    });
  });
  it('words are saved with the value that takes them and read back (A8)', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await saveRoutine({ uid: g.uid, answers: [{ field: 'cupboard_coffee', value: ['other'], words: 'Café du Monde' }], cleared: [] }, `ev-${randomUUID()}`, c);
      expect((await current(c, g.uid)).cupboard_coffee).toMatchObject({ value: ['other'], words: 'Café du Monde' });
      // the same value with new words is a change
      const r = await saveRoutine({ uid: g.uid, answers: [{ field: 'cupboard_coffee', value: ['other'], words: 'Lavazza Oro' }], cleared: [] }, `ev-${randomUUID()}`, c);
      expect(r.rows).toHaveLength(1);
      expect((await current(c, g.uid)).cupboard_coffee?.words).toBe('Lavazza Oro');
      // a listed brand drops the words
      await saveRoutine({ uid: g.uid, answers: [{ field: 'cupboard_coffee', value: ['wawa'] }], cleared: [] }, `ev-${randomUUID()}`, c);
      expect((await current(c, g.uid)).cupboard_coffee).toMatchObject({ value: ['wawa'], words: null });
      await expect(saveRoutine({ uid: g.uid, answers: [{ field: 'cupboard_coffee', value: ['wawa'], words: 'nope' }], cleared: [] }, `ev-${randomUUID()}`, c))
        .rejects.toBeInstanceOf(RoutineSaveError);
    });
  });
});

describe('Liam on takes_it and most days (B5, B6)', () => {
  it('an exclusive value is set alone; a value over a stored exclusive replaces it', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      const s = await liamSession(c, g.uid);
      await setRaw(c, g.userId, 'cupboard_coffee', ['wawa', 'starbucks']);
      await resolveRemember(g.uid, [{ field: 'cupboard_coffee', rawValue: 'nothing' }], s, 1, c);
      expect((await current(c, g.uid)).cupboard_coffee?.value).toEqual(['nothing']);
      await resolveRemember(g.uid, [{ field: 'cupboard_coffee', rawValue: 'wawa' }], s, 2, c);
      expect((await current(c, g.uid)).cupboard_coffee?.value).toEqual(['wawa']);
      await resolveRemember(g.uid, [{ field: 'cupboard_coffee', rawValue: 'starbucks' }], s, 3, c);
      expect((await current(c, g.uid)).cupboard_coffee?.value).toEqual(['wawa', 'starbucks']);
      const ops = (await rows(c, g.userId, 'cupboard_coffee')).filter(r => r.source === 'liam').map(r => r.op);
      expect(ops).toEqual(['set', 'set', 'add']);
    });
  });
  it('over a single stored value (before Part C) Liam sets [old, new], so the old answer stays', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      const s = await liamSession(c, g.uid);
      await record.brewProfileChange.backfill({ userId: g.userId, source: 'backfill', sourceId: `t-${randomUUID()}`, field: 'takes_it', op: 'set', value: JSON.stringify('milk'), occurredAt: new Date(Date.now() - 60_000) }, c);
      await resolveRemember(g.uid, [{ field: 'takes_it', rawValue: 'sugar' }], s, 1, c);
      expect((await current(c, g.uid)).takes_it?.value).toEqual(['milk', 'sugar']);
      expect((await rows(c, g.userId, 'takes_it')).at(-1)).toMatchObject({ op: 'set', source: 'liam' });
    });
  });
  it('a most-days marker is checked against the drinks, in the same batch too', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      const s = await liamSession(c, g.uid);
      await resolveRemember(g.uid, [{ field: 'main_drink', rawValue: 'latte' }], s, 1, c);
      expect((await current(c, g.uid)).main_drink).toBeUndefined();
      await setRaw(c, g.userId, 'usual_drink', ['latte']);
      // the marker comes first in the batch; the drink it names arrives after it
      await resolveRemember(g.uid, [{ field: 'main_drink', rawValue: 'espresso' }, { field: 'usual_drink', rawValue: 'espresso' }], s, 2, c);
      expect((await current(c, g.uid)).usual_drink?.value).toEqual(['latte', 'espresso']);
      expect((await current(c, g.uid)).main_drink?.value).toBe('espresso');
    });
  });
});

describe('the takes_it conversion (Part C)', () => {
  it('a single value becomes [value], sorted directly after the original with no tie; old rows untouched; twice is once', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await setRaw(c, g.userId, 'takes_it', 'milk', '2026-09-28 15:24:02.581498+00');
      const before = await rows(c, g.userId, 'takes_it');
      const plan = (await planTakesIt(c)).filter(p => p.userId === g.userId);
      expect(plan).toMatchObject([{ action: 'convert', value: 'milk' }]);
      await applyTakesIt(c);
      const after = await rows(c, g.userId, 'takes_it');
      expect(after).toHaveLength(2);
      expect(after[0]).toEqual(before[0]);
      expect(after[1]).toMatchObject({ op: 'set', source: 'backfill', source_id: `ud2:takes_it:${g.userId}`, value: '["milk"]', occurred_at: '2026-09-28 15:24:02.581499+00' });
      expect((await current(c, g.uid)).takes_it).toMatchObject({ value: ['milk'], source: 'profile_page' });
      // the date the customer told us does not move (by the microsecond)
      expect((await c.query(`SELECT max(occurred_at)::text AS t FROM customer_brew_profile_change WHERE user_id = $1`, [g.userId])).rows[0].t).toBe('2026-09-28 15:24:02.581499+00');
      expect((await planTakesIt(c)).filter(p => p.userId === g.userId)).toEqual([]);
      await applyTakesIt(c);
      expect(await rows(c, g.userId, 'takes_it')).toHaveLength(2);
    });
  });
  it('a customer Liam added to after their single set is still converted and keeps both', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await setRaw(c, g.userId, 'takes_it', 'milk', '2026-10-01 10:00:00.000001+00');
      // an add written in the window (before B6 shipped, a plain add)
      await record.brewProfileChange.backfill({ userId: g.userId, source: 'liam', sourceId: `t-${randomUUID()}`, field: 'takes_it', op: 'add', value: JSON.stringify('sugar'), occurredAt: '2026-10-02 10:00:00+00' }, c);
      expect((await current(c, g.uid)).takes_it?.value).toEqual(['sugar']); // the gap Task 0 found
      await applyTakesIt(c);
      expect((await current(c, g.uid)).takes_it?.value).toEqual(['milk', 'sugar']);
    });
  });
  it('a retired single value is reported and skipped, nothing written', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await record.brewProfileChange.backfill({ userId: g.userId, source: 'backfill', sourceId: `t-${randomUUID()}`, field: 'takes_it', op: 'set', value: JSON.stringify('milk_and_sugar'), occurredAt: '2026-08-01 10:00:00+00' }, c);
      const mine = (await planTakesIt(c)).filter(p => p.userId === g.userId);
      expect(mine).toMatchObject([{ action: 'skip', value: 'milk_and_sugar' }]);
      expect(mine[0].why).toMatch(/retired/);
      await applyTakesIt(c);
      expect(await rows(c, g.userId, 'takes_it')).toHaveLength(1);
    });
  });
});

describe('the brew-card sentence (B6)', () => {
  const tpl = 'You take it with {list}.';
  const p = (value: unknown) => ({ takes_it: { value, source: 'profile_page' as const, capturedAt: null } });
  it('one and two additions; none for black or no answer; a single stored value reads as a list', () => {
    expect(takesItSentence(p(['milk']), tpl)).toBe('You take it with milk.');
    expect(takesItSentence(p(['milk', 'sugar']), tpl)).toBe('You take it with milk and sugar.');
    // Usual Drink 3: black is left out by brew_card_takes_it_skip, not by an exclusive flag
    expect(takesItSentence(p(['black']), tpl, 'black')).toBeUndefined();
    expect(takesItSentence(p(['black', 'milk']), tpl, 'black')).toBe('You take it with milk.');
    expect(takesItSentence(null, tpl)).toBeUndefined();
    expect(takesItSentence(p('sugar'), tpl)).toBe('You take it with sugar.');
    expect(takesItSentence(p(['milk']), undefined)).toBeUndefined();
  });
});

describe('seed lists and the integrity checks', () => {
  it('check 26 finds every seed row; check 33 lists a single value on an array field', async () => {
    expect((await integrity.checkUsualDrinkSeedCoverage()).pass).toBe(true);
    await withRollback(async ({ client: c }) => {
      const g = await customer(c);
      await record.brewProfileChange.backfill({ userId: g.userId, source: 'backfill', sourceId: `t-${randomUUID()}`, field: 'takes_it', op: 'set', value: JSON.stringify('milk'), occurredAt: new Date() }, c);
      const check = await integrity.checkArrayFieldsHoldArrays({ tx: c });
      expect(check.severity).toBe('info');
      expect(check.details?.some(d => d.endsWith(': takes_it'))).toBe(true);
    });
  });
});
