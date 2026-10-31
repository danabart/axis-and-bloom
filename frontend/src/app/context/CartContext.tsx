import { createContext, useContext, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { CartItem } from '../components/bloom/types';
import type { SubscriptionChoice } from '../lib/api';

interface CartContextType {
  cart: CartItem[];
  cartOpen: boolean;
  toggleCartOpen: () => void;
  addToCart: (item: CartItem) => void;
  removeFromCart: (index: number) => void;
  /** Commerce 1: opens /checkout (no API call; payment happens there). */
  checkout: () => void;
  /** Empties the cart (the return page, once the order is confirmed). */
  clear: () => void;
  /** Commerce 2: the subscription this cart starts (null = a one-time order), chosen in the cart, used at /checkout. */
  subscription: SubscriptionChoice | null;
  setSubscription: (s: SubscriptionChoice | null) => void;
}

const CartContext = createContext<CartContextType | null>(null);

/**
 * Shared cart — relocated out of BloomPage.tsx (The Bloom Part 10, Phase B) so
 * any page wrapped in this provider can add to the same cart, not just /bloom.
 * Commerce 1 (2026-10-31): checkout() no longer places an order. It closes the
 * cart and opens /checkout, where the ships-to address is chosen and Stripe
 * Embedded Checkout takes the payment; the order is written only when Stripe
 * confirms it (the webhook). The provider now sits inside <BrowserRouter>
 * (App.tsx) so it can navigate.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionChoice | null>(null);

  function toggleCartOpen() {
    setCartOpen(v => !v);
  }

  // Same cart line? A dial item matches on (archetype, dialSortOrder, weightOz);
  // a direct (Bloom Dial Base Data Part 3, Phase 6) item matches on (coffeeId, weightOz).
  // A collection (Part 19 §C) matches on archetype alone — one collection line
  // per archetype, qty adjusts the whole set, never splits into individual coffees.
  function isSameLine(a: CartItem, b: CartItem): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'dial' && b.kind === 'dial') {
      return a.archetype === b.archetype && a.dialSortOrder === b.dialSortOrder && a.weightOz === b.weightOz;
    }
    if (a.kind === 'direct' && b.kind === 'direct') {
      return a.coffeeId === b.coffeeId && a.weightOz === b.weightOz;
    }
    if (a.kind === 'collection' && b.kind === 'collection') {
      return a.archetype === b.archetype;
    }
    return false;
  }

  function addToCart(item: CartItem) {
    setCart(prev => {
      const idx = prev.findIndex(i => isSameLine(i, item));
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [...prev, item];
    });
    setCartOpen(true);
  }

  function removeFromCart(index: number) {
    setCart(prev => prev.filter((_, i) => i !== index));
  }

  function checkout() {
    setCartOpen(false);
    navigate('/checkout');
  }

  function clear() {
    setCart([]);
    setSubscription(null);
  }

  return (
    <CartContext.Provider value={{ cart, cartOpen, toggleCartOpen, addToCart, removeFromCart, checkout, clear, subscription, setSubscription }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}

/**
 * What POST /api/checkout/session expects for each cart line. Collection items
 * send { collection: true, archetype, quantity, priceCents } and NOTHING about
 * which coffees are in the set (Part 19 §C) — the backend re-resolves the
 * members and re-verifies every price itself; priceCents is what the screen
 * showed, so a changed price is refused (409) instead of silently charged.
 */
export function toCheckoutItems(cart: CartItem[]) {
  return cart.map(item => {
    if (item.kind === 'dial') {
      return { archetype: item.archetype, dialSortOrder: item.dialSortOrder, weightOz: item.weightOz, quantity: item.qty, priceCents: item.retailPriceCents };
    }
    if (item.kind === 'collection') {
      return { collection: true as const, archetype: item.archetype, quantity: item.qty, priceCents: item.retailPriceCents };
    }
    return { coffeeId: item.coffeeId, weightOz: item.weightOz, quantity: item.qty, priceCents: item.retailPriceCents };
  });
}
