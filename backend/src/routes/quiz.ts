import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';
import { getRecommendation } from '../services/claude.js';

const router = Router();

router.post('/results', requireAuth, async (req: AuthRequest, res) => {
  const { archetype, scores, answers, decaf } = req.body;
  if (!archetype || !scores || !answers) { res.status(400).json({ error: 'archetype, scores, and answers required' }); return; }

  try {
    // Upsert user
    await db.query(
      'INSERT INTO users (uid, email) VALUES ($1, $2) ON CONFLICT (uid) DO UPDATE SET updated_at = NOW()',
      [req.uid, req.email ?? '']
    );

    // Save quiz result
    const result = await db.query(
      'INSERT INTO quiz_results (uid, archetype, scores, answers, decaf) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [req.uid, archetype, JSON.stringify(scores), JSON.stringify(answers), decaf ?? false]
    );

    // Get AI recommendation
    const recommendation = await getRecommendation(archetype, decaf ?? false);

    res.json({ id: result.rows[0].id, recommendation });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save quiz result' });
  }
});

router.get('/results/latest', requireAuth, async (req: AuthRequest, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM quiz_results WHERE uid = $1 ORDER BY created_at DESC LIMIT 1',
      [req.uid]
    );
    res.json(result.rows[0] ?? null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch quiz result' });
  }
});

export default router;
