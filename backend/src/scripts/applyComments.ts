// Data catalog · brief 1 (2026-10-16) — apply db/comments.sql by hand after
// a comment edit, without a deploy. Boot applies the same file on every
// start (index.ts, [db-comments]); this is only for "now, not next deploy".
//
// Usage:
//   npm run db:comments                              (refuses unless DATABASE_URL is axisandbloom_test)
//   npm run db:comments -- --expect-db axisandbloom  (production, through the proxy)
//
// Same --expect-db discipline as scripts/backfillQuizInterpretation.ts: the
// database name is checked from DATABASE_URL before connecting and again
// from current_database() after. Runs on the owner pool (COMMENT ON needs
// the object's owner). DATABASE_URL / OWNER_DATABASE_URL must be set in the
// shell before launching (db/client.ts reads them at import time).
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { ownerPool, ownerConnectionString } from '../db/client.js';
import { applyCommentsSql } from '../db/commentsFile.js';
import { findUncommentedObjects } from '../services/dataCatalogQueries.js';

const dbNameFromUrl = (url: string) => url.split('?')[0].split('/').pop() ?? '';

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--expect-db');
  const expectDb = i >= 0 ? args[i + 1] : 'axisandbloom_test';

  const urlDb = dbNameFromUrl(ownerConnectionString);
  if (urlDb !== expectDb) {
    console.error(`REFUSING: owner connection points at database '${urlDb || '(unset)'}', expected '${expectDb}'. Nothing was connected to.`);
    process.exit(3);
  }

  const pool = ownerPool();
  try {
    const cur = (await pool.query<{ d: string }>('SELECT current_database() AS d')).rows[0].d;
    if (cur !== expectDb) {
      console.error(`REFUSING: connected to '${cur}', expected '${expectDb}'. Nothing was written.`);
      process.exit(3);
    }
    const sql = readFileSync(fileURLToPath(new URL('../db/comments.sql', import.meta.url)), 'utf8');
    const { applied, skipped } = await applyCommentsSql(pool, sql);
    console.log(`[db-comments] applied ${applied} statements to ${cur}`);
    if (skipped.length) console.log(`[db-comments] skipped ${skipped.length} (object not in this database): ${skipped.join(', ')}`);
    const missing = await findUncommentedObjects(pool);
    console.log(`[db-comments] still uncommented: ${missing.length}${missing.length ? ' — ' + missing.map(m => m.object_name).join(', ') : ''}`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
