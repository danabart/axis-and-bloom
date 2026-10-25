// Liam brand answers brief Rev 3, Testing 2 + 3 (2026-10-24) —
// sommelierAnswerService (the one writer of sommelier_answer), the insert-only
// seed, and sommelierIntegrity's four checks. Every write runs inside a
// rolled-back transaction, so nothing is left in the test database.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { withRollback } from '../test/withRollback.js';
import { setAnswerInTx, retireAnswerInTx, SommelierAnswerError } from './sommelierAnswerService.js';
import { getCurrentAnswers, getAnswerHistory, hasAnyAnswer, type SommelierAnswerRow } from './sommelierReads.js';
import {
  runSommelierIntegrityChecks, answerContentViolations, loadAnswerVocabulary, type AnswerVocabulary,
} from './sommelierIntegrity.js';
import { seedSommelierAnswers, SEED_ANSWERS } from '../db/seeds/sommelier_answer_seed.js';

afterAll(async () => { await db.end(); });

const KEY = `zzz_test_${Date.now().toString(36)}`;
const BASE = { key: KEY, kind: 'brand', delivery: 'both', sortOrder: 99, createdBy: 'vitest' };

async function refusal(p: Promise<unknown>): Promise<SommelierAnswerError> {
  try { await p; } catch (err) { if (err instanceof SommelierAnswerError) return err; throw err; }
  throw new Error('expected a SommelierAnswerError, the write went through');
}

describe('sommelierAnswerService', () => {
  it('supersede keeps the old row with superseded_at and makes the new one current', async () => {
    await withRollback(async ({ client }) => {
      const first = await setAnswerInTx(client, { ...BASE, answerText: 'We pick partners with care.', expect: 'new' });
      expect(first.supersededId).toBeNull();
      const second = await setAnswerInTx(client, { key: KEY, answerText: 'We choose our partners with care.', note: 'tighter', createdBy: 'vitest', expect: 'edit' });
      expect(second.supersededId).toBe(first.id);
      const rows = (await getAnswerHistory(client)).filter(r => r.key === KEY);
      expect(rows).toHaveLength(2);
      const current = rows.filter(r => r.superseded_at === null);
      expect(current).toHaveLength(1);
      expect(current[0]).toMatchObject({ id: second.id, answer_text: 'We choose our partners with care.', kind: 'brand', delivery: 'both', sort_order: 99, note: 'tighter' });
      expect(rows.find(r => r.id === first.id)!.superseded_at).not.toBeNull();
      expect(rows.find(r => r.id === first.id)!.answer_text).toBe('We pick partners with care.');
    });
  });

  it('a second current row for a key is impossible (partial unique index), and POST of an existing key is refused', async () => {
    await withRollback(async ({ client, savepoint }) => {
      await setAnswerInTx(client, { ...BASE, answerText: 'One.', expect: 'new' });
      const err = await refusal(savepoint(() => setAnswerInTx(client, { ...BASE, answerText: 'Two.', expect: 'new' })));
      expect(err.status).toBe(409);
      // The raw insert the index exists for: test files may write SQL directly.
      await expect(savepoint(() => client.query(
        `INSERT INTO sommelier_answer (key, kind_id, delivery_id, answer_text, sort_order, created_by)
         SELECT key, kind_id, delivery_id, 'Raw second current row.', sort_order, 'vitest' FROM sommelier_answer
          WHERE key = $1 AND superseded_at IS NULL`, [KEY]
      ))).rejects.toThrow(/sommelier_answer_one_current/);
    });
  });

  it('refuses a roaster name, a $ amount, a size and a coffee alias, naming the rule', async () => {
    const roaster = (await db.query<{ name: string }>(`SELECT name FROM roaster WHERE name IS NOT NULL ORDER BY name LIMIT 1`)).rows[0];
    const vocab = await loadAnswerVocabulary();
    const alias = vocab.aliases.find(a => a.length > 3)!;
    expect(roaster, 'the test database has a roaster').toBeDefined();
    expect(alias, 'the test database has a coffee alias').toBeDefined();
    await withRollback(async ({ client, savepoint }) => {
      const cases: Array<[string, RegExp]> = [
        [`Roasted for us by ${roaster.name}.`, /rule 2 \(no roaster name\)/],
        ['A bag is $32.', /rule 3 \(no price, size or count\)/],
        ['Every bag is 12 oz.', /rule 3 \(no price, size or count\)/],
        ['We work with 4 roasteries.', /rule 3 \(no price, size or count\)/],
        [`Try the ${alias}.`, /rule 4 \(no coffee alias\)/],
      ];
      for (const [text, rule] of cases) {
        const err = await refusal(savepoint(() => setAnswerInTx(client, { ...BASE, answerText: text })));
        expect(err.status, text).toBe(400);
        expect(err.message, text).toMatch(rule);
      }
      expect((await getAnswerHistory(client)).filter(r => r.key === KEY)).toHaveLength(0);
    });
  });

  it('refuses empty text, an unknown kind or delivery, a bad key, and a new key without kind/delivery/order', async () => {
    await withRollback(async ({ client, savepoint }) => {
      expect((await refusal(savepoint(() => setAnswerInTx(client, { ...BASE, answerText: '   ' })))).message).toMatch(/empty/);
      expect((await refusal(savepoint(() => setAnswerInTx(client, { ...BASE, kind: 'rumour', answerText: 'Fine text.' })))).message).toMatch(/unknown sommelier_answer_kind 'rumour'/);
      expect((await refusal(savepoint(() => setAnswerInTx(client, { ...BASE, delivery: 'shout', answerText: 'Fine text.' })))).message).toMatch(/unknown sommelier_answer_delivery 'shout'/);
      expect((await refusal(savepoint(() => setAnswerInTx(client, { ...BASE, key: 'Bad Key', answerText: 'Fine text.' })))).message).toMatch(/snake_case/);
      expect((await refusal(savepoint(() => setAnswerInTx(client, { key: KEY, answerText: 'Fine text.', createdBy: 'vitest' })))).message).toMatch(/needs kind, delivery and sortOrder/);
      expect((await refusal(savepoint(() => setAnswerInTx(client, { key: KEY, answerText: 'Fine text.', createdBy: 'vitest', expect: 'edit' })))).status).toBe(404);
    });
  });

  it('retire leaves no current row and keeps the history', async () => {
    await withRollback(async ({ client, savepoint }) => {
      const { id } = await setAnswerInTx(client, { ...BASE, answerText: 'Soon gone.' });
      expect(await retireAnswerInTx(client, { key: KEY, createdBy: 'vitest' })).toEqual({ key: KEY, retiredId: id });
      expect((await getCurrentAnswers(client)).some(r => r.key === KEY)).toBe(false);
      expect((await getAnswerHistory(client)).filter(r => r.key === KEY)).toHaveLength(1);
      expect((await refusal(savepoint(() => retireAnswerInTx(client, { key: KEY, createdBy: 'vitest' })))).status).toBe(404);
    });
  });
});

