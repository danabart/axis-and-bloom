// Liam L3, Part B — runs against axisandbloom_test (vitest.config.ts +
// src/test/guard.ts refuse anything else). Every test's writes live inside a
// transaction rolled back in afterEach, same pattern as customerFacts.test.ts.
//
// Task 0 disclosed deviation: the brief asks for these cases in
// sommelier.test.ts, but that file only ever unit-tests exported pure
// functions from sommelier.ts directly (never the HTTP handlers — no
// supertest/route-invocation pattern exists in this codebase), and always
// mocks customerFacts.js wholesale. recordTurn()/recordReplyForOpenQuestion()
// need the real customer_liam_* tables and record.*()'s real idempotency
// behavior to mean anything, so they're tested here, at the liamWriteBack.ts
// level, against the real test database — exactly the same behaviors the
// brief lists (marked pick, unmarked detection, unresolved alias, ask →
// reply, idempotency), just at the module boundary this codebase actually
// tests services at.
import 'dotenv/config';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PoolClient } from 'pg';
import { db } from '../db/client.js';
import { record } from './customerFacts.js';
import {
  resolveAlias, detectAliases, extractQuestion, recordTurn, recordReplyForOpenQuestion,
  type AliasCandidate,
} from './liamWriteBack.js';

let client: PoolClient;
beforeEach(async () => { client = await db.connect(); await client.query('BEGIN'); });
afterEach(async () => { try { await client.query('ROLLBACK'); } finally { client.release(); } });

