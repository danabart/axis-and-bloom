// Catalog Blueprint · brief 1 (2026-09-13) — proves withTransaction() actually
// rolls back on a throw. Requires DATABASE_URL pointed at a reachable Postgres
// instance (see schema.roastery_lifecycle.test.ts for the convention this
// follows: fixtures prefixed `Vitest`, cleaned up regardless of outcome).
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { db, withTransaction } from './client.js';

describe('withTransaction', () => {
  it('rolls back an insert when fn throws', async () => {
    const name = 'Vitest Transaction Rollback Roastery';
    await expect(
      withTransaction(async (tx) => {
        await tx.query(`INSERT INTO roaster (name, is_active) VALUES ($1, true)`, [name]);
        throw new Error('Vitest deliberate rollback');
      })
    ).rejects.toThrow('Vitest deliberate rollback');

    const { rows } = await db.query(`SELECT id FROM roaster WHERE name = $1`, [name]);
    expect(rows.length).toBe(0);
  });

  it('commits an insert when fn succeeds', async () => {
    const name = 'Vitest Transaction Commit Roastery';
    try {
      const inserted = await withTransaction(async (tx) => {
        const result = await tx.query<{ id: string }>(
          `INSERT INTO roaster (name, is_active) VALUES ($1, true) RETURNING id`,
          [name]
        );
        return result.rows[0];
      });
      expect(inserted).toBeDefined();

      const { rows } = await db.query(`SELECT id FROM roaster WHERE name = $1`, [name]);
      expect(rows.length).toBe(1);
    } finally {
      await db.query(`DELETE FROM roaster WHERE name = $1`, [name]);
    }
  });
});
