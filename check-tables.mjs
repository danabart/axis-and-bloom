import pg from './backend/node_modules/pg/lib/index.js';
const { Client } = pg;

const client = new Client({
  host: '35.223.155.186',
  port: 5432,
  database: 'axisandbloom',
  user: 'axisbloom',
  password: 'AxBloomApp2026#!',
  ssl: { rejectUnauthorized: false }
});

await client.connect();
const res = await client.query(
  "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
);
console.log(`Tables found: ${res.rows.length}`);
res.rows.forEach(r => console.log(' -', r.tablename));
await client.end();
