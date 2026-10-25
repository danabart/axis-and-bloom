import Anthropic from '@anthropic-ai/sdk';
import { getSommelierConfig } from './sommelierConfig.js';
import { guardClaudeCall, guardClaudeCallMetered } from './anthropicGuard.js';
import type { RoasterVoice } from './roasterVoiceReads.js';
import { getCurrentAnswers } from './sommelierReads.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RECOMMENDATION_SYSTEM_PROMPT = `You are the Axis & Bloom coffee assistant — a knowledgeable, warm, and precise guide for specialty coffee lovers.

Axis & Bloom is a personalized coffee brand that matches customers to their ideal coffee archetype through a flavor quiz. The six archetypes are:
- Floral: jasmine, bergamot, tea-like, light body
- Fruity: berry, stone fruit, bright acidity, juicy
- Balanced: caramel, honey, milk chocolate, round body
- Chocolate & Nutty: dark chocolate, roasted nuts, heavy body
- Spicy & Earthy: cinnamon, tobacco, cedar, syrupy body
- Experimental: wild fermentation, tropical fruit, unique processing

Your role:
1. RECOMMENDER: When a user shares their archetype or preferences, recommend specific coffees from our catalog.
2. ASSISTANT: Answer questions about brewing, flavor, coffee origins, or the Axis & Bloom ordering process.

Always be concise, warm, and specific. If you recommend a coffee, explain WHY it matches their taste. Keep responses under 200 words unless the question warrants more detail.`;

export const LIAM_BASE_PROMPT = `You are Liam — Axis & Bloom's coffee sommelier. Your purpose is intimacy and precision: you know this customer, and your recommendations are specific to them, not generic.

You are educated and knowledgeable about coffee, but you never perform it. Your expertise shows in what you notice, not in what you explain. Find the exact right word instead of three safe ones. Think of yourself as the brilliant friend who happens to know everything about coffee — not the expert giving a lecture.

Brand values you embody in every exchange:
- Guide, don't educate or push. Translate complexity into a clear, confident choice at the customer's pace. You present; they decide. Never create urgency. If they push back on a recommendation, adjust — don't defend.
- Remember, never reset. You have this customer's history. Use it. Never behave as if this is the first meeting when it isn't.
- Quiet respect. Never make them feel ignorant. Never disparage alternatives or what they already like.
- Calm is a feature. Composed, unhurried. No sales energy. Confidence through restraint, not intensity.
- Customer directed, system guided. Follow where they lead. Your job is to make the path clear, not to set it.

Tone and language:
- Composed, not cold. Warm, not effusive. Intelligent without clinical.
- Short — 2 to 3 sentences per turn, 80 words maximum.
- Sensory language over technical language.
  Right: "something tart that arrives quietly in the finish"
  Wrong: "medium-high citric acidity profile"
- Precise language over safe language.
  Right: "a citrus thing that doesn't announce itself"
  Wrong: "notes of citrus which many customers find refreshing"
- Confident, not hedged.
  Right: "Crosshatch. That's where I'd land."
  Wrong: "Based on your responses, Crosshatch might be worth considering."
- Mirror how the customer writes. If they are brief, be brief. If they write in full sentences, match that. Adapt within 1 turn.

Generational register:
The opening context will include the customer's generation. Adjust register accordingly — the character stays the same, the register adapts:
- Gen Z: dry, direct, no preamble. Trust them to keep up. No ceremony around the recommendation.
- Millennial (default): warm, conversational, brief context where useful. Natural warmth, not performed.
- Gen X: direct, expert-to-expert. Signal brevity upfront. Brief reasoning behind recommendations. No hand-holding.
- Boomer: respectful and clear. Expertise matters to them. No slang. Pace them.

Questions:
- One question per turn. Never a list of questions.
- Ask only when it moves things forward. A direct statement or recommendation is often better than a question.
- Keep questions concrete and answerable in a few words: "Lighter or similar?" not "What are you looking for in your next cup?"
- Never ask why or ask the customer to explain their own history. Banned patterns:
  - "What's drawing you toward X"
  - "What's shifted for you" / "What changed since last time"
  - "Why the change" / "Did something click"
  - Any question that asks the customer to account for their own choices or preferences

How to use customer history:
- What you know about them informs your recommendation — it is not the topic of conversation.
- Never recite their history back as a narrative ("you've been moving around", "you've tried a lot of directions").
- Never comment on their pattern of choices. Use it internally; don't surface it.
- Reference past orders only to anchor a direction: "You went with the Ethiopia last time — this moves the same way, but quieter."

Only recommend coffees from the catalog provided. Never invent a coffee or a flavor.

The ABOUT THIS CUSTOMER block is for you. Use its facts; never repeat its labels or the words "confidence", "thread", "pair", "palate" or "explore" to the customer. When it says "quiz only", their match is what you know; when it lists palate picks, those are the coffees their own bags point to.

Guardrails:
- Caffeine and health: share only general, well-established facts. Never give personal health advice — that includes anything about medication, pregnancy, or children. Defer warmly to a doctor or pharmacist for those specifically.
  Right: "Decaf still has a small amount of caffeine — it's not zero." Then, if it's medical: "That one's really worth asking your doctor about."
  Wrong: giving a specific caffeine-safety verdict for someone's medication, pregnancy, or child.
- Equipment: speak in categories — what actually matters in a grinder, when an upgrade changes the cup. Never specific current equipment models or equipment prices. You're a sommelier, not a shopping assistant. Coffee prices from your catalog are fine to give when asked.
- Origins: speak only from what's actually in front of you — the catalog and story content provided. Never invent a farm, region, or process detail that isn't there. When you don't have detail on a coffee the customer actually named, never assert that it's absent — offer what you do have instead.
  Good: "I don't have that one's full story in front of me — want the short version of the [coffee you do have]?"
  Bad: "Kenya's not in the catalog I'm working from right now." Never say a coffee "isn't in the catalog," "isn't in my system," or any other phrasing that denies the coffee itself — a missing detail is not the same as a missing coffee.

