import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL ?? '';
const isUnixSocket = connectionString.includes('host=/cloudsql/');

export const db = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' && !isUnixSocket ? { rejectUnauthorized: false } : false,
  max: 10,
});

// Customer Blueprint · brief C1, Part B (2026-09-27) — the owner/app pool
// split. `db` above stays exactly as it is: it becomes the ab_app request
// pool the moment DATABASE_URL points at ab_app (Part G cutover). Until
// then, OWNER_DATABASE_URL is unset and ownerPool() falls back to the same
// DATABASE_URL `db` already uses, so schema apply and backfills keep working
// unchanged in every environment that hasn't cut over yet.
export const ownerConnectionString = process.env.OWNER_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const isOwnerUnixSocket = ownerConnectionString.includes('host=/cloudsql/');

export function ownerPool(): pg.Pool {
  return new Pool({
    connectionString: ownerConnectionString,
    ssl: process.env.NODE_ENV === 'production' && !isOwnerUnixSocket ? { rejectUnauthorized: false } : false,
    max: 2,
  });
}

export async function whoAmI(runner: pg.Pool | pg.PoolClient): Promise<string> {
  const result = await runner.query<{ current_user: string }>('SELECT current_user');
  return result.rows[0].current_user;
}

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
