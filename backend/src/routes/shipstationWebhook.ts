// Commerce 6 (2026-11-18), Part B — POST /api/webhooks/shipstation/:token.
// ShipStation V1 webhooks carry no signature (CLOSING_REPORT_6 Task 0.7).
// They are let in by a secret path segment (SHIPSTATION_WEBHOOK_TOKEN,
// compared in constant time; a wrong token is a 404 and leaves no ledger
// row), the resource_url must be https on shipstation_api_host or nothing is
// fetched (decision 5), and the body is never trusted: fulfillmentService
// fetches the resource from the API with our key. Mounted under
// /api/webhooks (App Check and api_event exempt, so the token is not written
// to api_event; Cloud Run's request log does show it, accepted, decision 5).
//
// Processed before the 200, not after: Cloud Run may throttle the CPU once a
// response is sent. A processing error still answers 200 (the ledger row
// holds the error and the daily reconcile catches up), so ShipStation never
// retries into a loop.
import { Router } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { isApiUrl } from '../services/fulfillment/shipstationClient.js';
import { closeShipStationEvent, processShipStationEvent, recordShipStationWebhook, shipStationEnabled } from '../services/fulfillmentService.js';
import { log } from '../lib/logger.js';

const router = Router();

function tokenMatches(given: string): boolean {
  const expected = process.env.SHIPSTATION_WEBHOOK_TOKEN ?? '';
  if (!expected || !given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

router.post('/:token', async (req, res) => {
  if (!tokenMatches(req.params.token ?? '')) { res.status(404).json({ error: 'not_found' }); return; }
  const body = (req.body && typeof req.body === 'object') ? req.body as { resource_url?: unknown; resource_type?: unknown } : {};
  try {
    const ledgerId = await recordShipStationWebhook(body);
    const url = typeof body.resource_url === 'string' ? body.resource_url : '';
    if (!(await isApiUrl(url))) {
      await closeShipStationEvent(ledgerId, 'resource_url is not https on shipstation_api_host: refused, nothing fetched');
      log.warn('shipstation-webhook', 'resource_url host refused', { ledgerId, resourceType: body.resource_type ?? null });
      res.status(400).json({ error: 'invalid_resource_url' });
      return;
    }
    if (!(await shipStationEnabled())) {
      await closeShipStationEvent(ledgerId, 'shipstation_enabled = 0: recorded, not processed');
      res.json({ received: true, processed: false });
      return;
    }
    const result = await processShipStationEvent(ledgerId);
    res.json({ received: true, processed: true, matched: result.matched, shipped: result.shipped });
  } catch (err) {
    log.error('shipstation-webhook', 'failed', { error: err instanceof Error ? err.message : String(err) });
    res.json({ received: true, processed: false });
  }
});

export default router;
