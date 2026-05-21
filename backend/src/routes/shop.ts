import { Router } from 'express';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { getProducts } from '../services/shopify.js';
import { db } from '../db/client.js';

const router = Router();

router.get('/products', async (_req, res) => {
  try {
    const products = await getProducts();
    res.json(products);
  } catch (err) {
    console.error(err);
    // Return static catalog as fallback
    res.json([]);
  }
});

router.get('/recommendations', optionalAuth, async (req: AuthRequest, res) => {
  const archetype = req.query.archetype as string;
  if (!archetype) { res.status(400).json({ error: 'archetype required' }); return; }

  try {
    // Try to get from DB coffee_profiles first
    const result = await db.query(
      'SELECT * FROM coffee_profiles WHERE archetype = $1 AND active = TRUE LIMIT 6',
      [archetype]
    );
    if (result.rows.length > 0) { res.json(result.rows); return; }

    // Fall back to all products from Shopify filtered by tags
    const products = await getProducts();
    const filtered = products.filter((p: any) => p.tags?.includes(archetype.toLowerCase()));
    res.json(filtered.length > 0 ? filtered : products.slice(0, 3));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

export default router;
