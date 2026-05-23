import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL ?? '';
const isUnixSocket = connectionString.includes('host=/cloudsql/');

export const db = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' && !isUnixSocket ? { rejectUnauthorized: false } : false,
  max: 10,
});
