// Usual Drink 1 (2026-11-12), Part E — capture of the daily cups, the kitchen
// and the feeling: the three writers, the views, the card's declined rows,
// idempotency, the caps, the words, the kill switch, proxy and ownership, the
// Liam markers, the guest sign-up fold, the purge guard, the funnel events and
// the read-only grants.
// backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_1_CAPTURE.md
//
// Test DB only. Every write sits in a rolled-back transaction (withRollback):
// fact rows are insert-only. The field list is the seeded rows, read through
// the one reader (loadBrewProfileFields); expected labels and moves are read
// from the lookups, never typed, except the brief's own example codes.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';

const counters: string[] = [];
vi.mock('./brewProfile.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./brewProfile.js')>();
  return { ...actual, incrementBrewProfileCounter: vi.fn(async (kind: string) => { counters.push(kind); }) };
});

const { db } = await import('../db/client.js');
const { withRollback } = await import('../test/withRollback.js');
const brew = await import('./brewProfile.js');
const { recordPostResultCard, brewProfileOptions, PostResultCardError } = await import('./brewProfileCard.js');
const { record, BrewProfileChangeRejected } = await import('./customerFacts.js');
const reads = await import('./customerReads.js');
const { resolveRemember } = await import('../routes/sommelier.js');
const { staleGuestCandidates } = await import('./staleGuestCleanup.js');
const { logFunnelEvent } = await import('../features/marketing/funnelEvents.js');

vi.setConfig({ testTimeout: 120_000 });
beforeAll(async () => { await brew.loadBrewProfileFields(); });
afterAll(async () => { await db.end(); });

type C = pg.PoolClient;
const CARD = ['usual_drink', 'cupboard_coffee', 'coffee_feeling'];

async function guest(c: C, opts: { quiz?: boolean; proxyBy?: string; createdDaysAgo?: number; quizDaysAgo?: number } = {}) {
  const uid = `zzz-ud1-${randomUUID()}`;
  const userId = (await c.query<{ id: string }>(
    `INSERT INTO user_profile (firebase_uid, first_name, created_at) VALUES ($1, 'Zzz UD1', now() - make_interval(days => $2)) RETURNING id`,
    [uid, opts.createdDaysAgo ?? 0])).rows[0].id;
  let sessionId: string | null = null;
  if (opts.quiz !== false) {
    sessionId = (await c.query<{ id: string }>(
      `INSERT INTO quiz_session (user_id, completed_at, taken_by_user_id) VALUES ($1, now() - make_interval(days => $2), $3) RETURNING id`,
      [userId, opts.quizDaysAgo ?? 0, opts.proxyBy ?? null])).rows[0].id;
  }
  return { uid, userId, sessionId: sessionId! };
}

const rows = async (c: C, userId: string) => (await c.query(
  `SELECT field, op, value, source, quiz_session_id, customer_words FROM customer_brew_profile_change WHERE user_id = $1 ORDER BY occurred_at, field`,
  [userId])).rows;

const moveFor = async (c: C, feeling: string) => (await c.query<{ code: string }>(
  `SELECT m.code FROM brew_coffee_feeling cf JOIN brew_profile_field_value fv ON fv.id = cf.field_value_id
   JOIN brew_profile_field f ON f.id = fv.field_id JOIN dial_move m ON m.id = cf.move_id
   WHERE f.code = 'coffee_feeling' AND fv.code = $1`, [feeling])).rows[0].code;

async function liamSession(c: C, uid: string): Promise<number> {
  return (await c.query<{ id: number }>(`INSERT INTO sommelier_sessions (uid, intent) VALUES ($1, 'MATCHED') RETURNING id`, [uid])).rows[0].id;
}

