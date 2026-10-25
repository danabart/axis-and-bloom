import Anthropic from '@anthropic-ai/sdk';
import { getSommelierConfig } from './sommelierConfig.js';
import { guardClaudeCall } from './anthropicGuard.js';
import {
  looksLikeLeak, normalizeDashes, styleViolation, looksLikeInventedBrew, maskViolation, brewLine, takesItLine, BREW_RULE, GAP_RULE,
} from './contentGuard.js';
import type { RoasterVoice } from './roasterVoiceReads.js';

// HOME_TASK_5 (§4.4) — "their coffee, explained." A dedicated, independent
// Anthropic client rather than importing from claude.ts: per the S38
// constraint, claude.ts's three existing content functions (and the file
// itself) stay completely untouched by this task — the story prompt lives
// entirely at this call-site layer, same as the task spec asks for.
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STORY_SYSTEM_PROMPT = `You write short, warm, editorial coffee stories for Axis & Bloom, a personalized coffee brand. Never marketing language ("indulge," "treat yourself," "elevate"). Never name a specific farm, co-op, cooperative, estate, lot, or importer. Never name a roaster or roastery. Speak only in region-level origin and general process terms — never more specific than that, even if given more specific source material.`;

const FALLBACK_BANNED_TERMS = ['farm', 'co-op', 'coop', 'cooperative', 'estate', 'lot', 'importer', 'roaster', 'roastery'];

