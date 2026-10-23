// Coffee presentation brief 1 (2026-10-23): the leak guard (decision 9), the
// three prompt bodies (decision 8, snapshot) and the reveal panel's line
// (decision 5, the frontend copy loaded by path). Pure: no database, no
// Anthropic call (the SDK and the spend guard are mocked to capture prompts).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import type { CustomerDescriptor } from './cuppingReads.js';

const sent: Array<{ content: string }> = [];
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (args: { messages: Array<{ content: string }> }) => {
        sent.push({ content: args.messages[0].content });
        return { content: [{ type: 'text', text: 'A stub reply.' }] };
      },
    };
  },
}));
vi.mock('./anthropicGuard.js', () => ({
  guardClaudeCall: (_feature: string, _model: string, fn: () => unknown) => fn(),
  isClaudeGuardBlocked: (err: unknown) => (err as { blocked?: boolean })?.blocked === true,
}));

const guard = await import('./contentGuard.js');
const { bannedTokensFor, looksLikeLeak, generateWithLeakGuard } = guard;
const { getCoffeeSummary, getCoffeeSurpriseNote, getCoffeeThreeVoiceStory } = await import('./claude.js');

// ── fixture values ──
const ROASTER = 'Zzz Fixture Roasters';
const RAW_NAME = 'Zzz Stripe Espresso';
const AWARD = '2023 Golden Bean medal';

function row(descriptor: string, family: string, isSignature: boolean, order: number, confirmed = false): CustomerDescriptor {
  return {
    node_id: descriptor, descriptor, wheel_category: family, wheel_subcategory: null, tier: 3, voice: 'roaster_website', rank: 2,
    confirmed_by_cupping: confirmed, cupping_sessions_named: confirmed ? 1 : null, cupping_sessions_total: confirmed ? 1 : null,
    family_id: family, family, is_signature: isSignature, n_roaster_channels: 1, roaster_channels: ['website'], roaster_rank: null,
    cupping_share: confirmed ? 1 : null, qualifies: true, group_order: order, display_order: order,
  };
}
const voice = {
  descriptors: [
    row('Chocolate', 'Nutty / Cocoa', true, 1, true), row('Almond', 'Nutty / Cocoa', true, 2),
    row('Cherry', 'Fruity', false, 3), row('Apple', 'Fruity', false, 4),
  ],
  remarks: { general: ['perfect on its own, or with steamed milk'], brewing: ['18g in, 40g out'], roast: [], process: [] },
  portal: { takesIt: 'both', brewNotes: null, anythingElse: null, roastLevel: 'medium', blendOrSingle: 'blend', isDecaf: false, proposedArchetype: 'fruity' },
  awards: { count: 1 },
  dimensions: [{ dimension: 'Body', scale_min_label: 'light', scale_max_label: 'heavy', display_order: 7, avg_min: '5.0', avg_max: '9.0', session_count: '2' }],
};

