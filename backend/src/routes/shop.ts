import { Router } from 'express';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { getProducts } from '../services/shopify.js';
import { resolveBlendForSlot } from '../services/blendResolver.js';
import { db } from '../db/client.js';

const router = Router();

// GET /api/shop/resolve-blend?archetype=&dialSortOrder=&weightOz= — preview which
// roaster/coffee currently fulfills a Bloom Dial position, applying the same
// priority-order fallback POST /api/orders uses. Read-only, no auth required (no
// order side effects) — useful for testing the routing logic independently of
// Shopify being connected.
router.get('/resolve-blend', async (req, res) => {
  const archetype = req.query.archetype as string;
  const dialSortOrder = Number(req.query.dialSortOrder);
  const weightOz = Number(req.query.weightOz);
  if (!archetype || !Number.isFinite(dialSortOrder) || !Number.isFinite(weightOz)) {
    res.status(400).json({ error: 'archetype, dialSortOrder, and weightOz are required' }); return;
  }
  try {
    const resolved = await resolveBlendForSlot(archetype, dialSortOrder, weightOz);
    if (!resolved) {
      res.status(404).json({ error: 'No roaster currently available for this position at that weight' }); return;
    }
    res.json(resolved);
  } catch (err) {
    console.error('[shop/resolve-blend]', err);
    res.status(500).json({ error: 'Failed to resolve blend' });
  }
});

// GET /api/shop/slot-availability?archetype=&dialSortOrder=&weightOz= — public,
// roaster-blind wrapper over resolveBlendForSlot for The Bloom (Part 1 Phase 1b).
// Strips everything resolveBlendForSlot returns except a plain boolean — never
// coffee_name/roaster/blend_id/skipped. Leave GET /resolve-blend above exactly
// as it is; that's an existing internal diagnostic tool, not this public route.
router.get('/slot-availability', async (req, res) => {
  const archetype = req.query.archetype as string;
  const dialSortOrder = Number(req.query.dialSortOrder);
  const weightOz = Number(req.query.weightOz);
  if (!archetype || !Number.isFinite(dialSortOrder) || !Number.isFinite(weightOz)) {
    res.status(400).json({ error: 'archetype, dialSortOrder, and weightOz are required' }); return;
  }
  try {
    const resolved = await resolveBlendForSlot(archetype, dialSortOrder, weightOz);
    if (!resolved) { res.json({ available: false }); return; }
    res.json({ available: true, weightOz });
  } catch (err) {
    console.error('[shop/slot-availability]', err);
    res.status(500).json({ error: 'Failed to check slot availability' });
  }
});

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
