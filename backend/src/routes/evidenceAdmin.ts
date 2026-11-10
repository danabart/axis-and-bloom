// Cupping evidence brief 3, B4 (2026-10-18): the read-only evidence routes,
// mounted at /api/admin/evidence behind requireAdmin. Thin callers of
// evidenceReads (the only reader of the v_evidence_* views) and
// evidenceIntegrity. Brief 6, E3 (2026-10-21): one write, PUT
// /parameters/:key, a thin caller of evidenceParameterService.setParameter
// (a new evidence_parameter row superseding the current one). Brief 9
// (2026-11-09): POST /disputes and POST /disputes/:id/withdraw, thin callers
// of cuppingService.raiseDispute / withdrawDispute (api_event logs them).
// Nothing else here writes.
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { getCoffeeEvidence, getRoasteryEvidence, getEvidenceSummary, getUnmappedWords, getWorkbenchQueue, getWorkbenchCoffee, getParameters } from '../services/evidenceReads.js';
import { runEvidenceIntegrityChecks } from '../services/evidenceIntegrity.js';
import { setParameter, EvidenceParameterError } from '../services/evidenceParameterService.js';
import { raiseDispute, withdrawDispute, CuppingError } from '../services/cuppingService.js';

const router = Router();
router.use(requireAdmin);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/coffee/:coffeeId', async (req, res) => {
  const coffeeId = Number(req.params.coffeeId);
  if (!Number.isInteger(coffeeId) || coffeeId <= 0) return res.status(400).json({ error: 'coffeeId must be a positive integer' });
  try {
    res.json(await getCoffeeEvidence(coffeeId));
  } catch (err) {
    console.error('[admin/evidence/coffee]', err);
    res.status(500).json({ error: 'Failed to read the coffee evidence' });
  }
});

router.get('/roastery/:roasterId', async (req, res) => {
  if (!UUID.test(req.params.roasterId)) return res.status(400).json({ error: 'roasterId must be a UUID' });
  try {
    res.json(await getRoasteryEvidence(req.params.roasterId));
  } catch (err) {
    console.error('[admin/evidence/roastery]', err);
    res.status(500).json({ error: 'Failed to read the roastery evidence' });
  }
});

// Cupping evidence brief 4, Part A: the Calibration workbench reads.
router.get('/workbench/coffee/:coffeeId', async (req, res) => {
  const coffeeId = Number(req.params.coffeeId);
  if (!Number.isInteger(coffeeId) || coffeeId <= 0) return res.status(400).json({ error: 'coffeeId must be a positive integer' });
  try {
    const bundle = await getWorkbenchCoffee(coffeeId);
    if (!bundle.coffee) return res.status(404).json({ error: 'coffee not found' });
    res.json(bundle);
  } catch (err) {
    console.error('[admin/evidence/workbench/coffee]', err);
    res.status(500).json({ error: 'Failed to read the workbench coffee' });
  }
});

router.get('/workbench/:roasterId', async (req, res) => {
  if (!UUID.test(req.params.roasterId)) return res.status(400).json({ error: 'roasterId must be a UUID' });
  try {
    res.json(await getWorkbenchQueue(req.params.roasterId));
  } catch (err) {
    console.error('[admin/evidence/workbench]', err);
    res.status(500).json({ error: 'Failed to read the workbench queue' });
  }
});

router.get('/summary', async (_req, res) => {
  try {
    res.json(await evidenceSummaryWithIntegrity());
  } catch (err) {
    console.error('[admin/evidence/summary]', err);
    res.status(500).json({ error: 'Failed to read the evidence summary' });
  }
});

router.get('/unmapped-words', async (_req, res) => {
  try {
    res.json(await getUnmappedWords());
  } catch (err) {
    console.error('[admin/evidence/unmapped-words]', err);
    res.status(500).json({ error: 'Failed to read the unmapped words' });
  }
});

// Brief 6, E2/E3: the evidence parameters card (System Health).
router.get('/parameters', async (_req, res) => {
  try {
    res.json(await getParameters());
  } catch (err) {
    console.error('[admin/evidence/parameters]', err);
    res.status(500).json({ error: 'Failed to read the evidence parameters' });
  }
});

router.put('/parameters/:key', async (req: AuthRequest, res) => {
  try {
    const result = await setParameter(req.params.key, req.body?.value, req.body?.note ?? null, req.uid ?? null);
    res.json(result);
  } catch (err) {
    if (err instanceof EvidenceParameterError) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('[admin/evidence/parameters PUT]', err);
    res.status(500).json({ error: 'Failed to save the evidence parameter' });
  }
});

// Brief 9: disputes, raised and withdrawn from the Calibration workbench.
const RaiseBody = z.object({
  cuppingScoreId: z.number().int().positive(),
  dimensionId: z.number().int().positive().nullable().optional(),
  reason: z.string().trim().min(1),
});
const WithdrawBody = z.object({ reason: z.string().trim().min(1) });

function disputeError(err: unknown, res: import('express').Response, label: string) {
  if (err instanceof CuppingError) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(`[admin/evidence/${label}]`, err);
  return res.status(500).json({ error: `Failed: ${label}` });
}

router.post('/disputes', async (req: AuthRequest, res) => {
  const body = RaiseBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'cuppingScoreId and reason are required; dimensionId is a positive integer or null', code: 'CUPPING_INVALID' });
  if (!req.uid) return res.status(401).json({ error: 'no admin uid' });
  try {
    const result = await raiseDispute({ cuppingScoreId: body.data.cuppingScoreId, dimensionId: body.data.dimensionId ?? null, reason: body.data.reason, raisedByUid: req.uid });
    res.status(result.alreadyOpen ? 200 : 201).json(result);
  } catch (err) {
    disputeError(err, res, 'disputes POST');
  }
});

router.post('/disputes/:id/withdraw', async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id must be a positive integer', code: 'CUPPING_INVALID' });
  const body = WithdrawBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'reason is required', code: 'CUPPING_INVALID' });
  if (!req.uid) return res.status(401).json({ error: 'no admin uid' });
  try {
    res.json(await withdrawDispute({ disputeId: id, withdrawnByUid: req.uid, reason: body.data.reason }));
  } catch (err) {
    disputeError(err, res, 'disputes withdraw');
  }
});

/** B3: what the System Health card shows (also embedded in GET /api/admin/system-health). */
export async function evidenceSummaryWithIntegrity() {
  const [summary, integrity] = await Promise.all([getEvidenceSummary(), runEvidenceIntegrityChecks()]);
  return { summary, integrity: integrity.checks };
}

export default router;
