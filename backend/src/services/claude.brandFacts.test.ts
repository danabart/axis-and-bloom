// Liam brand answers brief Rev 3, Testing 1 + 6 (2026-10-24) — the brand facts
// block (A4) and the turn-limit nudges (C2), on the pure assembly. The
// byte-identity guarantee: brandFacts disabled, or an empty table, renders
// exactly the prompt without the block (claude.cache.test.ts keeps the frozen
// pre-cache reference for everything else).
import { describe, it, expect } from 'vitest';
import { assembleSystemPrompt, assembleSystemPromptBlocks, renderBrandAnswersBlock, LIAM_BASE_PROMPT } from './claude.js';
import { DEFAULT_SOMMELIER_CONFIG, missingKeyPaths } from '../db/seeds/sommelier_config_seed.js';

type Params = Parameters<typeof assembleSystemPrompt>[0];
type Config = Params['config'];

const ROWS = [
  { delivery: 'prefix', answer_text: 'Axis & Bloom is a flavor intelligence platform, not a roastery.' },
  { delivery: 'lookup', answer_text: 'A lookup-only answer the prompt never carries.' },
  { delivery: 'both', answer_text: 'We do not roast. Our bags, their roasting.' },
];
const RULES = ['Speak only from the brand facts above.', 'Never name a partner roastery.'];

const config = (over: Record<string, unknown> = {}) =>
  JSON.parse(JSON.stringify({ ...DEFAULT_SOMMELIER_CONFIG, ...over })) as Config;

const params = (cfg: Config, extra: Partial<Params> = {}): Params => ({
  session: { intent: 'MATCHED', turnCount: 3, openingContext: '' },
  catalogContext: 'YOUR CURRENT CATALOG — test',
  mode: 'matching',
  config: cfg,
  profileLine: 'ABOUT THIS CUSTOMER: test',
  ...extra,
});

describe('renderBrandAnswersBlock', () => {
  it('renders only prefix/both rows, in the order given, then the rules', () => {
    expect(renderBrandAnswersBlock(ROWS, RULES)).toBe([
      'WHAT YOU KNOW ABOUT AXIS & BLOOM (the only brand facts you may state):',
      '- Axis & Bloom is a flavor intelligence platform, not a roastery.',
      '- We do not roast. Our bags, their roasting.',
      'Rules:',
      '- Speak only from the brand facts above.',
      '- Never name a partner roastery.',
    ].join('\n'));
  });

  it('is empty with no prefix/both rows (an empty table = no block)', () => {
    expect(renderBrandAnswersBlock([], RULES)).toBe('');
    expect(renderBrandAnswersBlock([ROWS[1]], RULES)).toBe('');
  });

  it('carries no timestamp, counter or version: two renders of the same rows are identical', () => {
    expect(renderBrandAnswersBlock(ROWS, RULES)).toBe(renderBrandAnswersBlock(ROWS.map(r => ({ ...r })), [...RULES]));
    expect(renderBrandAnswersBlock(ROWS, RULES)).not.toMatch(/\d{4}-\d{2}-\d{2}|version/i);
  });
});

describe('assembleSystemPrompt — brand facts block (A4)', () => {
  const block = renderBrandAnswersBlock(ROWS, RULES);
  const without = assembleSystemPrompt(params(config()));

  it('byte-identical when brandFacts is disabled, even with a block passed', () => {
    const cfg = config({ brandFacts: { ...DEFAULT_SOMMELIER_CONFIG.brandFacts, enabled: false } });
    expect(assembleSystemPrompt(params(cfg, { brandAnswersBlock: block }))).toBe(assembleSystemPrompt(params(cfg)));
    expect(assembleSystemPrompt(params(cfg, { brandAnswersBlock: block }))).toBe(without);
  });

  it('byte-identical when the table is empty (empty block)', () => {
    expect(assembleSystemPrompt(params(config(), { brandAnswersBlock: '' }))).toBe(without);
    expect(assembleSystemPrompt(params(config(), { brandAnswersBlock: renderBrandAnswersBlock([], RULES) }))).toBe(without);
  });

  it('byte-identical for a live config that has no brandFacts key yet', () => {
    const { brandFacts: _omit, ...rest } = config() as unknown as Record<string, unknown>;
    expect(assembleSystemPrompt(params(rest as unknown as Config, { brandAnswersBlock: block }))).toBe(without);
  });

  it('enabled: appears once, right after LIAM_BASE_PROMPT, in the shared (first cached) block', () => {
    const p = params(config(), { brandAnswersBlock: block });
    const text = assembleSystemPrompt(p);
    expect(text.split('WHAT YOU KNOW ABOUT AXIS & BLOOM').length - 1).toBe(1);
    expect(text.startsWith(`${LIAM_BASE_PROMPT}\n\n${block}\n\n`)).toBe(true);
    expect(text).not.toContain('A lookup-only answer');
    const blocks = assembleSystemPromptBlocks(p);
    // Liam sees everything brief Rev 2: the shared block continues with the
    // catalog block, and its marker takes promptCache.sharedTtl ('1h' seed).
    expect(blocks[0].text).toBe(`${LIAM_BASE_PROMPT}\n\n${block}\n\n${p.catalogContext}`);
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(blocks.map(b => b.text).join('')).toBe(text);
  });

  it('the shared block is identical across customers and turns (the cache prefix holds)', () => {
    const a = assembleSystemPromptBlocks(params(config(), { brandAnswersBlock: block }))[0].text;
    const b = assembleSystemPromptBlocks(params(config(), {
      brandAnswersBlock: block, profileLine: 'ABOUT THIS CUSTOMER: someone else', session: { intent: 'EXPLORATION', turnCount: 0, openingContext: 'x' },
    }))[0].text;
    expect(a).toBe(b);
  });
});

