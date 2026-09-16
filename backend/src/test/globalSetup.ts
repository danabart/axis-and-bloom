// Test database isolation (2026-09-16) — runs once before the whole suite,
// in Vitest's own main process (not a worker), so `test.env` overrides
// haven't necessarily reached process.env here yet. We already know
// TEST_DATABASE_URL is set and validated (vitest.config.ts's own
// config-time guard threw before this file ever loads if not) — set
// DATABASE_URL from it explicitly, before importing anything that builds a
// DB pool at module load time (db/client.ts does exactly that), so every
// import in this process — including runCatalogIntegrityChecks() below —
// binds to the test database, not whatever DATABASE_URL happened to be.
//
// Applies schema.sql TWICE: this is deliberately the same "re-application
// must be a no-op" rehearsal every real deploy boot does, catching a class
// of bug that shipped to prod twice during Catalog Blueprint brief 5a
// before anyone thought to test it locally first (see WHAT_WE_BUILT.md
// #182 — the ON CONFLICT/NOT NULL ordering bug and the stray DROP INDEX
// bug, both idempotency-only failures a single apply can't catch).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

function locateFailingLine(sql: string, err: unknown): string | undefined {
  const position = (err as { position?: string })?.position;
  const pos = position ? Number(position) : undefined;
  if (!pos || Number.isNaN(pos)) return undefined;
  const lineNumber = sql.slice(0, pos).split('\n').length;
  return sql.split('\n')[lineNumber - 1]?.trim();
}

export default async function globalSetup(): Promise<void> {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

  const schemaPath = fileURLToPath(new URL('../db/schema.sql', import.meta.url));
  const schema = readFileSync(schemaPath, 'utf8');

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (let i = 1; i <= 2; i++) {
      try {
        await client.query(schema);
      } catch (err) {
        const line = locateFailingLine(schema, err);
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[globalSetup] schema.sql application #${i} failed${line ? ` at: ${line}` : ''} — ${message}`
        );
      }
    }
    console.log('[globalSetup] schema.sql applied twice with no error (re-application is a no-op).');
  } finally {
    await client.end();
  }

  // Information only — does not fail the run. A pre-existing data gap
  // (e.g. check 6's known "1 coffee missing archetype/roaster_id" finding)
  // is a real, separate concern, not a reason to block every test run.
  const { runCatalogIntegrityChecks } = await import('../services/catalogIntegrity.js');
  const report = await runCatalogIntegrityChecks();
  const failing = report.checks.filter(c => (c.severity ?? 'fail') === 'fail' && !c.pass);
  console.log(
    `[globalSetup] catalog integrity: ${report.allPass ? 'allPass' : `${failing.length} failing check(s)`}`
  );
}
