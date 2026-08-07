import Anthropic from '@anthropic-ai/sdk';
import { getSommelierConfig } from './sommelierConfig.js';
import { guardClaudeCall } from './anthropicGuard.js';

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
export function checkStorySpecificityViolations(
  text: string,
  params: { rawCoffeeName: string | null; roasterNames: string[]; bannedTerms?: string[] }
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
  return violations;
}

export interface StoryGenParams {
  displayName: string;
  archetype: string | null;
  origin: string | null;
  process: string | null;
  dimensions: Array<{ dimension: string; avg_min: number; avg_max: number; scale_min_label: string; scale_max_label: string }>;
  topDescriptors: string[];
}

async function generateOnce(params: StoryGenParams, correctionNote?: string): Promise<string> {
  const dimLines = params.dimensions
    .map(d => `  ${d.dimension}: ${d.avg_min}–${d.avg_max}/15 (${d.scale_min_label} → ${d.scale_max_label})`)
    .join('\n');

  const correction = correctionNote
    ? `\n\nYour previous attempt was rejected for this reason: ${correctionNote}. Do not repeat this — region and process only, nothing that pins a specific farm, co-op, lot, estate, importer, or roaster, and never the coffee's own catalog name.`
    : '';

  const content = `Write a 120–200 word story for "${params.displayName}"${params.archetype ? `, a ${params.archetype} coffee` : ''} covering: where it's from (region-level only — e.g. "the highlands of X," never a specific farm, co-op, lot, estate, or importer name), how it's processed (in plain language), what that does to the cup (tied to the actual cupping data below), and one thing worth noticing.

${params.origin ? `Origin reference (distill to region-level ONLY — do not repeat any farm, co-op, lot, or estate name verbatim even if present here): ${params.origin}` : ''}
${params.process ? `Process reference: ${params.process}` : ''}

Cupping data:
${dimLines || '  (no numeric data)'}
Top flavor descriptors: ${params.topDescriptors.length ? params.topDescriptors.join(', ') : 'none recorded'}

Rules:
- Never name a specific farm, co-op, cooperative, estate, lot, or importer.
- Never name the roaster or any roastery.
- Refer to it only as "${params.displayName}" or "this coffee" — never the internal catalog name, and never invent a different name or nickname of your own for it.
- Plain prose only. No title, no heading, no markdown formatting (no "#", no bold) — start directly with the first sentence of the story.
- Warm, specific, editorial voice. No marketing language.
- 120–200 words.${correction}`;

  const response = await guardClaudeCall('claude-haiku-4-5-20251001', () =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: STORY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    })
  );

  const block = response.content[0];
  const rawText = block.type === 'text' ? block.text : '';
  // Defense-in-depth against the prompt rule above, same "enforce twice"
  // philosophy as the specificity line — a stray leading markdown heading
  // (observed in early backfill output despite the prompt already banning it)
  // would otherwise render as a literal "#" on the public story page.
  return rawText.replace(/^#{1,6}\s.*\n+/, '').trim();
}

export interface StoryGenResult {
  text: string;
  passed: boolean;
  attempts: number;
  violations: string[];
}

// The specificity line, enforced twice (§4.4 item 2): the prompt above bans
// the concepts; this loop bans the actual output, retrying with the specific
// violation named so the retry has a real chance of fixing it, not just
// repeating the same mistake. Never throws on repeated failure — returns the
// last attempt with `passed: false` so it's visible in `story_draft` for an
// admin to fix, and is never promoted to the live `story` field.
export async function generateCoffeeStoryWithRetry(
  params: StoryGenParams,
  identity: { rawCoffeeName: string | null; roasterNames: string[] },
  maxRetries = 2
): Promise<StoryGenResult> {
  let lastText = '';
  let lastViolations: string[] = [];
  let correctionNote: string | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const text = await generateOnce(params, correctionNote);
    const violations = checkStorySpecificityViolations(text, identity);
    lastText = text;
    lastViolations = violations;

    if (violations.length === 0) {
      return { text, passed: true, attempts: attempt, violations: [] };
    }
    correctionNote = violations.join('; ');
    console.warn(`[storyLayer] attempt ${attempt} rejected for "${params.displayName}": ${correctionNote}`);
  }

  return { text: lastText, passed: false, attempts: maxRetries + 1, violations: lastViolations };
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
  identity: { rawCoffeeName: string | null; roasterNames: string[] }
): Promise<string> {
  async function attempt(correctionNote?: string): Promise<string> {
    const correction = correctionNote
      ? `\n\nYour previous attempt was rejected for this reason: ${correctionNote}. Do not repeat this.`
      : '';
    const response = await guardClaudeCall('claude-haiku-4-5-20251001', () =>
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
  identity: { rawCoffeeName: string | null; roasterNames: string[] }
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
  identity: { rawCoffeeName: string | null; roasterNames: string[] }
): Promise<string> {
  const promptCore = `Write exactly one warm, editorial sentence (max 30 words) telling a customer what's coming — they just ordered "${params.displayName}"${params.archetype ? `, a ${params.archetype} coffee` : ''} — and naming one specific thing about it worth noticing before it arrives. Refer to it only as "${params.displayName}" or "this coffee" — never invent another name.
${params.topDescriptors.length ? `Top flavor descriptors: ${params.topDescriptors.join(', ')}` : ''}

Rules: one sentence only, no title, no markdown. Never name a specific farm, co-op, cooperative, estate, lot, or importer. Never name a roaster.`;
  const fallback = `${params.displayName} is on its way — worth paying attention to on the first cup.`;
  return generateOneWarmSentence('order-placed line', promptCore, fallback, identity);
}
