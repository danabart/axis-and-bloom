// Commerce 1, B10 (2026-10-31): /api/admin/commerce behind requireAdmin.
// Thin callers of services/commerceParameters.ts, same shape as
// routes/evidenceAdmin.ts's parameter routes; the Commerce parameters card on
// /admin/commerce reads and writes through these. Nothing else here writes.
import { Router } from 'express';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { getParameters, setParameter, CommerceParameterError } from '../services/commerceParameters.js';

const router = Router();
router.use(requireAdmin);

router.get('/parameters', async (_req, res) => {
  try {
    res.json(await getParameters());
  } catch (err) {
    console.error('[admin/commerce/parameters]', err);
    res.status(500).json({ error: 'Failed to read the commerce parameters' });
  }
});

router.put('/parameters/:key', async (req: AuthRequest, res) => {
  try {
    const result = await setParameter(req.params.key, req.body?.value, req.body?.note ?? null, req.uid ?? null);
    res.json(result);
  } catch (err) {
    if (err instanceof CommerceParameterError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('[admin/commerce/parameters PUT]', err);
    res.status(500).json({ error: 'Failed to save the commerce parameter' });
  }
});

export default router;
