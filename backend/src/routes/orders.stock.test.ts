// Catalog write-door brief (2026-09-30) — stock tracking is retired: placing an
// order must not touch coffee_sku (it used to decrement quantity_available and
// flip inventory_status after every order). Real POST /api/orders against the
// isolated test DB; only the outward-facing services (auth, Shopify, Firestore,
// beats, facts, outcome tracking) are mocked so nothing leaves the process.
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.uid = 'vitest-orders-stock-uid'; req.email = 'vitest-orders@example.com'; req.isAnonymous = false; next(); },
  blockAnonymousAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock('../services/shopify.js', () => ({ createOrder: async () => ({ shopifyOrderId: 'vitest-shopify-order' }) }));
vi.mock('../services/firebase-admin.js', () => ({
  firestoreDb: { doc: () => ({ set: async () => undefined, get: async () => ({ exists: false, data: () => ({}) }) }) },
  default: {},
}));
vi.mock('../services/sommelierConfig.js', () => ({ getSommelierConfig: () => ({}) }));
vi.mock('../services/outcomeTracker.js', () => ({ updateOrderOutcomes: async () => undefined }));
vi.mock('../services/userLifecycle.js', () => ({ refreshLifecycleState: async () => undefined }));
vi.mock('../services/behavioralConfidence.js', () => ({ computeBehavioralConfidence: async () => undefined }));
vi.mock('../services/dialPositionSignal.js', () => ({ writeDialPositionSignal: async () => undefined }));
vi.mock('../services/beatEngine.js', () => ({ dispatchOrderPlacedBeat: async () => null, dispatchDelayedBeats: async () => undefined }));
vi.mock('./sommelier.js', () => ({ getBrewProfile: async () => null }));
vi.mock('../services/customerFacts.js', () => ({
  record: new Proxy({}, { get: () => async () => undefined }),
}));
vi.mock('../services/customerReads.js', () => ({
  latestFeedbackEventForOrder: async () => null, orderLineForOrder: async () => null,
}));

const { default: ordersRouter } = await import('./orders.js');
const { db } = await import('../db/client.js');
const { createCoffee, setMatchArchetype, upsertSku } = await import('../services/catalogService.js');

let server: Server;
let baseUrl: string;
let userId: string | undefined;
let coffeeId: number | undefined;
let roasterId: string | undefined;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRouter);
  await new Promise<void>(resolve => { server = app.listen(0, () => resolve()); });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/orders`;
}, 20000);

afterAll(async () => {
  if (userId) {
    await db.query(`DELETE FROM order_line_item WHERE order_id IN (SELECT id FROM "order" WHERE user_id = $1)`, [userId]);
    await db.query(`DELETE FROM "order" WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM user_profile WHERE id = $1`, [userId]);
  }
  if (coffeeId) {
    await db.query('DELETE FROM coffee_slot_assignment WHERE coffee_id = $1', [coffeeId]);
    await db.query('DELETE FROM coffee_archetype_assignment WHERE coffee_id = $1', [coffeeId]);
    await db.query('DELETE FROM coffee_sku WHERE coffee_id = $1', [coffeeId]);
    await db.query('DELETE FROM coffees WHERE id = $1', [coffeeId]);
  }
  if (roasterId) await db.query('DELETE FROM roaster WHERE id = $1', [roasterId]);
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe('POST /api/orders — no stock tracking', () => {
  it('leaves the ordered SKU row exactly as it was (no decrement, no status change)', async () => {
    roasterId = (await db.query<{ id: string }>(`INSERT INTO roaster (name, is_active) VALUES ('Vitest Orders Stock Roastery', true) RETURNING id`)).rows[0].id;
    const { result } = await createCoffee({ roasterId, name: 'Vitest Orders Stock Coffee' }, { actor: 'vitest' });
    coffeeId = result.coffeeId;
    await setMatchArchetype({ coffeeId, archetype: 'earthy', confidence: 'high', source: 'manual' }, { actor: 'vitest' });
    await upsertSku({ coffeeId, weightOz: 12, blendName: 'Vitest Orders Stock Blend', isActive: true }, { actor: 'vitest' });
    userId = (await db.query<{ id: string }>(
      `INSERT INTO user_profile (firebase_uid) VALUES ('vitest-orders-stock-uid') RETURNING id`
    )).rows[0].id;

    const snapshot = async () => (await db.query(`SELECT * FROM coffee_sku WHERE coffee_id = $1`, [coffeeId])).rows;
    const before = await snapshot();
    expect(before).toHaveLength(1);

    const res = await fetch(baseUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ coffeeId, weightOz: 12, quantity: 3, priceCents: 1800 }], shippingAddress: { street: '1 Test St', city: 'Hoboken', state: 'NJ', postalCode: '07030', country: 'US' } }),
    });
    expect(res.status).toBeLessThan(300);

    // Fire-and-forget work in the route (tokens etc.) has no business touching coffee_sku; give it a beat anyway.
    await new Promise(r => setTimeout(r, 500));
    expect(await snapshot()).toEqual(before);
    const lines = await db.query(`SELECT quantity FROM order_line_item WHERE order_id IN (SELECT id FROM "order" WHERE user_id = $1)`, [userId]);
    expect(lines.rows.map(r => Number(r.quantity))).toEqual([3]); // the order itself really was placed
  }, 30000);
});
