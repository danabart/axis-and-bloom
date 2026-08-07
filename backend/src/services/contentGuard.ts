// Part 16 §D — shared refusal/meta-reply detector for AI-generated coffee
// content (ai_summary, surprise_note, three_voice_story). Used both by the
// generation guard in coffees.ts (reject before ever storing a bad reply) and
// by the one-time cleanup script that scanned already-cached rows for the same
// patterns — one definition, so "what gets blocked going forward" and "what
// got cleaned up" never drift apart.
//
// Live bug this exists for: a coffee with no cupping data got Claude's refusal
// ("I don't have the cupping data or flavor descriptors for... so I can't
// identify what makes it genuinely surprising… Could you provide the cupping
// notes, origin, or processing method?") stored verbatim as its surprise_note.

/** The exact token the generation prompts (services/claude.ts) now instruct the
 * model to return, verbatim, when the provided data is genuinely insufficient
 * — a clean, structured way to say "don't have enough to work with" instead of
 * prose that talks to the reader about missing data. */
export const INSUFFICIENT_DATA_TOKEN = 'INSUFFICIENT_DATA';

// Case-insensitive, "at minimum" per the spec — extend this list as new
// refusal phrasings surface. Each pattern targets assistant-speak that
// addresses the reader about missing/insufficient input, not a real tasting
// note or story about the coffee itself.
export const REFUSAL_PATTERNS: RegExp[] = [
  /i don'?t have/i,
  /i can'?t\b/i,
  /i cannot\b/i,
  /i'?m unable/i,
  /you'?ve shared/i,
  /you provided/i,
  /could you provide/i,
  /please provide/i,
  /as an ai/i,
  /i'?d need/i,
];

/** True when `text` looks like Claude declining/talking about missing data
 * rather than writing the requested content — either the literal
 * INSUFFICIENT_DATA token, or a match against REFUSAL_PATTERNS. */
export function looksLikeRefusal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.toUpperCase() === INSUFFICIENT_DATA_TOKEN) return true;
  return REFUSAL_PATTERNS.some(re => re.test(trimmed));
}
