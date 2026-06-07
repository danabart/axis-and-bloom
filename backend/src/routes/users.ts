import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { firestoreDb, FieldValue } from '../services/firebase-admin.js';

const router = Router();

const ARCHETYPES: Record<string, { name: string; features: string[]; color: string }> = {
  floral:       { name: 'Floral',            color: '#a34b78', features: ['You prefer delicate aromatics over heavy roasts', 'You enjoy a light, tea-like body', 'You appreciate a bright, clean finish'] },
  fruity:       { name: 'Fruity',            color: '#ca445f', features: ['You prefer juicy acidity and bright notes', 'You enjoy vibrant fruit-forward flavors', 'You appreciate a crisp, clean finish'] },
  balanced:     { name: 'Balanced & Sweet',  color: '#d1ac11', features: ['You prefer lower acidity and round body', 'You enjoy caramelized and nutty sweetness', 'You are less sensitive to roast intensity'] },
  chocolate:    { name: 'Chocolate & Nutty', color: '#a54c2d', features: ['You prefer a bold and comforting cup', 'You enjoy deep cocoa and roasted nut flavors', 'You appreciate a heavy, satisfying body'] },
  spicy:        { name: 'Spicy and Earthy',  color: '#912f2f', features: ['You prefer a complex, savory depth', 'You enjoy warming spices and earthy notes', 'You appreciate a thick, structured finish'] },
  experimental: { name: 'Experimental',      color: '#056c7a', features: ['You prefer unique, unexpected flavor profiles', 'You enjoy wild fermentation and intense fruit', 'You appreciate complex, lively acidity'] },
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

    const [emailResult, quizResult, ordersResult, roleResult, addressResult] = await Promise.all([
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
                COALESCE(SUM(li.unit_price_charged * li.quantity), 0) AS total_cents
         FROM "order" o
         LEFT JOIN order_line_item li ON li.order_id = o.id
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
    ]);

    const quiz = quizResult.rows[0];
    const archetypeKey = quiz?.archetype_name?.toLowerCase() ?? null;
    const archetypeData = archetypeKey ? (ARCHETYPES[archetypeKey] ?? { name: quiz.archetype_name, features: [], color: '#a33726' }) : null;

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
      orders:      ordersResult.rows.map(o => ({
        id:            o.id,
        shopifyOrderId: o.external_shopify_order_id,
        status:        o.fulfillment_status ?? 'pending',
        total:         `$${(Number(o.total_cents) / 100).toFixed(2)}`,
        date:          new Date(o.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      })),
    });
  } catch (err) {
    console.error('[/api/users/profile]', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ── PATCH /api/users/profile ──────────────────────────────────────────────────
router.patch('/profile', requireAuth, async (req: AuthRequest, res) => {
  const { firstName, lastName, dateOfBirth } = req.body ?? {};
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

export default router;