describe('the field list (B1)', () => {
  it('serves the eight seeded fields synchronously, the card gets the three with a prompt in order', async () => {
    const cfg = brew.getBrewProfileFieldsConfig();
    expect(Object.keys(cfg)).toEqual(expect.arrayContaining(['brew_methods', 'grinder', 'takes_it', 'decaf_constraint', 'aversions', ...CARD]));
    const card = await brewProfileOptions('card');
    expect(card.fields.map(f => f.code)).toEqual(CARD);
    expect(card.fields[0].picker).toBe('multi_select');
    expect(card.fields[1].picker).toBe('typeahead');
    expect(card.fields[2].picker).toBe('chips');
    expect(card.fields[1].values.filter(v => v.pinned).map(v => v.code)).toEqual(['dont_know', 'nothing', 'pods_unknown', 'other']);
    expect(card.copy.post_result_save).toBeTruthy();
    expect(card.copy.post_result_skip).toBeTruthy();
  });
});

describe('three writers, all three fields, the views (Part E 1)', () => {
  it('quiz, onsite and liam rows resolve through the views; only quiz rows carry quiz_session_id', async () => {
    await withRollback(async ({ client: c }) => {
      // quiz: the card
      const g1 = await guest(c);
      await recordPostResultCard({ uid: g1.uid, quizSessionId: g1.sessionId, shown: CARD, answers: [
        { field: 'usual_drink', value: ['latte', 'drip_black'] }, { field: 'cupboard_coffee', value: 'counter_culture' }, { field: 'coffee_feeling', value: 'bolder' },
      ] }, c);
      // onsite: the Profile PATCH path (validateFullValue + the door, as users.ts)
      const g2 = await guest(c, { quiz: false });
      for (const [field, value] of [['usual_drink', ['americano_milk']], ['cupboard_coffee', 'kirkland'], ['coffee_feeling', 'happy']] as const) {
        const check = brew.validateFullValue(brew.getBrewProfileFieldsConfig()[field], value);
        expect(check.ok).toBe(true);
        await record.brewProfileChange({ userId: g2.userId, source: 'onsite', sourceId: `t-${randomUUID()}`, field, op: 'set', value: JSON.stringify((check as { value: unknown }).value) }, c);
      }
      // liam: resolveRemember
      const g3 = await guest(c, { quiz: false });
      const sid = await liamSession(c, g3.uid);
      await resolveRemember(g3.uid, [
        { field: 'usual_drink', rawValue: 'cold_brew' }, { field: 'cupboard_coffee', rawValue: 'starbucks' }, { field: 'coffee_feeling', rawValue: 'gentler' },
      ], sid, 2, c);

      const r1 = await rows(c, g1.userId);
      expect(r1.every(r => r.source === 'quiz' && r.quiz_session_id === g1.sessionId)).toBe(true);
      expect((await rows(c, g2.userId)).every(r => r.quiz_session_id === null)).toBe(true);
      const r3 = await rows(c, g3.userId);
      expect(r3.map(r => [r.field, r.op, r.source])).toEqual(expect.arrayContaining([['usual_drink', 'add', 'liam'], ['cupboard_coffee', 'set', 'liam'], ['coffee_feeling', 'set', 'liam']]));
      expect(r3.every(r => r.quiz_session_id === null)).toBe(true);

      const d1 = await reads.getUsualDrinks(g1.uid, c);
      expect(d1.map(d => d.code).sort()).toEqual(['drip_black', 'latte']);
      const latte = d1.find(d => d.code === 'latte')!;
      expect([latte.baseMethod, latte.dilution, latte.milk]).toEqual(['espresso', 'none', 'steamed']);
      expect(latte.quizSessionId).toBe(g1.sessionId);
      expect((await reads.getUsualDrinks(g2.uid, c)).map(d => [d.code, d.baseMethod, d.dilution, d.milk])).toEqual([['americano_milk', 'espresso', 'water', 'cold']]);
      expect((await reads.getUsualDrinks(g3.uid, c)).map(d => d.code)).toEqual(['cold_brew']);
      expect((await reads.getCupboardCoffee(g1.uid, c))?.brandKind).toBe('specialty');
      expect((await reads.getCupboardCoffee(g2.uid, c))?.brandKind).toBe('mass_market');
      expect((await reads.getCupboardCoffee(g3.uid, c))?.brandKind).toBe('chain');
      expect((await reads.getCoffeeFeeling(g1.uid, c))?.moveCode).toBe(await moveFor(c, 'bolder'));
      expect((await reads.getCoffeeFeeling(g2.uid, c))?.moveCode).toBe(await moveFor(c, 'happy'));
      expect((await reads.getCoffeeFeeling(g3.uid, c))?.moveCode).toBe(await moveFor(c, 'gentler'));
    });
  });
});

