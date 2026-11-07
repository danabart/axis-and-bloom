import { useEffect } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { Wrap, Titled, Btn } from '../chrome';
import {
  CartLines, ShippingLine, SubscribeChoice, SubtotalLine, estimatedTotalCents, useCartQuote, useCheckoutRules, CHECKOUT_SIGN_IN_HREF,
} from '../bloom/CartLines';
import { formatPrice } from '../bloom/types';
import { numberWord } from '../bloom/useDialSlot';
import '../bloom/cartPage.css';

// Website 8 (2026-11-06) — /cart, the handoff's cart page (source/account/build.py).
// Built on the cart pieces that exist (G4.1): useCart is the only cart state,
// CartLines variant="page" draws the lines, SubscribeChoice / SubtotalLine /
// ShippingLine / estimatedTotalCents are the drawer's and /checkout's own.
// Prices, shipping and the subscription numbers come from the API (D13);
// no roasting or delivery promise (D14). The drawer stays (D3).
// backend/src/features/website_handoff/CLAUDE_CODE_PROMPT_WEBSITE_8_SIGN_IN_AND_CART.md

/** The headline from the cart's count (the header's "Cart (n)" count), spelled out by the shared numberWord. */
export function cartHeadline(count: number): string {
  if (count <= 0) return 'Nothing yet.';
  return `${numberWord(count)} ${count === 1 ? 'thing' : 'things'}, so far.`;
}

/** Signed out: today's rule, sign in then straight on to /checkout. */
export const CART_SIGN_IN_HREF = CHECKOUT_SIGN_IN_HREF;

export default function CartPage() {
  const { user, isGuest } = useAuth();
  const { cart, removeFromCart, setQuantity, checkout, subscription, closeCart } = useCart();
  // The page is the cart: an add-to-cart drawer left open on the way here closes (it stays for every other page, D3).
  useEffect(() => { closeCart(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rules = useCheckoutRules();
  const quote = useCartQuote(cart, subscription);
  const count = cart.reduce((n, i) => n + i.qty, 0);
  const signedIn = !!user && !isGuest;
  const total = cart.length ? estimatedTotalCents(cart, subscription, quote, rules) : null;

  return (
    <div className="cp-page" data-testid="cart-page">
      <Wrap className={`cp-acct${cart.length ? ' cp-cartg' : ''}`}>
        <div className="cp-col">
          <Titled style={{ alignSelf: 'flex-start' }}>Your cart</Titled>
          <h1 className="cp-ah" data-testid="cart-headline">{cartHeadline(count)}</h1>
          {cart.length > 0 ? (
            <CartLines items={cart} variant="page" onQuantity={setQuantity} onRemove={removeFromCart} />
          ) : (
            <p className="cp-ap" data-testid="cart-empty">Your cart is empty. The dial is a good place to start.</p>
          )}
          <div className="cp-frow">
            {cart.length > 0 ? (
              <>
                <Link to="/shop" className="ab-caps cp-ulink" style={{ fontWeight: 600 }}>Continue shopping ↗</Link>
                <Link to="/bloom" className="ab-caps cp-ulink" style={{ fontWeight: 400 }}>Turn the dial ↗</Link>
              </>
            ) : (
              <>
                <Btn to="/bloom">Turn the dial</Btn>
                <Link to="/shop" className="ab-caps cp-ulink" style={{ fontWeight: 600 }}>Continue shopping ↗</Link>
              </>
            )}
          </div>
        </div>

        {cart.length > 0 && (
          <aside className="cp-side" aria-label="Summary" data-testid="cart-summary">
            <Titled style={{ alignSelf: 'flex-start' }}>Summary</Titled>
            <SubscribeChoice items={cart} rules={rules} quote={quote} />
            <div className="cp-sum">
              <SubtotalLine items={cart} quote={quote} subscribed={subscription !== null} className="cp-sum-r" />
              <ShippingLine items={cart} rules={rules} className="cp-sum-r" />
              <div className="cp-sum-t" data-testid="cart-total">
                <span>{subscription ? 'First delivery' : 'Estimated total'}</span>
                <span>{total === null ? '…' : formatPrice(total)}</span>
              </div>
            </div>
            {signedIn ? (
              <Btn onClick={checkout} style={{ alignSelf: 'flex-start', marginTop: 8 }} data-testid="cart-checkout">Checkout</Btn>
            ) : (
              <Btn to={CART_SIGN_IN_HREF} style={{ alignSelf: 'flex-start', marginTop: 8 }} data-testid="cart-checkout">Sign in to check out</Btn>
            )}
          </aside>
        )}
      </Wrap>
    </div>
  );
}
