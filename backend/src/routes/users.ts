import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';

const router = Router();

const ARCHETYPES: Record<string, { name: string; features: string[]; color: string }> = {
  floral: { name: 'Floral', color: '#a34b78', features: ['You prefer delicate aromatics over heavy roasts', 'You enjoy a light, tea-like body', 'You appreciate a bright, clean finish'] },
  fruity: { name: 'Fruity', color: '#ca445f', features: ['You prefer juicy acidity and bright notes', 'You enjoy vibrant fruit-forward flavors', 'You appreciate a crisp, clean finish'] },
  balanced: { name: 'Balanced & Sweet', color: '#d1ac11', features: ['You prefer lower acidity and round body', 'You enjoy caramelized and nutty sweetness', 'You are less sensitive to roast intensity'] },
  chocolate: { name: 'Chocolate & Nutty', color: '#a54c2d', features: ['You prefer a bold and comforting cup', 'You enjoy deep cocoa and roasted nut flavors', 'You appreciate a heavy, satisfying body'] },
  spicy: { name: 'Spicy and Earthy', color: '#912f2f', features: ['You prefer a complex, savory depth', 'You enjoy warming spices and earthy notes', 'You appreciate a thick, structured finish'] },
  experimental: { name: 'Experimental', color: '#056c7a', features: ['You prefer unique, unexpected flavor profiles', 'You enjoy wild fermentation and intense fruit', 'You appreciate complex, lively acidity'] },
};

router.get('/profile', requireAuth, async (req: AuthRequest, res) => {
  try {
    // Get or create user
    await db.query(
      'INSERT INTO users (uid, email) VALUES ($1, $2) ON CONFLICT (uid) DO NOTHING',
      [req.uid, req.email ?? '']
    );

    const [userResult, quizResult, ordersResult] = await Promise.all([
      db.query('SELECT * FROM users WHERE uid = $1', [req.uid]),
      db.query('SELECT * FROM quiz_results WHERE uid = $1 ORDER BY created_at DESC LIMIT 1', [req.uid]),
      db.query('SELECT * FROM orders WHERE uid = $1 ORDER BY created_at DESC LIMIT 10', [req.uid]),
    ]);

    const user = userResult.rows[0];
    const quiz = quizResult.rows[0];
    const archetype = quiz ? ARCHETYPES[quiz.archetype] : null;

    res.json({
      email: user.email,
      displayName: user.display_name,
      archetype: archetype ? { ...archetype, id: quiz.archetype, scores: quiz.scores } : null,
      orders: ordersResult.rows.map(o => ({
        id: o.id,
        shopifyOrderId: o.shopify_order_id,
        status: o.status,
        total: `$${((o.total_cents ?? 0) / 100).toFixed(2)}`,
        date: new Date(o.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        items: o.items,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

export default router;
