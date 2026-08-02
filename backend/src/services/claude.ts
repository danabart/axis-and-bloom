import Anthropic from '@anthropic-ai/sdk';
import { getSommelierConfig } from './sommelierConfig.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RECOMMENDATION_SYSTEM_PROMPT = `You are the Axis & Bloom coffee assistant — a knowledgeable, warm, and precise guide for specialty coffee lovers.

Axis & Bloom is a personalized coffee brand that matches customers to their ideal coffee archetype through a flavor quiz. The six archetypes are:
- Floral: jasmine, bergamot, tea-like, light body
- Fruity: berry, stone fruit, bright acidity, juicy
- Balanced & Sweet: caramel, honey, milk chocolate, round body
- Chocolate & Nutty: dark chocolate, roasted nuts, heavy body
- Spicy & Earthy: cinnamon, tobacco, cedar, syrupy body
- Experimental: wild fermentation, tropical fruit, unique processing

Your role:
1. RECOMMENDER: When a user shares their archetype or preferences, recommend specific coffees from our catalog.
2. ASSISTANT: Answer questions about brewing, flavor, coffee origins, or the Axis & Bloom ordering process.

Always be concise, warm, and specific. If you recommend a coffee, explain WHY it matches their taste. Keep responses under 200 words unless the question warrants more detail.`;

const LIAM_BASE_PROMPT = `You are Liam — Axis & Bloom's coffee sommelier. Your purpose is intimacy and precision: you know this customer, and your recommendations are specific to them, not generic.

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

Guardrails:
- Caffeine and health: share only general, well-established facts. Never give personal health advice — that includes anything about medication, pregnancy, or children. Defer warmly to a doctor or pharmacist for those specifically.
  Right: "Decaf still has a small amount of caffeine — it's not zero." Then, if it's medical: "That one's really worth asking your doctor about."
  Wrong: giving a specific caffeine-safety verdict for someone's medication, pregnancy, or child.
- Equipment: speak in categories — what actually matters in a grinder, when an upgrade changes the cup. Never specific current models or prices. You're a sommelier, not a shopping assistant.
- Origins: speak only from what's actually in front of you — the catalog and story content provided. Never invent a farm, region, or process detail that isn't there. When you don't have detail on a coffee the customer actually named, never assert that it's absent — offer what you do have instead.
  Good: "I don't have that one's full story in front of me — want the short version of the [coffee you do have]?"
  Bad: "Kenya's not in the catalog I'm working from right now." Never say a coffee "isn't in the catalog," "isn't in my system," or any other phrasing that denies the coffee itself — a missing detail is not the same as a missing coffee.

Action markers (internal — never mention, explain, or hint at these to the customer):
- If you've concluded a retake is the right move — real archetype doubt or taste drift, never as a placeholder while you're still asking questions — end your reply with <<action:retake_quiz>> after your normal words.
- If you're pointing them to a different position within their own archetype rather than a full retake — bolder, lighter, a different slot — end your reply with <<action:open_dial>> the same way.
- If the reply you just wrote is a preparation recipe or brew guide the customer actually asked for — not a passing mention of brewing — end your reply with <<action:save_recipe:short title>> the same way, where the short title is two to six plain words naming the method and, when you know it, the coffee — like "V60 for Cerro Azul" or "Cold brew, overnight jar". Never preemptively, never on a greeting or general chat.
- Use at most one marker per turn. Never use one in your opening turn. Only use one once you've actually reached the recommendation (or, for save_recipe, actually written the recipe), not preemptively.
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
- These tokens are stripped before the customer ever sees your reply, exactly like action markers.

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

