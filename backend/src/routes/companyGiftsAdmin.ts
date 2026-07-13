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
  return `Subject: ${companyName} is treating you to 3 months of coffee, matched to you \u{2615}

Hi team,

This season, ${companyName} wanted to give something better than a generic gift — so everyone's getting 3 months of Axis & Bloom, on the house.

Here's how it works: take a 2-minute quiz to find your flavor — floral, fruity, chocolate & nutty, whatever fits your palate — and we'll match you with coffee built around it. Nobody on your team has to get the same bag.

Your code: {{CODE}}

Head to axisandbloomcoffee.com, enter your code in the "Have a code?" box on the homepage, take the quiz, and your first bag ships free.

Enjoy — from all of us at Axis & Bloom.`;
}

const CODE_PLACEHOLDER = '{{CODE}}';

// POST /api/admin/company-gifts
router.post('/', async (req: AuthRequest, res) => {
  const {
    companyId, companyName, primaryContactName, primaryContactEmail,
    seatCount, sponsorshipMonths, adminContactName, adminContactEmail,
    codeRedeemBy, paymentNotes, totalAmountCents, paymentAlreadyReceived,
  } = req.body as {
    companyId?: string; companyName?: string; primaryContactName?: string; primaryContactEmail?: string;
    seatCount?: number; sponsorshipMonths?: number;
    adminContactName?: string; adminContactEmail?: string; codeRedeemBy?: string;
    paymentNotes?: string; totalAmountCents?: number; paymentAlreadyReceived?: boolean;
  };

  if (!companyId && !companyName?.trim()) { res.status(400).json({ error: 'companyName or companyId required' }); return; }
  if (!adminContactEmail?.trim()) { res.status(400).json({ error: 'adminContactEmail required' }); return; }
  const seats = Number(seatCount);
  if (!Number.isInteger(seats) || seats <= 0) { res.status(400).json({ error: 'seatCount must be a positive integer' }); return; }
  const months = Number.isInteger(sponsorshipMonths) && Number(sponsorshipMonths) > 0 ? Number(sponsorshipMonths) : 3;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const adminProfile = await client.query(`SELECT id FROM user_profile WHERE firebase_uid = $1`, [req.uid]);
    const adminProfileId = adminProfile.rows[0]?.id ?? null;

    // Resolve (or create) the stable company this gift links to. company_gift's own
    // company_name/admin_contact_* stay a purchase-time snapshot regardless — company_id
    // is purely for relationship tracking across repeat purchases.
    let resolvedCompanyId: string | null = null;
    let resolvedCompanyName = companyName?.trim() || null;

    if (companyId) {
      const companyRow = await client.query(`SELECT id, company_name FROM company WHERE id = $1`, [companyId]);
      if (!companyRow.rows.length) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Company not found' });
        return;
      }
      resolvedCompanyId = companyRow.rows[0].id;
      if (!resolvedCompanyName) resolvedCompanyName = companyRow.rows[0].company_name;
    } else if (resolvedCompanyName) {
      const newCompany = await client.query(
        `INSERT INTO company (company_name, primary_contact_name, primary_contact_email)
         VALUES ($1, $2, $3) RETURNING id`,
        [
          resolvedCompanyName,
          primaryContactName?.trim() || adminContactName?.trim() || null,
          primaryContactEmail?.trim() || adminContactEmail.trim(),
        ]
      );
      resolvedCompanyId = newCompany.rows[0].id;
    }

    const giftResult = await client.query(
      `INSERT INTO company_gift
         (company_name, seat_count, sponsorship_months, admin_contact_name, admin_contact_email,
          code_redeem_by, payment_notes, payment_confirmed_at, total_amount_cents, created_by_admin_id, company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        resolvedCompanyName, seats, months, adminContactName?.trim() || null, adminContactEmail.trim(),
        codeRedeemBy || null, paymentNotes?.trim() || null,
        paymentAlreadyReceived ? new Date() : null,
        Number.isFinite(totalAmountCents) ? totalAmountCents : null,
        adminProfileId, resolvedCompanyId,
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
             cg.payment_confirmed_at, cg.total_amount_cents, cg.created_at, cg.company_id,
             COUNT(cgc.id) FILTER (WHERE cgc.status = 'redeemed')   AS redeemed_count,
             COUNT(cgc.id) FILTER (WHERE cgc.status = 'unredeemed') AS remaining_count,
             COUNT(cgc.id) FILTER (WHERE cgc.status = 'expired')    AS expired_count,
             -- 0 when this gift has no linked company (nothing to compare against);
             -- otherwise how many company_gift rows share that company, incl. this one.
             (SELECT COUNT(*) FROM company_gift cg2 WHERE cg2.company_id = cg.company_id) AS company_gift_count
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
    const r = await db.query(`SELECT company_name, email_template_override FROM company_gift WHERE id = $1`, [id]);
    if (!r.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    const row = r.rows[0];
    res.json({
      template: row.email_template_override ?? buildEmailTemplate(row.company_name),
      isCustom: row.email_template_override != null,
    });
  } catch (err) {
    console.error('[admin/company-gifts/email-template]', err);
    res.status(500).json({ error: 'Failed to build email template' });
  }
});

// PATCH /api/admin/company-gifts/:id/email-template — set or clear a per-gift override.
// `template: string` sets a custom override (must contain the literal {{CODE}} placeholder —
// otherwise every redemption email built from it would silently ship without a working code).
// `template: null` clears the override, reverting to the default brand-voice template.
router.patch('/:id/email-template', async (req, res) => {
  const { id } = req.params;
  const { template } = req.body as { template?: string | null };

  if (template !== null && typeof template !== 'string') {
    res.status(400).json({ error: 'template must be a string or null' });
    return;
  }
  if (typeof template === 'string' && !template.includes(CODE_PLACEHOLDER)) {
    res.status(400).json({ error: `Template must contain the literal ${CODE_PLACEHOLDER} placeholder` });
    return;
  }

  try {
    const r = await db.query(
      `UPDATE company_gift SET email_template_override = $2 WHERE id = $1 RETURNING company_name, email_template_override`,
      [id, template]
    );
    if (!r.rows.length) { res.status(404).json({ error: 'Not found' }); return; }
    const row = r.rows[0];
    res.json({
      template: row.email_template_override ?? buildEmailTemplate(row.company_name),
      isCustom: row.email_template_override != null,
    });
  } catch (err) {
    console.error('[admin/company-gifts/email-template/update]', err);
    res.status(500).json({ error: 'Failed to save email template' });
  }
});

export default router;
