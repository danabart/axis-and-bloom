import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { CartItem } from '../bloom/types';

// Website 8 Part D — /cart: the headline per count, the stepper writes through
// CartContext.setQuantity (0 removes), the empty state, the signed-out
// checkout link keeps the redirect, the collection strike-through, shipping
// from the rules, and the route sits behind the pre-launch gate.

const auth = { user: null as null | { isAnonymous: boolean }, isGuest: false };
let gated = false;
const cartState = {
  cart: [] as CartItem[],
  subscription: null as null | { frequencyWeeks: number },
  setQuantity: vi.fn(), removeFromCart: vi.fn(), checkout: vi.fn(), setSubscription: vi.fn(),
  closeCart: vi.fn(),
};

vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../context/CartContext', () => ({
  useCart: () => cartState,
  toCheckoutItems: (c: CartItem[]) => c.map(i => ({ quantity: i.qty })),
}));
vi.mock('../../lib/prelaunch', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/prelaunch')>()),
  usePrelaunchGated: () => gated,
}));
vi.mock('../../lib/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('../../lib/api', () => ({
  getCheckoutRules: vi.fn(async () => ({ shippingFeeCents: 595, freeShippingMinBags: 2, subscriptionFrequencyWeeks: [2, 4], subscriptionDiscountPct1Bag: 10, subscriptionDiscountPct2PlusBags: 15 })),
  quoteCheckout: vi.fn(async () => null),
}));

import CartPage, { cartHeadline, CART_SIGN_IN_HREF } from './CartPage';
import PrelaunchGate from '../PrelaunchGate';
import { PRELAUNCH_OPEN_ROUTES } from '../../lib/prelaunch';

const dial = (qty = 1): CartItem => ({ kind: 'dial', archetype: 'chocolate_nutty', archetypeLabel: 'Chocolate & Nutty', dialSortOrder: 2, weightOz: 12, platformName: 'Coado', retailPriceCents: 3200, qty });
const collection = (qty = 1): CartItem => ({ kind: 'collection', archetype: 'floral', archetypeLabel: 'Floral', memberCount: 3, retailPriceCents: 8100, undiscountedPriceCents: 9000, qty });

function renderCart() {
  return render(
    <MemoryRouter initialEntries={['/cart']}>
      <Routes>
        <Route path="/cart" element={<PrelaunchGate><CartPage /></PrelaunchGate>} />
        <Route path="/" element={<p>curtain</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.user = null; auth.isGuest = false; gated = false;
  cartState.cart = []; cartState.subscription = null; cartState.closeCart.mockClear();
  cartState.setQuantity.mockClear(); cartState.removeFromCart.mockClear(); cartState.checkout.mockClear();
});
afterEach(() => cleanup());

describe('cartHeadline', () => {
  it('reads the count', () => {
    expect(cartHeadline(0)).toBe('Nothing yet.');
    expect(cartHeadline(1)).toBe('One thing, so far.');
    expect(cartHeadline(2)).toBe('Two things, so far.');
    expect(cartHeadline(5)).toBe('Five things, so far.');
    expect(cartHeadline(14)).toBe('14 things, so far.');
  });
});

describe('/cart', () => {
  it('shows the empty state with the dial and shop links, and no summary', () => {
    renderCart();
    expect(screen.getByTestId('cart-headline').textContent).toBe('Nothing yet.');
    expect(screen.getByTestId('cart-empty')).toBeTruthy();
    expect(screen.queryByTestId('cart-summary')).toBeNull();
    expect(screen.getByRole('link', { name: /Turn the dial/ }).getAttribute('href')).toBe('/bloom');
    expect(screen.getByRole('link', { name: /Continue shopping/ }).getAttribute('href')).toBe('/shop');
  });

  it('counts quantities in the headline and renders a line per item with the meta line', () => {
    cartState.cart = [dial(1), collection(1)];
    renderCart();
    expect(screen.getByTestId('cart-headline').textContent).toBe('Two things, so far.');
    const lines = screen.getAllByTestId('cart-line');
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain('Chocolate & Nutty · 12 oz whole bean');
    expect(lines[0].textContent).toContain('Coado');
    expect(lines[0].textContent).toContain('$32.00');
    // collection: the whole set, discounted, with the undiscounted price struck through
    expect(lines[1].textContent).toContain('The Floral Collection');
    expect(lines[1].textContent).toContain('The collection · 3 coffees');
    expect(within(lines[1]).getByTestId('line-undiscounted').textContent).toBe('$90.00');
    expect(lines[1].textContent).toContain('$81.00');
  });

  it('steps quantities through setQuantity; − on one asks for 0 (which removes)', () => {
    cartState.cart = [dial(2)];
    renderCart();
    expect(screen.getByTestId('cart-headline').textContent).toBe('Two things, so far.');
    fireEvent.click(screen.getByTestId('qty-more'));
    expect(cartState.setQuantity).toHaveBeenLastCalledWith(0, 3);
    fireEvent.click(screen.getByTestId('qty-less'));
    expect(cartState.setQuantity).toHaveBeenLastCalledWith(0, 1);
    cleanup();
    cartState.cart = [dial(1)];
    renderCart();
    fireEvent.click(screen.getByTestId('qty-less'));
    expect(cartState.setQuantity).toHaveBeenLastCalledWith(0, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Coado' }));
    expect(cartState.removeFromCart).toHaveBeenCalledWith(0);
  });

  it('takes shipping and the estimate from the rules, with no typed promise', async () => {
    cartState.cart = [dial(1)];
    renderCart();
    await waitFor(() => expect(screen.getByTestId('shipping-line').textContent).toContain('$5.95'));
    expect(screen.getByTestId('cart-total').textContent).toBe('Estimated total$37.95');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/roast|ships within|Calculated at checkout/i);
  });

  it('sends a signed-out visitor (or a guest) to sign in with the checkout redirect', () => {
    cartState.cart = [dial(1)];
    renderCart();
    expect(screen.getByTestId('cart-checkout').getAttribute('href')).toBe(CART_SIGN_IN_HREF);
    expect(CART_SIGN_IN_HREF).toBe('/sign-in?mode=signin&redirect=/checkout');
    cleanup();
    auth.user = { isAnonymous: true }; auth.isGuest = true;
    renderCart();
    expect(screen.getByTestId('cart-checkout').getAttribute('href')).toBe(CART_SIGN_IN_HREF);
  });

  it('checks out a signed-in customer through CartContext.checkout', () => {
    auth.user = { isAnonymous: false };
    cartState.cart = [dial(1)];
    renderCart();
    fireEvent.click(screen.getByTestId('cart-checkout'));
    expect(cartState.checkout).toHaveBeenCalledTimes(1);
  });

  it('closes the drawer on the way in (the page is the cart)', () => {
    cartState.cart = [dial(1)];
    renderCart();
    expect(cartState.closeCart).toHaveBeenCalled();
  });

  it('is behind the pre-launch gate (not an open route)', () => {
    expect((PRELAUNCH_OPEN_ROUTES as readonly string[]).includes('/cart')).toBe(false);
    gated = true;
    renderCart();
    expect(screen.getByText('curtain')).toBeTruthy();
    expect(screen.queryByTestId('cart-page')).toBeNull();
  });
});
