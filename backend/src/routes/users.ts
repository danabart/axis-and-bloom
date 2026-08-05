import { Router } from 'express';
import { requireAuth, blockAnonymousAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';
import { getUserSignals } from '../services/userSignals.js';
import { classifyStage, getPendingFeedbackOrder, refreshLifecycleState } from '../services/userLifecycle.js';
import {
  getBrewProfileFieldsConfig,
  validateSingleValue,
  incrementBrewProfileCounter,
} from '../services/brewProfile.js';
import { getUserBrewCards } from '../services/brewCard.js';
import { getAliases } from '../services/sommelierRag.js';

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

    // Step 04 (A2): drives the firm quiz gate's "signed-in + already subscribed →
    // no card, no consent copy repeat" branch. Depends on the resolved primary
    // email above, so queried separately rather than folded into the Promise.all.
    let isNewsletterSubscriber = false;
    const primaryEmail = emailResult.rows[0]?.email_address ?? req.email ?? null;
    if (primaryEmail) {
      const newsletterResult = await db.query(
        `SELECT 1 FROM newsletter_subscriber WHERE email = $1 AND subscribed = TRUE LIMIT 1`,
        [primaryEmail.toLowerCase().trim()]
      );
      isNewsletterSubscriber = newsletterResult.rows.length > 0;
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
      phoneNumber: phoneResult.rows[0]?.phone_number ?? null,
      isNewsletterSubscriber,
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

// Profile Part 4: accepts digits/+/spaces/dashes/parens, normalizes to
// [+]digits. No existing phone-creation/normalization path to reuse —
// grepped the whole backend (including the checkout route the spec pointed
// at) and found none; user_phone rows today only ever exist from manual/
// admin seeding, not any live app code path.
function normalizePhoneNumber(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^[0-9+\-\s()]+$/.test(trimmed)) return null;
  const digitsOnly = trimmed.replace(/[^\d+]/g, '');
  if (!/^\+?\d{7,15}$/.test(digitsOnly)) return null;
  return digitsOnly;
}

// ── PATCH /api/users/profile ──────────────────────────────────────────────────
router.patch('/profile', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  const { firstName, lastName, dateOfBirth, smsOptIn, phoneNumber } = req.body ?? {};

  // Validated before any write — a garbage number must leave nothing written.
  let normalizedPhone: string | null = null;
  if (typeof phoneNumber === 'string' && phoneNumber.trim().length > 0) {
    normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone) {
      res.status(400).json({ error: 'Enter a valid phone number.' });
      return;
    }
  }

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

    // Phone add/change — deliberately does not touch sms_opt_in either way
    // (opt-in stays its own explicit toggle, per the spec).
    if (normalizedPhone) {
      const profileResult = await db.query(
        `SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]
      );
      const profileId = profileResult.rows[0]?.id;
      if (profileId) {
        try {
          const existing = await db.query(
            `SELECT id FROM user_phone WHERE user_id = $1 AND is_primary = true`,
            [profileId]
          );
          if (existing.rows.length) {
            await db.query(
              `UPDATE user_phone SET phone_number = $2, is_verified = false, updated_at = NOW() WHERE id = $1`,
              [existing.rows[0].id, normalizedPhone]
            );
          } else {
            await db.query(
              `INSERT INTO user_phone (user_id, phone_number, is_primary, is_verified, sms_opt_in)
               VALUES ($1, $2, true, false, false)`,
              [profileId, normalizedPhone]
            );
          }
        } catch (err: any) {
          if (err.code === '23505') { // unique_violation — phone_number is UNIQUE across all users
            res.status(400).json({ error: 'This phone number is already associated with another account.' });
            return;
          }
          throw err;
        }
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
// schema.sql comment above user_bloom_dial_current_position.
router.get('/dial-position', requireAuth, async (req: AuthRequest, res) => {
  const archetype = req.query.archetype as string;
  if (!archetype) { res.status(400).json({ error: 'archetype is required' }); return; }
  try {
    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const profileId = profileResult.rows[0]?.id;
    if (!profileId) { res.status(404).json({ error: 'Profile not found' }); return; }

    const result = await db.query(
      `SELECT dial_sort_order FROM user_bloom_dial_current_position WHERE user_id = $1 AND archetype = $2`,
      [profileId, archetype]
    );
    res.json({ dialSortOrder: result.rows[0]?.dial_sort_order ?? null });
  } catch (err) {
    console.error('[GET /api/users/dial-position]', err);
    res.status(500).json({ error: 'Failed to fetch dial position' });
  }
});

// Liam Dial Event Log — the only two intentional-movement kinds ever logged (plain
// dial turns are exploration noise, deliberately not logged). Kept in sync with
// ArchetypeSection.tsx's `source` prop values.
const DIAL_EVENT_TRIGGERS = ['explicit_save', 'add_to_cart'] as const;
const DIAL_EVENT_SOURCES = ['bloom', 'find_my_flavor_returning', 'find_my_flavor_results', 'profile'] as const;

// ── PATCH /api/users/dial-position — upsert on (user_id, archetype) ───────────
// Requests without `trigger` are the silent auto-save path (every dial turn) —
// SQL upsert only, exactly as before. Requests with a valid `trigger` additionally
// append a Firestore users/{uid}/dial_events doc recording the *intentional* moment
// (explicit save or add-to-cart) — fire-and-forget, a logging failure must never
// fail the request itself.
router.patch('/dial-position', requireAuth, async (req: AuthRequest, res) => {
  const { archetype, dialSortOrder, trigger, source, coffeeId, platformName } = req.body ?? {};
  if (!archetype || !Number.isInteger(dialSortOrder)) {
    res.status(400).json({ error: 'archetype and dialSortOrder are required' }); return;
  }
  if (trigger !== undefined && !DIAL_EVENT_TRIGGERS.includes(trigger)) {
    res.status(400).json({ error: 'invalid trigger' }); return;
  }
  try {
    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const profileId = profileResult.rows[0]?.id;
    if (!profileId) { res.status(404).json({ error: 'Profile not found' }); return; }

    await db.query(
      `INSERT INTO user_bloom_dial_current_position (user_id, archetype, dial_sort_order, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, archetype)
       DO UPDATE SET dial_sort_order = $3, updated_at = NOW()`,
      [profileId, archetype, dialSortOrder]
    );

    if (trigger) {
      // Profile Part 7 Task 1 — coffeeId is unified across both trigger kinds
      // (previously add_to_cart-only); platformName is new, a display-name
      // snapshot at save time (roaster-blind — see the flavor-memory route
      // below). Neither field trigger-gated: whichever the caller sends is
      // validated and stored, absent otherwise.
      firestoreDb.collection(`users/${req.uid}/dial_events`).add({
        trigger,
        archetype,
        dialSortOrder,
        source: DIAL_EVENT_SOURCES.includes(source) ? source : null,
        coffeeId: Number.isInteger(coffeeId) ? coffeeId : null,
        platformName: typeof platformName === 'string' && platformName.trim() ? platformName.trim() : null,
        createdAt: FieldValue.serverTimestamp(),
      }).catch((err: unknown) => console.error('[dial-position] dial_events log failed:', err));
    }

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

    const [ordersResult, contributionResult, savedEventsSnap, recipeSnap, brewCardRows] = await Promise.all([
      db.query(
        `SELECT o.id, o.created_at,
                (ARRAY_AGG(rb.blend_name))[1] AS blend_name,
                (ARRAY_AGG(rb.coffee_id))[1]  AS coffee_id,
                (ARRAY_AGG(aa.archetype))[1]  AS archetype
         FROM "order" o
         LEFT JOIN order_line_item li ON li.order_id = o.id
         LEFT JOIN roaster_blend rb ON rb.id = li.blend_id
         LEFT JOIN archetype_assignments aa ON aa.coffee_id = rb.coffee_id AND aa.superseded_at IS NULL
         WHERE o.user_id = $1
         GROUP BY o.id ORDER BY o.created_at DESC`,
        [profileId]
      ),
      db.query(`SELECT COUNT(*) FROM user_flavor_feedback WHERE user_id = $1`, [profileId]),
      // Profile Part 7 Task 3 — 'saved' activity source. Filtered to explicit_save
      // only (add_to_cart is never a journal entry, per the editorial rule);
      // removedAt tombstones are filtered in code below, not in the query, to
      // avoid a composite-field Firestore index requirement for a field that
      // may not exist on most docs.
      firestoreDb.collection(`users/${req.uid}/dial_events`).where('trigger', '==', 'explicit_save').get()
        .catch((err: unknown) => { console.error('[/api/users/flavor-memory] dial_events read failed:', err); return null; }),
      // 'recipe' activity source (Task 5's liam_saves) — collection may not
      // exist yet for any given user, which reads as empty, not an error.
      firestoreDb.collection(`users/${req.uid}/liam_saves`).get()
        .catch((err: unknown) => { console.error('[/api/users/flavor-memory] liam_saves read failed:', err); return null; }),
      // HOME_TASK_6 — brew cards, read-only v1 display.
      getUserBrewCards(profileId).catch((err: unknown) => { console.error('[/api/users/flavor-memory] brew cards read failed:', err); return []; }),
    ]);

    // Alias only — never coffees.name/roaster, same S44/S77 discipline as
    // every other customer-facing render path.
    const brewCardCoffeeIds = [...new Set(brewCardRows.map(c => c.coffeeId))];
    const brewCardAliasMap = brewCardCoffeeIds.length ? await getAliases(brewCardCoffeeIds) : new Map<number, string>();
    const brewCards = brewCardRows.map(c => ({
      id: c.id,
      coffeeId: c.coffeeId,
      coffeeName: brewCardAliasMap.get(c.coffeeId) ?? null,
      method: c.method,
      ratio: c.params.ratio,
      grindLabel: c.params.grindLabel,
      tempC: c.params.tempC,
      notes: c.params.notes,
      revision: c.revision,
      lastAdjustmentReason: c.lastAdjustmentReason,
      updatedAt: c.updatedAt,
    }));

    // HOME_TASK_9 (§7) — the lightweight brew-card view log Task 6 didn't
    // add: one row per card rendered here, fire-and-forget, never blocking
    // the response. This is the §7 engagement definition's data source for
    // "a brew card viewed" — coarse per-render logging, not a unique-viewer
    // count (see schema.sql's own comment on the table).
    if (brewCards.length) {
      const values = brewCards.map((_, i) => `($1, $${i + 2})`).join(', ');
      db.query(
        `INSERT INTO brew_card_view_event (user_id, card_id) VALUES ${values}`,
        [profileId, ...brewCards.map(c => c.id)]
      ).catch((err: unknown) => console.error('[/api/users/flavor-memory] brew_card_view_event log failed:', err));
    }

    // One Firestore read for every feedback event this user has, matched to
    // orders in code below — not a per-order query.
    const feedbackByOrder = new Map<string, {
      rating: number | null; note: string | null; source: string | null;
      expectation: string | null; tastedNoteIds: string[];
    }>();
    try {
      const feedbackSnap = await firestoreDb.collection(`users/${req.uid}/feedback_events`).get();
      for (const doc of feedbackSnap.docs) {
        const d = doc.data();
        // Skip superseded docs (Profile Part 5) — only the current revision
        // per order should populate the journal; there is at most one
        // non-superseded doc per orderId by construction.
        if (d.supersededAt) continue;
        if (d.orderId) {
          feedbackByOrder.set(d.orderId, {
            rating: d.rating ?? null,
            note:   d.rawText ?? null,
            source: d.source ?? null,
            expectation:   d.expectation ?? null,
            tastedNoteIds: Array.isArray(d.tastedNoteIds) ? d.tastedNoteIds : [],
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
        // For Part 5's edit-prefill only — additive.
        expectation:   fb?.expectation ?? null,
        tastedNoteIds: fb?.tastedNoteIds ?? [],
      };
    });

    // Journey — Firestore users/{uid}/metadata/taste_journey (Sommelier Task 1
    // §12, written fire-and-forget on every authenticated quiz save; path fixed
    // to a valid 4-segment doc reference alongside quiz.ts — see the comment
    // there). archetype here is stored as the human-readable name (quiz.ts
    // writes `archetype` from the request body verbatim), so it's mapped to the
    // enum key the rest of this route already uses via ARCHETYPE_NAME_TO_KEY,
    // same as archetypeKey above.
    // Profile Part 6: the synthetic single-entry fallback below must only
    // trigger for a genuinely-missing doc, not for a read that threw (a real
    // error masquerading as "new user" would silently hide a read bug behind
    // fabricated data). readFailed is tracked separately from an empty/absent
    // doc so only the former takes the fallback path.
    let journey: Array<{ archetype: string; archetypeLabel: string; at: string | null; trigger: string }> = [];
    let journeyDocMissing = true;
    let journeyReadFailed = false;
    try {
      const journeySnap = await firestoreDb.doc(`users/${req.uid}/metadata/taste_journey`).get();
      journeyDocMissing = !journeySnap.exists;
      const journeyData = journeySnap.exists ? journeySnap.data() : null;
      const history: any[] = journeyData?.archetypeHistory ?? [];
      journey = history.map(h => ({
        archetype:      ARCHETYPE_NAME_TO_KEY[h.archetype] ?? String(h.archetype ?? '').toLowerCase(),
        archetypeLabel: h.archetype,
        at:             h.date?.toDate ? h.date.toDate().toISOString() : (h.date ?? null),
        trigger:        h.trigger === 'first_quiz' ? 'first_quiz' : 'retake',
      }));
    } catch (err) {
      console.error('[/api/users/flavor-memory] taste_journey read failed:', err);
      journeyReadFailed = true;
    }

    // Backfill caveat (Profile Part 2): users who quizzed before Sommelier Task 1
    // shipped have a missing/empty taste_journey doc. Falls back to a single
    // synthetic entry from the user's current archetype + quiz date, so a
    // matched user always shows >=1 entry. Only applies when the doc is
    // genuinely missing — a real read failure surfaces as a 500 instead of
    // silently fabricating history (Part 6).
    if (journeyReadFailed) {
      res.status(500).json({ error: 'Failed to fetch flavor memory' });
      return;
    }
    if (journey.length === 0 && journeyDocMissing) {
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

    // Profile Part 7 Task 3 — the activity log. Additive: journal/journey/
    // contributionCount above are unchanged for their existing consumers
    // (TastingJournal's feedback machinery, the Part 2/6 backfill contract).
    // Editorial rule (binding): only deliberate moments — quiz, order, explicit
    // save, accepted Liam recipe. No add_to_cart, rotation, reveal, or inferred
    // entries, ever.
    const quizActivity = journey.map((j, i) => ({
      id: `quiz_${i}`,
      type: 'quiz' as const,
      at: j.at,
      archetype: j.archetype,
      archetypeLabel: j.archetypeLabel,
      trigger: j.trigger,
      removable: false,
    }));

    // Task 6's derived-reading-line signal needs an archetype per order too —
    // resolved via the same archetype_assignments join used everywhere else
    // in this file, current assignment only (superseded_at IS NULL). Kept out
    // of `journal` itself so that response shape (and its existing consumers)
    // stays untouched.
    const orderedActivity = ordersResult.rows.map(o => ({
      id: o.id,
      type: 'ordered' as const,
      at: new Date(o.created_at).toISOString(),
      archetype: o.archetype ?? null,
      archetypeLabel: o.archetype ? (ARCHETYPES[o.archetype]?.name ?? null) : null,
      coffeeName: o.blend_name ?? null,
      removable: false,
    }));

    // 'saved' — explicit_save dial_events, tombstones filtered here (not in the
    // Firestore query, see the read above). Legacy pre-Task-1 events (no
    // coffeeId/platformName) render honestly as position-only — never resolved
    // at read time (drift + roaster-blind, same reasoning as journal above).
    const savedActivity = (savedEventsSnap?.docs ?? [])
      .filter(doc => !doc.data().removedAt)
      .map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          type: 'saved' as const,
          at: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : null,
          archetype: d.archetype ?? null,
          archetypeLabel: d.archetype ? (ARCHETYPES[d.archetype]?.name ?? null) : null,
          dialSortOrder: typeof d.dialSortOrder === 'number' ? d.dialSortOrder : null,
          coffeeName: d.platformName ?? null,
          removable: true,
        };
      });

    // 'recipe' — Task 5's liam_saves, tombstones filtered the same way.
    const recipeActivity = (recipeSnap?.docs ?? [])
      .filter(doc => !doc.data().removedAt)
      .map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          type: 'recipe' as const,
          at: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : null,
          title: d.title ?? null,
          body: d.body ?? null,
          coffeeName: d.coffeeName ?? null,
          removable: true,
        };
      });

    const activity = [...quizActivity, ...orderedActivity, ...savedActivity, ...recipeActivity]
      .sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

    res.json({
      journal,
      journey,
      activity,
      contributionCount: Number(contributionResult.rows[0]?.count ?? 0),
      brewCards,
    });
  } catch (err) {
    console.error('[/api/users/flavor-memory]', err);
    res.status(500).json({ error: 'Failed to fetch flavor memory' });
  }
});

// Profile Part 7 Task 2 — removable kinds. Both routes tombstone only (never
// a hard delete — the Dial Event Log keeps full history for Liam/analytics).
// Ownership is implicit in the doc path (scoped to req.uid by construction);
// the explicit_save check on the first route rejects an attempt to remove an
// add_to_cart event, the only other kind that lives in the same collection.
router.patch('/flavor-memory/saved/:docId/remove', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ref = firestoreDb.doc(`users/${req.uid}/dial_events/${req.params.docId}`);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ error: 'Not found' }); return; }
    const d = snap.data()!;
    if (d.trigger !== 'explicit_save') { res.status(400).json({ error: 'Not removable' }); return; }
    if (!d.removedAt) {
      await ref.update({ removedAt: FieldValue.serverTimestamp() });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /api/users/flavor-memory/saved/:docId/remove]', err);
    res.status(500).json({ error: 'Failed to remove entry' });
  }
});

router.patch('/flavor-memory/recipes/:docId/remove', requireAuth, async (req: AuthRequest, res) => {
  try {
    const ref = firestoreDb.doc(`users/${req.uid}/liam_saves/${req.params.docId}`);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ error: 'Not found' }); return; }
    if (!snap.data()?.removedAt) {
      await ref.update({ removedAt: FieldValue.serverTimestamp() });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /api/users/flavor-memory/recipes/:docId/remove]', err);
    res.status(500).json({ error: 'Failed to remove entry' });
  }
});

// Profile Part 7 Task 5 — Liam recipe saves. User-initiated, not something the
// LLM triggers: Liam only marks an offer as appropriate (the save_recipe
// action, see sommelier.ts/claude.ts); this endpoint only fires because the
// signed-in user tapped the chip. title/body come from that already-rendered
// chat message on the client — server just length-validates and stores.
router.post('/flavor-memory/liam-saves', requireAuth, async (req: AuthRequest, res) => {
  const { title, body } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    res.status(400).json({ error: 'invalid title' }); return;
  }
  if (typeof body !== 'string' || !body.trim() || body.length > 4000) {
    res.status(400).json({ error: 'invalid body' }); return;
  }
  try {
    const ref = await firestoreDb.collection(`users/${req.uid}/liam_saves`).add({
      kind: 'recipe',
      title: title.trim(),
      body: body.trim(),
      coffeeName: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, id: ref.id });
  } catch (err) {
    console.error('[POST /api/users/flavor-memory/liam-saves]', err);
    res.status(500).json({ error: 'Failed to save recipe' });
  }
});

// ── GET /api/users/brew-profile ───────────────────────────────────────────────
// HOME_TASK_4 (§4.5 write rule 2) — the day-one mirror: read, edit, delete per
// field. A missing doc is a normal, common state (no facts captured yet), not
// an error — returns {} rather than 404.
router.get('/brew-profile', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  try {
    const snap = await firestoreDb.doc(`users/${req.uid}/metadata/brew_profile`).get();
    if (!snap.exists) { res.json({}); return; }
    const data = snap.data() ?? {};
    const profile: Record<string, unknown> = {};
    for (const [field, entry] of Object.entries(data)) {
      if (field === 'updatedAt' || !entry || typeof entry !== 'object') continue;
      const e = entry as { value?: unknown; source?: string; capturedAt?: { toDate?: () => Date } };
      profile[field] = {
        value: e.value ?? null,
        source: e.source ?? null,
        capturedAt: typeof e.capturedAt?.toDate === 'function' ? e.capturedAt.toDate().toISOString() : null,
      };
    }
    res.json(profile);
  } catch (err) {
    console.error('[GET /api/users/brew-profile]', err);
    res.status(500).json({ error: 'Failed to fetch brew profile' });
  }
});

// ── PATCH /api/users/brew-profile ─────────────────────────────────────────────
// Self-serve edit — the customer supplies the full intended value for a field
// (replace, not append; the conversation path's append/dedup semantics in
// sommelier.ts's resolveRemember() are a separate, incremental capture mode).
// Validated against the same whitelist as the conversation path, source
// stamped 'profile_page'. Direct API input gets a clear 400, not a silent drop
// — but still counted, same as the conversation path (write rule 3).
router.patch('/brew-profile', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  const { field, value } = req.body ?? {};
  if (typeof field !== 'string') { res.status(400).json({ error: 'field required' }); return; }

  const fieldsCfg = getBrewProfileFieldsConfig();
  const fieldCfg = fieldsCfg[field];
  if (!fieldCfg) {
    await incrementBrewProfileCounter('failures');
    res.status(400).json({ error: `Unknown field: ${field}` });
    return;
  }

  let validatedValue: unknown;
  if (fieldCfg.type === 'array' || fieldCfg.type === 'array_freeform') {
    if (!Array.isArray(value)) {
      await incrementBrewProfileCounter('failures');
      res.status(400).json({ error: `${field} must be an array` });
      return;
    }
    const seen = new Set<string>();
    const validatedItems: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const v = validateSingleValue(fieldCfg, item);
      if (v !== null && !seen.has(v as string)) { seen.add(v as string); validatedItems.push(v as string); }
    }
    if (validatedItems.length !== value.length) {
      await incrementBrewProfileCounter('failures');
      res.status(400).json({ error: `One or more values for ${field} are not allowed` });
      return;
    }
    validatedValue = validatedItems.slice(0, fieldCfg.maxLength ?? 10);
  } else {
    if (typeof value !== 'string') {
      await incrementBrewProfileCounter('failures');
      res.status(400).json({ error: `${field} must be a string` });
      return;
    }
    const v = validateSingleValue(fieldCfg, value);
    if (v === null) {
      await incrementBrewProfileCounter('failures');
      res.status(400).json({ error: `Invalid value for ${field}: ${value}` });
      return;
    }
    validatedValue = v;
  }

  try {
    await firestoreDb.doc(`users/${req.uid}/metadata/brew_profile`).set(
      {
        [field]: { value: validatedValue, source: 'profile_page', capturedAt: FieldValue.serverTimestamp() },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await incrementBrewProfileCounter('writes');
    res.json({ ok: true, field, value: validatedValue });
  } catch (err) {
    console.error('[PATCH /api/users/brew-profile]', err);
    await incrementBrewProfileCounter('failures');
    res.status(500).json({ error: 'Failed to save brew profile field' });
  }
});

// ── DELETE /api/users/brew-profile ────────────────────────────────────────────
// Delete = field removal (FieldValue.delete()), never a null-write — a null
// value would still read as "captured, unknown" to the summary formatter,
// whereas removal reads as "nothing captured", matching what the customer asked for.
router.delete('/brew-profile', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  const field = typeof req.body?.field === 'string' ? req.body.field : (req.query.field as string | undefined);
  if (!field || !getBrewProfileFieldsConfig()[field]) {
    res.status(400).json({ error: 'Unknown or missing field' });
    return;
  }
  try {
    // set(..., merge) rather than update() — the doc may not exist yet if the
    // customer never captured anything else; update() would throw NOT_FOUND.
    await firestoreDb.doc(`users/${req.uid}/metadata/brew_profile`).set(
      { [field]: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await incrementBrewProfileCounter('writes');
    res.json({ ok: true, field });
  } catch (err) {
    console.error('[DELETE /api/users/brew-profile]', err);
    await incrementBrewProfileCounter('failures');
    res.status(500).json({ error: 'Failed to delete brew profile field' });
  }
});

export default router;
