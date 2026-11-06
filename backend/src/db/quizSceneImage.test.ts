// Website 7A (2026-11-06): quiz_question.image_asset_key on the test DB.
// The seed gives every current main-quiz question the scene of its q_number and
// every branch question the branch scene; the SCD2 guard lets a current row's
// NULL key be filled once and refuses any later change (text edits stay refused
// as before); GET /api/quiz/questions and /branch return the key. Guard cases run
// in rolled-back transactions (withRollback); the routes read the seeded data.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const { db } = await import('./client.js');
const { withRollback } = await import('../test/withRollback.js');
const { default: quizRouter } = await import('../routes/quiz.js');

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/quiz', quizRouter);
  server = await new Promise<Server>(res => { const s = app.listen(0, () => res(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>(res => server.close(() => res())); await db.end(); });

describe('quiz_question.image_asset_key (Website 7A)', () => {
  it('seeded: main-quiz questions take quiz/scene-q<n>, branch questions quiz/scene-branch', async () => {
    const main = (await db.query<{ q_number: number; image_asset_key: string | null }>(
      `SELECT q.q_number, q.image_asset_key FROM quiz_question q JOIN quiz z ON z.id = q.quiz_id
        WHERE z.version = 'v7' AND z.parent_quiz_id IS NULL AND q.is_current ORDER BY q.q_number`)).rows;
    expect(main.length).toBeGreaterThan(0);
    for (const r of main) expect(r.image_asset_key).toBe(`quiz/scene-q${r.q_number}`);
    const branch = (await db.query<{ image_asset_key: string | null }>(
      `SELECT q.image_asset_key FROM quiz_question q JOIN quiz b ON b.id = q.quiz_id JOIN quiz z ON z.id = b.parent_quiz_id
        WHERE z.version = 'v7' AND q.is_current`)).rows;
    expect(branch.length).toBeGreaterThan(0);
    expect(new Set(branch.map(r => r.image_asset_key))).toEqual(new Set(['quiz/scene-branch']));
  });

  it('the guard: a NULL key may be filled once; a set key, the text, and retired rows stay refused; no new version opens', async () => {
    await withRollback(async ({ client: c, savepoint }) => {
      const quizId = (await c.query<{ id: string }>(
        `INSERT INTO quiz (version, description, is_active) VALUES ('zzz-7a-test', 'Zzz 7A test', false) RETURNING id`)).rows[0].id;
      const qid = (await c.query<{ id: string }>(
        `INSERT INTO quiz_question (quiz_id, q_number, q_text) VALUES ($1, 1, 'Zzz question') RETURNING id`, [quizId])).rows[0].id;
      const versions = async () => Number((await c.query(`SELECT count(*) FROM quiz_question WHERE quiz_id = $1`, [quizId])).rows[0].count);

      await c.query(`UPDATE quiz_question SET image_asset_key = 'quiz/scene-q1' WHERE id = $1`, [qid]);
      expect((await c.query(`SELECT image_asset_key FROM quiz_question WHERE id = $1`, [qid])).rows[0].image_asset_key).toBe('quiz/scene-q1');
      expect(await versions()).toBe(1);

      await expect(savepoint(() => c.query(`UPDATE quiz_question SET image_asset_key = 'quiz/other' WHERE id = $1`, [qid])))
        .rejects.toThrow(/cannot be edited in place/);
      await expect(savepoint(() => c.query(`UPDATE quiz_question SET image_asset_key = NULL WHERE id = $1`, [qid])))
        .rejects.toThrow(/cannot be edited in place/);
      await expect(savepoint(() => c.query(`UPDATE quiz_question SET q_text = 'Changed' WHERE id = $1`, [qid])))
        .rejects.toThrow(/cannot be edited in place/);
      await expect(savepoint(() => c.query(`DELETE FROM quiz_question WHERE id = $1`, [qid])))
        .rejects.toThrow(/never deleted/);
      expect(await versions()).toBe(1);
    });
  });

  it('GET /api/quiz/questions and /branch return the key', async () => {
    const q = await (await fetch(`${base}/api/quiz/questions`)).json();
    expect(q.questions.length).toBeGreaterThan(0);
    for (const row of q.questions) expect(row.image_asset_key).toBe(`quiz/scene-q${row.q_number}`);
    const trigger = (await db.query<{ trigger_archetype_id: string }>(
      `SELECT b.trigger_archetype_id FROM quiz b JOIN quiz z ON z.id = b.parent_quiz_id
        WHERE z.version = 'v7' AND b.is_active AND b.trigger_archetype_id IS NOT NULL LIMIT 1`)).rows[0];
    const br = await (await fetch(`${base}/api/quiz/branch?archetypeId=${trigger.trigger_archetype_id}`)).json();
    expect(br.branchQuestion.imageAssetKey).toBe('quiz/scene-branch');
  });
});
