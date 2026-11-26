// Ella's Bloom Map 12 (2026-11-26), Part D (frontend): "More about this coffee"
// on /map opens the shared reveal panel beneath the card, one at a time, with
// the coffee's own parts only: no comfort-zone label, no compatibility
// sentence, no roaster name, no award tag, no links.
// Ella map 13 (2026-11-26), Part D: the panel is in the roaster's terms. Order:
// the description, "Where it shines" (every method, best first), the notes,
// then "How the roaster rates it" with its caption and the roaster's 1 to 5
// bars; never A&B's cupping bars (the dimensions read is never made). Every
// heading comes from the copy rows. A coffee shows the button with a
// description, roaster ratings, or notes with a where-it-shines answer. From lg
// the top card's open panel spans the page and an open step card spans both
// columns. The Bloom page's panel (no mapProfile) is unchanged: its markup is
// pinned below. Fixture values only; the real ones come from the API.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_13_LAPTOP_LAYOUT_AND_ROASTER_PROFILE.md
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const map = vi.hoisted(() => ({ getMapFace: vi.fn(), getMapSteps: vi.fn(), decideMove: vi.fn() }));
vi.mock('../../../lib/mapCustomer', async (orig) => ({
  ...(await orig<typeof import('../../../lib/mapCustomer')>()), ...map, useMapFetch: () => vi.fn(),
}));
vi.mock('../../../context/CartContext', () => ({ useCart: () => ({ addToCart: vi.fn() }) }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ hasLiamAccess: true, user: null }) }));
vi.mock('../../../lib/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('./EllaMapFace', () => ({ default: () => null }));
// motion's height animation needs layout; render its children directly
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: { div: ({ children, initial: _i, animate: _a, exit: _e, transition: _t, ...rest }: Record<string, unknown> & { children?: React.ReactNode }) => <div {...rest}>{children}</div> },
}));

import MapPage, { MoreAbout } from './MapPage';
import { RevealedPanel } from '../RevealedPanel';

const ROASTER = 'Zzz Roasting Works';
const RATING = (label: string, lowLabel: string, highLabel: string, value: number) => ({ label, lowLabel, highLabel, value });
/**
 * The public coffee reads, per coffee id:
 * 1 has a description, methods, notes and ratings; 2 has notes only (no methods, no ratings: no button);
 * 3 has notes and methods but no description or ratings; 4 has ratings only.
 */
const reads: Record<string, unknown> = {
  '/api/coffees/1/content': {
    threeVoiceStory: 'Chocolate and almond, with a hint of cherry.', roaster_name: ROASTER,
    tags: [{ kind: 'award', label: 'Zzz Gold Award 2025' }, { kind: 'brew', label: 'Espresso' }],
  },
  '/api/coffees/1/flavor-wheel': [{ descriptor: 'Almond', l1: 'Nutty', l2: 'Nut', weight: 3, source: 'roaster' }],
  '/api/coffees/1/dimensions': { dimensions: [{ dimension: 'Body', scale_min_label: 'light', scale_max_label: 'heavy', avg_min: '5', avg_max: '9' }] },
  '/api/coffees/1/roaster-profile': {
    whereItShines: ['Espresso', 'Pour-over', 'Cold brew'], scale: 5,
    ratings: [RATING('Acidity', 'Soft', 'Bright', 4), RATING('Body', 'Light', 'Full', 5), RATING('Clarity', 'Clean', 'Layered', 2)],
  },
  '/api/coffees/2/content': { threeVoiceStory: null, tags: [] },
  '/api/coffees/2/flavor-wheel': [{ descriptor: 'Toffee', l1: 'Sweet', l2: 'Caramel', weight: 1, source: 'roaster' }],
  '/api/coffees/2/roaster-profile': { whereItShines: [], scale: 5, ratings: [] },
  '/api/coffees/3/content': { threeVoiceStory: null, tags: [] },
  '/api/coffees/3/flavor-wheel': [{ descriptor: 'Toffee', l1: 'Sweet', l2: 'Caramel', weight: 1, source: 'roaster' }],
  '/api/coffees/3/roaster-profile': { whereItShines: ['French press'], scale: 5, ratings: [] },
  '/api/coffees/4/content': { threeVoiceStory: null, tags: [] },
  '/api/coffees/4/flavor-wheel': [],
  '/api/coffees/4/roaster-profile': { whereItShines: [], scale: 5, ratings: [RATING('Sweetness', 'Low', 'High', 3)] },
};
const fetched = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0]));
const setLaptop = (on: boolean) => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: on, addEventListener: vi.fn(), removeEventListener: vi.fn() })));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => reads[url] ?? {} })));
  setLaptop(false);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const copy = {
  more_about: 'More about this coffee', lead_title: 'Where we would take you next', others_title: 'Or one of these', price_add: '{price} · Add', choose_this: 'Choose this',
  where_it_shines: 'Where it shines', roaster_rates: 'How the roaster rates it', roaster_rates_caption: 'Rated by the roaster, against their own coffees.',
  roaster_words_title: 'In the roaster’s words', notes_title: 'See the notes wheel', notes_heading: 'Notes',
};

