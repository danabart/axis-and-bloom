// Data catalog · brief 2, Part E (2026-10-16) — the boot check against the
// test database (axisandbloom_test; vitest.config.ts + test/guard.ts refuse
// anything else). Report only (Dana, 2026-10-16: no strict mode), so this
// asserts what the report says, not whether it would stop a boot:
//   check 1 and check 3: zero findings;
//   check 2: exactly the UNVERIFIED objects in comments.sql (84 on a full
//     prod clone; any present in comments.sql but missing from this DB are
//     left out, the same way applyCommentsSql skips them);
//   check 4: passes against a CATALOG.md rendered from this same database.
import 'dotenv/config';
import { execFile } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '../db/client.js';
import { applyCommentsSql, parseCommentsSql } from '../db/commentsFile.js';
import { runDataCatalogIntegrityChecks, formatDataCatalogLog } from './dataCatalogIntegrity.js';
import { fetchCatalogRows, fetchViewDependencies } from './dataCatalogQueries.js';
import { extractFirestoreBlock, renderCatalogMd } from './dataCatalogMd.js';

const execFileAsync = promisify(execFile);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'catalog-md-'));

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await db.end();
});

describe('runDataCatalogIntegrityChecks on the test database (report only)', () => {
  it('reports exactly what the dictionary says', async () => {
    const commentsSql = read('../db/comments.sql');
    await db.query(read('../db/schema.sql'));
    const { skipped } = await applyCommentsSql(db, commentsSql);

    const catalogMdPath = join(dir, 'CATALOG.md');
    const [rows, dependencies] = await Promise.all([fetchCatalogRows(db), fetchViewDependencies(db)]);
    writeFileSync(catalogMdPath, renderCatalogMd({
      rows, dependencies, firestoreBlock: extractFirestoreBlock(commentsSql),
      databaseName: 'axisandbloom_test', generatedOn: '2026-10-16',
    }));

    // Brief 3: a fresh lineage.json from the scanner (no DB), to a temp path.
    const lineagePath = join(dir, 'lineage.json');
    await execFileAsync('node', [fileURLToPath(new URL('../../scripts/lineage-scan.mjs', import.meta.url))], { env: { ...process.env, LINEAGE_OUT: lineagePath } });

    const report = await runDataCatalogIntegrityChecks({ runner: db, catalogMdPath, lineagePath });
    console.log(formatDataCatalogLog(report).join('\n'));
    const byId = (id: number) => report.checks.find(c => c.id === id)!;

    expect(report.checks.map(c => c.severity)).toEqual(['info', 'info', 'info', 'info', 'info', 'info']);
    // check 5 (one writer): the same set match CI enforces, zero undeclared
    expect(byId(5).details).toEqual([]);
    expect(report.lineage.available).toBe(true);
    expect(report.lineage.multiWriter.map(m => m.table)).toContain('user_profile');
    // check 6 lists at least every static dead candidate from lineage.json
    const staticDead = JSON.parse(readFileSync(lineagePath, 'utf8')).findings.dead_candidates as string[];
    for (const t of staticDead) expect(byId(6).details!.some(d => d.startsWith(`${t} (`))).toBe(true);
    expect(byId(1).details).toEqual([]);
    expect(byId(3).details).toEqual([]);

    const skippedSet = new Set(skipped);
    const expectedUnverified = parseCommentsSql(commentsSql)
      .filter(s => s.text.startsWith('UNVERIFIED'))
      .map(s => (s.column === undefined ? s.relation : `${s.relation}.${s.column}`))
      .filter(name => !skippedSet.has(name));
    expect([...byId(2).details!].sort()).toEqual(expectedUnverified.sort());
    if (skipped.length === 0) expect(byId(2).details!.length).toBe(0);

    expect(byId(4).pass).toBe(true);
    expect(byId(4).actual).toBe('hash match');
    expect(report.catalogMdStale).toBe(false);
  }, 180_000);

  it('reports CATALOG.md stale when the file does not match, and skipped when there is none', async () => {
    const stalePath = join(dir, 'STALE.md');
    writeFileSync(stalePath, `stale\n\ncatalog-hash: ${'0'.repeat(64)}\n`);
    const stale = await runDataCatalogIntegrityChecks({ runner: db, catalogMdPath: stalePath, lineagePath: null });
    expect(stale.checks[3].actual).toBe('CATALOG.md stale');
    expect(stale.catalogMdStale).toBe(true);

    const none = await runDataCatalogIntegrityChecks({ runner: db, catalogMdPath: null, lineagePath: null });
    expect(none.checks[4].actual).toMatch(/^skipped/); // check 5 with no lineage.json
    expect(none.checks[3].pass).toBe(true);
    expect(none.checks[3].actual).toMatch(/^skipped/);
  }, 120_000);
});