describe('assembleSystemPrompt — turn-limit nudges (C2)', () => {
  const cfg = config(); // seed: maxTurns 16 (MATCHED too), closingTurns 2
  const nudges = DEFAULT_SOMMELIER_CONFIG.sessionLimits.nudges;
  const at = (turnCount: number, c: Config = cfg) => assembleSystemPrompt(params(c, { session: { intent: 'MATCHED', turnCount, openingContext: '' } }));

  it('no nudge before the closing window', () => {
    for (const t of [0, 5, 13]) {
      expect(at(t)).not.toContain(nudges.closing.slice(0, 30));
      expect(at(t)).not.toContain(nudges.last.slice(0, 30));
    }
  });

  it('reply 15 of 16 gets the closing nudge with n filled in; reply 16 gets the last nudge', () => {
    expect(at(14)).toContain('This conversation has 2 replies left.');
    expect(at(14)).not.toContain(nudges.last);
    expect(at(15)).toContain(nudges.last);
    expect(at(15)).toContain('Do not ask a question.');
    expect(at(15)).not.toContain('replies left');
  });

  it('closingTurns 1 = only the last nudge; closingTurns 0 = none', () => {
    const one = config({ sessionLimits: { ...DEFAULT_SOMMELIER_CONFIG.sessionLimits, closingTurns: 1 } });
    expect(at(14, one)).not.toContain('replies left');
    expect(at(15, one)).toContain(nudges.last);
    const zero = config({ sessionLimits: { ...DEFAULT_SOMMELIER_CONFIG.sessionLimits, closingTurns: 0 } });
    expect(at(15, zero)).not.toContain(nudges.last);
  });

  it('a live config without nudges keeps the pre-Rev-3 single sentence on the last turn only', () => {
    const legacy = config({ sessionLimits: { maxTurns: 8 } });
    const old = 'This is one of the final turns. Work toward a concrete recommendation or clear next step.';
    const legacyMatched = config({ sessionLimits: { maxTurns: 8 }, intents: { ...DEFAULT_SOMMELIER_CONFIG.intents, MATCHED: { ...DEFAULT_SOMMELIER_CONFIG.intents.MATCHED, maxTurns: 8 } } });
    expect(at(7, legacyMatched)).toContain(old);
    expect(at(6, legacyMatched)).not.toContain(old);
    expect(at(15, legacy)).toContain(old); // MATCHED's own 16 shadows the global 8
  });
});

describe('applyMissingKeys — missingKeyPaths', () => {
  it('adds every seed leaf of the new subtrees the live doc lacks, and nothing that exists', () => {
    const live = { sessionLimits: { maxTurns: 8 }, intents: {} };
    // Brief Rev 3's own subtrees (brandFacts + the session-limit keys); Liam
    // sees everything Rev 2 adds catalogBlock / customerBlock / promptCache and
    // brandFacts.supportContact, covered in liamSeesEverything.test.ts.
    const rev3 = missingKeyPaths(DEFAULT_SOMMELIER_CONFIG, live)
      .filter(p => /^(brandFacts|sessionLimits)\./.test(p) && p !== 'brandFacts.supportContact');
    expect(rev3.sort()).toEqual([
      'brandFacts.cacheSeconds', 'brandFacts.enabled', 'brandFacts.rules',
      'sessionLimits.closingTurns', 'sessionLimits.customerCopy.closedNotice', 'sessionLimits.customerCopy.limitNotice',
      'sessionLimits.nudges.closing', 'sessionLimits.nudges.last', 'sessionLimits.warnAtTurnsRemaining',
    ]);
  });

  it('never touches an existing key: maxTurns stays live, a live-edited rule list stays', () => {
    const live = { sessionLimits: { maxTurns: 8, warnAtTurnsRemaining: 5 }, brandFacts: { enabled: false, rules: ['Dana edit'] } };
    const paths = missingKeyPaths(DEFAULT_SOMMELIER_CONFIG, live);
    expect(paths).not.toContain('sessionLimits.maxTurns');
    expect(paths).not.toContain('sessionLimits.warnAtTurnsRemaining');
    expect(paths).not.toContain('brandFacts.enabled');
    expect(paths).not.toContain('brandFacts.rules');
    expect(paths).toContain('brandFacts.cacheSeconds');
  });

  it('is a no-op once applied', () => {
    expect(missingKeyPaths(DEFAULT_SOMMELIER_CONFIG, DEFAULT_SOMMELIER_CONFIG)).toEqual([]);
  });

  it('customer copy carries no number (no counter)', () => {
    for (const s of Object.values(DEFAULT_SOMMELIER_CONFIG.sessionLimits.customerCopy)) expect(s).not.toMatch(/\d/);
  });
});
