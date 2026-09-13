import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL ?? '';
const isUnixSocket = connectionString.includes('host=/cloudsql/');

export const db = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' && !isUnixSocket ? { rejectUnauthorized: false } : false,
  max: 10,
});

// Catalog Blueprint · brief 1 (2026-09-13) — one shared transaction helper so
// new callers stop hand-rolling `db.connect()` + BEGIN/COMMIT/ROLLBACK. Does
// not migrate any existing call site — see
// backend/src/features/catalog_blueprint/CLAUDE_CODE_PROMPT_CATALOG_1_SCHEMA_VIEWS_INTEGRITY.md.
export type Tx = pg.PoolClient;
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}
