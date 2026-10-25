import { describe, it, expect } from 'vitest';
import { assembleSystemPrompt, assembleSystemPromptBlocks, LIAM_BASE_PROMPT } from './claude.js';

// Liam access & cost brief, Part C1 (2026-10-01) — prompt caching must not
// change a single byte of what Liam is told. `legacyAssembleSystemPrompt`
// below is assembleSystemPrompt() exactly as it was at 2d2ae67, before the
// cache split, copied verbatim (comments trimmed) and frozen here as the
// reference. Every case asserts both the string return and the joined
// cache blocks against it.

const DEFAULT_EXPERTISE_LENGTH_INSTRUCTION =
  'Answer as short as fully answers the question — up to about 200 words when it genuinely needs that much. Never pad, never lecture past what was actually asked.';
const DEFAULT_NUMBERS_CARVEOUT =
  'Numbers, ratios, times, and temperatures are always allowed — 1:16 and 94°C are the answer, not jargon. What stays banned is the technical register: words like "percolation," "extraction yield," "TDS."';

type Params = Parameters<typeof assembleSystemPrompt>[0];

function legacyAssembleSystemPrompt(params: Params): string {
  const { session, catalogContext, mode, config, brewProfileContext, storyContext, currentCoffeeContext, profileLine } = params;
  const intentCfg = config?.intents?.[session.intent];
  const maxTurns = intentCfg?.maxTurns ?? config?.sessionLimits?.maxTurns ?? 8;

  const systemParts = [LIAM_BASE_PROMPT];

  if (mode === 'expertise' && (config?.contextAssembly?.omitCatalogInExpertiseMode ?? true)) {
    if (storyContext) {
      systemParts.push(`\n\nTheir coffee, explained:\n${storyContext}`);
    }
  } else {
    systemParts.push(`\n\n${catalogContext}`);
  }

  if (profileLine) {
    systemParts.push(`\n\n${profileLine}`);
  }

  if (currentCoffeeContext) {
    systemParts.push(`\n\nThe coffee this conversation is about: ${currentCoffeeContext}`);
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
  if (brewProfileContext) {
    systemParts.push(`\n\nWhat you know about their setup: ${brewProfileContext}`);
  }
  if (session.turnCount === maxTurns - 1) {
    systemParts.push(
      '\n\nThis is one of the final turns. Work toward a concrete recommendation or clear next step.'
    );
  }

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

const config = {
  intents: {
    MATCHED: {
      maxTurns: 8,
      systemPromptAddendum: 'Confirm one clear pick, then ask one new-information question.',
      conversationGoal: 'Land one pick they agree with.',
    },
  },
  sessionLimits: { maxTurns: 8 },
  // Liam sees everything brief Rev 2 (2026-10-24) flipped this key's default
  // to false. The frozen legacy reference above assumed the old default
  // (omit), so the byte-identity cases pin it explicitly: a live config that
  // still says true renders exactly the pre-cache bytes.
  contextAssembly: { omitCatalogInExpertiseMode: true },
} as unknown as Params['config'];

const CATALOG = 'Catalog for this conversation:\n- Crosshatch [primary]: dark chocolate, cedar\n- Uganda [palate match]: cocoa, raisin';
const STORY = 'Crosshatch is roasted in small batches; washed, from 1,800 m.';
const PROFILE = 'ABOUT THIS CUSTOMER\nMatch: Chocolate & Nutty (quiz only)';
const CURRENT = 'Crosshatch, on their V60 card (1:16, medium-fine, 94°C)';

function joined(params: Params): string {
  return assembleSystemPromptBlocks(params).map(b => b.text).join('');
}

const cases: Array<[string, Params]> = [];
for (const mode of ['matching', 'expertise'] as const) {
  for (const profileLine of [undefined, PROFILE]) {
    for (const currentCoffeeContext of [undefined, CURRENT]) {
      for (const turnCount of [0, 3, 7]) {
        for (const storyContext of mode === 'expertise' ? [undefined, STORY] : [undefined]) {
          const label = `${mode}, profile=${!!profileLine}, current=${!!currentCoffeeContext}, turn=${turnCount}${mode === 'expertise' ? `, story=${!!storyContext}` : ''}`;
          cases.push([label, {
            session: { intent: 'MATCHED', turnCount, openingContext: 'Millennial register.' },
            catalogContext: CATALOG,
            mode,
            config,
            profileLine,
            currentCoffeeContext,
            storyContext,
            brewProfileContext: turnCount === 3 ? 'V60, takes it black' : undefined,
          }]);
        }
      }
    }
  }
}

describe('assembleSystemPrompt — byte-for-byte unchanged by the cache split (Part C1)', () => {
  it.each(cases)('%s', (_label, params) => {
    const legacy = legacyAssembleSystemPrompt(params);
    expect(assembleSystemPrompt(params)).toBe(legacy);
    expect(joined(params)).toBe(legacy);
  });

  it('holds with no config at all (fallback defaults)', () => {
    const params: Params = { session: { intent: 'EXPLORATION', turnCount: 0, openingContext: '' }, catalogContext: CATALOG, mode: 'matching', config: null as unknown as Params['config'] };
    expect(joined(params)).toBe(legacyAssembleSystemPrompt(params));
  });
});

describe('assembleSystemPromptBlocks — breakpoints (Part C1)', () => {
  const matching: Params = {
    session: { intent: 'MATCHED', turnCount: 2, openingContext: 'x' },
    catalogContext: CATALOG, mode: 'matching', config, profileLine: PROFILE,
  };

  // Liam sees everything brief Rev 2 (2026-10-24) re-tiered the prompt: the
  // catalog joined the base prompt in the shared tier (one cache entry for
  // every customer) and the profile line (now the full ABOUT THIS CUSTOMER
  // block) moved from 'turn' to 'session'. The four layout tests below were
  // rewritten to that layout; the byte-identity cases above are unchanged.
  it('matching: base prompt + catalog (shared), then the profile (session), each with a breakpoint; the rest uncached', () => {
    const blocks = assembleSystemPromptBlocks(matching);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: 'text', text: `${LIAM_BASE_PROMPT}\n\n${CATALOG}`, cache_control: { type: 'ephemeral' } });
    expect(blocks[1]).toEqual({ type: 'text', text: `\n\n${PROFILE}`, cache_control: { type: 'ephemeral' } });
    expect(blocks[2].cache_control).toBeUndefined();
  });

  it('the shared prefix never changes between turns; the session block only when a fact does', () => {
    const turn1 = assembleSystemPromptBlocks({ ...matching, session: { ...matching.session, turnCount: 1 } });
    const turn7same = assembleSystemPromptBlocks({ ...matching, session: { ...matching.session, turnCount: 7 }, brewProfileContext: 'V60' });
    const turn7fact = assembleSystemPromptBlocks({ ...matching, session: { ...matching.session, turnCount: 7 }, profileLine: `${PROFILE}\nOpen thread: asked on turn 2` });
    expect(turn7same.slice(0, 2)).toEqual(turn1.slice(0, 2));
    expect(turn7fact[0]).toEqual(turn1[0]);
    expect(turn7fact[1].text).not.toBe(turn1[1].text);
  });

  it('expertise without a story (a config that still omits the catalog): base prompt shared, profile session', () => {
    const blocks = assembleSystemPromptBlocks({ ...matching, mode: 'expertise' });
    expect(blocks.map(b => !!b.cache_control)).toEqual([true, true, false]);
    expect(blocks[0].text).toBe(LIAM_BASE_PROMPT);
  });

  it('expertise with a story: the story leads the session block', () => {
    const blocks = assembleSystemPromptBlocks({ ...matching, mode: 'expertise', storyContext: STORY });
    expect(blocks[1]).toEqual({ type: 'text', text: `\n\nTheir coffee, explained:\n${STORY}\n\n${PROFILE}`, cache_control: { type: 'ephemeral' } });
  });

  it('never sends a whitespace-only block (empty catalog folds into the block before it)', () => {
    const params: Params = { session: { intent: 'NONE', turnCount: 2, openingContext: '' }, catalogContext: '', mode: 'matching', config: null as unknown as Params['config'] };
    const blocks = assembleSystemPromptBlocks(params);
    for (const b of blocks) expect(b.text.trim().length).toBeGreaterThan(0);
    expect(blocks.map(b => b.text).join('')).toBe(legacyAssembleSystemPrompt(params));
  });
});
