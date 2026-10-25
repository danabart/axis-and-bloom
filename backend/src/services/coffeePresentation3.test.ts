// Coffee presentation brief 3 (2026-10-24), the mocked half: the dial
// signal recorded when a slot has no band (decision 2), and the story under
// the description's rules (decision 4). No database: db / withTransaction,
// the catalog reads, the merged range, the Anthropic SDK and the spend guard
// are mocked, so the INSERT the signal writes and the prompt the story sends
// are captured as they are.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  writes: [] as Array<{ sql: string; params: unknown[] }>,
  prompts: [] as string[],
  replies: [] as string[],
}));

vi.mock('../db/client.js', () => ({
  db: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ query: async (sql: string, params: unknown[] = []) => { h.writes.push({ sql, params }); return { rows: [], rowCount: 0 }; } })),
}));
vi.mock('./catalogReads.js', () => ({
  getCoffee: vi.fn(async () => ({ id: 1, match_archetype: 'fixture_arch' })),
  getArchetypes: vi.fn(async () => [
    { code: 'fixture_arch', label: 'Fixture Label', is_archetype: true, dominant_dimension_id: 7, dominant_dimension_name: 'Body', sort_order: 1 },
  ]),
  getSlots: vi.fn(async () => [
    { id: 101, archetype: 'fixture_arch', sort_order: 1, position_label: 'Lighter', is_active: true, spec_band_lo: 0, spec_band_hi: 5 },
    { id: 102, archetype: 'fixture_arch', sort_order: 2, position_label: 'Middle', is_active: true, spec_band_lo: null, spec_band_hi: null },
    { id: 103, archetype: 'fixture_arch', sort_order: 3, position_label: 'Fuller', is_active: true, spec_band_lo: 10, spec_band_hi: 15 },
  ]),
  archetypeLabel: vi.fn(async (c: string) => c),
}));
vi.mock('./cuppingReads.js', () => ({
  getMergedRange: vi.fn(async () => ({
    coffee_id: 1, dimension_id: 7, basis: 'merged', midpoint: 6.5, n_sessions: 2, session_id: 40,
    n_sessions_pooled: 2, rank_ratio: 0.667, half_life_days: 365,
  })),
  getAllMergedRanges: vi.fn(async () => []),
}));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (req: { messages: Array<{ content: string }> }) => {
        h.prompts.push(req.messages[0].content);
        return { content: [{ type: 'text', text: h.replies.shift() ?? 'empty' }] };
      },
    };
  },
}));
vi.mock('./anthropicGuard.js', () => ({
  guardClaudeCall: (_feature: string, _model: string, fn: () => unknown) => fn(),
  isClaudeGuardBlocked: () => false,
}));

const { getSlots } = await import('./catalogReads.js');
const { recordCuppingSignal, getDialSuggestion, noBandNote } = await import('./dialSuggestion.js');
const { generateCoffeeStoryWithRetry, buildStoryPrompt } = await import('./storyLayer.js');

beforeEach(() => { h.writes.length = 0; h.prompts.length = 0; h.replies.length = 0; });