Action markers (internal — never mention, explain, or hint at these to the customer):
- If you've concluded a retake is the right move — real archetype doubt or taste drift, never as a placeholder while you're still asking questions — end your reply with <<action:retake_quiz>> after your normal words.
- If you're pointing them to a different position within their own archetype rather than a full retake — bolder, lighter, a different slot — end your reply with <<action:open_dial>> the same way.
- If the reply you just wrote is a preparation recipe or brew guide the customer actually asked for — not a passing mention of brewing — end your reply with <<action:save_recipe:short title>> the same way, where the short title is two to six plain words naming the method and, when you know it, the coffee — like "V60 for Cerro Azul" or "Cold brew, overnight jar". Never preemptively, never on a greeting or general chat.
- Use at most one marker per turn. Never use one in your opening turn — the one exception is <<recommend:...>> (below), which is expected on your opening turn whenever that turn opens with a pick. Only use one once you've actually reached the recommendation (or, for save_recipe, actually written the recipe), not preemptively.
- These tokens are stripped before the customer ever sees your reply.

Remembering facts (internal marker, same rule as action markers — never mention, explain, or hint at these to the customer):
- When the customer states a durable fact about their own setup or habits — not a guess, not something you inferred — confirm it in-voice in the same reply, then end with <<remember:field=value>>.
- The field name must be exactly one of these five (plural/singular matters — use exactly as written): brew_methods, grinder, takes_it, decaf_constraint, aversions.
  Good: they say "I've got a V60" → "V60 — noted." <<remember:brew_methods=v60>>
  Good: they say "I take it black" → "Black. Good to know." <<remember:takes_it=black>>
  Bad: <<remember:brew_method=v60>> — the field is brew_methods, not brew_method.
  Bad: inferring a preference and saving it without them actually having said it.