describe('the post-result card (B2)', () => {
  it('one answer of three shown: one set and two declined rows', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await guest(c);
      const r = await recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: CARD, answers: [{ field: 'coffee_feeling', value: 'different' }] }, c);
      expect(r.inserted).toBe(3);
      const all = await rows(c, g.userId);
      expect(all.filter(x => x.op === 'set').map(x => x.field)).toEqual(['coffee_feeling']);
      expect(all.filter(x => x.op === 'declined').map(x => x.field).sort()).toEqual(['cupboard_coffee', 'usual_drink']);
      expect(all.filter(x => x.op === 'declined').every(x => x.value === null && x.quiz_session_id === g.sessionId)).toBe(true);
    });
  });

  it('Skip declines all three; resubmitting inserts nothing', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await guest(c);
      expect((await recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: CARD, answers: [] }, c)).inserted).toBe(3);
      expect((await recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: CARD, answers: [] }, c)).inserted).toBe(0);
      expect((await rows(c, g.userId)).map(x => x.op)).toEqual(['declined', 'declined', 'declined']);
    });
  });

  it('changing an answer is a new row and the fold shows the new value; a decline then an answer keeps both', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await guest(c);
      await recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: ['coffee_feeling'], answers: [] }, c);
      await recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: ['coffee_feeling'], answers: [{ field: 'coffee_feeling', value: 'happy' }] }, c);
      await recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: ['coffee_feeling'], answers: [{ field: 'coffee_feeling', value: 'bolder' }] }, c);
      expect((await rows(c, g.userId)).map(x => x.op)).toEqual(['declined', 'set', 'set']);
      expect((await reads.getCoffeeFeeling(g.uid, c))?.code).toBe('bolder');
    });
  });

  it('declined rows change no view: value, captured_at and source stay', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await guest(c);
      await record.brewProfileChange({ userId: g.userId, source: 'onsite', sourceId: `t-${randomUUID()}`, field: 'takes_it', op: 'set', value: JSON.stringify('black') }, c);
      const before = (await c.query(`SELECT b.* FROM v_customer_brew_profile b JOIN v_customer_identity vi ON vi.canonical_user_id = b.canonical_user_id WHERE vi.user_id = $1`, [g.userId])).rows;
      await record.brewProfileChange({ userId: g.userId, source: 'quiz', sourceId: `${g.sessionId}:takes_it:declined`, quizSessionId: g.sessionId, field: 'takes_it', op: 'declined', value: null }, c);
      await recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: CARD, answers: [] }, c);
      const after = (await c.query(`SELECT b.* FROM v_customer_brew_profile b JOIN v_customer_identity vi ON vi.canonical_user_id = b.canonical_user_id WHERE vi.user_id = $1`, [g.userId])).rows;
      expect(after).toEqual(before);
      expect(await reads.getUsualDrinks(g.uid, c)).toEqual([]);
      expect(await reads.getCoffeeFeeling(g.uid, c)).toBeNull();
    });
  });

  it('two drinks store a two-element array; max_items + 1 is rejected and counted', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await guest(c);
      await recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: ['usual_drink'], answers: [{ field: 'usual_drink', value: ['espresso', 'pod'] }] }, c);
      expect(JSON.parse((await rows(c, g.userId))[0].value)).toEqual(['espresso', 'pod']);
      const max = brew.getBrewProfileFieldsConfig().usual_drink.maxLength!;
      const tooMany = brew.getBrewProfileFieldsConfig().usual_drink.allowedValues!.slice(0, max + 1);
      const before = counters.filter(k => k === 'failures').length;
      await expect(recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: ['usual_drink'], answers: [{ field: 'usual_drink', value: tooMany }] }, c))
        .rejects.toSatisfy((e: unknown) => e instanceof PostResultCardError && e.status === 400);
      expect(counters.filter(k => k === 'failures').length).toBe(before + 1);
      // the door refuses it too, whatever the writer
      await expect(record.brewProfileChange({ userId: g.userId, source: 'onsite', sourceId: `t-${randomUUID()}`, field: 'usual_drink', op: 'set', value: JSON.stringify(tooMany) }, c))
        .rejects.toBeInstanceOf(BrewProfileChangeRejected);
    });
  });

  it('words: kept on other, rejected on any other value, rejected over max_item_len', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await guest(c);
      await recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: ['cupboard_coffee'], answers: [{ field: 'cupboard_coffee', value: 'other', words: 'Café du Monde' }] }, c);
      const k = await reads.getCupboardCoffee(g.uid, c);
      expect([k?.code, k?.customerWords]).toEqual(['other', 'Café du Monde']);
      await expect(recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: ['cupboard_coffee'], answers: [{ field: 'cupboard_coffee', value: 'starbucks', words: 'the blonde one' }] }, c))
        .rejects.toSatisfy((e: unknown) => e instanceof PostResultCardError && e.status === 400);
      const cap = brew.getBrewProfileFieldsConfig().cupboard_coffee.maxItemLength!;
      await expect(recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: ['cupboard_coffee'], answers: [{ field: 'cupboard_coffee', value: 'other', words: 'x'.repeat(cap + 1) }] }, c))
        .rejects.toSatisfy((e: unknown) => e instanceof PostResultCardError && e.status === 400);
    });
  });

  it('a proxy-quiz session answers 409 and writes nothing; a session the caller does not own answers 403', async () => {
    await withRollback(async ({ client: c }) => {
      const actor = await guest(c, { quiz: false });
      const member = await guest(c, { proxyBy: actor.userId });
      await expect(recordPostResultCard({ uid: actor.uid, quizSessionId: member.sessionId, shown: CARD, answers: [] }, c))
        .rejects.toSatisfy((e: unknown) => e instanceof PostResultCardError && e.status === 409);
      await expect(recordPostResultCard({ uid: member.uid, quizSessionId: member.sessionId, shown: CARD, answers: [] }, c))
        .rejects.toSatisfy((e: unknown) => e instanceof PostResultCardError && e.status === 409);
      const other = await guest(c);
      const stranger = await guest(c, { quiz: false });
      await expect(recordPostResultCard({ uid: stranger.uid, quizSessionId: other.sessionId, shown: CARD, answers: [] }, c))
        .rejects.toSatisfy((e: unknown) => e instanceof PostResultCardError && e.status === 403);
      expect(await rows(c, member.userId)).toEqual([]);
      expect(await rows(c, other.userId)).toEqual([]);
    });
  });

  it('a guest answers the card, then signs up: the canonical profile shows the guest\'s values', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await guest(c);
      await recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: CARD, answers: [{ field: 'usual_drink', value: ['latte'] }, { field: 'coffee_feeling', value: 'happy' }] }, c);
      const account = await guest(c, { quiz: false });
      await record.identityLink({ userId: g.userId, fromUserId: g.userId, toUserId: account.userId, how: 'email_match', source: 'onsite', sourceId: `t-${randomUUID()}` }, c);
      expect((await reads.getUsualDrinks(account.uid, c)).map(d => d.code)).toEqual(['latte']);
      expect((await reads.getCoffeeFeeling(account.uid, c))?.code).toBe('happy');
      const profile = await reads.getBrewProfileCurrent(account.uid, c);
      expect(profile.usual_drink?.value).toEqual(['latte']);
    });
  });
});