describe('dial signal with an unbanded slot (decision 2)', () => {
  it('records the signal with suggested_slot_id null and the no-band notes', async () => {
    const s = await getDialSuggestion(1);
    expect(s).toMatchObject({ suggested_slot_id: null, reason: 'no_band', missingBandSlots: [2], avg_score: 6.5 });

    await recordCuppingSignal(1);
    const insert = h.writes.find(w => /INSERT INTO dial_position_signal/.test(w.sql))!;
    expect(insert).toBeDefined();
    const [coffeeId, archetype, dimensionId, slotId, rawValue, sampleSize, notes] = insert.params;
    expect([coffeeId, archetype, dimensionId, slotId, rawValue, sampleSize]).toEqual([1, 'fixture_arch', 7, null, 6.5, 2]);
    expect(notes).toBe(`${noBandNote([2], 'Fixture Label')}; pooled 2 sessions (ratio 0.667, half-life 365 d), latest s40`);
    expect(notes).toMatch(/^no suggestion: slot\(s\) 2 of Fixture Label have no band;/);
    // the old signal is superseded first, as before
    expect(h.writes[0].sql).toMatch(/UPDATE dial_position_signal\s+SET superseded_at/);
  });

  it('with every slot banded the slot is suggested and written, basis spec_band', async () => {
    vi.mocked(getSlots).mockResolvedValueOnce([
      { id: 101, sort_order: 1, position_label: 'Lighter', is_active: true, spec_band_lo: 0, spec_band_hi: 5 },
      { id: 102, sort_order: 2, position_label: 'Middle', is_active: true, spec_band_lo: 5.1, spec_band_hi: 9.9 },
      { id: 103, sort_order: 3, position_label: 'Fuller', is_active: true, spec_band_lo: 10, spec_band_hi: 15 },
    ] as never).mockResolvedValueOnce([
      { id: 101, sort_order: 1, position_label: 'Lighter', is_active: true, spec_band_lo: 0, spec_band_hi: 5 },
      { id: 102, sort_order: 2, position_label: 'Middle', is_active: true, spec_band_lo: 5.1, spec_band_hi: 9.9 },
      { id: 103, sort_order: 3, position_label: 'Fuller', is_active: true, spec_band_lo: 10, spec_band_hi: 15 },
    ] as never);
    await recordCuppingSignal(1);
    const insert = h.writes.find(w => /INSERT INTO dial_position_signal/.test(w.sql))!;
    expect(insert.params[3]).toBe(102);
    expect(String(insert.params[6])).toMatch(/^spec_band; pooled 2 sessions/);
  });

  it('the module holds no archetype_vector fallback', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./dialSuggestion.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/BASIS_ARCHETYPE_VECTOR/);
    // Dana's go: getArchetypeBucketWidth went too (the hop gap is param('hop_suggestion_gap'))
    expect(src).not.toMatch(/FROM v_archetype_dimension_comparison|getArchetypeBucketWidth\(/);
  });
});

// brief 4: the story's voice carries remarks and portal answers too (empty here)
const NO_REMARKS = { general: [], brewing: [], roast: [], process: [] };
const NO_PORTAL = { bestBrew: null, alsoGoodBrews: [], brewNotes: null, anythingElse: null, takesIt: null };