describe('sommelier_answer seed', () => {
  it('inserts Dana\'s six rows, in order, only into an empty table, and never again', async () => {
    await withRollback(async ({ client }) => {
      // The test DB may already hold boot-seeded rows; start from empty inside the rollback.
      await client.query(`DELETE FROM sommelier_answer`); // rolled back below; nothing references this table
      expect(await hasAnyAnswer(client)).toBe(false);
      expect(await seedSommelierAnswers(client)).toBe(6);
      const rows = await getCurrentAnswers(client);
      expect(rows.map(r => r.key)).toEqual(['what_we_are', 'how_we_match', 'sourcing', 'partner_privacy', 'what_you_get', 'ordering']);
      expect(rows.map(r => r.answer_text)).toEqual(SEED_ANSWERS.map(a => a.text));
      expect(rows.every(r => r.created_by === 'seed')).toBe(true);
      expect(rows.find(r => r.key === 'partner_privacy')).toMatchObject({ kind: 'deflection', delivery: 'both' });
      expect(await seedSommelierAnswers(client)).toBe(0);
    });
  });
});

describe('sommelierIntegrity — fixtures', () => {
  const vocab: AnswerVocabulary = { roasterNames: ['Joe Coffee Company', 'Path Coffee Roasters'], aliases: ['Crosshatch', 'Cerro Azul'] };
  const row = (key: string, answer_text: string): SommelierAnswerRow => ({
    id: 1, key, kind: 'brand', delivery: 'both', answer_text, sort_order: 1, since: new Date(), superseded_at: null, note: null, created_by: 'vitest',
  });

  it('all four checks pass on clean text', async () => {
    const r = await runSommelierIntegrityChecks({ rows: [row('a', 'We do not roast. Our bags, their roasting.')], vocab });
    expect(r.allPass).toBe(true);
    expect(r.checks.map(c => c.id)).toEqual([1, 2, 3, 4]);
  });

  it('check 1 reports a key with two current rows', async () => {
    const r = await runSommelierIntegrityChecks({ rows: [row('a', 'One.'), row('a', 'Two.')], vocab });
    expect(r.checks.find(c => c.id === 1)!.pass).toBe(false);
    expect(r.checks.find(c => c.id === 1)!.details).toEqual(['a: 2 current rows']);
  });

  it('check 2 catches a roaster name, case-insensitive, whole words only', async () => {
    const r = await runSommelierIntegrityChecks({ rows: [row('a', 'roasted by joe coffee company'), row('b', 'a pathway')], vocab });
    expect(r.checks.find(c => c.id === 2)!.details).toEqual(['a: Joe Coffee Company']);
  });

  it('check 3 catches a $, oz, or a number beside a unit; one finding per answer', async () => {
    const r = await runSommelierIntegrityChecks({
      rows: [row('a', 'From $29.'), row('b', 'Coffee comes as 12 oz whole bean.'), row('c', 'Ships in 3 days.'), row('d', 'Six archetypes, one quiz.')],
      vocab,
    });
    const c3 = r.checks.find(c => c.id === 3)!;
    expect(c3.pass).toBe(false);
    expect(c3.details!.map(d => d.split(':')[0])).toEqual(['a', 'b', 'c']);
  });

  it('check 4 catches a coffee alias', async () => {
    const r = await runSommelierIntegrityChecks({ rows: [row('a', 'Try the Cerro Azul.')], vocab });
    expect(r.checks.find(c => c.id === 4)!.details).toEqual(['a: Cerro Azul']);
  });

  it('answerContentViolations is the same rule set the service enforces', () => {
    expect(answerContentViolations('We keep our partner roasteries private.', vocab)).toEqual([]);
    expect(answerContentViolations('Crosshatch, $30', vocab).map(v => v.rule).sort()).toEqual([3, 4]);
  });

  it('Dana\'s seed copy: only what_you_get breaks a rule (check 3, "12 oz"), reported, not blocked', async () => {
    const live = await loadAnswerVocabulary();
    const findings = SEED_ANSWERS.flatMap(a => answerContentViolations(a.text, live).map(v => `${a.key}:${v.rule}`));
    expect(findings).toEqual(['what_you_get:3']);
  });
});
