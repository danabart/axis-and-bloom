// Cupping evidence brief 1 (2026-10-18), C2 — the house helper for a test that
// must leave nothing behind: runs fn on one client inside BEGIN and always
// ROLLBACKs. Use it for evidence-table tests (cupping_* rows are immutable, so
// a committed fixture could never be cleaned up) and anything else that
// writes rows a later test would count. `savepoint` lets a test assert that a
// statement fails and keep using the same transaction afterwards.
import type pg from 'pg';
import { db } from '../db/client.js';

export interface RollbackTx {
  client: pg.PoolClient;
  /** Runs fn inside a SAVEPOINT; on error rolls back to it and rethrows, so the outer transaction stays usable. */
  savepoint<T>(fn: () => Promise<T>): Promise<T>;
}

let n = 0;
export async function withRollback<T>(fn: (tx: RollbackTx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const savepoint = async <S>(inner: () => Promise<S>): Promise<S> => {
      const name = `sp_${++n}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const out = await inner();
        await client.query(`RELEASE SAVEPOINT ${name}`);
        return out;
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        throw err;
      }
    };
    return await fn({ client, savepoint });
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}
