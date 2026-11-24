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
import { cutVersion, activateVersion, setWedge, setFirstMatch, setHopPhrase, setSurfaceModel, setCustomerCopy, setStep, publish, setStartRule, setSaidBack, setReasonChoice, DialMapError } from '../services/dialPlacementService.js';
import { getMatchDecisions, searchCustomersForMap } from '../services/customerReads.js';
import { steps as composedSteps } from '../services/matchService.js';
import { setLean, setRing, CatalogError } from '../services/catalogService.js';

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
// Ella map 7 (B5): the start rule, where a quiz result starts. GET returns the
// current rows (table 1 of /admin/map) and, with ?history=1, every row.
router.get('/start-rules', read('start rules', req => dialReads.startRules({ history: req.query.history === '1' })));
const StartRuleBody = z.object({
  family: z.string().trim().min(1).max(40),
  priority: z.number().int().positive().max(999),
  condition: z.string().trim().min(1).max(60),
  alsoCondition: z.string().trim().min(1).max(60).nullable().optional(),
  coffeeId: z.number().int().positive(),
  adminLabel: z.string().trim().min(1).max(300),
  customerReason: z.string().trim().min(1).max(600),
  notes: z.string().trim().max(2000).nullable().optional(),
  // Ella map 9 (A3): left out = unchanged, null or empty = cleared
  coffeeLine: z.string().trim().max(600).nullable().optional(),
  leadToCoffeeId: z.number().int().positive().nullable().optional(),
  leadLine: z.string().trim().max(600).nullable().optional(),
  leadQuoteFamily: z.string().trim().max(40).nullable().optional(),
});
router.put('/start-rules', async (req: AuthRequest, res) => {
  try {
    const b = StartRuleBody.parse(req.body ?? {});
    res.json(await setStartRule({
      familyCode: b.family, priority: b.priority, conditionCode: b.condition, alsoConditionCode: b.alsoCondition ?? null,
      coffeeId: b.coffeeId, adminLabel: b.adminLabel, customerReason: b.customerReason, notes: b.notes ?? null, adminUid: req.uid ?? null,
      coffeeLine: b.coffeeLine, leadToCoffeeId: b.leadToCoffeeId, leadLine: b.leadLine, leadQuoteFamilyCode: b.leadQuoteFamily,
    }));
  } catch (err) { fail(res, 'set start rule', err); }
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

// ── Ella's Bloom Map 3 (2026-11-12), B5: the switch, the decisions, the customer words ──
router.get('/surfaces', read('surfaces', () => dialReads.surfaces()));
const SurfaceBody = z.object({ model: z.enum(['lane', 'map']) });
router.patch('/surfaces/:code', async (req: AuthRequest, res) => {
  try {
    const code = z.string().trim().min(1).max(60).parse(req.params.code);
    res.json(await setSurfaceModel(code, SurfaceBody.parse(req.body ?? {}).model, req.uid ?? null));
  } catch (err) { fail(res, 'set surface', err); }
});

router.get('/decisions', read('decisions', req => getMatchDecisions({
  profileId: req.query.userId === undefined || req.query.userId === '' ? null : z.string().uuid().parse(req.query.userId),
  limit: z.coerce.number().int().min(1).max(200).parse(req.query.limit ?? 25),
})));

router.get('/customer-copy', read('customer copy', () => dialReads.customerCopyRows()));
const CopyBody = z.object({ code: z.string().trim().min(1).max(60), text: z.string().trim().min(1).max(500) });
router.put('/customer-copy', async (req: AuthRequest, res) => {
  try {
    const b = CopyBody.parse(req.body ?? {});
    res.json(await setCustomerCopy({ code: b.code, text: b.text, adminUid: req.uid ?? null }));
  } catch (err) { fail(res, 'set customer copy', err); }
});

// ── Ella's Bloom Map 5 (2026-11-16), B3/B4: the decided map ──
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_5_DECIDED_MAP_AND_ADMIN.md
router.get('/decided', read('decided map', () => dialReads.decidedMap()));
router.get('/steps', read('steps', req => dialReads.steps(z.enum(['current', 'active']).parse(req.query.mode ?? 'current'))));

const StepBody = z.object({
  from: z.number().int().positive(),
  to: z.number().int().positive(),
  word: z.string().trim().min(1).max(60),
  line: z.string().trim().max(300).nullable().optional(),
  basis: z.string().trim().min(1).max(60),
  shown: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  // Ella map 9 (A4): left out = unchanged, null = cleared
  move: z.string().trim().max(40).nullable().optional(),
  whenLine: z.string().trim().max(300).nullable().optional(),
});
router.put('/steps', async (req: AuthRequest, res) => {
  try {
    const b = StepBody.parse(req.body ?? {});
    res.json(await setStep({ fromCoffeeId: b.from, toCoffeeId: b.to, buttonWord: b.word, customerLine: b.line ?? null,
      basisCode: b.basis, isShown: b.shown, notes: b.notes, adminUid: req.uid ?? null, moveCode: b.move, whenLine: b.whenLine }));
  } catch (err) { fail(res, 'set step', err); }
});

const RingBody = z.object({
  ring: z.number().int().min(0).max(3),
  basis: z.string().trim().min(1).max(2000),
  notes: z.string().trim().max(2000).nullable().optional(),
});
router.patch('/ring/:coffeeId', async (req: AuthRequest, res) => {
  try {
    const coffeeId = z.coerce.number().int().positive().parse(req.params.coffeeId);
    const b = RingBody.parse(req.body ?? {});
    res.json(await setRing(coffeeId, b.ring, { basis: { text: b.basis }, notes: b.notes ?? undefined }, { actor: req.uid ?? 'unknown' }));
  } catch (err) { fail(res, 'set ring', err); }
});
router.get('/ring/:coffeeId/history', read('ring history', req =>
  dialReads.ringHistory(z.coerce.number().int().positive().parse(req.params.coffeeId))));

const PublishBody = z.object({ label: z.string().trim().min(1).max(60), reason: z.string().trim().min(1).max(2000) });
router.post('/publish', async (req: AuthRequest, res) => {
  try {
    const b = PublishBody.parse(req.body ?? {});
    res.status(201).json(await publish({ label: b.label, reason: b.reason, adminUid: req.uid ?? null }));
  } catch (err) { fail(res, 'publish', err); }
});

// â”€â”€ Ella's Bloom Map 9 (2026-11-20), B1/B3/C2: what we say back, and "Read it as" â”€â”€
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_9_PERSONAL_REASONS.md
router.get('/said-back', read('said back', () => dialReads.saidBackFacts()));
router.get('/said-back/history', read('said back history', () => dialReads.saidBackHistory()));
const SaidBackBody = z.object({
  source: z.string().trim().min(1).max(40),
  fact: z.string().trim().min(1).max(80),
  saysBack: z.string().trim().max(300).nullable(),
  isQuoted: z.boolean().optional(),
  // Ella map 10: the direction the fact argues for (a customer move code); null = none; left out = kept
  move: z.string().trim().min(1).max(40).nullable().optional(),
});
router.put('/said-back', async (req: AuthRequest, res) => {
  try {
    const b = SaidBackBody.parse(req.body ?? {});
    res.json(await setSaidBack({ sourceCode: b.source, factCode: b.fact, saysBack: b.saysBack, isQuoted: b.isQuoted, moveCode: b.move, adminUid: req.uid ?? null }));
  } catch (err) { fail(res, 'set said back', err); }
});
// Ella map 10 (B4): how a card is chosen, the ordered switchable rows (dial_reason_choice)
router.get('/reason-choices', read('reason choices', req => dialReads.reasonChoices({ history: req.query.history === '1' })));
const ReasonChoiceBody = z.object({
  kind: z.string().trim().min(1).max(40),
  code: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(120).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});
router.put('/reason-choices', async (req: AuthRequest, res) => {
  try {
    const b = ReasonChoiceBody.parse(req.body ?? {});
    res.json(await setReasonChoice({ kindCode: b.kind, code: b.code, label: b.label, sortOrder: b.sortOrder, isActive: b.isActive, adminUid: req.uid ?? null }));
  } catch (err) { fail(res, 'set reason choice', err); }
});
// The picker: customers by email (at least 3 characters)
router.get('/customers', read('customer search', req => searchCustomersForMap(z.string().trim().min(3).max(120).parse(req.query.q ?? ''))));
// B3: the composed page for any customer, with the rows each text used; read only (a customer with no decision reads their start rule, C8)
router.get('/reasons', read('reasons', req =>
  composedSteps(z.string().uuid().parse(req.query.profileId), undefined, { withBasis: true, readAsRule: true })));

export default router;
