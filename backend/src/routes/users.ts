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
import { hasLiamAccess } from '../services/liamAccess.js';
import { getAliases } from '../services/sommelierRag.js';
import { archetypeCode, archetypeLabel as catalogArchetypeLabel, archetypeCustomerWords } from '../services/catalogReads.js';
import { record } from '../services/customerFacts.js';
import { getTimeline, getFeedbackCurrent, getBrewProfileCurrent } from '../services/customerReads.js';
import { createHash, randomUUID } from 'node:crypto';
import { resolveSlot, ownSortOrder, savePosition, DIAL_EVENT_TRIGGERS } from '../services/dialPositionService.js';
import { memberDialPosition, turnDialFor, HouseholdError } from '../services/householdService.js';
import { profileIdForUid } from '../services/householdReads.js';

const router = Router();

// Customer Blueprint C2, Part A2 — source_id for onsite brew-profile changes.
// res.locals.apiEventId (middleware/apiEventLog.ts) is used when present;
// this is the documented fallback otherwise (one minute of idempotency for a
// double submit — a genuine second edit within the same minute is rare for a
// profile field and, worst case, is a logged duplicate no-op, never a wrong write).
function brewProfileFallbackSourceId(uid: string, field: string, op: string, value: unknown): string {
  const hash = createHash('sha1').update(JSON.stringify(value ?? null)).digest('hex');
  return `${uid}:${field}:${op}:${hash}:${Math.floor(Date.now() / 60000)}`;
}

// Keyed by archetype_enum (schema.sql) — matches the archetype key format used everywhere
// else (dial_archetype_config, /api/coffees/archetypes' `archetype` field, etc.), NOT a
// shorthand of the display name. Previously keyed by shorthand ('chocolate', 'balanced',
// 'spicy') while lookups below derived the key via `archetype.name.toLowerCase()` — for
// 'Chocolate & Nutty' / 'Balanced' / 'Earthy' that produces 'chocolate & nutty' /
// 'balanced' / 'earthy', none of which matched the old shorthand keys (only
// 'floral' / 'fruity' / 'experimental' happened to survive .toLowerCase() unscathed).
// Those three silently fell through to the generic-rust-color/no-features fallback below,
// and worse, the mangled `.id` that shape produced didn't match archetype_enum, breaking
// BloomPage.tsx's "your matched archetype" personalization for those users too. Fixed by
// normalizing this map's keys to archetype_enum and deriving the lookup key from
// catalogReads.archetypeCode() (below) instead of a blind .toLowerCase().
//
// Website 9 (2026-11-06, AU8): `features` is the family's customer_words
// (coffee_archetype, catalogReads.archetypeCustomerWords), never typed here;
// the old typed sentences are gone. `color` stays (no catalog source yet).

