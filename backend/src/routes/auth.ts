import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';

const router = Router();

// Called after Firebase sign-in/sign-up to sync user to our DB
router.post('/sync', requireAuth, async (req: AuthRequest, res) => {
  try {
    const profileResult = await db.query(
      `INSERT INTO user_profile (firebase_uid)
       VALUES ($1)
       ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [req.uid]
    );
    const profileId = profileResult.rows[0].id;

    if (req.email) {
      await db.query(
        `INSERT INTO user_email (user_id, email_address, is_primary, is_verified)
         VALUES ($1, $2, true, true)
         ON CONFLICT (email_address) DO NOTHING`,
        [profileId, req.email]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to sync user' });
  }
});

export default router;
