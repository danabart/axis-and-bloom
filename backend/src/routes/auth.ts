import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';

const router = Router();

// Called after Firebase sign-up to sync user to our DB
router.post('/sync', requireAuth, async (req: AuthRequest, res) => {
  const { displayName } = req.body;
  try {
    await db.query(
      `INSERT INTO users (uid, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (uid) DO UPDATE SET email = $2, display_name = COALESCE($3, users.display_name), updated_at = NOW()`,
      [req.uid, req.email, displayName ?? null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to sync user' });
  }
});

export default router;
