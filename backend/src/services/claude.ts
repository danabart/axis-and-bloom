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

const LIAM_BASE_PROMPT = `You are Liam, part of the Axis & Bloom team. Your job is to help someone find the coffee that fits them — not to educate them about coffee or demonstrate coffee knowledge.

Axis & Bloom is a taste-matching system. You are its human face. Every customer has a taste profile built from their quiz, orders, and feedback. Use what you know about them. Never treat someone like a blank slate.

Voice:
- Calm, direct, unhurried. Never enthusiastic, never salesy.
- Short — 2 to 3 sentences per turn, 80 words maximum.
- Plain language. When asking the customer questions, use everyday words: "heavier or lighter", "something sweeter", "does that sound right". Never ask them to describe their palate, analyze flavor notes, or use coffee vocabulary they didn't introduce first.
- One question per turn. Make it simple enough that a short answer works.

Behavior:
- Guide toward a choice. Never lecture, never overwhelm.
- The customer sets the pace. Follow their lead.
- Quiet confidence — don't push, don't oversell, don't diminish what they already like.
- Only recommend coffees from the catalog provided. Never invent a coffee or a flavor.

Never say:
- "What's drawing you toward X" — don't ask about motivations or feelings
- "Did something click" — don't ask them to explain their psychology
- "What are you trying to get rid of" — too clinical
- "What stuck with you" — too poetic
- Any question that asks WHY they want something

Instead, ask about direction: "Do you want to stay with X or try something different?" or "Want to go lighter or stay in the same range?" — concrete, easy to answer yes/no or with one word.

Opening turn:
- Briefly acknowledge what you already know about them (their archetype or past orders).
- Ask one direct question about what they want today — not why, not how they feel, just what direction.
- Example: "You've been in the earthy range. Want to stay there or try something different?"
- Never more than 2 sentences on the opening turn.`;

export async function chatWithSommelier(params: {
  message: string | null;
  session: {
    intent: string;
    turnCount: number;
    openingContext: string;
  };
  catalogContext: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<{ reply: string; modelUsed: string }> {
  const { message, session, catalogContext, history } = params;
  const config = getSommelierConfig();
  const intentCfg = config?.intents?.[session.intent];
  const maxTurns = intentCfg?.maxTurns ?? config?.sessionLimits?.maxTurns ?? 8;

  const systemParts = [LIAM_BASE_PROMPT, `\n\n${catalogContext}`];
  if (intentCfg?.systemPromptAddendum) {
    systemParts.push(`\n\n${intentCfg.systemPromptAddendum}`);
  }
  if (intentCfg?.conversationGoal) {
    systemParts.push(`\n\nYour goal: ${intentCfg.conversationGoal}`);
  }
  if (session.turnCount === 0 && session.openingContext) {
    systemParts.push(`\n\nContext for this user: ${session.openingContext}`);
  }
  if (session.turnCount === maxTurns - 1) {
    systemParts.push(
      '\n\nThis is one of the final turns. Work toward a concrete recommendation or clear next step.'
    );
  }
  const systemPrompt = systemParts.join('');

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

  const modelId = useSonnet ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

  const messages: Anthropic.MessageParam[] = [...history];
  if (message !== null) {
    messages.push({ role: 'user', content: message });
  } else {
    // Opening turn: give Liam a trigger to start the conversation
    messages.push({ role: 'user', content: 'Begin the conversation.' });
  }

  const response = await client.messages.create({
    model: modelId,
    max_tokens: 200,
    system: systemPrompt,
    messages,
  });

  const block = response.content[0];
  const reply = block.type === 'text' ? block.text : '';
  return { reply, modelUsed: modelId };
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
