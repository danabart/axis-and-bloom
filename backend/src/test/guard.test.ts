// Test database isolation (2026-09-16) — proves the wiring end to end from
// inside an actual test, not just globalSetup's own console output:
// DATABASE_URL really is the test database in this worker, and the two
// schema.sql applications globalSetup just ran left the catalog in a
// genuinely clean, integrity-passing state (not just "didn't throw").
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { runCatalogIntegrityChecks } from '../services/catalogIntegrity.js';

describe('test database isolation', () => {
  it('DATABASE_URL points at the test database', () => {
    const dbName = (process.env.DATABASE_URL ?? '').split('?')[0].split('/').pop();
    expect(dbName).toMatch(/_test$/);
  });

  it('globalSetup\'s two schema.sql applications left catalog integrity passing', async () => {
    const report = await runCatalogIntegrityChecks();
    expect(report.allPass).toBe(true);
  });
});
