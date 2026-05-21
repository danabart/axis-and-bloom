import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  await db.query(sql);
  console.log('Migration complete.');
  await db.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
