// Family Household 1, B6 (2026-11-07): /api/admin/household behind
// requireAdmin (server-side, the DB role), same shape as commerceAdmin.ts.
// The Households page (D17) reads through householdReads; the parameters
// card writes through householdParameters.setParameter.
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { listHouseholds, household, numbers } from '../services/householdReads.js';
import { getParameters, setParameter, HouseholdParameterError } from '../services/householdParameters.js';

const router = Router();
router.use(requireAdmin);

router.get('/households', async (_req, res) => {
  try { res.json(await listHouseholds()); } catch (err) {
    console.error('[admin/household/households]', err);
    res.status(500).json({ error: 'Failed to read households' });
  }
});

router.get('/households/:id', async (req, res) => {
  try {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ error: 'household_not_found' });
    const h = await household(id.data);
    if (!h) return res.status(404).json({ error: 'household_not_found' });
    res.json(h);
  } catch (err) {
    console.error('[admin/household/household]', err);
    res.status(500).json({ error: 'Failed to read the household' });
  }
});

// Family Household 3 (D19): the numbers card.
router.get('/numbers', async (_req, res) => {
  try { res.json(await numbers()); } catch (err) {
    console.error('[admin/household/numbers]', err);
    res.status(500).json({ error: 'Failed to read the household numbers' });
  }
});

router.get('/parameters', async (_req, res) => {
  try { res.json(await getParameters()); } catch (err) {
    console.error('[admin/household/parameters]', err);
    res.status(500).json({ error: 'Failed to read the household parameters' });
  }
});

router.put('/parameters/:key', async (req: AuthRequest, res) => {
  try {
    res.json(await setParameter(req.params.key, req.body?.value, req.body?.note ?? null, req.uid ?? null));
  } catch (err) {
    if (err instanceof HouseholdParameterError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('[admin/household/parameters PUT]', err);
    res.status(500).json({ error: 'Failed to save the household parameter' });
  }
});

export default router;