describe('the field rows are the switch (A4, B2 kill switch)', () => {
  it('a deactivated value leaves the options while a customer who stored it still sees it; prompt NULL removes a question', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await guest(c);
      await recordPostResultCard({ uid: g.uid, quizSessionId: g.sessionId, shown: ['cupboard_coffee'], answers: [{ field: 'cupboard_coffee', value: 'wawa' }] }, c);
      await c.query(`UPDATE brew_profile_field_value SET is_active = false WHERE code = 'wawa' AND field_id = (SELECT id FROM brew_profile_field WHERE code = 'cupboard_coffee')`);
      await c.query(`UPDATE brew_profile_field SET prompt = NULL WHERE code = 'coffee_feeling'`);
      try {
        await brew.loadBrewProfileFields(c);
        const card = await brewProfileOptions('card', c);
        expect(card.fields.map(f => f.code)).toEqual(['usual_drink', 'cupboard_coffee']);
        const mirror = await brewProfileOptions('mirror', c);
        const kitchen = mirror.fields.find(f => f.code === 'cupboard_coffee')!;
        expect(kitchen.values.map(v => v.code)).not.toContain('wawa');
        expect(kitchen.displayLabels.wawa).toBeTruthy();
        expect((await reads.getCupboardCoffee(g.uid, c))?.code).toBe('wawa');
        expect(mirror.fields.map(f => f.code)).toContain('coffee_feeling');
      } finally {
        await brew.loadBrewProfileFields();
      }
    });
  });
});

