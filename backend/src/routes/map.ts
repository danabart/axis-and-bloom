// Ella's Bloom Map 3 (2026-11-12), B2 — the customer API of the map, mounted
// at /api/map behind requireAuth. Every read is the caller's own (or a
// household member's through assertMayTurnDialFor, the dial is open, G2.19).
// Open to admins always; to a customer only when a dial_surface row that uses
// the call says map (none does in this brief; brief 4 flips them).
// Routes validate and call one matchService function (G3.1).
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_3_MATCH_AND_CUSTOMER.md
import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import * as matchService from '../services/matchService.js';
import { MatchError } from '../services/matchService.js';
import { assertMayTurnDialFor, HouseholdError } from '../services/householdService.js';

const router = Router();

// Which surfaces each call serves (the switch, CTO call 1).
const READ_SURFACES = ['customer_face', 'quiz_result', 'profile_trail'];
const MOVE_SURFACES = ['customer_face'];

function fail(res: Response, where: string, err: unknown) {
  if (err instanceof MatchError || err instanceof HouseholdError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'invalid_input', issues: err.issues });
  console.error(`[map ${where}]`, err);
  return res.status(500).json({ error: `Failed: ${where}` });
}

/** The profile this call acts for: the caller's own, or a household member's (forMemberId) with the caller as actor. */
async function subject(req: AuthRequest, surfaces: string[]): Promise<{ userId: string; actorUserId: string | null }> {
  const access = await matchService.mapAccess(req.uid!, surfaces);
  if (!access.profileId) throw new MatchError(404, 'profile_not_found', 'Finish setting up your account first.');
  if (!access.open) throw new MatchError(403, 'map_not_open', 'The map is not open yet.');
  const forMemberId = (req.query.forMemberId ?? req.body?.forMemberId) as unknown;
  if (forMemberId === undefined || forMemberId === null || forMemberId === '') return { userId: access.profileId, actorUserId: null };
  const memberId = z.string().uuid().parse(forMemberId);
  const target = await assertMayTurnDialFor(access.profileId, memberId);
  return { userId: target.userId, actorUserId: access.profileId };
}

router.use(requireAuth);

// The switch, for the pages: which model each surface renders (G4.2: a page
// asks, it never assumes). Any signed-in caller; it holds no customer data.
router.get('/surfaces', async (_req: AuthRequest, res) => {
  try { res.json(await matchService.surfaceModels()); }
  catch (err) { fail(res, 'surfaces', err); }
});

router.get('/face', async (req: AuthRequest, res) => {
  try { await subject(req, READ_SURFACES); res.json(await matchService.face()); }
  catch (err) { fail(res, 'face', err); }
});

router.get('/me', async (req: AuthRequest, res) => {
  try { const s = await subject(req, READ_SURFACES); res.json(await matchService.me(s.userId)); }
  catch (err) { fail(res, 'me', err); }
});

router.get('/moves', async (req: AuthRequest, res) => {
  try { const s = await subject(req, MOVE_SURFACES); res.json(await matchService.moves(s.userId)); }
  catch (err) { fail(res, 'moves', err); }
});

const Decide = z.object({
  move: z.enum(['stay', 'bolder', 'gentler', 'different']),
  coffeeId: z.number().int().positive().optional(),
  forMemberId: z.string().uuid().optional().nullable(),
  /** the client's idempotency key for this tap; a retry with the same key writes nothing new */
  requestId: z.string().uuid().optional(),
});

router.post('/decide', async (req: AuthRequest, res) => {
  try {
    const body = Decide.parse(req.body ?? {});
    if (body.move !== 'stay' && !body.coffeeId) throw new MatchError(400, 'coffee_required', 'Name the coffee for this move.');
    const s = await subject(req, MOVE_SURFACES);
    const result = await matchService.decide({
      userId: s.userId, actorUserId: s.actorUserId, trigger: 'hop', move: body.move,
      pickedCoffeeId: body.coffeeId ?? null, source: 'map', sourceId: body.requestId ?? randomUUID(),
    });
    res.json(result);
  } catch (err) { fail(res, 'decide', err); }
});

export default router;