// Catalog Blueprint brief 3: this map no longer carries a `name` field —
// hardcoded archetype display-label literals outside admin.ts/tests are a lint
// violation (lint rule 4). `color` is genuinely quiz-personality
// content with no catalog source, so they stay here; the label itself is
// always resolved live via archetypeLabel() at each of this file's two
// response-construction sites instead.
const ARCHETYPES: Record<string, { color: string }> = {
  floral:          { color: '#a34b78' },
  fruity:          { color: '#ca445f' },
  balanced_sweet:  { color: '#d1ac11' },
  chocolate_nutty: { color: '#a54c2d' },
  earthy:          { color: '#912f2f' },
  experimental:    { color: '#056c7a' },
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
         LEFT JOIN coffee_archetype a ON a.id = qs.resulting_archetype_id
         WHERE qs.user_id = $1
         ORDER BY qs.completed_at DESC LIMIT 1`,
        [profileId]
      ),
      db.query(
        // Commerce 1 (2026-10-31): state from v_order_status (customer_label is
        // the lookup's words, so no status word is typed into the frontend);
        // total is total_amount_paid, in dollars (the old SUM of
        // unit_price_charged was dollars too, then divided by 100 again: a
        // 100x-too-small total, never visible with 0 orders); the line name is
        // the house name snapshot, never the SKU's roaster blend name.
        // Commerce 3: the tracking link (carrier template, v_order_status) once it ships.
        `SELECT o.id, o.external_shopify_order_id, o.created_at, s.customer_label, s.payment_status, s.fulfillment_status,
                o.total_amount_paid, s.tracking_url, s.carrier_label, s.tracking_number,
                (ARRAY_AGG(li.display_name ORDER BY li.created_at))[1] AS display_name
         FROM "order" o
         JOIN v_order_status s ON s.order_id = o.id
         LEFT JOIN order_line_item li ON li.order_id = o.id
         WHERE o.user_id = $1
         GROUP BY o.id, s.customer_label, s.payment_status, s.fulfillment_status, s.tracking_url, s.carrier_label, s.tracking_number ORDER BY o.created_at DESC LIMIT 10`,
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

    // Liam access & cost brief (2026-10-01) — AuthContext reads isAdmin from
    // this response already, so Liam access rides along (no second round
    // trip). The decision is services/liamAccess.ts's; this only reports it.
    const liamAccess = await hasLiamAccess(req.uid!);

    const quiz = quizResult.rows[0];
    const archetypeKey = quiz?.archetype_name ? ((await archetypeCode(quiz.archetype_name)) ?? quiz.archetype_name.toLowerCase()) : null;
    // Label comes from archetypeLabel() (v_coffee_archetype) for a recognized
    // key; an unrecognized key falls back to the raw quiz label, same as before.
    const archetypeMeta = archetypeKey ? { ...(ARCHETYPES[archetypeKey] ?? { color: '#a33726' }), features: await archetypeCustomerWords(archetypeKey) } : null;
    const archetypeName = archetypeKey && ARCHETYPES[archetypeKey] ? await catalogArchetypeLabel(archetypeKey) : (quiz?.archetype_name ?? null);
    const archetypeData = archetypeMeta ? { name: archetypeName, ...archetypeMeta } : null;

    // Which orders already have a feedback fact (any source/channel) — drives
    // the "Leave feedback" affordance in Profile.tsx order history. Customer
    // Blueprint C3, Part C — v_customer_feedback_current, not Firestore.
    let orderIdsWithFeedback = new Set<string>();
    try {
      const feedbackRows = await getFeedbackCurrent(req.uid!);
      for (const row of feedbackRows) if (row.orderId) orderIdsWithFeedback.add(row.orderId);
    } catch (err) {
      console.error('[/api/users/profile] feedback read failed:', err);
    }

    // Sync to Firestore — non-blocking, Cloud SQL is source of truth. Customer
    // Blueprint C3, Part C: archetype/archetypeLabel/lastQuizDate are retired
    // (v_customer_quiz_current is the read now); email/firstName/lastName stay
    // — a still-live sync for other Firestore-reading consumers.
    firestoreDb.doc(`users/${req.uid}`).set({
      email:          emailResult.rows[0]?.email_address ?? req.email ?? null,
      firstName:      profileRow.first_name ?? null,
      lastName:       profileRow.last_name ?? null,
      syncedAt:       FieldValue.serverTimestamp(),
    }, { merge: true }).catch((err: unknown) => console.error('[users/firestore-sync]', err));

    res.json({
      email:       emailResult.rows[0]?.email_address ?? req.email ?? null,
      firstName:   profileRow.first_name ?? null,
      lastName:    profileRow.last_name ?? null,
      dateOfBirth: profileRow.date_of_birth ?? null,
      displayName: null,
      isAdmin:     roleResult.rows[0]?.name === 'admin',
      hasLiamAccess: liamAccess.allowed,
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
        status:        o.customer_label,
        paymentStatus: o.payment_status,
        fulfillmentStatus: o.fulfillment_status,
        total:         `${Number(o.total_amount_paid ?? 0).toFixed(2)}`,
        date:          new Date(o.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        blendName:     o.display_name ?? null,
        trackingUrl:   o.tracking_url ?? null,
        tracking:      o.tracking_number ? `${o.carrier_label ?? ''} ${o.tracking_number}`.trim() : null,
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

    const archetypeKey = signals.archetype ? ((await archetypeCode(signals.archetype)) ?? signals.archetype.toLowerCase()) : null;
    const archetypeMeta = archetypeKey ? { ...(ARCHETYPES[archetypeKey] ?? { color: '#a33726' }), features: await archetypeCustomerWords(archetypeKey) } : null;
    const archetypeName = archetypeKey && ARCHETYPES[archetypeKey] ? await catalogArchetypeLabel(archetypeKey) : (signals.archetype ?? null);
    const archetypeData = archetypeMeta ? { name: archetypeName, ...archetypeMeta } : null;

    let pendingFeedback: { orderId: string; blendName: string | null; coffeeId: number | null } | null = null;
    let usualBlend: { id: string; name: string } | null = null;
    let nextDeliveryDate: string | null = null;

    // Independent of stageCode — a subscriber or repeat customer can still have
    // an unanswered feedback ask sitting out there from an early order.
    const pendingFeedbackOrder = getPendingFeedbackOrder(signals);
    if (pendingFeedbackOrder) {
      const blendResult = await db.query(
        `SELECT rb.blend_name, rb.coffee_id FROM order_line_item oli
         JOIN coffee_sku rb ON rb.id = oli.blend_id
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
         JOIN coffee_sku rb ON rb.id = oli.blend_id
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
        // ::text: a calendar date (YYYY-MM-DD), never a midnight timestamp that shifts a day in US time (Commerce 2).
        `SELECT s.next_delivery_date::text AS next_delivery_date
         FROM subscription s
         JOIN subscription_status st ON st.code = s.status AND st.counts_as_subscriber
         -- Family Household 1 (2026-11-07): house subscriptions through v_household_member.
         JOIN user_profile up ON (up.id = s.user_id OR EXISTS (
                SELECT 1 FROM v_household_member vm
                WHERE vm.user_id = up.id AND vm.status_code = 'active' AND vm.household_id = s.household_id))
         WHERE up.firebase_uid = $1
         ORDER BY s.next_delivery_date NULLS LAST
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
    const profileId = await profileIdForUid(req.uid!);
    if (!profileId) { res.status(404).json({ error: 'Profile not found' }); return; }
    // Family Household 2 (D27): ?forMemberId= reads a household member's position
    // (v_customer_dial_current), for a member whose role may turn dials.
    const forMemberId = req.query.forMemberId;
    if (typeof forMemberId === 'string' && forMemberId) {
      if (req.isAnonymous) { res.status(403).json({ error: 'anonymous_not_allowed' }); return; }
      res.json({ dialSortOrder: await memberDialPosition(profileId, forMemberId, archetype) });
      return;
    }
    // Catalog Blueprint brief 5a dropped dial_sort_order from this table —
    // slot_id is joined back to coffee_dial_slot for its sort_order. API field name unchanged.
    res.json({ dialSortOrder: await ownSortOrder(profileId, archetype) });
  } catch (err) {
    if (err instanceof HouseholdError) { res.status(err.status).json({ error: err.code, message: err.message }); return; }
    console.error('[GET /api/users/dial-position]', err);
    res.status(500).json({ error: 'Failed to fetch dial position' });
  }
});

// Liam Dial Event Log — the only two intentional-movement kinds ever logged (plain
// dial turns are exploration noise, deliberately not logged). Kept in sync with
// ArchetypeSection.tsx's `source` prop values.
const DIAL_EVENT_SOURCES = ['bloom', 'find_my_flavor_returning', 'find_my_flavor_results', 'profile'] as const;

// ── PATCH /api/users/dial-position — upsert on (user_id, archetype) ───────────
// Requests without `trigger` are the silent auto-save path (every dial turn) —
// the position only. Requests with a valid `trigger` additionally record the
// intentional moment as a customer_dial_event fact (explicit save or
// add-to-cart) — a logging failure never fails the request itself.
// Family Household 2 (2026-11-07, D27): `forMemberId` turns a household member's
// dial. Member mode saves only on an explicit Save (trigger explicit_save): one
// move, logged with the actor, undoable by the member; the member's saved list
// is not touched. Writes live in services/dialPositionService.ts (G3.1).
router.patch('/dial-position', requireAuth, async (req: AuthRequest, res) => {
  const { archetype, dialSortOrder, trigger, coffeeId, platformName, forMemberId } = req.body ?? {};
  if (!archetype || !Number.isInteger(dialSortOrder)) {
    res.status(400).json({ error: 'archetype and dialSortOrder are required' }); return;
  }
  if (trigger !== undefined && !DIAL_EVENT_TRIGGERS.includes(trigger)) {
    res.status(400).json({ error: 'invalid trigger' }); return;
  }
  try {
    const profileId = await profileIdForUid(req.uid!);
    if (!profileId) { res.status(404).json({ error: 'Profile not found' }); return; }
    const resolvedCoffeeId = Number.isInteger(coffeeId) ? coffeeId : null;

    if (forMemberId !== undefined && forMemberId !== null) {
      if (req.isAnonymous || typeof forMemberId !== 'string') { res.status(403).json({ error: 'anonymous_not_allowed' }); return; }
      if (trigger !== 'explicit_save') {
        res.status(400).json({ error: 'explicit_save_required', message: "A member's dial is saved with Save." }); return;
      }
      const turned = await turnDialFor(profileId, forMemberId, { archetype, dialSortOrder, coffeeId: resolvedCoffeeId });
      res.json({ ok: true, dialEventId: turned.dialEventId });
      return;
    }

    // Catalog Blueprint brief 5a dropped dial_sort_order from this table —
    // resolve (archetype, dialSortOrder) to the real slot_id before writing.
    const slotId = await resolveSlot(db, archetype, dialSortOrder);
    if (!slotId) { res.status(400).json({ error: 'Unknown archetype/dialSortOrder combination' }); return; }
    // Profile Part 7 Task 1 — coffeeId and platformName (a display-name snapshot at
    // save time) are stored on whichever trigger sends them.
    const resolvedPlatformName = typeof platformName === 'string' && platformName.trim() ? platformName.trim() : null;
    await savePosition(db, {
      userId: profileId, archetype, slotId, trigger, coffeeId: resolvedCoffeeId, platformName: resolvedPlatformName,
      dialSortOrder, savedItem: true,
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof HouseholdError) { res.status(err.status).json({ error: err.code, message: err.message }); return; }
    console.error('[PATCH /api/users/dial-position]', err);
    res.status(500).json({ error: 'Failed to save dial position' });
  }
});

// ── GET /api/users/flavor-memory ──────────────────────────────────────────────
// Customer Blueprint C3, Part B3 — the three content blocks behind the Profile
// page's Flavor Memory tab now read from v_customer_timeline (one query,
// every fact already joined) + user_saved_item (Part B4, current state for
// 'saved'/'recipe') instead of Firestore feedback_events/taste_journey/
// dial_events/liam_saves and a quiz_session fallback. contributionCount is
// unchanged (user_flavor_feedback stays queryable until no view names it).
// Roaster-blind reasoning: blendName here is the user's own past order, same
// precedent that already clears pendingFeedback.blendName for UC3 — never a
// raw coffee/roaster name for catalogue browsing.
router.get('/flavor-memory', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const profileId = profileResult.rows[0]?.id;
    if (!profileId) { res.status(404).json({ error: 'Profile not found' }); return; }

    const [timeline, feedbackRows, contributionResult, savedItemsResult, brewCardRows] = await Promise.all([
      getTimeline(req.uid!),
      getFeedbackCurrent(req.uid!),
      db.query(`SELECT COUNT(*) FROM user_flavor_feedback WHERE user_id = $1`, [profileId]),
      db.query(
        `SELECT id, kind, ref_id, title, payload, created_at
         FROM user_saved_item WHERE user_id = $1 AND removed_at IS NULL ORDER BY created_at DESC`,
        [profileId]
      ),
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

    // One order per row (multi-line orders pick the first line, same
    // arbitrary-representative behavior the old ARRAY_AGG(...)[1] query had).
    const orderLines = timeline.filter(e => e.kind === 'order_line');
    const orderRowsMap = new Map<string, typeof orderLines[number]>();
    for (const e of orderLines) {
      const orderId = String((e.detail as any).order_id);
      if (!orderRowsMap.has(orderId)) orderRowsMap.set(orderId, e);
    }

    // getFeedbackCurrent() already excludes superseded rows (Profile Part 5).
    const feedbackByOrder = new Map<string, typeof feedbackRows[number]>();
    for (const f of feedbackRows) if (f.orderId) feedbackByOrder.set(f.orderId, f);

    const journal = [...orderRowsMap.entries()].map(([orderId, e]) => {
      const fb = feedbackByOrder.get(orderId);
      return {
        orderId,
        // ISO, not a pre-formatted display string — the journal only needs
        // month+year granularity (Profile Part 3 §2), coarser than the full
        // date /profile's order history already formats server-side.
        date: new Date(e.occurredAt).toISOString(),
        blendName: (e.detail as any).blend_name ?? null,
        coffeeId: e.coffeeId,
        rating: fb?.rating ?? null,
        note: fb?.rawText ?? null,
        source: fb?.source ?? null,
        hasFeedback: !!fb,
        // For Part 5's edit-prefill only — additive.
        expectation: fb?.expectation ?? null,
        tastedNoteIds: fb?.descriptorNoteIds ?? [],
      };
    });

    // Journey — quiz-kind timeline entries, oldest first, across every linked
    // profile (v_customer_identity). The first entry is 'first_quiz', every
    // later one 'retake' — the same distinction Firestore's taste_journey
    // doc used to carry explicitly, now derived from ordering.
    const quizEntries = [...timeline]
      .filter(e => e.kind === 'quiz')
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    const journey = await Promise.all(quizEntries.map(async (e, i) => ({
      archetype: e.archetypeCode ?? String((e.detail as any).archetype ?? '').toLowerCase(),
      archetypeLabel: e.archetypeCode ? await catalogArchetypeLabel(e.archetypeCode) : String((e.detail as any).archetype ?? ''),
      at: e.occurredAt ? new Date(e.occurredAt).toISOString() : null,
      trigger: i === 0 ? 'first_quiz' : 'retake',
    })));

    // Profile Part 7 Task 3 — the activity log. Editorial rule (binding): only
    // deliberate moments — quiz, order, explicit save, accepted Liam recipe.
    // No add_to_cart, rotation, reveal, or inferred entries, ever.
    const quizActivity = journey.map((j, i) => ({
      id: `quiz_${i}`,
      type: 'quiz' as const,
      at: j.at,
      archetype: j.archetype,
      archetypeLabel: j.archetypeLabel,
      trigger: j.trigger,
      removable: false,
    }));

    // order_line arm's archetype_code column is already v_coffee.match_archetype
    // (D1) — no separate catalogReads.getCoffees batch needed any more.
    const orderedActivity = await Promise.all([...orderRowsMap.entries()].map(async ([orderId, e]) => ({
      id: orderId,
      type: 'ordered' as const,
      at: new Date(e.occurredAt).toISOString(),
      archetype: e.archetypeCode,
      archetypeLabel: e.archetypeCode ? await catalogArchetypeLabel(e.archetypeCode) : null,
      coffeeName: (e.detail as any).blend_name ?? null,
      removable: false,
    })));

    // 'saved' — user_saved_item kind='dial_slot' (Part B4's current-state
    // store; the fact stays customer_dial_event). Legacy events with no
    // coffeeId/platformName render honestly as position-only.
    const savedActivity = await Promise.all(savedItemsResult.rows
      .filter((r: any) => r.kind === 'dial_slot')
      .map(async (r: any) => {
        const payload = r.payload ?? {};
        return {
          id: r.id,
          type: 'saved' as const,
          at: r.created_at ? new Date(r.created_at).toISOString() : null,
          archetype: payload.archetype ?? null,
          archetypeLabel: payload.archetype ? await catalogArchetypeLabel(payload.archetype) : null,
          dialSortOrder: typeof payload.dialSortOrder === 'number' ? payload.dialSortOrder : null,
          coffeeName: r.title ?? null,
          removable: true,
        };
      }));

    // 'recipe' — user_saved_item kind='recipe'.
    const recipeActivity = savedItemsResult.rows
      .filter((r: any) => r.kind === 'recipe')
      .map((r: any) => ({
        id: r.id,
        type: 'recipe' as const,
        at: r.created_at ? new Date(r.created_at).toISOString() : null,
        title: r.title ?? null,
        body: r.payload?.body ?? null,
        coffeeName: r.payload?.coffeeName ?? null,
        removable: true,
      }));

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
// a hard delete — the Dial Event Log fact in customer_dial_event keeps full
// history for Liam/analytics regardless). Customer Blueprint C3, Part B4:
// user_saved_item.removed_at, not a Firestore doc update. Ownership is
// enforced by the WHERE user_id = $2 clause, not an implicit doc path.
router.patch('/flavor-memory/saved/:docId/remove', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const profileId = profileResult.rows[0]?.id;
    if (!profileId) { res.status(404).json({ error: 'Not found' }); return; }
    const result = await db.query(
      `UPDATE user_saved_item SET removed_at = NOW()
       WHERE id = $1 AND user_id = $2 AND kind = 'dial_slot' AND removed_at IS NULL
       RETURNING id`,
      [req.params.docId, profileId]
    );
    if (!result.rowCount) {
      // Either genuinely missing, already removed (idempotent no-op — ok:true,
      // same as the old tombstone-if-not-already-set check), or the wrong kind.
      const existsResult = await db.query(`SELECT kind, removed_at FROM user_saved_item WHERE id = $1 AND user_id = $2`, [req.params.docId, profileId]);
      const existing = existsResult.rows[0];
      if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
      if (existing.kind !== 'dial_slot') { res.status(400).json({ error: 'Not removable' }); return; }
      // already removed — fall through to ok:true
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /api/users/flavor-memory/saved/:docId/remove]', err);
    res.status(500).json({ error: 'Failed to remove entry' });
  }
});

router.patch('/flavor-memory/recipes/:docId/remove', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const profileId = profileResult.rows[0]?.id;
    if (!profileId) { res.status(404).json({ error: 'Not found' }); return; }
    const result = await db.query(
      `UPDATE user_saved_item SET removed_at = NOW()
       WHERE id = $1 AND user_id = $2 AND kind = 'recipe' AND removed_at IS NULL
       RETURNING id`,
      [req.params.docId, profileId]
    );
    if (!result.rowCount) {
      const existsResult = await db.query(`SELECT id FROM user_saved_item WHERE id = $1 AND user_id = $2 AND kind = 'recipe'`, [req.params.docId, profileId]);
      if (!existsResult.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
      // already removed — fall through to ok:true
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
// Customer Blueprint C3, Part B4 — user_saved_item (kind='recipe'), not
// Firestore users/{uid}/liam_saves. ref_id has no natural external id for a
// Liam-authored recipe (unlike a dial slot's archetype+sortOrder), so it's a
// fixed tag; the row's own id is the real identity.
router.post('/flavor-memory/liam-saves', requireAuth, async (req: AuthRequest, res) => {
  const { title, body } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    res.status(400).json({ error: 'invalid title' }); return;
  }
  if (typeof body !== 'string' || !body.trim() || body.length > 4000) {
    res.status(400).json({ error: 'invalid body' }); return;
  }
  try {
    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const profileId = profileResult.rows[0]?.id;
    if (!profileId) { res.status(404).json({ error: 'Profile not found' }); return; }
    const result = await db.query<{ id: string }>(
      `INSERT INTO user_saved_item (user_id, kind, ref_id, title, payload)
       VALUES ($1, 'recipe', 'liam_recipe', $2, $3)
       RETURNING id`,
      [profileId, title.trim(), JSON.stringify({ body: body.trim(), coffeeName: null })]
    );
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[POST /api/users/flavor-memory/liam-saves]', err);
    res.status(500).json({ error: 'Failed to save recipe' });
  }
});

// ── GET /api/users/brew-profile ───────────────────────────────────────────────
// HOME_TASK_4 (§4.5 write rule 2) — the day-one mirror: read, edit, delete per
// field. Customer Blueprint C3, Part B3 — v_customer_brew_profile via
// customerReads, not the Firestore doc. No fields captured yet is a normal,
// common state, not an error — returns {} rather than 404.
router.get('/brew-profile', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  try {
    const profile = await getBrewProfileCurrent(req.uid!);
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

  // Customer Blueprint C3, Part C — the Firestore users/{uid}/metadata/
  // brew_profile doc write is retired; record.brewProfileChange() (C2) is
  // the only writer.
  try {
    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const profileId = profileResult.rows[0]?.id;
    if (!profileId) { res.status(404).json({ error: 'Profile not found' }); return; }
    const sourceId = res.locals.apiEventId ?? brewProfileFallbackSourceId(req.uid!, field, 'set', validatedValue);
    await record.brewProfileChange({ userId: profileId, source: 'onsite', sourceId, field: field as any, op: 'set', value: JSON.stringify(validatedValue) });
    await incrementBrewProfileCounter('writes');

    res.json({ ok: true, field, value: validatedValue });
  } catch (err) {
    console.error('[PATCH /api/users/brew-profile]', err);
    await incrementBrewProfileCounter('failures');
    res.status(500).json({ error: 'Failed to save brew profile field' });
  }
});

// ── DELETE /api/users/brew-profile ────────────────────────────────────────────
// Delete = a 'clear' fact row, never a null-write — a null value would still
// read as "captured, unknown" to the summary formatter, whereas 'clear' folds
// to absent in v_customer_brew_profile, matching what the customer asked for.
// Customer Blueprint C3, Part C — the Firestore doc write is retired.
router.delete('/brew-profile', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  const field = typeof req.body?.field === 'string' ? req.body.field : (req.query.field as string | undefined);
  if (!field || !getBrewProfileFieldsConfig()[field]) {
    res.status(400).json({ error: 'Unknown or missing field' });
    return;
  }
  try {
    const profileResult = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const profileId = profileResult.rows[0]?.id;
    if (!profileId) { res.status(404).json({ error: 'Profile not found' }); return; }
    const sourceId = res.locals.apiEventId ?? brewProfileFallbackSourceId(req.uid!, field, 'clear', null);
    await record.brewProfileChange({ userId: profileId, source: 'onsite', sourceId, field: field as any, op: 'clear', value: null });
    await incrementBrewProfileCounter('writes');

    res.json({ ok: true, field });
  } catch (err) {
    console.error('[DELETE /api/users/brew-profile]', err);
    await incrementBrewProfileCounter('failures');
    res.status(500).json({ error: 'Failed to delete brew profile field' });
  }
});

export default router;
