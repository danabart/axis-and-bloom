import { Router } from 'express';
import { getHomeContent } from '../services/homeContentReads.js';

// Website 2 (2026-11-04). Public: what Home shows that is content
// (facts, quotes, the "This week" coffee). The route calls one service (G3.1).
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_2_PRESENTATION_DATA.md
const router = Router();

// GET /api/home/content → { facts: {questions, dimensions, families}, quotes: string[], featured: {card, price} | null }
router.get('/content', async (_req, res) => {
  try {
    res.json(await getHomeContent());
  } catch (err) {
    console.error('[home/content]', err);
    res.status(500).json({ error: 'Failed to fetch home content' });
  }
});

export default router;
