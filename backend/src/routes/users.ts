import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';
import { getUserSignals } from '../services/userSignals.js';
import { classifyStage, getPendingFeedbackOrder, refreshLifecycleState } from '../services/userLifecycle.js';

const router = Router();

// Keyed by archetype_enum (schema.sql) — matches the archetype key format used everywhere
// else (dial_archetype_config, /api/coffees/archetypes' `archetype` field, etc.), NOT a
// shorthand of the display name. Previously keyed by shorthand ('chocolate', 'balanced',
// 'spicy') while lookups below derive the key via `archetype.name.toLowerCase()` — for
// 'Chocolate & Nutty' / 'Balanced & Sweet' / 'Earthy' that produces 'chocolate & nutty' /
// 'balanced & sweet' / 'earthy', none of which matched the old shorthand keys (only
// 'floral' / 'fruity' / 'experimental' happened to survive .toLowerCase() unscathed).
// Those three silently fell through to the generic-rust-color/no-features fallback below,
// and worse, the mangled `.id` that shape produced didn't match archetype_enum, breaking
// BloomPage.tsx's "your matched archetype" personalization for those users too. Fixed by
// normalizing this map's keys to archetype_enum and deriving the lookup key from an
// explicit name→enum-key table (below) instead of a blind .toLowerCase().
const ARCHETYPES: Record<string, { name: string; features: string[]; color: string }> = {
  floral:          { name: 'Floral',            color: '#a34b78', features: ['You prefer delicate aromatics over heavy roasts', 'You enjoy a light, tea-like body', 'You appreciate a bright, clean finish'] },
  fruity:          { name: 'Fruity',            color: '#ca445f', features: ['You prefer juicy acidity and bright notes', 'You enjoy vibrant fruit-forward flavors', 'You appreciate a crisp, clean finish'] },
  balanced_sweet:  { name: 'Balanced & Sweet',  color: '#d1ac11', features: ['You prefer lower acidity and round body', 'You enjoy caramelized and nutty sweetness', 'You are less sensitive to roast intensity'] },
  chocolate_nutty: { name: 'Chocolate & Nutty', color: '#a54c2d', features: ['You prefer a bold and comforting cup', 'You enjoy deep cocoa and roasted nut flavors', 'You appreciate a heavy, satisfying body'] },
  earthy:          { name: 'Earthy',            color: '#912f2f', features: ['You prefer a complex, savory depth', 'You enjoy warming spices and earthy notes', 'You appreciate a thick, structured finish'] },
  experimental:    { name: 'Experimental',      color: '#056c7a', features: ['You prefer unique, unexpected flavor profiles', 'You enjoy wild fermentation and intense fruit', 'You appreciate complex, lively acidity'] },
};

const ARCHETYPE_NAME_TO_KEY: Record<string, string> = {
  'Chocolate & Nutty': 'chocolate_nutty',
  'Balanced & Sweet':  'balanced_sweet',
  'Fruity':            'fruity',
  'Earthy':            'earthy',
  'Floral':            'floral',
  'Experimental':      'experimental',
};

