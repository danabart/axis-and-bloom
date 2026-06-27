import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { createOrder } from '../services/shopify.js';
import { firestoreDb } from '../services/firebase-admin.js';
import { getSommelierConfig } from '../services/sommelierConfig.js';
import { updateOrderOutcomes } from '../services/outcomeTracker.js';
import { schedulePostDeliveryMessage } from '../services/liamSmsFeedback.js';

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

    // Fire-and-forget: award order bonus tokens + update sommelier outcomes.
    ;(async () => {
      try {
        const orderBonus = getSommelierConfig()?.tokenEconomy?.orderBonus ?? 10;
        const client = await db.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE user_tokens
             SET balance = balance + $2, lifetime_earned = lifetime_earned + $2, updated_at = NOW()
             WHERE uid = $1`,
            [req.uid, orderBonus]
          );
          await client.query(
            `INSERT INTO token_events (uid, delta, reason, reference_id, balance_after)
             SELECT $1, $2, 'order_bonus', $3, balance
             FROM user_tokens WHERE uid = $1`,
            [req.uid, orderBonus, String(orderId)]
          );
          await client.query('COMMIT');
          const tokenRow = await client.query(`SELECT balance FROM user_tokens WHERE uid = $1`, [req.uid]);
          if (tokenRow.rows.length) {
            firestoreDb.doc(`users/${req.uid}`).set(
              { tokenBalance: tokenRow.rows[0].balance },
              { merge: true }
            ).catch(() => {});
          }
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          client.release();
        }

        // Update sommelier outcome: orderedWithin7Days / orderedWithin30Days
        await updateOrderOutcomes(req.uid!, new Date());

        // Schedule Liam SMS feedback for orders 1 and 2 only
        const orderCount = await db.query(
          `SELECT COUNT(*) FROM orders WHERE uid = $1`,
          [req.uid]
        );
        if (parseInt(orderCount.rows[0].count) <= 2) {
          const blendId = items?.[0]?.blendId ?? items?.[0]?.id ?? null;
          schedulePostDeliveryMessage(req.uid!, blendId).catch(err => {
            console.error('[liamSms] schedule failed:', err);
          });
        }
      } catch (err) {
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
