// Commerce 1, B5 (2026-10-31) — /api/checkout.
//   GET  /rules                    public: shipping fee + free-shipping bag count, for the cart summary line;
//                                  subscription frequencies + the two discount percentages (Commerce 2)
//   POST /session                  { items, shippingAddressId?, subscription?: { frequencyWeeks } } → { clientSecret, checkoutSessionId } (Stripe Embedded Checkout)
//   POST /quote                    public: { items, subscription? } → subtotal, shipping, and the subscription price (Commerce 2)
//   GET  /session/:id/status       ownership-checked, from our tables only, so the return page reflects the webhook's work
import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, blockAnonymousAuth, type AuthRequest } from '../middleware/auth.js';
import { getRealClientIp } from '../middleware/clientIp.js';
import { commerceParam } from '../services/commerceParameters.js';
import { createCheckoutSession, getSessionStatus, subscriptionFrequencies, quoteCart, CheckoutError } from '../services/checkoutService.js';
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
      // Commerce 2: the subscribe choice in the cart (options and discounts, never typed in the frontend).
      subscriptionFrequencyWeeks: await subscriptionFrequencies(),
      subscriptionDiscountPct1Bag: await commerceParam('subscription_discount_pct_1_bag'),
      subscriptionDiscountPct2PlusBags: await commerceParam('subscription_discount_pct_2plus_bags'),
    });
  } catch (err) { sendError(res, err, 'rules'); }
});

// Commerce 2, C1: public (the cart drawer shows it signed out too), read-only.
const quoteLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, keyGenerator: getRealClientIp, standardHeaders: true, legacyHeaders: false });
router.post('/quote', quoteLimiter, async (req, res) => {
  try {
    const { items, subscription } = req.body ?? {};
    res.json(await quoteCart(items, subscription && typeof subscription === 'object' ? { frequencyWeeks: Number(subscription.frequencyWeeks) } : null));
  } catch (err) { sendError(res, err, 'quote'); }
});

router.post('/session', requireAuth, blockAnonymousAuth, sessionLimiter, async (req: AuthRequest, res) => {
  try {
    const { items, shippingAddressId, subscription } = req.body ?? {};
    const result = await createCheckoutSession({
      uid: req.uid!, email: req.email ?? null, items, shippingAddressId: shippingAddressId ?? null,
      subscription: subscription && typeof subscription === 'object' ? { frequencyWeeks: Number(subscription.frequencyWeeks) } : null,
    });
    res.json({ clientSecret: result.clientSecret, checkoutSessionId: result.checkoutSessionId, shipsTo: result.shipsTo });
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