describe('Liam markers (B4)', () => {
  it('other|words lands as other + words; usual_drink=latte adds to the array; coffee_feeling=bolder lands with its move; unicorn is dropped and counted', async () => {
    await withRollback(async ({ client: c }) => {
      const g = await guest(c, { quiz: false });
      const sid = await liamSession(c, g.uid);
      await resolveRemember(g.uid, [{ field: 'usual_drink', rawValue: 'drip_black' }], sid, 2, c);
      await resolveRemember(g.uid, [{ field: 'usual_drink', rawValue: 'latte' }, { field: 'cupboard_coffee', rawValue: 'other|Café du Monde' }], sid, 3, c);
      const before = counters.filter(k => k === 'failures').length;
      await resolveRemember(g.uid, [{ field: 'coffee_feeling', rawValue: 'unicorn' }], sid, 4, c);
      expect(counters.filter(k => k === 'failures').length).toBe(before + 1);
      await resolveRemember(g.uid, [{ field: 'coffee_feeling', rawValue: 'bolder' }], sid, 5, c);
      expect((await reads.getUsualDrinks(g.uid, c)).map(d => d.code).sort()).toEqual(['drip_black', 'latte']);
      const k = await reads.getCupboardCoffee(g.uid, c);
      expect([k?.code, k?.customerWords]).toEqual(['other', 'Café du Monde']);
      expect((await reads.getCoffeeFeeling(g.uid, c))?.moveCode).toBe(await moveFor(c, 'bolder'));
      expect((await rows(c, g.userId)).filter(r => r.field === 'coffee_feeling').length).toBe(1);
    });
  });

  it('Liam\'s field list carries the codes, the kitchen labels and aliases, and the words form', () => {
    const list = brew.formatBrewProfileFieldList();
    expect(list).toContain('usual_drink');
    expect(list).toContain('americano_milk');
    expect(list).toContain('kirkland (Kirkland Signature (Costco) / costco)');
    expect(list).toContain('cupboard_coffee=other|<their words>');
    expect(list).toContain('coffee_feeling (one; may be asked when empty): happy, bolder, gentler, different');
  });

  it('ask when empty: once, never on the first message, only on its topic, never when the field has a value', () => {
    expect(brew.getAskWhenEmptyNudge({}, 'my_coffee', [], 1)).toBeNull();
    const first = brew.getAskWhenEmptyNudge({}, 'my_coffee', [], 2);
    expect(first?.field).toBe('usual_drink');
    expect(brew.getAskWhenEmptyNudge({}, 'my_coffee', ['usual_drink', 'cupboard_coffee', 'coffee_feeling'], 3)).toBeNull();
    expect(brew.getAskWhenEmptyNudge({}, 'brewing', [], 3)).toBeNull();
    const known = { usual_drink: { value: ['latte'], source: 'profile_page' as const, capturedAt: new Date().toISOString() } };
    expect(brew.getAskWhenEmptyNudge(known, 'my_coffee', [], 3)?.field).toBe('cupboard_coffee');
  });
});

