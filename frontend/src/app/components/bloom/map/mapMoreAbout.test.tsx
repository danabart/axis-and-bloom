// Ella's Bloom Map 12 (2026-11-26), Part D (frontend): "More about this coffee"
// on /map opens the shared reveal panel beneath the card, one at a time, with
// the coffee's own parts only (description, best-brew tags, cupping bars, notes
// wheel): no comfort-zone label, no compatibility sentence, no roaster name, no
// award tag, no links. A coffee with neither a description nor cupping bars has
// no button. Fixture values only; the real ones come from the API.
// backend/src/features/ella_bloom_map/CLAUDE_CODE_PROMPT_ELLA_MAP_12_STEP_COMPARISONS_AND_REVEAL.md
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

const ROASTER = 'Zzz Roasting Works';
/** The public coffee reads, per coffee id: 1 has a description, bars and tags; 2 has nothing more to show. */
const reads: Record<string, unknown> = {
  '/api/coffees/1/content': {
    threeVoiceStory: 'Chocolate and almond, with a hint of cherry.', roaster_name: ROASTER,
    tags: [{ kind: 'award', label: 'Zzz Gold Award 2025' }, { kind: 'brew', label: 'Espresso' }],
  },
  '/api/coffees/1/flavor-wheel': [{ descriptor: 'Almond', l1: 'Nutty', l2: 'Nut', weight: 3, source: 'roaster' }],
  '/api/coffees/1/dimensions': { dimensions: [{ code: 'body', label: 'Body', min: 5, max: 9, sessions: 2 }] },
  '/api/coffees/2/content': { threeVoiceStory: null, tags: [] },
  '/api/coffees/2/flavor-wheel': [{ descriptor: 'Toffee', l1: 'Sweet', l2: 'Caramel', weight: 1, source: 'roaster' }],
  '/api/coffees/2/dimensions': { dimensions: [] },
};
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => reads[url] ?? {} })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const copy = { more_about: 'More about this coffee', lead_title: 'Where we would take you next', others_title: 'Or one of these', price_add: '{price} · Add', choose_this: 'Choose this' };

describe('MoreAbout (C)', () => {
  it('opens the shared panel with the description and the brew tag only: no award, roaster, comfort-zone or compatibility words, no links', async () => {
    let open = false;
    const { rerender } = render(<MemoryRouter><MoreAbout coffeeId={1} label={copy.more_about} open={open} onToggle={() => { open = !open; }} /></MemoryRouter>);
    const button = await screen.findByTestId('more-about-button');
    expect(button.textContent).toBe(copy.more_about);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('field-reveal')).toBeNull();
    fireEvent.click(button);
    rerender(<MemoryRouter><MoreAbout coffeeId={1} label={copy.more_about} open={open} onToggle={() => { open = !open; }} /></MemoryRouter>);
    const panel = await screen.findByTestId('field-reveal');
    expect(panel.textContent).toContain('Chocolate and almond, with a hint of cherry.');
    expect(panel.textContent).toContain('Espresso');
    expect(panel.textContent).toContain('Cupping profile');
    for (const w of ['Zzz Gold Award', 'Premium', ROASTER, 'comfort', 'Comfort', 'compatib', 'Your profile', 'Full breakdown', 'Ask Liam', 'Compare with']) {
      expect(panel.textContent).not.toContain(w);
    }
    expect(within(panel).queryAllByRole('link')).toEqual([]);
  });

  it('a coffee with neither a description nor cupping bars has no button', async () => {
    render(<MemoryRouter><MoreAbout coffeeId={2} label={copy.more_about} open={false} onToggle={() => {}} /></MemoryRouter>);
    await waitFor(() => expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3));
    expect(screen.queryByTestId('more-about-button')).toBeNull();
  });
});

describe('/map: one panel open at a time, beneath its card (C)', () => {
  it('the top card and each step card carry the button; opening one closes the other', async () => {
    map.getMapFace.mockResolvedValue({ versionLabel: null, placements: [], wedges: [], seams: [] });
    map.getMapSteps.mockResolvedValue({
      position: { coffeeId: 1, name: 'Tiger Stripe', notes: [], price: null, familyLabel: null, hasBag: true },
      firstBag: { coffeeId: 1, reason: '', text: 'Top text.', labelCode: 'founder_pick', isFounderPick: true },
      steps: [
        { stepId: 50, word: 'Bolder', coffeeId: 1, name: 'Blossom', line: null, notes: [], price: null, familyLabel: null, isLead: true, text: 'Lead text.' },
        { stepId: 48, word: 'More fruit', coffeeId: 2, name: 'Geometric', line: null, notes: [], price: null, familyLabel: null, isLead: false, text: 'Other text.' },
      ],
      copy,
    });
    render(<MemoryRouter><MapPage /></MemoryRouter>);
    await screen.findByTestId('map-page');
    const top = screen.getByTestId('position-card');
    const lead = screen.getByTestId('lead-step');
    await waitFor(() => expect(within(top).getByTestId('more-about-button')).toBeTruthy());
    await waitFor(() => expect(within(lead).getByTestId('more-about-button')).toBeTruthy());
    // coffee 2 has nothing more to show: its card has no button
    expect(within(screen.getByTestId('steps')).queryByTestId('more-about-button')).toBeNull();

    fireEvent.click(within(top).getByTestId('more-about-button'));
    expect(within(top).getByTestId('field-reveal')).toBeTruthy();
    expect(within(lead).queryByTestId('field-reveal')).toBeNull();
    fireEvent.click(within(lead).getByTestId('more-about-button'));
    expect(within(lead).getByTestId('field-reveal')).toBeTruthy();
    expect(within(top).queryByTestId('field-reveal')).toBeNull();
    fireEvent.click(within(lead).getByTestId('more-about-button'));
    expect(screen.queryByTestId('field-reveal')).toBeNull();
  });
});
