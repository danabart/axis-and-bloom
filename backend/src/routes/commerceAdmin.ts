// Commerce 1, B10 (2026-10-31): /api/admin/commerce behind requireAdmin.
// Thin callers of services/commerceParameters.ts, same shape as
// routes/evidenceAdmin.ts's parameter routes; the Commerce parameters card on
// /admin/commerce reads and writes through these.
//
// Commerce 3, B5 (2026-10-31): the shop's admin. Every route is behind
// requireAdmin (server-side, the DB role), validates with zod and calls one
// service function (G3.1):
//   /api/admin/commerce/lookups               carriers, refund reasons, statuses, the refund window
//   /api/admin/orders  (adminOrdersRouter)    list, detail, refund, retry fulfillment, mark shipped
//   /api/admin/subscriptions (adminSubscriptionsRouter)  list, cancel
import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { getParameters, setParameter, CommerceParameterError } from '../services/commerceParameters.js';
import { listOrders, getOrderDetail, listSubscriptions, getCommerceLookups } from '../services/commerceAdminReads.js';
import { requestRefund, RefundError } from '../services/checkoutService.js';
import { retryFulfillment, FulfillmentRetryError } from '../services/fulfillment/index.js';
import { markShipped, ShipmentError } from '../services/shipmentService.js';
import { cancel, SelfServiceError } from '../services/subscriptionService.js';

const router = Router();
router.use(requireAdmin);

router.get('/parameters', async (_req, res) => {
  try {
    res.json(await getParameters());
  } catch (err) {
    console.error('[admin/commerce/parameters]', err);
    res.status(500).json({ error: 'Failed to read the commerce parameters' });
  }
});

router.put('/parameters/:key', async (req: AuthRequest, res) => {
  try {
    const result = await setParameter(req.params.key, req.body?.value, req.body?.note ?? null, req.uid ?? null);
    res.json(result);
  } catch (err) {
    if (err instanceof CommerceParameterError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('[admin/commerce/parameters PUT]', err);
    res.status(500).json({ error: 'Failed to save the commerce parameter' });
  }
});

router.get('/lookups', async (_req, res) => {
  try { res.json(await getCommerceLookups()); } catch (err) { fail(res, err, 'lookups'); }
});

export default router;

/** A service's own error answers its status and message; anything else is a 500. */
function fail(res: Response, err: unknown, where: string): void {
  if (err instanceof RefundError || err instanceof ShipmentError || err instanceof FulfillmentRetryError || err instanceof SelfServiceError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  console.error(`[admin/commerce] ${where}`, err);
  const stripeMessage = (err as { type?: string; message?: string })?.type?.startsWith('Stripe') ? (err as { message?: string }).message : null;
  res.status(stripeMessage ? 502 : 500).json({ error: 'failed', message: stripeMessage ? `Stripe: ${stripeMessage}` : 'That did not go through; see the logs.' });
}

// ── /api/admin/orders ────────────────────────────────────────────────────────

export const adminOrdersRouter = Router();
adminOrdersRouter.use(requireAdmin);

const ListQuery = z.object({
  paymentStatus: z.string().max(40).optional(), fulfillmentStatus: z.string().max(40).optional(),
  q: z.string().max(120).optional(), page: z.coerce.number().int().positive().optional(),
});
const RefundBody = z.object({ amountCents: z.coerce.number().int().positive().nullish(), reason: z.string().min(1).max(40) });
const ShippedBody = z.object({ carrier: z.string().min(1).max(40), trackingNumber: z.string().trim().min(1).max(64) });

adminOrdersRouter.get('/', async (req, res) => {
  try {
    const q = ListQuery.safeParse(req.query);
    if (!q.success) { res.status(400).json({ error: 'invalid_request', message: 'Bad filters.' }); return; }
    res.json(await listOrders(q.data));
  } catch (err) { fail(res, err, 'orders list'); }
});

adminOrdersRouter.get('/:id', async (req, res) => {
  try {
    const detail = await getOrderDetail(req.params.id);
    if (!detail) { res.status(404).json({ error: 'order_not_found', message: 'Order not found.' }); return; }
    res.json(detail);
  } catch (err) { fail(res, err, 'order detail'); }
});

adminOrdersRouter.post('/:id/refund', async (req: AuthRequest, res) => {
  try {
    const body = RefundBody.safeParse(req.body ?? {});
    if (!body.success) { res.status(400).json({ error: 'invalid_request', message: 'Choose a reason, and an amount in cents for a partial refund.' }); return; }
    res.json(await requestRefund(req.params.id, { amountCents: body.data.amountCents ?? null, reason: body.data.reason, adminId: req.uid ?? null }));
  } catch (err) { fail(res, err, 'refund'); }
});

adminOrdersRouter.post('/:id/fulfillment/retry', async (req, res) => {
  try { res.json(await retryFulfillment(req.params.id)); } catch (err) { fail(res, err, 'fulfillment retry'); }
});

adminOrdersRouter.post('/:id/shipped', async (req, res) => {
  try {
    const body = ShippedBody.safeParse(req.body ?? {});
    if (!body.success) { res.status(400).json({ error: 'invalid_request', message: 'Choose a carrier and enter the tracking number.' }); return; }
    res.json(await markShipped(req.params.id, body.data));
  } catch (err) { fail(res, err, 'mark shipped'); }
});

// ── /api/admin/subscriptions ─────────────────────────────────────────────────

export const adminSubscriptionsRouter = Router();
adminSubscriptionsRouter.use(requireAdmin);

adminSubscriptionsRouter.get('/', async (req, res) => {
  try {
    const status = z.string().max(40).optional().safeParse(req.query.status);
    res.json({ subscriptions: await listSubscriptions(status.success ? status.data : undefined) });
  } catch (err) { fail(res, err, 'subscriptions list'); }
});

adminSubscriptionsRouter.post('/:id/cancel', async (req, res) => {
  try { res.json(await cancel(req.params.id, 'admin')); } catch (err) { fail(res, err, 'subscription cancel'); }
});