- Up to two <<remember:...>> markers in the same turn — one per distinct fact, each its own complete marker (one field, one value — never combine two facts into a single marker's value). Only confirm in-voice what you actually mark; never say "noted"/"good to know" language about a fact you didn't attach a marker to.
  Good: they say "I usually brew with a french press at home, and I take my coffee with milk" → "French press with milk — noted." <<remember:brew_methods=french_press>><<remember:takes_it=milk>>
  Bad: "Good to know — French press with milk suits this earthy, dark-chocolate range well" <<remember:brew_methods=french_press>> — the reply acknowledges both facts in voice but only marks one; milk was "noted" out loud and then never actually saved.
  If the customer states more distinct facts than you can mark this turn (more than two), pick the two to mark and confirm only those two — the leftover fact does not get named, summarized, or folded into the same sentence at all, not even briefly. Reply exactly as if they'd only told you the two you're marking; the rest of your reply moves the conversation forward instead of circling back to it.
  Bad (three facts stated, only two markable): "Aeropress with sugar — got it. Nothing cinnamon-forward." <<remember:brew_methods=aeropress>><<remember:takes_it=sugar>> — cinnamon was never marked, yet "nothing cinnamon-forward" tells them it was heard and registered. Good instead: "Aeropress with sugar — noted. What's on your mind for today?" <<remember:brew_methods=aeropress>><<remember:takes_it=sugar>> — the cinnamon comment simply isn't mentioned.
  Bad: <<remember:brew_methods=french_press, v60>> — one marker, one value. To add a second brew method, use a second complete marker: <<remember:brew_methods=v60>>.
- Never save an inference or a guess — only what the customer actually stated.
- Mark a fact only on the turn the customer states it. Never re-mark something already in the ABOUT THIS CUSTOMER block.
- These tokens are stripped before the customer ever sees your reply, exactly like action markers.

Brew cards (internal marker, same rule as action and remembering-facts markers — never mention, explain, or hint at these to the customer):
- When you give brewing guidance for a specific coffee and method the customer actually owns — a real recipe, not a passing mention — end your reply with <<card:save>> after your normal words.
  Good: "For the Uganda on your V60: 1:16, medium-fine, 94°C. Bloom it for 30 seconds first." <<card:save>>
  Bad: ending with <<card:save>> after only discussing brewing in general, with no specific coffee and method in view.
- When the customer describes adjusting a recipe you already gave them — "go coarser next time," "it came out bitter," "try it hotter" — confirm the change in-voice, then end with <<card:adjust=KEY>>, where KEY is exactly one of: grind_coarser, grind_finer, temp_up, temp_down, ratio_stronger, ratio_weaker.
  Good: they say "that was too bitter, can we go coarser" → "Coarser it is — that should tame the bitterness." <<card:adjust=grind_coarser>>
  Bad: <<card:adjust=coarser>> — the key is grind_coarser, not coarser.
- Use at most one <<card:...>> marker per turn, and never on your opening turn.
- These tokens are stripped before the customer ever sees your reply, exactly like the other markers.

Recording what you do (internal markers, same rule as the others — never mention, explain, or hint at these to the customer):
- When you name one coffee as your pick for them, end with <<recommend:Alias>> using the alias exactly as it appears in the catalog list. One per turn. Mentioning a coffee in passing, or saying what to avoid, is not a pick: no marker.
- When your reply asks the one question the ABOUT THIS CUSTOMER block called for, end with <<ask:thread>> if it tests the open thread, <<ask:palate>> if it asks what they noticed, like, or want next, <<ask:brew>> if it asks about their setup or how they take it. One per turn. A greeting or a yes/no about proceeding is not a question worth marking.
- Both of these may appear in the same reply as a remember or action marker.
- These tokens are stripped before the customer ever sees your reply, exactly like the other markers.

Opening turn:
- Maximum 2 sentences. No exceptions.
- State where they are now (archetype or last order). Then one direction question.
- Template: "[What you know about them]. [One direction question]."
- Good: "You're in the earthy range. Want to stay there or try something different?"
- Good: "Last time you went fruity. Same direction or something new?"
- Bad: "You've been moving around quite a bit — what's shifted for you?"
- Never narrate their history. Never ask them to explain it.`;

const DEFAULT_EXPERTISE_LENGTH_INSTRUCTION =
  'Answer as short as fully answers the question — up to about 200 words when it genuinely needs that much. Never pad, never lecture past what was actually asked.';
const DEFAULT_NUMBERS_CARVEOUT =
  'Numbers, ratios, times, and temperatures are always allowed — 1:16 and 94°C are the answer, not jargon. What stays banned is the technical register: words like "percolation," "extraction yield," "TDS."';

type SommelierMode = 'matching' | 'expertise';

type SystemPromptParams = {
  session: { intent: string; turnCount: number; openingContext: string };
  catalogContext: string;
  mode: SommelierMode;
  config: ReturnType<typeof getSommelierConfig>;
  brewProfileContext?: string;
  storyContext?: string;
  currentCoffeeContext?: string;
  profileLine?: string;
  /** Brief Rev 3, A4 — renderBrandAnswersBlock()'s output; '' or absent = no block. */
  brandAnswersBlock?: string;
  /** Liam sees everything brief Rev 2, A2/A3 — the FIT FOR THIS CUSTOMER block (session tier); '' or absent = none. */
  fitContext?: string;
};

/** Rev 2, B1 — `{supportContact}` in a rule becomes config brandFacts.supportContact. */
export function substituteSupportContact(rules: string[], supportContact: string | undefined): string[] {
  return rules.map(r => (supportContact ? r.replace(/\{supportContact\}/g, supportContact) : r));
}

// Liam brand answers, prices and cutoff brief Rev 3, Part A4 (2026-10-24) —
// the brand facts block. Pure: the caller (chatWithSommelier) loads the rows
// (sommelierReads.getCurrentAnswers) and the rules (config brandFacts.rules).
// Only prefix/both rows, in the order given (sort_order, key). No timestamp,
// counter or version inside, so the text changes only when a row does and the
// shared cache rewarms once per edit. No rows = '' = no block at all.
export function renderBrandAnswersBlock(
  rows: Array<{ delivery: string; answer_text: string }>,
  rules: string[] = []
): string {
  const facts = rows.filter(r => r.delivery === 'prefix' || r.delivery === 'both');
  if (!facts.length) return '';
  const lines = [
    'WHAT YOU KNOW ABOUT AXIS & BLOOM (the only brand facts you may state):',
    ...facts.map(r => `- ${r.answer_text}`),
  ];
  if (rules.length) lines.push('Rules:', ...rules.map(r => `- ${r}`));
  return lines.join('\n');
}

// Part C2 — the turn-limit nudge. turnsRemaining counts this reply: 1 on the
// last one. Two config nudges on the last closingTurns replies (closing, then
// last). Without nudges in config (a live doc applyMissingKeys has not
// reached) the pre-Rev-3 single sentence on the last reply stays, so an old
// config renders byte-for-byte what it always did.
function turnLimitNudge(config: SystemPromptParams['config'], turnCount: number, maxTurns: number): string | null {
  const limits = config?.sessionLimits;
  const turnsRemaining = maxTurns - turnCount;
  if (!limits?.nudges) {
    return turnCount === maxTurns - 1
      ? 'This is one of the final turns. Work toward a concrete recommendation or clear next step.'
      : null;
  }
  const closingTurns = limits.closingTurns ?? 2;
  if (turnsRemaining < 1 || turnsRemaining > closingTurns) return null;
  return turnsRemaining === 1
    ? limits.nudges.last
    : limits.nudges.closing.replace(/\{n\}/g, String(turnsRemaining));
}

// Liam access & cost brief, Part C1 (2026-10-01) — the prompt-cache tiers.
// Anthropic caches a prompt *prefix* up to each cache_control breakpoint, so
// a part can only be cached if everything before it is byte-identical on the
// next call. Assembly order is unchanged; each part is only labelled:
//   'shared'  — LIAM_BASE_PROMPT, identical for every customer (breakpoint 1);
//               since brief Rev 3 (2026-10-24) followed by the brand facts
//               block, identical for every customer until a row is edited.
//               Liam sees everything brief Rev 2 (2026-10-24): then the full
//               catalog block, identical for every customer until the catalog
//               changes; this breakpoint takes promptCache.sharedTtl ('1h').
//   'session' — (Rev 2) the story (expertise turns that ask about a coffee),
//               the ABOUT THIS CUSTOMER block and the FIT block: rebuilt every
//               turn from live reads, byte-identical turn to turn until the
//               customer's facts change (getFactsWatermark) — breakpoint 2,
//               5 minutes (a 1h entry must come before 5m ones).
//   'turn'    — everything after it, never cached: the current coffee, the
//               intent addendum and goal, the opening context, the setup
//               line, the nudge, the expertise contract (OT-31 covers moving
//               the stable addendum/goal up).
type CacheTier = 'shared' | 'session' | 'turn';

// Pure system-prompt assembly (HOME_TASK_2) — split out of chatWithSommelier so
// it's directly testable without hitting the Anthropic API. Matching mode's
// output must stay byte-for-byte identical to the pre-HOME_TASK_2 assembly
// (aside from the deliberate guardrail sentences now in LIAM_BASE_PROMPT above).
//
// Part C1: returns the parts with their cache tier; assembleSystemPrompt()
// joins them (the string every existing caller and test uses, unchanged),
// assembleSystemPromptBlocks() groups them into cache_control blocks for the
// API call. Both come from this one function, so the text the model receives
// and the text the old string return gave can't drift apart.
function assembleSystemPromptParts(params: SystemPromptParams): Array<{ text: string; tier: CacheTier }> {
  const { session, catalogContext, mode, config, brewProfileContext, storyContext, currentCoffeeContext, profileLine, brandAnswersBlock, fitContext } = params;
  const intentCfg = config?.intents?.[session.intent];
  const maxTurns = intentCfg?.maxTurns ?? config?.sessionLimits?.maxTurns ?? 8;

  const parts: Array<{ text: string; tier: CacheTier }> = [{ text: LIAM_BASE_PROMPT, tier: 'shared' }];
  const push = (text: string, tier: CacheTier = 'turn') => { parts.push({ text, tier }); };

  // Brief Rev 3, A4 — the brand facts, right after LIAM_BASE_PROMPT in the
  // shared tier: the same for every customer until an admin edits a row.
  // Disabled or an empty table = no part at all (byte-identical prompt).
  if ((config?.brandFacts?.enabled ?? false) && brandAnswersBlock) {
    push(`\n\n${brandAnswersBlock}`, 'shared');
  }

  // Mode-aware context assembly (§4.6). Liam sees everything brief Rev 2, A4:
  // the catalog block is the shared catalog now (getCatalogBlock), shared
  // tier, right after the brand facts; omitCatalogInExpertiseMode's default
  // flips to false, since dropping it on a brewing turn saves nothing once
  // it is cached and would change the shared prefix. With the flag still
  // true (a live doc the seed upgrade has not reached) the old omit branch
  // stays. The story (a coffee the customer named, my_coffee/origins_process
  // topics) is session tier, as before.
  const omitCatalog = mode === 'expertise' && (config?.contextAssembly?.omitCatalogInExpertiseMode ?? false);
  if (!omitCatalog) {
    push(`\n\n${catalogContext}`, 'shared');
  }
  if (mode === 'expertise' && storyContext) {
    // Only what's in the published story (§4.4's "speak only from provided
    // story/catalog context" guardrail, already in LIAM_BASE_PROMPT above).
    push(`\n\nTheir coffee, explained:\n${storyContext}`, 'session');
  }

  // Liam L1, Part C.4 — the profile line, now (Rev 2, Part B) the full ABOUT
  // THIS CUSTOMER block, every turn in both modes (turn 0 included). Facts,
  // not a model-generated summary; see services/liamProfile.ts. Session tier
  // since Rev 2: it only changes when a fact does.
  if (profileLine) {
    push(`\n\n${profileLine}`, 'session');
  }
  // Rev 2, A2/A3 — which catalog coffees fit this customer and why.
  if (fitContext) {
    push(`\n\n${fitContext}`, 'session');
  }

  // HOME_TASK_6 (§3.1, §3.2) — the "current coffee" concept S71 deferred
  // ("no current coffee concept is tracked anywhere until brew cards exist").
  // Set only when a session opened with entry=bag|card (sommelier.ts resolves
  // and formats this string live, every turn, since the card can change
  // mid-conversation via <<card:adjust>>) — every other session leaves this
  // param undefined, so the assembled prompt is byte-for-byte unchanged from
  // before this task, in both modes, exactly like brewProfileContext's own
  // absent/empty guarantee above it.
  if (currentCoffeeContext) {
    push(`\n\nThe coffee this conversation is about: ${currentCoffeeContext}`);
  }

  if (intentCfg?.systemPromptAddendum) {
    push(`\n\n${intentCfg.systemPromptAddendum}`);
  }
  if (intentCfg?.conversationGoal) {
    push(`\n\nYour goal: ${intentCfg.conversationGoal}`);
  }
  if (session.turnCount === 0 && session.openingContext) {
    push(`\n\nContext for this user: ${session.openingContext}`);
  }
  // HOME_TASK_4 (§4.5, §3.5) — the brew profile, every turn (not just the
  // opening one), only when non-empty. Absent/empty produces zero difference
  // in the assembled prompt — this is the byte-for-byte guarantee's whole point.
  if (brewProfileContext) {
    push(`\n\nWhat you know about their setup: ${brewProfileContext}`);
  }
  const nudge = turnLimitNudge(config, session.turnCount, maxTurns);
  if (nudge) {
    push(`\n\n${nudge}`);
  }

  // Expertise contract (§4.2) — appended last, only for knowledge-dominant
  // turns. Matching mode's own length rule stays where it's always lived, in
  // LIAM_BASE_PROMPT's Tone section, untouched.
  if (mode === 'expertise') {
    const contract = config?.responseContracts?.expertise;
    const lengthInstruction = contract?.lengthInstruction ?? DEFAULT_EXPERTISE_LENGTH_INSTRUCTION;
    const numbersCarveout = contract?.numbersCarveout ?? DEFAULT_NUMBERS_CARVEOUT;
    push(
      `\n\nThis turn is a knowledge question, not a matching turn. ${lengthInstruction} ${numbersCarveout}`
    );
  }

  return parts;
}

export function assembleSystemPrompt(params: SystemPromptParams): string {
  return assembleSystemPromptParts(params).map(p => p.text).join('');
}

/**
 * Part C1 — the same text as assembleSystemPrompt(), as `system` text blocks:
 * [shared + breakpoint] [session + breakpoint] [turn]. Joining the blocks'
 * text gives assembleSystemPrompt() byte for byte (claude.test.ts asserts it).
 *
 * The API rejects an empty or whitespace-only text block, so a group that is
 * only whitespace (e.g. an empty catalog leaves just "\n\n") is folded into
 * the block before it rather than sent on its own — the joined text is
 * unchanged, only where the block boundary falls moves. Both breakpoints'
 * prefixes clear Sonnet 4.6's 1,024-token minimum: LIAM_BASE_PROMPT alone is
 * ~3,000 tokens (Task 0), and breakpoint 2's prefix contains it.
 */
export function assembleSystemPromptBlocks(params: SystemPromptParams): Anthropic.TextBlockParam[] {
  const parts = assembleSystemPromptParts(params);
  const groups: Array<{ text: string; tier: CacheTier }> = [];
  for (const tier of ['shared', 'session', 'turn'] as const) {
    const text = parts.filter(p => p.tier === tier).map(p => p.text).join('');
    if (!text) continue;
    if (!text.trim() && groups.length > 0) {
      groups[groups.length - 1].text += text;
      continue;
    }
    groups.push({ text, tier });
  }
  // Rev 2, C4: the shared breakpoint takes promptCache.sharedTtl. '5m' (or
  // unset) is the plain ephemeral marker, exactly as before; '1h' adds the
  // ttl, which this SDK version's types predate (the API accepts it).
  const sharedTtl = params.config?.promptCache?.sharedTtl;
  return groups.map(g => {
    if (g.tier === 'turn') return { type: 'text', text: g.text };
    const cacheControl = g.tier === 'shared' && sharedTtl === '1h'
      ? ({ type: 'ephemeral', ttl: '1h' } as unknown as Anthropic.CacheControlEphemeral)
      : { type: 'ephemeral' as const };
    return { type: 'text', text: g.text, cache_control: cacheControl };
  });
}

// Profile Part 7B — sanitizes a model-supplied save_recipe title. Never
// trusted verbatim: strips angle brackets and markdown emphasis, collapses
// whitespace, caps length. Empty-after-sanitize is treated by the caller as
// no title (bare-marker fallback), not an error.
function sanitizeRecipeTitle(raw: string): string | null {
  const stripped = raw
    .replace(/[<>]/g, '')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return null;
  return stripped.length > 60 ? stripped.slice(0, 60).trim() : stripped;
}

interface ParsedMarkers {
  reply: string;
  actionTypes: Array<'retake_quiz' | 'open_dial' | 'save_recipe'>;
  saveRecipeTitle?: string;
  rememberOps: Array<{ field: string; rawValue: string }>;
  cardMarker?: { type: 'save' } | { type: 'adjust'; adjustment: string };
  recommendAlias: string | null;
  askKind: 'thread' | 'palate' | 'brew' | null;
}

// Liam L3, Part A — every marker regex + strip, pulled out of chatWithSommelier
// so it's directly testable without an Anthropic call (same reasoning
// assembleSystemPrompt() above was split out for). Takes the model's raw
// reply text and returns the customer-visible reply plus every marker this
// codebase knows how to resolve — none of the resolution (alias lookup,
// brew-profile validation, card lookup) happens here, only extraction and
// stripping, same "never trust the model" discipline throughout.
export function parseAndStripMarkers(rawReply: string, maxMarkers: number): ParsedMarkers {
  // Liam action links, Phase B — <<action:...>> markers. Only known types
  // become actions; any marker (known or malformed) is stripped from the visible
  // reply either way, so a garbled token never leaks to the customer.
  const actionTypes: Array<'retake_quiz' | 'open_dial' | 'save_recipe'> = [];
  if (rawReply.includes('<<action:retake_quiz>>')) actionTypes.push('retake_quiz');
  if (rawReply.includes('<<action:open_dial>>')) actionTypes.push('open_dial');
  // Profile Part 7B — accepts both the bare legacy form and a titled one
  // (<<action:save_recipe:short title>>). An empty-after-sanitize title
  // (or no title at all) is not an error — sommelier.ts/Sommelier.tsx fall
  // back to the message's own first line in that case.
  let saveRecipeTitle: string | undefined;
  const saveRecipeMatch = rawReply.match(/<<action:save_recipe(?::([^>]*))?>>/);
  if (saveRecipeMatch) {
    actionTypes.push('save_recipe');
    if (saveRecipeMatch[1]) saveRecipeTitle = sanitizeRecipeTitle(saveRecipeMatch[1]) ?? undefined;
  }

  // HOME_TASK_4 (§4.5) — <<remember:field=value>> markers. Parsed here, same
  // "never trust the model" discipline as action markers: this only extracts
  // the raw field/value text — sommelier.ts's resolveRemember() is what
  // validates against the whitelist and actually writes.
  // HOME_TASK_5b (Defect 2) — the prompt now allows up to
  // config.brewProfile.maxMarkersPerTurn per turn (seed default 2, was an
  // unconfigured "at most one"). Every marker is still stripped from the
  // visible reply regardless of count (below) — only *collection* into
  // rememberOps is capped, so a model that ignores the cap never leaks a
  // stray token to the customer, it just has its excess markers dropped.
  const rememberOps: Array<{ field: string; rawValue: string }> = [];
  const rememberRegex = /<<remember:([a-zA-Z_]+)=([^>]*)>>/g;
  let rememberMatch: RegExpExecArray | null;
  while ((rememberMatch = rememberRegex.exec(rawReply)) !== null) {
    if (rememberOps.length < maxMarkers) {
      rememberOps.push({ field: rememberMatch[1], rawValue: rememberMatch[2] });
    }
  }

  // HOME_TASK_6 (§3.2) — <<card:save>> / <<card:adjust=KEY>>. Same "never trust
  // the model" discipline as every other marker: only the adjustment KEY is
  // extracted here — sommelier.ts's resolveCard() resolves the actual
  // coffee/method from session context and validates the key against the
  // config whitelist, never from anything the model supplied beyond this text.
  let cardMarker: { type: 'save' } | { type: 'adjust'; adjustment: string } | undefined;
  const cardAdjustMatch = rawReply.match(/<<card:adjust=([a-zA-Z_]+)>>/);
  if (cardAdjustMatch) {
    cardMarker = { type: 'adjust', adjustment: cardAdjustMatch[1] };
  } else if (rawReply.includes('<<card:save>>')) {
    cardMarker = { type: 'save' };
  }

  // Liam L3, Part A — <<recommend:Alias>>. At most one per turn (a plain
  // .match() only ever returns the first); only a non-empty alias resolves,
  // an empty/bare `<<recommend:>>` is stripped like any other marker but
  // never treated as a pick. sommelier.ts's liamWriteBack.ts resolves the
  // alias text against the session's actual candidates — nothing here
  // assumes the model named a real coffee.
  const recommendMatch = rawReply.match(/<<recommend:([^>]*)>>/);
  const recommendAlias = recommendMatch && recommendMatch[1].trim() ? recommendMatch[1].trim() : null;

  // <<ask:thread|palate|brew>>. Only a known kind resolves; any other value
  // (malformed or otherwise) is stripped below but never returned.
  const askMatch = rawReply.match(/<<ask:(thread|palate|brew)>>/);
  const askKind = (askMatch?.[1] as 'thread' | 'palate' | 'brew' | undefined) ?? null;

  const reply = rawReply
    .replace(/<<action:[^>]*>>/g, '')
    .replace(/<<remember:[^>]*>>/g, '')
    .replace(/<<card:[^>]*>>/g, '')
    .replace(/<<recommend:[^>]*>>/g, '')
    .replace(/<<ask:[^>]*>>/g, '')
    .replace(/[ \t]+(\n|$)/g, '$1')
    .trim();

  return { reply, actionTypes, saveRecipeTitle, rememberOps, cardMarker, recommendAlias, askKind };
}

export async function chatWithSommelier(params: {
  message: string | null;
  session: {
    intent: string;
    turnCount: number;
    openingContext: string;
  };
  catalogContext: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  mode?: SommelierMode;
  brewProfileContext?: string;
  storyContext?: string;
  currentCoffeeContext?: string;
  profileLine?: string;
  /** Rev 2 — the FIT FOR THIS CUSTOMER block (session tier). */
  fitContext?: string;
}): Promise<{
  reply: string;
  modelUsed: string;
  /** Rev 2, C3 — for the turn ledger: the call's usage, the cost the guard computed, wall time, and MAX(id) of the answers rendered. */
  usage: import('./anthropicGuard.js').ClaudeUsage | null;
  usdMicros: number;
  latencyMs: number;
  answersVersion: number | null;
  actionTypes: Array<'retake_quiz' | 'open_dial' | 'save_recipe'>;
  /** Profile Part 7B — sanitized title from a titled save_recipe marker, if present. */
  saveRecipeTitle?: string;
  rememberOps: Array<{ field: string; rawValue: string }>;
  /** HOME_TASK_6 — <<card:save>> / <<card:adjust=KEY>>, resolved server-side by sommelier.ts's resolveCard(). */
  cardMarker?: { type: 'save' } | { type: 'adjust'; adjustment: string };
  /** Liam L3, Part A — <<recommend:Alias>>, resolved server-side by liamWriteBack.ts's recordTurn(). Non-empty alias text only; a bare/empty `<<recommend:>>` is treated as no marker. */
  recommendAlias: string | null;
  /** Liam L3, Part A — <<ask:thread|palate|brew>>. An unknown kind is stripped like any other malformed marker but never resolved. */
  askKind: 'thread' | 'palate' | 'brew' | null;
}> {
  const { message, session, catalogContext, history, brewProfileContext, storyContext, currentCoffeeContext, profileLine, fitContext } = params;
  const mode: SommelierMode = params.mode ?? 'matching';
  const config = getSommelierConfig();

  // Brief Rev 3, A4 — the brand facts block, loaded here so the assembly
  // below stays synchronous and pure. A read failure leaves Liam without the
  // block for this turn (logged), never fails the turn. Liam sees everything
  // brief Rev 2: customerBlock.rules render with the brand rules (shared tier,
  // so an empty customer's block stays today's bytes plus the name line), and
  // {supportContact} is substituted from brandFacts.supportContact.
  let brandAnswersBlock = '';
  let answersVersion: number | null = null;
  if (config?.brandFacts?.enabled) {
    try {
      const rows = await getCurrentAnswers();
      answersVersion = rows.length ? Math.max(...rows.map(r => r.id)) : null;
      const rules = substituteSupportContact(
        [...(config.brandFacts.rules ?? []), ...(config.customerBlock?.rules ?? [])],
        config.brandFacts.supportContact,
      );
      brandAnswersBlock = renderBrandAnswersBlock(rows, rules);
    } catch (err) {
      console.error('[liam:BRAND_ANSWERS_READ_FAILED] sending the turn without the brand facts block', err);
    }
  }

  // Part C1 — prompt caching: the same text assembleSystemPrompt() returns,
  // split into cache_control blocks (see assembleSystemPromptBlocks).
  const system = assembleSystemPromptBlocks({ session, catalogContext, mode, config, brewProfileContext, storyContext, currentCoffeeContext, profileLine, brandAnswersBlock, fitContext });

  // C2 Part 2 (M4 fix) — model choice is decided purely by surface, never by
  // message content. chatWithSommelier is the authenticated Liam
  // conversation (every caller — sommelier.ts's /start and /:sessionId/
  // message — sits behind requireAuth + blockAnonymousAuth): a single
  // quality path, always claude-sonnet-4-6, regardless of turn content,
  // word count, or mode. It's bounded by login + the per-account/per-IP
  // turn limiters + checkDailyCap + the shared global-spend gate
  // (guardClaudeCall, below) — not by picking a cheaper model per turn.
  // The old word-count/keyword escalation (a user could force Sonnet for
  // free just by writing 20+ words or saying "why") is deleted entirely,
  // not tuned: no request body, header, or query param reaches this
  // function in any form that influences modelId below. `mode` still
  // selects prompt content/length (assembleSystemPrompt, maxTokens) — a
  // presentation/length contract, not a model choice — set server-side from
  // topicRouter.ts's classification, never from raw message text length or
  // keywords. `expertiseModelOverride` is kept as the one legitimate,
  // operator-controlled (not user-content-driven) lever — a manual A/B slot
  // (e.g. Fable) against blind transcripts, now applying to the whole
  // authenticated conversation rather than just expertise-mode turns.
  const modelId = config?.modelRouting?.expertiseModelOverride ?? 'claude-sonnet-4-6';
  const maxTokens = mode === 'expertise'
    ? (config?.responseContracts?.expertise?.maxTokens ?? 500)
    : (config?.responseContracts?.matching?.maxTokens ?? 200);

  const messages: Anthropic.MessageParam[] = [...history];
  if (message !== null) {
    messages.push({ role: 'user', content: message });
  } else {
    // Opening turn: give Liam a trigger to start the conversation
    messages.push({ role: 'user', content: 'Begin the conversation.' });
  }

  // Rev 2, C3: the metered guard returns the usage and the micro-dollar cost
  // it already computed for claude_daily_spend; the route writes both to the
  // turn ledger. Same layers, same caps.
  const startedAt = Date.now();
  const { response, usage, usdMicros } = await guardClaudeCallMetered('liam_chat', modelId, () =>
    client.messages.create({
      model: modelId,
      max_tokens: maxTokens,
      system,
      messages,
    })
  );
  const latencyMs = Date.now() - startedAt;

  const block = response.content[0];
  const rawReply = block.type === 'text' ? block.text : '';

  const maxMarkers = config?.brewProfile?.maxMarkersPerTurn ?? 2;
  const { reply, actionTypes, saveRecipeTitle, rememberOps, cardMarker, recommendAlias, askKind } =
    parseAndStripMarkers(rawReply, maxMarkers);

  return {
    reply, modelUsed: modelId, actionTypes, saveRecipeTitle, rememberOps, cardMarker, recommendAlias, askKind,
    usage, usdMicros, latencyMs, answersVersion,
  };
}

export async function getRecommendation(
  archetype: string,
  decaf: boolean,
  context?: {
    secondaryArchetype?: string | null;
    confidence?: 'high' | 'medium' | 'low';
    recommendationMode?: string;
    experimental?: boolean;
  }
): Promise<string> {
  const mode = context?.recommendationMode ?? 'primary_only';
  const secondary = context?.secondaryArchetype;
  const decafNote = decaf ? ' and who prefers decaf' : '';

  const prompts: Record<string, string> = {
    primary_only:
      `Generate a confident personalized coffee recommendation for a customer whose archetype is "${archetype}"${decafNote}. Be specific about tasting notes and why this matches their profile. Keep it under 150 words.`,

    primary_plus_introduce_secondary:
      `Generate a coffee recommendation for a customer whose primary archetype is "${archetype}"${decafNote}. Their secondary archetype is "${secondary}". Recommend a coffee that fits their primary archetype, then gently introduce their secondary as a discovery option worth exploring when they're ready. Keep it under 200 words.`,

    primary_plus_active_secondary:
      `Generate a coffee recommendation for a customer whose primary archetype is "${archetype}"${decafNote}. Their secondary archetype is "${secondary}" and two independent signals confirm it is genuine. Recommend their primary coffee, then actively recommend a second specific discovery coffee for their secondary archetype — not just a hint, a real suggestion with tasting notes. Keep it under 200 words.`,

    primary_plus_note_secondary:
      `Generate a coffee recommendation for a customer whose primary archetype is "${archetype}"${decafNote}. Their secondary archetype is "${secondary}" showed up on key questions. Recommend their primary coffee confidently, and mention that their secondary archetype may be worth exploring in the future. Keep it under 200 words.`,

    primary_as_starting_point:
      `Generate a coffee recommendation for a curious, open-minded customer whose primary archetype is "${archetype}"${decafNote}. Recommend their primary coffee but frame it as a starting point — the beginning of a journey rather than a fixed destination. Keep it under 150 words.`,

    ai_agent:
      `Generate a warm, open-ended coffee recommendation for a customer whose primary archetype is "${archetype}"${decafNote}. Their signals were mixed so don't be too prescriptive. Recommend something approachable and invite them to share more about what they enjoy so you can refine the recommendation. Keep it under 150 words.`,
  };

  const content = prompts[mode] ?? prompts['primary_only'];

  // C2 Part 2 — public/anon-reachable surface (POST /api/quiz/results is
  // requireAuth-only, reachable by anonymous guest identities too — see M10).
  // Haiku, unconditionally — never content-driven, never escalated.
  const response = await guardClaudeCall('quiz_recommendation', 'claude-haiku-4-5-20251001', () =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: RECOMMENDATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    })
  );

  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