export function getBannedTerms(): string[] {
  return getSommelierConfig()?.storyLayer?.bannedTerms ?? FALLBACK_BANNED_TERMS;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The specificity line's post-generation half (§4.4's "enforced twice" — the
// generation prompt is the other half). Whole-word, case-insensitive. Checks
// three independent things: the coffee's own raw internal name, any roaster
// name linked to it, and the fixed banned-term list (farm/co-op/lot/etc.).
// Coffee presentation brief 1 (2026-10-23), D4: `leakTokens` (built per coffee
// by contentGuard.bannedTokensFor: names as phrases, each award word alone)
// join the reject list; a hit is a violation like any other.
export function checkStorySpecificityViolations(
  text: string,
  params: { rawCoffeeName: string | null; roasterNames: string[]; bannedTerms?: string[]; leakTokens?: string[] }
): string[] {
  const violations: string[] = [];
  const bannedTerms = params.bannedTerms ?? getBannedTerms();

  if (params.rawCoffeeName && params.rawCoffeeName.trim().length > 2) {
    const re = new RegExp(`\\b${escapeRegExp(params.rawCoffeeName.trim())}\\b`, 'i');
    if (re.test(text)) violations.push(`raw coffee name "${params.rawCoffeeName}"`);
  }
  for (const roasterName of params.roasterNames) {
    if (!roasterName || roasterName.trim().length < 3) continue;
    const re = new RegExp(`\\b${escapeRegExp(roasterName.trim())}\\b`, 'i');
    if (re.test(text)) violations.push(`roaster name "${roasterName}"`);
  }
  for (const term of bannedTerms) {
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i');
    if (re.test(text)) violations.push(`banned term "${term}"`);
  }
  for (const token of params.leakTokens ?? []) {
    if (looksLikeLeak(text, [token])) violations.push(`roaster-blind term "${token}"`);
  }
  return violations;
}

// Coffee presentation brief 3 (2026-10-24), decision 4: the story follows the
// description's rules. Its flavor words are the roaster's voice
// (roasterVoiceReads.getRoasterVoice: signature then accent, the order the
// read already gives), attributed ("the roaster calls it"), with "and we
// tasted it too" only for a note our cupping confirmed; never the old
// topDescriptors list, never our tasting as our own, never the archetype as a
// category. Region-level origin stays (HOME_TASK_5, "the highlands of X"): on
// the story page that is by design, not a leak.
export interface StoryGenParams {
  /** the coffee's display name, or "this coffee" (never its catalog name, never an archetype label) */
  displayName: string;
  origin: string | null;
  process: string | null;
  dimensions: Array<{ dimension: string; avg_min: number; avg_max: number; scale_min_label: string; scale_max_label: string }>;
  /** brief 4: remarks and portal answers too (masked by the read), for the brew lines and the brew rule */
  voice: Pick<RoasterVoice, 'descriptors' | 'remarks' | 'portal'>;
  /** the archetype labels (from the database), named in the category rule */
  archetypeLabels: string[];
  /** brief 4: the brew-method labels (lookup roastery_portal_brew_method, read at generation time) the brew rule checks */
  brewLabels: string[];
}

/**
 * The roaster's notes for the story prompt: signature, accent, the ones our
 * cupping confirmed. Coffee presentation brief 4 (2026-10-24), decision 4: and
 * the brew methods the roaster names (portal answers as lookup labels, then
 * whatever the brewing remarks say, masked by the read).
 */
function storyVoiceLines(voice: StoryGenParams['voice']): string {
  const roaster = voice.descriptors.filter(d => d.voice !== 'customer');
  const signature = roaster.filter(d => d.is_signature).map(d => d.descriptor);
  const accent = roaster.filter(d => !d.is_signature).map(d => d.descriptor);
  const confirmed = roaster.filter(d => d.confirmed_by_cupping).map(d => d.descriptor);
  const brewing = voice.remarks.brewing ?? [];
  return [
    `The roaster's signature notes (the core of the cup, strongest first): ${signature.length ? signature.join(', ') : 'none'}`,
    `The roaster's accent notes (only ever "a hint of"): ${accent.length ? accent.join(', ') : 'none'}`,
    confirmed.length ? `Of the roaster's notes, Axis & Bloom's cupping table tasted these too: ${confirmed.join(', ')}` : null,
    brewLine(voice.portal),
    takesItLine(voice.portal.takesIt),
    brewing.length ? `What the roaster says about brewing it (paraphrase, do not quote): ${brewing.join(' / ')}` : null,
  ].filter((s): s is string => s !== null).join('\n');
}

/** The story's user prompt (exported for the prompt snapshot test). */
export function buildStoryPrompt(params: StoryGenParams, correctionNote?: string): string {
  const dimLines = params.dimensions
    .map(d => `  ${d.dimension}: ${d.avg_min} to ${d.avg_max} out of 15 (scale from ${d.scale_min_label} to ${d.scale_max_label})`)
    .join('\n');

  const correction = correctionNote
    ? `\n\nYour previous attempt was rejected for this reason: ${correctionNote}. Do not repeat this. Region and process only, nothing that pins a specific farm, co-op, lot, estate, importer, or roaster, never the coffee's own catalog name, and every flavor word attributed to the roaster.`
    : '';

  // Coffee presentation brief 4 (test run, 2026-10-24): with no origin or no
  // process on the coffee the model invented both ("the highlands of Central
  // America", "a washed process"); what is not given is not covered.
  const covering = [
    params.origin ? `where it's from (region-level only, e.g. "the highlands of X", never a specific farm, co-op, lot, estate, or importer name)` : null,
    params.process ? `how it's processed (in plain language)` : null,
    `what ${params.process ? 'that does to' : 'shapes'} the cup (tied to the structure below)`,
    'one thing worth noticing',
  ].filter((s): s is string => s !== null);
  const unknown = [
    params.origin ? null : `- Where it is grown is not given: say nothing about its origin (no country, region, altitude, soil or climate).`,
    params.process ? null : `- How it was processed is not given: say nothing about its processing.`,
  ].filter((s): s is string => s !== null);

  return `Write a 120 to 200 word story for "${params.displayName}" covering: ${covering.slice(0, -1).join(', ')}, and ${covering[covering.length - 1]}.

${params.origin ? `Origin reference (distill to region-level ONLY; do not repeat any farm, co-op, lot, or estate name verbatim even if present here): ${params.origin}` : ''}
${params.process ? `Process reference: ${params.process}` : ''}

${storyVoiceLines(params.voice)}

Structure on a 0 to 15 scale (the labels are the two extremes; a middle value is moderate):
${dimLines || '  (no numeric data)'}

Rules:
- Never name a specific farm, co-op, cooperative, estate, lot, or importer.
${unknown.length ? `${unknown.join('\n')}\n` : ''}- Never name the roaster or any roastery ("the roaster" is how you refer to them).
- Refer to it only as "${params.displayName}" or "this coffee", never the internal catalog name, and never invent a different name or nickname of your own for it.
- Flavor words: only the roaster's notes listed above, never one of your own. Attribute them to the roaster ("the roaster calls it", "per the roaster"). Where our cupping table tasted one of them too you may add "and we tasted it too"; never present a tasting as Axis & Bloom's own ("our cupping revealed", "we found", "our cuppers noticed" are not allowed).
- Structure (body, sweetness, acidity, bitterness, finish) may be described plainly, in proportion to the scale; never exaggerate a middle value.
- Never use the word "archetype", and never put a category word${params.archetypeLabels.length ? ` such as ${params.archetypeLabels.map(l => l.toLowerCase()).join(', ')}` : ''} in front of "coffee", "blend", "cup", "style" or "profile".
${params.voice.portal.takesIt
    ? '- Mention how it is drunk (milk, black, on its own) only as "How the roaster says it is drunk" above puts it (a note\'s own name, such as milk chocolate, is fine).'
    : '- Say nothing about adding milk or drinking it black, and no milk drinks, even if a fact above mentions them (a note\'s own name, such as milk chocolate, is fine).'}
${BREW_RULE}
${GAP_RULE}
- Never use an em dash or an en dash. Use commas, periods or colons instead.
- Plain prose only. No title, no heading, no markdown formatting (no "#", no bold); start directly with the first sentence of the story.
- Warm, specific, editorial voice. No marketing language.
- 120 to 200 words.${correction}`;
}

async function generateOnce(params: StoryGenParams, correctionNote?: string): Promise<string> {
  const response = await guardClaudeCall('coffee_content', 'claude-haiku-4-5-20251001', () =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: STORY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildStoryPrompt(params, correctionNote) }],
    })
  );

  const block = response.content[0];
  const rawText = block.type === 'text' ? block.text : '';
  // Defense-in-depth against the prompt rule above, same "enforce twice"
  // philosophy as the specificity line — a stray leading markdown heading
  // (observed in early backfill output despite the prompt already banning it)
  // would otherwise render as a literal "#" on the public story page.
  // Decision 4: dashes are replaced after generation, as brief 1 does for the
  // description (contentGuard.normalizeDashes).
  return normalizeDashes(rawText.replace(/^#{1,6}\s.*\n+/, '').trim());
}

/** The generic word the story's attribution needs, exempt from the banned-term list for the full story only. */
const ATTRIBUTION_WORD = 'roaster';

/** Our tasting presented as our own (decision 4); "and we tasted it too" is allowed. Null when clean. */
export function ownTastingViolation(text: string): string | null {
  const m = /\b(our (cupping|cuppers?|tasting|tasters?)( table)? (revealed|found|noticed|showed|picked up)|we found|we noticed|we discovered)\b/i.exec(text);
  return m ? `our tasting as our own "${m[0]}"` : null;
}

export interface StoryGenResult {
  text: string;
  passed: boolean;
  attempts: number;
  violations: string[];
  /** every rejected attempt's reasons, in order (brief 3: the regeneration loader prints them) */
  rejects: string[];
}

// The specificity line, enforced twice (§4.4 item 2): the prompt above bans
// the concepts; this loop bans the actual output, retrying with the specific
// violation named so the retry has a real chance of fixing it, not just
// repeating the same mistake. Never throws on repeated failure — returns the
// last attempt with `passed: false` so it's visible in `story_draft` for an
// admin to fix, and is never promoted to the live `story` field.
// Coffee presentation brief 3, decision 4: the same three tries also reject
// an archetype name used as a category or the word "archetype"
// (contentGuard.styleViolation over `archetypeLabels`, from the database; its
// milk check too since brief 4, Dana's go: milk words only with a takes_it
// answer) and our tasting presented as our own.
export async function generateCoffeeStoryWithRetry(
  params: StoryGenParams,
  identity: { rawCoffeeName: string | null; roasterNames: string[]; leakTokens?: string[]; archetypeLabels?: string[] },
  maxRetries = 2
): Promise<StoryGenResult> {
  let lastText = '';
  let lastViolations: string[] = [];
  let correctionNote: string | undefined;
  const rejects: string[] = [];

  // The attribution decision 4 asks for ("the roaster calls it") uses the
  // generic word the configured list bans (HOME_TASK_5); for the full story
  // that one word is let through. The roaster's names (roasterNames,
  // leakTokens), "roastery" and the rest of the list still reject.
  const bannedTerms = getBannedTerms().filter(t => t.toLowerCase() !== ATTRIBUTION_WORD);

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const text = await generateOnce(params, correctionNote);
    const violations = checkStorySpecificityViolations(text, { ...identity, bannedTerms });
    // Dana's go (2026-10-24): the milk rule too, as for the description (milk words only with a takes_it answer)
    const style = styleViolation(text, identity.archetypeLabels ?? [], params.voice.portal.takesIt !== null);
    if (style) violations.push(`style: ${style}`);
    const own = ownTastingViolation(text);
    if (own) violations.push(own);
    // brief 4, decision 4: a brew method the roaster did not name; decision 3: a printed gap
    const brew = looksLikeInventedBrew(text, params.voice, params.brewLabels);
    if (brew) violations.push(`brew method "${brew}" the roaster does not name`);
    const gap = maskViolation(text);
    if (gap) violations.push(gap);
    // "and we tasted it too" only where our cupping confirmed a roaster note (test run: 1 of 22 said it with none)
    if (/\bwe tasted\b/i.test(text) && !params.voice.descriptors.some(d => d.voice !== 'customer' && d.confirmed_by_cupping)) {
      violations.push('"we tasted" but our cupping confirmed none of the roaster\'s notes');
    }
    lastText = text;
    lastViolations = violations;

    if (violations.length === 0) {
      return { text, passed: true, attempts: attempt, violations: [], rejects };
    }
    correctionNote = violations.join('; ');
    rejects.push(correctionNote);
    console.warn(`[storyLayer] attempt ${attempt} rejected for "${params.displayName}": ${correctionNote}`);
  }

  return { text: lastText, passed: false, attempts: maxRetries + 1, violations: lastViolations, rejects };
}

