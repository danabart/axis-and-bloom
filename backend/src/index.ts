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
import { log } from './lib/logger.js';
import type { AuthRequest } from './middleware/auth.js';

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
import clientErrorsRouter from './routes/clientErrors.js';
import campaignRouter from './routes/campaign.js';
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
app.use('/api/client-errors', clientErrorsRouter);
app.use('/api/campaign', campaignRouter);

// Observability Foundation Part B -- central boundary handler, mounted AFTER
// every router so it only sees what Express itself routes here: a
// synchronous throw anywhere in the chain, or an error next()'d explicitly
// (route handlers still next(err) rather than throw for async paths --
// nothing here changes that). We run Express 4 (see backend/package.json):
// an async route handler's rejected promise does NOT reach this middleware
// automatically, so every route's own try/catch remains the primary net
// (already the case everywhere in this codebase) -- this middleware is the
// backstop for sync throws and body-parser errors (express.json() throws a
// SyntaxError with status 400 on malformed JSON, which lands here too).
// See OBSERVABILITY_POLICY.md's Express-version note.
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const uid = (req as AuthRequest).uid ?? null;
  log.error('[unhandled/' + req.path + ']', err instanceof Error ? err.message : String(err), {
    uid,
    stack: err instanceof Error ? err.stack : undefined,
  });
  const isBodyParseError = err?.type === 'entity.parse.failed' || err?.status === 400 || err instanceof SyntaxError;
  res.status(isBodyParseError ? 400 : 500).json({ error: 'Something went wrong' });
});

async function start() {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schema = readFileSync(join(__dirname, 'db', 'schema.sql'), 'utf-8');
    await db.query(schema);
    console.log('DB schema verified');
  } catch (err) {
    console.error('DB migration error (non-fatal):', err);
  }

  // Roastery lifecycle (2026-08-25) — schema.sql's roaster_id backfill just ran
  // above; surface any coffee it couldn't resolve (no roaster_blend link, and
  // no case/whitespace-insensitive match on coffees.roaster) rather than
  // silently leaving it unlinked. Never guesses — an admin has to link it.
  try {
    const unresolved = await db.query(
      `SELECT id, name, roaster FROM coffees WHERE roaster_id IS NULL ORDER BY id`
    );
    for (const row of unresolved.rows) {
      console.warn(`[roastery-lifecycle] coffee ${row.id} (${row.name}) still has no roaster_id — roaster text is ${row.roaster ?? '(null)'}`);
    }
  } catch (err) {
    console.error('Roastery lifecycle roaster_id check error (non-fatal):', err);
  }

  // Roastery lifecycle (CTO review round, 2026-08-26) — a roaster_blend row
  // whose roaster_id disagrees with its own coffee's roaster_id is exactly
  // the class of bug the tightened name-match backfill (schema.sql, ~L404)
  // now prevents going forward; this surfaces any such mismatch already in
  // prod (e.g. from before the tightening) rather than assuming it can't
  // happen. Never auto-fixed — an admin has to repoint it.
  try {
    const mismatched = await db.query(
      `SELECT rb.id AS blend_id, rb.blend_name, rb.coffee_id, rb.roaster_id AS blend_roaster_id,
              c.roaster_id AS coffee_roaster_id, c.name AS coffee_name
       FROM roaster_blend rb
       JOIN coffees c ON c.id = rb.coffee_id
       WHERE rb.roaster_id IS NOT NULL AND c.roaster_id IS NOT NULL AND rb.roaster_id <> c.roaster_id
       ORDER BY rb.id`
    );
    for (const row of mismatched.rows) {
      console.warn(`[roastery-lifecycle] roaster_blend ${row.blend_id} (${row.blend_name}) has roaster_id ${row.blend_roaster_id} but its coffee ${row.coffee_id} (${row.coffee_name}) has roaster_id ${row.coffee_roaster_id} — mismatched roastery, needs manual repoint`);
    }
  } catch (err) {
    console.error('Roastery lifecycle roaster_blend/coffee roaster_id mismatch check error (non-fatal):', err);
  }

  // Roastery lifecycle (CTO review round, 2026-08-26, second pass) — schema.sql's
  // coffees_active_natural_key index create is wrapped in DO/EXCEPTION so a
  // still-live (roaster_id, name) duplicate can't abort the rest of the
  // schema apply above; this is the actual "was it created" check. Originally
  // a RAISE WARNING inside that same DO block, but a PL/pgSQL RAISE WARNING
  // is a Postgres NOTICE-level protocol message — db.ts's pg.Pool has no
  // `.on('notice', ...)` listener, so it was silently dropped by
  // node-postgres and never reached this console or Cloud Logging at all.
  // A real JS query, same as the two checks above.
  try {
    const naturalKeyIndex = await db.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'coffees_active_natural_key'`
    );
    if (naturalKeyIndex.rows.length === 0) {
      console.warn('[roastery-lifecycle] coffees_active_natural_key NOT created — a live (roaster_id, name) duplicate still exists among active coffees; run the pending Colombia/Guatemala data-fix SQL, then this will succeed on the next boot');
    }
  } catch (err) {
    console.error('Roastery lifecycle coffees_active_natural_key check error (non-fatal):', err);
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

  // 2026-08-15 CRON_SECRET incident hardening — every version of the secret
  // silently carried a leading UTF-8 BOM (3 raw bytes, EF BB BF) from
  // whatever tool first wrote it, which decodes to a single U+FEFF char
  // once loaded into process.env. That char is invisible in consoles/paste
  // targets, isn't stripped by naive `tr -d '\r\n '`-style cleanup, and is
  // NOT what an HTTP header value round-trips to byte-for-byte — so
  // requireCronSecret's exact-string compare (backend/src/routes/cron.ts)
  // silently failed 401 no matter what value got pasted into Cloud
  // Scheduler's header. This would have surfaced in one log line at boot.
  // Deliberately does NOT auto-trim in requireCronSecret's own comparison
  // — masking config drift there is how this stayed hidden for weeks;
  // we want it loud instead. Lengths only, never the value itself.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.warn('[cron/secret-config]', 'CRON_SECRET is unset — every /api/cron/* route will 401', {});
  } else if (cronSecret !== cronSecret.trim()) {
    log.warn('[cron/secret-config]', 'CRON_SECRET has leading/trailing whitespace or a BOM — exact-match comparisons will fail', {
      rawLength: cronSecret.length,
      trimmedLength: cronSecret.trim().length,
    });
  }

  app.listen(PORT, () => console.log(`Axis & Bloom API running on port ${PORT}`));
}

start();
