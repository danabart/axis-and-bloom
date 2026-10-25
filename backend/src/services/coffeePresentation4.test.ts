// Coffee presentation brief 4 (2026-10-24), the pure half: the card teaser
// (decision 1, the frontend copy loaded by path), masking (decision 3), the
// brew rule (decision 4) and the prompts that carry them. No database: the
// Anthropic SDK and the spend guard are mocked to capture prompts. The lookup,
// tags and loader halves are in src/db/coffeePresentation4.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const h = vi.hoisted(() => ({ prompts: [] as string[], replies: [] as string[] }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (req: { messages: Array<{ content: string }> }) => {
        h.prompts.push(req.messages[0].content);
        return { content: [{ type: 'text', text: h.replies.shift() ?? 'The roaster calls it hazelnut.' }] };
      },
    };
  },
}));
vi.mock('./anthropicGuard.js', () => ({
  guardClaudeCall: (_feature: string, _model: string, fn: () => unknown) => fn(),
  isClaudeGuardBlocked: () => false,
}));

const guard = await import('./contentGuard.js');
const { maskTokens, maskCount, bannedTokensFor, looksLikeLeak, looksLikeInventedBrew, generateWithLeakGuard, MASK } = guard;
const { renderVoice } = await import('./claude.js');
const { generateCoffeeStoryWithRetry, buildStoryPrompt } = await import('./storyLayer.js');

const FRONTEND = path.resolve(process.cwd(), '..', 'frontend', 'src', 'app');
const line = await import(pathToFileURL(path.join(FRONTEND, 'lib', 'signatureLine.ts')).href);

beforeEach(() => { h.prompts.length = 0; h.replies.length = 0; });

// fixture values (never the real roaster's)
const ROASTER = 'Zzz Fixture Roasters';
const RAW_NAME = 'Zzz Stripe Espresso';
const AWARD = '2023 Golden Bean medal';
// fixture brew labels, standing in for lookup roastery_portal_brew_method
const BREW_LABELS = ['Pour-over', 'Batch brew / drip', 'Espresso', 'French press', 'Zzzpresso'];

const NO_REMARKS = { general: [] as string[], brewing: [] as string[], roast: [] as string[], process: [] as string[] };
const NO_PORTAL = { bestBrew: null as string | null, alsoGoodBrews: [] as string[], brewNotes: null, anythingElse: null, takesIt: null };

