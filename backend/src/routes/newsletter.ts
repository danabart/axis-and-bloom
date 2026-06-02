import { Router } from 'express';
import { db } from '../db/client.js';

const router = Router();

/**
 * Shared subscribe logic.
 * Looks up the source by name, then upserts the email.
 * If the email already exists we just re-activate it (subscribed = TRUE).
 */
async function handleSubscribe(
  email: string,
  sourceName: string,
  res: Parameters<Parameters<typeof router.post>[1]>[1],
) {
  const clean = email.toLowerCase().trim();

  // Resolve source_id (null-safe — unknown source → NULL, not an error)
  const srcResult = await db.query(
    `SELECT id FROM subscriber_source WHERE name = $1`,
    [sourceName],
  );
  const sourceId: number | null = srcResult.rows[0]?.id ?? null;

  await db.query(
    `INSERT INTO newsletter_subscriber (email, source_id)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE
       SET subscribed = TRUE,
           source_id  = COALESCE(newsletter_subscriber.source_id, EXCLUDED.source_id)`,
    [clean, sourceId],
  );

  res.json({ ok: true });
}

// ── POST /api/newsletter/subscribe ───────────────────────────────────────────
// Used by PreLaunch (source = 'pre_launch') and any future callers.
// Body: { email: string, source?: string }   — source defaults to 'newsletter'
router.post('/subscribe', async (req, res) => {
  const { email, source = 'newsletter' } = req.body as { email?: string; source?: string };
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'email required' });
    return;
  }
  try {
    await handleSubscribe(email, source, res);
  } catch (err) {
    console.error('[newsletter/subscribe]', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// ── POST /api/newsletter ──────────────────────────────────────────────────────
// Backward-compat alias — NewsletterModal currently calls this path.
router.post('/', async (req, res) => {
  const { email, source = 'newsletter' } = req.body as { email?: string; source?: string };
  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'email required' });
    return;
  }
  try {
    await handleSubscribe(email, source, res);
  } catch (err) {
    console.error('[newsletter]', err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

export default router;
