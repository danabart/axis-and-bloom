// Test database isolation (2026-09-16) — worker-time half of the guard
// (config-time half lives in vitest.config.ts). Belt and braces: the
// config-time check runs once, in Vitest's main process, before any worker
// even starts; this one re-asserts inside every worker itself, right
// before that worker's test files run, so nothing between config
// evaluation and test execution can silently swap DATABASE_URL back to
// something unsafe.
const dbName = (process.env.DATABASE_URL ?? '').split('?')[0].split('/').pop() ?? '';

if (!dbName.endsWith('_test')) {
  throw new Error(
    `[guard] DATABASE_URL ('${dbName}') does not end in '_test' inside a test worker. ` +
    'Refusing to run — this should be impossible if vitest.config.ts\'s own guard ran; ' +
    'something bypassed it.'
  );
}
