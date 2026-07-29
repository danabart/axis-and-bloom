import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, blockAnonymousAuth, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';

const router = Router();

// Codes are short and human-typeable by design (unlike household_invitation's 32-byte hex
// token) — that trades away brute-force resistance for usability, so this route pair gets a
// much tighter IP-scoped limiter than the site-wide default (200/15min in index.ts).
const redemptionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15 });
router.use(redemptionLimiter);

async function getProfile(uid: string) {
  const r = await db.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [uid]);
  return r.rows[0] ?? null;
}

// GET /api/company-gift-redemption/:code — public, no auth
router.get('/:code', async (req, res) => {
  const code = req.params.code?.trim().toUpperCase();
  if (!code) { res.status(400).json({ valid: false, error: 'code required' }); return; }
  try {
    const r = await db.query(
      `SELECT cgc.status, cg.company_name, cg.sponsorship_months, cg.payment_confirmed_at, cg.code_redeem_by
       FROM company_gift_code cgc
       JOIN company_gift cg ON cg.id = cgc.company_gift_id
       WHERE cgc.code = $1`,
      [code]
    );
    if (!r.rows.length) { res.status(404).json({ valid: false, error: 'not found' }); return; }
    const row = r.rows[0];
    if (row.status === 'redeemed') { res.status(410).json({ valid: false, error: 'already redeemed' }); return; }
    // Deadline check runs before trusting a stale 'expired' status — the daily sweep may not
    // have run yet, so a still-'unredeemed' code past its deadline must also be caught here.
    if (row.code_redeem_by && new Date(row.code_redeem_by) < new Date()) {
      res.status(410).json({ valid: false, error: 'redemption window closed' });
      return;
    }
    if (row.status === 'expired') { res.status(410).json({ valid: false, error: 'redemption window closed' }); return; }
    if (!row.payment_confirmed_at) { res.status(403).json({ valid: false, error: 'payment not yet confirmed' }); return; }
    // Returning company name is fine here — the employee already knows who gave them this
    // gift. The privacy concern this feature guards against is other employees seeing it.
    res.json({ valid: true, companyName: row.company_name, sponsorshipMonths: row.sponsorship_months });
  } catch (err) {
    console.error('[company-gift-redemption/lookup]', err);
    res.status(500).json({ error: 'Failed to look up code' });
  }
});

// POST /api/company-gift-redemption/:code/redeem
router.post('/:code/redeem', requireAuth, blockAnonymousAuth, async (req: AuthRequest, res) => {
  const code = req.params.code?.trim().toUpperCase();
  if (!code) { res.status(400).json({ error: 'code required' }); return; }

  const profile = await getProfile(req.uid!);
  if (!profile) { res.status(404).json({ error: 'Profile not found' }); return; }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const r = await client.query(
      `SELECT cgc.id, cgc.status, cg.id AS company_gift_id, cg.payment_confirmed_at,
              cg.code_redeem_by, cg.sponsorship_months
       FROM company_gift_code cgc
       JOIN company_gift cg ON cg.id = cgc.company_gift_id
       WHERE cgc.code = $1
       FOR UPDATE OF cgc`,
      [code]
    );
    if (!r.rows.length) { await client.query('ROLLBACK'); res.status(404).json({ error: 'not found' }); return; }
    const row = r.rows[0];
    if (row.status === 'redeemed') {
      await client.query('ROLLBACK'); res.status(410).json({ error: 'already redeemed' }); return;
    }
    if (row.code_redeem_by && new Date(row.code_redeem_by) < new Date()) {
      await client.query('ROLLBACK'); res.status(410).json({ error: 'redemption window closed' }); return;
    }
    if (row.status === 'expired') {
      await client.query('ROLLBACK'); res.status(410).json({ error: 'redemption window closed' }); return;
    }
    if (!row.payment_confirmed_at) {
      await client.query('ROLLBACK'); res.status(403).json({ error: 'payment not yet confirmed' }); return;
    }

    // Only one *active* sponsored subscription at a time — a lapsed one from an earlier
    // (possibly different) employer must not block a new redemption.
    const activeSponsored = await client.query(
      `SELECT id FROM subscription WHERE user_id = $1 AND status = 'active' AND company_gift_id IS NOT NULL`,
      [profile.id]
    );
    if (activeSponsored.rows.length) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'already has an active sponsored subscription' });
      return;
    }

    await client.query(
      `UPDATE company_gift_code SET status = 'redeemed', redeemed_by_user_id = $2, redeemed_at = now() WHERE id = $1`,
      [row.id, profile.id]
    );
    await client.query(`UPDATE user_profile SET company_gift_id = $2 WHERE id = $1`, [profile.id, row.company_gift_id]);
    const subResult = await client.query(
      `INSERT INTO subscription (user_id, status, company_gift_id, sponsored_expires_at)
       VALUES ($1, 'active', $2, now() + ($3::text || ' months')::interval)
       RETURNING id, sponsored_expires_at`,
      [profile.id, row.company_gift_id, row.sponsorship_months]
    );

    await client.query('COMMIT');
    res.json({ ok: true, sponsoredExpiresAt: subResult.rows[0].sponsored_expires_at });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[company-gift-redemption/redeem]', err);
    res.status(500).json({ error: 'Failed to redeem code' });
  } finally {
    client.release();
  }
});

export default router;
