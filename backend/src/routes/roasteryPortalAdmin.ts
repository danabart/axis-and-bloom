// Roastery Portal (2026-10-05) — admin side, mounted at
// /api/admin/roastery-portal behind requireAdmin. Create and revoke links,
// manage each roastery's lineup, read what roasters submitted. No accept,
// promote or edit-on-behalf action exists here by design: accepting answers
// into the catalog is part 2, written after real submissions exist.
//
// Brief: backend/src/features/roastery_portal/CLAUDE_CODE_PROMPT_ROASTERY_PORTAL_1.md

import { Router, type Response } from 'express';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { log } from '../lib/logger.js';
import {
  getVocabulary, listRoasteriesWithProgress, listLinks, getRoasterBasics, getLineup, getLineupCoffee,
  getCurrentResponse, getResponseById, listResponseVersions, getCurrentLineupResponse,
  listLineupResponseVersions, listCatalogCoffeesForRoaster,
} from '../services/roasteryPortalReads.js';
import {
  PortalError, isUuid, createLink, revokeLink, addLineupCoffee, bulkAddLineupCoffees, updateLineupCoffee,
  linkLineupCoffeeToCatalog, deactivateLineupCoffee, reorderLineupCoffees,
} from '../services/roasteryPortalService.js';

const router = Router();
router.use(requireAdmin);

