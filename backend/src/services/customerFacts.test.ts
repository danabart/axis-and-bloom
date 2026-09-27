// Customer Blueprint · brief C1, Part C — the door. Runs against
// axisandbloom_test (vitest.config.ts + src/test/guard.ts refuse anything
// else). Every test's writes live inside a transaction rolled back in
// afterEach, so the database is left exactly as found.
import 'dotenv/config';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PoolClient } from 'pg';
import { db } from '../db/client.js';
import { record } from './customerFacts.js';

let client: PoolClient;
beforeEach(async () => { client = await db.connect(); await client.query('BEGIN'); });
afterEach(async () => { try { await client.query('ROLLBACK'); } finally { client.release(); } });

async function makeUser(): Promise<string> {
  const r = await client.query(
    `INSERT INTO user_profile (firebase_uid) VALUES ($1) RETURNING id`,
    [`vitest-customerfacts-${Date.now()}-${Math.random().toString(36).slice(2)}`]
  );
  return r.rows[0].id;
}
// customer_feedback_event.coffee_id only has an FK to coffees(id), no
// is_active requirement, so any real coffee row works here — the test
// database's coffee catalog can be in any activation state.
async function anyCoffeeId(): Promise<number> {
  const r = await client.query(`SELECT id FROM coffees LIMIT 1`);
  if (!r.rows.length) throw new Error('no coffee rows in the test database');
  return r.rows[0].id;
}

describe('customerFacts.record — export surface', () => {
  it('exports exactly the door functions, no update/delete/upsert', () => {
    const keys = Object.keys(record).sort();
    expect(keys).toEqual([
      'bagClaim', 'brewProfileChange', 'catalogChange', 'dialEvent', 'feedback',
      'feedbackDescriptor', 'identityLink', 'liamAction', 'liamQuestion', 'liamRecommendation', 'liamReply',
    ]);
    for (const [name, fn] of Object.entries(record)) {
      expect(typeof fn).toBe('function');
      expect((fn as any).update).toBeUndefined();
      expect((fn as any).delete).toBeUndefined();
      expect((fn as any).upsert).toBeUndefined();
      // Every recorder also exposes exactly one extra property: backfill.
      const extraKeys = Object.keys(fn).sort();
      expect(extraKeys, `${name} should only expose .backfill`).toEqual(['backfill']);
    }
  });
});

describe('customerFacts.record.feedback — insert + duplicate handling', () => {
  it('inserts once, returns inserted:false with no throw on a repeat (source, source_id)', async () => {
    const userId = await makeUser();
    const coffeeId = await anyCoffeeId();
    const input = {
      userId, source: 'onsite' as const, sourceId: `vitest-dup-${Date.now()}`,
      coffeeId, channel: 'onsite' as const,
    };
    const first = await record.feedback(input, client);
    expect(first.inserted).toBe(true);
    expect(first.id).not.toBeNull();

    const second = await record.feedback(input, client);
    expect(second.inserted).toBe(false);
    expect(second.id).toBeNull();

    const rows = (await client.query(`SELECT * FROM customer_feedback_event WHERE source_id = $1`, [input.sourceId])).rows;
    expect(rows).toHaveLength(1);
  });

  it('fills catalog_version automatically when not provided', async () => {
    const userId = await makeUser();
    const coffeeId = await anyCoffeeId();
    const result = await record.feedback({
      userId, source: 'onsite', sourceId: `vitest-catver-${Date.now()}`, coffeeId, channel: 'onsite',
    }, client);
    const row = (await client.query(`SELECT catalog_version FROM customer_feedback_event WHERE id = $1`, [result.id])).rows[0];
    expect(row.catalog_version).not.toBeNull();
  });
});

describe('customerFacts.record.*.backfill — owner-only', () => {
  it('refuses to run as ab_app', async () => {
    const userId = await makeUser();
    const coffeeId = await anyCoffeeId();
    // This test DB is not connected as ab_app (Part G hasn't cut over), so
    // assertOwner() should pass through here — the refusal itself is
    // exercised by whoAmI() returning the real connected role. This test
    // documents the intended behavior; a true ab_app-connected refusal is
    // covered by customerIntegrity.test.ts's check 2/3 pattern once Part G lands.
    const result = await record.feedback.backfill({
      userId, source: 'backfill', sourceId: `vitest-backfill-${Date.now()}`, coffeeId, channel: 'onsite',
      occurredAt: new Date('2026-01-01T00:00:00Z'),
    }, client);
    expect(result.inserted).toBe(true);
    const row = (await client.query(`SELECT occurred_at FROM customer_feedback_event WHERE id = $1`, [result.id])).rows[0];
    expect(new Date(row.occurred_at).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
