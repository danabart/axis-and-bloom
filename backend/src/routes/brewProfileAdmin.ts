// Usual Drink 1 (2026-11-12), Part D — the admin brew-profile row: per-field
// counts and coverage, the drink, brand and feeling distributions and the
// other + words list (customerReads.getBrewProfileFieldCounts, the one read),
// beside the existing write/failure counters; and the brew_parameter card,
// written through brewParameters.setParameter (same pattern as household).
// backend/src/features/usual_drink/CLAUDE_CODE_PROMPT_USUAL_DRINK_1_CAPTURE.md
import { Router } from 'express';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { getBrewProfileFieldCounts } from '../services/customerReads.js';
import { getBrewProfileCounters } from '../services/brewProfile.js';
import { getParameters, setParameter, BrewParameterError } from '../services/brewParameters.js';

const router = Router();
router.use(requireAdmin);

router.get('/stats', async (_req, res) => {
  try {
    const [fields, counters] = await Promise.all([getBrewProfileFieldCounts(), getBrewProfileCounters()]);
    res.json({ ...fields, counters });
  } catch (err) {
    console.error('[admin/brew-profile/stats]', err);
    res.status(500).json({ error: 'Failed to read the brew-profile stats' });
  }
});

router.get('/parameters', async (_req, res) => {
  try { res.json(await getParameters()); } catch (err) {
    console.error('[admin/brew-profile/parameters]', err);
    res.status(500).json({ error: 'Failed to read the brew parameters' });
  }
});

router.put('/parameters/:key', async (req: AuthRequest, res) => {
  try {
    res.json(await setParameter(req.params.key, req.body?.value, req.body?.note ?? null, req.uid ?? null));
  } catch (err) {
    if (err instanceof BrewParameterError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('[admin/brew-profile/parameters PUT]', err);
    res.status(500).json({ error: 'Failed to save the brew parameter' });
  }
});

export default router;
