import 'dotenv/config';
import { defineConfig } from 'vitest/config';

// Test database isolation (2026-09-16) — every DB-backed test file used to
// hit prod directly (through the Cloud SQL Auth Proxy, same DATABASE_URL
// db/client.ts's pool is built from) — there was no isolated test database.
// On 2026-09-15 an interrupted run left 152 `Vitest%` fixture rows in prod;
// a later run's `afterAll` sweep happened to remove them, but that was luck,
// not a guarantee. Tests now run against a dedicated axisandbloom_test
// database (same Cloud SQL instance, cloned from prod on demand via
// `npm run test:db:refresh` — see backend/README.md). The two guards below
// (config-time here, worker-time in src/test/guard.ts) make it structurally
// impossible for `npm test` to run against anything whose database name
// doesn't end in `_test`, or that is the same database DATABASE_URL points
// at — belt and braces, since config-time and worker-time are genuinely
// different processes/contexts in Vitest.

function dbNameFromUrl(url: string): string {
  return url.split('?')[0].split('/').pop() ?? '';
}

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. npm test refuses to run without an isolated test database — ' +
    "set TEST_DATABASE_URL in .env to something ending in '_test' (see .env.example)."
  );
}

const testDbName = dbNameFromUrl(TEST_DATABASE_URL);
const prodDbName = dbNameFromUrl(process.env.DATABASE_URL ?? '');

if (!testDbName.endsWith('_test')) {
  throw new Error(
    `TEST_DATABASE_URL's database ('${testDbName}') does not end in '_test'. ` +
    'Refusing to run — npm test must never point at a database that could be prod.'
  );
}
if (prodDbName && testDbName === prodDbName) {
  throw new Error(
    `TEST_DATABASE_URL and DATABASE_URL both point at the same database ('${testDbName}'). ` +
    'Refusing to run — this is exactly the prod-collision this isolation exists to prevent.'
  );
}

export default defineConfig({
  test: {
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
    },
    globalSetup: './src/test/globalSetup.ts',
    setupFiles: ['./src/test/guard.ts'],
  },
});
