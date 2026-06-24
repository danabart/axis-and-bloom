import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';

const router = Router();

router.get('/balance', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await db.query(
      'SELECT balance, lifetime_earned, lifetime_spent FROM user_tokens WHERE uid = $1',
      [req.uid]
    );
    const row = result.rows[0];
    res.json({
      balance: row ? Number(row.balance) : 0,
      lifetimeEarned: row ? Number(row.lifetime_earned) : 0,
      lifetimeSpent: row ? Number(row.lifetime_spent) : 0,
    });
  } catch (err) {
    console.error('[tokens/balance]', err);
    res.status(500).json({ error: 'Failed to fetch token balance' });
  }
});

router.post('/purchase', requireAuth, async (_req: AuthRequest, res) => {
  res.status(503).json({
    error: 'payments_not_yet_configured',
    message: 'Token purchases will be available soon.',
  });
});

export default router;
