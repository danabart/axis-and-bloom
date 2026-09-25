import { db } from '../../db/client.js';
import { normalizeCampaign, normalizeVid } from './campaigns.js';

// 'quiz_final' added Quiz Resync Fix Part A4 (2026-09-25) — the post-branch,
// on-screen archetype the visitor actually saw, on its own row. quiz_complete
// stays exactly what it always was (the pre-branch score) — existing reports
// depend on that. See schema.sql's event CHECK, updated alongside this.
export type FunnelEvent = 'quiz_start' | 'quiz_complete' | 'email_submitted' | 'quiz_final';

const VALID_EVENTS: ReadonlySet<string> = new Set(['quiz_start', 'quiz_complete', 'email_submitted', 'quiz_final']);

/** First-party quiz funnel logging (launch/20_analytics-and-tracking/02_B1). Hoboken
 * Coffee Crawl (2026-08-31): campaign/campaignVid are optional, orthogonal attribution —
 * dropped together if campaign doesn't normalize to a known campaign. */
export async function logFunnelEvent(
  sessionKey: unknown,
  event: unknown,
  archetype: unknown,
  campaign?: unknown,
  campaignVid?: unknown,
): Promise<void> {
  if (typeof sessionKey !== 'string' || !sessionKey.trim()) {
    throw new Error('sessionKey is required');
  }
  if (typeof event !== 'string' || !VALID_EVENTS.has(event)) {
    throw new Error('event must be one of quiz_start, quiz_complete, email_submitted');
  }
  const archetypeValue = typeof archetype === 'string' && archetype.trim() ? archetype : null;
  const cleanCampaign = normalizeCampaign(campaign);
  const cleanCampaignVid = cleanCampaign ? normalizeVid(campaignVid) : null;

  await db.query(
    `INSERT INTO quiz_funnel_event (session_key, event, archetype, campaign, campaign_vid) VALUES ($1, $2, $3, $4, $5)`,
    [sessionKey, event, archetypeValue, cleanCampaign, cleanCampaignVid],
  );
}
