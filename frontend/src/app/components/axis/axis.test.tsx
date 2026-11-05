import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Website 6 Part D: The Axis renders from its payloads. Regions and dot counts
// from /api/axis/stats (and no list without regions); the band highlight follows
// ?archetype=; the 04 stats line; the accordion is a real button with
// aria-expanded / aria-controls; reduced motion shows the dots without the
// animation; the wheel's segments follow the per-family counts.

let reduced = false;
vi.mock('motion/react', () => ({ useReducedMotion: () => reduced }));
vi.mock('../../lib/errorReporter', () => ({ reportError: vi.fn() }));

import TheAxis from '../TheAxis';
import { allocateSegments, SEGMENTS } from './axisWheel';

const ARCHETYPES = [
  { archetype: 'fruity', archetypeLabel: 'Fruity', sortOrder: 2, customerWords: ['Lively', 'Vibrant', 'Expressive'], slots: [] },
  { archetype: 'floral', archetypeLabel: 'Floral', sortOrder: 1, customerWords: ['Bright', 'Fragrant', 'Delicate'], slots: [] },
  { archetype: 'balanced_sweet', archetypeLabel: 'Balanced', sortOrder: 3, customerWords: ['Easy', 'Smooth', 'Harmonious'], slots: [] },
  { archetype: 'chocolate_nutty', archetypeLabel: 'Chocolate & Nutty', sortOrder: 4, customerWords: ['Full', 'Grounded', 'Comforting'], slots: [] },
  { archetype: 'earthy', archetypeLabel: 'Earthy', sortOrder: 5, customerWords: ['Deep', 'Bold', 'Lasting'], slots: [] },
];
let stats: Record<string, unknown>;
let statsOk = true;
const baseStats = () => ({
  coffeesMapped: 22,
  archetypes: [
    { key: 'floral', name: 'Floral', coffeeCount: 2 }, { key: 'fruity', name: 'Fruity', coffeeCount: 8 },
    { key: 'balanced_sweet', name: 'Balanced', coffeeCount: 4 }, { key: 'chocolate_nutty', name: 'Chocolate & Nutty', coffeeCount: 5 },
    { key: 'earthy', name: 'Earthy', coffeeCount: 3 },
  ],
  connectionCount: 2, regionAdjacency: [], experimentalCount: 1,
  bloomNotesThisMonth: 1, positionsRefinedThisQuarter: 13,
  lastTightenedAt: '2026-10-25T02:37:54.562Z',
  originRegions: [{ label: 'East Africa', coffeeCount: 3 }, { label: 'South America', coffeeCount: 5 }],
});

