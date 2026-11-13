import { db, type Tx } from '../../db/client.js';
import { normalizeCampaign, normalizeVid } from './campaigns.js';

// 'quiz_final' added Quiz Resync Fix Part A4 (2026-09-25) — the post-branch,
// on-screen archetype the visitor actually saw, on its own row. quiz_complete
// stays exactly what it always was (the pre-branch score) — existing reports
// depend on that.
//
// Usual Drink 1 (2026-11-12, A3b): the event list is the quiz_funnel_event_type
// lookup (FK on quiz_funnel_event.event), not a set in code. An unknown or
// retired event is logged and dropped, never an error (the visitor's quiz
// must not notice); a missing sessionKey is still a bad request.
export type FunnelEvent = string;

/** First-party quiz funnel logging (launch/20_analytics-and-tracking/02_B1). Hoboken
 * Coffee Crawl (2026-08-31): campaign/campaignVid are optional, orthogonal attribution —
 * dropped together if campaign doesn't normalize to a known campaign.
 * Returns false when the event was dropped (not an active quiz_funnel_event_type code). */
export async function logFunnelEvent(
  sessionKey: unknown,
  event: unknown,
  archetype: unknown,
  campaign?: unknown,
  campaignVid?: unknown,
  runner?: Tx,
): Promise<boolean> {
  if (typeof sessionKey !== 'string' || !sessionKey.trim()) {
    throw new Error('sessionKey is required');
  }
  if (typeof event !== 'string' || !event.trim()) {
    console.warn('[funnelEvents] event missing, dropped');
    return false;
  }
  const archetypeValue = typeof archetype === 'string' && archetype.trim() ? archetype : null;
  const cleanCampaign = normalizeCampaign(campaign);
  const cleanCampaignVid = cleanCampaign ? normalizeVid(campaignVid) : null;

  const r = await (runner ?? db).query(
    `INSERT INTO quiz_funnel_event (session_key, event, archetype, campaign, campaign_vid)
     SELECT $1, t.code, $3, $4, $5 FROM quiz_funnel_event_type t WHERE t.code = $2 AND t.is_active`,
    [sessionKey, event, archetypeValue, cleanCampaign, cleanCampaignVid],
  );
  if (!r.rowCount) {
    console.warn(`[funnelEvents] unknown or retired event "${event.slice(0, 60)}" dropped`);
    return false;
  }
  return true;
}
