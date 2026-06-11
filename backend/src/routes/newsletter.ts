import { Router } from 'express';
import { db } from '../db/client.js';
import crypto from 'crypto';

const router = Router();

// ── Mailchimp ─────────────────────────────────────────────────────────────────
const MC_API_KEY = (process.env.MAILCHIMP_API_KEY ?? '').trim();
const MC_LIST_ID = process.env.MAILCHIMP_LIST_ID ?? '';
const MC_ENABLED = Boolean(MC_API_KEY && MC_LIST_ID);
const MC_DC      = MC_API_KEY.split('-')[1] ?? '';

async function addToMailchimp(email: string, firstName: string) {
  if (!MC_ENABLED) return;
  const hash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
  const url  = `https://${MC_DC}.api.mailchimp.com/3.0/lists/${MC_LIST_ID}/members/${hash}`;
  const mcRes = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`anystring:${MC_API_KEY}`).toString('base64')}`,
    },
    body: JSON.stringify({
      email_address: email,
      status_if_new: 'subscribed',
      status: 'subscribed',
      merge_fields: { FNAME: firstName },
    }),
  });
  if (!mcRes.ok) {
    const body = await mcRes.text();
    console.error('[mailchimp] error:', mcRes.status, body);
  }
}

// ── Shared subscribe logic ────────────────────────────────────────────────────
async function handleSubscribe(
  email: string,
  sourceName: string,
  firstName: string,
  res: Parameters<Parameters<typeof router.post>[1]>[1],
) {
  const clean     = email.toLowerCase().trim();
  const cleanName = typeof firstName === 'string' ? firstName.trim() : '';

  const srcResult = await db.query(
    `SELECT id FROM subscriber_source WHERE name = $1`,
    [sourceName],
  );
  const sourceId: number | null = srcResult.rows[0]?.id ?? null;

  await db.query(
    `INSERT INTO newsletter_subscriber (email, first_name, source_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE
       SET subscribed = TRUE,
           first_name = COALESCE(EXCLUDED.first_name, newsletter_subscriber.first_name),
           source_id  = COALESCE(newsletter_subscriber.source_id, EXCLUDED.source_id)`,
    [clean, cleanName || null, sourceId],
  );

  // Forward to Mailchimp — non-blocking, never fails the request
  addToMailchimp(clean, cleanName).catch(err =>
    console.error('[newsletter] mailchimp error:', err)
  );

  res.json({ ok: true });
}

// ── POST /api/newsletter/subscribe ───────────────────────────────────────────
// Body: { email: string, firstName?: string, source?: string }
router.post('/subscribe', async (req, res) => {
  const { email, firstName = '', source = 'newsletter' } = req.body as {
    email?: string; firstName?: string; source?: string;
  };
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'email required' });
    return;
  }
  try {
    await handleSubscribe(email, source, firstName, res);
  } catch (err) {
    console.error('[newsletter/subscribe]', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// ── POST /api/newsletter ──────────────────────────────────────────────────────
// Backward-compat alias — NewsletterModal currently calls this path.
router.post('/', async (req, res) => {
  const { email, firstName = '', source = 'newsletter' } = req.body as {
    email?: string; firstName?: string; source?: string;
  };
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'email required' });
    return;
  }
  try {
    await handleSubscribe(email, source, firstName, res);
  } catch (err) {
    console.error('[newsletter]', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

export default router;