beforeEach(() => {
  reduced = false; statsOk = true; stats = baseStats();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/axis/stats')) return { ok: statsOk, status: statsOk ? 200 : 500, json: async () => (statsOk ? stats : { error: 'x' }) };
    if (url.startsWith('/api/coffees/archetypes')) return { ok: true, status: 200, json: async () => ARCHETYPES };
    return { ok: true, status: 200, json: async () => ({}) };
  }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderAxis = (url = '/the-axis') => render(<MemoryRouter initialEntries={[url]}><TheAxis /></MemoryRouter>);

describe('The Axis', () => {
  it('hero: the regions and their dot counts come from the payload; the date is formatted', async () => {
    renderAxis();
    const list = await waitFor(() => screen.getByTestId('origin-list'));
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map(r => r.getAttribute('aria-label'))).toEqual(['East Africa: 3 coffees', 'South America: 5 coffees']);
    expect(within(rows[1]).getByTestId('origin-dots').children).toHaveLength(5);
    expect(screen.getByTestId('last-tightened').textContent).toBe('Map last tightened October 25, 2026.');
  });

  it('no region set yet (OT-71): no origin list, the hero goes full width', async () => {
    stats = { ...baseStats(), originRegions: [] };
    renderAxis();
    await waitFor(() => expect(screen.getByTestId('last-tightened')).toBeTruthy());
    expect(screen.queryByTestId('origin-list')).toBeNull();
    expect(document.querySelector('.ax-hero-g')!.className).toContain('solo');
  });

  it('?archetype=floral highlights the Floral band and its list item, and scrolls to 02', async () => {
    renderAxis('/the-axis?archetype=floral');
    const bands = await waitFor(() => screen.getByTestId('family-bands'));
    await waitFor(() => expect(bands.querySelector('[data-fam="floral"]')!.className).toContain('hot'));
    expect([...bands.querySelectorAll('.ax-band.hot')]).toHaveLength(1);
    expect(screen.getByTestId('family-list').querySelector('li.hot')!.textContent).toContain('Floral');
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it('bands follow sort_order and show the three words; focusing a list item highlights its band (keyboard)', async () => {
    renderAxis();
    const bands = await waitFor(() => screen.getByTestId('family-bands'));
    await waitFor(() => expect(bands.children).toHaveLength(5));
    expect([...bands.children].map(b => b.getAttribute('data-fam'))).toEqual(['floral', 'fruity', 'balanced_sweet', 'chocolate_nutty', 'earthy']);
    expect(bands.children[1].textContent).toContain('Lively · Vibrant · Expressive');
    const items = within(screen.getByTestId('family-list')).getAllByRole('listitem');
    fireEvent.focus(items[3]);
    expect(bands.querySelector('[data-fam="chocolate_nutty"]')!.className).toContain('hot');
    fireEvent.blur(items[3]);
    expect(bands.querySelector('.hot')).toBeNull();
    expect(screen.getByText(/one of five sensory archetypes/)).toBeTruthy();
  });

  it('04 ends on the live stats line; on a stats error the live lines are hidden', async () => {
    renderAxis();
    await waitFor(() => expect(screen.getByTestId('stats-line').textContent).toBe('1 Bloom Note this month · 13 positions refined this quarter'));
    cleanup();
    statsOk = false;
    renderAxis();
    await waitFor(() => expect(screen.getByTestId('family-bands').children).toHaveLength(5));
    expect(screen.queryByTestId('stats-line')).toBeNull();
    expect(screen.queryByTestId('last-tightened')).toBeNull();
  });

  it('the accordion is a button wired to its region; the Liam answer is the live copy', async () => {
    renderAxis();
    const btn = await waitFor(() => screen.getByRole('button', { name: 'What Liam can and can’t see' }));
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    const region = document.getElementById(btn.getAttribute('aria-controls')!)!;
    expect(region.hidden).toBe(true);
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(region.hidden).toBe(false);
    expect(region.textContent).toContain('he never invents a coffee');
    expect(document.body.textContent).not.toContain('Dana’s answer goes here');
  });

  it('reduced motion: the dots and segments are shown at once (no in-view animation)', async () => {
    reduced = true;
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    renderAxis();
    const list = await waitFor(() => screen.getByTestId('origin-list'));
    expect(list.getAttribute('data-motion')).toBe('off');
    expect(list.className).toContain(' in');
    await waitFor(() => expect(screen.getByTestId('family-wheel').getAttribute('class')).toContain(' in'));
  });

  it('without reduced motion the dots wait for the list to scroll into view', async () => {
    let fire: (() => void) | null = null;
    vi.stubGlobal('IntersectionObserver', class {
      cb: (e: { isIntersecting: boolean }[]) => void;
      constructor(cb: (e: { isIntersecting: boolean }[]) => void) { this.cb = cb; }
      observe() { fire = () => this.cb([{ isIntersecting: true }]); }
      disconnect() {}
    });
    renderAxis();
    const list = await waitFor(() => screen.getByTestId('origin-list'));
    expect(list.className).not.toContain(' in');
  });

  it('the wheel shows one segment per coffee per family, hollow for Experimental, the rest open', async () => {
    renderAxis();
    const wheel = await waitFor(() => screen.getByTestId('family-wheel'));
    const kinds = [...wheel.querySelectorAll('path')].map(p => p.getAttribute('data-kind'));
    expect(kinds).toHaveLength(SEGMENTS.length);
    expect(kinds.filter(k => k === 'fruity')).toHaveLength(8);
    expect(kinds.filter(k => k === 'floral')).toHaveLength(2);
    expect(kinds.filter(k => k === 'experimental')).toHaveLength(1);
    expect(kinds.filter(k => k === 'open')).toHaveLength(SEGMENTS.length - 23);
    expect(wheel.getAttribute('aria-label')).toContain('Fruity: 8');
  });
});

describe('allocateSegments', () => {
  it('more coffees than segments: proportional, every family with a coffee keeps one, the total is the wheel', () => {
    const k = allocateSegments([
      { code: 'a', color: '#000000', count: 100 }, { code: 'b', color: '#000000', count: 1 }, { code: 'c', color: '#000000', count: 0 },
    ], 5, 27);
    expect(k).toHaveLength(27);
    expect(k.filter(x => x.kind === 'family' && x.code === 'b')).toHaveLength(1);
    expect(k.filter(x => x.kind === 'family' && x.code === 'a')).toHaveLength(26);
    expect(k.filter(x => x.kind === 'experimental')).toHaveLength(0);
    expect(k.some(x => x.kind === 'family' && x.code === 'c')).toBe(false);
  });
  it('experimental takes what is left, capped', () => {
    const k = allocateSegments([{ code: 'a', color: '#000000', count: 25 }], 9, 27);
    expect(k.filter(x => x.kind === 'experimental')).toHaveLength(2);
  });
});
