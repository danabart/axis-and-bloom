import { getSommelierConfig } from './sommelierConfig.js';

export interface TopicRouteResult {
  topic: string | null;
  mode: 'matching' | 'expertise';
  confidence: 'high' | 'none';
  sticky: boolean;
  matchedKeyword: string | null;
  turnsSinceMatch: number;
}

// Used only if live config hasn't been seeded with `topics`/`topicRouter` yet —
// mirrors DEFAULT_SOMMELIER_CONFIG so a stale config document degrades to the
// same behavior rather than routing nothing at all.
const FALLBACK_PRIORITY = [
  'caffeine_decaf', 'origins_process', 'equipment', 'my_coffee',
  'brewing', 'matching', 'other',
];
const FALLBACK_DECAY_TURNS = 2;

// Turn-level topic classification (§4.1, HOME_TASK_2). Keyword rules first,
// stored per-topic in config. A confident match this turn always wins; failing
// that, the previous turn's topic carries forward (stickiness) until it decays.
// No match and no live sticky topic = topic: null — exactly today's Liam.
export function routeTopic(
  message: string,
  sessionContext: { currentTopic?: string | null; turnsSinceMatch?: number }
): TopicRouteResult {
  const config = getSommelierConfig();
  const topics = config?.topics ?? {};
  const priority = config?.topicRouter?.priority ?? FALLBACK_PRIORITY;
  const decayTurns = config?.topicRouter?.stickyDecayTurns ?? FALLBACK_DECAY_TURNS;

  const lower = message.toLowerCase();
  for (const topicKey of priority) {
    const topicCfg = topics[topicKey];
    const keywords = topicCfg?.keywords ?? [];
    if (!keywords.length) continue;
    const matched = keywords.find((kw) => lower.includes(kw.toLowerCase()));
    if (matched) {
      return {
        topic: topicKey,
        mode: topicCfg.mode === 'expertise' ? 'expertise' : 'matching',
        confidence: 'high',
        sticky: false,
        matchedKeyword: matched,
        turnsSinceMatch: 0,
      };
    }
  }

  // Nothing matched this turn — carry the previous topic forward until it decays.
  const currentTopic = sessionContext.currentTopic ?? null;
  const turnsSinceMatch = sessionContext.turnsSinceMatch ?? 0;
  if (currentTopic && turnsSinceMatch < decayTurns) {
    const topicCfg = topics[currentTopic];
    return {
      topic: currentTopic,
      mode: topicCfg?.mode === 'expertise' ? 'expertise' : 'matching',
      confidence: 'high',
      sticky: true,
      matchedKeyword: null,
      turnsSinceMatch: turnsSinceMatch + 1,
    };
  }

  // No match, no (or expired) sticky topic. Misroute cost is asymmetric (§4.1) —
  // when unsure, this defaults to matching mode, never an unearned lecture.
  return {
    topic: null,
    mode: 'matching',
    confidence: 'none',
    sticky: false,
    matchedKeyword: null,
    turnsSinceMatch: 0,
  };
}
