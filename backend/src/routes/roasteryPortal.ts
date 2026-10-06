// Roastery Portal (2026-10-05) — the PUBLIC, token-gated partner surface,
// mounted at /api/roastery-portal. One private, revocable link per roastery;
// no sign-in. An unknown or revoked token returns the same 404 on every
// route, and every write checks that the respondent, the lineup coffee, the
// cousin and every lookup value belong to THIS token's roastery (or to the
// allowed vocabulary). Nothing here writes to the catalog: the only writer of
// roastery_portal_* is services/roasteryPortalService.ts.
//
// Brief: backend/src/features/roastery_portal/CLAUDE_CODE_PROMPT_ROASTERY_PORTAL_1.md

import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { getRealClientIp } from '../middleware/clientIp.js';
import { log } from '../lib/logger.js';
import {
  getActiveLinkByToken, getPortalLanding, getLineupCoffee, getCurrentResponse, type PortalLinkContext,
} from '../services/roasteryPortalReads.js';
import { notifySubmission } from '../services/roasteryPortalNotify.js';
import {
  PortalError, isUuid, touchLink, upsertRespondent, addLineupCoffee, saveDraft, submitResponse,
  saveLineupDraft, submitLineupResponse,
} from '../services/roasteryPortalService.js';

const router = Router();

// Modelled on qrResolveLimiter (routes/qr.ts): keyed on the real visitor IP
// (middleware/clientIp.ts). Higher than the QR door's 30/min because one
// person editing a coffee autosaves about once a second.
const portalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  keyGenerator: getRealClientIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests — please slow down.' },
});
router.use(portalLimiter);

interface PortalRequest extends Request { link?: PortalLinkContext }

// One answer for "no such token", "revoked token" and "someone else's coffee":
// callers must not be able to tell them apart.
function notFound(res: Response): void {
  res.status(404).json({ error: 'not_found' });
}

async function loadLink(req: PortalRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const link = await getActiveLinkByToken(req.params.token);
    if (!link) { notFound(res); return; }
    req.link = link;
    next();
  } catch (err) {
    log.error('[roastery-portal/load-link]', err instanceof Error ? err.message : String(err), {});
    res.status(500).json({ error: 'Something went wrong' });
  }
}

function handleError(tag: string, res: Response, err: unknown): void {
  if (err instanceof PortalError) {
    if (err.status === 404) { notFound(res); return; }
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  log.error(tag, err instanceof Error ? err.message : String(err), { stack: err instanceof Error ? err.stack : undefined });
  res.status(500).json({ error: 'Something went wrong' });
}

// ── GET /:token — the whole landing payload ─────────────────────────────────
router.get('/:token', loadLink, async (req: PortalRequest, res) => {
  const link = req.link!;
  try {
    await touchLink(link.linkId);
    res.json(await getPortalLanding({
      roasterId: link.roasterId, roasteryName: link.roasteryName, contact: { name: link.contactName, email: link.contactEmail },
    }));
  } catch (err) { handleError('[roastery-portal/landing]', res, err); }
});

// ── POST /:token/respondent { name, email } ─────────────────────────────────
router.post('/:token/respondent', loadLink, async (req: PortalRequest, res) => {
  const link = req.link!;
  try {
    const respondent = await upsertRespondent({
      roasterId: link.roasterId, linkId: link.linkId, name: req.body?.name, email: req.body?.email,
    });
    res.json({ respondentId: respondent.id, name: respondent.name });
  } catch (err) { handleError('[roastery-portal/respondent]', res, err); }
});

// ── POST /:token/coffees { name, respondentId } — a coffee we missed ────────
router.post('/:token/coffees', loadLink, async (req: PortalRequest, res) => {
  const link = req.link!;
  try {
    const created = await addLineupCoffee({
      roasterId: link.roasterId, name: req.body?.name, addedBy: 'roaster', respondentId: req.body?.respondentId,
    });
    res.status(201).json({ id: created.id, name: created.name });
  } catch (err) { handleError('[roastery-portal/add-coffee]', res, err); }
});

// A coffee id that isn't a UUID, or isn't this roastery's, is a plain 404.
async function loadCoffee(req: PortalRequest, res: Response) {
  const id = req.params.id;
  if (!isUuid(id)) { notFound(res); return null; }
  const coffee = await getLineupCoffee(req.link!.roasterId, id);
  if (!coffee || !coffee.isActive) { notFound(res); return null; }
  return coffee;
}

// ── GET /:token/coffees/:id — prefill + current response ────────────────────
router.get('/:token/coffees/:id', loadLink, async (req: PortalRequest, res) => {
  try {
    const coffee = await loadCoffee(req, res);
    if (!coffee) return;
    const response = await getCurrentResponse(coffee.portalCoffeeId);
    res.json({ coffee, response });
  } catch (err) { handleError('[roastery-portal/get-coffee]', res, err); }
});

// ── PUT /:token/coffees/:id/draft { respondentId, doc } — full-document save ─
router.put('/:token/coffees/:id/draft', loadLink, async (req: PortalRequest, res) => {
  try {
    const coffee = await loadCoffee(req, res);
    if (!coffee) return;
    const saved = await saveDraft({
      roasterId: req.link!.roasterId, portalCoffeeId: coffee.portalCoffeeId,
      respondentId: req.body?.respondentId, doc: req.body?.doc,
    });
    res.json(saved);
  } catch (err) { handleError('[roastery-portal/save-draft]', res, err); }
});

// ── POST /:token/coffees/:id/submit { respondentId } ────────────────────────
router.post('/:token/coffees/:id/submit', loadLink, async (req: PortalRequest, res) => {
  try {
    const coffee = await loadCoffee(req, res);
    if (!coffee) return;
    const submitted = await submitResponse({
      roasterId: req.link!.roasterId, portalCoffeeId: coffee.portalCoffeeId, respondentId: req.body?.respondentId,
    });
    // Part 2, F3: one plain internal email to every admin, resolved at send time. Awaited
    // (Cloud Run may pause the instance once the response is out) but it never throws.
    await notifySubmission(submitted.responseId);
    log.info('[roastery-portal/submitted]', `${req.link!.roasteryName}: ${submitted.coffeeName} submitted by ${submitted.respondentName}`, {
      version: submitted.version,
    });
    res.json({ version: submitted.version, submittedAt: submitted.submittedAt });
  } catch (err) { handleError('[roastery-portal/submit]', res, err); }
});

// ── PUT /:token/lineup { respondentId, doc } · POST /:token/lineup/submit ───
router.put('/:token/lineup', loadLink, async (req: PortalRequest, res) => {
  try {
    const saved = await saveLineupDraft({ roasterId: req.link!.roasterId, respondentId: req.body?.respondentId, doc: req.body?.doc });
    res.json(saved);
  } catch (err) { handleError('[roastery-portal/save-lineup]', res, err); }
});

router.post('/:token/lineup/submit', loadLink, async (req: PortalRequest, res) => {
  try {
    const submitted = await submitLineupResponse({ roasterId: req.link!.roasterId, respondentId: req.body?.respondentId });
    log.info('[roastery-portal/lineup-submitted]', `${req.link!.roasteryName}: lineup answers submitted by ${submitted.respondentName}`, {
      version: submitted.version,
    });
    res.json({ version: submitted.version, submittedAt: submitted.submittedAt });
  } catch (err) { handleError('[roastery-portal/submit-lineup]', res, err); }
});

export default router;
