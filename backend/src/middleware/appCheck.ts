import type { Request, Response, NextFunction } from 'express';
import admin from '../services/firebase-admin.js';

// C6 — Firebase App Check, monitoring mode first (findings H2/M10). Also the
// actual remediation for C17's one documented residual gap: once enforced,
// a direct-to-*.run.app request with no valid App Check token is rejected
// before it ever reaches the rate limiter, closing the CF-Connecting-IP
// spoofing path — see clientIp.ts and WHAT_WE_BUILT_SECURITY.md entry 1.
//
// Reuses the existing initialized admin app (services/firebase-admin.ts) —
// no second admin.initializeApp() call, no new credential.
//
// APP_CHECK_ENFORCED (env, default 'false'):
//   false (monitoring) — verify a token if one is present and log pass/
//     fail, but NEVER block on a missing or invalid token. This is the
//     deploy-first mode: wire the frontend, watch real traffic verify
//     clean in the logs, only then flip the flag to enforce.
//   true (enforce) — missing/invalid token -> 401/403.
//
// Exemptions — checked before anything else, never verified or logged:
//   /api/cron/*, /api/webhooks/* — Cloud Scheduler and inbound webhooks
//     (Twilio, etc.) hit the *.run.app origin directly; there's no
//     browser/App-Check flow to attest at all. Already protected by
//     requireCronSecret (fails closed on its own). Enforcing App Check on
//     these would lock them out permanently, valid cron secret or not.
//   /health — Cloud Run's own uptime/health checks call with no App Check
//     context either.
const EXEMPT_PATH_PREFIXES = ['/api/cron', '/api/webhooks'];

function isExempt(path: string): boolean {
  if (path === '/health' || path.startsWith('/health/')) return true;
  return EXEMPT_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function isEnforced(): boolean {
  return process.env.APP_CHECK_ENFORCED === 'true';
}

export async function appCheckGate(req: Request, res: Response, next: NextFunction) {
  if (isExempt(req.path)) { next(); return; }

  const enforced = isEnforced();
  const token = req.header('X-Firebase-AppCheck');

  if (!token) {
    console.warn(`[app-check] no token (${enforced ? 'enforced -- blocking' : 'monitoring -- allowing'}): ${req.method} ${req.path}`);
    if (enforced) { res.status(401).json({ error: 'app_check_failed' }); return; }
    next();
    return;
  }

  try {
    await admin.appCheck().verifyToken(token);
    console.log(`[app-check] verified: ${req.method} ${req.path}`);
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[app-check] invalid token (${enforced ? 'enforced -- blocking' : 'monitoring -- allowing'}): ${req.method} ${req.path} -- ${message}`);
    if (enforced) { res.status(403).json({ error: 'app_check_failed' }); return; }
    next();
  }
}
