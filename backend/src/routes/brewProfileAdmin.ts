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
// Usual Drink 4 (C2): promote a typed kitchen name, retire an entry (brewKitchenList, the one writer)
import { z } from 'zod';
import { promoteTypedName, retireKitchenEntry, KitchenListError } from '../services/brewKitchenList.js';

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

const promoteBody = z.object({
  typed: z.string().trim().min(1),
  label: z.string().trim().min(1),
  kindCode: z.string().trim().min(1).nullish(),
  parentCode: z.string().trim().min(1).nullish(),
}).refine(b => !!b.kindCode || !!b.parentCode, { message: 'a kind, or a brand for a product' });

router.post('/kitchen/promote', async (req, res) => {
  const parsed = promoteBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; '), code: 'KITCHEN_LIST_INVALID' });
  try {
    const r = await promoteTypedName(parsed.data);
    res.status(r.created ? 201 : 200).json(r);
  } catch (err) {
    if (err instanceof KitchenListError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('[admin/brew-profile/kitchen/promote]', err);
    res.status(500).json({ error: 'Failed to add the kitchen entry' });
  }
});

router.post('/kitchen/:code/retire', async (req, res) => {
  const code = z.string().regex(/^[a-z0-9_]+$/).safeParse(req.params.code);
  if (!code.success) return res.status(400).json({ error: 'not a kitchen entry code', code: 'KITCHEN_LIST_INVALID' });
  try {
    res.json(await retireKitchenEntry(code.data));
  } catch (err) {
    if (err instanceof KitchenListError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('[admin/brew-profile/kitchen/retire]', err);
    res.status(500).json({ error: 'Failed to retire the kitchen entry' });
  }
});

export default router;