describe('leak guard (decision 9)', () => {
  const tokens = bannedTokensFor([AWARD], [ROASTER], RAW_NAME);

  it('builds the per-coffee list: names as phrases, every award word of three or more characters alone', () => {
    expect(tokens).toEqual(['zzz fixture roasters', 'zzz stripe espresso', '2023', 'golden', 'bean', 'medal']);
  });

  it('rejects a text with "Golden" or "2023" from the award, or a name; a clean text passes', () => {
    expect(looksLikeLeak('A golden-hour cup of chocolate.', tokens)).toBe('golden');
    expect(looksLikeLeak('The roaster calls it the best blend of 2023.', tokens)).toBe('2023');
    expect(looksLikeLeak('Zzz Stripe Espresso leads with chocolate.', tokens)).toBe('zzz stripe espresso');
    expect(looksLikeLeak('The roaster calls it chocolate and almond, an award-winning blend as the roaster tells it.', tokens)).toBeNull();
    expect(looksLikeLeak('Beans from the highlands', tokens)).toBeNull(); // whole words only: "beans" is not "bean"
  });

  it('retries once on a leak (stubbed client): the second, clean text is kept', async () => {
    const replies = ['Winner of a Golden medal.', 'Chocolate and almond, per the roaster.'];
    const gen = vi.fn(async () => replies.shift() ?? null);
    const r = await generateWithLeakGuard(gen, tokens, () => false);
    expect(gen).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ text: 'Chocolate and almond, per the roaster.', blocked: false, leakRejects: 1, styleRejects: 0, reason: null });
  });

  it('a second leak returns null with the reason (the caller marks *_generation_failed)', async () => {
    const gen = vi.fn(async () => 'The 2023 cup.');
    const r = await generateWithLeakGuard(gen, tokens, () => false);
    expect(gen).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ text: null, blocked: false, leakRejects: 2, styleRejects: 0, reason: 'leak: 2023' });
  });

  it('a refusal is null at once, a blocked call is blocked, a clean first text needs no retry', async () => {
    expect(await generateWithLeakGuard(async () => 'INSUFFICIENT_DATA', tokens, () => false)).toMatchObject({ text: null, reason: 'refusal', leakRejects: 0 });
    expect(await generateWithLeakGuard(async () => { throw { blocked: true }; }, tokens, (e: any) => e?.blocked)).toMatchObject({ text: null, blocked: true });
    const gen = vi.fn(async () => 'Chocolate first.');
    expect((await generateWithLeakGuard(gen, tokens, () => false)).text).toBe('Chocolate first.');
    expect(gen).toHaveBeenCalledTimes(1);
  });
});

describe("Dana's prod-go rules, enforced (dashes, archetype categories, milk)", () => {
  const { normalizeDashes, styleViolation } = guard;
  const labels = ['Floral', 'Fruity', 'Balanced', 'Chocolate & Nutty', 'Earthy', 'Experimental'];

  it('normalises dashes: between numbers "to", elsewhere a comma', () => {
    expect(normalizeDashes('coconut—yet bright')).toBe('coconut, yet bright');
    expect(normalizeDashes('a 40g – 45g yield')).toBe('a 40g to 45g yield');
    expect(normalizeDashes('it lingers —.')).toBe('it lingers.');
  });

  it('rejects "archetype", an archetype name as a category, and milk without a takes_it answer', () => {
    expect(styleViolation('A classic archetype.', labels, true)).toBe('"archetype"');
    expect(styleViolation('This fruity blend surprises.', labels, true)).toBe('category "fruity blend"');
    expect(styleViolation('A Chocolate & Nutty coffee.', labels, true)).toBe('category "Chocolate & Nutty coffee"');
    expect(styleViolation('Great with milk.', labels, false)).toBe('"milk" without a takes_it answer');
    expect(styleViolation('Great with milk.', labels, true)).toBeNull();
    expect(styleViolation('Beautifully balanced, with a hint of fruity notes.', labels, false)).toBeNull();
  });

  it('a style reject is retried, up to three attempts; the accepted text has no dash', async () => {
    const replies = ['This fruity coffee shines.', 'Cherry first—then almond.'];
    const gen = vi.fn(async () => replies.shift() ?? null);
    const r = await generateWithLeakGuard(gen, [], () => false, t => styleViolation(t, labels, true));
    expect(r).toEqual({ text: 'Cherry first, then almond.', blocked: false, leakRejects: 0, styleRejects: 1, reason: null });
    const always = vi.fn(async () => 'A fruity coffee.');
    const r2 = await generateWithLeakGuard(always, [], () => false, t => styleViolation(t, labels, true));
    expect(always).toHaveBeenCalledTimes(3);
    expect(r2).toMatchObject({ text: null, styleRejects: 3, reason: 'style: category "fruity coffee"' });
  });
});