// ── GET /api/users/profile ────────────────────────────────────────────────────
router.get('/profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profileResult = await db.query(
      `INSERT INTO user_profile (firebase_uid)
       VALUES ($1)
       ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = NOW()
       RETURNING id, first_name, last_name, date_of_birth`,
      [req.uid]
    );
    const profileRow = profileResult.rows[0];
    const profileId = profileRow.id;

    if (req.email) {
      await db.query(
        `INSERT INTO user_email (user_id, email_address, is_primary, is_verified)
         VALUES ($1, $2, true, true)
         ON CONFLICT (email_address) DO NOTHING`,
        [profileId, req.email]
      );
    }

    const [emailResult, quizResult, ordersResult, roleResult, addressResult, phoneResult] = await Promise.all([
      db.query(
        `SELECT email_address FROM user_email WHERE user_id = $1 AND is_primary = true LIMIT 1`,
        [profileId]
      ),
      db.query(
        `SELECT qs.id, qs.completed_at, a.name AS archetype_name, a.id AS archetype_id
         FROM quiz_session qs
         LEFT JOIN archetype a ON a.id = qs.resulting_archetype_id
         WHERE qs.user_id = $1
         ORDER BY qs.completed_at DESC LIMIT 1`,
        [profileId]
      ),
      db.query(
        `SELECT o.id, o.external_shopify_order_id, o.fulfillment_status, o.created_at,
                COALESCE(SUM(li.unit_price_charged * li.quantity), 0) AS total_cents,
                (ARRAY_AGG(rb.blend_name))[1] AS blend_name
         FROM "order" o
         LEFT JOIN order_line_item li ON li.order_id = o.id
         LEFT JOIN roaster_blend rb ON rb.id = li.blend_id
         WHERE o.user_id = $1
         GROUP BY o.id ORDER BY o.created_at DESC LIMIT 10`,
        [profileId]
      ),
      db.query(
        `SELECT ut.name FROM user_profile up
         LEFT JOIN user_type ut ON ut.id = up.user_type_id
         WHERE up.firebase_uid = $1`,
        [req.uid]
      ),
      db.query(
        `SELECT id, address_type, street, city, state, postal_code, country, is_default
         FROM address WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC`,
        [profileId]
      ),
      db.query(
        `SELECT phone_number, sms_opt_in FROM user_phone WHERE user_id = $1 AND is_primary = true LIMIT 1`,
        [profileId]
      ),
    ]);

    // Token balance is queried separately so a missing table never breaks the profile endpoint
    let tokenBalance = 0;
    try {
      const tokenResult = await db.query(
        `SELECT balance FROM user_tokens WHERE uid = $1`,
        [req.uid]
      );
      tokenBalance = tokenResult.rows.length ? Number(tokenResult.rows[0].balance) : 0;
    } catch {
      // user_tokens table may not exist yet — migrations pending
    }

    const quiz = quizResult.rows[0];
    const archetypeKey = quiz?.archetype_name ? (ARCHETYPE_NAME_TO_KEY[quiz.archetype_name] ?? quiz.archetype_name.toLowerCase()) : null;
    const archetypeData = archetypeKey ? (ARCHETYPES[archetypeKey] ?? { name: quiz.archetype_name, features: [], color: '#a33726' }) : null;

    // Which orders already have a feedback_events doc (any source/channel) —
    // drives the "Leave feedback" affordance in Profile.tsx order history.
    let orderIdsWithFeedback = new Set<string>();
    try {
      const feedbackSnap = await firestoreDb.collection(`users/${req.uid}/feedback_events`).get();
      for (const doc of feedbackSnap.docs) {
        const oid = doc.data().orderId;
        if (oid) orderIdsWithFeedback.add(oid);
      }
    } catch {
      // Subcollection may not exist yet — treat as no feedback captured
    }

    // Sync to Firestore — non-blocking, Cloud SQL is source of truth
    firestoreDb.doc(`users/${req.uid}`).set({
      email:          emailResult.rows[0]?.email_address ?? req.email ?? null,
      firstName:      profileRow.first_name ?? null,
      lastName:       profileRow.last_name ?? null,
      archetype:      archetypeKey,
      archetypeLabel: archetypeData?.name ?? null,
      lastQuizDate:   quiz?.completed_at ?? null,
      syncedAt:       FieldValue.serverTimestamp(),
    }, { merge: true }).catch((err: unknown) => console.error('[users/firestore-sync]', err));

    res.json({
      email:       emailResult.rows[0]?.email_address ?? req.email ?? null,
      firstName:   profileRow.first_name ?? null,
      lastName:    profileRow.last_name ?? null,
      dateOfBirth: profileRow.date_of_birth ?? null,
      displayName: null,
      isAdmin:     roleResult.rows[0]?.name === 'admin',
      archetype:   archetypeData ? { ...archetypeData, id: archetypeKey } : null,
      lastQuizDate: quiz?.completed_at ?? null,
      addresses:   addressResult.rows,
      tokenBalance,
      hasPhone:    phoneResult.rows.length > 0,
      smsOptIn:    phoneResult.rows[0]?.sms_opt_in ?? false,
      orders:      ordersResult.rows.map(o => ({
        id:            o.id,
        shopifyOrderId: o.external_shopify_order_id,
        status:        o.fulfillment_status ?? 'pending',
        total:         `$${(Number(o.total_cents) / 100).toFixed(2)}`,
        date:          new Date(o.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        blendName:     o.blend_name ?? null,
        hasFeedback:   orderIdsWithFeedback.has(o.id),
      })),
    });
  } catch (err) {
    console.error('[/api/users/profile]', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ── PATCH /api/users/profile ──────────────────────────────────────────────────
router.patch('/profile', requireAuth, async (req: AuthRequest, res) => {
  const { firstName, lastName, dateOfBirth, smsOptIn } = req.body ?? {};
  try {
    await db.query(
      `UPDATE user_profile SET
         first_name    = COALESCE($2, first_name),
         last_name     = COALESCE($3, last_name),
         date_of_birth = COALESCE($4::date, date_of_birth),
         updated_at    = NOW()
       WHERE firebase_uid = $1`,
      [req.uid, firstName || null, lastName || null, dateOfBirth || null]
    );

    if (typeof smsOptIn === 'boolean') {
      const profileResult = await db.query(
        `SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]
      );
      const profileId = profileResult.rows[0]?.id;
      if (profileId) {
        await db.query(
          `UPDATE user_phone
           SET sms_opt_in = $2,
               sms_opt_in_at = CASE WHEN $2 = true THEN NOW() ELSE sms_opt_in_at END,
               updated_at = NOW()
           WHERE user_id = $1 AND is_primary = true`,
          [profileId, smsOptIn]
        );
      }
    }

    const fsUpdate: Record<string, unknown> = { syncedAt: FieldValue.serverTimestamp() };
    if (firstName) fsUpdate.firstName = firstName;
    if (lastName)  fsUpdate.lastName  = lastName;
    firestoreDb.doc(`users/${req.uid}`).set(fsUpdate, { merge: true })
      .catch((err: unknown) => console.error('[users/firestore-patch]', err));

    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /api/users/profile]', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ── GET /api/users/homepage-state ─────────────────────────────────────────────
// Single indexed join keyed on user_id — cheap at pageview time, no Firestore
// involved. Falls back to computing live via getUserSignals() only on a user's
// first visit, before any of the three lifecycle-refresh hooks have fired yet.
router.get('/homepage-state', requireAuth, async (req: AuthRequest, res) => {
  try {
    const stateResult = await db.query(
      `SELECT cls.code
       FROM user_lifecycle_state uls
       JOIN user_lifecycle_stage cls ON cls.id = uls.stage_id
       JOIN user_profile up ON up.id = uls.user_id
       WHERE up.firebase_uid = $1`,
      [req.uid]
    );

    const signals = await getUserSignals(req.uid!);
    let stageCode: string | null = stateResult.rows[0]?.code ?? null;
    if (!stageCode) {
      stageCode = classifyStage(signals);
      // Persist for next time — fire-and-forget, doesn't block this response.
      refreshLifecycleState(req.uid!).catch(err => console.error('[users/homepage-state/refresh]', err));
    }

    const archetypeKey = signals.archetype ? (ARCHETYPE_NAME_TO_KEY[signals.archetype] ?? signals.archetype.toLowerCase()) : null;
    const archetypeData = archetypeKey ? (ARCHETYPES[archetypeKey] ?? { name: signals.archetype!, features: [], color: '#a33726' }) : null;

    let pendingFeedback: { orderId: string; blendName: string | null; coffeeId: number | null } | null = null;
    let usualBlend: { id: string; name: string } | null = null;
    let nextDeliveryDate: string | null = null;

    // Independent of stageCode — a subscriber or repeat customer can still have
    // an unanswered feedback ask sitting out there from an early order.
    const pendingFeedbackOrder = getPendingFeedbackOrder(signals);
    if (pendingFeedbackOrder) {
      const blendResult = await db.query(
        `SELECT rb.blend_name, rb.coffee_id FROM order_line_item oli
         JOIN roaster_blend rb ON rb.id = oli.blend_id
         WHERE oli.order_id = $1 LIMIT 1`,
        [pendingFeedbackOrder.orderId]
      );
      pendingFeedback = {
        orderId: pendingFeedbackOrder.orderId,
        blendName: blendResult.rows[0]?.blend_name ?? null,
        coffeeId: blendResult.rows[0]?.coffee_id ?? null,
      };
    }

    if (stageCode === 'REORDER_DUE' && signals.userId) {
      const blendResult = await db.query(
        `SELECT rb.id, rb.blend_name, COUNT(*) AS cnt
         FROM order_line_item oli
         JOIN "order" o ON o.id = oli.order_id
         JOIN roaster_blend rb ON rb.id = oli.blend_id
         WHERE o.user_id = $1
         GROUP BY rb.id, rb.blend_name
         ORDER BY cnt DESC LIMIT 1`,
        [signals.userId]
      );
      if (blendResult.rows.length) {
        usualBlend = { id: blendResult.rows[0].id, name: blendResult.rows[0].blend_name };
      }
    }

    if (stageCode === 'SUBSCRIBER') {
      const subResult = await db.query(
        `SELECT s.next_delivery_date
         FROM subscription s
         JOIN user_profile up ON (up.id = s.user_id OR up.household_id = s.household_id)
         WHERE up.firebase_uid = $1 AND s.status = 'active'
         LIMIT 1`,
        [req.uid]
      );
      nextDeliveryDate = subResult.rows[0]?.next_delivery_date ?? null;
    }

    res.json({
      stageCode,
      archetype: archetypeData ? { ...archetypeData, id: archetypeKey } : null,
      daysSinceQuiz: signals.daysSinceLastQuiz,
      pendingFeedback,
      usualBlend,
      nextDeliveryDate,
    });
  } catch (err) {
    console.error('[/api/users/homepage-state]', err);
    res.status(500).json({ error: 'Failed to fetch homepage state' });
  }
});

// ── POST /api/users/addresses ─────────────────────────────────────────────────
router.post('/addresses', requireAuth, async (req: AuthRequest, res) => {
  const { street, city, state, postalCode, country = 'US', addressType = 'shipping', isDefault = false } = req.body ?? {};
  if (!street || !city || !state || !postalCode) {
    res.status(400).json({ error: 'street, city, state, and postalCode are required' });
    return;
  }
  const type = addressType === 'billing' ? 'billing' : 'shipping';
  try {
    const profileResult = await db.query(
      `SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]
    );
    const profileId = profileResult.rows[0]?.id;
    if (!profileId) { res.status(404).json({ error: 'Profile not found' }); return; }

    // Auto-default if this is the first address of its type, or if explicitly requested
    const existingCount = await db.query(
      `SELECT COUNT(*) FROM address WHERE user_id = $1 AND address_type = $2`, [profileId, type]
    );
    const shouldDefault = isDefault || Number(existingCount.rows[0].count) === 0;
    if (shouldDefault) {
      await db.query(
        `UPDATE address SET is_default = false WHERE user_id = $1 AND address_type = $2`,
        [profileId, type]
      );
    }

    const result = await db.query(
      `INSERT INTO address (user_id, address_type, street, city, state, postal_code, country, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [profileId, type, street, city, state, postalCode, country, shouldDefault]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[POST /api/users/addresses]', err);
    res.status(500).json({ error: 'Failed to save address' });
  }
});

// ── PATCH /api/users/addresses/:id/default ───────────────────────────────────
router.patch('/addresses/:id/default', requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const profileResult = await db.query(
      `SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]
    );
    const profileId = profileResult.rows[0]?.id;
    if (!profileId) { res.status(404).json({ error: 'Profile not found' }); return; }

    // Find the address and its type (ownership check included)
    const addrResult = await db.query(
      `SELECT address_type FROM address WHERE id = $1 AND user_id = $2`,
      [id, profileId]
    );
    if (!addrResult.rows.length) { res.status(404).json({ error: 'Address not found' }); return; }
    const { address_type } = addrResult.rows[0];

    // Unset default for all addresses of this type, then set the target
    await db.query(
      `UPDATE address SET is_default = false WHERE user_id = $1 AND address_type = $2`,
      [profileId, address_type]
    );
    await db.query(
      `UPDATE address SET is_default = true WHERE id = $1`,
      [id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /api/users/addresses/:id/default]', err);
    res.status(500).json({ error: 'Failed to update default address' });
  }
});

// ── DELETE /api/users/addresses/:id ──────────────────────────────────────────
router.delete('/addresses/:id', requireAuth, async (req: AuthRequest, res) => {
  const { id } = req.params;
  try {
    const profileResult = await db.query(
      `SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]
    );
    const profileId = profileResult.rows[0]?.id;
    const result = await db.query(
      `DELETE FROM address WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, profileId]
    );
    if (!result.rowCount) { res.status(404).json({ error: 'Address not found' }); return; }
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/users/addresses]', err);
    res.status(500).json({ error: 'Failed to delete address' });
  }
});

