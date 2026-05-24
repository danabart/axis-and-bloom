import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';

const router = Router();

const ARCHETYPES: Record<string, { name: string; features: string[]; color: string }> = {
  floral:       { name: 'Floral',            color: '#a34b78', features: ['You prefer delicate aromatics over heavy roasts', 'You enjoy a light, tea-like body', 'You appreciate a bright, clean finish'] },
  fruity:       { name: 'Fruity',            color: '#ca445f', features: ['You prefer juicy acidity and bright notes', 'You enjoy vibrant fruit-forward flavors', 'You appreciate a crisp, clean finish'] },
  balanced:     { name: 'Balanced & Sweet',  color: '#d1ac11', features: ['You prefer lower acidity and round body', 'You enjoy caramelized and nutty sweetness', 'You are less sensitive to roast intensity'] },
  chocolate:    { name: 'Chocolate & Nutty', color: '#a54c2d', features: ['You prefer a bold and comforting cup', 'You enjoy deep cocoa and roasted nut flavors', 'You appreciate a heavy, satisfying body'] },
  spicy:        { name: 'Spicy and Earthy',  color: '#912f2f', features: ['You prefer a complex, savory depth', 'You enjoy warming spices and earthy notes', 'You appreciate a thick, structured finish'] },
  experimental: { name: 'Experimental',      color: '#056c7a', features: ['You prefer unique, unexpected flavor profiles', 'You enjoy wild fermentation and intense fruit', 'You appreciate complex, lively acidity'] },
};

router.get('/profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    // Upsert user_profile row (idempotent — also done by /api/auth/sync)
    const profileResult = await db.query(
      `INSERT INTO user_profile (firebase_uid)
       VALUES ($1)
       ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [req.uid]
    );
    const profileId = profileResult.rows[0].id;

    // Upsert email into user_email
    if (req.email) {
      await db.query(
        `INSERT INTO user_email (user_id, email_address, is_primary, is_verified)
         VALUES ($1, $2, true, true)
         ON CONFLICT (email_address) DO NOTHING`,
        [profileId, req.email]
      );
    }

    // Fetch email, latest quiz session, and recent orders in parallel
    const [emailResult, quizResult, ordersResult] = await Promise.all([
      db.query(
        `SELECT email_address FROM user_email WHERE user_id = $1 AND is_primary = true LIMIT 1`,
        [profileId]
      ),
      db.query(
        `SELECT qs.id, qs.completed_at, a.name AS archetype_name, a.id AS archetype_id
         FROM quiz_session qs
         LEFT JOIN archetype a ON a.id = qs.resulting_archetype_id
         WHERE qs.user_id = $1
         ORDER BY qs.completed_at DESC
         LIMIT 1`,
        [profileId]
      ),
      db.query(
        `SELECT o.id, o.external_shopify_order_id, o.fulfillment_status, o.created_at,
                COALESCE(SUM(li.unit_price_charged * li.quantity), 0) AS total_cents
         FROM "order" o
         LEFT JOIN order_line_item li ON li.order_id = o.id
         WHERE o.user_id = $1
         GROUP BY o.id
         ORDER BY o.created_at DESC
         LIMIT 10`,
        [profileId]
      ),
    ]);

    const quiz = quizResult.rows[0];
    // Fall back to archetype key lookup if name not seeded yet
    const archetypeKey = quiz?.archetype_name?.toLowerCase() ?? null;
    const archetypeData = archetypeKey ? (ARCHETYPES[archetypeKey] ?? { name: quiz.archetype_name, features: [], color: '#a33726' }) : null;

    res.json({
      email: emailResult.rows[0]?.email_address ?? req.email ?? null,
      displayName: null,   // update when first_name / last_name are collected
      archetype: archetypeData ? { ...archetypeData, id: archetypeKey } : null,
      orders: ordersResult.rows.map(o => ({
        id: o.id,
        shopifyOrderId: o.external_shopify_order_id,
        status: o.fulfillment_status ?? 'pending',
        total: `$${(Number(o.total_cents) / 100).toFixed(2)}`,
        date: new Date(o.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      })),
    });
  } catch (err) {
    console.error('[/api/users/profile]', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

export default router;
