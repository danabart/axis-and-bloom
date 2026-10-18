// Cupping evidence, brief 1 (2026-10-18), B7 — what roasters said outside the
// portal form, admin side, mounted at /api/admin/roastery-remarks behind
// requireAdmin. GET lists (current only by default); POST records an array of
// remarks in one transaction. No edit or delete: a correction is a new remark
// with supersedesId. No frontend in brief 1.
import { Router, type Response } from 'express';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { recordRemarks, RemarkError, type RemarkInput } from '../services/roasteryRemarkService.js';
import { listRemarks } from '../services/roasteryRemarkReads.js';

const router = Router();
router.use(requireAdmin);

function fail(res: Response, err: unknown): void {
  if (err instanceof RemarkError) {
    res.status(err.status).json({ error: err.code, message: err.message, index: err.index });
    return;
  }
  console.error('[admin/roastery-remarks]', err);
  res.status(500).json({ error: 'Something went wrong' });
}

router.get('/', async (req, res) => {
  try {
    const coffeeId = req.query.coffeeId !== undefined ? Number(req.query.coffeeId) : undefined;
    res.json(await listRemarks({
      roasterId: typeof req.query.roasterId === 'string' ? req.query.roasterId : undefined,
      coffeeId: Number.isInteger(coffeeId) ? coffeeId : undefined,
      currentOnly: req.query.currentOnly !== 'false',
    }));
  } catch (err) {
    fail(res, err);
  }
});

router.post('/', async (req: AuthRequest, res) => {
  try {
    const body = Array.isArray(req.body) ? req.body : req.body?.remarks;
    const rows = await recordRemarks(body as RemarkInput[], { actor: req.email ?? req.uid });
    res.status(201).json({ inserted: rows });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
