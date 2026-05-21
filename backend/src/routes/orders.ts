import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { createOrder } from '../services/shopify.js';

const router = Router();

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { items, shippingAddress } = req.body;
  if (!items?.length || !shippingAddress) { res.status(400).json({ error: 'items and shippingAddress required' }); return; }

  try {
    const totalCents = items.reduce((sum: number, item: any) => sum + (item.priceCents ?? 0) * item.quantity, 0);

    // Create order in Shopify (roastery)
    const shopifyResult = await createOrder({
      email: req.email!,
      items,
      shippingAddress,
      note: `Customer UID: ${req.uid}`,
    });

    // Record locally
    const result = await db.query(
      'INSERT INTO orders (uid, shopify_order_id, status, items, shipping_address, total_cents) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [req.uid, shopifyResult.shopifyOrderId, 'pending', JSON.stringify(items), JSON.stringify(shippingAddress), totalCents]
    );

    res.json({ orderId: result.rows[0].id, shopifyOrderId: shopifyResult.shopifyOrderId, orderName: shopifyResult.orderName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Order failed' });
  }
});

router.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await db.query('SELECT * FROM orders WHERE uid = $1 ORDER BY created_at DESC', [req.uid]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

export default router;