// Shared by generateBrewNoteSentence() and generateOrderPlacedLine() (HOME_TASK_6
// / HOME_TASK_8) — both are "one warm sentence about a specific coffee," same
// content pipeline, same alias-only/specificity discipline as the full story
// (S38/S44/S74): displayName only, never the raw coffee name or roaster,
// checked with the identical checkStorySpecificityViolations() rather than a
// second checker. One generation attempt, one retry with the violation
// named, then the caller's own generic fallback — neither an arrival note
// nor an order confirmation may ever block on content-pipeline failure.
async function generateOneWarmSentence(
  label: string,
  promptCore: string,
  fallback: string,
  identity: { rawCoffeeName: string | null; roasterNames: string[]; leakTokens?: string[] }
): Promise<string> {
  async function attempt(correctionNote?: string): Promise<string> {
    const correction = correctionNote
      ? `\n\nYour previous attempt was rejected for this reason: ${correctionNote}. Do not repeat this.`
      : '';
    const response = await guardClaudeCall('lifecycle', 'claude-haiku-4-5-20251001', () =>
      client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: STORY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `${promptCore}${correction}` }],
      })
    );
    const block = response.content[0];
    return (block.type === 'text' ? block.text : '').trim();
  }

  try {
    let text = await attempt();
    let violations = checkStorySpecificityViolations(text, identity);
    if (violations.length > 0) {
      console.warn(`[storyLayer] ${label} attempt 1 rejected: ${violations.join('; ')}`);
      text = await attempt(violations.join('; '));
      violations = checkStorySpecificityViolations(text, identity);
    }
    if (violations.length > 0) {
      console.warn(`[storyLayer] ${label} attempt 2 also rejected: ${violations.join('; ')} — using generic fallback`);
      return fallback;
    }
    return text || fallback;
  } catch (err) {
    console.error(`[storyLayer] ${label} failed, using fallback:`, err);
    return fallback;
  }
}