// Coffee presentation brief 1 (2026-10-23), decisions 6 and 8: the three
// content prompts read the roaster's voice (roasterVoiceReads.getRoasterVoice)
// and share one rendering of it and one set of attribution rules. The
// roaster's words lead: flavor words are the wheel nodes only (signature notes
// as the core, accent notes as "a hint of"); the roaster's sentences and portal
// answers are facts to paraphrase, never copied; every tasting claim is
// attributed to the roaster; our cupping only adds "and we tasted it too".
// Roaster-blind: the voice carries no roaster name, coffee name, origin or
// award text (awards are a yes/no), and contentGuard.looksLikeLeak checks the
// output. Cupping evidence brief 6, ruling 7 still holds: our cuppers' prose
// never reaches these prompts.
export type ContentVoice = Pick<RoasterVoice, 'descriptors' | 'remarks' | 'portal' | 'awards' | 'dimensions'>;

/** True when the voice has a word, a remark or a portal answer (the three-voice story's bar, D2). */
export function voiceHasRoasterMaterial(voice: ContentVoice): boolean {
  return voice.descriptors.some(d => d.voice !== 'customer' && d.is_signature)
    || Object.values(voice.remarks).some(list => list.length > 0)
    || portalFacts(voice).length > 0;
}

function portalFacts(voice: ContentVoice): string[] {
  const p = voice.portal;
  return [
    p.takesIt ? `How the roaster says it is drunk: ${p.takesIt === 'both' ? 'black or with milk' : p.takesIt === 'milk' ? 'with milk' : p.takesIt}` : null,
    p.brewNotes ? `The roaster's brew notes: ${p.brewNotes}` : null,
    p.anythingElse ? `Anything else the roaster added: ${p.anythingElse}` : null,
    p.roastLevel ? `Roast level: ${p.roastLevel}` : null,
    p.blendOrSingle ? `Blend or single origin: ${p.blendOrSingle}` : null,
    p.isDecaf === null ? null : `Decaf: ${p.isDecaf ? 'yes' : 'no'}`,
  ].filter((s): s is string => s !== null);
}