// ── GET /api/users/dial-position?archetype= ───────────────────────────────────
// The Bloom Part 3, Phase D — a signed-in user's remembered Bloom Dial position
// for one archetype. Separate table from user_archetype_tuning on purpose, see
// schema.sql comment above user_bloom_dial_position.
router.get('/dial-position', requireAuth, async (req: AuthRequest, res) => {
  const archetype = req.query.archetype as string;
  if (!archetype) { res.status(400).json({ error: 'archetype is required' }); return; }
  try {
    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const profileId = profileResult.rows[0]?.id;
    if (!profileId) { res.status(404).json({ error: 'Profile not found' }); return; }

    const result = await db.query(
      `SELECT dial_sort_order FROM user_bloom_dial_position WHERE user_id = $1 AND archetype = $2`,
      [profileId, archetype]
    );
    res.json({ dialSortOrder: result.rows[0]?.dial_sort_order ?? null });
  } catch (err) {
    console.error('[GET /api/users/dial-position]', err);
    res.status(500).json({ error: 'Failed to fetch dial position' });
  }
});

// ── PATCH /api/users/dial-position — upsert on (user_id, archetype) ───────────
router.patch('/dial-position', requireAuth, async (req: AuthRequest, res) => {
  const { archetype, dialSortOrder } = req.body ?? {};
  if (!archetype || !Number.isInteger(dialSortOrder)) {
    res.status(400).json({ error: 'archetype and dialSortOrder are required' }); return;
  }
  try {
    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const profileId = profileResult.rows[0]?.id;
    if (!profileId) { res.status(404).json({ error: 'Profile not found' }); return; }

    await db.query(
      `INSERT INTO user_bloom_dial_position (user_id, archetype, dial_sort_order, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, archetype)
       DO UPDATE SET dial_sort_order = $3, updated_at = NOW()`,
      [profileId, archetype, dialSortOrder]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /api/users/dial-position]', err);
    res.status(500).json({ error: 'Failed to save dial position' });
  }
});