// Pure system-prompt assembly (HOME_TASK_2) — split out of chatWithSommelier so
// it's directly testable without hitting the Anthropic API. Matching mode's
// output must stay byte-for-byte identical to the pre-HOME_TASK_2 assembly
// (aside from the deliberate guardrail sentences now in LIAM_BASE_PROMPT above).
export function assembleSystemPrompt(params: {
  session: { intent: string; turnCount: number; openingContext: string };
  catalogContext: string;
  mode: SommelierMode;
  config: ReturnType<typeof getSommelierConfig>;
  brewProfileContext?: string;
  storyContext?: string;
}): string {
  const { session, catalogContext, mode, config, brewProfileContext, storyContext } = params;
  const intentCfg = config?.intents?.[session.intent];
  const maxTurns = intentCfg?.maxTurns ?? config?.sessionLimits?.maxTurns ?? 8;

  const systemParts = [LIAM_BASE_PROMPT];

  // Mode-aware context assembly (§4.6) — the frozen catalog block has no
  // business in a knowledge-dominant turn. Assembly-time only: this never
  // re-queries the RAG/story data, it just chooses what's already in
  // context_data (§4.4, HOME_TASK_5) — the caller (sommelier.ts) decides
  // *whether* a story is relevant this turn (my_coffee/origins_process
  // topics only); this function just injects it, mechanically, when given one.
  if (mode === 'expertise' && (config?.contextAssembly?.omitCatalogInExpertiseMode ?? true)) {
    if (storyContext) {
      // The story layer replaces raw origin/catalog fields for exactly the
      // topics that ask about the customer's own coffee — never invented,
      // only what's in the published story (§4.4's "speak only from provided
      // story/catalog context" guardrail, already in LIAM_BASE_PROMPT above).
      systemParts.push(`\n\nTheir coffee, explained:\n${storyContext}`);
    }
    // No story available and no "current coffee" concept exists yet (arrives
    // with brew cards, HOME_TASK_6) — nothing to inject, the omit branch.
  } else {
    systemParts.push(`\n\n${catalogContext}`);
  }

  if (intentCfg?.systemPromptAddendum) {
    systemParts.push(`\n\n${intentCfg.systemPromptAddendum}`);
  }
  if (intentCfg?.conversationGoal) {
    systemParts.push(`\n\nYour goal: ${intentCfg.conversationGoal}`);
  }
  if (session.turnCount === 0 && session.openingContext) {
    systemParts.push(`\n\nContext for this user: ${session.openingContext}`);
  }
  // HOME_TASK_4 (§4.5, §3.5) — the brew profile, every turn (not just the
  // opening one), only when non-empty. Absent/empty produces zero difference
  // in the assembled prompt — this is the byte-for-byte guarantee's whole point.
  if (brewProfileContext) {
    systemParts.push(`\n\nWhat you know about their setup: ${brewProfileContext}`);
  }
  if (session.turnCount === maxTurns - 1) {
    systemParts.push(
      '\n\nThis is one of the final turns. Work toward a concrete recommendation or clear next step.'
    );
  }

  // Expertise contract (§4.2) — appended last, only for knowledge-dominant
  // turns. Matching mode's own length rule stays where it's always lived, in
  // LIAM_BASE_PROMPT's Tone section, untouched.
  if (mode === 'expertise') {
    const contract = config?.responseContracts?.expertise;
    const lengthInstruction = contract?.lengthInstruction ?? DEFAULT_EXPERTISE_LENGTH_INSTRUCTION;
    const numbersCarveout = contract?.numbersCarveout ?? DEFAULT_NUMBERS_CARVEOUT;
    systemParts.push(
      `\n\nThis turn is a knowledge question, not a matching turn. ${lengthInstruction} ${numbersCarveout}`
    );
  }

  return systemParts.join('');
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
}): Promise<{
  reply: string;
  modelUsed: string;
  actionTypes: Array<'retake_quiz' | 'open_dial' | 'save_recipe'>;
  /** Profile Part 7B — sanitized title from a titled save_recipe marker, if present. */
  saveRecipeTitle?: string;
  rememberOps: Array<{ field: string; rawValue: string }>;
}> {
  const { message, session, catalogContext, history, brewProfileContext, storyContext } = params;
  const mode: SommelierMode = params.mode ?? 'matching';
  const config = getSommelierConfig();

  const systemPrompt = assembleSystemPrompt({ session, catalogContext, mode, config, brewProfileContext, storyContext });

  let modelId: string;
  let maxTokens: number;

  if (mode === 'expertise') {
    // Model policy (§4.7) — a detected knowledge topic always routes to the
    // expertise model, regardless of keywords/length. `expertiseModelOverride`
    // is a manual A/B slot (e.g. Fable), null means the Sonnet default.
    modelId = config?.modelRouting?.expertiseModelOverride ?? 'claude-sonnet-4-6';
    maxTokens = config?.responseContracts?.expertise?.maxTokens ?? 500;
  } else {
    // Matching mode — today's routing, untouched.
    const sonnetKeywords: string[] = config?.modelRouting?.sonnetKeywords ?? [
      'recommend', 'suggest', 'compare', 'difference', 'explain', 'why',
    ];
    const sonnetMinWords: number = config?.modelRouting?.sonnetMinMessageWords ?? 20;

    let useSonnet = false;
    if (message) {
      const wordCount = message.trim().split(/\s+/).length;
      if (wordCount >= sonnetMinWords) useSonnet = true;
      if (!useSonnet) {
        const lower = message.toLowerCase();
        useSonnet = sonnetKeywords.some((kw) => lower.includes(kw.toLowerCase()));
      }
    }

    modelId = useSonnet ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';
    maxTokens = config?.responseContracts?.matching?.maxTokens ?? 200;
  }

  const messages: Anthropic.MessageParam[] = [...history];
  if (message !== null) {
    messages.push({ role: 'user', content: message });
  } else {
    // Opening turn: give Liam a trigger to start the conversation
    messages.push({ role: 'user', content: 'Begin the conversation.' });
  }

  const response = await client.messages.create({
    model: modelId,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });

  const block = response.content[0];
  const rawReply = block.type === 'text' ? block.text : '';

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
  const maxMarkers = config?.brewProfile?.maxMarkersPerTurn ?? 2;
  const rememberOps: Array<{ field: string; rawValue: string }> = [];
  const rememberRegex = /<<remember:([a-zA-Z_]+)=([^>]*)>>/g;
  let rememberMatch: RegExpExecArray | null;
  while ((rememberMatch = rememberRegex.exec(rawReply)) !== null) {
    if (rememberOps.length < maxMarkers) {
      rememberOps.push({ field: rememberMatch[1], rawValue: rememberMatch[2] });
    }
  }

  const reply = rawReply
    .replace(/<<action:[^>]*>>/g, '')
    .replace(/<<remember:[^>]*>>/g, '')
    .replace(/[ \t]+(\n|$)/g, '$1')
    .trim();

  return { reply, modelUsed: modelId, actionTypes, saveRecipeTitle, rememberOps };
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

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: RECOMMENDATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

export async function getCoffeeSummary(params: {
  coffeeName: string;
  archetype: string | null;
  dimensions: Array<{ dimension: string; avg_min: number; avg_max: number; scale_min_label: string; scale_max_label: string }>;
  topDescriptors: string[];
  overallNotes: string | null;
}): Promise<string> {
  const { coffeeName, archetype, dimensions, topDescriptors, overallNotes } = params;

  const dimLines = dimensions
    .map(d => `  ${d.dimension}: ${d.avg_min}–${d.avg_max}/15 (${d.scale_min_label} → ${d.scale_max_label})`)
    .join('\n');

  const content = `Write a 2–3 sentence tasting note for "${coffeeName}"${archetype ? `, a ${archetype} coffee` : ''}.

Cupping data:
${dimLines || '  (no numeric data)'}

Top flavor descriptors: ${topDescriptors.length ? topDescriptors.join(', ') : 'none recorded'}
${overallNotes ? `\nCupper's notes: "${overallNotes}"` : ''}

Be warm and specific. Name actual flavors and textures. No marketing language. Under 80 words.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: RECOMMENDATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

export async function getCoffeeSurpriseNote(params: {
  coffeeName: string;
  archetype: string | null;
  dimensions: Array<{ dimension: string; avg_min: number; avg_max: number; scale_min_label: string; scale_max_label: string }>;
  topDescriptors: string[];
  overallNotes: string | null;
}): Promise<string> {
  const { coffeeName, archetype, dimensions, topDescriptors, overallNotes } = params;
  const dimLines = dimensions
    .map(d => `  ${d.dimension}: ${d.avg_min}–${d.avg_max}/15 (${d.scale_min_label} → ${d.scale_max_label})`)
    .join('\n');

  const content = `Write 1–2 sentences surfacing what is surprising or unusual about "${coffeeName}"${archetype ? ` (${archetype} archetype)` : ''}.

This is NOT a tasting note. It is a hook that makes a curious person want to try it. Find the most unexpected or noteworthy thing — a contradiction, an unusual characteristic, something that defies the archetype.

Cupping dimensions:
${dimLines || '  (no numeric data)'}
Top flavor descriptors: ${topDescriptors.length ? topDescriptors.join(', ') : 'none recorded'}${overallNotes ? `\nCupper's notes: "${overallNotes}"` : ''}

Be direct and editorial. Do not start with the coffee name. Do not use marketing language. Under 50 words.`;

  const surpriseResponse = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    system: RECOMMENDATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });
  const surpriseBlock = surpriseResponse.content[0];
  return surpriseBlock.type === 'text' ? surpriseBlock.text : '';
}

export async function getCoffeeThreeVoiceStory(params: {
  coffeeName: string;
  sourceData: Array<{ source: 'internal' | 'roastery' | 'client'; descriptors: string[] }>;
}): Promise<string | null> {
  const { coffeeName, sourceData } = params;
  if (sourceData.length < 2) return null;

  const SOURCE_NAME: Record<string, string> = {
    internal: 'Our cupping team',
    roastery: 'The roaster',
    client:   'Customers',
  };
  const lines = sourceData
    .map(s => `  ${SOURCE_NAME[s.source] ?? s.source}: ${s.descriptors.join(', ')}`)
    .join('\n');

  const content = `Write 2–4 sentences narrating how the flavor sources see "${coffeeName}". Where do they agree? Where do they diverge?

${lines}

Write this as editorial storytelling — not a list. Name the agreement and divergence naturally. Example style: "Our team kept coming back to blueberry and black tea. The roaster's bag notes said stone fruit and floral — closer than it sounds. Customers have been landing on citrus." Under 80 words.`;

  const storyResponse = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: RECOMMENDATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });
  const storyBlock = storyResponse.content[0];
  return storyBlock.type === 'text' ? storyBlock.text : null;
}
