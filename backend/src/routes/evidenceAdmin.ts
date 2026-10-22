// Cupping evidence brief 3, B4 (2026-10-18): the read-only evidence routes,
// mounted at /api/admin/evidence behind requireAdmin. Thin callers of
// evidenceReads (the only reader of the v_evidence_* views) and
// evidenceIntegrity. Brief 6, E3 (2026-10-21): one write, PUT
// /parameters/:key, a thin caller of evidenceParameterService.setParameter
// (a new evidence_parameter row superseding the current one). Nothing else
// here writes.
import { Router } from 'express';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { getCoffeeEvidence, getRoasteryEvidence, getEvidenceSummary, getUnmappedWords, getWorkbenchQueue, getWorkbenchCoffee, getParameters } from '../services/evidenceReads.js';
import { runEvidenceIntegrityChecks } from '../services/evidenceIntegrity.js';
import { setParameter, EvidenceParameterError } from '../services/evidenceParameterService.js';

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

/** B3: what the System Health card shows (also embedded in GET /api/admin/system-health). */
export async function evidenceSummaryWithIntegrity() {
  const [summary, integrity] = await Promise.all([getEvidenceSummary(), runEvidenceIntegrityChecks()]);
  return { summary, integrity: integrity.checks };
}

export default router;
