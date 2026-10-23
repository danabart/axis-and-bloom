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
  // Added 2026-08-08 (3-fix): a real refusal ("I'd love to write a tasting
  // note for X, but I'm missing the cupping data...") reached production
  // storage because this exact phrasing didn't match any pattern above —
  // found by a manual full-text re-read of every coffee's cached content
  // during a C3 verification pass, not by the automated scan (which only
  // checks these patterns) — a reminder that this list is a floor, not a
  // guarantee.
  /i'?m missing/i,
  // Part 17 §D3 — "Could you share" / "That would help me find" added after a
  // live regeneration (coffee "There's No Place Like Home") still showed
  // refusal text post-Part-16-cleanup; re-run cleanup scan with these added,
  // see WHAT_WE_BUILT.md #146 for the audit.
  /could you share/i,
  /that would help me/i,
  // Coffee presentation brief 1, prod run (2026-10-23): Benchmark's surprise
  // note came back as "Here's a hook for Classic Balanced:" on its own line,
  // the note after a blank line; the card teaser (first sentence) showed only
  // the preamble. A reply that opens by announcing its content.
  /^\s*here'?s (a|an|the|my)\b[^.!?\n]*:\s*(\n|$)/i,
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

// Coffee presentation brief 1 (2026-10-23), decision 9 — the roaster-blind
// guard, built per coffee from the data at generation time (never written into
// config or code, like storyLayer.bannedTerms is config): the roaster's names
// and the raw coffee name as whole phrases, and every word of three or more
// characters of the coffee's award remarks on its own (so "Golden", "Bean" and
// "2023" each reject). Award text is passed in by the caller
// (roasterVoiceReads.getAwardRemarks); it never reaches a prompt.
export function bannedTokensFor(awardRemarks: string[], roasterNames: string[], rawName: string | null): string[] {
  const words = awardRemarks.flatMap(a => a.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const phrases = [...roasterNames, rawName ?? '']
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 2);
  return [...new Set([...phrases, ...words])];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The first banned token `text` contains (whole word or phrase, case-insensitive), or null when it is clean. */
export function looksLikeLeak(text: string, tokens: string[]): string | null {
  for (const t of tokens) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(t)}(?![\\p{L}\\p{N}])`, 'iu');
    if (re.test(text)) return t;
  }
  return null;
}

export interface GuardedResult {
  /** the accepted text, or null (refused, empty, leaked twice, or off-style three times) */
  text: string | null;
  /** the C2 guard blocked the call: no attempt, nothing to write */
  blocked: boolean;
  /** attempts the leak guard rejected (0, 1 or 2) */
  leakRejects: number;
  /** attempts the style check rejected (Dana's prod-go rules) */
  styleRejects: number;
  /** why text is null when it was attempted: 'refusal', 'empty', 'leak: <token>' or 'style: <why>' */
  reason: string | null;
}

// Coffee presentation brief 1, Dana's prod-go rules (2026-10-23). The prompt
// states them; the model does not keep them reliably (11 dashes and 4
// archetype categories in 66 test texts), so they are enforced here.

/** No em or en dash in a customer text: a dash between numbers reads "to", any other becomes a comma. */
export function normalizeDashes(text: string): string {
  return text
    .replace(/(\d[\p{L}%°]*)\s*[–—]\s*(\d)/gu, '$1 to $2')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/,\s*([.,;:!?])/g, '$1')
    .replace(/^,\s*/, '');
}

const CATEGORY_NOUNS = 'coffee|coffees|blend|blends|cup|cups|category|style|profile|family|type';
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The style check: the word "archetype", an archetype name used as a category
 * ("a fruity coffee", "this Balanced blend"; names come from the database), or
 * milk / latte words when the roaster gave no takes_it answer. Null when clean.
 */
export function styleViolation(text: string, archetypeLabels: string[], takesItPresent: boolean): string | null {
  if (/archetype/i.test(text)) return '"archetype"';
  if (archetypeLabels.length) {
    const re = new RegExp(`(?<![\\p{L}])(${archetypeLabels.map(escapeRe).join('|')})\\s+(${CATEGORY_NOUNS})(?![\\p{L}])`, 'iu');
    const m = re.exec(text);
    if (m) return `category "${m[0]}"`;
  }
  if (!takesItPresent) {
    const m = /\b(milk|latte|cortado|cappuccino|flat white)\b/i.exec(text);
    if (m) return `"${m[0]}" without a takes_it answer`;
  }
  return null;
}

/**
 * Decision 9 (D3): one generation and its guards. Dashes are normalised first.
 * A refusal-like reply is null at once (as before). A reply that leaks a
 * banned token is asked for once more; a second leak is null with the reason,
 * which the caller marks *_generation_failed. A reply that breaks the style
 * check is asked for again, up to three attempts in all. `isBlocked`
 * recognises the C2 guard's error (kill-switch / daily ceiling), which is no
 * attempt at all. `gen` is the model call, so a test can pass a stub.
 */
export async function generateWithLeakGuard(
  gen: () => Promise<string | null>,
  tokens: string[],
  isBlocked: (err: unknown) => boolean,
  style: (text: string) => string | null = () => null,
): Promise<GuardedResult> {
  let leakRejects = 0;
  let styleRejects = 0;
  let reason = '';
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const raw = await gen();
      if (raw === null || !raw.trim()) return { text: null, blocked: false, leakRejects, styleRejects, reason: 'empty' };
      if (looksLikeRefusal(raw)) return { text: null, blocked: false, leakRejects, styleRejects, reason: 'refusal' };
      const text = normalizeDashes(raw.trim());
      const leak = looksLikeLeak(text, tokens);
      if (leak) {
        leakRejects++;
        reason = `leak: ${leak}`;
        if (leakRejects === 2) break;
        continue;
      }
      const off = style(text);
      if (!off) return { text, blocked: false, leakRejects, styleRejects, reason: null };
      styleRejects++;
      reason = `style: ${off}`;
    }
    return { text: null, blocked: false, leakRejects, styleRejects, reason };
  } catch (err) {
    if (isBlocked(err)) return { text: null, blocked: true, leakRejects, styleRejects, reason: null };
    throw err;
  }
}