// ── GET /api/users/flavor-memory ──────────────────────────────────────────────
// Profile Part 2 — the three content blocks behind the Profile page's Flavor
// Memory tab: tasting journal (orders merged with Firestore feedback_events,
// one read for all events, matched in code — not queried per order), archetype
// journey (Firestore taste_journey doc), and contributionCount (this user's
// user_flavor_feedback rows, which feed the Collaborative Flavor Wheel's client
// source). Roaster-blind reasoning: blendName here is the user's own past
// order, same precedent that already clears pendingFeedback.blendName for UC3 —
// never a raw coffee/roaster name for catalogue browsing.
router.get('/flavor-memory', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const profileId = profileResult.rows[0]?.id;
    if (!profileId) { res.status(404).json({ error: 'Profile not found' }); return; }

    const [ordersResult, contributionResult] = await Promise.all([
      db.query(
        `SELECT o.id, o.created_at,
                (ARRAY_AGG(rb.blend_name))[1] AS blend_name,
                (ARRAY_AGG(rb.coffee_id))[1]  AS coffee_id
         FROM "order" o
         LEFT JOIN order_line_item li ON li.order_id = o.id
         LEFT JOIN roaster_blend rb ON rb.id = li.blend_id
         WHERE o.user_id = $1
         GROUP BY o.id ORDER BY o.created_at DESC`,
        [profileId]
      ),
      db.query(`SELECT COUNT(*) FROM user_flavor_feedback WHERE user_id = $1`, [profileId]),
    ]);

    // One Firestore read for every feedback event this user has, matched to
    // orders in code below — not a per-order query.
    const feedbackByOrder = new Map<string, { rating: number | null; note: string | null; source: string | null }>();
    try {
      const feedbackSnap = await firestoreDb.collection(`users/${req.uid}/feedback_events`).get();
      for (const doc of feedbackSnap.docs) {
        const d = doc.data();
        if (d.orderId) {
          feedbackByOrder.set(d.orderId, {
            rating: d.rating ?? null,
            note:   d.rawText ?? null,
            source: d.source ?? null,
          });
        }
      }
    } catch {
      // Subcollection may not exist yet — treat as no feedback captured
    }

    const journal = ordersResult.rows.map(o => {
      const fb = feedbackByOrder.get(o.id);
      return {
        orderId:   o.id,
        // ISO, not a pre-formatted display string — the journal only needs
        // month+year granularity (Profile Part 3 §2), coarser than the full
        // date /profile's order history already formats server-side.
        date:      new Date(o.created_at).toISOString(),
        blendName: o.blend_name ?? null,
        coffeeId:  o.coffee_id ?? null,
        rating:    fb?.rating ?? null,
        note:      fb?.note ?? null,
        source:    fb?.source ?? null,
        hasFeedback: !!fb,
      };
    });

    // Journey — Firestore users/{uid}/metadata/taste_journey (Sommelier Task 1
    // §12, written fire-and-forget on every authenticated quiz save; path fixed
    // to a valid 4-segment doc reference alongside quiz.ts — see the comment
    // there). archetype here is stored as the human-readable name (quiz.ts
    // writes `archetype` from the request body verbatim), so it's mapped to the
    // enum key the rest of this route already uses via ARCHETYPE_NAME_TO_KEY,
    // same as archetypeKey above.
    let journey: Array<{ archetype: string; archetypeLabel: string; at: string | null; trigger: string }> = [];
    try {
      const journeySnap = await firestoreDb.doc(`users/${req.uid}/metadata/taste_journey`).get();
      const journeyData = journeySnap.exists ? journeySnap.data() : null;
      const history: any[] = journeyData?.archetypeHistory ?? [];
      journey = history.map(h => ({
        archetype:      ARCHETYPE_NAME_TO_KEY[h.archetype] ?? String(h.archetype ?? '').toLowerCase(),
        archetypeLabel: h.archetype,
        at:             h.date?.toDate ? h.date.toDate().toISOString() : (h.date ?? null),
        trigger:        h.trigger === 'first_quiz' ? 'first_quiz' : 'retake',
      }));
    } catch {
      // Doc may not exist yet — backfill fallback below covers this
    }

    // Backfill caveat (Profile Part 2): users who quizzed before Sommelier Task 1
    // shipped have a missing/empty taste_journey doc. Falls back to a single
    // synthetic entry from the user's current archetype + quiz date, so a
    // matched user always shows >=1 entry.
    if (journey.length === 0) {
      const quizResult = await db.query(
        `SELECT qs.completed_at, a.name AS archetype_name
         FROM quiz_session qs
         LEFT JOIN archetype a ON a.id = qs.resulting_archetype_id
         WHERE qs.user_id = $1
         ORDER BY qs.completed_at DESC LIMIT 1`,
        [profileId]
      );
      const quiz = quizResult.rows[0];
      if (quiz?.archetype_name) {
        journey = [{
          archetype:      ARCHETYPE_NAME_TO_KEY[quiz.archetype_name] ?? quiz.archetype_name.toLowerCase(),
          archetypeLabel: quiz.archetype_name,
          at:             quiz.completed_at,
          trigger:        'first_quiz',
        }];
      }
    }

    res.json({
      journal,
      journey,
      contributionCount: Number(contributionResult.rows[0]?.count ?? 0),
    });
  } catch (err) {
    console.error('[/api/users/flavor-memory]', err);
    res.status(500).json({ error: 'Failed to fetch flavor memory' });
  }
});

export default router;
