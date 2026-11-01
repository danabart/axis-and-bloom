// Commerce 2, B6 (2026-10-31) — /api/subscriptions.
//   GET /mine   signed-in customer's paid subscriptions (status + customer label, frequency,
//               next delivery date, the coffee lined up by house name, bag count, discount, last order).
// Commerce 3, B2 (2026-10-31): the self-service buttons beside it. Every route
// is signed in, never anonymous, ownership-checked (404 for someone else's
// subscription, so ids cannot be probed), validated with zod, and calls one
// subscriptionService function (G3.1). A SelfServiceError answers its status
// with the friendly message the panel shows.
//   POST /:id/frequency {weeks}             changeFrequency
//   POST /:id/skip                          skipNext
//   POST /:id/pause {resumeOn: YYYY-MM-DD}  pause
//   POST /:id/resume                        resume
//   POST /:id/cancel                        cancel
//   POST /:id/payment-method/session        a setup-mode Embedded Checkout → { clientSecret }
import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, blockAnonymousAuth, type AuthRequest } from '../middleware/auth.js';
import {
  getSubscriptionsForCustomer, subscriptionOwnedBy, changeFrequency, skipNext, pause, resume, cancel,
  createPaymentMethodSession, allowedFrequencies, pauseBounds, SelfServiceError,
} from '../services/subscriptionService.js';

const router = Router();

router.get('/mine', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  try {
    const bounds = await pauseBounds();
    res.json({
      subscriptions: await getSubscriptionsForCustomer(req.uid!),
      // Commerce 3: the panel's options come from commerce_parameter, never typed in.
      frequencies: await allowedFrequencies(),
      pause: { maxWeeks: bounds.maxWeeks, earliestResume: bounds.earliest, latestResume: bounds.latest },
    });
  } catch (err) {
    console.error('[subscriptions] mine', err);
    res.status(500).json({ error: 'subscriptions_failed' });
  }
});

function fail(res: Response, err: unknown, where: string): void {
  if (err instanceof SelfServiceError) { res.status(err.status).json({ error: err.code, message: err.message }); return; }
  console.error(`[subscriptions] ${where}`, err);
  res.status(500).json({ error: 'subscription_change_failed', message: 'That did not go through. Please try again in a moment.' });
}

/** Ownership first: someone else's (or an unknown) subscription is a 404. */
const owned = async (req: AuthRequest, res: Response): Promise<string | null> => {
  const id = String(req.params.id ?? '');
  if (await subscriptionOwnedBy(req.uid!, id)) return id;
  res.status(404).json({ error: 'subscription_not_found', message: 'We could not find that subscription.' });
  return null;
};

const FrequencyBody = z.object({ weeks: z.coerce.number().int().positive() });
const PauseBody = z.object({ resumeOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const badBody = (res: Response, message: string) => res.status(400).json({ error: 'invalid_request', message });

router.post('/:id/frequency', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  try {
    const body = FrequencyBody.safeParse(req.body ?? {});
    if (!body.success) { badBody(res, 'Choose how often your coffee comes.'); return; }
    const id = await owned(req, res); if (!id) return;
    res.json(await changeFrequency(id, body.data.weeks, 'customer'));
  } catch (err) { fail(res, err, 'frequency'); }
});

router.post('/:id/skip', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  try {
    const id = await owned(req, res); if (!id) return;
    res.json(await skipNext(id, 'customer'));
  } catch (err) { fail(res, err, 'skip'); }
});

router.post('/:id/pause', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  try {
    const body = PauseBody.safeParse(req.body ?? {});
    if (!body.success) { badBody(res, 'Pick the day your coffee should start again.'); return; }
    const id = await owned(req, res); if (!id) return;
    res.json(await pause(id, body.data.resumeOn, 'customer'));
  } catch (err) { fail(res, err, 'pause'); }
});

router.post('/:id/resume', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  try {
    const id = await owned(req, res); if (!id) return;
    res.json(await resume(id, 'customer'));
  } catch (err) { fail(res, err, 'resume'); }
});

router.post('/:id/cancel', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  try {
    const id = await owned(req, res); if (!id) return;
    res.json(await cancel(id, 'customer'));
  } catch (err) { fail(res, err, 'cancel'); }
});

router.post('/:id/payment-method/session', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  try {
    const id = await owned(req, res); if (!id) return;
    res.json(await createPaymentMethodSession(id, req.email ?? null));
  } catch (err) { fail(res, err, 'payment-method session'); }
});

export default router;