async function makeUser(): Promise<{ uid: string; profileId: string }> {
  const uid = `vitest-liamwb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const r = await client.query(`INSERT INTO user_profile (firebase_uid) VALUES ($1) RETURNING id`, [uid]);
  return { uid, profileId: r.rows[0].id };
}

async function makeSession(uid: string): Promise<number> {
  const r = await client.query(
    `INSERT INTO sommelier_sessions (uid, intent) VALUES ($1, 'MATCHED') RETURNING id`,
    [uid]
  );
  return r.rows[0].id;
}

async function twoCoffeeIds(): Promise<[number, number]> {
  const r = await client.query(`SELECT id FROM coffees ORDER BY id LIMIT 2`);
  if (r.rows.length < 2) throw new Error('need at least 2 coffee rows in the test database');
  return [r.rows[0].id, r.rows[1].id];
}

describe('resolveAlias', () => {
  it('matches exactly, case-insensitive and trimmed', () => {
    const candidates: AliasCandidate[] = [{ coffeeId: 1, alias: 'Crosshatch' }, { coffeeId: 2, alias: 'Uganda' }];
    expect(resolveAlias('  crosshatch  ', candidates)).toBe(1);
    expect(resolveAlias('UGANDA', candidates)).toBe(2);
  });

  it('never fuzzy-matches a near-miss', () => {
    const candidates: AliasCandidate[] = [{ coffeeId: 1, alias: 'Crosshatch' }];
    expect(resolveAlias('Cross Hatch', candidates)).toBeNull();
    expect(resolveAlias('Crosshatc', candidates)).toBeNull();
  });
});

describe('detectAliases', () => {
  it('finds every candidate present as a whole word, in order of appearance', () => {
    const candidates: AliasCandidate[] = [{ coffeeId: 1, alias: 'Crosshatch' }, { coffeeId: 2, alias: 'Uganda' }];
    expect(detectAliases('Try the Uganda, or if you want brighter, the Crosshatch.', candidates))
      .toEqual([2, 1]);
  });

  it('does not match a substring inside another word', () => {
    const candidates: AliasCandidate[] = [{ coffeeId: 1, alias: 'Uganda' }];
    expect(detectAliases('The Ugandan region is known for this.', candidates)).toEqual([]);
  });
});

describe('extractQuestion', () => {
  it('returns the last sentence ending in "?"', () => {
    expect(extractQuestion('Crosshatch. That is where I would land. Lighter or similar?'))
      .toBe('Lighter or similar?');
  });

  it('falls back to the whole reply trimmed to 300 chars when there is no question', () => {
    expect(extractQuestion('Just a statement, no question here.')).toBe('Just a statement, no question here.');
    expect(extractQuestion('x'.repeat(400))).toHaveLength(300);
  });
});

describe('recordTurn — recommendation', () => {
  it('a marked pick writes one row with detected=false', async () => {
    const { uid, profileId } = await makeUser();
    const sessionId = await makeSession(uid);
    const [coffeeId] = await twoCoffeeIds();
    const candidates: AliasCandidate[] = [{ coffeeId, alias: 'Crosshatch' }];

    await recordTurn({
      uid, sessionId, turn: 2, assistantMessageId: 'msg-1', reply: 'Crosshatch. That is where I would land.',
      recommendAlias: 'Crosshatch', askKind: null, candidates, candidateCoffeeIds: [coffeeId],
      exploreArchetypeCode: null,
    }, client);

    const rows = (await client.query(
      `SELECT coffee_id, detected, candidate_coffee_ids FROM customer_liam_recommendation WHERE user_id = $1`,
      [profileId]
    )).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].coffee_id).toBe(coffeeId);
    expect(rows[0].detected).toBe(false);
  });

  it('an unmarked mention writes a row with detected=true, one per alias found', async () => {
    const { uid, profileId } = await makeUser();
    const sessionId = await makeSession(uid);
    const [coffeeIdA, coffeeIdB] = await twoCoffeeIds();
    const candidates: AliasCandidate[] = [{ coffeeId: coffeeIdA, alias: 'Crosshatch' }, { coffeeId: coffeeIdB, alias: 'Uganda' }];

    await recordTurn({
      uid, sessionId, turn: 3, assistantMessageId: 'msg-2', reply: 'The Crosshatch or the Uganda would both work.',
      recommendAlias: null, askKind: null, candidates, candidateCoffeeIds: [coffeeIdA, coffeeIdB],
      exploreArchetypeCode: null,
    }, client);

    const rows = (await client.query(
      `SELECT coffee_id, detected FROM customer_liam_recommendation WHERE user_id = $1 ORDER BY coffee_id`,
      [profileId]
    )).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.detected === true)).toBe(true);
  });

  it('an unresolved alias marker writes no row', async () => {
    const { uid, profileId } = await makeUser();
    const sessionId = await makeSession(uid);
    const [coffeeId] = await twoCoffeeIds();
    const candidates: AliasCandidate[] = [{ coffeeId, alias: 'Crosshatch' }];

    await recordTurn({
      uid, sessionId, turn: 4, assistantMessageId: 'msg-3', reply: 'Something else entirely.',
      recommendAlias: 'Nonexistent Coffee', askKind: null, candidates, candidateCoffeeIds: [coffeeId],
      exploreArchetypeCode: null,
    }, client);

    const rows = (await client.query(`SELECT id FROM customer_liam_recommendation WHERE user_id = $1`, [profileId])).rows;
    expect(rows).toHaveLength(0);
  });

  it('idempotent: re-running the same turn writes nothing new', async () => {
    const { uid, profileId } = await makeUser();
    const sessionId = await makeSession(uid);
    const [coffeeId] = await twoCoffeeIds();
    const candidates: AliasCandidate[] = [{ coffeeId, alias: 'Crosshatch' }];
    const turnParams = {
      uid, sessionId, turn: 5, assistantMessageId: 'msg-4', reply: 'Crosshatch it is.',
      recommendAlias: 'Crosshatch', askKind: null as 'thread' | 'palate' | 'brew' | null, candidates, candidateCoffeeIds: [coffeeId],
      exploreArchetypeCode: null,
    };

    await recordTurn(turnParams, client);
    await recordTurn(turnParams, client);

    const rows = (await client.query(`SELECT id FROM customer_liam_recommendation WHERE user_id = $1`, [profileId])).rows;
    expect(rows).toHaveLength(1);
  });
});

describe('recordTurn — question, and recordReplyForOpenQuestion — reply', () => {
  it('an <<ask>> writes a question row and returns the new open-question state', async () => {
    const { uid, profileId } = await makeUser();
    const sessionId = await makeSession(uid);

    const result = await recordTurn({
      uid, sessionId, turn: 2, assistantMessageId: 'msg-ask', reply: 'What do you usually brew with?',
      recommendAlias: null, askKind: 'brew', candidates: [], candidateCoffeeIds: [],
      exploreArchetypeCode: null,
    }, client);

    expect(result).not.toBeNull();
    expect(result!.openQuestionTurn).toBe(2);

    const rows = (await client.query(
      `SELECT kind, question, archetype_code FROM customer_liam_question WHERE user_id = $1`,
      [profileId]
    )).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('brew');
    expect(rows[0].question).toBe('What do you usually brew with?');
    expect(rows[0].archetype_code).toBeNull();
  });

  it('a turn with no <<ask>> returns null (leaves any existing open question alone)', async () => {
    const { uid } = await makeUser();
    const sessionId = await makeSession(uid);

    const result = await recordTurn({
      uid, sessionId, turn: 3, assistantMessageId: 'msg-noask', reply: 'Just a plain reply.',
      recommendAlias: null, askKind: null, candidates: [], candidateCoffeeIds: [],
      exploreArchetypeCode: null,
    }, client);

    expect(result).toBeNull();
  });

  it('the next message records a reply row and signals the question should clear', async () => {
    const { uid, profileId } = await makeUser();
    const sessionId = await makeSession(uid);

    const asked = await recordTurn({
      uid, sessionId, turn: 2, assistantMessageId: 'msg-ask2', reply: 'What do you usually brew with?',
      recommendAlias: null, askKind: 'brew', candidates: [], candidateCoffeeIds: [],
      exploreArchetypeCode: null,
    }, client);

    const cleared = await recordReplyForOpenQuestion({
      uid, sessionId, openQuestionId: asked!.openQuestionId, openQuestionTurn: asked!.openQuestionTurn,
      message: 'V60, usually.', userMessageId: 'msg-reply1',
    }, client);

    expect(cleared).toBe(true);
    const rows = (await client.query(
      `SELECT reply FROM customer_liam_reply WHERE user_id = $1 AND question_id = $2`,
      [profileId, asked!.openQuestionId]
    )).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].reply).toBe('V60, usually.');
  });

  it('v_palate_threads shows answered once the reply is recorded', async () => {
    const { uid } = await makeUser();
    const sessionId = await makeSession(uid);

    const asked = await recordTurn({
      uid, sessionId, turn: 2, assistantMessageId: 'msg-ask3', reply: 'What do you usually brew with?',
      recommendAlias: null, askKind: 'brew', candidates: [], candidateCoffeeIds: [],
      exploreArchetypeCode: null,
    }, client);
    await recordReplyForOpenQuestion({
      uid, sessionId, openQuestionId: asked!.openQuestionId, openQuestionTurn: asked!.openQuestionTurn,
      message: 'French press.', userMessageId: 'msg-reply2',
    }, client);

    const rows = (await client.query(
      `SELECT status, reply FROM v_palate_threads WHERE question_id = $1`,
      [asked!.openQuestionId]
    )).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('answered');
    expect(rows[0].reply).toBe('French press.');
  });

  it('no open question means no reply row and cleared=false', async () => {
    const { uid } = await makeUser();
    const sessionId = await makeSession(uid);
    const cleared = await recordReplyForOpenQuestion({
      uid, sessionId, openQuestionId: null, openQuestionTurn: null,
      message: 'Random message.', userMessageId: 'msg-x',
    }, client);
    expect(cleared).toBe(false);
  });
});

describe('Part C — action clicks', () => {
  // POST /:sessionId/action (routes/sommelier.ts) calls record.liamAction()
  // directly with a sourceId built from `${sessionId}:${messageId}:${actionType}`
  // — deterministic per link, so two clicks on the same link produce the same
  // sourceId and insertFact()'s ON CONFLICT DO NOTHING (already generically
  // proven in customerFacts.test.ts) takes it from there.
  it('two clicks on the same link write one row', async () => {
    const { uid, profileId } = await makeUser();
    const sessionId = await makeSession(uid);
    const sourceId = `${sessionId}:msg-click:open_dial`;
    const input = {
      userId: profileId, source: 'liam' as const, sourceId, sessionId, messageId: 'msg-click',
      actionType: 'open_dial' as const,
    };

    const first = await record.liamAction(input, client);
    const second = await record.liamAction(input, client);

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    const rows = (await client.query(`SELECT id FROM customer_liam_action WHERE user_id = $1`, [profileId])).rows;
    expect(rows).toHaveLength(1);
  });
});
