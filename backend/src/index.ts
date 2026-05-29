import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from './db/client.js';

import authRouter from './routes/auth.js';
import quizRouter from './routes/quiz.js';
import shopRouter from './routes/shop.js';
import agentRouter from './routes/agent.js';
import ordersRouter from './routes/orders.js';
import usersRouter from './routes/users.js';
import newsletterRouter from './routes/newsletter.js';
import adminRouter from './routes/admin.js';

const app = express();
const PORT = process.env.PORT ?? 4000;

app.use(helmet());
const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:5173',
  'https://axis-and-bloom-prod.web.app',
  'https://axis-and-bloom-prod.firebaseapp.com',
];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/health/db', async (_req, res) => {
  try {
    const r = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    res.json({ connected: true, tableCount: r.rows.length, tables: r.rows.map((x: any) => x.tablename) });
  } catch (e: any) {
    res.status(500).json({ connected: false, error: e.message });
  }
});

// Diagnostic: show actual column types for cupping_sessions in the live DB
app.get('/health/session-cols', async (_req, res) => {
  try {
    const r = await db.query(`
      SELECT column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'cupping_sessions'
      ORDER BY ordinal_position
    `);
    res.json(r.rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/quiz', quizRouter);
app.use('/api/shop', shopRouter);
app.use('/api/agent', agentRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/users', usersRouter);
app.use('/api/newsletter', newsletterRouter);
app.use('/api/admin', adminRouter);

async function start() {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schema = readFileSync(join(__dirname, 'db', 'schema.sql'), 'utf-8');
    await db.query(schema);
    console.log('DB schema verified');
  } catch (err) {
    console.error('DB migration error (non-fatal):', err);
  }

  app.listen(PORT, () => console.log(`Axis & Bloom API running on port ${PORT}`));
}

start();
