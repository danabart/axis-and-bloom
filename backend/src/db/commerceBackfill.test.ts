// Commerce 5 (2026-11-18), Part C: rehearse migrations/commerce_2026_11_17_stripe_mode.sql
// on the test DB inside one rolled-back transaction (its BEGIN/COMMIT stripped):
// every pre-cutover order gets test, the known live order live (on prod; it is
// not on the test DB), the NOT NULL takes, and a second run changes nothing.
// A NULL order newer than the cutover is not guessed: the NOT NULL fails.
import 'dotenv/config';
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { db } from './client.js';
import { withRollback } from '../test/withRollback.js';

const SQL = readFileSync(fileURLToPath(new URL('./migrations/commerce_2026_11_17_stripe_mode.sql', import.meta.url)), 'utf8')
  .replace(/^\s*BEGIN;\s*$/m, '').replace(/^\s*COMMIT;\s*$/m, '');

afterAll(async () => { await db.end(); });

describe('commerce_2026_11_17_stripe_mode.sql', () => {
  it('sets a mode on every pre-cutover order, makes the column NOT NULL, and is idempotent', async () => {
    await withRollback(async ({ client }) => {
      // Other test files commit fixture orders (dated now, no mode) while this runs; the
      // migration rightly refuses to guess those. Prod has none newer than the cutover
      // (CLOSING_REPORT_5 Task 0: six orders, all before it), so lock the table and mark
      // the concurrent fixtures test here, inside the rolled-back transaction, to rehearse the prod shape.
      await client.query(`LOCK TABLE "order" IN SHARE ROW EXCLUSIVE MODE`);
      const fixtures = (await client.query(
        `UPDATE "order" SET stripe_mode = 'test' WHERE stripe_mode IS NULL AND created_at >= '2026-11-17 17:35:00+00'`)).rowCount;
      const nullsBefore = Number((await client.query(`SELECT COUNT(*) FROM "order" WHERE stripe_mode IS NULL`)).rows[0].count);
      await client.query(SQL);
      const after = (await client.query(`SELECT stripe_mode, COUNT(*)::int AS n FROM "order" GROUP BY 1 ORDER BY 1`)).rows;
      expect(after.find(r => r.stripe_mode === null)).toBeUndefined();
      expect((await client.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'order' AND column_name = 'stripe_mode'`)).rows[0].is_nullable).toBe('NO');
      const snapshot = JSON.stringify(after);
      await client.query(SQL); // second run: no change
      expect(JSON.stringify((await client.query(`SELECT stripe_mode, COUNT(*)::int AS n FROM "order" GROUP BY 1 ORDER BY 1`)).rows)).toBe(snapshot);
      console.log(`[commerceBackfill.test] test DB: ${fixtures} concurrent fixture(s) marked test; ${nullsBefore} order(s) without a mode before; after: ${snapshot}`);
    });
  });

  it('refuses to guess: a NULL order newer than the cutover makes the NOT NULL fail', async () => {
    await withRollback(async ({ client }) => {
      const user = (await client.query<{ id: string }>(`SELECT id FROM user_profile LIMIT 1`)).rows[0].id;
      await client.query(`INSERT INTO "order" (user_id, created_at) VALUES ($1, '2026-11-18T00:00:00Z')`, [user]);
      await expect(client.query(SQL)).rejects.toThrow(/stripe_mode|null/i);
    });
  });
});
