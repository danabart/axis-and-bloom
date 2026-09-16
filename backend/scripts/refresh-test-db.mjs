#!/usr/bin/env node
// Test database isolation (2026-09-16), Part C. Clones prod into
// axisandbloom_test via Cloud SQL's own export/import (not local pg_dump/
// psql — neither is installed here, and this project's private Cloud SQL
// instance already has export/import built in): gcloud sql export sql to a
// short-lived object in the private axis-bloom-db-transfers bucket
// (uniform access, public-access-prevention enforced, IAM limited to the
// Cloud SQL instance's own service account + the project owner, 1-day
// deletion lifecycle rule as a backstop), DROP SCHEMA public CASCADE on the
// test database through the proxy, gcloud sql import sql from that same
// object into axisandbloom_test, then delete the object immediately — it
// is never left in the bucket. Run whenever prod schema or data has moved
// on — see backend/README.md's "Running tests" section.
//
// Same _test / no-collision guard as vitest.config.ts, re-checked here
// independently since this script runs standalone (npm run
// test:db:refresh), not through vitest — nothing about this guard can be
// assumed to have already run.
import 'dotenv/config';
import { spawnSync } from 'child_process';
import pg from 'pg';

const PROJECT = 'axis-and-bloom-prod';
const INSTANCE = 'axis-bloom-db';
const BUCKET = 'axis-bloom-db-transfers';
const PROD_DB = 'axisandbloom';
const TEST_DB = 'axisandbloom_test';

function dbNameFromUrl(url) {
  return url.split('?')[0].split('/').pop() ?? '';
}

function toolOnPath(tool) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, [tool], { stdio: 'ignore' }).status === 0;
}

function run(cmd, args) {
  // shell: true — on Windows, gcloud is a .cmd wrapper; spawnSync can't
  // exec those directly without going through a shell (fails silently
  // with no useful stderr otherwise). Safe here: every arg is either a
  // constant or a value this script built itself, never user input.
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, shell: true });
  return result;
}

const DATABASE_URL = process.env.DATABASE_URL;
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!DATABASE_URL) {
  console.error('[test:db:refresh] DATABASE_URL is not set.');
  process.exit(1);
}
if (!TEST_DATABASE_URL) {
  console.error('[test:db:refresh] TEST_DATABASE_URL is not set — see .env.example.');
  process.exit(1);
}

const prodDbName = dbNameFromUrl(DATABASE_URL);
const testDbName = dbNameFromUrl(TEST_DATABASE_URL);

if (!testDbName.endsWith('_test')) {
  console.error(
    `[test:db:refresh] TEST_DATABASE_URL's database ('${testDbName}') does not end in '_test'. ` +
    'Refusing to run — this script drops and recreates a schema; it must never be pointed at prod.'
  );
  process.exit(1);
}
if (testDbName === prodDbName) {
  console.error(
    `[test:db:refresh] TEST_DATABASE_URL and DATABASE_URL both point at '${testDbName}'. Refusing to run.`
  );
  process.exit(1);
}

if (!toolOnPath('gcloud')) {
  console.error(
    '[test:db:refresh] gcloud CLI not found on PATH. Install the Google Cloud SDK and run ' +
    '`gcloud auth login` (or ensure Application Default Credentials are set up), then re-run.'
  );
  process.exit(1);
}

const TABLES = ['coffees', 'coffee_slot_assignment', 'user_profile'];

async function countRows(connectionString, label) {
  const pool = new pg.Pool({ connectionString });
  const counts = {};
  try {
    for (const t of TABLES) {
      try {
        const { rows } = await pool.query(`SELECT COUNT(*) FROM ${t}`);
        counts[t] = rows[0].count;
      } catch {
        counts[t] = 'n/a (table does not exist yet)';
      }
    }
  } finally {
    await pool.end();
  }
  console.log(`[test:db:refresh] ${label}:`, counts);
  return counts;
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const objectPath = `test-db/${PROD_DB}-${timestamp}.sql`;
const gsUri = `gs://${BUCKET}/${objectPath}`;

console.log(`[test:db:refresh] Cloning '${prodDbName}' -> '${testDbName}' via Cloud SQL export/import (${gsUri})...`);

await countRows(TEST_DATABASE_URL, 'BEFORE (test db)');

console.log('[test:db:refresh] Exporting prod to GCS...');
const exportResult = run('gcloud', [
  'sql', 'export', 'sql', INSTANCE, gsUri,
  `--database=${PROD_DB}`, `--project=${PROJECT}`, '--quiet',
]);
if (exportResult.status !== 0) {
  const stderr = exportResult.stderr ?? '';
  console.error('[test:db:refresh] gcloud sql export failed:', stderr);
  if (/permission|forbidden|403/i.test(stderr)) {
    console.error(
      '[test:db:refresh] This looks like a missing bucket grant. The Cloud SQL instance\'s own ' +
      'service account needs write access to the bucket:\n' +
      `  gcloud storage buckets add-iam-policy-binding gs://${BUCKET} ` +
      `--member="serviceAccount:$(gcloud sql instances describe ${INSTANCE} --project=${PROJECT} ` +
      '--format="value(serviceAccountEmailAddress)")" --role="roles/storage.objectAdmin"\n' +
      'Have an owner/admin run that, then re-run this script.'
    );
  }
  process.exit(1);
}

// Wipe via gcloud sql databases delete+create, not a manual DROP SCHEMA/
// CREATE SCHEMA over the proxy — a schema created by the app's own DB role
// (axisbloom) is owned by that role, and Cloud SQL's import process then
// hits "permission denied for schema public" trying to touch a schema it
// doesn't own (caught live on the first refresh attempt). Recreating the
// database through the same gcloud path Part A used gives it back
// whatever default ownership Cloud SQL itself expects for import.
console.log('[test:db:refresh] Recreating the test database...');
const dropDb = run('gcloud', ['sql', 'databases', 'delete', TEST_DB, `--instance=${INSTANCE}`, `--project=${PROJECT}`, '--quiet']);
if (dropDb.status !== 0) {
  console.error('[test:db:refresh] gcloud sql databases delete failed:', dropDb.stderr ?? '');
  process.exit(1);
}
const createDb = run('gcloud', ['sql', 'databases', 'create', TEST_DB, `--instance=${INSTANCE}`, `--project=${PROJECT}`]);
if (createDb.status !== 0) {
  console.error('[test:db:refresh] gcloud sql databases create failed:', createDb.stderr ?? '');
  process.exit(1);
}

console.log('[test:db:refresh] Importing into the test database...');
const importResult = run('gcloud', [
  'sql', 'import', 'sql', INSTANCE, gsUri,
  `--database=${TEST_DB}`, `--project=${PROJECT}`, '--quiet',
]);
if (importResult.status !== 0) {
  console.error('[test:db:refresh] gcloud sql import failed:', importResult.stderr ?? '');
  console.error(
    `[test:db:refresh] The dump is still at ${gsUri} — delete it by hand once you've recovered ` +
    '(it holds real user data): ' + `gcloud storage rm ${gsUri}`
  );
  process.exit(1);
}

console.log('[test:db:refresh] Deleting the transient dump object...');
const rmResult = run('gcloud', ['storage', 'rm', gsUri]);
if (rmResult.status !== 0) {
  console.error(
    `[test:db:refresh] WARNING: failed to delete ${gsUri} — it holds real user data. ` +
    `Delete it by hand now: gcloud storage rm ${gsUri}`
  );
}

await countRows(TEST_DATABASE_URL, 'AFTER (test db)');

console.log('[test:db:refresh] Done. Run `npm test` next to apply schema.sql twice and run the suite.');
