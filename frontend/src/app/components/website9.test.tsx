import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';

// Website 9 (2026-11-06): the wheel turns like the old dial (no flip at half a
// turn, the parent hears only stop changes, the tick row drags, no default
// browser action), the scroll reset on navigation, the drawer's sign-in link,
// the relationship words from the payload, Premium ★ on the old card's tags.
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_9_REVIEW_FIXES.md

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: null, hasLiamAccess: false }) }));
vi.mock('../context/CartContext', () => ({ useCart: () => ({ subscription: null, setSubscription: vi.fn() }), toCheckoutItems: (x: unknown) => x }));
vi.mock('../lib/errorReporter', () => ({ reportError: vi.fn() }));

import { FlowerWheel, angleStep, tOf } from './bloom/wheel/FlowerWheel';
import { ScrollToTopOnNavigate } from '../App';
import { FloatingCart } from './bloom/FloatingCart';
import { CHECKOUT_SIGN_IN_HREF } from './bloom/CartLines';
import { CART_SIGN_IN_HREF } from './cart/CartPage';
import { CompatibilityBadge } from './coffee-info/useCompatibility';
import { CardTags } from './coffee-info/CardTags';

const KINDS = [
  { code: 'own', zoneCode: 'in', badgeCode: 'wheelhouse', customerLabel: 'Your family', zoneLabel: 'Z-in', badgeLabel: 'B-wheelhouse', sortOrder: 1 },
  { code: 'adjacent', zoneCode: 'edge', badgeCode: 'exploring', customerLabel: 'Worth exploring', zoneLabel: 'Z-edge', badgeLabel: 'B-exploring', sortOrder: 2 },
  { code: 'distant', zoneCode: 'outside', badgeCode: 'stretch', customerLabel: 'Outside your comfort zone', zoneLabel: 'Z-outside', badgeLabel: 'B-stretch', sortOrder: 3 },
];