function fail(tag: string, res: Response, err: unknown): void {
  if (err instanceof PortalError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  log.error(tag, err instanceof Error ? err.message : String(err), { stack: err instanceof Error ? err.stack : undefined });
  res.status(500).json({ error: 'Something went wrong' });
}

function badId(res: Response): void {
  res.status(404).json({ error: 'not_found' });
}

// GET /roasteries?includeInactive=1 — each roastery with its progress summary.
router.get('/roasteries', async (req, res) => {
  try {
    res.json(await listRoasteriesWithProgress({ includeInactive: req.query.includeInactive === '1' }));
  } catch (err) { fail('[admin/roastery-portal/roasteries]', res, err); }
});

// GET /vocabulary — the same bundle the partner page reads (admin editors use
// its process / roast level / blend lists).
router.get('/vocabulary', async (_req, res) => {
  try { res.json(await getVocabulary()); } catch (err) { fail('[admin/roastery-portal/vocabulary]', res, err); }
});

// GET /roasteries/:roasterId — one roastery: links, lineup with progress,
// lineup answers, and its own catalog coffees (for the link picker).
router.get('/roasteries/:roasterId', async (req, res) => {
  const { roasterId } = req.params;
  if (!isUuid(roasterId)) return badId(res);
  try {
    const roaster = await getRoasterBasics(roasterId);
    if (!roaster) return badId(res);
    const [links, lineup, lineupResponse, lineupVersions, catalogCoffees] = await Promise.all([
      listLinks(roasterId),
      getLineup(roasterId, { includeInactive: true }),
      getCurrentLineupResponse(roasterId),
      listLineupResponseVersions(roasterId),
      listCatalogCoffeesForRoaster(roasterId),
    ]);
    res.json({ roaster, links, lineup, lineupResponse, lineupVersions, catalogCoffees });
  } catch (err) { fail('[admin/roastery-portal/roastery]', res, err); }
});

// POST /roasteries/:roasterId/links { contactName?, contactEmail? }
router.post('/roasteries/:roasterId/links', async (req: AuthRequest, res) => {
  const { roasterId } = req.params;
  if (!isUuid(roasterId)) return badId(res);
  try {
    const link = await createLink({
      roasterId, contactName: req.body?.contactName, contactEmail: req.body?.contactEmail, adminFirebaseUid: req.uid!,
    });
    res.status(201).json(link);
  } catch (err) { fail('[admin/roastery-portal/create-link]', res, err); }
});

// POST /links/:linkId/revoke
router.post('/links/:linkId/revoke', async (req, res) => {
  if (!isUuid(req.params.linkId)) return badId(res);
  try { res.json(await revokeLink(req.params.linkId)); } catch (err) { fail('[admin/roastery-portal/revoke-link]', res, err); }
});

// POST /roasteries/:roasterId/lineup { name, origin?, processValues?, roastLevel?, blendOrSingle?, isDecaf?, prefillSource? }
router.post('/roasteries/:roasterId/lineup', async (req, res) => {
  const { roasterId } = req.params;
  if (!isUuid(roasterId)) return badId(res);
  try {
    const b = req.body ?? {};
    const created = await addLineupCoffee({
      roasterId, addedBy: 'admin', name: b.name, origin: b.origin, processValues: b.processValues,
      roastLevel: b.roastLevel, blendOrSingle: b.blendOrSingle, isDecaf: b.isDecaf, prefillSource: b.prefillSource,
    });
    res.status(201).json(created);
  } catch (err) { fail('[admin/roastery-portal/add-coffee]', res, err); }
});

// POST /roasteries/:roasterId/lineup/bulk { text } — one coffee name per line.
router.post('/roasteries/:roasterId/lineup/bulk', async (req, res) => {
  const { roasterId } = req.params;
  if (!isUuid(roasterId)) return badId(res);
  try {
    const raw = req.body?.text;
    if (typeof raw !== 'string') throw new PortalError('validation', 'text is required', 400);
    res.status(201).json(await bulkAddLineupCoffees({
      roasterId, names: raw.split(/\r?\n/), prefillSource: req.body?.prefillSource,
    }));
  } catch (err) { fail('[admin/roastery-portal/bulk-add]', res, err); }
});

// PUT /roasteries/:roasterId/lineup/order { ids: [...] }
router.put('/roasteries/:roasterId/lineup/order', async (req, res) => {
  const { roasterId } = req.params;
  if (!isUuid(roasterId)) return badId(res);
  try {
    await reorderLineupCoffees({ roasterId, orderedIds: req.body?.ids });
    res.json({ ok: true });
  } catch (err) { fail('[admin/roastery-portal/reorder]', res, err); }
});

// PATCH /roasteries/:roasterId/lineup/:id — edit name / prefills.
router.patch('/roasteries/:roasterId/lineup/:id', async (req, res) => {
  const { roasterId, id } = req.params;
  if (!isUuid(roasterId) || !isUuid(id)) return badId(res);
  try {
    await updateLineupCoffee({ roasterId, portalCoffeeId: id, patch: req.body ?? {} });
    res.json({ ok: true });
  } catch (err) { fail('[admin/roastery-portal/update-coffee]', res, err); }
});

// POST /roasteries/:roasterId/lineup/:id/link-catalog { coffeeId: number | null }
router.post('/roasteries/:roasterId/lineup/:id/link-catalog', async (req, res) => {
  const { roasterId, id } = req.params;
  if (!isUuid(roasterId) || !isUuid(id)) return badId(res);
  try {
    const coffeeId = req.body?.coffeeId === null || req.body?.coffeeId === undefined ? null : Number(req.body.coffeeId);
    await linkLineupCoffeeToCatalog({ roasterId, portalCoffeeId: id, coffeeId });
    res.json({ ok: true });
  } catch (err) { fail('[admin/roastery-portal/link-catalog]', res, err); }
});

// POST /roasteries/:roasterId/lineup/:id/deactivate
router.post('/roasteries/:roasterId/lineup/:id/deactivate', async (req, res) => {
  const { roasterId, id } = req.params;
  if (!isUuid(roasterId) || !isUuid(id)) return badId(res);
  try {
    await deactivateLineupCoffee({ roasterId, portalCoffeeId: id });
    res.json({ ok: true });
  } catch (err) { fail('[admin/roastery-portal/deactivate]', res, err); }
});

// GET /roasteries/:roasterId/lineup/:id/response[?responseId=...] — a coffee's
// current response (or one chosen version) plus the version list.
router.get('/roasteries/:roasterId/lineup/:id/response', async (req, res) => {
  const { roasterId, id } = req.params;
  if (!isUuid(roasterId) || !isUuid(id)) return badId(res);
  try {
    const coffee = await getLineupCoffee(roasterId, id);
    if (!coffee) return badId(res);
    const versions = await listResponseVersions(id);
    const wanted = typeof req.query.responseId === 'string' ? req.query.responseId : null;
    let response = null;
    if (wanted) {
      if (!isUuid(wanted) || !versions.some(v => v.id === wanted)) return badId(res);
      response = await getResponseById(wanted);
    } else {
      response = await getCurrentResponse(id);
    }
    res.json({ coffee, response, versions });
  } catch (err) { fail('[admin/roastery-portal/response]', res, err); }
});

export default router;
