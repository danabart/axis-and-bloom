import { archetypeCode, archetypeLabel } from './catalogReads.js';

// Firestore users/{uid}/metadata/taste_journey stores archetype DISPLAY NAMES
// (written verbatim from the quiz request), so entries recorded under an older
// name (e.g. "Balanced & Sweet") outlive a rename. Everything here goes through
// the code so a rename never strands or splits history.

export interface JourneyEntry {
  archetype: string;
  archetypeLabel: string;
  at: string | null;
  trigger: 'first_quiz' | 'retake';
}

// Read side (/api/users/flavor-memory): code from archetypeCode() (which also
// understands retired names), label from the live row via archetypeLabel().
// Unrecognised names pass through untouched, same don't-break-a-page posture
// as the rest of catalogReads.
export async function mapJourneyHistory(history: any[]): Promise<JourneyEntry[]> {
  return Promise.all(history.map(async (h) => {
    const code = await archetypeCode(String(h.archetype ?? ''));
    return {
      archetype:      code ?? String(h.archetype ?? '').toLowerCase(),
      archetypeLabel: code ? await archetypeLabel(code) : String(h.archetype ?? ''),
      at:             h.date?.toDate ? h.date.toDate().toISOString() : (h.date ?? null),
      trigger:        h.trigger === 'first_quiz' ? 'first_quiz' : 'retake',
    } satisfies JourneyEntry;
  }));
}

// Write side (POST /api/quiz/results): a retake is "the same archetype" when
// both resolve to the same code, whatever spelling the stored history used.
export function isSameArchetype(newCode: string | null, currentCode: string | null): boolean {
  return !!newCode && newCode === currentCode;
}
