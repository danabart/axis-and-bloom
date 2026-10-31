// Catalog write-door brief (2026-09-30) — stock tracking is retired: writing an
// order must not touch coffee_sku. Commerce 1 (2026-10-31) moved the order
// write to the Stripe webhook (services/checkoutService.completeCheckoutSession),
// so that invariant is now proven in checkoutService.test.ts ("never touches
// coffee_sku"). What is left here is the retired door itself: POST /api/orders
// answers 410 use_checkout for one release and writes nothing.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.uid = 'vitest-orders-stock-uid'; req.email = 'vitest-orders@example.com'; req.isAnonymous = false; next(); },
  blockAnonymousAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/firebase-admin.js', () => ({
  firestoreDb: { doc: () => ({ set: async () => undefined, get: async () => ({ exists: false, data: () => ({}) }) }) },
  default: {},
}));
vi.mock('../services/userLifecycle.js', () => ({ refreshLifecycleState: async () => undefined }));
vi.mock('../services/behavioralConfidence.js', () => ({ computeBehavioralConfidence: async () => undefined }));
vi.mock('../services/dialPositionSignal.js', () => ({ writeDialPositionSignal: async () => undefined }));
vi.mock('../services/customerFacts.js', () => ({
  record: new Proxy({}, { get: () => async () => undefined }),
}));
vi.mock('../services/customerReads.js', () => ({
  latestFeedbackEventForOrder: async () => null, orderLineForOrder: async () => null,
}));

const { default: ordersRouter } = await import('./orders.js');
const { db } = await import('../db/client.js');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/orders`;
}, 20000);

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('POST /api/orders — retired by Commerce 1', () => {
  it('answers 410 use_checkout and writes no order', async () => {
    const count = async () => Number((await db.query(`SELECT count(*) FROM "order"`)).rows[0].count);
    const before = await count();
    const res = await fetch(baseUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ coffeeId: 1, weightOz: 12, quantity: 3, priceCents: 1800 }], shippingAddress: { street: '1 Test St', city: 'Hoboken', state: 'NJ', postalCode: '07030', country: 'US' } }),
    });
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe('use_checkout');
    expect(await count()).toBe(before);
  });
});