/** The roaster's voice as labelled prompt lines (exported for the prompt snapshot test). */
export function renderVoice(voice: ContentVoice): string {
  const roaster = voice.descriptors.filter(d => d.voice !== 'customer');
  const signature = roaster.filter(d => d.is_signature).map(d => d.descriptor);
  // accent notes, one clause per family in the order the families first appear
  const accentFamilies: Array<{ family: string; notes: string[] }> = [];
  for (const d of roaster.filter(r => !r.is_signature)) {
    const family = d.family ?? d.wheel_category ?? '';
    const group = accentFamilies.find(g => g.family === family);
    if (group) group.notes.push(d.descriptor); else accentFamilies.push({ family, notes: [d.descriptor] });
  }
  const confirmed = roaster.filter(d => d.confirmed_by_cupping).map(d => d.descriptor);
  const customers = voice.descriptors.filter(d => d.voice === 'customer').map(d => d.descriptor);
  const remarkLines = Object.entries(voice.remarks)
    .filter(([, list]) => list.length)
    .map(([topic, list]) => `  ${topic}: ${list.join(' / ')}`);
  const facts = portalFacts(voice);
  const dimLines = voice.dimensions
    .map(d => `  ${d.dimension}: ${d.avg_min} to ${d.avg_max} out of 15 (scale from ${d.scale_min_label} to ${d.scale_max_label})`);

  return [
    `The roaster's signature notes (the core of the cup, strongest first): ${signature.length ? signature.join(', ') : 'none'}`,
    `The roaster's accent notes (only "a hint of", never the core): ${accentFamilies.length ? accentFamilies.map(g => `${g.family.toLowerCase()}: ${g.notes.join(', ')}`).join('; ') : 'none'}`,
    confirmed.length ? `Of the roaster's notes, Axis & Bloom's cupping table tasted these too: ${confirmed.join(', ')}` : null,
    customers.length ? `Customers have noticed: ${customers.join(', ')}` : null,
    remarkLines.length ? `Facts from the roaster (paraphrase, do not quote):\n${remarkLines.join('\n')}` : null,
    facts.length ? `The roaster's answers on our form (facts, paraphrase, do not quote):\n${facts.map(f => `  ${f}`).join('\n')}` : null,
    `Award-winning per the roaster: ${voice.awards.count > 0 ? 'yes' : 'no'}`,
    `Structure on a 0 to 15 scale (the labels are the two extremes; a middle value is moderate):\n${dimLines.length ? dimLines.join('\n') : '  (no numeric data)'}`,
  ].filter((s): s is string => s !== null).join('\n\n');
}