describe('the three prompts read the roaster voice (decision 8)', () => {
  beforeEach(() => { sent.length = 0; });

  it('snapshot: no roaster name, no award text, signature and accent lists present, remarks labelled paraphrase', async () => {
    await getCoffeeSummary({ coffeeName: 'The Classic', voice });
    await getCoffeeSurpriseNote({ coffeeName: 'The Classic', voice });
    await getCoffeeThreeVoiceStory({ coffeeName: 'The Classic', voice });
    expect(sent.length).toBe(3);
    for (const { content } of sent) {
      for (const banned of [ROASTER, RAW_NAME, AWARD, 'Golden', '2023']) expect(content).not.toContain(banned);
      expect(content).toContain("The roaster's signature notes (the core of the cup, strongest first): Chocolate, Almond");
      expect(content).toContain('The roaster\'s accent notes (only "a hint of", never the core): fruity: Cherry, Apple');
      expect(content).toContain('Facts from the roaster (paraphrase, do not quote)');
      expect(content).toContain('Award-winning per the roaster: yes');
      expect(content).not.toContain('fruity archetype'); // the roaster's proposed archetype is not a tasting fact
      // Dana's prod-go rules: the prompt itself carries no dash and no archetype category
      expect(content).not.toMatch(/[–—]/);
      expect(content).not.toContain('Chocolate & Nutty coffee');
      expect(content).toContain('Never use an em dash or an en dash');
      expect(content).toContain('How the roaster says it is drunk: black or with milk');
    }
    expect(sent.map(s => s.content)).toMatchSnapshot();
  });

  it('the three-voice story is not asked for when the voice has no signature note, remark or portal answer', async () => {
    const empty = { ...voice, descriptors: [], remarks: { general: [], brewing: [], roast: [], process: [] },
      portal: { takesIt: null, brewNotes: null, anythingElse: null, roastLevel: null, blendOrSingle: null, isDecaf: null, proposedArchetype: null } };
    expect(await getCoffeeThreeVoiceStory({ coffeeName: 'The Classic', voice: empty })).toBeNull();
    expect(sent.length).toBe(0);
  });
});

// The frontend copy (frontend/src/app/lib/signatureLine.ts), loaded by a path
// built at run time so the backend tsc build never compiles it (as evidenceBasis.test.ts does).
const FRONTEND = path.resolve(process.cwd(), '..', 'frontend', 'src', 'app');
const line = await import(pathToFileURL(path.join(FRONTEND, 'lib', 'signatureLine.ts')).href);

describe('SignatureLine (decision 5)', () => {
  const rows = [
    { descriptor: 'Chocolate', family: 'Nutty / Cocoa', is_signature: true },
    { descriptor: 'Almond', family: 'Nutty / Cocoa', is_signature: true },
    { descriptor: 'Cherry', family: 'Fruity', is_signature: false },
    { descriptor: 'Apple', family: 'Fruity', is_signature: false },
  ];

  it('one line of the signature rows in the order given, one accent clause per family', () => {
    expect(line.signatureText(rows)).toBe('Chocolate, Almond');
    expect(line.accentClauses(rows)).toEqual(['a hint of fruity: cherry, apple']);
  });

  it('no accent clause when there are no accent rows; two families give two clauses in order of first appearance', () => {
    expect(line.accentClauses(rows.slice(0, 2))).toEqual([]);
    expect(line.accentClauses([...rows, { descriptor: 'Cinnamon', family: 'Spices', is_signature: false }]))
      .toEqual(['a hint of fruity: cherry, apple', 'a hint of spices: cinnamon']);
  });

  it('no literal count in the component, the line logic or the wheel', () => {
    for (const file of ['lib/signatureLine.ts', 'components/coffee-info/SignatureLine.tsx', 'components/coffee-info/CollaborativeFlavorWheel.tsx']) {
      expect(readFileSync(path.join(FRONTEND, file), 'utf8')).not.toMatch(/slice\(0, ?[0-9]/);
    }
  });
});