describe('the purge guard (A8, D13; Dana 2026-11-12: the empty-guest rule only)', () => {
  it('a guest with a brew-profile row and no quiz is kept; one without the row is a candidate; a stale-quiz guest stays identity-only', async () => {
    await withRollback(async ({ client: c }) => {
      // The test DB holds far fewer candidates than the purge's batch size, so
      // this test's guests are in the lists without touching anyone else's rows
      // (a mass update here deadlocked the parallel household suite).
      const kept = await guest(c, { quiz: false, createdDaysAgo: 30 });
      await record.brewProfileChange({ userId: kept.userId, source: 'onsite', sourceId: `t-${randomUUID()}`, field: 'grinder', op: 'set', value: JSON.stringify('blade') }, c);
      const empty = await guest(c, { quiz: false, createdDaysAgo: 30 });
      const staleWithFacts = await guest(c, { quizDaysAgo: 91 });
      await recordPostResultCard({ uid: staleWithFacts.uid, quizSessionId: staleWithFacts.sessionId, shown: CARD, answers: [] }, c);
      const cands = await staleGuestCandidates(c);
      expect(cands.empty).not.toContain(kept.uid);
      expect(cands.empty).toContain(empty.uid);
      expect(cands.identityOnly).toContain(staleWithFacts.uid);
      expect(cands.keptForFacts).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('funnel events and grants (A3b, A6)', () => {
  it('the three card events insert against quiz_funnel_event_type; an unknown event is dropped, never an error', async () => {
    await withRollback(async ({ client: c }) => {
      const key = `zzz-ud1-${randomUUID()}`;
      for (const e of ['post_result_shown', 'post_result_saved', 'post_result_skipped']) expect(await logFunnelEvent(key, e, null, undefined, undefined, c)).toBe(true);
      expect(await logFunnelEvent(key, 'post_result_exploded', null, undefined, undefined, c)).toBe(false);
      const n = (await c.query(`SELECT event FROM quiz_funnel_event WHERE session_key = $1 ORDER BY event`, [key])).rows.map(r => r.event);
      expect(n).toEqual(['post_result_saved', 'post_result_shown', 'post_result_skipped']);
    });
  });

  it('as ab_app, INSERT into brew_drink, brew_cupboard_brand, brew_coffee_feeling and brew_profile_field_value is denied; brew_card_view_event keeps its INSERT', async () => {
    const r = await db.query<{ t: string; ins: boolean }>(
      `SELECT t, has_table_privilege('ab_app', t, 'INSERT') AS ins FROM unnest($1::text[]) t`,
      [['brew_drink', 'brew_cupboard_brand', 'brew_coffee_feeling', 'brew_profile_field_value', 'brew_card_view_event']]);
    expect(Object.fromEntries(r.rows.map(x => [x.t, x.ins]))).toEqual({
      brew_drink: false, brew_cupboard_brand: false, brew_coffee_feeling: false, brew_profile_field_value: false, brew_card_view_event: true,
    });
  });
});
