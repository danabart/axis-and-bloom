import { Router } from 'express';
import { requireAuth, optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { chatWithAgent } from '../services/claude.js';
import { db } from '../db/client.js';

const router = Router();

router.post('/chat', optionalAuth, async (req: AuthRequest, res) => {
  const { message, context } = req.body;
  if (!message || typeof message !== 'string') { res.status(400).json({ error: 'message required' }); return; }

  try {
    // Fetch recent chat history if authenticated
    let previousMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (req.uid) {
      const rows = await db.query(
        'SELECT role, content FROM chat_messages WHERE uid = $1 ORDER BY created_at DESC LIMIT 10',
        [req.uid]
      );
      previousMessages = rows.rows.reverse();
    }

    const reply = await chatWithAgent(message, { ...context, previousMessages });

    // Persist conversation if authenticated
    if (req.uid) {
      await db.query(
        'INSERT INTO chat_messages (uid, role, content, context) VALUES ($1, $2, $3, $4), ($1, $5, $6, $4)',
        [req.uid, 'user', message, JSON.stringify(context ?? {}), 'assistant', reply]
      );
    }

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Agent error' });
  }
});

export default router;