describe('the story under the description\'s rules (decision 4)', () => {
  const voice = {
    descriptors: [
      { descriptor: 'Dark Chocolate', voice: 'roaster_accepted', is_signature: true, confirmed_by_cupping: true },
      { descriptor: 'Hazelnut', voice: 'roaster_website', is_signature: true, confirmed_by_cupping: false },
      { descriptor: 'Cherry', voice: 'roaster_accepted', is_signature: false, confirmed_by_cupping: false },
      { descriptor: 'Caramel', voice: 'customer', is_signature: true, confirmed_by_cupping: false },
    ],
    remarks: NO_REMARKS, portal: NO_PORTAL,
  } as never;
  const params = {
    displayName: 'Lighter', origin: 'Finca Example, Huila, Colombia', process: 'Washed',
    dimensions: [{ dimension: 'Body', avg_min: 8, avg_max: 10, scale_min_label: 'thin', scale_max_label: 'heavy' }], voice,
    archetypeLabels: ['Chocolate & Nutty', 'Fruity'], brewLabels: [] as string[],
  };
  const identity = { rawCoffeeName: 'Zzz Raw Name', roasterNames: ['Zzz Roastery'], leakTokens: [], archetypeLabels: ['Chocolate & Nutty', 'Fruity'] };

  it('replaces the dashes a stubbed reply carries; region text ("highlands of") passes', async () => {
    h.replies.push('From the highlands of Huila — washed and dried slowly, the roaster calls it dark chocolate and hazelnut, 8–10 on body.');
    const r = await generateCoffeeStoryWithRetry(params, identity);
    expect(r.passed).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.text).not.toMatch(/[–—]/);
    expect(r.text).toContain('highlands of Huila');
    expect(r.text).toContain('8 to 10');
  });

  it('rejects an archetype used as a category and our tasting as our own, then accepts the retry', async () => {
    h.replies.push('A Fruity coffee from the highlands, the roaster calls it cherry.', 'Our cupping revealed dark chocolate.', 'The roaster calls it dark chocolate, and we tasted it too.');
    const r = await generateCoffeeStoryWithRetry(params, identity);
    expect(r).toMatchObject({ passed: true, attempts: 3 });
    expect(h.prompts[1]).toMatch(/rejected for this reason: style: category "Fruity coffee"/);
    expect(h.prompts[2]).toMatch(/rejected for this reason: our tasting as our own "Our cupping revealed"/);
  });

  it('"the roaster" passes as attribution; "roastery" and "farm" still reject', async () => {
    h.replies.push('The roastery picked it at a farm.', 'The roaster calls it cherry, from a farm.', 'The roaster calls it cherry.');
    const r = await generateCoffeeStoryWithRetry(params, identity);
    expect(r).toMatchObject({ passed: true, attempts: 3 });
    expect(h.prompts[1]).toMatch(/banned term "roastery"/);
    expect(h.prompts[1]).toMatch(/banned term "farm"/);
    expect(h.prompts[2]).not.toMatch(/banned term "roaster"/);
  });

  it('"we tasted" is rejected when our cupping confirmed none of the roaster\'s notes', async () => {
    const unconfirmed = { ...params, voice: { descriptors: [{ descriptor: 'Jasmine', voice: 'roaster_accepted', is_signature: true, confirmed_by_cupping: false }], remarks: NO_REMARKS, portal: NO_PORTAL } as never };
    h.replies.push('The roaster calls it jasmine, and we tasted it too.', 'The roaster calls it jasmine.');
    const r = await generateCoffeeStoryWithRetry(unconfirmed, identity);
    expect(r).toMatchObject({ passed: true, attempts: 2 });
    expect(r.rejects).toEqual(['"we tasted" but our cupping confirmed none of the roaster\'s notes']);
    // with a confirmed note the same phrase passes
    h.replies.push('The roaster calls it dark chocolate, and we tasted it too.');
    expect((await generateCoffeeStoryWithRetry(params, identity)).attempts).toBe(1);
  });

  it('still rejects the roaster name (the leak guard and the specificity line are unchanged)', async () => {
    h.replies.push('Zzz Roastery roasts it.', 'Zzz Roastery again.', 'Zzz Roastery once more.');
    const r = await generateCoffeeStoryWithRetry(params, identity);
    expect(r.passed).toBe(false);
    expect(r.violations.join(';')).toMatch(/roaster name "Zzz Roastery"/);
  });

  it('the prompt carries the roaster voice with attribution, never the old descriptor list (snapshot)', () => {
    const prompt = buildStoryPrompt(params);
    expect(prompt).not.toMatch(/Top flavor descriptors/);
    expect(prompt).not.toMatch(/Caramel/); // a customer's word is not the roaster's
    expect(prompt).toContain("The roaster's signature notes (the core of the cup, strongest first): Dark Chocolate, Hazelnut");
    expect(prompt).toContain("The roaster's accent notes (only ever \"a hint of\"): Cherry");
    expect(prompt).toContain("Axis & Bloom's cupping table tasted these too: Dark Chocolate");
    expect(prompt).toContain('"the roaster calls it"');
    expect(prompt).toContain('"and we tasted it too"');
    expect(prompt).toContain('the highlands of X');
    expect(prompt).not.toMatch(/[–—]/);
    expect(prompt).toMatchSnapshot();
  });
});
