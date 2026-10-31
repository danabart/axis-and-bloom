import { Router } from 'express';
import { requireAuth, blockAnonymousAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { refreshLifecycleState } from '../services/userLifecycle.js';
import { computeBehavioralConfidence } from '../services/behavioralConfidence.js';
import { writeDialPositionSignal } from '../services/dialPositionSignal.js';
import { record } from '../services/customerFacts.js';
import { latestFeedbackEventForOrder, orderLineForOrder } from '../services/customerReads.js';
import { getCustomerDescriptors } from '../services/cuppingReads.js';
import { randomUUID } from 'node:crypto';

const router = Router();

// POST /api/orders — retired by Commerce 1 (2026-10-31). Orders are written
// only when Stripe confirms payment (routes/stripeWebhook.ts →
// services/checkoutService.completeCheckoutSession), and every post-order side
// effect it used to fire moved to services/orderFinalizer.ts. The cart goes to
// /checkout (POST /api/checkout/session). 410 for one release so a stale
// client gets a clear answer; services/shopify.ts stays untouched until
// Commerce brief 4.
router.post('/', requireAuth, blockAnonymousAuth, (_req, res) => {
  res.status(410).json({ error: 'use_checkout', message: 'Checkout moved: open your cart and choose Checkout.' });
});

// Order history. State comes from v_order_status (the only read path for
// order state, Commerce 1): payment status, fulfillment status and the
// customer's words for it from the lookups; total is what was paid.
router.get('/', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  try {
    const result = await db.query(
      `SELECT o.id, o.external_shopify_order_id, o.created_at, o.paid_at,
              s.payment_status, s.fulfillment_status, s.customer_label,
              o.total_amount_paid AS total,
              COALESCE(json_agg(json_build_object('display_name', li.display_name, 'weight_oz', li.weight_oz, 'quantity', li.quantity)
                         ORDER BY li.created_at) FILTER (WHERE li.id IS NOT NULL), '[]') AS lines
       FROM "order" o
       JOIN user_profile up ON up.id = o.user_id
       JOIN v_order_status s ON s.order_id = o.id
       LEFT JOIN order_line_item li ON li.order_id = o.id
       WHERE up.firebase_uid = $1
       GROUP BY o.id, s.payment_status, s.fulfillment_status, s.customer_label
       ORDER BY o.created_at DESC`,
      [req.uid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// ── POST /api/orders/:orderId/feedback ────────────────────────────────────────
// On-site feedback form (UC3), extended to v2 (Profile Part 2 §B) and then to
// submit-or-revise (Profile Part 5). Star rating is direct structured input, so
// sentiment/sValue are computed in plain code — zero LLM calls, unlike the SMS
// path which has to parse free text. Writes the same feedback_events doc shape
// liamSmsFeedback.ts already writes, plus source: 'onsite', so every downstream
// consumer treats the two channels interchangeably. v2 fields (expectation,
// tastedNoteIds) are additive and optional — a legacy {rating, note}-only body
// behaves exactly as before.
//
// Revision (Part 5, Dana's decision 2026-07-18): feedback is always editable by
// its owner, per order, via superseding events — same pattern
// dial_position_signal/archetype_assignments already use. No time window;
// history preserved, consumers read latest-per-order.
router.post('/:orderId/feedback', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  const { orderId } = req.params;
  const { rating, note, expectation, tastedNoteIds } = req.body ?? {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: 'rating (integer 1-5) required' });
    return;
  }
  if (expectation !== undefined && expectation !== null && !['lighter', 'as_expected', 'bolder'].includes(expectation)) {
    res.status(400).json({ error: 'expectation must be lighter, as_expected, or bolder' });
    return;
  }
  if (tastedNoteIds !== undefined && !Array.isArray(tastedNoteIds)) {
    res.status(400).json({ error: 'tastedNoteIds must be an array' });
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

    // Order -> coffee resolution: same first-line-item convention the codebase
    // already uses elsewhere — an order spanning multiple coffees still just
    // takes the first, rather than inventing multi-coffee handling here.
    const lineResult = await db.query(
      `SELECT rb.coffee_id
       FROM order_line_item li
       JOIN coffee_sku rb ON rb.id = li.blend_id
       WHERE li.order_id = $1 LIMIT 1`,
      [orderId]
    );
    const coffeeId: number | null = lineResult.rows[0]?.coffee_id ?? null;

    // Validate tastedNoteIds against this specific coffee's own wheel vocabulary
    // (same set Part 3's chips are populated from) before writing anything.
    const noteIds: string[] = Array.isArray(tastedNoteIds) ? tastedNoteIds : [];
    if (noteIds.length) {
      if (!coffeeId) {
        res.status(400).json({ error: "Cannot resolve this order's coffee for tastedNoteIds" });
        return;
      }
      // Cupping evidence brief 6, C3 (2026-10-21): the chips now come from the
      // customer voice (GET /api/coffees/:id/flavor-wheel), so the valid ids
      // are the same read's nodes.
      const validNoteIds = new Set((await getCustomerDescriptors(coffeeId)).map(r => r.node_id));
      for (const id of noteIds) {
        if (!validNoteIds.has(id)) {
          res.status(400).json({ error: `tastedNoteIds contains an id not offered for this coffee: ${id}` });
          return;
        }
      }
    }

    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const profileId = profileResult.rows[0]?.id;

    // Is this a revision? — Customer Blueprint C3, Part C: resolved from the
    // fact itself (customer_feedback_event via latestFeedbackEventForOrder),
    // not a Firestore doc lookup. The Firestore feedback_events write, the
    // confidence_profile write, and the user_flavor_feedback DELETE+INSERT
    // are all retired here — customer_feedback_descriptor (below) is the
    // descriptors store now, and RECOMMENDATION_MISS derives its exclusion
    // list live from v_customer_feedback_current.
    const existingFeedbackEventId = profileId ? await latestFeedbackEventForOrder(profileId, orderId) : null;
    const isRevision = !!existingFeedbackEventId;

    const sentiment: 'positive' | 'negative' | 'neutral' =
      rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';

    // dial_position_signal — feeds the dormant Stage 2 dial loop
    // (BLOOM_DIAL_ALLOCATION_SPEC.md §3). Resolution (coffee → archetype →
    // dominant dimension → insert) lives in dialPositionSignal.ts, shared with
    // Liam's SMS feedback (Liam SMS Dial Question) so neither channel duplicates
    // it. as_expected confirms the status quo and writes no row this pass — a
    // confirmation-signal design is a future refinement, not built here.
    //
    // Prior row lookup (Part 5): matched by an *exact* equality on `notes`
    // rather than the substring LIKE Part 2 used — Part 2's own comment flagged
    // that as worth revisiting if it ever proved fragile. Since this exact
    // string is the only thing this route ever writes into `notes`, and orderId
    // is unique, equality is strictly more precise than LIKE with zero schema
    // change, so this was the fix rather than adding an order_id column.
    const signalNote = `onsite feedback for order ${orderId}`;
    if (isRevision) {
      await db.query(
        `UPDATE dial_position_signal SET superseded_at = NOW() WHERE notes = $1 AND superseded_at IS NULL`,
        [signalNote]
      );
    }
    if (coffeeId) {
      await writeDialPositionSignal({ coffeeId, expectation: expectation ?? null, source: 'onsite_feedback', notes: signalNote });
    }

    // Customer Blueprint C2, Part A1 — customer_feedback_event (+ one
    // customer_feedback_descriptor per tasted note) is the only feedback
    // writer as of C3, Part C. sourceId is a fresh id (no Firestore doc to
    // key off any more).
    if (profileId && coffeeId) {
      try {
        const orderLineItemId = await orderLineForOrder(orderId);
        if (!orderLineItemId) {
          console.warn('[customerFacts:feedback] multi-line order, line unattributed', { orderId });
        }
        const { id: feedbackEventId } = await record.feedback({
          userId: profileId, source: 'onsite', sourceId: randomUUID(),
          orderLineItemId, coffeeId, rating, expectation: expectation ?? null, rawText: note ?? null,
          channel: 'onsite', supersedesId: existingFeedbackEventId,
        });
        if (feedbackEventId) {
          for (const noteId of noteIds) {
            await record.feedbackDescriptor({ userId: profileId, source: 'onsite', feedbackEventId, cuppingNoteId: noteId });
          }
        }
      } catch (err) {
        console.error('[customerFacts:feedback]', err);
      }
    }

    res.json({ ok: true, revised: isRevision });

    computeBehavioralConfidence(req.uid!).catch(err => console.error('[orders/feedback/bc]', err));
    refreshLifecycleState(req.uid!).catch(err => console.error('[orders/feedback/lifecycle]', err));
  } catch (err) {
    console.error('[orders/feedback]', err);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

export default router;
