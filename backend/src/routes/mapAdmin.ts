// Ella's Bloom Map 1 (2026-11-10), B4 — the map's admin API, mounted by
// routes/admin.ts at /api/admin/map behind its requireAdmin (admin role,
// server-side). Routes validate (zod) and call one function: reads go to
// dialReads, writes to dialPlacementService or catalogService.setLean.
// Parameters are edited through the evidence-parameter endpoints
// (GET /api/admin/evidence/parameters?prefix=dial_, PUT .../:key).
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_1_SCHEMA_RULES_PREVIEW.md
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth.js';
import * as dialReads from '../services/dialReads.js';
import { cutVersion, activateVersion, setWedge, setFirstMatch, setHopPhrase, DialMapError } from '../services/dialPlacementService.js';
import { setLean, CatalogError } from '../services/catalogService.js';

const router = Router();

const Mode = z.enum(['preview', 'active']);
const ARCHETYPE = z.enum(['chocolate_nutty', 'balanced_sweet', 'fruity', 'earthy', 'floral']);
const LANE = z.enum(['side_a', 'middle', 'side_b']);

function fail(res: Response, where: string, err: unknown) {
  if (err instanceof DialMapError || err instanceof CatalogError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', issues: err.issues });
  console.error(`[admin/map ${where}]`, err);
  return res.status(500).json({ error: `Failed: ${where}` });
}

const read = (where: string, fn: (req: AuthRequest) => Promise<unknown>) => async (req: AuthRequest, res: Response) => {
  try { res.json(await fn(req)); } catch (err) { fail(res, where, err); }
};

const modeOf = (req: AuthRequest) => Mode.parse(req.query.mode ?? 'preview');
const optionalCoffeeId = (req: AuthRequest) =>
  req.query.coffeeId === undefined ? undefined : z.coerce.number().int().positive().parse(req.query.coffeeId);

router.get('/preview', read('preview', () => dialReads.placementPreview()));
router.get('/placement', read('placement', () => dialReads.placementActive()));
router.get('/edges', read('edges', async req => (modeOf(req) === 'preview' ? dialReads.edgesPreview() : dialReads.edges())));
router.get('/hops', read('hops', async req => {
  const coffeeId = optionalCoffeeId(req);
  return modeOf(req) === 'preview' ? dialReads.hopsPreview(coffeeId) : dialReads.hops(coffeeId);
}));
router.get('/face', read('face', () => dialReads.face()));
router.get('/graph-check', read('graph-check', req => dialReads.graphCheck(modeOf(req))));
router.get('/versions', read('versions', () => dialReads.versions()));
router.get('/wedges', read('wedges', () => dialReads.wedges()));
router.get('/first-match', read('first-match', () => dialReads.firstMatches()));
router.get('/phrases', read('phrases', () => dialReads.phrases()));
// Ella map 2 (2026-11-10): the workbench's words and the lean history
router.get('/vocabulary', read('vocabulary', () => dialReads.vocabulary()));
router.get('/lean/:coffeeId/history', read('lean history', req =>
  dialReads.leanHistory(z.coerce.number().int().positive().parse(req.params.coffeeId))));

const CutBody = z.object({ label: z.string().trim().min(1).max(60), reason: z.string().trim().max(2000).nullable().optional() });
router.post('/versions', async (req: AuthRequest, res) => {
  try {
    const body = CutBody.parse(req.body ?? {});
    const result = await cutVersion({ label: body.label, reason: body.reason ?? null, adminUid: req.uid ?? null });
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) { fail(res, 'cut version', err); }
});

router.post('/versions/:id/activate', async (req: AuthRequest, res) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await activateVersion(id, req.uid ?? null));
  } catch (err) { fail(res, 'activate version', err); }
});

const LeanBody = z.object({
  lane: LANE,
  basis: z.record(z.string(), z.unknown()).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
router.patch('/lean/:coffeeId', async (req: AuthRequest, res) => {
  try {
    const coffeeId = z.coerce.number().int().positive().parse(req.params.coffeeId);
    const body = LeanBody.parse(req.body ?? {});
    res.json(await setLean(coffeeId, body.lane, { basis: body.basis ?? undefined, notes: body.notes ?? undefined }, { actor: req.uid ?? 'unknown' }));
  } catch (err) { fail(res, 'set lean', err); }
});

const WedgeBody = z.object({
  rulerDimensionId: z.number().int().positive().nullable().optional(),
  sideAArchetype: ARCHETYPE.optional(),
  sideBArchetype: ARCHETYPE.optional(),
  angleOrder: z.number().int().min(0).max(9).optional(),
  seamFamilyNoteId: z.string().uuid().nullable().optional(),
  seamUsesBody: z.boolean().optional(),
  seamUsesDarkRoast: z.boolean().optional(),
}).strict();
router.patch('/wedges/:archetype', async (req: AuthRequest, res) => {
  try {
    const archetype = ARCHETYPE.parse(req.params.archetype);
    res.json(await setWedge(archetype, WedgeBody.parse(req.body ?? {}), req.uid ?? null));
  } catch (err) { fail(res, 'set wedge', err); }
});

const FirstMatchBody = z.object({
  archetype: ARCHETYPE, lane: LANE, coffeeId: z.number().int().positive(),
  status: z.enum(['founder_pick', 'derived']).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
router.put('/first-match', async (req: AuthRequest, res) => {
  try {
    const b = FirstMatchBody.parse(req.body ?? {});
    res.json(await setFirstMatch({ archetypeCode: b.archetype, laneCode: b.lane, coffeeId: b.coffeeId, statusCode: b.status, notes: b.notes ?? null, adminUid: req.uid ?? null }));
  } catch (err) { fail(res, 'set first match', err); }
});

const PhraseBody = z.object({
  archetype: ARCHETYPE.nullable(),
  move: z.enum(['stay', 'bolder', 'gentler', 'different']),
  buttonLabel: z.string().trim().min(1).max(60),
  moveLineTemplate: z.string().trim().max(300).nullable().optional(),
  edgePhrase: z.string().trim().max(300).nullable().optional(),
});
router.put('/phrases', async (req: AuthRequest, res) => {
  try {
    const b = PhraseBody.parse(req.body ?? {});
    res.json(await setHopPhrase({ archetypeCode: b.archetype, moveCode: b.move, buttonLabel: b.buttonLabel,
      moveLineTemplate: b.moveLineTemplate ?? null, edgePhrase: b.edgePhrase ?? null, adminUid: req.uid ?? null }));
  } catch (err) { fail(res, 'set phrase', err); }
});

export default router;
