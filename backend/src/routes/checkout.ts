// Commerce 1, B5 (2026-10-31) — /api/checkout.
//   GET  /rules                    public: shipping fee + free-shipping bag count, for the cart summary line
//   POST /session                  { items, shippingAddressId? } → { clientSecret, checkoutSessionId } (Stripe Embedded Checkout)
//   GET  /session/:id/status       ownership-checked, from our tables only, so the return page reflects the webhook's work
import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, blockAnonymousAuth, type AuthRequest } from '../middleware/auth.js';
import { getRealClientIp } from '../middleware/clientIp.js';
import { commerceParam } from '../services/commerceParameters.js';
import { createCheckoutSession, getSessionStatus, CheckoutError } from '../services/checkoutService.js';
import { CartError } from '../services/cartResolver.js';

const router = Router();

// 10 per minute per signed-in user (the brief's limit; keyed after requireAuth).
const sessionLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  keyGenerator: (req) => (req as AuthRequest).uid ?? getRealClientIp(req),
  standardHeaders: true, legacyHeaders: false,
});

function sendError(res: Response, err: unknown, where: string) {
  if (err instanceof CheckoutError || err instanceof CartError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  console.error(`[checkout] ${where}`, err);
  res.status(500).json({ error: 'checkout_failed', message: 'Checkout failed. Please try again.' });
}

router.get('/rules', async (_req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      shippingFeeCents: await commerceParam('shipping_fee_cents'),
      freeShippingMinBags: await commerceParam('free_shipping_min_bags'),
    });
  } catch (err) { sendError(res, err, 'rules'); }
});

router.post('/session', requireAuth, blockAnonymousAuth, sessionLimiter, async (req: AuthRequest, res) => {
  try {
    const { items, shippingAddressId } = req.body ?? {};
    const result = await createCheckoutSession({ uid: req.uid!, email: req.email ?? null, items, shippingAddressId: shippingAddressId ?? null });
    res.json({ clientSecret: result.clientSecret, checkoutSessionId: result.checkoutSessionId });
  } catch (err) { sendError(res, err, 'session'); }
});

router.get('/session/:id/status', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  try {
    const status = await getSessionStatus(req.uid!, req.params.id);
    if (!status) { res.status(404).json({ error: 'not_found' }); return; }
    res.json(status);
  } catch (err) { sendError(res, err, 'status'); }
});

export default router;
