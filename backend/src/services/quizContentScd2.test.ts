// Prompt 4A — quiz questions and answers are SCD Type 2 (2026-10-08).
// Runs against axisandbloom_test only (vitest.config.ts + src/test/guard.ts). The database now refuses
// DELETE on quiz content, so nothing here could ever be cleaned up afterwards: every test runs inside one
// transaction that is ROLLED BACK in afterEach. The request pool `db` is wrapped so its `query` goes to
// that transaction while a test runs, which lets the real GET /api/quiz routes, the real scorer and the
// real integrity checks see the uncommitted versions without any of them being changed for the test.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { PoolClient } from 'pg';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

const tx = vi.hoisted(() => ({ client: null as null | { query: (...args: any[]) => any } }));
vi.mock('../db/client.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../db/client.js')>();
  const db = new Proxy(real.db, {
    get(target, prop) {
      if (prop === 'query' && tx.client) return tx.client.query.bind(tx.client);
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ...real, db };
});

import { db } from '../db/client.js';
import quizRouter from '../routes/quiz.js';
import { scoreAnswerIds } from './quizScorer.js';
import { runQuizIntegrityChecks } from './quizIntegrity.js';

let server: Server;
let base: string;
let client: PoolClient;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/quiz', quizRouter);
  server = await new Promise<Server>(res => { const s = app.listen(0, () => res(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>(res => server.close(() => res())); });

beforeEach(async () => {
  client = await db.connect();
  await client.query('BEGIN');
  tx.client = client;
});
afterEach(async () => {
  tx.client = null;
  try { await client.query('ROLLBACK'); } finally { client.release(); }
});

const one = async <T = any>(sql: string, params: unknown[] = []): Promise<T> => (await client.query(sql, params)).rows[0];
const all = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> => (await client.query(sql, params)).rows;

async function answer(code: string) {
  return one(`SELECT * FROM quiz_answer WHERE answer_code = $1 AND is_current`, [code]);
}
async function archetypeId(name: string): Promise<string> {
  return (await one(`SELECT id FROM coffee_archetype WHERE name = $1`, [name])).id;
}
async function activeQuizId(): Promise<string> {
  return (await one(`SELECT id FROM quiz WHERE is_active AND parent_quiz_id IS NULL`)).id;
}
async function getJson(path: string) {
  const res = await fetch(`${base}${path}`);
  expect(res.status).toBe(200);
  return res.json() as Promise<any>;
}
// Every row of quiz content (all versions), as text, for byte-for-byte before/after comparisons.
async function contentFingerprint() {
  return one(`SELECT
    (SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) FROM quiz_question t) AS questions,
    (SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) FROM quiz_answer t) AS answers,
    (SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) FROM quiz_answer_archetype_score t) AS scores,
    (SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) FROM quiz t) AS quizzes`);
}
async function expectRaises(sql: string, params: unknown[], message: RegExp) {
  await client.query('SAVEPOINT guard');
  await expect(client.query(sql, params)).rejects.toThrow(message);
  await client.query('ROLLBACK TO SAVEPOINT guard');
}

describe('migration: re-applying schema.sql is a no-op for quiz content', { timeout: 180_000 }, () => {
  it('inserts nothing, closes nothing, changes no id or byte (inside a rolled-back transaction)', async () => {
    const before = await contentFingerprint();
    const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
    await client.query(schema);
    expect(await contentFingerprint()).toEqual(before);
  });

  // Since Prompt 4B (2026-10-09) the seed has really versioned content (Earthy stem + four branch answers), so
  // these check the SCD2 invariants rather than "nothing was ever closed".
  it('rows from before SCD2 are dated from their quiz; every closed row has exactly one current successor', async () => {
    expect(await one(`SELECT COUNT(*)::int AS n FROM quiz_question qq JOIN quiz qz ON qz.id = qq.quiz_id
                      JOIN quiz_backup_20261008_quiz_question b ON b.id = qq.id
                      WHERE qq.valid_from <> qz.created_at`)).toEqual({ n: 0 });
    expect(await one(`SELECT COUNT(*)::int AS n FROM quiz_answer a WHERE NOT a.is_current AND a.answer_code IS NOT NULL
                      AND (SELECT COUNT(*) FROM quiz_answer c WHERE c.answer_code = a.answer_code AND c.is_current) <> 1`)).toEqual({ n: 0 });
    expect(await one(`SELECT COUNT(*)::int AS n FROM quiz_question q WHERE NOT q.is_current
                      AND (SELECT COUNT(*) FROM quiz_question c WHERE c.quiz_id = q.quiz_id AND c.q_number = q.q_number AND c.is_current) <> 1`)).toEqual({ n: 0 });
    // the six main questions were never re-versioned: their current order is still the old ORDER BY id
    const misordered = await all(`SELECT answer_code FROM (
        SELECT a.answer_code, a.sort_order, row_number() OVER (PARTITION BY a.question_id ORDER BY a.id) AS by_id
        FROM quiz_answer a JOIN quiz_backup_20261008_quiz_answer b ON b.id = a.id
        WHERE a.answer_code LIKE 'v7_q%' AND a.is_current) x WHERE sort_order <> by_id`);
    expect(misordered).toEqual([]);
  });

  it('snapshot tables: every pre-SCD2 row is still live and byte-identical in its original columns', async () => {
    const cols: Record<string, string> = {
      quiz: 'id, version, description, is_active, created_at, quiz_type_id, trigger_archetype_id, parent_quiz_id',
      quiz_question: 'id, quiz_id, q_number, q_text, weight',
      quiz_answer: 'id, question_id, answer_text, next_question_id, resulting_archetype_id, vector_impact, weight, is_experimental_gate, answer_code',
      quiz_answer_archetype_score: 'id, answer_id, question_id, archetype_id, score',
    };
    for (const [t, c] of Object.entries(cols)) {
      const r = await one(`SELECT (SELECT COUNT(*) FROM quiz_backup_20261008_${t})::int AS snap,
                                  (SELECT COUNT(*) FROM quiz_backup_20261008_${t} s
                                    WHERE NOT EXISTS (SELECT 1 FROM ${t} l WHERE row(${c.split(', ').map(x => 'l.' + x).join(', ')})
                                                                       IS NOT DISTINCT FROM row(${c.split(', ').map(x => 's.' + x).join(', ')})))::int AS changed`);
      expect(r.snap, t).toBeGreaterThan(0);
      // quiz rows are not versioned and quiz.description may be re-asserted; only content tables must be untouched
      if (t !== 'quiz') expect(r.changed, t).toBe(0);
    }
  });
});

describe('seed functions: asserting unchanged content is a no-op', () => {
  it('quiz_assert_question / quiz_assert_answer / quiz_assert_answer_score return the current id and write nothing', async () => {
    const before = await contentFingerprint();
    const q1 = await one(`SELECT * FROM quiz_question WHERE quiz_id = $1 AND q_number = 1 AND is_current`, [await activeQuizId()]);
    const a = await answer('v7_q1_a');
    expect((await one(`SELECT quiz_assert_question($1, 1, $2, $3) AS id`, [q1.quiz_id, q1.q_text, q1.weight])).id).toBe(q1.id);
    expect((await one(`SELECT quiz_assert_answer('v7_q1_a', $1, $2, $3, $4, $5) AS id`,
      [a.question_id, a.answer_text, a.resulting_archetype_id, a.is_experimental_gate, a.sort_order])).id).toBe(a.id);
    expect((await one(`SELECT quiz_assert_answer_score('v7_q1_a', $1, 1) AS id`, [await archetypeId('Chocolate & Nutty')])).id).toBe(a.id);
    expect(await contentFingerprint()).toEqual(before);
  });
});

describe('rewording an answer', () => {
  it('closes the old row intact, inserts a current successor with the score copied; /questions serves it in the same position; the old id still scores', async () => {
    const old = await answer('v7_q1_a');
    const cn = await archetypeId('Chocolate & Nutty');
    const before = await getJson('/api/quiz/questions');
    const q1Before = before.questions.find((q: any) => q.q_number === 1);
    const position = q1Before.answers.findIndex((x: any) => x.id === old.id);
    expect(position).toBeGreaterThanOrEqual(0);
    const oldScore = await scoreAnswerIds([old.id]);

    const newId = (await one(`SELECT quiz_assert_answer('v7_q1_a', $1, 'A reworded ritual answer.', $2, false, $3) AS id`,
      [old.question_id, cn, old.sort_order])).id;
    expect(newId).not.toBe(old.id);

    const oldRow = await one(`SELECT * FROM quiz_answer WHERE id = $1`, [old.id]);
    expect(oldRow).toMatchObject({ is_current: false, answer_text: old.answer_text, answer_code: 'v7_q1_a', sort_order: old.sort_order });
    expect(oldRow.valid_to).not.toBeNull();
    const newRow = await one(`SELECT * FROM quiz_answer WHERE id = $1`, [newId]);
    expect(newRow).toMatchObject({ is_current: true, valid_to: null, answer_text: 'A reworded ritual answer.',
      answer_code: 'v7_q1_a', question_id: old.question_id, sort_order: old.sort_order });
    expect(new Date(newRow.valid_from).getTime()).toBe(new Date(oldRow.valid_to).getTime());

    const scores = await all(`SELECT answer_id, archetype_id, score::float AS score FROM quiz_answer_archetype_score
                              WHERE answer_id = ANY($1::uuid[]) ORDER BY answer_id = $2`, [[old.id, newId], newId]);
    expect(scores).toEqual([
      { answer_id: old.id, archetype_id: cn, score: 1 },
      { answer_id: newId, archetype_id: cn, score: 1 },
    ]);

    const after = await getJson('/api/quiz/questions');
    const q1After = after.questions.find((q: any) => q.q_number === 1);
    expect(q1After.answers.map((x: any) => x.id)).toEqual(
      q1Before.answers.map((x: any) => (x.id === old.id ? newId : x.id)));
    expect(q1After.answers[position]).toMatchObject({ id: newId, text: 'A reworded ritual answer.' });
    expect(after.questions.filter((q: any) => q.q_number !== 1)).toEqual(before.questions.filter((q: any) => q.q_number !== 1));

    expect(await scoreAnswerIds([old.id])).toEqual(oldScore);
    expect(await scoreAnswerIds([newId])).toEqual(oldScore);
  });

  it('a sort_order change alone is a new version too', async () => {
    const old = await answer('v7_q2_a');
    const newId = (await one(`SELECT quiz_assert_answer('v7_q2_a', $1, $2, $3, $4, 9) AS id`,
      [old.question_id, old.answer_text, old.resulting_archetype_id, old.is_experimental_gate])).id;
    expect(newId).not.toBe(old.id);
    expect(await one(`SELECT is_current, sort_order FROM quiz_answer WHERE id = $1`, [old.id])).toEqual({ is_current: false, sort_order: old.sort_order });
    const q2 = (await getJson('/api/quiz/questions')).questions.find((q: any) => q.q_number === 2);
    expect(q2.answers[q2.answers.length - 1].id).toBe(newId);
  });

  it('a different score is a new answer version; the old version keeps its score', async () => {
    const old = await answer('v7_q2_a');
    const cn = await archetypeId('Chocolate & Nutty');
    const newId = (await one(`SELECT quiz_assert_answer_score('v7_q2_a', $1, 5) AS id`, [cn])).id;
    expect(newId).not.toBe(old.id);
    expect(await one(`SELECT score::float AS s FROM quiz_answer_archetype_score WHERE answer_id = $1`, [old.id])).toEqual({ s: 2 });
    expect(await one(`SELECT score::float AS s FROM quiz_answer_archetype_score WHERE answer_id = $1`, [newId])).toEqual({ s: 5 });
    expect((await scoreAnswerIds([old.id])).scores).toEqual({ 'Chocolate & Nutty': 2 });
    expect((await scoreAnswerIds([newId])).scores).toEqual({ 'Chocolate & Nutty': 5 });
  });

  it('a branch answer reworded: /branch serves the new id in the same position', async () => {
    const old = await answer('v7_branch_cn_earthy');
    const choc = await archetypeId('Chocolate & Nutty');
    const before = await getJson(`/api/quiz/branch?archetypeId=${choc}`);
    const newId = (await one(`SELECT quiz_assert_answer('v7_branch_cn_earthy', $1, 'Deep, intense, reworded.', $2, false, $3) AS id`,
      [old.question_id, old.resulting_archetype_id, old.sort_order])).id;
    const after = await getJson(`/api/quiz/branch?archetypeId=${choc}`);
    expect(after.branchQuestion.questionId).toBe(before.branchQuestion.questionId);
    expect(after.branchQuestion.answers.map((x: any) => x.id)).toEqual(
      before.branchQuestion.answers.map((x: any) => (x.id === old.id ? newId : x.id)));
  });
});

describe('rewording a question', () => {
  it('re-versions every current answer onto the new question row; old answer ids still lead to the old stem and still score', async () => {
    const quizId = await activeQuizId();
    const oldQ = await one(`SELECT * FROM quiz_question WHERE quiz_id = $1 AND q_number = 3 AND is_current`, [quizId]);
    const oldAnswers = await all(`SELECT * FROM quiz_answer WHERE question_id = $1 AND is_current ORDER BY sort_order`, [oldQ.id]);
    expect(oldAnswers).toHaveLength(3);
    const oldScores = await Promise.all(oldAnswers.map(a => scoreAnswerIds([a.id])));
    const oldScoreRows = (await one(`SELECT COUNT(*)::int AS n FROM quiz_answer_archetype_score WHERE question_id = $1`, [oldQ.id])).n;

    const newQId = (await one(`SELECT quiz_assert_question($1, 3, 'A reworded black coffee question?', $2) AS id`, [quizId, oldQ.weight])).id;
    expect(newQId).not.toBe(oldQ.id);
    expect(await one(`SELECT is_current, q_text FROM quiz_question WHERE id = $1`, [oldQ.id])).toEqual({ is_current: false, q_text: oldQ.q_text });

    const newAnswers = await all(`SELECT * FROM quiz_answer WHERE question_id = $1 AND is_current ORDER BY sort_order`, [newQId]);
    expect(newAnswers.map(a => [a.answer_code, a.answer_text, a.sort_order, a.resulting_archetype_id, a.is_experimental_gate]))
      .toEqual(oldAnswers.map(a => [a.answer_code, a.answer_text, a.sort_order, a.resulting_archetype_id, a.is_experimental_gate]));
    expect(newAnswers.every(a => !oldAnswers.some(o => o.id === a.id))).toBe(true);
    expect(await one(`SELECT COUNT(*)::int AS n FROM quiz_answer WHERE question_id = $1 AND is_current`, [oldQ.id])).toEqual({ n: 0 });
    expect(await one(`SELECT COUNT(*)::int AS n FROM quiz_answer_archetype_score WHERE question_id = $1`, [newQId])).toEqual({ n: oldScoreRows });

    // an old answer id still joins to the stem the person saw
    expect(await one(`SELECT qq.q_text FROM quiz_answer a JOIN quiz_question qq ON qq.id = a.question_id WHERE a.id = $1`,
      [oldAnswers[0].id])).toEqual({ q_text: oldQ.q_text });
    for (const [i, a] of oldAnswers.entries()) expect(await scoreAnswerIds([a.id])).toEqual(oldScores[i]);
    for (const [i, a] of newAnswers.entries()) expect(await scoreAnswerIds([a.id])).toEqual(oldScores[i]);

    const q3 = (await getJson('/api/quiz/questions')).questions.find((q: any) => q.q_number === 3);
    expect(q3.question_id).toBe(newQId);
    expect(q3.q_text).toBe('A reworded black coffee question?');
    expect(q3.answers.map((x: any) => x.id)).toEqual(newAnswers.map(a => a.id));

    const report = await runQuizIntegrityChecks();
    for (const id of [0, 3, 4, 5, 12, 13, 14, 15]) {
      expect(report.checks.find(c => c.id === id)?.pass, `check ${id}`).toBe(true);
    }
  });
});

describe('the database refuses in-place edits and deletes', () => {
  it('UPDATE of answer_text, DELETE of an answer, and TRUNCATE all raise', async () => {
    const a = await answer('v7_q1_b');
    await expectRaises(`UPDATE quiz_answer SET answer_text = 'edited in place' WHERE id = $1`, [a.id], /cannot be edited in place/);
    await expectRaises(`DELETE FROM quiz_answer WHERE id = $1`, [a.id], /never deleted/);
    await expectRaises(`TRUNCATE quiz_answer CASCADE`, [], /never deleted/);
    expect(await one(`SELECT answer_text FROM quiz_answer WHERE id = $1`, [a.id])).toEqual({ answer_text: a.answer_text });
  });

  it('UPDATE or DELETE of a question or a score row raises', async () => {
    const a = await answer('v7_q1_b');
    await expectRaises(`UPDATE quiz_question SET weight = 7 WHERE id = $1`, [a.question_id], /cannot be edited in place/);
    await expectRaises(`DELETE FROM quiz_question WHERE id = $1`, [a.question_id], /never deleted/);
    await expectRaises(`UPDATE quiz_answer_archetype_score SET score = 9 WHERE answer_id = $1`, [a.id], /never updated/);
    await expectRaises(`DELETE FROM quiz_answer_archetype_score WHERE answer_id = $1`, [a.id], /never deleted/);
  });

  it('retiring is the only allowed update, and a retired row never changes again', async () => {
    const id = (await one(`SELECT quiz_retire_answer('v7_q1_c') AS id`)).id;
    expect(await one(`SELECT is_current, valid_to IS NOT NULL AS closed FROM quiz_answer WHERE id = $1`, [id])).toEqual({ is_current: false, closed: true });
    await expectRaises(`UPDATE quiz_answer SET is_current = true, valid_to = NULL WHERE id = $1`, [id], /retired version/);
    // reported, never repaired: the code now has no current row
    const report = await runQuizIntegrityChecks();
    expect(report.checks.find(c => c.id === 13)?.details).toContain('v7_q1_c: 0 current row(s)');
  });

  it('a second current row for a business key is refused by the partial unique indexes', async () => {
    const a = await answer('v7_q1_b');
    await client.query('SAVEPOINT dup');
    await expect(client.query(
      `INSERT INTO quiz_answer (question_id, answer_text, answer_code, sort_order) VALUES ($1, 'dup', 'v7_q1_b', 1)`, [a.question_id]
    )).rejects.toMatchObject({ code: '23505', constraint: 'quiz_answer_code_current_unique' });
    await client.query('ROLLBACK TO SAVEPOINT dup');
    const q = await one(`SELECT quiz_id, q_number FROM quiz_question WHERE id = $1`, [a.question_id]);
    await expect(client.query(
      `INSERT INTO quiz_question (quiz_id, q_number, q_text) VALUES ($1, $2, 'dup')`, [q.quiz_id, q.q_number]
    )).rejects.toMatchObject({ code: '23505', constraint: 'quiz_question_current_unique' });
  });
});

describe('integrity checks on the unchanged test database', () => {
  it('the content and SCD2 checks pass (0–8, 12–18)', async () => {
    const report = await runQuizIntegrityChecks();
    for (const id of [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14, 15, 16, 17, 18]) {
      const check = report.checks.find(c => c.id === id);
      expect(check?.pass, `check ${id}: ${check?.actual} ${JSON.stringify(check?.details ?? [])}`).toBe(true);
    }
  });

  it('a stray score row is reported (checks 4 and 7), not removed', async () => {
    const q6 = await answer('v7_q6_a');
    const branch = await answer('v7_branch_fruity_stay');
    const fruity = await archetypeId('Fruity');
    await client.query(`INSERT INTO quiz_answer_archetype_score (answer_id, question_id, archetype_id, score) VALUES ($1, $2, $3, 1), ($4, $5, $3, 1)`,
      [q6.id, q6.question_id, fruity, branch.id, branch.question_id]);
    const report = await runQuizIntegrityChecks();
    expect(report.checks.find(c => c.id === 4)?.pass).toBe(false);
    expect(report.checks.find(c => c.id === 7)?.pass).toBe(false);
    expect(await one(`SELECT COUNT(*)::int AS n FROM quiz_answer_archetype_score WHERE answer_id = ANY($1::uuid[])`, [[q6.id, branch.id]])).toEqual({ n: 2 });
  });
});