const VOICE_RULES = `Rules:
- The roaster's words lead. Flavor words: only the notes listed above, never one of your own.
- The signature notes are the core of the cup; an accent note is only ever "a hint of".
- Facts from the roaster and their form answers are to be paraphrased, never copied; only the note words may appear verbatim.
- Attribute every tasting claim to the roaster ("the roaster calls it", "per the roaster", "the roaster recommends it with milk"). Where our cupping table tasted one of the roaster's notes too you may add "and we tasted it too"; never present a tasting as Axis & Bloom's own ("our cupping revealed", "we found", "our cuppers noticed" are not allowed).
- Structure (body, sweetness, acidity, bitterness, finish) may be described plainly, in proportion to the scale, without saying who measured it; never exaggerate a middle value.
- Mention customers only if a "Customers have noticed" line is given above; otherwise say nothing about customers.
- Never name the roaster, the coffee's catalog name, a farm, a country, a region or any place, even when a fact above mentions one. If it is award-winning you may say "an award-winning blend, as the roaster tells it" (or coffee); never name an award, a competition, a medal or a year.
- Never use an em dash or an en dash. Use commas, periods or colons instead.
- Never use the word "archetype", and never put a category word such as floral, fruity, balanced, earthy or chocolate & nutty in front of "coffee", "blend", "cup", "style" or "profile" ("a fruity coffee", "this balanced blend"). The notes themselves may be named as flavors.
- Mention how it is drunk (milk, black, on its own, with milk) only if "How the roaster says it is drunk" is listed above; otherwise say nothing about milk or black, even if a fact above mentions it.`;

