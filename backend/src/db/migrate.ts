import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ownerPool } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Customer Blueprint · brief C1, Part B (2026-09-27) — runs as the owner
// pool, same as index.ts's boot-time schema apply, so this script keeps
// working unchanged after the Part G cutover (ab_app cannot run DDL).
export async function migrate() {
  const owner = ownerPool();
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  await owner.query(sql);
  console.log('Migration complete.');
  await owner.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
