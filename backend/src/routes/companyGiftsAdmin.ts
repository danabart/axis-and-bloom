import { Router } from 'express';
import { randomInt } from 'crypto';
import { requireAdmin, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/client.js';

const router = Router();
router.use(requireAdmin);

// Short, human-typeable code — unlike household_invitation's 32-byte hex token,
// these are typed in by hand off a printed/emailed CSV, not clicked from a link.
// Ambiguous characters (0/O, 1/I) excluded.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCodeCandidate(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `AXBL-${code}`;
}

function buildEmailTemplate(companyName: string): string {
  return `Subject: A coffee gift from ${companyName} \u{1F381}

Hi team,

As a thank-you this season, ${companyName} is gifting everyone 3 months of Axis & Bloom —
coffee matched to your own taste, not a generic company blend.

Here's your code: {{CODE}}

Redeem it at axisandbloomcoffee.com — there's a "Have a code?" box right on the homepage — take a 2-minute quiz, and your first bag ships free.

Enjoy!`;
}

// POST /api/admin/company-gifts
router.post('/', async (req: AuthRequest, res) => {
  const {
    companyName, seatCount, sponsorshipMonths, adminContactName, adminContactEmail,
    codeRedeemBy, paymentNotes, totalAmountCents, paymentAlreadyReceived,
  } = req.body as {
    companyName?: string; seatCount?: number; sponsorshipMonths?: number;
    adminContactName?: string; adminContactEmail?: string; codeRedeemBy?: string;
    paymentNotes?: string; totalAmountCents?: number; paymentAlreadyReceived?: boolean;
  };

  if (!companyName?.trim()) { res.status(400).json({ error: 'companyName required' }); return; }
  if (!adminContactEmail?.trim()) { res.status(400).json({ error: 'adminContactEmail required' }); return; }
  const seats = Number(seatCount);
  if (!Number.isInteger(seats) || seats <= 0) { res.status(400).json({ error: 'seatCount must be a positive integer' }); return; }
  const months = Number.isInteger(sponsorshipMonths) && Number(sponsorshipMonths) > 0 ? Number(sponsorshipMonths) : 3;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const adminProfile = await client.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const adminProfileId = adminProfile.rows[0]?.id ?? null;

    const giftResult = await client.query(
      `INSERT INTO company_gift
         (company_name, seat_count, sponsorship_months, admin_contact_name, admin_contact_email,
          code_redeem_by, payment_notes, payment_confirmed_at, total_amount_cents, created_by_admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        companyName.trim(), seats, months, adminContactName?.trim() || null, adminContactEmail.trim(),
        codeRedeemBy || null, paymentNotes?.trim() || null,
        paymentAlreadyReceived ? new Date() : null,
        Number.isFinite(totalAmountCents) ? totalAmountCents : null,
        adminProfileId,
      ]
    );
    const gift = giftResult.rows[0];

    const codes: string[] = [];
    for (let i = 0; i < seats; i++) {
      let inserted = false;
      for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
        const candidate = generateCodeCandidate();
        try {
          await client.query(
            `INSERT INTO company_gift_code (company_gift_id, code) VALUES ($1, $2)`,
            [gift.id, candidate]
          );
          codes.push(candidate);
          inserted = true;
        } catch (err: any) {
          if (err.code !== '23505') throw err; // unique_violation on code — retry with a new candidate
        }
      }
      if (!inserted) throw new Error('Failed to generate a unique code after 5 attempts');
    }

    await client.query('COMMIT');
    res.json({ companyGift: gift, codes });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[admin/company-gifts/create]', err);
    res.status(500).json({ error: 'Failed to create company gift' });
  } finally {
    client.release();
  }
});

// GET /api/admin/company-gifts — dashboard list view
router.get('/', async (_req, res) => {
  try {
    const r = await db.query(`
      SELECT cg.id, cg.company_name, cg.seat_count, cg.sponsorship_months,
             cg.admin_contact_name, cg.admin_contact_email, cg.code_redeem_by,
             cg.payment_confirmed_at, cg.total_amount_cents, cg.created_at,
             COUNT(cgc.id) FILTER (WHERE cgc.status = 'redeemed')   AS redeemed_count,
             COUNT(cgc.id) FILTER (WHERE cgc.status = 'unredeemed') AS remaining_count,
             COUNT(cgc.id) FILTER (WHERE cgc.status = 'expired')    AS expired_count
      FROM company_gift cg
      LEFT JOIN company_gift_code cgc ON cgc.company_gift_id = cg.id
      GROUP BY cg.id
      ORDER BY cg.created_at DESC
    `);
    res.json(r.rows);
  } catch (err) {
    console.error('[admin/company-gifts/list]', err);
    res.status(500).json({ error: 'Failed to list company gifts' });
  }
});

// GET /api/admin/company-gifts/:id — detail view, full code list
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const giftResult = await db.query(`SELECT * FROM company_gift WHERE id = $1`, [id]);
    if (!giftResult.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    const codesResult = await db.query(
      `SELECT id, code, status, redeemed_at, created_at
       FROM company_gift_code WHERE company_gift_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    res.json({ companyGift: giftResult.rows[0], codes: codesResult.rows });
  } catch (err) {
    console.error('[admin/company-gifts/detail]', err);
    res.status(500).json({ error: 'Failed to fetch company gift' });
  }
});

// POST /api/admin/company-gifts/:id/confirm-payment — idempotent activation
router.post('/:id/confirm-payment', async (req, res) => {
  const { id } = req.params;
  try {
    const r = await db.query(
      `UPDATE company_gift SET payment_confirmed_at = COALESCE(payment_confirmed_at, now())
       WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[admin/company-gifts/confirm-payment]', err);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

// GET /api/admin/company-gifts/:id/codes.csv — available pre- or post-payment, for admin prep
router.get('/:id/codes.csv', async (req, res) => {
  const { id } = req.params;
  try {
    const giftResult = await db.query(`SELECT company_name FROM company_gift WHERE id = $1`, [id]);
    if (!giftResult.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    const codesResult = await db.query(
      `SELECT code, status, redeemed_at FROM company_gift_code WHERE company_gift_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    const rows = [
      'code,status,redeemed_at',
      ...codesResult.rows.map((r: any) =>
        `${r.code},${r.status},${r.redeemed_at ? new Date(r.redeemed_at).toISOString() : ''}`
      ),
    ];
    const safeName = giftResult.rows[0].company_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    res.set('Content-Type', 'text/csv');
    res.set('Content-Disposition', `attachment; filename="company-gift-codes-${safeName}.csv"`);
    res.send(rows.join('\n'));
  } catch (err) {
    console.error('[admin/company-gifts/csv]', err);
    res.status(500).json({ error: 'Failed to export codes' });
  }
});

// GET /api/admin/company-gifts/:id/email-template
router.get('/:id/email-template', async (req, res) => {
  const { id } = req.params;
  try {
    const r = await db.query(`SELECT company_name FROM company_gift WHERE id = $1`, [id]);
    if (!r.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ template: buildEmailTemplate(r.rows[0].company_name) });
  } catch (err) {
    console.error('[admin/company-gifts/email-template]', err);
    res.status(500).json({ error: 'Failed to build email template' });
  }
});

export default router;
