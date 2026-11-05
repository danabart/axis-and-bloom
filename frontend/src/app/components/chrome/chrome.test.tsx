import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

// Website 1 Part D — Navigation (auth state, admin, live cart count, gated
// set, Menu overlay a11y) and Footer (newsletter posts with source 'footer').

const auth = { user: null as null | { isAnonymous: boolean }, isAdmin: false, isGuest: false, hasLiamAccess: false, logout: vi.fn(async () => {}) };
const cart = { cart: [] as Array<{ qty: number }>, toggleCartOpen: vi.fn() };
let gated = false;
const subscribeNewsletter = vi.fn(async (_p: { email: string; source: string }) => ({ ok: true }));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../context/CartContext', () => ({ useCart: () => cart }));
vi.mock('../../lib/prelaunch', () => ({ usePrelaunchGated: () => gated }));
vi.mock('../../lib/api', () => ({ subscribeNewsletter: (p: { email: string; source: string }) => subscribeNewsletter(p) }));
vi.mock('../../lib/analytics', () => ({ trackEvent: vi.fn(), trackLead: vi.fn() }));
vi.mock('../../lib/errorReporter', () => ({ reportError: vi.fn() }));

import Navigation from '../Navigation';
import Footer from '../Footer';

function renderAt(ui: React.ReactElement, path = '/bloom') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

beforeEach(() => {
  auth.user = null; auth.isAdmin = false; auth.isGuest = false; auth.hasLiamAccess = false;
  cart.cart = []; cart.toggleCartOpen.mockClear();
  gated = false;
  subscribeNewsletter.mockClear();
});
afterEach(() => cleanup());

const header = () => document.querySelector('header')! as HTMLElement;
const inHeader = (name: string | RegExp) => Array.from(header().querySelectorAll('a,button')).find(el => (typeof name === 'string' ? el.textContent === name : name.test(el.textContent ?? '')));

describe('Navigation', () => {
  it('shows Sign in when signed out', () => {
    renderAt(<Navigation />);
    expect(inHeader('Sign in')).toBeTruthy();
    expect(inHeader('Profile')).toBeFalsy();
    expect(inHeader('Sign out')).toBeFalsy();
  });

  it('treats an anonymous guest as signed out', () => {
    auth.user = { isAnonymous: true }; auth.isGuest = true;
    renderAt(<Navigation />);
    expect(inHeader('Sign in')).toBeTruthy();
  });

  it('shows Profile and Sign out when signed in', () => {
    auth.user = { isAnonymous: false };
    renderAt(<Navigation />);
    expect(inHeader('Profile')?.getAttribute('href')).toBe('/profile');
    expect(inHeader('Sign out')).toBeTruthy();
    expect(inHeader('Sign in')).toBeFalsy();
  });

  it('shows ADMIN for admins only', () => {
    renderAt(<Navigation />);
    expect(inHeader('Admin')).toBeFalsy();
    cleanup();
    auth.user = { isAnonymous: false }; auth.isAdmin = true;
    renderAt(<Navigation />);
    expect(inHeader('Admin')?.getAttribute('href')).toBe('/admin');
  });

  it('shows Cart (3) for a cart of 3 and opens the drawer', () => {
    cart.cart = [{ qty: 2 }, { qty: 1 }];
    renderAt(<Navigation />);
    const c = inHeader(/^Cart/)!;
    expect(c.textContent).toBe('Cart (3)');
    expect(c.getAttribute('aria-label')).toBe('Cart, 3 items');
    fireEvent.click(c);
    expect(cart.toggleCartOpen).toHaveBeenCalledTimes(1);
  });

  it('renders nothing cart-related, no admin and only the gated menu set while gated', () => {
    gated = true; cart.cart = [{ qty: 3 }];
    auth.user = { isAnonymous: false }; auth.isAdmin = true;
    renderAt(<Navigation />);
    expect(document.body.textContent).not.toMatch(/Cart/);
    expect(inHeader('Admin')).toBeFalsy();
    const menuLinks = Array.from(document.querySelectorAll('#siteMenu nav a')).map(a => a.getAttribute('href'));
    expect(menuLinks).toEqual(['/find-my-flavor']);
  });

  it('lists the four numbered items and marks the current route', () => {
    renderAt(<Navigation />, '/the-axis');
    const links = Array.from(document.querySelectorAll('#siteMenu nav a'));
    expect(links.map(a => a.getAttribute('href'))).toEqual(['/shop', '/the-axis', '/bloom', '/find-my-flavor']);
    expect(links[1].getAttribute('aria-current')).toBe('page');
    expect(links[0].getAttribute('aria-current')).toBeNull();
  });

  it('opens the Menu overlay, traps focus, closes on Escape and returns focus', async () => {
    renderAt(<Navigation />);
    const btn = screen.getByRole('button', { name: 'Menu' });
    const menu = document.getElementById('siteMenu')!;
    expect(btn.getAttribute('aria-controls')).toBe('siteMenu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(menu.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(menu.getAttribute('role')).toBe('dialog');
    expect(menu.getAttribute('aria-modal')).toBe('true');
    expect(menu.className).toContain('open');
    expect(document.body.style.overflow).toBe('hidden');

    const focusables = Array.from(menu.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(document.activeElement).toBe(first);

    // Tab from the last wraps to the first; Shift+Tab from the first wraps to the last.
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(btn.getAttribute('aria-expanded')).toBe('false'));
    expect(menu.className).not.toContain('open');
    expect(document.activeElement).toBe(btn);
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on an outside click and on Close', () => {
    renderAt(<div><p data-testid="outside">page</p><Navigation /></div>);
    const btn = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(btn);
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('button', { name: 'Close', hidden: true }));
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Footer', () => {
  it('posts the newsletter with source footer and shows the success line', async () => {
    renderAt(<Footer />);
    const input = screen.getByLabelText('Your family of taste, in your inbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: ' dana@example.com ' } });
    await act(async () => { fireEvent.submit(input.closest('form')!); });
    expect(subscribeNewsletter).toHaveBeenCalledWith({ email: 'dana@example.com', source: 'footer' });
    expect(await screen.findByText("You're on the list.")).toBeTruthy();
  });

  it('shows the error inline when the subscribe call fails', async () => {
    subscribeNewsletter.mockRejectedValueOnce(new Error('Failed to subscribe'));
    renderAt(<Footer />);
    const input = screen.getByLabelText('Your family of taste, in your inbox');
    fireEvent.change(input, { target: { value: 'dana@example.com' } });
    await act(async () => { fireEvent.submit(input.closest('form')!); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/try again/);
  });

  it('shows the current year, real legal links, and gates Liam', () => {
    renderAt(<Footer />);
    expect(document.body.textContent).toContain(`© ${new Date().getFullYear()} Axis & Bloom`);
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('/terms');
    expect(screen.getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe('/privacy');
    expect(screen.queryByRole('link', { name: 'Liam' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'FAQ' })).toBeNull();
    cleanup();
    auth.hasLiamAccess = true;
    renderAt(<Footer />);
    expect(screen.getByRole('link', { name: 'Liam' }).getAttribute('href')).toBe('/sommelier');
  });

  it('shows only the open doors while gated', () => {
    gated = true; auth.hasLiamAccess = true;
    renderAt(<Footer />);
    const nav = screen.getByRole('navigation', { name: 'Footer' });
    expect(Array.from(nav.querySelectorAll('a,button')).map(e => e.textContent)).toEqual(['Find My Flavor']);
  });
});
