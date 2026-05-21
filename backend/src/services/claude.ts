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

export async function getRecommendation(archetype: string, decaf: boolean): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Generate a personalized coffee recommendation for a customer whose archetype is "${archetype}"${decaf ? ' and who prefers decaf' : ''}. Be specific about tasting notes and why this matches their profile. Keep it under 150 words.`,
    }],
  });

  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}
