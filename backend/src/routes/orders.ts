import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { createOrder } from '../services/shopify.js';
import { resolveBlendForSlot, resolveCoffeeBlend } from '../services/blendResolver.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';
import { getSommelierConfig } from '../services/sommelierConfig.js';
import { updateOrderOutcomes } from '../services/outcomeTracker.js';
import { schedulePostDeliveryMessage } from '../services/liamSmsFeedback.js';
import { refreshLifecycleState } from '../services/userLifecycle.js';
import { computeBehavioralConfidence } from '../services/behavioralConfidence.js';
import { writeDialPositionSignal } from '../services/dialPositionSignal.js';

const router = Router();

interface ResolvedItem {
  variantId?: string;
  blendId?: string;
  quantity: number;
  priceCents?: number;
  resolvedCoffeeName?: string;
  resolvedRoaster?: string;
}

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

    // Resolve each item to a concrete roaster_blend before charging or creating anything
    // downstream. An item can specify a direct blendId/variantId (unchanged, existing
    // behavior), a Bloom Dial slot — { archetype, dialSortOrder, weightOz } — resolved
    // server-side via the same priority order set on the Coffees page, trying the
    // preferred roaster first and falling back automatically if it's unavailable, or
    // (Bloom Dial Base Data Part 3, Phase 6) a direct category coffee with no dial
    // position — { coffeeId, weightOz }. See backend/src/services/blendResolver.ts.
    const resolvedItems: ResolvedItem[] = [];
    for (const item of items) {
      if (item.archetype && item.dialSortOrder !== undefined && item.weightOz) {
        const resolved = await resolveBlendForSlot(item.archetype, item.dialSortOrder, item.weightOz);
        if (!resolved) {
          res.status(409).json({
            error: `No roaster currently available for ${item.archetype} position ${item.dialSortOrder} at ${item.weightOz}oz`,
          });
          return;
        }
        resolvedItems.push({
          variantId: resolved.shopify_variant_id ?? undefined,
          blendId: resolved.blend_id,
          quantity: item.quantity ?? 1,
          priceCents: item.priceCents,
          resolvedCoffeeName: resolved.coffee_name,
          resolvedRoaster: resolved.roaster,
        });
      } else if (item.coffeeId && item.weightOz) {
        const resolved = await resolveCoffeeBlend(item.coffeeId, item.weightOz);
        if (!resolved) {
          res.status(409).json({ error: `This coffee is not currently available at ${item.weightOz}oz` });
          return;
        }
        resolvedItems.push({
          variantId: resolved.shopify_variant_id ?? undefined,
          blendId: resolved.blend_id,
          quantity: item.quantity ?? 1,
          priceCents: item.priceCents,
        });
      } else {
        resolvedItems.push({
          variantId: item.variantId,
          blendId: item.blendId ?? item.id,
          quantity: item.quantity ?? 1,
          priceCents: item.priceCents,
        });
      }
    }

    const subtotal = resolvedItems.reduce((sum, item) => sum + ((item.priceCents ?? 0) / 100) * item.quantity, 0);

    // Create order in Shopify (roastery)
    const shopifyResult = await createOrder({
      email: req.email!,
      items: resolvedItems.map(item => ({ variantId: item.variantId!, quantity: item.quantity })),
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

    for (const item of resolvedItems) {
      if (!item.blendId) continue;
      const unitPrice = (item.priceCents ?? 0) / 100;
      await db.query(
        `INSERT INTO order_line_item (order_id, blend_id, quantity, unit_price_charged)
         VALUES ($1, $2, $3, $4)`,
        [orderId, item.blendId, item.quantity, unitPrice]
      );
    }

    // Decrement inventory for each purchased blend. Best-effort per item —
    // a failure here should not block the customer's order confirmation.
    for (const item of resolvedItems) {
      if (!item.blendId) continue;
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
          [item.quantity, item.blendId]
        );
      } catch (err) {
        console.error('[orders] inventory decrement failed for blend', item.blendId, err);
      }
    }

    res.json({
      orderId, shopifyOrderId: shopifyResult.shopifyOrderId, orderName: shopifyResult.orderName,
      items: resolvedItems.map(item => ({
        blendId: item.blendId, quantity: item.quantity,
        ...(item.resolvedCoffeeName ? { resolvedCoffeeName: item.resolvedCoffeeName, resolvedRoaster: item.resolvedRoaster } : {}),
      })),
    });

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
          const blendId = resolvedItems[0]?.blendId ?? null;
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
router.post('/:orderId/feedback', requireAuth, async (req: AuthRequest, res) => {
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
    // already uses for blendId — an order spanning multiple coffees still just
    // takes the first, rather than inventing multi-coffee handling here.
    const lineResult = await db.query(
      `SELECT li.blend_id, rb.coffee_id
       FROM order_line_item li
       JOIN roaster_blend rb ON rb.id = li.blend_id
       WHERE li.order_id = $1 LIMIT 1`,
      [orderId]
    );
    const blendId = lineResult.rows[0]?.blend_id ?? null;
    const coffeeId: number | null = lineResult.rows[0]?.coffee_id ?? null;

    // Validate tastedNoteIds against this specific coffee's own wheel vocabulary
    // (same set Part 3's chips are populated from) before writing anything.
    const noteIds: string[] = Array.isArray(tastedNoteIds) ? tastedNoteIds : [];
    let noteLabelById = new Map<string, string>();
    if (noteIds.length) {
      if (!coffeeId) {
        res.status(400).json({ error: "Cannot resolve this order's coffee for tastedNoteIds" });
        return;
      }
      const wheelResult = await db.query(
        `SELECT DISTINCT cupping_note_id, descriptor FROM v_collaborative_flavor_wheel WHERE coffee_id = $1`,
        [coffeeId]
      );
      noteLabelById = new Map(wheelResult.rows.map((r: any) => [r.cupping_note_id, r.descriptor]));
      for (const id of noteIds) {
        if (!noteLabelById.has(id)) {
          res.status(400).json({ error: `tastedNoteIds contains an id not offered for this coffee: ${id}` });
          return;
        }
      }
    }

    // Is this a revision? Find this order's current (non-superseded) doc, if any.
    // Equality-only query (no orderBy) so it needs no composite index; volume per
    // order is always tiny.
    const existingSnap = await firestoreDb
      .collection(`users/${req.uid}/feedback_events`)
      .where('orderId', '==', orderId)
      .get();
    const activeDoc = existingSnap.docs.find(d => !d.data().supersededAt);
    const isRevision = !!activeDoc;

    const sentiment: 'positive' | 'negative' | 'neutral' =
      rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
    const sValue = (rating - 1) / 4;

    if (activeDoc) {
      await activeDoc.ref.update({ supersededAt: FieldValue.serverTimestamp() });
    }

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
      expectation: expectation ?? null,
      descriptors: noteIds.map(id => noteLabelById.get(id)).filter((d): d is string => !!d),
      // Additive — descriptors above is the label array every consumer already
      // reads; tastedNoteIds is only for Part 5's edit-prefill (needs the actual
      // chip ids, not just their labels, to re-check the right chips).
      tastedNoteIds: noteIds,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Follows the *latest* sentiment (Part 5) — a revision upward clears the
    // flag, a revision downward (re-)sets it. Scoped to this event only, same
    // as the pre-Part-5 logic did (not a rescan across the user's other orders).
    await firestoreDb.doc(`users/${req.uid}/metadata/confidence_profile`).set({
      hasPendingNegativeFeedback: sentiment === 'negative',
      ...(sentiment === 'negative'
        ? { negativeFeedbackBlendId: blendId, negativeFeedbackDetectedAt: FieldValue.serverTimestamp(), negativeFeedbackSource: 'onsite' }
        : {}),
    }, { merge: true }).catch(() => {});

    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const profileId = profileResult.rows[0]?.id;

    // user_flavor_feedback — no supersede column, and it feeds
    // v_collaborative_flavor_wheel by row count, so a revision deletes this
    // user's rows for this order and inserts the new chips rather than
    // appending: these rows represent the user's *current* opinion, not an
    // append-only audit trail (that trail already lives in feedback_events).
    if (profileId) {
      if (isRevision) {
        await db.query(`DELETE FROM user_flavor_feedback WHERE user_id = $1 AND order_id = $2`, [profileId, orderId]);
      }
      if (noteIds.length && coffeeId) {
        for (const noteId of noteIds) {
          await db.query(
            `INSERT INTO user_flavor_feedback (user_id, coffee_id, order_id, cupping_note_id, intensity, notes)
             VALUES ($1, $2, $3, $4, NULL, NULL)`,
            [profileId, coffeeId, orderId, noteId]
          );
        }
      }
    }

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

    res.json({ ok: true, revised: isRevision });

    computeBehavioralConfidence(req.uid!).catch(err => console.error('[orders/feedback/bc]', err));
    refreshLifecycleState(req.uid!).catch(err => console.error('[orders/feedback/lifecycle]', err));
  } catch (err) {
    console.error('[orders/feedback]', err);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

export default router;
