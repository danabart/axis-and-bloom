// Commerce 2, B6 (2026-10-31) — /api/subscriptions.
//   GET /mine   signed-in customer's paid subscriptions (status + customer label, frequency,
//               next delivery date, the coffee lined up by house name, bag count, discount, last order).
// Read-only; Commerce 3 adds the self-service buttons beside it.
import { Router } from 'express';
import { requireAuth, blockAnonymousAuth, type AuthRequest } from '../middleware/auth.js';
import { getSubscriptionsForCustomer } from '../services/subscriptionService.js';

const router = Router();

router.get('/mine', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  try {
    res.json({ subscriptions: await getSubscriptionsForCustomer(req.uid!) });
  } catch (err) {
    console.error('[subscriptions] mine', err);
    res.status(500).json({ error: 'subscriptions_failed' });
  }
});

export default router;
