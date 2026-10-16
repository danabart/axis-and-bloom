// Data catalog · brief 1, Part C (2026-10-16) — against the test database
// (axisandbloom_test; vitest.config.ts + test/guard.ts refuse anything
// else). Applies schema.sql then comments.sql, then asserts zero
// uncommented tables, views and table columns, using the same query brief
// 2's boot lint will use (services/dataCatalogQueries.ts).
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, it, expect, afterAll } from 'vitest';
import { db } from './client.js';
import { applyCommentsSql } from './commentsFile.js';
import { findUncommentedObjects } from '../services/dataCatalogQueries.js';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

afterAll(async () => {
  await db.end();
});

describe('comments.sql on the test database', () => {
  it('applies after schema.sql and leaves nothing uncommented', async () => {
    await db.query(read('schema.sql'));
    const { applied, skipped } = await applyCommentsSql(db, read('comments.sql'));
    expect(applied).toBeGreaterThan(0);
    if (skipped.length) console.log(`[comments.db.test] skipped (not in this database): ${skipped.join(', ')}`);
    expect(await findUncommentedObjects(db)).toEqual([]);
  }, 120_000);

  it('re-applying is a no-op (idempotent)', async () => {
    const first = await applyCommentsSql(db, read('comments.sql'));
    const second = await applyCommentsSql(db, read('comments.sql'));
    expect(second).toEqual(first);
  }, 120_000);
});
