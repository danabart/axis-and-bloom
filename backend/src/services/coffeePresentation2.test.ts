// Coffee presentation brief 2 (2026-10-24), the frontend side: TastingNotes
// renders the one description under "In the roaster's words" and no summary or
// surprise markup, in both variants; the position card's teaser is the
// signature line whether or not the data carries a surprise note. The frontend
// files are loaded by a path built at run time (as coffeePresentation.test.ts
// does), so the backend tsc build never compiles them; React comes from the
// frontend's own node_modules.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const FRONTEND = path.resolve(process.cwd(), '..', 'frontend');
const load = (rel: string) => import(pathToFileURL(path.join(FRONTEND, rel)).href);
const React = await load('node_modules/react/index.js');
const { renderToStaticMarkup } = await load('node_modules/react-dom/server.node.js');
const { TastingNotes } = await load('src/app/components/coffee-info/TastingNotes.tsx');
const line = await load('src/app/lib/signatureLine.ts');

const content = {
  aiSummary: 'SUMMARY TEXT that must not render',
  surpriseNote: 'SURPRISE TEXT that must not render. Second sentence.',
  threeVoiceStory: 'The roaster calls it hazelnut forward.',
};
const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(TastingNotes, props));

describe('TastingNotes: one description (B1)', () => {
  for (const variant of ['full', 'reveal']) {
    it(`variant='${variant}' renders the story under "In the roaster's words", no summary, surprise, legend or intake`, () => {
      const html = render({ content, contentLoading: false, variant });
      expect(html).toContain('The roaster calls it hazelnut forward.');
      expect(html).toContain('In the roaster&#x27;s words');
      for (const gone of ['SUMMARY TEXT', 'SURPRISE TEXT', 'Three voices', 'Liam&#x27;s intake', 'Generating', 'Not enough data to generate a summary']) {
        expect(html).not.toContain(gone);
      }
    });
  }

  it("variant='reveal' with no story renders nothing (the surprise-note fallback is gone)", () => {
    expect(render({ content: { ...content, threeVoiceStory: null }, contentLoading: false, variant: 'reveal' })).toBe('');
  });

  it("variant='full' with no story and no links renders an empty wrapper, never the summary", () => {
    const html = render({ content: { ...content, threeVoiceStory: null }, contentLoading: false });
    expect(html).toBe('<div></div>');
  });

  it('the source carries no surpriseNote / aiSummary read outside the type', () => {
    const src = readFileSync(path.join(FRONTEND, 'src/app/components/coffee-info/TastingNotes.tsx'), 'utf8');
    expect(src).not.toMatch(/content\??\.(surpriseNote|aiSummary)/);
  });
});

describe('position card teaser (B2)', () => {
  const rows = [
    { descriptor: 'Hazelnut', family: 'Nutty / Cocoa', is_signature: true },
    { descriptor: 'Citrus Fruit', family: 'Fruity', is_signature: false },
  ];
  it('is the signature line, with and without a surprise note in the data', () => {
    expect(line.teaserFor(rows)).toBe(line.signatureText(rows));
    expect(line.teaserFor(rows)).toBe('Hazelnut');
    expect(line.teaserFor([])).toBeNull();
    // usePositionCardData builds the teaser from the wheel rows alone: the content (with or without a surprise note) never feeds it
    const hook = readFileSync(path.join(FRONTEND, 'src/app/components/bloom/usePositionCardData.ts'), 'utf8');
    expect(hook).toMatch(/const teaser = teaserFor\(/);
    expect(hook).not.toMatch(/surpriseNote/);
  });
});
