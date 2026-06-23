import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { createOrder } from '../services/shopify.js';
import { firestoreDb } from '../services/firebase-admin.js';
import { getSommelierConfig } from '../services/sommelierConfig.js';

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

    const orderId = result.rows[0].id;
    res.json({ orderId, shopifyOrderId: shopifyResult.shopifyOrderId, orderName: shopifyResult.orderName });

    // Fire-and-forget: award order bonus tokens.
    ;(async () => {
      try {
        const orderBonus = getSommelierConfig()?.tokenEconomy?.orderBonus ?? 10;
        await db.query('BEGIN');
        await db.query(
          `UPDATE user_tokens
           SET balance = balance + $2, lifetime_earned = lifetime_earned + $2, updated_at = NOW()
           WHERE uid = $1`,
          [req.uid, orderBonus]
        );
        await db.query(
          `INSERT INTO token_events (uid, delta, reason, reference_id, balance_after)
           SELECT $1, $2, 'order_bonus', $3, balance
           FROM user_tokens WHERE uid = $1`,
          [req.uid, orderBonus, String(orderId)]
        );
        await db.query('COMMIT');

        // Sync balance to Firestore (fire-and-forget within fire-and-forget)
        const tokenRow = await db.query(`SELECT balance FROM user_tokens WHERE uid = $1`, [req.uid]);
        if (tokenRow.rows.length) {
          firestoreDb.doc(`users/${req.uid}`).set(
            { tokenBalance: tokenRow.rows[0].balance },
            { merge: true }
          ).catch(() => {});
        }
      } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        console.error('[orders/token-bonus]', err);
      }
    })();
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