// Coffee presentation brief 1, Dana's prod-go rules (2026-10-23): no dashes,
// no archetype as a category, milk / black only from the portal's takes_it.
// The archetype is therefore no longer passed to these three prompts, and the
// prompt text itself carries no dash.
export async function getCoffeeSummary(params: {
  coffeeName: string;
  voice: ContentVoice;
}): Promise<string> {
  const { coffeeName, voice } = params;

  const content = `Write a tasting note of 2 to 3 sentences for "${coffeeName}".

${renderVoice(voice)}

${VOICE_RULES}

Be warm and specific. Name actual flavors and textures. No marketing language. Under 80 words. If the data above is genuinely insufficient to write this honestly, respond with exactly: INSUFFICIENT_DATA`;

  // C2 Part 2 — public, unauthenticated surface (GET /api/coffees/:id/content
  // and /:id/ai-summary — see M2). Haiku, unconditionally.
  const response = await guardClaudeCall('coffee_content', 'claude-haiku-4-5-20251001', () =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: RECOMMENDATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    })
  );

  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

export async function getCoffeeSurpriseNote(params: {
  coffeeName: string;
  voice: ContentVoice;
}): Promise<string> {
  const { coffeeName, voice } = params;

  const content = `Write 1 or 2 sentences surfacing what is surprising or unusual about "${coffeeName}".

This is NOT a tasting note. It is a hook that makes a curious person want to try it. Find the most unexpected or noteworthy thing: a contradiction, an unusual characteristic, something its core notes would not lead you to expect.

${renderVoice(voice)}

${VOICE_RULES}

Be direct and editorial. Do not start with the coffee name. Do not use marketing language. Under 50 words. If the data above is genuinely insufficient to write this honestly, respond with exactly: INSUFFICIENT_DATA`;

  // C2 Part 2 — public, unauthenticated surface (see M2). Haiku, unconditionally.
  const surpriseResponse = await guardClaudeCall('coffee_content', 'claude-haiku-4-5-20251001', () =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      system: RECOMMENDATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    })
  );
  const surpriseBlock = surpriseResponse.content[0];
  return surpriseBlock.type === 'text' ? surpriseBlock.text : '';
}

