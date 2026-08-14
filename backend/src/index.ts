import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from './db/client.js';
import { getRealClientIp } from './middleware/clientIp.js';
import { appCheckGate } from './middleware/appCheck.js';
import { apiEventLog } from './middleware/apiEventLog.js';

import authRouter from './routes/auth.js';
import quizRouter from './routes/quiz.js';
import shopRouter from './routes/shop.js';
import ordersRouter from './routes/orders.js';
import usersRouter from './routes/users.js';
import newsletterRouter from './routes/newsletter.js';
import adminRouter from './routes/admin.js';
import coffeesRouter from './routes/coffees.js';
import householdRouter from './routes/household.js';
import axisRouter from './routes/axis.js';
import sommelierRouter from './routes/sommelier.js';
import tokensRouter from './routes/tokens.js';
import cronRouter from './routes/cron.js';
import companyGiftsAdminRouter from './routes/companyGiftsAdmin.js';
import companyGiftRedemptionRouter from './routes/companyGiftRedemption.js';
import companiesAdminRouter from './routes/companiesAdmin.js';
import qrRouter from './routes/qr.js';
import beatsRouter from './routes/beats.js';
import { initSommelierConfig } from './services/sommelierConfig.js';
import { runQuizIntegrityChecks } from './services/quizIntegrity.js';

const app = express();
const PORT = process.env.PORT ?? 4000;

app.set('trust proxy', 1);
app.use(helmet());
// C12 (L5) — prod domains hardcoded explicitly, not only present via the
// FRONTEND_URL env var (which could be unset and silently fall through to
// the localhost default below even in production). NODE_ENV=production is
// set in the Dockerfile's runner stage, so production never sees the
// localhost fallback at all; dev/local keeps it (plus whatever
// FRONTEND_URL is set to) for local testing against the real prod origins
// too.
const prodOrigins = [
  'https://www.axisandbloomcoffee.com',
  'https://axisandbloomcoffee.com',
  'https://axis-and-bloom-prod.web.app',
  'https://axis-and-bloom-prod.firebaseapp.com',
];
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? prodOrigins
  : [...prodOrigins, process.env.FRONTEND_URL ?? 'http://localhost:5173'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
// C17 — keyed on the real visitor IP (see middleware/clientIp.ts), not
// req.ip directly: behind Cloudflare -> Firebase Hosting -> Cloud Run,
// req.ip alone collapses every visitor onto a shared Google-internal
// address (finding M11).
//
// max/windowMs are env-configurable, no redeploy needed to retune. This is
// a coarse backstop, not the real abuse guard — a shared IP (mobile CGNAT,
// office/cafe NAT) can legitimately carry many real customers at once, and
// a low ceiling here means "failed to load" for all of them over one bad
// actor (or, in practice, over nothing at all — just normal multi-user
// traffic through one address). The actual abuse guards are the per-route
// limiters (sommelierIpLimiter, sommelierAccountLimiter, checkDailyCap, the
// auth/guest limiters) — untouched by this, and where a real per-user/
// per-account ceiling belongs. Default raised from 200 to 2000 for exactly
// that reason.
const GLOBAL_RATE_LIMIT_MAX = Number(process.env.GLOBAL_RATE_LIMIT_MAX ?? 2000);
const GLOBAL_RATE_LIMIT_WINDOW_MS = Number(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000);
app.use(rateLimit({ windowMs: GLOBAL_RATE_LIMIT_WINDOW_MS, max: GLOBAL_RATE_LIMIT_MAX, keyGenerator: getRealClientIp }));

// Prevent browsers and CDNs from caching any API response
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// C6 — App Check verification. Monitoring mode by default (APP_CHECK_ENFORCED
// unset/false): never blocks, only logs pass/fail. Exempts /api/cron/*,
// /api/webhooks/*, and /health internally — see middleware/appCheck.ts.
app.use(appCheckGate);

// api_event_log -- capture-first API event log (2026-08-13). Mounted once,
// here, so every current and future /api router is captured with zero
// per-route work. See middleware/apiEventLog.ts and
// backend/src/features/api_event_log/CLAUDE_CODE_PROMPT_API_EVENT_LOG.md.
app.use(apiEventLog);

app.use('/api/auth', authRouter);
app.use('/api/quiz', quizRouter);
app.use('/api/shop', shopRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/users', usersRouter);
app.use('/api/newsletter', newsletterRouter);
app.use('/api/admin', adminRouter);
app.use('/api/coffees', coffeesRouter);
app.use('/api/household', householdRouter);
app.use('/api/axis', axisRouter);
app.use('/api/sommelier', sommelierRouter);
app.use('/api/tokens', tokensRouter);
app.use('/api/cron', cronRouter);
app.use('/api/webhooks', cronRouter);
app.use('/api/admin/company-gifts', companyGiftsAdminRouter);
app.use('/api/company-gift-redemption', companyGiftRedemptionRouter);
app.use('/api/admin/companies', companiesAdminRouter);
app.use('/api/qr', qrRouter);
app.use('/api/beats', beatsRouter);

async function start() {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schema = readFileSync(join(__dirname, 'db', 'schema.sql'), 'utf-8');
    await db.query(schema);
    console.log('DB schema verified');
  } catch (err) {
    console.error('DB migration error (non-fatal):', err);
  }

  try {
    await initSommelierConfig();
  } catch (err) {
    console.error('Sommelier config init error (non-fatal):', err);
  }

  // Quiz Content Drift Prevention — fire-and-log only. A degraded quiz beats
  // a down site: never throws, never blocks startup, just surfaces failing
  // checks in the deploy logs so they're visible without anyone having to
  // remember to open the admin page.
  try {
    const report = await runQuizIntegrityChecks();
    if (!report.allPass) {
      for (const check of report.checks.filter(c => !c.pass)) {
        console.warn(`[quiz-integrity] check #${check.id} failed — ${check.name}: expected ${check.expected}, got ${check.actual}`);
      }
    }
  } catch (err) {
    console.error('Quiz integrity check error (non-fatal):', err);
  }

  app.listen(PORT, () => console.log(`Axis & Bloom API running on port ${PORT}`));
}

start();
