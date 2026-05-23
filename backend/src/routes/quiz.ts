import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { getRecommendation } from '../services/claude.js';

const router = Router();

router.post('/results', requireAuth, async (req: AuthRequest, res) => {
  const { archetype, scores, answers, decaf } = req.body;
  if (!archetype || !scores || !answers) { res.status(400).json({ error: 'archetype, scores, and answers required' }); return; }

  try {
    // Upsert user_profile and get its id
    const profileResult = await db.query(
      `INSERT INTO user_profile (firebase_uid)
       VALUES ($1)
       ON CONFLICT (firebase_uid) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [req.uid]
    );
    const profileId = profileResult.rows[0].id;

    // Save quiz session (archetype name + full scores stored in context_data until seed data exists)
    const sessionResult = await db.query(
      `INSERT INTO quiz_session (user_id, context_data)
       VALUES ($1, $2)
       RETURNING id`,
      [profileId, JSON.stringify({ archetype, scores, answers, decaf: decaf ?? false })]
    );

    // Get AI recommendation
    const recommendation = await getRecommendation(archetype, decaf ?? false);

    res.json({ id: sessionResult.rows[0].id, recommendation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save quiz result' });
  }
});

router.get('/results/latest', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await db.query(
      `SELECT qs.* FROM quiz_session qs
       JOIN user_profile up ON up.id = qs.user_id
       WHERE up.firebase_uid = $1
       ORDER BY qs.completed_at DESC
       LIMIT 1`,
      [req.uid]
    );
    res.json(result.rows[0] ?? null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch quiz result' });
  }
});

export default router;