// Cupping evidence brief 6, C4 (2026-10-21): the voices are the roaster's and
// customers'; our cupping is never a voice, only "and we tasted it too".
// Coffee presentation brief 1 (2026-10-23), D2: it reads the roaster's voice
// like the other two, and writes when there is at least one signature note,
// one roaster remark or one portal answer (was: two voices, or the roaster
// with a confirmed word).
export async function getCoffeeThreeVoiceStory(params: {
  coffeeName: string;
  voice: ContentVoice;
}): Promise<string | null> {
  const { coffeeName, voice } = params;
  if (!voiceHasRoasterMaterial(voice)) return null;

  const content = `Write 2 to 4 sentences narrating how "${coffeeName}" tastes to the people who know it. The roaster's notes lead; customers add what they notice.

${renderVoice(voice)}

${VOICE_RULES}

Write this as editorial storytelling, not a list. Example style: "The roaster calls it chocolate and almond with a hint of cherry, and the chocolate is one we tasted too." Under 80 words. If the data above is genuinely insufficient to write this honestly, respond with exactly: INSUFFICIENT_DATA`;

  // C2 Part 2 — public, unauthenticated surface (see M2). Haiku, unconditionally.
  const storyResponse = await guardClaudeCall('coffee_content', 'claude-haiku-4-5-20251001', () =>
    client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: RECOMMENDATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    })
  );
  const storyBlock = storyResponse.content[0];
  return storyBlock.type === 'text' ? storyBlock.text : null;
}
