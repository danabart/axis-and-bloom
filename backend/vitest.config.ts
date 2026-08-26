import { defineConfig } from 'vitest/config';

// Every test file here hits the same live, shared Postgres instance (prod,
// via the Cloud SQL Auth Proxy — see axis_and_bloom_local_cloudsql_testing
// memory) — there is no isolated test database. fileParallelism: false so
// files run one at a time instead of racing each other's fixtures/sweeps
// against that one shared DB (found 2026-08-26: Vitest's default concurrent-
// file execution let one file's `afterAll` cleanup sweep delete another
// still-running file's fixture rows mid-test). A real per-run test database
// is tracked as a separate follow-up, not fixed here.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