// jsdom has no PointerEvent: a MouseEvent with the pointer fields, so clientX/clientY arrive.
class TestPointerEvent extends MouseEvent {
  pointerId: number; pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse'; }
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).startsWith('/api/coffees/archetype-order') ? { order: [], kinds: KINDS } : {}),
  })));
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('angleStep', () => {
  it('folds each move into (-π, π], so a long turn sums smoothly and never flips', () => {
    expect(angleStep(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(angleStep(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2);
    // a 300° counter-clockwise sweep in 5° moves sums to −300°, never jumping by ±360°
    let total = 0, last = 0;
    for (let i = 1; i <= 60; i++) { const a = Math.atan2(Math.sin(-i * Math.PI / 36), Math.cos(-i * Math.PI / 36)); total += angleStep(last, a); last = a; }
    expect(total).toBeCloseTo(-300 * Math.PI / 180);
  });
});

describe('FlowerWheel pointer turns', () => {
  const box = { left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}) };
  function setup(t = 0) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(box as DOMRect);
    const onChange = vi.fn(), onCommit = vi.fn();
    render(<FlowerWheel t={t} stops={4} color="#a54c2d" stopLabels={['1 · A', '2 · B', '3 · C', '4 · D']} ariaLabel="test" onChange={onChange} onCommit={onCommit} />);
    return { onChange, onCommit, wheel: screen.getByTestId('wheel-drag'), bar: screen.getByTestId('wheel-bar') };
  }
  // a point on the circle of radius 80 around the centre (100,100), angle in degrees (screen: y down)
  const at = (deg: number) => ({ clientX: 100 + 80 * Math.cos(deg * Math.PI / 180), clientY: 100 + 80 * Math.sin(deg * Math.PI / 180), pointerId: 1, button: 0, pointerType: 'mouse' });

  it('a counter-clockwise turn past half a circle keeps going to the far end and stays there (no flip to the start)', () => {
    const { onChange, onCommit, wheel } = setup(0);
    const notPrevented = fireEvent.pointerDown(wheel, at(0));
    expect(notPrevented).toBe(false); // preventDefault: no selection, no focus jump
    for (let d = -5; d >= -330; d -= 5) fireEvent.pointerMove(wheel, at(d));
    fireEvent.pointerUp(wheel, at(-330));
    // the parent heard each new stop once, in order, never the start again
    const stops = onChange.mock.calls.map(c => Math.round((c[0] as number) * 3));
    expect(stops).toEqual([1, 2, 3]);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(tOf(3, 4));
  });

  it('clockwise from the start stays on the first stop', () => {
    const { onChange, onCommit, wheel } = setup(0);
    fireEvent.pointerDown(wheel, at(0));
    for (let d = 5; d <= 200; d += 5) fireEvent.pointerMove(wheel, at(d));
    fireEvent.pointerUp(wheel, at(200));
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it('the tick row is a drag strip: press and slide to the end, the stop under the pointer commits on release', () => {
    const { onChange, onCommit, bar } = setup(tOf(1, 4));
    fireEvent.pointerDown(bar, { clientX: 10, clientY: 5, pointerId: 2, button: 0, pointerType: 'mouse' });
    expect(onChange).toHaveBeenLastCalledWith(0.05);
    fireEvent.pointerMove(bar, { clientX: 195, clientY: 5, pointerId: 2 });
    fireEvent.pointerUp(bar, { clientX: 195, clientY: 5, pointerId: 2 });
    expect(onCommit).toHaveBeenCalledWith(tOf(3, 4));
  });

  it('keys on the slider step one stop', () => {
    const { onCommit } = setup(tOf(1, 4));
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledWith(tOf(2, 4));
  });
});

describe('ScrollToTopOnNavigate (AU9)', () => {
  let go: ReturnType<typeof useNavigate> | null = null;
  function Nav() { go = useNavigate(); return null; }
  it('a new path opens at the top; a query change or a hash does not scroll', async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    render(<MemoryRouter initialEntries={['/bloom?archetype=floral']}><ScrollToTopOnNavigate /><Nav /></MemoryRouter>);
    expect(scrollTo).not.toHaveBeenCalled();
    act(() => go!('/bloom?archetype=fruity'));
    expect(scrollTo).not.toHaveBeenCalled();
    act(() => go!('/flavor-intelligence?archetype=fruity&slot=1'));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    act(() => go!('/shop#earthy'));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});

describe('the drawer (OT-93)', () => {
  it('sends a signed-out visitor to Sign in with the checkout redirect, the same link as /cart', () => {
    render(<MemoryRouter><FloatingCart items={[{ id: 'x', name: 'Coado', price: 3200, quantity: 1 } as never]} open onToggle={() => {}} onRemove={() => {}} onCheckout={() => {}} isSignedIn={false} /></MemoryRouter>);
    expect(screen.getByTestId('drawer-sign-in').getAttribute('href')).toBe('/sign-in?mode=signin&redirect=/checkout');
    expect(CHECKOUT_SIGN_IN_HREF).toBe(CART_SIGN_IN_HREF);
  });
});

describe('relationship words (Q2) and Premium ★ (Q4)', () => {
  it('the badge reads the lookup, with no apology line', async () => {
    render(<CompatibilityBadge level="stretch" userArchetype="fruity" />);
    await waitFor(() => expect(screen.getByTestId('compat-badge').textContent).toBe('B-stretch'));
    expect(document.body.textContent).not.toMatch(/not a bad thing|stretch from your usual/);
  });

  it('an award tag reads Premium ★, never the award wording; best brew as given', () => {
    render(<CardTags tags={[{ kind: 'award', label: 'Award-winning, per the roaster' }, { kind: 'brew', label: 'Espresso' }]} />);
    expect(document.body.textContent).toContain('Premium ★');
    expect(document.body.textContent).toContain('Espresso');
    expect(document.body.textContent).not.toMatch(/award/i);
  });
});
