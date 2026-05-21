import { Router } from 'express';
import { db } from '../db/client.js';

const router = Router();

router.post('/', async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') { res.status(400).json({ error: 'email required' }); return; }

  try {
    await db.query(
      'INSERT INTO newsletter_subscribers (email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET subscribed = TRUE',
      [email.toLowerCase().trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

export default router;
