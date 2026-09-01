import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db/client.js';
import { getRealClientIp } from '../middleware/clientIp.js';
import { normalizeCampaign, normalizeVid, normalizeUtm } from '../features/marketing/campaigns.js';

const router = Router();

// ─── POST /api/campaign/landing ──────────────────────────────────────────────
// Hoboken Coffee Crawl (2026-08-31): fired fire-and-forget from CrawlLanding.tsx on
// mount. Public, no auth (a scanning crawler has no account yet), rate-limited per
// real client IP the same shape as funnelEventLimiter / qrResolveLimiter — see
// middleware/clientIp.ts for why req.ip alone collapses behind Cloudflare -> Firebase
// Hosting -> Cloud Run. Coarse device mix only: no IP is ever stored.
const landingLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: getRealClientIp });

router.post('/landing', landingLimiter, async (req, res) => {
  const { campaign, vid, utmSource, utmMedium, utmCampaign, referrer } = req.body ?? {};

  const cleanCampaign = normalizeCampaign(campaign);
  const cleanVid = normalizeVid(vid);
  if (!cleanCampaign || !cleanVid) {
    res.status(400).json({ error: 'campaign and vid are required and must be valid' });
    return;
  }

  const cleanReferrer = typeof referrer === 'string' ? referrer.trim().slice(0, 512) || null : null;
  const userAgentHeader = req.headers['user-agent'];
  const cleanUserAgent = typeof userAgentHeader === 'string' ? userAgentHeader.trim().slice(0, 256) || null : null;

  try {
    await db.query(
      `INSERT INTO campaign_landing_event (campaign, vid, utm_source, utm_medium, utm_campaign, referrer, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [cleanCampaign, cleanVid, normalizeUtm(utmSource), normalizeUtm(utmMedium), normalizeUtm(utmCampaign), cleanReferrer, cleanUserAgent],
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[campaign/landing]', err);
    res.status(500).json({ error: 'Failed to log landing' });
  }
});

export default router;
