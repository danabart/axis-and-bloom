import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are the Axis & Bloom coffee assistant — a knowledgeable, warm, and precise guide for specialty coffee lovers.

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

export async function chatWithAgent(
  message: string,
  context: {
    archetype?: string;
    previousMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    decaf?: boolean;
  }
): Promise<string> {
  const contextNote = context.archetype
    ? `\n\nUser's archetype: ${context.archetype}${context.decaf ? ' (prefers decaf)' : ''}`
    : '';

  const messages: Anthropic.MessageParam[] = [
    ...(context.previousMessages ?? []).slice(-10),
    { role: 'user', content: message + contextNote },
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages,
  });

  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
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
    system: SYSTEM_PROMPT,
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
    system: SYSTEM_PROMPT,
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
    system: SYSTEM_PROMPT,
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
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });
  const storyBlock = storyResponse.content[0];
  return storyBlock.type === 'text' ? storyBlock.text : null;
}
