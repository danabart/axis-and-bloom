import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { getRealClientIp } from '../middleware/clientIp.js';
import { log } from '../lib/logger.js';

const router = Router();

const MAX_STACK_BYTES = 4 * 1024;

function truncate(value: unknown, maxBytes: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (Buffer.byteLength(value, 'utf-8') <= maxBytes) return value;
  // Byte-safe truncate: slice progressively shorter until it fits, rather
  // than a naive string slice that could split a multi-byte character.
  let end = maxBytes;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf-8') > maxBytes) end--;
  return value.slice(0, end);
}

// Observability Foundation Part C — the frontend boundary's server side.
// Open to guests (like /api/quiz/event, /api/newsletter/subscribe) since
// guests are most of our traffic; optionalAuth attaches uid only when the
// caller happens to be signed in. Rate-limited the same way funnelEventLimiter
// guards /api/quiz/event — this endpoint is guest-writable and unauthenticated,
// same abuse shape. The client-side reporter's own throttle (max 3/signature,
// max 20/session) is the primary noise control; this is the server-side
// backstop for a caller that bypasses the JS reporter entirely.
const clientErrorLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: getRealClientIp });

router.post('/', clientErrorLimiter, optionalAuth, async (req: AuthRequest, res) => {
  const body = req.body ?? {};
  const message = typeof body.message === 'string' ? body.message.slice(0, 2000) : null;
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  const route = typeof body.route === 'string' ? body.route.slice(0, 500) : null;
  const signature = typeof body.signature === 'string' ? body.signature.slice(0, 200) : null;
  const stack = truncate(body.stack, MAX_STACK_BYTES);
  const count = Number.isFinite(body.count) ? Number(body.count) : null;

  // WARNING, deliberately -- browser noise (extensions, ad blockers,
  // third-party scripts) must not email Dana. Signatures are reviewed
  // weekly (System Health card, Part E) and promoted selectively, not
  // individually alerted on.
  log.warn('[client-error]', message, { route, signature, uid: req.uid ?? null, count, stack });

  res.status(204).end();
});

export default router;
