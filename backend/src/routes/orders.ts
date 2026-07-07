import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { createOrder } from '../services/shopify.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';
import { getSommelierConfig } from '../services/sommelierConfig.js';
import { updateOrderOutcomes } from '../services/outcomeTracker.js';
import { schedulePostDeliveryMessage } from '../services/liamSmsFeedback.js';
import { refreshLifecycleState } from '../services/userLifecycle.js';
import { computeBehavioralConfidence } from '../services/behavioralConfidence.js';

const router = Router();

router.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { items, shippingAddress } = req.body;
  if (!items?.length || !shippingAddress) { res.status(400).json({ error: 'items and shippingAddress required' }); return; }

  try {
    const profileResult = await db.query(
      `SELECT id FROM user_profile WHERE firebase_uid = $1`,
      [req.uid]
    );
    const userId = profileResult.rows[0]?.id;
    if (!userId) { res.status(404).json({ error: 'User profile not found' }); return; }

    const subtotal = items.reduce((sum: number, item: any) => sum + ((item.priceCents ?? 0) / 100) * item.quantity, 0);

    // Create order in Shopify (roastery)
    const shopifyResult = await createOrder({
      email: req.email!,
      items,
      shippingAddress,
      note: `Customer UID: ${req.uid}`,
    });

    // Record locally in "order" + order_line_item (normalized pair — see WHAT_WE_BUILT.md
    // for why the legacy `orders` table was retired). Shipping address is snapshotted onto
    // the order at checkout time, not live-referenced, so later address edits/deletes never
    // rewrite what a past order actually shipped to.
    const orderResult = await db.query(
      `INSERT INTO "order"
         (user_id, external_shopify_order_id, fulfillment_status, subtotal, total_amount_paid,
          shipping_street, shipping_city, shipping_state, shipping_postal_code, shipping_country, shipping_address_id)
       VALUES ($1, $2, 'pending', $3, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        userId,
        shopifyResult.shopifyOrderId,
        subtotal,
        shippingAddress.street ?? shippingAddress.address1 ?? null,
        shippingAddress.city ?? null,
        shippingAddress.state ?? shippingAddress.province ?? null,
        shippingAddress.postalCode ?? shippingAddress.zip ?? null,
        shippingAddress.country ?? null,
        shippingAddress.addressId ?? null,
      ]
    );
    const orderId = orderResult.rows[0].id;

    for (const item of items) {
      const blendId = item.blendId ?? item.id;
      if (!blendId) continue;
      const unitPrice = (item.priceCents ?? 0) / 100;
      await db.query(
        `INSERT INTO order_line_item (order_id, blend_id, quantity, unit_price_charged)
         VALUES ($1, $2, $3, $4)`,
        [orderId, blendId, item.quantity ?? 1, unitPrice]
      );
    }

    // Decrement inventory for each purchased blend. Best-effort per item —
    // a failure here should not block the customer's order confirmation.
    for (const item of items) {
      const blendId = item.blendId ?? item.id;
      if (!blendId) continue;
      try {
        await db.query(
          `UPDATE roaster_blend
           SET quantity_available = GREATEST(quantity_available - $1, 0),
               inventory_status = CASE
                 WHEN GREATEST(quantity_available - $1, 0) <= 0 THEN 'out_of_stock'
                 WHEN GREATEST(quantity_available - $1, 0) <= safety_stock_buffer THEN 'low_stock'
                 ELSE 'in_stock'
               END
           WHERE id = $2`,
          [item.quantity ?? 1, blendId]
        );
      } catch (err) {
        console.error('[orders] inventory decrement failed for blend', blendId, err);
      }
    }

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
          `SELECT COUNT(*) FROM "order" WHERE user_id = $1`,
          [userId]
        );
        if (parseInt(orderCount.rows[0].count, 10) <= 2) {
          const blendId = items?.[0]?.blendId ?? items?.[0]?.id ?? null;
          schedulePostDeliveryMessage(req.uid!, blendId, orderId).catch(err => {
            console.error('[liamSms] schedule failed:', err);
          });
        }

        // Recompute lifecycle stage now that an order exists — independent write,
        // same trigger point as the token bonus / SMS scheduling above.
        refreshLifecycleState(req.uid!).catch(err => {
          console.error('[orders/lifecycle]', err);
        });
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
    const result = await db.query(
      `SELECT o.id, o.external_shopify_order_id, o.fulfillment_status, o.created_at,
              COALESCE(SUM(li.unit_price_charged * li.quantity), 0) AS total
       FROM "order" o
       JOIN user_profile up ON up.id = o.user_id
       LEFT JOIN order_line_item li ON li.order_id = o.id
       WHERE up.firebase_uid = $1
       GROUP BY o.id ORDER BY o.created_at DESC`,
      [req.uid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// ── POST /api/orders/:orderId/feedback ────────────────────────────────────────
// On-site feedback form (UC3). Star rating is direct structured input, so
// sentiment/sValue are computed in plain code — zero LLM calls, unlike the SMS
// path which has to parse free text. Writes the same feedback_events doc shape
// liamSmsFeedback.ts already writes, plus source: 'onsite', so every downstream
// consumer (behavioralConfidence, sommelierEvaluator, userSignals) treats the
// two channels interchangeably.
router.post('/:orderId/feedback', requireAuth, async (req: AuthRequest, res) => {
  const { orderId } = req.params;
  const { rating, note } = req.body ?? {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: 'rating (integer 1-5) required' });
    return;
  }

  try {
    const orderResult = await db.query(
      `SELECT o.id
       FROM "order" o
       JOIN user_profile up ON up.id = o.user_id
       WHERE o.id = $1 AND up.firebase_uid = $2`,
      [orderId, req.uid]
    );
    if (!orderResult.rows.length) { res.status(404).json({ error: 'Order not found' }); return; }

    const blendResult = await db.query(
      `SELECT blend_id FROM order_line_item WHERE order_id = $1 LIMIT 1`,
      [orderId]
    );
    const blendId = blendResult.rows[0]?.blend_id ?? null;

    const sentiment: 'positive' | 'negative' | 'neutral' =
      rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
    const sValue = (rating - 1) / 4;

    await firestoreDb.collection(`users/${req.uid}/feedback_events`).add({
      orderId,
      blendId,
      signalType: 'onsite_feedback',
      rating,
      sValue,
      confidence: 1.0,
      source: 'onsite',
      sentiment,
      rawText: note ?? null,
      descriptors: [],
      createdAt: FieldValue.serverTimestamp(),
    });

    if (sentiment === 'negative') {
      await firestoreDb.doc(`users/${req.uid}/metadata/confidence_profile`).set({
        hasPendingNegativeFeedback: true,
        negativeFeedbackBlendId: blendId,
        negativeFeedbackDetectedAt: FieldValue.serverTimestamp(),
        negativeFeedbackSource: 'onsite',
      }, { merge: true }).catch(() => {});
    }

    res.json({ ok: true });

    computeBehavioralConfidence(req.uid!).catch(err => console.error('[orders/feedback/bc]', err));
    refreshLifecycleState(req.uid!).catch(err => console.error('[orders/feedback/lifecycle]', err));
  } catch (err) {
    console.error('[orders/feedback]', err);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

export default router;