// HOME_TASK_6 (§3.1) — the arrival note's one warm sentence about the coffee
// itself (distinct from the brew card's own `params.notes`, which is pure
// code + config — see brewCard.ts's computeRecipe()).
export async function generateBrewNoteSentence(
  params: { displayName: string; archetype: string | null; topDescriptors: string[] },
  identity: { rawCoffeeName: string | null; roasterNames: string[]; leakTokens?: string[] }
): Promise<string> {
  const promptCore = `Write exactly one warm, editorial sentence (max 30 words) introducing "${params.displayName}"${params.archetype ? `, a ${params.archetype} coffee` : ''} for a customer whose bag just arrived. Refer to it only as "${params.displayName}" or "this coffee" — never invent another name.
${params.topDescriptors.length ? `Top flavor descriptors: ${params.topDescriptors.join(', ')}` : ''}

Rules: one sentence only, no title, no markdown. Never name a specific farm, co-op, cooperative, estate, lot, or importer. Never name a roaster.`;
  const fallback = `${params.displayName} is on its way to your cup — here's how to get the most out of it.`;
  return generateOneWarmSentence('brew-note sentence', promptCore, fallback, identity);
}

// HOME_TASK_8 (§3.1) — "Order placed. One line in the confirmation flow,
// Liam's voice: what's coming and one thing to notice about it." Generated
// once at order time, no conversation attached — injected into the
// order-confirmation response (orders.ts), never stored beyond that response.
export async function generateOrderPlacedLine(
  params: { displayName: string; archetype: string | null; topDescriptors: string[] },
  identity: { rawCoffeeName: string | null; roasterNames: string[]; leakTokens?: string[] }
): Promise<string> {
  const promptCore = `Write exactly one warm, editorial sentence (max 30 words) telling a customer what's coming — they just ordered "${params.displayName}"${params.archetype ? `, a ${params.archetype} coffee` : ''} — and naming one specific thing about it worth noticing before it arrives. Refer to it only as "${params.displayName}" or "this coffee" — never invent another name.
${params.topDescriptors.length ? `Top flavor descriptors: ${params.topDescriptors.join(', ')}` : ''}

Rules: one sentence only, no title, no markdown. Never name a specific farm, co-op, cooperative, estate, lot, or importer. Never name a roaster.`;
  const fallback = `${params.displayName} is on its way — worth paying attention to on the first cup.`;
  return generateOneWarmSentence('order-placed line', promptCore, fallback, identity);
}