async function openPanel(coffeeId: number) {
  let open = false;
  const ui = () => <MemoryRouter><MoreAbout coffeeId={coffeeId} copy={copy} open={open} onToggle={() => { open = !open; }} /></MemoryRouter>;
  const { rerender } = render(ui());
  fireEvent.click(await screen.findByTestId('more-about-button'));
  rerender(ui());
  return screen.findByTestId('field-reveal');
}
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('MoreAbout on /map: the roaster’s terms (Ella map 13)', () => {
  it('order: the description, where it shines, the notes, then the roaster’s bars; headings from copy', async () => {
    const panel = await openPanel(1);
    const words = within(panel).getByTestId('map-profile-words');
    const shines = within(panel).getByTestId('where-it-shines');
    const notes = within(panel).getByTestId('map-profile-notes');
    const bars = within(panel).getByTestId('roaster-bars');
    expect(before(words, shines) && before(shines, notes) && before(notes, bars)).toBe(true);
    expect(words.textContent).toBe(`${copy.roaster_words_title}Chocolate and almond, with a hint of cherry.`);
    // the notes as a plain line under "Notes", the wheel as a link beside the heading (fix, 2026-11-26)
    expect(notes.firstElementChild!.textContent).toBe(`${copy.notes_heading}${copy.notes_title}`);
    expect(within(notes).getByTestId('notes-line').textContent).toBe('Almond');
    expect(before(within(notes).getByTestId('notes-line'), bars)).toBe(true);
    expect(bars.textContent).toContain(copy.roaster_rates);
    expect(bars.textContent).toContain(copy.roaster_rates_caption);
  });

  it('the notes wheel opens from the link beside "Notes"', async () => {
    const panel = await openPanel(1);
    const link = within(panel).getByTestId('notes-wheel-link');
    expect(link.getAttribute('aria-expanded')).toBe('false');
    expect(panel.textContent).not.toContain('Signature notes');
    fireEvent.click(link);
    expect(link.getAttribute('aria-expanded')).toBe('true');
    expect(panel.textContent).toContain('Signature notes');
  });

  it('"Where it shines" heads every method the roaster named, best first, in the order given', async () => {
    const panel = await openPanel(1);
    const shines = within(panel).getByTestId('where-it-shines');
    expect(shines.firstElementChild!.textContent).toBe(copy.where_it_shines);
    expect([...shines.querySelectorAll('li')].map(li => li.textContent)).toEqual(['Espresso', 'Pour-over', 'Cold brew']);
  });

  it('the roaster’s bars, one step each on their 1 to 5 track; never A&B’s cupping (not read, not drawn)', async () => {
    const panel = await openPanel(1);
    const bars = within(panel).getByTestId('roaster-bars');
    const tracks = [...bars.querySelectorAll('[role="img"]')];
    expect(tracks.map(t => t.getAttribute('aria-label'))).toEqual([
      'Acidity: 4 of 5, from Soft to Bright', 'Body: 5 of 5, from Light to Full', 'Clarity: 2 of 5, from Clean to Layered',
    ]);
    const seg = tracks[0].querySelector('.bf-seg') as HTMLElement;
    expect(seg.style.left).toBe('60%');
    expect(seg.style.width).toBe('20%');
    expect(panel.textContent).not.toContain('Cupping profile');
    expect(panel.textContent).not.toContain('heavy');
    expect(fetched().some(u => u.endsWith('/dimensions'))).toBe(false);
  });

  it('only the dimensions the read gives are drawn (a held-back one is left out server-side)', async () => {
    const panel = await openPanel(1);
    const labels = [...within(panel).getByTestId('roaster-bars').querySelectorAll('.bf-cl')].map(e => e.textContent);
    expect(labels).toEqual(['Acidity', 'Body', 'Clarity']);
    expect(labels).not.toContain('Mouthfeel');
  });

  it('no award, roaster, comfort-zone or compatibility words, no links', async () => {
    const panel = await openPanel(1);
    for (const w of ['Zzz Gold Award', 'Premium', ROASTER, 'comfort', 'Comfort', 'compatib', 'Your profile', 'Full breakdown', 'Ask Liam', 'Compare with']) {
      expect(panel.textContent).not.toContain(w);
    }
    expect(within(panel).queryAllByRole('link')).toEqual([]);
  });

  it('no ratings: no bars and no heading over them', async () => {
    const panel = await openPanel(3);
    expect(within(panel).queryByTestId('roaster-bars')).toBeNull();
    expect(panel.textContent).not.toContain(copy.roaster_rates);
    expect(within(panel).queryByTestId('map-profile-words')).toBeNull();
    expect(within(panel).getByTestId('where-it-shines').textContent).toContain('French press');
  });

  it('ratings alone open a panel with no description', async () => {
    const panel = await openPanel(4);
    expect(within(panel).queryByTestId('map-profile-words')).toBeNull();
    expect(within(panel).getByTestId('roaster-bars').textContent).toContain('Sweetness');
  });

  it('notes with no where-it-shines answer, no description and no ratings: no button', async () => {
    render(<MemoryRouter><MoreAbout coffeeId={2} copy={copy} open={false} onToggle={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(fetched().filter(u => u.startsWith('/api/coffees/2/'))).toHaveLength(3));
    expect(screen.queryByTestId('more-about-button')).toBeNull();
  });
});

const steps = {
  position: { coffeeId: 1, name: 'Tiger Stripe', notes: [], price: null, familyLabel: null, hasBag: true },
  firstBag: { coffeeId: 1, reason: '', text: 'Top text.', labelCode: 'founder_pick', isFounderPick: true },
  steps: [
    { stepId: 50, word: 'Bolder', coffeeId: 1, name: 'Blossom', line: null, notes: [], price: null, familyLabel: null, isLead: true, text: 'Lead text.' },
    { stepId: 48, word: 'More fruit', coffeeId: 2, name: 'Geometric', line: null, notes: [], price: null, familyLabel: null, isLead: false, text: 'Other text.' },
    { stepId: 47, word: 'Softer', coffeeId: 3, name: 'Brazil', line: null, notes: [], price: null, familyLabel: null, isLead: false, text: 'Third text.' },
  ],
  copy,
};
async function renderMap() {
  map.getMapFace.mockResolvedValue({ versionLabel: null, placements: [], wedges: [], seams: [] });
  map.getMapSteps.mockResolvedValue(steps);
  render(<MemoryRouter><MapPage /></MemoryRouter>);
  await screen.findByTestId('map-page');
  const top = screen.getByTestId('position-card');
  await waitFor(() => expect(within(top).getByTestId('more-about-button')).toBeTruthy());
  await waitFor(() => expect(within(screen.getByTestId('lead-step')).getByTestId('more-about-button')).toBeTruthy());
  return top;
}

describe('/map: one panel open at a time, beneath its card', () => {
  it('phone: the top card and each step card carry the button; opening one closes the other; the panel stays inside its card', async () => {
    const top = await renderMap();
    const lead = screen.getByTestId('lead-step');
    // coffee 2 has nothing more to show: its card has no button; coffee 3 has notes and a method
    const others = screen.getAllByTestId('step-card').filter(c => c.dataset.lead === '0');
    expect(within(others[0]).queryByTestId('more-about-button')).toBeNull();
    await waitFor(() => expect(within(others[1]).getByTestId('more-about-button')).toBeTruthy());

    fireEvent.click(within(top).getByTestId('more-about-button'));
    expect(within(top).getByTestId('field-reveal')).toBeTruthy();
    expect(screen.queryByTestId('top-panel-wide')).toBeNull();
    expect(within(lead).queryByTestId('field-reveal')).toBeNull();
    fireEvent.click(within(lead).getByTestId('more-about-button'));
    expect(within(lead).getByTestId('field-reveal')).toBeTruthy();
    expect(within(top).queryByTestId('field-reveal')).toBeNull();
    fireEvent.click(within(lead).getByTestId('more-about-button'));
    expect(screen.queryByTestId('field-reveal')).toBeNull();
  });

  it('laptop: the top card’s panel spans the page under the map and the card; an open step card spans both columns', async () => {
    setLaptop(true);
    const top = await renderMap();
    expect(screen.getByTestId('top-row').className).toContain('lg:grid-cols-2');
    expect(screen.getByTestId('steps-grid').className).toContain('lg:grid-cols-2');
    expect(screen.getByTestId('lead-step').className).toContain('lg:col-span-2');

    fireEvent.click(within(top).getByTestId('more-about-button'));
    const wide = screen.getByTestId('top-panel-wide');
    expect(within(wide).getByTestId('field-reveal')).toBeTruthy();
    expect(within(top).queryByTestId('field-reveal')).toBeNull();
    expect(before(screen.getByTestId('top-row'), wide)).toBe(true);
    fireEvent.click(within(top).getByTestId('more-about-button'));
    expect(screen.queryByTestId('top-panel-wide')).toBeNull();

    const third = screen.getAllByTestId('step-card').find(c => c.textContent?.includes('Brazil'))!;
    expect(third.className).not.toContain('lg:col-span-2');
    fireEvent.click(await within(third).findByTestId('more-about-button'));
    expect(third.className).toContain('lg:col-span-2');
    expect(within(third).getByTestId('field-reveal')).toBeTruthy();
  });
});

describe('the Bloom page’s panel is unchanged (no mapProfile)', () => {
  it('renders the same markup as before Ella map 13', () => {
    const { container } = render(<MemoryRouter>
      <RevealedPanel variant="field" panelId="p" isRevealed archetype="chocolate_nutty" coffeeId={1} dialSortOrder={2}
        content={{ threeVoiceStory: 'Chocolate and almond.', tags: [] } as never}
        dimensions={[{ dimension: 'Body', scale_min_label: 'light', scale_max_label: 'heavy', avg_min: '5', avg_max: '9' }]}
        wheelRows={reads['/api/coffees/1/flavor-wheel'] as never} userArchetype={null} prelaunch hideProfileLink
        brewTags={[{ kind: 'brew', label: 'Espresso' }]} onCompare={() => {}} />
    </MemoryRouter>);
    expect(container.innerHTML).toMatchSnapshot();
    expect(container.textContent).toContain('Cupping profile');
    expect(container.textContent).toContain('In the roaster’s words');
  });
});
