// Data catalog · brief 2, Part C (2026-10-16) — writes CATALOG.md at the
// repo root from the database named by DATABASE_URL. Read-only against the
// database.
//
// Usage:
//   npm run catalog:md                              (refuses unless DATABASE_URL is axisandbloom_test)
//   npm run catalog:md -- --expect-db axisandbloom  (production, through the proxy)
//   npm run catalog:md -- --out <path>              (write somewhere else)
//   npm run catalog:md -- --lineage <path>          (lineage.json elsewhere; default backend/lineage.json)
//   npm run catalog:md -- --force                   (rewrite even when both hashes match)
//
// Same --expect-db discipline as applyComments.ts. If the existing file's
// catalog-hash already equals the live one, the file is left untouched (no
// diff, not even the date), so regenerating without a schema or comment
// change is a no-op. Brief 3 adds a lineage-hash footer (static lineage +
// which tables are dead/active); a change in either hash rewrites the file.
// Activity is only rendered when generated from production (axisandbloom).
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { db } from '../db/client.js';
import { computeCatalogHash, fetchCatalogRows, fetchTableActivity, fetchViewDependencies, readCatalogMdHash, readLineageJson } from '../services/dataCatalogQueries.js';
import { extractFirestoreBlock, LINEAGE_HASH_FOOTER, lineageKey, renderCatalogMd } from '../services/dataCatalogMd.js';

const dbNameFromUrl = (url: string) => url.split('?')[0].split('/').pop() ?? '';

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const expectDb = arg('--expect-db') ?? 'axisandbloom_test';
  const out = arg('--out') ?? fileURLToPath(new URL('../../../CATALOG.md', import.meta.url));

  const urlDb = dbNameFromUrl(process.env.DATABASE_URL ?? '');
  if (urlDb !== expectDb) {
    console.error(`REFUSING: DATABASE_URL points at database '${urlDb || '(unset)'}', expected '${expectDb}'. Nothing was connected to.`);
    process.exit(3);
  }
  try {
    const cur = (await db.query<{ d: string }>('SELECT current_database() AS d')).rows[0].d;
    if (cur !== expectDb) {
      console.error(`REFUSING: connected to '${cur}', expected '${expectDb}'. Nothing was written.`);
      process.exit(3);
    }
    const [rows, dependencies] = await Promise.all([fetchCatalogRows(db), fetchViewDependencies(db)]);
    // Brief 3: lineage from backend/lineage.json (run `npm run lint:lineage`
    // first); activity only from production, never from another database.
    const lineagePath = arg('--lineage') ?? fileURLToPath(new URL('../../lineage.json', import.meta.url));
    const lineage = readLineageJson(lineagePath);
    if (!lineage) console.warn(`[catalog:md] ${lineagePath} not found; the Lineage section will say so. Run npm run lint:lineage first.`);
    const activity = cur === 'axisandbloom' ? await fetchTableActivity(db) : null;
    const hash = computeCatalogHash(rows);
    const lHash = lineageKey(lineage, activity);
    const existing = existsSync(out) ? readFileSync(out, 'utf8') : '';
    if (!args.includes('--force') && readCatalogMdHash(out) === hash && LINEAGE_HASH_FOOTER.exec(existing)?.[1] === lHash) {
      console.log(`[catalog:md] ${out} already matches ${cur} (catalog-hash ${hash.slice(0, 12)}, lineage-hash ${lHash.slice(0, 12)}); left untouched.`);
      return;
    }
    const commentsSql = readFileSync(fileURLToPath(new URL('../db/comments.sql', import.meta.url)), 'utf8');
    const md = renderCatalogMd({
      rows,
      dependencies,
      firestoreBlock: extractFirestoreBlock(commentsSql),
      databaseName: cur,
      generatedOn: new Date().toISOString().slice(0, 10),
      lineage,
      activity,
    });
    writeFileSync(out, md, 'utf8');
    const t = rows.filter(r => r.object_type === 'table').length;
    const v = rows.filter(r => r.object_type === 'view').length;
    const c = rows.filter(r => r.object_type === 'column').length;
    console.log(`[catalog:md] wrote ${out} from ${cur}: ${t} tables, ${v} views, ${c} columns, catalog-hash ${hash}`);
  } finally {
    await db.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