describe('card teaser (decision 1)', () => {
  const r = (descriptor: string, is_signature: boolean, family = 'F') => ({ descriptor, family, is_signature });

  it('signature first, then the accents by name as a clause', () => {
    expect(line.teaserFor([r('Hazelnut', true), r('Citrus Fruit', false), r('Cinnamon', false)])).toBe('Hazelnut, with citrus fruit and cinnamon');
    expect(line.teaserFor([r('Coconut', true), r('Caramelized', false), r('Chocolate', false)])).toBe('Coconut, with caramelized and chocolate');
    expect(line.teaserFor([r('Chocolate', true), r('Almond', true), r('Cherry', false), r('Apple', false), r('Plum', false)]))
      .toBe('Chocolate, Almond, with cherry, apple and plum');
  });

  it('accents only: the plain list; no rows: null; signature only: the signature line', () => {
    expect(line.teaserFor([r('Dark Chocolate', false), r('Brown Sugar', false), r('Chocolate', false)])).toBe('Dark Chocolate, Brown Sugar, Chocolate');
    expect(line.teaserFor([])).toBeNull();
    expect(line.teaserFor([r('Hazelnut', true)])).toBe('Hazelnut');
  });

  it('caps are the read\'s: every row given is drawn, none added, and the line logic holds no count', () => {
    const rows = [r('A', true), r('B', false), r('C', false)];
    expect(line.teaserFor(rows.slice(0, 2))).toBe('A, with b');
    expect(readFileSync(path.join(FRONTEND, 'lib', 'signatureLine.ts'), 'utf8')).not.toMatch(/slice\(0, ?[0-9]|_max\b/);
    // the reveal keeps its two-line form
    expect(line.accentClauses(rows)).toEqual(['a hint of f: b, c']);
  });

  it('the dial card renders "arriving soon" only without customer-voice rows, and the tags from the read', () => {
    const src = readFileSync(path.join(FRONTEND, 'components', 'bloom', 'DialArchetypeSection.tsx'), 'utf8');
    expect(src).toMatch(/isPlaceholder \|\| !cardData\.hasVoiceRows/);
    expect(src).toMatch(/<CardTags tags=\{cardData\.tags\} \/>/);
    const tags = readFileSync(path.join(FRONTEND, 'components', 'coffee-info', 'CardTags.tsx'), 'utf8');
    expect(tags).not.toMatch(/Award|Espresso|per the roaster/); // no label text in the frontend
  });
});

describe('masking (decision 3)', () => {
  const tokens = bannedTokensFor([AWARD], [ROASTER], RAW_NAME);

  it('the Golden Bean sentence reaches the prompt with the award as one gap (neighbouring gaps collapse, snapshot)', () => {
    const masked = maskTokens('Winner of a 2023 Golden Bean medal, this classic espresso blend', tokens);
    expect(masked).toBe(`Winner of a ${MASK}, this classic espresso blend`);
    expect(maskCount(masked)).toBe(1);
    // gaps apart stay apart
    expect(maskTokens('Golden hour, then a bean medal', tokens)).toBe(`${MASK} hour, then a ${MASK}`);
    expect(masked).toMatchSnapshot();
  });

  it('a roaster name or the raw coffee name inside a remark is one gap; other words stay', () => {
    expect(maskTokens('Zzz Fixture Roasters roast it dark. Beans from the hills.', tokens)).toBe(`${MASK} roast it dark. Beans from the hills.`);
    expect(maskTokens('Our zzz stripe espresso is a crowd pleaser', tokens)).toBe(`Our ${MASK} is a crowd pleaser`);
  });

  it('the leak guard still rejects an output carrying a token, and a printed gap is a style reject', async () => {
    expect(looksLikeLeak('A Golden cup.', tokens)).toBe('golden');
    const replies = [`An award-winning ${MASK} blend.`, 'An award-winning blend, as the roaster tells it.'];
    const r = await generateWithLeakGuard(async () => replies.shift() ?? null, tokens, () => false, guard.maskViolation);
    expect(r).toMatchObject({ text: 'An award-winning blend, as the roaster tells it.', styleRejects: 1 });
  });
});

describe('brew rule (decision 4)', () => {
  it('a brew method the voice does not name is rejected; one it names passes', () => {
    expect(looksLikeInventedBrew('Best as drip coffee or espresso.', { remarks: NO_REMARKS, portal: NO_PORTAL }, BREW_LABELS)).toBe('Batch brew / drip');
    expect(looksLikeInventedBrew('The roaster pulls it as espresso.', { remarks: NO_REMARKS, portal: { ...NO_PORTAL, bestBrew: 'Espresso' } }, BREW_LABELS)).toBeNull();
    expect(looksLikeInventedBrew('Lovely as a pour over.', { remarks: NO_REMARKS, portal: NO_PORTAL }, BREW_LABELS)).toBe('Pour-over');
  });

  it('words the roaster wrote count: a remark naming drip and cortado lets "drip" and "cortado" through, not espresso', () => {
    const voice = { remarks: { ...NO_REMARKS, general: ['Cortado, cappuccino, drip coffee, you really can\'t go wrong'] }, portal: NO_PORTAL };
    expect(looksLikeInventedBrew('The roaster says cortado or drip, you can\'t go wrong.', voice, BREW_LABELS)).toBeNull();
    // one alternative of a label stands for the method: "batch brew" is the roaster's "drip"
    expect(looksLikeInventedBrew('Made for the batch brewer, per the roaster: batch brew.', voice, BREW_LABELS)).toBeNull();
    expect(looksLikeInventedBrew('Best as drip coffee or espresso.', voice, BREW_LABELS)).toBe('Espresso');
  });

  it('the labels are the ones passed (the lookup\'s), nothing built in', () => {
    const voice = { remarks: NO_REMARKS, portal: NO_PORTAL };
    expect(looksLikeInventedBrew('Try it as a Zzzpresso.', voice, BREW_LABELS)).toBe('Zzzpresso');
    expect(looksLikeInventedBrew('Try it as a Zzzpresso.', voice, [])).toBeNull();
    expect(looksLikeInventedBrew('Try it as espresso.', voice, ['Zzzpresso'])).toBeNull();
  });

  it('the story rejects an invented brew method and accepts the retry', async () => {
    h.replies.push('The roaster calls it hazelnut; perfect as espresso.', 'The roaster calls it hazelnut.');
    const r = await generateCoffeeStoryWithRetry(storyParams(NO_PORTAL), { rawCoffeeName: RAW_NAME, roasterNames: [ROASTER], leakTokens: [], archetypeLabels: [] });
    expect(r).toMatchObject({ passed: true, attempts: 2 });
    expect(r.rejects).toEqual(['brew method "Espresso" the roaster does not name']);
  });
});

describe('the story keeps the milk rule like the description (Dana\'s go)', () => {
  const identity = { rawCoffeeName: RAW_NAME, roasterNames: [ROASTER], leakTokens: [], archetypeLabels: [] };

  it('no takes_it answer: a milk drink is rejected and retried; the prompt says no milk', async () => {
    h.replies.push('The roaster calls it hazelnut, forgiving in a cortado if you want milk with it.', 'The roaster calls it hazelnut.');
    const r = await generateCoffeeStoryWithRetry(storyParams(NO_PORTAL), identity);
    expect(r).toMatchObject({ passed: true, attempts: 2 });
    expect(r.rejects[0]).toMatch(/style: "cortado" without a takes_it answer/);
    expect(buildStoryPrompt(storyParams(NO_PORTAL))).toContain('Say nothing about adding milk or drinking it black, and no milk drinks');
  });

  it('with a takes_it answer: milk passes and the prompt carries the roaster\'s line', async () => {
    h.replies.push('The roaster calls it hazelnut, black or with milk.');
    const both = { ...NO_PORTAL, takesIt: 'both' } as unknown as typeof NO_PORTAL;
    expect((await generateCoffeeStoryWithRetry(storyParams(both), identity)).attempts).toBe(1);
    const prompt = buildStoryPrompt(storyParams(both));
    expect(prompt).toContain('How the roaster says it is drunk: black or with milk');
    expect(prompt).toContain('only as "How the roaster says it is drunk" above puts it');
  });
});

function storyParams(portal: typeof NO_PORTAL, brewing: string[] = []) {
  return {
    displayName: 'Classic', origin: 'Huila, Colombia', process: 'Washed',
    dimensions: [{ dimension: 'Body', avg_min: 8, avg_max: 10, scale_min_label: 'thin', scale_max_label: 'heavy' }],
    voice: {
      descriptors: [{ descriptor: 'Hazelnut', voice: 'roaster_website', is_signature: true, confirmed_by_cupping: false }],
      remarks: { ...NO_REMARKS, brewing }, portal,
    } as never,
    archetypeLabels: [] as string[], brewLabels: BREW_LABELS,
  };
}

describe('the prompts carry the brew line and the gap rule (decisions 3, 4)', () => {
  it('story prompt: the portal brews as labels, the brewing remark, both rules (snapshot)', () => {
    const prompt = buildStoryPrompt(storyParams({ ...NO_PORTAL, bestBrew: 'Espresso', alsoGoodBrews: ['Pour-over', 'French press'] }, [`18g in, 40g out, a ${MASK} favourite`]));
    expect(prompt).toContain('Brew methods the roaster names: best Espresso; also Pour-over, French press');
    expect(prompt).toContain(`What the roaster says about brewing it (paraphrase, do not quote): 18g in, 40g out, a ${MASK} favourite`);
    expect(prompt).toContain('Name a brew method only if the roaster names it above');
    expect(prompt).toContain(`A bracketed gap "${MASK}"`);
    expect(prompt).not.toMatch(/[–—]/);
    expect(prompt).toMatchSnapshot();
  });

  it('no origin and no process: the story is not asked for them and is told to say nothing (test-run addition)', () => {
    const prompt = buildStoryPrompt({ ...storyParams(NO_PORTAL), origin: null, process: null });
    expect(prompt).not.toContain("where it's from");
    expect(prompt).not.toContain("how it's processed");
    expect(prompt).toContain('covering: what shapes the cup (tied to the structure below), and one thing worth noticing.');
    expect(prompt).toContain('Where it is grown is not given: say nothing about its origin');
    expect(prompt).toContain('How it was processed is not given: say nothing about its processing.');
    const known = buildStoryPrompt(storyParams(NO_PORTAL));
    expect(known).toContain("covering: where it's from (region-level only");
    expect(known).not.toContain('is not given');
  });

  it('no brew answers: no brew line, the rule still there', () => {
    const prompt = buildStoryPrompt(storyParams(NO_PORTAL));
    expect(prompt).not.toContain('Brew methods the roaster names:');
    expect(prompt).toContain('Name a brew method only if the roaster names it above');
  });

  it('description voice: the brew line among the form answers', () => {
    const text = renderVoice({
      descriptors: [], remarks: NO_REMARKS, awards: { count: 1 }, dimensions: [],
      portal: { ...NO_PORTAL, roastLevel: null, blendOrSingle: null, isDecaf: null, proposedArchetype: null, bestBrew: 'Espresso', alsoGoodBrews: [] },
    });
    expect(text).toContain('  Brew methods the roaster names: best Espresso');
  });
});
