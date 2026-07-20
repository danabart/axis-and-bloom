import { db } from '../../db/client.js';

export type FunnelEvent = 'quiz_start' | 'quiz_complete' | 'email_submitted';

const VALID_EVENTS: ReadonlySet<string> = new Set(['quiz_start', 'quiz_complete', 'email_submitted']);

/** First-party quiz funnel logging (launch/20_analytics-and-tracking/02_B1). */
export async function logFunnelEvent(sessionKey: unknown, event: unknown, archetype: unknown): Promise<void> {
  if (typeof sessionKey !== 'string' || !sessionKey.trim()) {
    throw new Error('sessionKey is required');
  }
  if (typeof event !== 'string' || !VALID_EVENTS.has(event)) {
    throw new Error('event must be one of quiz_start, quiz_complete, email_submitted');
  }
  const archetypeValue = typeof archetype === 'string' && archetype.trim() ? archetype : null;

  await db.query(
    `INSERT INTO quiz_funnel_event (session_key, event, archetype) VALUES ($1, $2, $3)`,
    [sessionKey, event, archetypeValue],
  );
}
