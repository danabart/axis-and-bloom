import type { FlavorMemoryActivityEntry } from './api';

/**
 * Profile Part 7 Task 6 — the derived reading line. Pure, rule-based,
 * client-side: compares the latest quiz archetype against the archetypes of
 * the most recent few saved/ordered entries. No LLM, no new endpoint. Same
 * archetype or too little data (< 2 recent signal entries) renders nothing —
 * an absent line beats a hollow one.
 */
const RECENT_SIGNAL_COUNT = 3;
const MIN_SIGNAL_ENTRIES = 2;

export function deriveReadingLine(activity: FlavorMemoryActivityEntry[]): string | null {
  const latestQuiz = activity.find(e => e.type === 'quiz' && e.archetype);
  if (!latestQuiz?.archetype || !latestQuiz.archetypeLabel) return null;

  const recentSignal = activity
    .filter(e => (e.type === 'saved' || e.type === 'ordered') && e.archetype)
    .slice(0, RECENT_SIGNAL_COUNT);
  if (recentSignal.length < MIN_SIGNAL_ENTRIES) return null;

  const diverging = recentSignal.find(e => e.archetype !== latestQuiz.archetype);
  if (!diverging) return null;

  return `Your quiz read ${latestQuiz.archetypeLabel}, but lately you've been leaning ${diverging.archetypeLabel}.`;
}
