// Ella map 13 fix (2026-11-26, Dana): on the customer face (/map), a coffee's
// name never covers a family's name; the admin face's markup is unchanged
// (pinned by a snapshot written from the face before the fix). The fixture is
// the test DB's active map on 2026-11-26 (18 coffees, 5 wedges), read through
// dialReads.customerFace and dialReads.wedges.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import EllaMapFace from './EllaMapFace';
import fixture from './__fixtures__/face_2026-11-26.json';

afterEach(cleanup);
const { placements, wedges, seams } = fixture as unknown as {
  placements: Parameters<typeof EllaMapFace>[0]['placements'];
  wedges: Parameters<typeof EllaMapFace>[0]['wedges'];
  seams: NonNullable<Parameters<typeof EllaMapFace>[0]['seams']>;
};
type Box = { x0: number; x1: number; y0: number; y1: number };
/** The same estimate the face uses: 0.6 em per character, the font size plus 6 tall. */
function boxOf(t: SVGTextElement): Box {
  const size = Number(t.getAttribute('font-size')), x = Number(t.getAttribute('x')), y = Number(t.getAttribute('y'));
  const w = (t.textContent ?? '').length * size * 0.6, h = size + 6;
  const anchor = t.getAttribute('text-anchor');
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  // the centre's name is drawn on its baseline (no dominant-baseline): its box sits above y
  const yc = t.getAttribute('dominant-baseline') === 'middle' ? y : y - size * 0.35;
  return { x0, x1: x0 + w, y0: yc - h / 2, y1: yc + h / 2 };
}
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe('the customer face: coffee names keep clear of family names', () => {
  it('for every coffee as the customer’s, with arrows to the other coffees of its family', () => {
    const overlaps: string[] = [];
    for (const me of placements) {
      const arrows = placements.filter(p => p.archetype_code === me.archetype_code && p.coffee_id !== me.coffee_id).map(p => p.coffee_id).slice(0, 4);
      const { container } = render(<EllaMapFace placements={placements} wedges={wedges} size="full" labelMode="name"
        highlightCoffeeId={me.coffee_id} arrowsTo={arrows} quietOthers />);
      const texts = [...container.querySelectorAll('text')] as SVGTextElement[];
      const families = texts.filter(t => !t.closest('g'));
      const coffees = texts.filter(t => t.closest('g'));
      expect(families.length).toBe(wedges.length);
      for (const c of coffees) for (const f of families) if (hit(boxOf(c), boxOf(f))) overlaps.push(`${me.coffee_name}: ${c.textContent} over ${f.textContent}`);
      cleanup();
    }
    expect(overlaps).toEqual([]);
  });

  it('Dana’s page: Tiger Stripe with Blossom, Geometric and The Waverly; The Waverly no longer covers Chocolate & Nutty', () => {
    const id = (n: string) => placements.find(p => p.coffee_name.startsWith(n))!.coffee_id;
    const { container } = render(<EllaMapFace placements={placements} wedges={wedges} size="full" labelMode="name"
      highlightCoffeeId={id('Tiger Stripe')} arrowsTo={[id('Blossom'), id('Geometric'), id('The Waverly')]} quietOthers />);
    const texts = [...container.querySelectorAll('text')] as SVGTextElement[];
    const family = texts.find(t => t.textContent === 'Chocolate & Nutty')!;
    const waverly = texts.find(t => t.textContent?.startsWith('The Waverly'))!;
    expect(hit(boxOf(waverly), boxOf(family))).toBe(false);
  });
});

describe('the admin face is unchanged', () => {
  it('renders the same markup as before the fix', () => {
    const { container } = render(<EllaMapFace placements={placements} wedges={wedges} seams={seams} size="full"
      dotStyle="size" highlightCoffeeId={placements[0].coffee_id} />);
    expect(container.innerHTML).toMatchSnapshot();
  });
});
